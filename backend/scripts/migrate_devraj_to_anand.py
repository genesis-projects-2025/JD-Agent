import asyncio
import sys
from sqlalchemy import text
from app.core.database import engine

async def migrate():
    print("Starting migration from DEVARAJ SR (E10633) to Anand Guleria (E11081)...")
    
    async with engine.begin() as conn:
        # 1. Verify Devraj SR exists
        devraj_res = await conn.execute(text("SELECT id, name FROM employees WHERE id = 'E10633'"))
        devraj = devraj_res.fetchone()
        if not devraj:
            print("ERROR: Devraj SR (E10633) not found in employees table. Aborting.")
            sys.exit(1)
        print(f"Found employee to replace: {devraj[1]} ({devraj[0]})")
        
        # 2. Check if Anand Guleria already exists
        anand_res = await conn.execute(text("SELECT id, name FROM employees WHERE id = 'E11081'"))
        anand = anand_res.fetchone()
        if anand:
            print(f"ERROR: Anand Guleria (E11081) already exists in employees table as '{anand[1]}'. Aborting.")
            sys.exit(1)
            
        # 3. Insert Anand Guleria into employees
        print("Inserting Anand Guleria into employees...")
        await conn.execute(text("""
            INSERT INTO employees (
                id, name, email, department, reporting_manager, 
                reporting_manager_code, role, phone_mobile, created_at, job_level
            ) VALUES (
                'E11081', 'Anand Guleria', 'anand.guleria@company.com', 'Quality Assurance', 
                'Dr.Bhanu Prasad', 'DIR05', 'head', NULL, NOW(), 'Level 3'
            )
        """))
        
        # 4. Insert Anand Guleria into organogram
        print("Inserting Anand Guleria into organogram...")
        await conn.execute(text("""
            INSERT INTO organogram (
                sno, code, employee_name, designation, department, 
                date_of_joining, location, reporting_manager_code, reporting_manager, joblevel
            ) VALUES (
                '162_new', 'E11081', 'Anand Guleria', 'Senior Manager', 'Quality Assurance', 
                '01-07-2026', 'Factory', 'DIR05', 'Dr.Bhanu Prasad', 'Level 3'
            )
        """))
        
        # 5. Migrate JD Sessions
        print("Migrating JD sessions from E10633 to E11081...")
        jd_res = await conn.execute(text("""
            UPDATE jd_sessions 
            SET employee_id = 'E11081' 
            WHERE employee_id = 'E10633'
        """))
        print(f"  JD sessions updated: {jd_res.rowcount}")
        
        # 6. Migrate Reference JDs
        print("Migrating reference JDs from E10633 to E11081...")
        ref_res = await conn.execute(text("""
            UPDATE reference_jds 
            SET employee_id = 'E11081', employee_name = 'Anand Guleria' 
            WHERE employee_id = 'E10633'
        """))
        print(f"  Reference JDs updated: {ref_res.rowcount}")
        
        # 7. Update reportees in employees table
        print("Updating direct reportees in employees table to report to E11081...")
        emp_rep_res = await conn.execute(text("""
            UPDATE employees 
            SET reporting_manager_code = 'E11081', reporting_manager = 'Anand Guleria' 
            WHERE reporting_manager_code = 'E10633'
        """))
        print(f"  Direct reportees updated in employees: {emp_rep_res.rowcount}")
        
        # 8. Update reportees in organogram table
        print("Updating direct reportees in organogram table to report to E11081...")
        org_rep_res = await conn.execute(text("""
            UPDATE organogram 
            SET reporting_manager_code = 'E11081', reporting_manager = 'Anand Guleria' 
            WHERE reporting_manager_code = 'E10633'
        """))
        print(f"  Direct reportees updated in organogram: {org_rep_res.rowcount}")
        
        # 9. Delete old records for Devraj SR
        print("Deleting DEVARAJ SR (E10633) from employees and organogram...")
        del_emp = await conn.execute(text("DELETE FROM employees WHERE id = 'E10633'"))
        del_org = await conn.execute(text("DELETE FROM organogram WHERE code = 'E10633'"))
        print(f"  Deleted from employees: {del_emp.rowcount}, deleted from organogram: {del_org.rowcount}")
        
    print("Migration completed successfully and committed!")

if __name__ == "__main__":
    asyncio.run(migrate())
