# app/crud/jd_crud.py
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from app.models.questionnaire_model import Questionnaire
from typing import Optional
from datetime import datetime, timezone
from datetime import datetime, timezone


async def save_questionnaire_jd(
    db: AsyncSession,
    session_id: str,
    jd_text: str,
    jd_structured: dict,
    employee_insights: dict,
    progress: dict,
) -> Questionnaire:
    """
    Save or update the JD for a questionnaire session.
    Extracts denormalized fields for fast frontend queries.
    """
    result = await db.execute(
        select(Questionnaire).where(Questionnaire.id == session_id)
    )
    record = result.scalar_one_or_none()

    # ── Extract denormalized fields from nested data ──────────────────
    identity = employee_insights.get("identity_context", {})
    employee_name = identity.get("employee_name") or session_id
    employee_id = identity.get("employee_id") or employee_name

    # role_title & department live in jd_structured_data.employee_information
    emp_info = jd_structured.get("employee_information", {})
    role_title = (
        emp_info.get("job_title")
        or emp_info.get("role_title")
        or jd_structured.get("role_title")
        or "Unknown Role"
    )
    department = (
        emp_info.get("department")
        or jd_structured.get("department")
        or "Unknown Department"
    )

    # completion comes from progress object
    completion_percentage = float(progress.get("completion_percentage", 100.0))

    if record:
        # Update existing record
        record.generated_jd = jd_text
        record.jd_structured = jd_structured
        record.responses = employee_insights
        record.conversation_state = progress
        record.status = "pending"           # submitted → awaiting HR approval
        record.employee_name = employee_name
        record.role_title = role_title
        record.department = department
        record.completion_percentage = completion_percentage
    else:
        # Create new record
        record = Questionnaire(
            id=session_id,
            employee_id=employee_id,
            employee_name=employee_name,
            role_title=role_title,
            department=department,
            status="pending",
            completion_percentage=completion_percentage,
            conversation_state=progress,
            responses=employee_insights,
            generated_jd=jd_text,
            jd_structured=jd_structured,
        )
        db.add(record)

    await db.commit()
    await db.refresh(record)
    print(f"✅ JD saved to DB — id={record.id}, employee={record.employee_name}, role={record.role_title}")
    return record


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
    record = result.scalar_one_or_none()
    if not record:
        return None

    record.status = "rejected"
    record.reviewer_comment = comment
    record.reviewed_by = reviewed_by
    record.reviewed_at = datetime.now(timezone.utc)

    await db.commit()
    await db.refresh(record)
    return record


async def get_dashboard_stats(db: AsyncSession) -> dict:
    """
    Compute real-time stats from the questionnaires table.
    """
    from sqlalchemy import case
    from datetime import datetime, timedelta, timezone

    now = datetime.now(timezone.utc)
    start_of_month = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    result = await db.execute(select(Questionnaire))
    all_records = result.scalars().all()

    total_jds = len(all_records)
    pending = sum(1 for r in all_records if r.status == "pending")
    in_progress = sum(1 for r in all_records if r.status == "in_progress")
    approved_this_month = sum(
        1 for r in all_records
        if r.status == "approved"
        and r.reviewed_at
        and r.reviewed_at.replace(tzinfo=timezone.utc) >= start_of_month
    )
    total_approved = sum(1 for r in all_records if r.status == "approved")
    approval_rate = round((total_approved / total_jds * 100) if total_jds > 0 else 0)

    # Avg completion time (minutes) from analytics inside conversation_state
    times = [
        r.conversation_state.get("analytics", {}).get("estimated_completion_time_minutes", 0)
        for r in all_records
        if r.conversation_state and r.conversation_state.get("analytics")
    ]
    avg_completion = round(sum(times) / len(times)) if times else 0

    return {
        "total_jds": total_jds,
        "pending_approvals": pending,
        "approved_this_month": approved_this_month,
        "in_progress": in_progress,
        "avg_completion_minutes": avg_completion,
        "approval_rate": approval_rate,
        "trend_total": 0,       # Can be computed vs previous month if needed
        "trend_approved": 0,
    }


async def get_recent_activity(db: AsyncSession, limit: int = 10) -> list[dict]:
    """
    Return the most recent status-change events as activity feed items.
    We use updated_at + status to synthesise activity events.
    """
    result = await db.execute(
        select(Questionnaire)
        .order_by(Questionnaire.updated_at.desc())
        .limit(limit)
    )
    records = result.scalars().all()

    activity = []
    for r in records:
        event_type = {
            "pending": "submitted",
            "approved": "approved",
            "rejected": "rejected",
            "in_progress": "created",
        }.get(r.status, "created")

        activity.append({
            "id": r.id,
            "type": event_type,
            "employee_name": r.employee_name or r.employee_id,
            "role_title": r.role_title or "Unknown Role",
            "timestamp": (r.updated_at or r.created_at).isoformat() if (r.updated_at or r.created_at) else "",
            "actor": r.reviewed_by or None,
        })

    return activity