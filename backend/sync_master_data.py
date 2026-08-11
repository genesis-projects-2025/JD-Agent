# backend/sync_master_data.py
import asyncio
import copy
import json
import logging
from sqlalchemy import text
from app.core.database import AsyncSessionLocal

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

async def main():
    logger.info("=== Starting Master Database Physical Synchronization (Optimized Bulk) ===")
    
    async with AsyncSessionLocal() as db:
        async with db.begin():
            logger.info("Disabling custom user triggers temporarily for safe syncing...")
            await db.execute(text("ALTER TABLE reference_jds DISABLE TRIGGER USER;"))
            await db.execute(text("ALTER TABLE jd_sessions DISABLE TRIGGER USER;"))
            
            try:
                # 1. Fetch master organogram rows
                logger.info("Fetching master organogram data...")
                res = await db.execute(
                    text("SELECT code, employee_name, designation, reporting_manager, reporting_manager_code, department, location, joblevel FROM organogram")
                )
                org_rows = res.mappings().all()
                org_map = {row["code"]: row for row in org_rows}
                logger.info(f"Loaded {len(org_map)} master records from organogram.")
                
                # 2. Fetch all employees in bulk
                logger.info("Fetching all employees...")
                emp_res = await db.execute(
                    text("SELECT id, department, role, reporting_manager, reporting_manager_code FROM employees")
                )
                employees = emp_res.mappings().all()
                
                # 3. Fetch all jd_sessions in bulk
                logger.info("Fetching all JD sessions...")
                jd_res = await db.execute(
                    text("SELECT id, employee_id, title, department, jd_structured FROM jd_sessions")
                )
                jd_sessions = jd_res.mappings().all()
                
                # 4. Fetch all reference_jds in bulk
                logger.info("Fetching all reference JDs...")
                ref_res = await db.execute(
                    text("SELECT id, employee_id, role_title, department, employee_name, level FROM reference_jds")
                )
                ref_jds = ref_res.mappings().all()
                
                updated_employees = 0
                updated_jd_sessions = 0
                updated_reference_jds = 0
                
                # A. Sync employees
                for emp in employees:
                    code = emp["id"]
                    if code in org_map:
                        row = org_map[code]
                        dept = row["department"]
                        designation = row["designation"]
                        manager = row["reporting_manager"]
                        mgr_code = row["reporting_manager_code"]
                        
                        if (emp["department"] != dept or 
                            emp["role"] != designation or 
                            emp["reporting_manager"] != manager or 
                            emp["reporting_manager_code"] != mgr_code):
                            
                            await db.execute(
                                text("""
                                    UPDATE employees 
                                    SET department = :dept, 
                                        role = :role, 
                                        reporting_manager = :mgr, 
                                        reporting_manager_code = :mgr_code 
                                    WHERE id = :id
                                """),
                                {
                                    "id": code,
                                    "dept": dept,
                                    "role": designation,
                                    "mgr": manager,
                                    "mgr_code": mgr_code
                                }
                            )
                            updated_employees += 1
                            
                # B. Sync jd_sessions (including nested structured column)
                for session in jd_sessions:
                    code = session["employee_id"]
                    if code in org_map:
                        row = org_map[code]
                        session_id = session["id"]
                        designation = row["designation"]
                        dept = row["department"]
                        manager = row["reporting_manager"]
                        level = row["joblevel"]
                        loc = row["location"]
                        
                        curr_title = session["title"]
                        curr_dept = session["department"]
                        curr_structured = session["jd_structured"]
                        
                        need_update = False
                        if curr_title != designation or curr_dept != dept:
                            need_update = True
                            
                        # Parse nested json
                        new_structured = copy.deepcopy(curr_structured)
                        if new_structured is None:
                            new_structured = {}
                        elif isinstance(new_structured, str):
                            try:
                                new_structured = json.loads(new_structured)
                            except Exception:
                                new_structured = {}
                                
                        if not isinstance(new_structured, dict):
                            new_structured = {}
                            
                        if "employee_information" not in new_structured or not isinstance(new_structured["employee_information"], dict):
                            new_structured["employee_information"] = {}
                            
                        emp_info = new_structured["employee_information"]
                        json_changed = False
                        
                        if emp_info.get("title") != designation:
                            emp_info["title"] = designation
                            json_changed = True
                        if emp_info.get("job_title") != designation:
                            emp_info["job_title"] = designation
                            json_changed = True
                        if new_structured.get("job_title") != designation:
                            new_structured["job_title"] = designation
                            json_changed = True
                        if new_structured.get("title") != designation:
                            new_structured["title"] = designation
                            json_changed = True
                            
                        if emp_info.get("department") != dept:
                            emp_info["department"] = dept
                            json_changed = True
                        if new_structured.get("department") != dept:
                            new_structured["department"] = dept
                            json_changed = True
                            
                        if emp_info.get("reports_to") != manager:
                            emp_info["reports_to"] = manager
                            json_changed = True
                            
                        if emp_info.get("job_level") != level:
                            emp_info["job_level"] = level
                            json_changed = True
                        
                        if emp_info.get("location") != loc:
                            emp_info["location"] = loc
                            json_changed = True
                            
                        if json_changed:
                            need_update = True
                            
                        if need_update:
                            await db.execute(
                                text("""
                                    UPDATE jd_sessions 
                                    SET title = :title, 
                                        department = :dept, 
                                        jd_structured = :structured 
                                    WHERE id = :id
                                """),
                                {
                                    "id": session_id,
                                    "title": designation,
                                    "dept": dept,
                                    "structured": json.dumps(new_structured)
                                }
                            )
                            updated_jd_sessions += 1
                            
                # C. Sync reference JDs
                for ref in ref_jds:
                    code = ref["employee_id"]
                    if code in org_map:
                        row = org_map[code]
                        ref_id = ref["id"]
                        designation = row["designation"]
                        dept = row["department"]
                        name = row["employee_name"]
                        level = row["joblevel"]
                        
                        if (ref["role_title"] != designation or 
                            ref["department"] != dept or 
                            ref["employee_name"] != name or 
                            ref["level"] != level):
                            
                            await db.execute(
                                text("""
                                    UPDATE reference_jds 
                                    SET role_title = :role, 
                                        department = :dept, 
                                        employee_name = :name, 
                                        level = :level 
                                    WHERE id = :id
                                """),
                                {
                                    "id": ref_id,
                                    "role": designation,
                                    "dept": dept,
                                    "name": name,
                                    "level": level
                                }
                            )
                            updated_reference_jds += 1
                            
                logger.info("=== Synchronization Statistics ===")
                logger.info(f"Physical Employees Updated:       {updated_employees}")
                logger.info(f"Physical JD Sessions Updated:     {updated_jd_sessions}")
                logger.info(f"Physical Reference JDs Updated:   {updated_reference_jds}")
                logger.info("==================================")
                
            finally:
                logger.info("Re-enabling custom user triggers...")
                await db.execute(text("ALTER TABLE reference_jds ENABLE TRIGGER USER;"))
                await db.execute(text("ALTER TABLE jd_sessions ENABLE TRIGGER USER;"))
                logger.info("Database triggers re-enabled successfully.")
            
    logger.info("=== Master Database Synchronization Completed Successfully! ===")

if __name__ == "__main__":
    asyncio.run(main())
