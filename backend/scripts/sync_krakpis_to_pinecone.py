import asyncio
import logging
import sys
from sqlalchemy import text
from app.core.database import engine
from app.services.vector_service import index_employee_kras

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

async def sync():
    print("🚀 Starting Pinecone KRA/KPI Sync...")
    async with engine.connect() as conn:
        # Select all confirmed or approved KRA/KPI frameworks
        query = text("""
            SELECT s.employee_id, s.kras, o.designation as role_title, o.department, o.joblevel as job_level
            FROM kra_kpi_sessions s
            JOIN organogram o ON s.employee_id = o.code
            WHERE s.generation_step = 'confirmed' OR s.status IN ('confirmed', 'sent_to_manager', 'sent_to_hr', 'approved')
        """)
        
        result = await conn.execute(query)
        rows = result.fetchall()
        print(f"📊 Found {len(rows)} active employee performance frameworks to process.")
        
        for idx, row in enumerate(rows):
            data = dict(row._mapping)
            emp_id = data["employee_id"]
            kras = data["kras"]
            role_title = data["role_title"] or "Employee"
            dept = data["department"] or "General"
            level = data["job_level"] or "Mid"
            
            if not kras:
                print(f"⚠️ Skip: Employee {emp_id} has no KRA payload.")
                continue
                
            print(f"[{idx+1}/{len(rows)}] Vectorizing goals for {emp_id} - {role_title} ({dept})...")
            await index_employee_kras(
                employee_id=emp_id,
                kras_data=kras,
                role_title=role_title,
                department=dept,
                experience_level=level
            )
            
    print("✅ Pinecone KRA/KPI Sync completed successfully!")

if __name__ == "__main__":
    asyncio.run(sync())
