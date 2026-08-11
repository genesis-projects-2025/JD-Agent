# scratch/check_locks.py
import asyncio
from sqlalchemy import text
from app.core.database import AsyncSessionLocal

async def main():
    print("=== Checking PostgreSQL Locks & Blocked Queries ===")
    async with AsyncSessionLocal() as session:
        res = await session.execute(
            text("""
                SELECT 
                    pid, 
                    age(clock_timestamp(), query_start), 
                    usename, 
                    state, 
                    backend_type,
                    query 
                FROM pg_stat_activity 
                WHERE query NOT LIKE '%pg_stat_activity%' 
                AND state != 'idle'
                ORDER BY age DESC;
            """)
        )
        active = res.mappings().all()
        print(f"Active Queries: {len(active)}")
        for q in active:
            print(f"PID: {q['pid']} | Age: {q['age']} | State: {q['state']} | Type: {q['backend_type']}")
            print(f"Query: {q['query'][:150]}")
            print("-" * 50)
            
        print("\n=== Checking Blocked/Blocking Queries ===")
        res_blocked = await session.execute(
            text("""
                SELECT
                    blocked_locks.pid     AS blocked_pid,
                    blocked_activity.usename  AS blocked_user,
                    blocking_locks.pid    AS blocking_pid,
                    blocking_activity.usename AS blocking_user,
                    blocked_activity.query    AS blocked_statement,
                    blocking_activity.query   AS blocking_statement
                FROM  pg_catalog.pg_locks         blocked_locks
                JOIN pg_catalog.pg_stat_activity blocked_activity ON blocked_activity.pid = blocked_locks.pid
                JOIN pg_catalog.pg_locks         blocking_locks 
                    ON blocking_locks.locktype = blocked_locks.locktype
                    AND blocking_locks.database IS NOT DISTINCT FROM blocked_locks.database
                    AND blocking_locks.relation IS NOT DISTINCT FROM blocked_locks.relation
                    AND blocking_locks.page IS NOT DISTINCT FROM blocked_locks.page
                    AND blocking_locks.tuple IS NOT DISTINCT FROM blocked_locks.tuple
                    AND blocking_locks.virtualxid IS NOT DISTINCT FROM blocked_locks.virtualxid
                    AND blocking_locks.transactionid IS NOT DISTINCT FROM blocked_locks.transactionid
                    AND blocking_locks.classid IS NOT DISTINCT FROM blocked_locks.classid
                    AND blocking_locks.objid IS NOT DISTINCT FROM blocked_locks.objid
                    AND blocking_locks.objsubid IS NOT DISTINCT FROM blocked_locks.objsubid
                    AND blocking_locks.pid != blocked_locks.pid
                JOIN pg_catalog.pg_stat_activity blocking_activity ON blocking_activity.pid = blocking_locks.pid
                WHERE NOT blocked_locks.granted;
            """)
        )
        blocked = res_blocked.mappings().all()
        print(f"Blocked queries: {len(blocked)}")
        for b in blocked:
            print(f"Blocked PID: {b['blocked_pid']} | Blocking PID: {b['blocking_pid']}")
            print(f"Blocked Query: {b['blocked_statement'][:100]}")
            print(f"Blocking Query: {b['blocking_statement'][:100]}")
            print("-" * 50)

if __name__ == "__main__":
    asyncio.run(main())
