from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from typing import List, Dict, Any, Set

class DashboardService:
    @staticmethod
    async def get_recursive_reports(db: AsyncSession, manager_code: str) -> Set[str]:
        """
        Builds a set of all recursive report employee codes (direct and indirect).
        """
        query = text("""
            WITH RECURSIVE reports AS (
                SELECT code FROM organogram WHERE reporting_manager_code = :mgr_code
                UNION
                SELECT o.code FROM organogram o
                INNER JOIN reports r ON o.reporting_manager_code = r.code
            )
            SELECT code FROM reports
        """)
        result = await db.execute(query, {"mgr_code": manager_code})
        return {row[0] for row in result.fetchall()}

    @staticmethod
    async def get_direct_reports(db: AsyncSession, manager_code: str) -> Set[str]:
        """
        Builds a set of all direct report employee codes (immediate reports only).
        """
        query = text("""
            SELECT code FROM organogram WHERE reporting_manager_code = :mgr_code
        """)
        result = await db.execute(query, {"mgr_code": manager_code})
        return {row[0] for row in result.fetchall()}

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
        
        if not mgr_row:
            return True
            
        mgr_dept = mgr_row[0]
        
        # Define department families/groups that should be treated as the same department
        cell_tx_group = {
            'cell therapeutics', 
            'pct- protein purification', 
            'pct- cell biology', 
            'pct- bioinformatic', 
            'pct - microbiology'
        }
        
        dept_lower = dept.strip().lower() if dept else ""
        mgr_dept_lower = mgr_dept.strip().lower() if mgr_dept else ""
        
        if dept_lower in cell_tx_group and mgr_dept_lower in cell_tx_group:
            return False
            
        if mgr_dept != dept:
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
    async def get_headed_departments(db: AsyncSession, emp_code: str) -> Set[str]:
        """
        Gets all departments headed by the given employee.
        This includes their own department, plus the departments of all recursive reports.
        """
        query = text("""
            WITH RECURSIVE reports AS (
                SELECT code, department FROM organogram WHERE reporting_manager_code = :mgr_code
                UNION
                SELECT o.code, o.department FROM organogram o
                INNER JOIN reports r ON o.reporting_manager_code = r.code
            )
            SELECT DISTINCT department FROM (
                SELECT department FROM organogram WHERE code = :mgr_code
                UNION ALL
                SELECT department FROM reports WHERE department IS NOT NULL AND department != ''
            ) all_depts
        """)
        res = await db.execute(query, {"mgr_code": emp_code})
        depts = {r[0] for r in res.fetchall() if r[0]}
        
        # Also expand with cell_tx_group if any department is in cell_tx_group
        cell_tx_group = {
            'cell therapeutics', 
            'pct- protein purification', 
            'pct- cell biology', 
            'pct- bioinformatic', 
            'pct - microbiology'
        }
        has_cell_tx = any(d.strip().lower() in cell_tx_group for d in depts)
        if has_cell_tx:
            depts.update([
                'Cell Therapeutics', 
                'PCT- Protein Purification', 
                'PCT- Cell Biology', 
                'PCT- Bioinformatic', 
                'PCT - Microbiology'
            ])
            
        return depts

    @staticmethod
    async def get_department_employees(db: AsyncSession, emp_code: str) -> List[str]:
        """
        Gets all employee codes in any department headed by the given employee.
        """
        depts = await DashboardService.get_headed_departments(db, emp_code)
        if not depts:
            return []
            
        dept_query = text("SELECT code FROM organogram WHERE department = ANY(:depts)")
        dept_res = await db.execute(dept_query, {"depts": list(depts)})
        return [r[0] for r in dept_res.fetchall()]
