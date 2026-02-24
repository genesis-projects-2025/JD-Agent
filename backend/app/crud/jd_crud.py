# app/crud/jd_crud.py
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from app.models.questionnaire_model import Questionnaire
from typing import Optional, List
import datetime
import json


# ── JSONB Safety Helpers ──────────────────────────────────────────────────────

def _safe_jsonb(value) -> dict:
    """
    Force any value into a plain JSON-safe dict for PostgreSQL JSONB columns.
    Handles: Pydantic models, nested objects, non-serializable types (datetime, enum).
    Always returns a dict — never None or a raw object.
    """
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


def _safe_jsonb_list(value) -> list:
    """
    Force any value into a plain JSON-safe list for PostgreSQL JSONB list columns.
    Used for conversation_history which is a list of dicts.
    """
    if value is None:
        return []
    if not isinstance(value, list):
        try:
            value = list(value)
        except Exception:
            return []
    try:
        return json.loads(json.dumps(value, default=str))
    except Exception:
        return []


# ── Helpers ───────────────────────────────────────────────────────────────────

def _extract_title(jd_structured: dict) -> Optional[str]:
    """
    Extract a clean job title from structured JD data.
    Never falls back to raw jd_text to avoid storing markdown as the title.
    """
    if not isinstance(jd_structured, dict):
        return None

    # Strategy 1: employee_information block (primary)
    emp_info = jd_structured.get("employee_information", {})
    if isinstance(emp_info, dict):
        title = (
            emp_info.get("job_title")
            or emp_info.get("title")
            or emp_info.get("role_title")
        )
        if title and isinstance(title, str) and len(title) < 200:
            return title.strip()

    # Strategy 2: top-level fields
    title = (
        jd_structured.get("job_title")
        or jd_structured.get("title")
        or jd_structured.get("role_title")
        or jd_structured.get("position")
    )
    if title and isinstance(title, str) and len(title) < 200:
        return title.strip()

    return None


def _now() -> datetime.datetime:
    return datetime.datetime.utcnow()


# ── Core Save / Upsert ───────────────────────────────────────────────────────

async def save_questionnaire_jd(
    db: AsyncSession,
    session_id: str,
    jd_text: str,
    jd_structured: dict,
    employee_insights: dict,
    progress: dict,
    employee_id: Optional[str] = None,
    employee_name: Optional[str] = None,
    conversation_history: Optional[list] = None,
    status: Optional[str] = None,
) -> Questionnaire:
    """
    Upsert a JD record by session_id.
    - session_id == Questionnaire.id  (one UUID per JD session)
    - Multiple sessions can share the same employee_id -> multiple JDs per employee
    """
    result = await db.execute(
        select(Questionnaire).where(Questionnaire.id == session_id)
    )
    record = result.scalar_one_or_none()

    # Resolve employee_id
    if not employee_id:
        identity = (employee_insights or {}).get("identity_context", {})
        employee_id = (
            identity.get("employee_name")
            or identity.get("employee_id")
            or session_id
        )

    safe_structured = _safe_jsonb(jd_structured)
    safe_insights = _safe_jsonb(employee_insights)
    safe_progress = _safe_jsonb(progress)
    safe_history = _safe_jsonb_list(conversation_history)

    title = _extract_title(safe_structured)

    # Resolve name: passed param → insights identity_context → keep existing
    resolved_name = (
        employee_name
        or safe_insights.get("identity_context", {}).get("employee_name")
        or safe_insights.get("identity_context", {}).get("name")
    )

    if record:
        if jd_text:
            record.generated_jd = jd_text
        if safe_structured:
            record.jd_structured = safe_structured

        record.responses = safe_insights
        record.conversation_state = safe_progress

        if status:
            record.status = status
        elif not record.status:
            record.status = "draft"

        if title:
            record.title = title

        if resolved_name:
            record.employee_name = resolved_name

        if conversation_history is not None:
            record.conversation_history = safe_history

        record.updated_at = _now()

    else:
        record = Questionnaire(
            id=session_id,
            employee_id=employee_id,
            employee_name=resolved_name,
            status=status or "draft",
            title=title or "New Strategic Role",
            conversation_state=safe_progress,
            responses=safe_insights,
            generated_jd=jd_text,
            jd_structured=safe_structured,
            conversation_history=safe_history,
        )
        db.add(record)

    await db.commit()
    await db.refresh(record)
    print(
        f"✅ JD saved — id={record.id}, employee={record.employee_id}, "
        f"title={record.title}, history_len={len(record.conversation_history or [])}"
    )
    return record


# ── Conversation History ──────────────────────────────────────────────────────

async def append_conversation_turn(
    db: AsyncSession,
    session_id: str,
    role: str,
    content: str,
) -> Optional[Questionnaire]:
    """Append a single turn to the stored conversation history."""
    result = await db.execute(
        select(Questionnaire).where(Questionnaire.id == session_id)
    )
    record = result.scalar_one_or_none()
    if not record:
        return None

    history: list = list(record.conversation_history or [])
    history.append({
        "role": role,
        "content": content,
        "timestamp": _now().isoformat(),
    })
    # FIX #2: _safe_jsonb_list prevents ROLLBACK from non-serializable content
    record.conversation_history = _safe_jsonb_list(history)
    record.updated_at = _now()

    await db.commit()
    await db.refresh(record)
    return record


async def sync_session_to_db(
    db: AsyncSession,
    session_id: str,
    insights: dict,
    progress: dict,
    conversation_history: list,
    employee_id: Optional[str] = None,
    employee_name: Optional[str] = None,
    generated_jd: Optional[str] = None,
    jd_structured: Optional[dict] = None,
    status: Optional[str] = None,
) -> Optional[Questionnaire]:
    """
    Lightweight sync after every chat turn.
    Creates a skeleton record if one doesn't exist yet.
    """
    result = await db.execute(
        select(Questionnaire).where(Questionnaire.id == session_id)
    )
    record = result.scalar_one_or_none()

    safe_insights = _safe_jsonb(insights)
    safe_progress = _safe_jsonb(progress)
    safe_history = _safe_jsonb_list(conversation_history)
    safe_structured = _safe_jsonb(jd_structured) if jd_structured else None

    # Resolve name: passed param → insights identity_context
    resolved_name = (
        employee_name
        or safe_insights.get("identity_context", {}).get("employee_name")
        or safe_insights.get("identity_context", {}).get("name")
    )

    if record:
        record.responses = safe_insights
        record.conversation_state = safe_progress
        record.conversation_history = safe_history

        if employee_id and record.employee_id == session_id:
            record.employee_id = employee_id

        if resolved_name:
            record.employee_name = resolved_name

        if generated_jd:
            record.generated_jd = generated_jd
        if safe_structured:
            record.jd_structured = safe_structured
        if status:
            record.status = status

        if not record.title and safe_structured:
            record.title = _extract_title(safe_structured)

        record.updated_at = _now()

    else:
        record = Questionnaire(
            id=session_id,
            employee_id=employee_id or session_id,
            employee_name=resolved_name,
            status=status or "collecting",
            responses=safe_insights,
            conversation_state=safe_progress,
            conversation_history=safe_history,
            generated_jd=generated_jd,
            jd_structured=safe_structured,
            title=_extract_title(safe_structured) if safe_structured else None,
        )
        db.add(record)

    await db.commit()
    await db.refresh(record)
    return record


# ── Update JD Content ─────────────────────────────────────────────────────────

async def update_questionnaire_jd(
    db: AsyncSession,
    jd_id: str,
    jd_text: str,
    jd_structured: dict,
    employee_id: str,
) -> Optional[Questionnaire]:
    """Update JD content and increment version. Validates ownership."""
    result = await db.execute(
        select(Questionnaire).where(Questionnaire.id == jd_id)
    )
    record = result.scalar_one_or_none()
    if not record:
        return None
    if record.employee_id != employee_id:
        raise PermissionError("You can only edit your own JDs")

    safe_structured = _safe_jsonb(jd_structured)  # FIX #2

    record.generated_jd = jd_text
    record.jd_structured = safe_structured
    record.version = (record.version or 1) + 1
    record.updated_at = _now()  # FIX #3

    title = _extract_title(safe_structured)
    if title:
        record.title = title

    await db.commit()
    await db.refresh(record)
    print(f"✅ JD updated — id={record.id}, version={record.version}")
    return record


# ── Update Status ─────────────────────────────────────────────────────────────

async def update_questionnaire_status(
    db: AsyncSession,
    jd_id: str,
    new_status: str,
    employee_id: str,
) -> Optional[Questionnaire]:
    """Update status. Validates ownership."""
    result = await db.execute(
        select(Questionnaire).where(Questionnaire.id == jd_id)
    )
    record = result.scalar_one_or_none()
    if not record:
        return None
    if record.employee_id != employee_id:
        raise PermissionError("You can only update status of your own JDs")

    record.status = new_status
    record.updated_at = _now()  # FIX #3
    await db.commit()
    await db.refresh(record)
    print(f"✅ JD status updated — id={record.id}, status={record.status}")
    return record


# ── Read Queries ──────────────────────────────────────────────────────────────

async def get_questionnaire(
    db: AsyncSession,
    session_id: str
) -> Optional[Questionnaire]:
    result = await db.execute(
        select(Questionnaire).where(Questionnaire.id == session_id)
    )
    return result.scalar_one_or_none()


async def list_questionnaires(db: AsyncSession) -> list[Questionnaire]:
    result = await db.execute(
        select(Questionnaire).order_by(Questionnaire.updated_at.desc())
    )
    return result.scalars().all()


async def approve_questionnaire(
    db: AsyncSession,
    jd_id: str,
    reviewed_by: str = "HR Manager",
) -> Optional[Questionnaire]:
    """Mark a JD as approved."""
    result = await db.execute(
        select(Questionnaire).where(Questionnaire.id == jd_id)
    )
    record = result.scalar_one_or_none()
    if not record:
        return None

    record.status = "approved"
    record.reviewed_by = reviewed_by
    record.reviewed_at = datetime.now(timezone.utc).replace(tzinfo=None)
    record.reviewer_comment = None

    await db.commit()
    await db.refresh(record)
    return record


async def reject_questionnaire(
    db: AsyncSession,
    jd_id: str,
    comment: str,
    reviewed_by: str = "HR Manager",
) -> Optional[Questionnaire]:
    """Return a JD for revision with a comment."""
    result = await db.execute(
        select(Questionnaire).where(Questionnaire.id == jd_id)
    )
    return result.scalars().all()


async def list_questionnaires_by_employee(
    db: AsyncSession,
    employee_id: str,
) -> list[Questionnaire]:
    """All JDs for one employee — most recently updated first."""
    result = await db.execute(
        select(Questionnaire)
        .where(Questionnaire.employee_id == employee_id)
        .order_by(Questionnaire.updated_at.desc())
    )
    return result.scalars().all()