from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from typing import List, Dict, Any, Set

class DashboardService:
    @staticmethod
    async def get_recursive_reports(db: AsyncSession, manager_code: str) -> Set[str]:
        """
        Builds a set of all recursive report employee codes (direct and indirect).
        """
        all_reports = set()
        queue = [manager_code]
        
        while queue:
            current_manager = queue.pop(0)
            query = text("""
                SELECT code FROM organogram 
                WHERE reporting_manager_code = :mgr_code
            """)
            result = await db.execute(query, {"mgr_code": current_manager})
            reports = [row[0] for row in result.fetchall()]
            
            for report_code in reports:
                if report_code not in all_reports:
                    all_reports.add(report_code)
                    queue.append(report_code)
                    
        return all_reports

    @staticmethod
    async def is_department_head(db: AsyncSession, emp_code: str) -> bool:
        """
        Determines if an employee is a department head (no manager in the same department).
        """
        query = text("""
            SELECT department, reporting_manager_code FROM organogram 
            WHERE code = :code
        """)
        result = await db.execute(query, {"code": emp_code})
        row = result.fetchone()
        
        if not row:
            return False
            
        dept, mgr_code = row
        if not mgr_code or mgr_code.strip() == '' or mgr_code == 'None':
            return True
            
        # Check if the manager is in a different department
        mgr_query = text("SELECT department FROM organogram WHERE code = :mgr_code")
        mgr_res = await db.execute(mgr_query, {"mgr_code": mgr_code})
        mgr_row = mgr_res.fetchone()
        
        if not mgr_row or mgr_row[0] != dept:
            return True
            
        return False

    @staticmethod
    async def get_team_stats(db: AsyncSession, emp_codes: List[str]) -> Dict[str, Any]:
        """
        Calculates JD statistics for a specific list of employee codes.
        """
        if not emp_codes:
            return {
                "total_employees": 0,
                "completed_jds": 0,
                "submitted": 0,
                "under_review": 0,
                "approved": 0,
                "completion_percentage": 0
            }

        query = text("""
            SELECT 
                COUNT(CASE WHEN j.status = 'sent_to_manager' THEN 1 END) as submitted,
                COUNT(CASE WHEN j.status = 'sent_to_hr' THEN 1 END) as under_review,
                COUNT(CASE WHEN j.status = 'approved' THEN 1 END) as approved
            FROM jd_sessions j
            WHERE j.employee_id = ANY(:codes)
              AND j.status IN ('sent_to_manager', 'sent_to_hr', 'approved')
        """)
        
        result = await db.execute(query, {"codes": emp_codes})
        row = result.mappings().first()
        
        total = len(emp_codes)
        submitted = row.submitted or 0
        under_review = row.under_review or 0
        approved = row.approved or 0
        completed = submitted + under_review + approved
        percentage = round((completed / total) * 100) if total > 0 else 0
        
        return {
            "total_employees": total,
            "completed_jds": completed,
            "submitted": submitted,
            "under_review": under_review,
            "approved": approved,
            "completion_percentage": percentage
        }

    @staticmethod
    async def get_department_employees(db: AsyncSession, emp_code: str) -> List[str]:
        """
        Gets all employee codes in the same department as the given employee.
        """
        query = text("SELECT department FROM organogram WHERE code = :code")
        res = await db.execute(query, {"code": emp_code})
        row = res.fetchone()
        if not row:
            return []
            
        dept_query = text("SELECT code FROM organogram WHERE department = :dept")
        dept_res = await db.execute(dept_query, {"dept": row[0]})
        return [r[0] for r in dept_res.fetchall()]
