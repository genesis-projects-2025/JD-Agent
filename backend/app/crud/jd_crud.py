# app/crud/jd_crud.py
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
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

    # Extract employee_id from insights
    identity = employee_insights.get("identity_context", {})
    employee_id = identity.get("employee_name", session_id)

    if record:
        # Update existing record
        record.generated_jd = jd_text
        record.jd_structured = jd_structured
        record.responses = employee_insights
        record.conversation_state = progress
        record.status = "jd_generated"
    else:
        # Create new record
        record = Questionnaire(
            id=session_id,
            employee_id=employee_id,
            status="jd_generated",
            conversation_state=progress,
            responses=employee_insights,
            generated_jd=jd_text,
            jd_structured=jd_structured,
        )
        db.add(record)

    await db.commit()
    await db.refresh(record)
    print(f"✅ JD saved to DB — id={record.id}, employee={record.employee_id}")
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