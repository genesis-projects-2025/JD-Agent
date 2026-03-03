# app/crud/jd_crud.py
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, delete
from sqlalchemy.orm import selectinload
from app.models.jd_session_model import JDSession, ConversationTurn, JDVersion
from typing import Optional, List
import datetime
import json
import uuid
from sqlalchemy.exc import IntegrityError
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy import text
from app.models.taxonomy_model import Skill, JDSessionSkill, EmployeeSkill


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
    emp_info = jd_structured.get("employee_information", {})
    if isinstance(emp_info, dict):
        dept = emp_info.get("department")
        if dept and isinstance(dept, str) and len(dept) < 200:
            return dept.strip()
    return None


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


def _safe_uuid(val: str) -> uuid.UUID:
    if isinstance(val, uuid.UUID):
        return val
    return uuid.UUID(val)


async def _harvest_organic_skills(db: AsyncSession, jd_structured: dict, session_id: str, employee_id: str):
    """
    Harvests verified skills & tools from the structured JD and saves them
    into the fully relational Skill, JDSessionSkill, and EmployeeSkill tables.
    """
    if not jd_structured or not session_id or not employee_id:
        return

    req_skills = jd_structured.get("required_skills", [])
    tools = jd_structured.get("tools_and_technologies", [])
    
    # Combine and normalize
    all_skills = set()
    for s in (req_skills + tools):
        if isinstance(s, str) and s.strip():
            all_skills.add(s.strip())
            
    if not all_skills:
        return

    session_uuid = _safe_uuid(session_id)

    for skill_name in all_skills:
        # 1. Upsert into Master Skill Table
        skill_stmt = insert(Skill).values(name=skill_name)
        skill_stmt = skill_stmt.on_conflict_do_update(
            index_elements=['name'],
            set_=dict(name=skill_name) # Dummy update to return the ID
        ).returning(Skill.id)
        
        result = await db.execute(skill_stmt)
        skill_id = result.scalar()
        
        # Fallback if returning didn't work (e.g. some dialects on conflict do nothing)
        if not skill_id:
            res = await db.execute(select(Skill.id).where(Skill.name == skill_name))
            skill_id = res.scalar()
            
        if not skill_id:
            continue
            
        # 2. Upsert into JDSessionSkill
        sess_stmt = insert(JDSessionSkill).values(
            session_id=session_uuid,
            skill_id=skill_id
        ).on_conflict_do_nothing()
        await db.execute(sess_stmt)
        
        # 3. Upsert into EmployeeSkill
        emp_stmt = insert(EmployeeSkill).values(
            employee_id=employee_id,
            skill_id=skill_id,
            source="jd_interview"
        ).on_conflict_do_nothing()
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
    
    # 1. Update Employee Name if found in insights (and currently "Unknown" or random)
    emp_name_from_insights = safe_insights.get("identity_context", {}).get("employee_name")
    if emp_name_from_insights:
        from app.models.user_model import Employee
        emp_res = await db.execute(select(Employee).where(Employee.id == employee_id))
        emp = emp_res.scalar_one_or_none()
        if emp and (not emp.name or emp.name == "Unknown Employee" or "Employee AI" in emp.name):
            emp.name = emp_name_from_insights

    if record:
        if jd_text:
            # 2. Automatically create JD Version backup if updating an existing JD
            if record.jd_text and jd_text != record.jd_text:
                old_version = JDVersion(
                    session_id=session_uuid,
                    version=record.version or 1,
                    jd_text=record.jd_text,
                    jd_structured=record.jd_structured,
                    created_by=record.employee_id
                )
                db.add(old_version)
                record.version = (record.version or 1) + 1

            record.jd_text = jd_text
        if safe_structured:
            record.jd_structured = safe_structured

        record.insights = safe_insights
        record.conversation_state = safe_progress

        if status:
            # ONLY update status if the record is brand new, draft, or generated.
            # If it's already in review or rejected, keep that state so edits don't kick it out of the queue.
            if not record.status or record.status in ["draft", "collecting", "jd_generated"]:
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

    await db.flush() # ensure record is attached and flushed

    # Replace conversation turns if provided
    if conversation_history is not None:
        await db.execute(delete(ConversationTurn).where(ConversationTurn.session_id == session_uuid))
        for idx, turn in enumerate(conversation_history):
            new_turn = ConversationTurn(
                session_id=session_uuid,
                turn_index=idx,
                role=turn.get("role", "unknown"),
                content=turn.get("content", "")
            )
            db.add(new_turn)

    await db.commit()
    await db.refresh(record, ['conversation_turns', 'employee'])
    
    # Organically harvest the confirmed skills
    try:
        if safe_structured:
            await _harvest_organic_skills(db, safe_structured, session_id, employee_id)
            await db.commit()
    except Exception as e:
        import traceback
        traceback.print_exc()
        print(f"Failed to harvest skills: {e}")
        
    print(f"✅ JD saved — id={record.id}, employee={record.employee_id}, title={record.title}")
    return record


async def append_conversation_turn(
    db: AsyncSession,
    session_id: str,
    role: str,
    content: str,
) -> Optional[JDSession]:
    session_uuid = _safe_uuid(session_id)
    result = await db.execute(
        select(JDSession).where(JDSession.id == session_uuid)
    )
    record = result.scalar_one_or_none()
    if not record:
        return None

    # Find the next index
    turns_count_res = await db.execute(
        select(func.count(ConversationTurn.id)).where(ConversationTurn.session_id == session_uuid)
    )
    next_index = turns_count_res.scalar() or 0

    new_turn = ConversationTurn(
        session_id=session_uuid,
        turn_index=next_index,
        role=role,
        content=content
    )
    db.add(new_turn)
    # the trigger takes care of setting updated_at on jd_sessions
    await db.commit()
    return record


async def sync_session_to_db(
    db: AsyncSession,
    session_id: str,
    insights: dict,
    progress: dict,
    conversation_history: list,
    employee_id: str,
    employee_name: Optional[str] = None, # Left for backward compatibility in signature, name is handled via Employee logic now
    generated_jd: Optional[str] = None,
    jd_structured: Optional[dict] = None,
    status: Optional[str] = None,
) -> JDSession:
    
    session_uuid = _safe_uuid(session_id)
    result = await db.execute(
        select(JDSession).where(JDSession.id == session_uuid)
    )
    record = result.scalar_one_or_none()

    safe_insights = _safe_jsonb(insights)
    safe_progress = _safe_jsonb(progress)
    safe_structured = _safe_jsonb(jd_structured) if jd_structured else None

    # Update Employee Name from insights during sync so dashboard updates instantly
    emp_name_from_insights = safe_insights.get("identity_context", {}).get("employee_name")
    if emp_name_from_insights:
        from app.models.user_model import Employee
        emp_res = await db.execute(select(Employee).where(Employee.id == employee_id))
        emp = emp_res.scalar_one_or_none()
        if emp and (not emp.name or emp.name == "Unknown Employee" or "Employee AI" in emp.name):
            emp.name = emp_name_from_insights

    if record:
        record.insights = safe_insights
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
            department=_extract_department(safe_structured) if safe_structured else None
        )
        db.add(record)

    await db.flush()

    # Rebuilding conversation turns
    if conversation_history is not None:
        await db.execute(delete(ConversationTurn).where(ConversationTurn.session_id == session_uuid))
        for idx, turn in enumerate(conversation_history):
            new_turn = ConversationTurn(
                session_id=session_uuid,
                turn_index=idx,
                role=turn.get("role", "unknown"),
                content=turn.get("content", "")
            )
            db.add(new_turn)

    await db.commit()
    await db.refresh(record, ['conversation_turns'])

    # Organically harvest the confirmed skills
    try:
        if safe_structured:
            await _harvest_organic_skills(db, safe_structured, session_id, employee_id)
            await db.commit()
    except Exception as e:
        import traceback
        traceback.print_exc()
        print(f"Failed to harvest skills: {e}")

    return record


async def update_questionnaire_jd(
    db: AsyncSession,
    jd_id: str,
    jd_text: str,
    jd_structured: dict,
    employee_id: str,
) -> Optional[JDSession]:
    session_uuid = _safe_uuid(jd_id)
    result = await db.execute(
        select(JDSession).where(JDSession.id == session_uuid)
    )
    record = result.scalar_one_or_none()
    if not record:
        return None
    if record.employee_id != employee_id:
        from app.models.user_model import Employee
        editor_res = await db.execute(select(Employee).where(Employee.id == employee_id))
        editor = editor_res.scalar_one_or_none()
        creator_res = await db.execute(select(Employee).where(Employee.id == record.employee_id))
        creator = creator_res.scalar_one_or_none()
        
        is_manager = editor and creator and editor.role == "manager" and creator.reporting_manager_code == editor.id
        is_hr = editor and editor.role == "hr"
        
        if not is_manager and not is_hr:
            raise PermissionError("You can only edit your own JDs, or JDs submitted to you.")

    safe_structured = _safe_jsonb(jd_structured)

    # Backup the old version first
    if record.jd_text:
        old_version = JDVersion(
            session_id=session_uuid,
            version=record.version,
            jd_text=record.jd_text,
            jd_structured=record.jd_structured,
            created_by=employee_id
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
    print(f"✅ JD updated — id={record.id}, new version={record.version}")
    return record


async def update_questionnaire_status(
    db: AsyncSession,
    jd_id: str,
    new_status: str,
    employee_id: str,
) -> Optional[JDSession]:
    session_uuid = _safe_uuid(jd_id)
    result = await db.execute(
        select(JDSession).where(JDSession.id == session_uuid)
    )
    record = result.scalar_one_or_none()
    if not record:
        return None
    if record.employee_id != employee_id:
        from app.models.user_model import Employee
        editor_res = await db.execute(select(Employee).where(Employee.id == employee_id))
        editor = editor_res.scalar_one_or_none()
        creator_res = await db.execute(select(Employee).where(Employee.id == record.employee_id))
        creator = creator_res.scalar_one_or_none()
        
        is_manager = editor and creator and editor.role == "manager" and creator.reporting_manager_code == editor.id
        is_hr = editor and editor.role == "hr"
        
        # Exception: employee submitting their own form
        is_owner_submitting = (record.employee_id == employee_id)
        
        if not is_manager and not is_hr and not is_owner_submitting:
            raise PermissionError("You can only update status of your own JDs, or JDs submitted to you.")

    record.status = new_status
    await db.commit()
    await db.refresh(record)
    print(f"✅ JD status updated — id={record.id}, status={record.status}")
    return record


# ── Read Queries ──────────────────────────────────────────────────────────────

async def get_questionnaire(
    db: AsyncSession,
    session_id: str
) -> Optional[JDSession]:
    session_uuid = _safe_uuid(session_id)
    result = await db.execute(
        select(JDSession)
        .where(JDSession.id == session_uuid)
        .options(selectinload(JDSession.conversation_turns))
    )
    return result.scalar_one_or_none()


async def list_questionnaires(db: AsyncSession) -> list[JDSession]:
    result = await db.execute(
        select(JDSession).order_by(JDSession.updated_at.desc())
    )
    return list(result.scalars().all())


async def approve_questionnaire(
    db: AsyncSession,
    jd_id: str,
    reviewed_by: str = "HR Manager",
) -> Optional[JDSession]:
    session_uuid = _safe_uuid(jd_id)
    result = await db.execute(
        select(JDSession).where(JDSession.id == session_uuid)
    )
    record = result.scalar_one_or_none()
    if not record:
        return None

    record.status = "approved"
    record.reviewed_by = reviewed_by
    record.reviewed_at = _now().replace(tzinfo=None) # Keep without tz if db wants naive
    record.reviewer_comment = None

    await db.commit()
    await db.refresh(record)
    return record


async def reject_questionnaire(
    db: AsyncSession,
    jd_id: str,
    comment: str,
    reviewed_by: str = "HR Manager",
) -> Optional[JDSession]:
    session_uuid = _safe_uuid(jd_id)
    result = await db.execute(
        select(JDSession).where(JDSession.id == session_uuid)
    )
    record = result.scalar_one_or_none()
    if not record:
        return None
    
    record.status = "rejected"
    record.reviewed_by = reviewed_by
    record.reviewed_at = _now().replace(tzinfo=None)
    record.reviewer_comment = comment
    
    await db.commit()
    await db.refresh(record)
    return record


async def list_questionnaires_by_employee(
    db: AsyncSession,
    employee_id: str,
) -> list[JDSession]:
    result = await db.execute(
        select(JDSession)
        .where(JDSession.employee_id == employee_id)
        .order_by(JDSession.updated_at.desc())
    )
    return list(result.scalars().all())

async def list_manager_pending_jds(db: AsyncSession, manager_id: str) -> list[JDSession]:
    # Managers see all JDs from their reports that are beyond the initial drafting stage
    from app.models.user_model import Employee
    result = await db.execute(
        select(JDSession)
        .join(Employee, JDSession.employee_id == Employee.id)
        .where(
            (Employee.reporting_manager_code == manager_id) &
            (JDSession.status.in_([
                "sent_to_manager", 
                "manager_rejected", 
                "sent_to_hr", 
                "hr_rejected", 
                "approved"
            ]))
        )
        .order_by(JDSession.updated_at.desc())
    )
    records = list(result.scalars().all())
    return records

async def list_hr_pending_jds(db: AsyncSession) -> list[JDSession]:
    # HR sees all 'sent_to_hr', 'hr_rejected', and 'approved' JDs
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
    result = await db.execute(
        select(JDSession).where(JDSession.id == session_uuid)
    )
    record = result.scalar_one_or_none()
    if not record:
        return False
    if record.employee_id != employee_id:
        raise PermissionError("You can only delete your own JDs")

    await db.delete(record)
    await db.commit()
    print(f"🗑️ JD deleted — id={record.id}")
    return True