"""
Fix existing records that have status='jd_generated' — 
remap them to 'pending' so the frontend can see and approve them.
Also fix role_title and department from jd_structured JSONB.

Run: .\venv\Scripts\python.exe fix_existing_records.py
"""
import asyncio
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy import select, text
from app.core.config import settings
from app.models.questionnaire_model import Questionnaire

engine = create_async_engine(settings.DATABASE_URL, echo=False)
AsyncSessionLocal = async_sessionmaker(bind=engine, expire_on_commit=False, class_=AsyncSession)


async def fix():
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Questionnaire))
        records = result.scalars().all()

        fixed = 0
        for r in records:
            changed = False

            # 1. Fix status: jd_generated → pending
            if r.status == "jd_generated":
                r.status = "pending"
                changed = True

            # 2. Fix role_title from jd_structured
            if (not r.role_title or r.role_title == "Unknown Role") and r.jd_structured:
                emp_info = r.jd_structured.get("employee_information", {})
                role = (
                    emp_info.get("job_title")
                    or emp_info.get("role_title")
                    or r.jd_structured.get("role_title")
                    or r.jd_structured.get("job_title")
                )
                if role:
                    r.role_title = role
                    changed = True

            # 3. Fix department from jd_structured
            if (not r.department or r.department == "Unknown Department") and r.jd_structured:
                emp_info = r.jd_structured.get("employee_information", {})
                dept = (
                    emp_info.get("department")
                    or r.jd_structured.get("department")
                )
                if dept:
                    r.department = dept
                    changed = True

            # 4. Fix employee_name from responses JSONB
            if (not r.employee_name or r.employee_name == r.employee_id) and r.responses:
                identity = r.responses.get("identity_context", {})
                name = identity.get("employee_name") or identity.get("full_name")
                if name:
                    r.employee_name = name
                    changed = True

            # 5. Fix completion_percentage from conversation_state
            if (not r.completion_percentage or r.completion_percentage == 0) and r.conversation_state:
                pct = r.conversation_state.get("completion_percentage", 0)
                if pct:
                    r.completion_percentage = float(pct)
                    changed = True

            if changed:
                fixed += 1
                print(f"  ✅ Fixed: {r.id[:8]}... | status={r.status} | role={r.role_title} | dept={r.department} | name={r.employee_name}")

        await db.commit()
        print(f"\n✅ Done. Fixed {fixed}/{len(records)} records.")

    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(fix())
