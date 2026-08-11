# scratch/inspect_constraints.py
import asyncio
from sqlalchemy import text
from app.core.database import AsyncSessionLocal

async def main():
    print("=== Inspecting Indexes and Constraints on jd_sessions ===")
    async with AsyncSessionLocal() as session:
        res = await session.execute(
            text("""
                SELECT 
                    indexname, 
                    indexdef 
                FROM pg_indexes 
                WHERE tablename = 'jd_sessions';
            """)
        )
        indexes = res.mappings().all()
        for idx in indexes:
            print(f"Index: {idx['indexname']}")
            print(f"Def: {idx['indexdef']}")
            print("-" * 50)
            
        print("\n=== Inspecting Triggers on reference_jds or jd_sessions ===")
        res_trig = await session.execute(
            text("""
                SELECT 
                    trigger_name, 
                    event_manipulation, 
                    event_object_table, 
                    action_statement 
                FROM information_schema.triggers
                WHERE event_object_table IN ('reference_jds', 'jd_sessions');
            """)
        )
        triggers = res_trig.mappings().all()
        for t in triggers:
            print(f"Trigger: {t['trigger_name']} on {t['event_object_table']}")
            print(f"Event: {t['event_manipulation']}")
            print(f"Action: {t['action_statement']}")
            print("-" * 50)

if __name__ == "__main__":
    asyncio.run(main())
