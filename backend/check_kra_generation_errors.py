import asyncio
from sqlalchemy import select
from app.core.database import AsyncSessionLocal
from app.models.kra_kpi_model import KRAKPISession

async def main():
    print("=== Scanning kra_kpi_sessions for Generation Errors ===")
    async with AsyncSessionLocal() as session:
        res = await session.execute(
            select(KRAKPISession).where(KRAKPISession.generation_error != None)
        )
        failures = res.scalars().all()
        
        print(f"Found {len(failures)} sessions with generation errors:\n")
        for f in failures:
            print(f"Employee ID: {f.employee_id} | Status: {f.status} | Step: {f.generation_step}")
            print(f"Error Message:\n{f.generation_error}")
            print("-" * 60)

if __name__ == "__main__":
    asyncio.run(main())
