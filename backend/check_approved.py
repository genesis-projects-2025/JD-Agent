import asyncio
from sqlalchemy import text
from app.core.database import AsyncSessionLocal

async def check():
    async with AsyncSessionLocal() as db:
        query = text("""
            SELECT id, employee_id, title, status, department, jd_structured 
            FROM jd_sessions 
            WHERE status = 'approved' 
            ORDER BY updated_at DESC LIMIT 5
        """)
        res = await db.execute(query)
        rows = res.mappings().all()
        if not rows:
            print("No approved JDs found in database.")
            return
            
        for row in rows:
            print(f"ID: {row.id}, Emp: {row.employee_id}, Title: {row.title}, Status: {row.status}, Dept: {row.department}")
            has_structured = "Yes" if row.jd_structured else "No"
            print(f"  Has Structured Data: {has_structured}")
            if row.jd_structured:
                print(f"  Keys: {list(row.jd_structured.keys())}")

if __name__ == "__main__":
    asyncio.run(check())
