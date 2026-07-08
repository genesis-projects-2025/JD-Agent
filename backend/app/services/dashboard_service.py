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

        # Fetch approved templates map
        approved_query = text("""
            SELECT DISTINCT department, title
            FROM jd_sessions
            WHERE status = 'approved'
              AND title IS NOT NULL
              AND department IS NOT NULL
        """)
        approved_res = await db.execute(approved_query)
        approved_set = {
            (row.department, row.title)
            for row in approved_res.fetchall()
        }

        query = text("""
            WITH LatestJDs AS (
                SELECT 
                    employee_id, 
                    status as jd_status,
                    ROW_NUMBER() OVER(PARTITION BY employee_id ORDER BY updated_at DESC) as rn
                FROM jd_sessions
                WHERE employee_id = ANY(:codes)
            ),
            LatestKRAKPIs AS (
                SELECT 
                    employee_id, 
                    status as kra_kpi_status,
                    ROW_NUMBER() OVER(PARTITION BY employee_id ORDER BY updated_at DESC) as rn
                FROM kra_kpi_sessions
                WHERE employee_id = ANY(:codes)
            )
            SELECT 
                o.code as employee_id,
                o.designation,
                o.department,
                lj.jd_status,
                lk.kra_kpi_status
            FROM organogram o
            LEFT JOIN LatestJDs lj ON o.code = lj.employee_id AND lj.rn = 1
            LEFT JOIN LatestKRAKPIs lk ON o.code = lk.employee_id AND lk.rn = 1
            WHERE o.code = ANY(:codes)
        """)
        
        result = await db.execute(query, {"codes": emp_codes})
        
        submitted = 0
        under_review = 0
        approved = 0
        
        for row in result.mappings():
            jd_status = row.jd_status
            kra_kpi_status = row.kra_kpi_status
            
            if (not jd_status or jd_status in ["draft", "jd_generated", "collecting"]) and (row.department, row.designation) in approved_set:
                jd_status = "approved"
                
            if jd_status == "approved" and kra_kpi_status == "approved":
                approved += 1
            elif jd_status in ["sent_to_hr", "hr_rejected"] or kra_kpi_status in ["sent_to_hr", "hr_rejected"]:
                under_review += 1
            elif jd_status in ["sent_to_manager", "manager_rejected"] or kra_kpi_status in ["sent_to_manager", "manager_rejected"]:
                submitted += 1
            elif jd_status == "approved":
                submitted += 1
                
        total = len(emp_codes)
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
