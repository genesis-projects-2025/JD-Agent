# scratch/kill_connections.py
import asyncio
from sqlalchemy import text
from app.core.database import AsyncSessionLocal

async def main():
    print("=== Terminating Idle/Stuck Connections ===")
    async with AsyncSessionLocal() as session:
        # Fetch PIDs of idle in transaction connections older than 15 seconds
        res = await session.execute(
            text("""
                SELECT pid, age(clock_timestamp(), query_start), state, query 
                FROM pg_stat_activity 
                WHERE (state = 'idle in transaction' AND age(clock_timestamp(), query_start) > interval '10 seconds')
                OR (state = 'active' AND age(clock_timestamp(), query_start) > interval '1 minute' AND query LIKE '%ALTER TABLE%')
                AND pid != pg_backend_pid();
            """)
        )
        stuck = res.mappings().all()
        print(f"Found {len(stuck)} stuck connections to terminate:")
        for s in stuck:
            pid = s["pid"]
            print(f"Terminating PID: {pid} | State: {s['state']} | Age: {s['age']}")
            print(f"Query: {s['query'][:100]}")
            # Terminate connection
            await session.execute(text("SELECT pg_terminate_backend(:pid)"), {"pid": pid})
            print(f"PID {pid} terminated successfully.")
            print("-" * 50)
            
    print("=== Termination Complete! ===")

if __name__ == "__main__":
    asyncio.run(main())
