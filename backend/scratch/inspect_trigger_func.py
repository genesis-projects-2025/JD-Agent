# scratch/inspect_trigger_func.py
import asyncio
from sqlalchemy import text
from app.core.database import AsyncSessionLocal

async def main():
    print("=== Fetching PL/pgSQL Trigger Functions ===")
    async with AsyncSessionLocal() as session:
        res = await session.execute(
            text("""
                SELECT 
                    proname, 
                    prosrc 
                FROM pg_proc 
                WHERE proname IN ('sync_reference_to_jd_session', 'sync_jd_session_to_reference');
            """)
        )
        funcs = res.mappings().all()
        for f in funcs:
            print(f"Function: {f['proname']}")
            print("Source:")
            print(f["prosrc"])
            print("=" * 80)

if __name__ == "__main__":
    asyncio.run(main())
