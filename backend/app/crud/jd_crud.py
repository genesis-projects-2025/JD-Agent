# app/crud/jd_crud.py
# PERFORMANCE IMPROVEMENTS:
#   1. N+1 queries eliminated — JOINs used everywhere instead of per-row fetches
#   2. Redis cache on hot read paths (employee JD list, unread feedback)
#   3. Unnecessary DB round-trips removed in review comment serialisation

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, delete
from sqlalchemy.orm import selectinload
from app.models.jd_session_model import JDSession, ConversationTurn, JDVersion
from typing import Optional
import datetime
import json
import uuid
import logging

logger = logging.getLogger(__name__)
from sqlalchemy.dialects.postgresql import insert
from app.models.taxonomy_model import Skill, JDSessionSkill, EmployeeSkill
from app.core.cache import get_cache, set_cache, invalidate_pattern

SOFT_SKILLS = {
    "communication",
    "leadership",
    "teamwork",
    "problem solving",
    "time management",
    "adaptability",
    "team player",
    "interpersonal skills",
    "critical thinking",
    "collaboration",
    "work ethic",
    "attention to detail",
    "creative thinking",
}


def sanitise_skills(skills: list) -> list:
    """Strip out common soft-skill hallucinations to keep the JD technical."""
    if not skills:
        return []
    seen = set()
    clean = []
    for s in skills:
        if not s:
            continue
        s_clean = s.strip()
        s_lower = s_clean.lower()
        if s_lower not in SOFT_SKILLS and s_lower not in seen:
            clean.append(s_clean)
            seen.add(s_lower)
    return clean


# ── JSONB Safety Helpers ──────────────────────────────────────────────────────


def _safe_jsonb(value) -> dict:
    if value is None:
        return {}
    if hasattr(value, "model_dump"):
        value = value.model_dump()
    if not isinstance(value, dict):
        try:
            value = dict(value)
        except Exception:
            return {}
            return {}
    try:
        return json.loads(json.dumps(value, default=str))
    except Exception:
        return {}


# ── Helpers ───────────────────────────────────────────────────────────────────


def _extract_title(jd_structured: dict) -> Optional[str]:
    if not isinstance(jd_structured, dict):
        return None
    title = (
        jd_structured.get("job_title")
        or jd_structured.get("title")
        or jd_structured.get("role_title")
        or jd_structured.get("position")
        or jd_structured.get("designation")  # New Pulse Pharma key
    )
    if title and isinstance(title, str) and len(title) < 200:
        return title.strip()
    emp_info = jd_structured.get("employee_information", {})
    if isinstance(emp_info, dict):
        title = (
            emp_info.get("job_title")
            or emp_info.get("title")
            or emp_info.get("role_title")
        )
        if title and isinstance(title, str) and len(title) < 200:
            return title.strip()
    return None


def _extract_department(jd_structured: dict) -> Optional[str]:
    if not isinstance(jd_structured, dict):
        return None
    dept = (
        jd_structured.get("department")
        or jd_structured.get("function")
        or jd_structured.get("dept")
    )
    if dept and isinstance(dept, str) and len(dept) < 200:
        return dept.strip()
    emp_info = jd_structured.get("employee_information", {})
    if isinstance(emp_info, dict):
        dept = (
            emp_info.get("department")
            or emp_info.get("function")
            or emp_info.get("dept")
        )
        if dept and isinstance(dept, str) and len(dept) < 200:
            return dept.strip()
    return None


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


def _safe_uuid(val: str) -> uuid.UUID:
    if isinstance(val, uuid.UUID):
        return val
    return uuid.UUID(val)


def _trigger_rag_indexing(record: JDSession):
    """Fire-and-forget indexing task for approved JDs."""
    if not record or record.status != "approved" or not record.jd_structured:
        return

    from app.services.vector_service import index_approved_jd
    import asyncio

    # Try to extract experience level for metadata
    exp_text = str(record.jd_structured.get("experience", "")).lower()
    exp_level = "Mid"
    if any(k in exp_text for k in ["junior", "0-2", "entry"]):
        exp_level = "Junior"
    elif any(k in exp_text for k in ["senior", "lead", "sr.", "5+"]):
        exp_level = "Senior"
    elif any(k in exp_text for k in ["principal", "architect", "staff", "10+"]):
        exp_level = "Expert"

    asyncio.create_task(
        index_approved_jd(
            jd_id=str(record.id),
            structured_data=record.jd_structured,
            department=record.department or "General",
            experience_level=exp_level,
        )
    )


async def _harvest_organic_skills(
    db: AsyncSession, jd_structured: dict, session_id: str, employee_id: str
):
    if not jd_structured or not session_id or not employee_id:
        return

    req_skills = jd_structured.get("skills", []) or jd_structured.get("technical_skills", []) or jd_structured.get("required_skills", [])
    if not isinstance(req_skills, list):
        req_skills = []

    tools = jd_structured.get("tools_and_technologies", []) or jd_structured.get("tools_used", [])
    if not isinstance(tools, list):
        tools = []

    new_skills = jd_structured.get("skills", [])
    if not isinstance(new_skills, list):
        new_skills = []

    new_tools = jd_structured.get("tools", [])
    if not isinstance(new_tools, list):
        new_tools = []

    raw_skills = set()
    for s in req_skills + tools + new_skills + new_tools:
        if isinstance(s, str) and s.strip():
            raw_skills.add(s.strip())

    if not raw_skills:
        return

    # Sanitise before inserting — never store soft skills in the DB
    from app.services.jd_service import sanitise_skills

    all_skills = set(sanitise_skills(list(raw_skills)))

    if not all_skills:
        return

    session_uuid = _safe_uuid(session_id)

    for skill_name in all_skills:
        skill_stmt = insert(Skill).values(name=skill_name)
        skill_stmt = skill_stmt.on_conflict_do_update(
            index_elements=["name"],
            set_=dict(name=skill_name),
        ).returning(Skill.id)

        result = await db.execute(skill_stmt)
        skill_id = result.scalar()

        if not skill_id:
            res = await db.execute(select(Skill.id).where(Skill.name == skill_name))
            skill_id = res.scalar()

        if not skill_id:
            continue

        sess_stmt = (
            insert(JDSessionSkill)
            .values(session_id=session_uuid, skill_id=skill_id)
            .on_conflict_do_nothing()
        )
        await db.execute(sess_stmt)

        emp_stmt = (
            insert(EmployeeSkill)
            .values(employee_id=employee_id, skill_id=skill_id, source="jd_interview")
            .on_conflict_do_nothing()
        )
        await db.execute(emp_stmt)


# ── Core Upsert ───────────────────────────────────────────────────────────────


async def save_questionnaire_jd(
    db: AsyncSession,
    session_id: str,
    jd_text: str,
    jd_structured: dict,
    employee_insights: dict,
    progress: dict,
    employee_id: str,
    conversation_history: Optional[list] = None,
    status: Optional[str] = None,
) -> JDSession:

    session_uuid = _safe_uuid(session_id)
    result = await db.execute(
        select(JDSession)
        .where(JDSession.id == session_uuid)
        .options(selectinload(JDSession.conversation_turns))
    )
    record = result.scalar_one_or_none()

    safe_structured = _safe_jsonb(jd_structured)
    safe_insights = _safe_jsonb(employee_insights)
    safe_progress = _safe_jsonb(progress)

    title = _extract_title(safe_structured)
    department = _extract_department(safe_structured)

    emp_name_from_insights = safe_insights.get("identity_context", {}).get(
        "employee_name"
    )
    if emp_name_from_insights:
        from app.models.user_model import Employee

        emp_res = await db.execute(select(Employee).where(Employee.id == employee_id))
        emp = emp_res.scalar_one_or_none()
        if emp and (
            not emp.name or emp.name == "Unknown Employee" or "Employee AI" in emp.name
        ):
            emp.name = emp_name_from_insights

    if record:
        if jd_text:
            if record.jd_text and jd_text != record.jd_text:
                old_version = JDVersion(
                    session_id=session_uuid,
                    version=record.version or 1,
                    jd_text=record.jd_text,
                    jd_structured=record.jd_structured,
                    created_by=record.employee_id,
                )
                db.add(old_version)
                record.version = (record.version or 1) + 1
            record.jd_text = jd_text
        if safe_structured:
            record.jd_structured = safe_structured

        record.insights = safe_insights
        # Handle both legacy progress dicts and new full session state dicts
        # Save working memory (questions_asked) into conversation_state JSONB
        record.conversation_state = safe_progress

        if status:
            if not record.status or record.status in [
                "draft",
                "collecting",
                "jd_generated",
            ]:
                record.status = status

        if title:
            record.title = title
        if department:
            record.department = department

    else:
        record = JDSession(
            id=session_uuid,
            employee_id=employee_id,
            status=status or "draft",
            title=title or "New Strategic Role",
            department=department,
            conversation_state=safe_progress,
            insights=safe_insights,
            jd_text=jd_text,
            jd_structured=safe_structured,
        )
        db.add(record)

    await db.flush()

    if conversation_history is not None:
        await db.execute(
            delete(ConversationTurn).where(ConversationTurn.session_id == session_uuid)
        )
        for idx, turn in enumerate(conversation_history):
            new_turn = ConversationTurn(
                session_id=session_uuid,
                turn_index=idx,
                role=turn.get("role", "unknown"),
                content=turn.get("content", ""),
            )
            db.add(new_turn)

    await db.commit()
    await db.refresh(record, ["conversation_turns", "employee"])

    # Invalidate cached JD lists for this employee
    await invalidate_pattern(f"jds:employee:{employee_id}")

    try:
        if safe_structured:
            await _harvest_organic_skills(db, safe_structured, session_id, employee_id)
            await db.commit()
    except Exception as e:
        import traceback
        traceback.print_exc()
        logger.error(f"[CRUD] Failed to harvest skills: {e}")

    logger.info(
        f"✅ JD saved — id={record.id}, employee={record.employee_id}, title={record.title}"
    )
    return record


async def append_conversation_turn(
    db: AsyncSession,
    session_id: str,
    role: str,
    content: str,
) -> Optional[JDSession]:
    session_uuid = _safe_uuid(session_id)
    result = await db.execute(select(JDSession).where(JDSession.id == session_uuid))
    record = result.scalar_one_or_none()
    if not record:
        return None

    turns_count_res = await db.execute(
        select(func.count(ConversationTurn.id)).where(
            ConversationTurn.session_id == session_uuid
        )
    )
    next_index = turns_count_res.scalar() or 0

    new_turn = ConversationTurn(
        session_id=session_uuid, turn_index=next_index, role=role, content=content
    )
    db.add(new_turn)
    await db.commit()
    return record


async def sync_session_to_db(
    db: AsyncSession,
    session_id: str,
    insights: dict,
    progress: dict,
    conversation_history: list,
    employee_id: str,
    employee_name: Optional[str] = None,
    generated_jd: Optional[str] = None,
    jd_structured: Optional[dict] = None,
    status: Optional[str] = None,
) -> JDSession:

    session_uuid = _safe_uuid(session_id)
    result = await db.execute(select(JDSession).where(JDSession.id == session_uuid))
    record = result.scalar_one_or_none()

    safe_insights = _safe_jsonb(insights)
    safe_progress = _safe_jsonb(progress)
    safe_structured = _safe_jsonb(jd_structured) if jd_structured else None

    emp_name_from_insights = safe_insights.get("identity_context", {}).get(
        "employee_name"
    )
    if emp_name_from_insights:
        from app.models.user_model import Employee

        emp_res = await db.execute(select(Employee).where(Employee.id == employee_id))
        emp = emp_res.scalar_one_or_none()
        if emp and (
            not emp.name or emp.name == "Unknown Employee" or "Employee AI" in emp.name
        ):
            emp.name = emp_name_from_insights

    if record:
        record.insights = safe_insights
        # Persistence: Save full session progress/state including questions_asked
        record.conversation_state = safe_progress
        if generated_jd:
            record.jd_text = generated_jd
        if safe_structured:
            record.jd_structured = safe_structured
        if status:
            record.status = status
        if not record.title and safe_structured:
            record.title = _extract_title(safe_structured)
        if not record.department and safe_structured:
            record.department = _extract_department(safe_structured)
    else:
        record = JDSession(
            id=session_uuid,
            employee_id=employee_id,
            status=status or "collecting",
            insights=safe_insights,
            conversation_state=safe_progress,
            jd_text=generated_jd,
            jd_structured=safe_structured,
            title=_extract_title(safe_structured) if safe_structured else None,
            department=_extract_department(safe_structured)
            if safe_structured
            else None,
        )
        db.add(record)

    await db.flush()

    if conversation_history is not None:
        await db.execute(
            delete(ConversationTurn).where(ConversationTurn.session_id == session_uuid)
        )
        for idx, turn in enumerate(conversation_history):
            new_turn = ConversationTurn(
                session_id=session_uuid,
                turn_index=idx,
                role=turn.get("role", "unknown"),
                content=turn.get("content", ""),
            )
            db.add(new_turn)

    await db.commit()
    await db.refresh(record, ["conversation_turns"])

    # Bust cache so sidebar sees fresh data immediately
    await invalidate_pattern(f"jds:employee:{employee_id}")

    try:
        if safe_structured:
            await _harvest_organic_skills(db, safe_structured, session_id, employee_id)
            await db.commit()
    except Exception as e:
        import traceback
        traceback.print_exc()
        logger.error(f"[CRUD] Failed to harvest skills: {e}")

    return record


async def update_questionnaire_jd(
    db: AsyncSession,
    jd_id: str,
    jd_text: str,
    jd_structured: dict,
    employee_id: str,
) -> Optional[JDSession]:
    session_uuid = _safe_uuid(jd_id)
    result = await db.execute(select(JDSession).where(JDSession.id == session_uuid))
    record = result.scalar_one_or_none()
    if not record:
        return None
    if record.employee_id != employee_id:
        from app.models.user_model import Employee

        editor_res = await db.execute(
            select(Employee).where(Employee.id == employee_id)
        )
        editor = editor_res.scalar_one_or_none()
        creator_res = await db.execute(
            select(Employee).where(Employee.id == record.employee_id)
        )
        creator = creator_res.scalar_one_or_none()

        is_manager = (
            editor
            and creator
            and editor.role == "manager"
            and creator.reporting_manager_code == editor.id
        )
        is_hr = editor and editor.role == "hr"

        if not is_manager and not is_hr:
            raise PermissionError(
                "You can only edit your own JDs, or JDs submitted to you."
            )

    from app.services.jd_service import build_markdown_from_structured

    safe_structured = _safe_jsonb(jd_structured)

    # If jd_text is empty or not provided, reconstruct it from structured data
    # This keeps the 'View' and 'Edit' modes in sync.
    if not jd_text:
        jd_text = build_markdown_from_structured(safe_structured)

    if record.jd_text:
        old_version = JDVersion(
            session_id=session_uuid,
            version=record.version,
            jd_text=record.jd_text,
            jd_structured=record.jd_structured,
            created_by=employee_id,
        )
        db.add(old_version)

    record.jd_text = jd_text
    record.jd_structured = safe_structured
    record.version = (record.version or 1) + 1

    title = _extract_title(safe_structured)
    if title:
        record.title = title
    department = _extract_department(safe_structured)
    if department:
        record.department = department

    await db.commit()
    await db.refresh(record)

    await invalidate_pattern(f"jds:employee:{record.employee_id}")

    logger.info(f"✅ JD updated — id={record.id}, new version={record.version}")
    return record


async def update_questionnaire_status(
    db: AsyncSession,
    jd_id: str,
    new_status: str,
    employee_id: str,
) -> Optional[JDSession]:
    session_uuid = _safe_uuid(jd_id)
    result = await db.execute(select(JDSession).where(JDSession.id == session_uuid))
    record = result.scalar_one_or_none()
    if not record:
        return None
    if record.employee_id != employee_id:
        from app.models.user_model import Employee

        editor_res = await db.execute(
            select(Employee).where(Employee.id == employee_id)
        )
        editor = editor_res.scalar_one_or_none()
        creator_res = await db.execute(
            select(Employee).where(Employee.id == record.employee_id)
        )
        creator = creator_res.scalar_one_or_none()

        is_manager = (
            editor
            and creator
            and editor.role == "manager"
            and creator.reporting_manager_code == editor.id
        )
        is_hr = editor and editor.role == "hr"
        is_owner_submitting = record.employee_id == employee_id

        if not is_manager and not is_hr and not is_owner_submitting:
            raise PermissionError(
                "You can only update status of your own JDs, or JDs submitted to you."
            )

    record.status = new_status
    await db.commit()
    await db.refresh(record)

    if new_status == "approved":
        _trigger_rag_indexing(record)

    await invalidate_pattern(f"jds:employee:{record.employee_id}")

    logger.info(f"✅ JD status updated — id={record.id}, status={record.status}")
    return record


# ── Read Queries ──────────────────────────────────────────────────────────────


async def get_questionnaire(db: AsyncSession, session_id: str) -> Optional[JDSession]:
    session_uuid = _safe_uuid(session_id)
    result = await db.execute(
        select(JDSession)
        .where(JDSession.id == session_uuid)
        .options(selectinload(JDSession.conversation_turns))
    )
    return result.scalar_one_or_none()


async def list_questionnaires(
    db: AsyncSession, status_in: Optional[list[str]] = None
) -> list[JDSession]:
    query = select(JDSession)
    if status_in:
        query = query.where(JDSession.status.in_(status_in))
    result = await db.execute(query.order_by(JDSession.updated_at.desc()))
    return list(result.scalars().all())


async def approve_questionnaire(
    db: AsyncSession,
    jd_id: str,
    reviewed_by: str = "HR Manager",
) -> Optional[JDSession]:
    session_uuid = _safe_uuid(jd_id)
    result = await db.execute(select(JDSession).where(JDSession.id == session_uuid))
    record = result.scalar_one_or_none()
    if not record:
        return None

    record.status = "approved"
    record.reviewed_by = reviewed_by
    record.reviewed_at = _now().replace(tzinfo=None)
    record.reviewer_comment = None

    await db.commit()
    await db.refresh(record)

    _trigger_rag_indexing(record)

    await invalidate_pattern(f"jds:employee:{record.employee_id}")
    return record


async def reject_questionnaire(
    db: AsyncSession,
    jd_id: str,
    comment: str,
    reviewed_by: str = "HR Manager",
) -> Optional[JDSession]:
    session_uuid = _safe_uuid(jd_id)
    result = await db.execute(select(JDSession).where(JDSession.id == session_uuid))
    record = result.scalar_one_or_none()
    if not record:
        return None

    record.status = "rejected"
    record.reviewed_by = reviewed_by
    record.reviewed_at = _now().replace(tzinfo=None)
    record.reviewer_comment = comment

    await db.commit()
    await db.refresh(record)

    await invalidate_pattern(f"jds:employee:{record.employee_id}")
    return record


async def list_questionnaires_by_employee(
    db: AsyncSession,
    employee_id: str,
) -> list[JDSession]:
    # Check cache first
    cache_key = f"jds:employee:{employee_id}"
    cached = await get_cache(cache_key)
    if cached is not None:
        return cached  # already serialised list from cache

    result = await db.execute(
        select(JDSession)
        .where(JDSession.employee_id == employee_id)
        .order_by(JDSession.updated_at.desc())
    )
    records = list(result.scalars().all())

    # Serialise for cache (only lightweight list fields)
    serialised = [
        {
            "id": str(r.id),
            "employee_id": r.employee_id,
            "title": r.title,
            "status": r.status,
            "version": r.version,
            "created_at": r.created_at.isoformat() if r.created_at else None,
            "updated_at": r.updated_at.isoformat() if r.updated_at else None,
        }
        for r in records
    ]
    await set_cache(cache_key, serialised, ttl=60)
    return serialised


async def list_manager_pending_jds(
    db: AsyncSession, manager_id: str
) -> list[JDSession]:
    from app.models.user_model import Employee

    result = await db.execute(
        select(JDSession)
        .join(Employee, JDSession.employee_id == Employee.id)
        .where(
            (Employee.reporting_manager_code == manager_id)
            & (
                JDSession.status.in_(
                    [
                        "sent_to_manager",
                        "manager_rejected",
                        "sent_to_hr",
                        "hr_rejected",
                        "approved",
                    ]
                )
            )
        )
        .order_by(JDSession.updated_at.desc())
    )
    return list(result.scalars().all())


async def list_hr_pending_jds(db: AsyncSession) -> list[JDSession]:
    result = await db.execute(
        select(JDSession)
        .where(JDSession.status.in_(["sent_to_hr", "hr_rejected", "approved"]))
        .order_by(JDSession.updated_at.desc())
    )
    return list(result.scalars().all())


async def delete_questionnaire(
    db: AsyncSession,
    jd_id: str,
    employee_id: str,
) -> bool:
    session_uuid = _safe_uuid(jd_id)
    result = await db.execute(select(JDSession).where(JDSession.id == session_uuid))
    record = result.scalar_one_or_none()
    if not record:
        return False
    if record.employee_id != employee_id:
        raise PermissionError("You can only delete your own JDs")

    await db.delete(record)
    await db.commit()

    await invalidate_pattern(f"jds:employee:{employee_id}")

    logger.info(f"🗑️ JD deleted — id={record.id}")
    return True


# ── Review Comment CRUD (N+1 fixed — single JOIN queries) ────────────────────


async def create_review_comment(
    db: AsyncSession,
    jd_session_id: str,
    reviewer_id: str,
    target_role: str,
    action: str,
    comment: Optional[str] = None,
) -> "JDReviewComment":  # noqa: F821
    from app.models.review_comment_model import JDReviewComment

    session_uuid = _safe_uuid(jd_session_id)
    review = JDReviewComment(
        jd_session_id=session_uuid,
        reviewer_id=reviewer_id,
        target_role=target_role,
        action=action,
        comment=comment,
        is_read=False,
    )
    db.add(review)

    result = await db.execute(select(JDSession).where(JDSession.id == session_uuid))
    record = result.scalar_one_or_none()
    if record:
        record.reviewed_by = reviewer_id
        record.reviewer_comment = comment
        record.reviewed_at = _now().replace(tzinfo=None)

        if action in ["rejected", "revision_requested"]:
            from app.models.user_model import Employee
            reviewer_res = await db.execute(
                select(Employee).where(Employee.id == reviewer_id)
            )
            reviewer = reviewer_res.scalar_one_or_none()
            
            # If rejected by HR, status is hr_rejected.
            # Otherwise (Manager/Head), status is manager_rejected.
            if reviewer and reviewer.role == "hr":
                record.status = "hr_rejected"
            else:
                record.status = "manager_rejected"
        elif action == "approved":
            record.status = "approved"
            _trigger_rag_indexing(record)

    await db.commit()
    await db.refresh(review)

    # Invalidate feedback caches for affected employee
    if record:
        await invalidate_pattern(f"feedback:unread:{record.employee_id}:*")
        await invalidate_pattern(f"jds:employee:{record.employee_id}")

    print(
        f"📝 Review comment created — jd={jd_session_id}, action={action}, target={target_role}"
    )
    return review


async def get_review_comments_for_jd(
    db: AsyncSession,
    jd_session_id: str,
) -> list:
    """
    FIXED: Was N+1 (one Employee query per comment).
    Now: single JOIN fetches everything in one round-trip.
    """
    from app.models.review_comment_model import JDReviewComment
    from app.models.user_model import Employee

    session_uuid = _safe_uuid(jd_session_id)
    result = await db.execute(
        select(JDReviewComment, Employee)
        .outerjoin(Employee, JDReviewComment.reviewer_id == Employee.id)
        .where(JDReviewComment.jd_session_id == session_uuid)
        .order_by(JDReviewComment.created_at.desc())
    )
    rows = result.all()

    return [
        {
            "id": str(c.id),
            "jd_session_id": str(c.jd_session_id),
            "reviewer_id": c.reviewer_id,
            "reviewer_name": reviewer.name if reviewer else "Unknown",
            "reviewer_role": reviewer.role if reviewer else "unknown",
            "target_role": c.target_role,
            "action": c.action,
            "comment": c.comment,
            "is_read": c.is_read,
            "created_at": c.created_at.isoformat() if c.created_at else None,
        }
        for c, reviewer in rows
    ]


async def get_unread_feedback_for_user(
    db: AsyncSession,
    employee_id: str,
    user_role: str,
) -> list:
    """
    FIXED: Was N+1. Now uses single JOIN per role branch.
    Also cached for 60 seconds — sidebar polls this frequently.
    """
    cache_key = f"feedback:unread:{employee_id}:{user_role}"
    cached = await get_cache(cache_key)
    if cached is not None:
        return cached

    from app.models.review_comment_model import JDReviewComment
    from app.models.user_model import Employee

    if user_role == "employee":
        result = await db.execute(
            select(JDReviewComment, JDSession, Employee)
            .join(JDSession, JDReviewComment.jd_session_id == JDSession.id)
            .outerjoin(Employee, JDReviewComment.reviewer_id == Employee.id)
            .where(
                (JDSession.employee_id == employee_id)
                & (JDReviewComment.target_role == "employee")
                & (not JDReviewComment.is_read)
            )
            .order_by(JDReviewComment.created_at.desc())
        )
    elif user_role in ["manager", "head"]:
        result = await db.execute(
            select(JDReviewComment, JDSession, Employee)
            .join(JDSession, JDReviewComment.jd_session_id == JDSession.id)
            .join(Employee, JDSession.employee_id == Employee.id)
            .where(
                (JDReviewComment.target_role == "manager")
                & (
                    (Employee.reporting_manager_code == employee_id)
                    | (JDSession.employee_id == employee_id)
                )
                & (not JDReviewComment.is_read)
            )
            .order_by(JDReviewComment.created_at.desc())
        )
    else:
        return []

    rows = result.all()

    serialized = []
    for c, jd, reviewer in rows:
        serialized.append(
            {
                "id": str(c.id),
                "jd_session_id": str(c.jd_session_id),
                "jd_title": jd.title if jd else "Untitled JD",
                "reviewer_name": reviewer.name if reviewer else "Unknown",
                "reviewer_role": reviewer.role if reviewer else "unknown",
                "action": c.action,
                "comment": c.comment,
                "is_read": c.is_read,
                "created_at": c.created_at.isoformat() if c.created_at else None,
            }
        )

    await set_cache(cache_key, serialized, ttl=60)
    return serialized


async def get_all_feedback_for_user(
    db: AsyncSession,
    employee_id: str,
    user_role: str,
) -> list:
    from app.models.review_comment_model import JDReviewComment
    from app.models.user_model import Employee
    from sqlalchemy.orm import aliased

    if user_role == "employee":
        # Use aliased so SQLAlchemy can distinguish the two Employee joins
        EmpReviewer = aliased(Employee, name="emp_reviewer")
        EmpOwner = aliased(Employee, name="emp_owner")

        result = await db.execute(
            select(JDReviewComment, JDSession, EmpReviewer, EmpOwner)
            .join(JDSession, JDReviewComment.jd_session_id == JDSession.id)
            .outerjoin(EmpReviewer, JDReviewComment.reviewer_id == EmpReviewer.id)
            .outerjoin(EmpOwner, JDSession.employee_id == EmpOwner.id)
            .where(
                # If I own the JD, I see ALL feedback for it
                (JDSession.employee_id == employee_id)
                # OR if it was specifically targeted at the employee role and it's my JD
                | ((JDSession.employee_id == employee_id) & (JDReviewComment.target_role == "employee"))
            )
            .order_by(JDReviewComment.created_at.desc())
        )
        rows = result.all()

        serialized = []
        for row in rows:
            c, jd, reviewer, owner = row[0], row[1], row[2], row[3]
            serialized.append(
                {
                    "id": str(c.id),
                    "jd_session_id": str(c.jd_session_id),
                    "jd_title": jd.title if jd else "Untitled JD",
                    "jd_status": jd.status if jd else "unknown",
                    "jd_employee_name": owner.name if owner else "Unknown",
                    "jd_department": owner.department if owner else "",
                    "reviewer_name": reviewer.name if reviewer else "Unknown User",
                    "reviewer_role": reviewer.role if reviewer else "unknown",
                    "target_role": c.target_role,
                    "action": c.action,
                    "comment": c.comment,
                    "is_read": c.is_read,
                    "created_at": c.created_at.isoformat() if c.created_at else None,
                }
            )
        return serialized

    elif user_role in ["manager", "head"]:
        EmpCreator = Employee.__class__  # alias not needed; use a labeled join below
        from sqlalchemy.orm import aliased

        EmpCreator = aliased(Employee, name="emp_creator")
        EmpReviewer = aliased(Employee, name="emp_reviewer")

        result = await db.execute(
            select(JDReviewComment, JDSession, EmpCreator, EmpReviewer)
            .join(JDSession, JDReviewComment.jd_session_id == JDSession.id)
            .outerjoin(EmpCreator, JDSession.employee_id == EmpCreator.id)
            .outerjoin(EmpReviewer, JDReviewComment.reviewer_id == EmpReviewer.id)
            .where(
                # I see feedback for JDs I own
                (JDSession.employee_id == employee_id)
                # OR feedback targeted at managers for my team members
                | ((EmpCreator.reporting_manager_code == employee_id) & (JDReviewComment.target_role == "manager"))
            )
            .order_by(JDReviewComment.created_at.desc())
        )
        rows = result.all()

        return [
            {
                "id": str(c.id),
                "jd_session_id": str(c.jd_session_id),
                "jd_title": jd.title if jd else "Untitled JD",
                "jd_status": jd.status if jd else "unknown",
                "jd_employee_name": creator.name if creator else "Unknown",
                "jd_department": creator.department if creator else "",
                "reviewer_name": reviewer.name if reviewer else "Unknown User",
                "reviewer_role": reviewer.role if reviewer else "unknown",
                "target_role": c.target_role,
                "action": c.action,
                "comment": c.comment,
                "is_read": c.is_read,
                "created_at": c.created_at.isoformat() if c.created_at else None,
            }
            for c, jd, creator, reviewer in rows
        ]

    elif user_role == "hr":
        from sqlalchemy.orm import aliased

        EmpCreator = aliased(Employee, name="emp_creator")
        EmpReviewer = aliased(Employee, name="emp_reviewer")

        result = await db.execute(
            select(JDReviewComment, JDSession, EmpCreator, EmpReviewer)
            .join(JDSession, JDReviewComment.jd_session_id == JDSession.id)
            .outerjoin(EmpCreator, JDSession.employee_id == EmpCreator.id)
            .outerjoin(EmpReviewer, JDReviewComment.reviewer_id == EmpReviewer.id)
            .where(
                (JDReviewComment.reviewer_id == employee_id)
                | (JDSession.employee_id == employee_id)
            )
            .order_by(JDReviewComment.created_at.desc())
        )
        rows = result.all()

        return [
            {
                "id": str(c.id),
                "jd_session_id": str(c.jd_session_id),
                "jd_title": jd.title if jd else "Untitled JD",
                "jd_status": jd.status if jd else "unknown",
                "jd_employee_name": creator.name if creator else "Unknown",
                "jd_department": creator.department if creator else "",
                "reviewer_name": reviewer.name if reviewer else "Unknown User",
                "reviewer_role": reviewer.role if reviewer else "unknown",
                "target_role": c.target_role,
                "action": c.action,
                "comment": c.comment,
                "is_read": c.is_read,
                "created_at": c.created_at.isoformat() if c.created_at else None,
            }
            for c, jd, creator, reviewer in rows
        ]

    return []


async def mark_feedback_read(
    db: AsyncSession,
    comment_id: str,
) -> bool:
    from app.models.review_comment_model import JDReviewComment
    from app.models.user_model import Employee

    comment_uuid = _safe_uuid(comment_id)
    result = await db.execute(
        select(JDReviewComment, JDSession)
        .join(JDSession, JDReviewComment.jd_session_id == JDSession.id)
        .where(JDReviewComment.id == comment_uuid)
    )
    row = result.first()
    if not row:
        return False

    comment, jd = row
    comment.is_read = True
    await db.commit()

    if jd:
        # Invalidate employee's unread cache
        await invalidate_pattern(f"feedback:unread:{jd.employee_id}:*")

        # Also invalidate the manager's unread cache
        emp_result = await db.execute(
            select(Employee).where(Employee.id == jd.employee_id)
        )
        emp = emp_result.scalar_one_or_none()
        if emp and emp.reporting_manager_code:
            await invalidate_pattern(f"feedback:unread:{emp.reporting_manager_code}:*")

    return True
