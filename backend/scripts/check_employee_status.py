import asyncio
import sys
import json
from sqlalchemy.future import select
from app.core.database import AsyncSessionLocal
from app.models.jd_session_model import JDSession

async def check_employee(employee_id: str):
    print(f"\n🔍 Checking database records for Employee: {employee_id}...")
    
    async with AsyncSessionLocal() as db:
        # Find all sessions for this employee
        stmt = select(JDSession).where(JDSession.employee_id == employee_id).order_by(JDSession.updated_at.desc())
        result = await db.execute(stmt)
        sessions = result.scalars().all()
        
        if not sessions:
            print(f"❌ No records found for Employee ID: {employee_id}")
            return

        print(f"✅ Found {len(sessions)} JD sessions for this employee.\n")
        
        for i, s in enumerate(sessions):
            print(f"--- [Session {i+1}] {'(LATEST)' if i == 0 else ''} ---")
            print(f"ID:     {s.id}")
            print(f"Status: {s.status.upper()}")
            print(f"Role:   {s.title or 'N/A'} ({s.department or 'N/A'})")
            print(f"Updated: {s.updated_at}")
            
            # Check Insights (The "Brain" data)
            insights = s.insights or {}
            task_count = len(insights.get("tasks", []))
            tool_count = len(insights.get("tools", []))
            skill_count = len(insights.get("skills", []))
            workflow_count = len(insights.get("workflows", {}))

            print(f"\n📊 Data Progress:")
            print(f"  - Tasks:     {task_count}")
            print(f"  - Workflows: {workflow_count} (Deep Dives)")
            print(f"  - Tools:     {tool_count}")
            print(f"  - Skills:    {skill_count}")
            
            if s.jd_structured:
                print(f"✨ FULL JD GENERATED: Yes")
            else:
                print(f"✨ FULL JD GENERATED: No")
            print("-" * 30 + "\n")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python3 check_employee_status.py <EMPLOYEE_ID>")
    else:
        asyncio.run(check_employee(sys.argv[1]))
