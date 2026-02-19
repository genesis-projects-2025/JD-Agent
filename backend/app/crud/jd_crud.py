# app/crud/jd_crud.py
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.sql import func
from app.models.questionnaire_model import Questionnaire
from typing import Optional


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
    Uses session_id as the record ID.
    """
    result = await db.execute(
        select(Questionnaire).where(Questionnaire.id == session_id)
    )
    record = result.scalar_one_or_none()

    # Extract employee_id and title from insights/structured data
    identity = employee_insights.get("identity_context", {})
    employee_id = identity.get("employee_name", session_id)

    # Extract title from structured data
    title = None
    if isinstance(jd_structured, dict):
        emp_info = jd_structured.get("employee_information", {})
        if isinstance(emp_info, dict):
            title = emp_info.get("job_title") or emp_info.get("title") or emp_info.get("role_title")
        if not title:
            role_summary = jd_structured.get("role_summary", "")
            if isinstance(role_summary, dict):
                title = role_summary.get("title") or role_summary.get("job_title")

    if record:
        # Update existing record
        record.generated_jd = jd_text
        record.jd_structured = jd_structured
        record.responses = employee_insights
        record.conversation_state = progress
        record.status = "draft"
        if title:
            record.title = title
    else:
        # Create new record
        record = Questionnaire(
            id=session_id,
            employee_id=employee_id,
            status="draft",
            title=title,
            conversation_state=progress,
            responses=employee_insights,
            generated_jd=jd_text,
            jd_structured=jd_structured,
        )
        db.add(record)

    await db.commit()
    await db.refresh(record)
    print(f"✅ JD saved to DB — id={record.id}, employee={record.employee_id}, title={record.title}")
    return record


async def update_questionnaire_jd(
    db: AsyncSession,
    jd_id: str,
    jd_text: str,
    jd_structured: dict,
    employee_id: str,
) -> Optional[Questionnaire]:
    """
    Update an existing JD's content. Increments version.
    Validates employee ownership.
    """
    result = await db.execute(
        select(Questionnaire).where(Questionnaire.id == jd_id)
    )
    record = result.scalar_one_or_none()

    if not record:
        return None

    # Validate ownership
    if record.employee_id != employee_id:
        raise PermissionError("You can only edit your own JDs")

    # Update content
    record.generated_jd = jd_text
    record.jd_structured = jd_structured
    record.version = (record.version or 1) + 1
    # updated_at is handled by SQLAlchemy onupdate=func.now()

    # Extract title from structured data
    if isinstance(jd_structured, dict):
        emp_info = jd_structured.get("employee_information", {})
        if isinstance(emp_info, dict):
            title = emp_info.get("job_title") or emp_info.get("title") or emp_info.get("role_title")
            if title:
                record.title = title

    await db.commit()
    await db.refresh(record)
    print(f"✅ JD updated — id={record.id}, version={record.version}")
    return record


async def update_questionnaire_status(
    db: AsyncSession,
    jd_id: str,
    new_status: str,
    employee_id: str,
) -> Optional[Questionnaire]:
    """
    Update a JD's status. Validates employee ownership.
    """
    result = await db.execute(
        select(Questionnaire).where(Questionnaire.id == jd_id)
    )
    record = result.scalar_one_or_none()

    if not record:
        return None

    if record.employee_id != employee_id:
        raise PermissionError("You can only update status of your own JDs")

    record.status = new_status
    # updated_at is handled by SQLAlchemy onupdate=func.now()

    await db.commit()
    await db.refresh(record)
    print(f"✅ JD status updated — id={record.id}, status={record.status}")
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
        select(Questionnaire).order_by(Questionnaire.created_at.desc())
    )
    return result.scalars().all()


async def list_questionnaires_by_employee(
    db: AsyncSession,
    employee_id: str
) -> list[Questionnaire]:
    """List all JDs for a specific employee, ordered by most recently updated."""
    result = await db.execute(
        select(Questionnaire)
        .where(Questionnaire.employee_id == employee_id)
        .order_by(Questionnaire.updated_at.desc())
    )
    return result.scalars().all()