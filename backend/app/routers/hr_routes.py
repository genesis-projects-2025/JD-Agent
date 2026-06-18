from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from app.core.database import get_db
from app.core.cache import cached_response
from app.services.dashboard_service import DashboardService
from app.core.auth import hr_required, manager_required


router = APIRouter()

@router.get("/department-stats", dependencies=[Depends(hr_required)])
@cached_response("dept_stats", ttl=300)
async def get_department_stats(db: AsyncSession = Depends(get_db)):
    """
    Fetches the total number of employees per department directly from the organogram table,
    and calculates Granular JD statuses for each department from jd_sessions.
    Includes zero-bloat shared role JD coverage.
    """
    try:
        # Step 1: Get all employees from organogram
        emp_query = text("""
            SELECT code, designation, department
            FROM organogram
            WHERE department IS NOT NULL AND department != ''
        """)
        emp_res = await db.execute(emp_query)
        employees = emp_res.fetchall()

        # Step 2: Get all approved canonical JDs from jd_sessions
        approved_jds_query = text("""
            SELECT department, title
            FROM jd_sessions
            WHERE status = 'approved'
              AND department IS NOT NULL
              AND title IS NOT NULL
        """)
        approved_res = await db.execute(approved_jds_query)
        approved_set = {
            (row.department, row.title)
            for row in approved_res.fetchall()
        }

        # Step 3: Get all latest personal JDs for each employee
        personal_query = text("""
            WITH LatestJDs AS (
                SELECT 
                    employee_id, 
                    status,
                    ROW_NUMBER() OVER(PARTITION BY employee_id ORDER BY updated_at DESC) as rn
                FROM jd_sessions
            )
            SELECT employee_id, status
            FROM LatestJDs
            WHERE rn = 1
        """)
        personal_res = await db.execute(personal_query)
        personal_jds = {row.employee_id: row.status for row in personal_res.mappings()}

        # Step 4: Compute stats per department
        dept_stats = {}
        for emp in employees:
            code, designation, department = emp
            if department not in dept_stats:
                dept_stats[department] = {
                    "total_employees": 0,
                    "submitted": 0,
                    "under_review": 0,
                    "approved": 0,
                    "completed_jds": 0
                }
            
            stats = dept_stats[department]
            stats["total_employees"] += 1
            
            # Check status of this employee
            status = personal_jds.get(code)
            
            # If no personal JD or it is draft, check if there is an approved shared role JD
            if (not status or status in ["draft", "jd_generated", "collecting"]) and (department, designation) in approved_set:
                status = "approved"
                
            if status in ["sent_to_manager", "manager_rejected"]:
                stats["submitted"] += 1
                stats["completed_jds"] += 1
            elif status in ["sent_to_hr", "hr_rejected"]:
                stats["under_review"] += 1
                stats["completed_jds"] += 1
            elif status == "approved":
                stats["approved"] += 1
                stats["completed_jds"] += 1

        stats_list = []
        for dept, counts in dept_stats.items():
            total = counts["total_employees"]
            completed = counts["completed_jds"]
            percentage = round((completed / total) * 100) if total > 0 else 0
            stats_list.append({
                "department": dept,
                "total_employees": total,
                "completed_jds": completed,
                "submitted": counts["submitted"],
                "under_review": counts["under_review"],
                "approved": counts["approved"],
                "completion_percentage": percentage
            })
            
        stats_list.sort(key=lambda x: x["department"])
        return stats_list

    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Failed to fetch department stats: {str(e)}")


@router.get("/departments/{department_name}/employees")
@cached_response("dept_employees", ttl=300)
async def get_department_employees(
    department_name: str, 
    page: int = 1, 
    limit: int = 50, 
    only_submitted: bool = False,
    db: AsyncSession = Depends(get_db)
):
    """
    Fetches all employees for given department(s) along with their current JD status.
    Uses shared role JD coverage: if an approved template exists for this designation/department,
    employees with no personal JD are marked as approved.
    """
    try:
        offset = (page - 1) * limit
        
        # Build set of departments
        if isinstance(department_name, str):
            depts = {department_name}
        else:
            depts = set(department_name)
            
        cell_tx_group = {
            'cell therapeutics', 
            'pct- protein purification', 
            'pct- cell biology', 
            'pct- bioinformatic', 
            'pct - microbiology'
        }
        
        if any(d.strip().lower() in cell_tx_group for d in depts):
            depts.update([
                'Cell Therapeutics', 
                'PCT- Protein Purification', 
                'PCT- Cell Biology', 
                'PCT- Bioinformatic', 
                'PCT - Microbiology'
            ])

        # 1. Fetch approved templates map for department(s)
        approved_query = text("""
            SELECT id, department, title
            FROM jd_sessions
            WHERE department = ANY(:depts)
              AND status = 'approved'
              AND title IS NOT NULL
        """)
        approved_res = await db.execute(approved_query, {"depts": list(depts)})
        approved_map = {(row.department, row.title): str(row.id) for row in approved_res.fetchall()}

        # 2. Query organogram for department employees and join latest personal JD session
        join_type = "JOIN" if only_submitted else "LEFT JOIN"
        status_filter = ""
        if only_submitted:
            status_filter = "AND lj.status IN ('sent_to_manager', 'manager_rejected', 'sent_to_hr', 'hr_rejected', 'approved', 'rejected', 'revision_requested')"

        dept_filter = "o.department = ANY(:depts)"
        params = {"depts": list(depts), "limit": limit, "offset": offset}

        query = text(f"""
            WITH LatestJDs AS (
                SELECT 
                    id as jd_id,
                    employee_id, 
                    status,
                    updated_at,
                    ROW_NUMBER() OVER(PARTITION BY employee_id ORDER BY updated_at DESC) as rn
                FROM jd_sessions
            )
            SELECT 
                o.code as employee_id,
                o.employee_name as name,
                o.designation as designation,
                o.department as department,
                o.reporting_manager as reporting_manager,
                lj.jd_id as jd_session_id,
                lj.status as jd_status,
                lj.updated_at as last_updated
            FROM organogram o
            {join_type} LatestJDs lj ON o.code = lj.employee_id AND lj.rn = 1 {status_filter}
            WHERE {dept_filter}
            ORDER BY o.employee_name ASC
            LIMIT :limit OFFSET :offset
        """)
        
        result = await db.execute(query, params)
        
        employees = []
        for row in result.mappings():
            status = row.jd_status
            jd_id = row.jd_session_id
            last_updated = row.last_updated
            
            # Resolve zero-bloat shared role approved JDs
            if (not status or status in ["draft", "jd_generated", "collecting"]) and (row.department, row.designation) in approved_map:
                status = "approved"
                jd_id = approved_map[(row.department, row.designation)]
            elif not status or status in ["draft", "jd_generated", "collecting"]:
                status = "Not Submitted"
                
            employees.append({
                "employee_id": row.employee_id,
                "name": row.name,
                "designation": row.designation,
                "department": row.department,
                "reporting_manager": row.reporting_manager,
                "jd_status": status,
                "jd_id": jd_id,
                "last_updated": last_updated.isoformat() if last_updated else None
            })

        return employees
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail="Failed to fetch department employees")


@router.get("/my-team-stats", dependencies=[Depends(manager_required)])
async def get_my_team_stats(emp_code: str, db: AsyncSession = Depends(get_db)):
    """
    Returns the team-scoped JD statistics for a manager/head based on their direct reports.
    """
    try:
        reports = await DashboardService.get_direct_reports(db, emp_code)
        emp_codes = list(reports)
        stats = await DashboardService.get_team_stats(db, emp_codes)
        stats["scope"] = "team"
        return stats

    except Exception:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail="Failed to fetch team stats")


@router.get("/my-team-employees")
async def get_my_team_employees(
    emp_code: str, 
    page: int = 1, 
    limit: int = 50,
    db: AsyncSession = Depends(get_db)
):
    """
    Returns a list of employees directly reporting to the logged-in manager/head with their JD status.
    Uses shared role approved JDs.
    """
    try:
        reports = await DashboardService.get_direct_reports(db, emp_code)
        if not reports:
            return []
        
        # Fetch all approved templates map
        approved_query = text("""
            SELECT id, department, title
            FROM jd_sessions
            WHERE status = 'approved'
              AND department IS NOT NULL
              AND title IS NOT NULL
        """)
        approved_res = await db.execute(approved_query)
        approved_map = {
            (row.department, row.title): str(row.id)
            for row in approved_res.fetchall()
        }

        offset = (page - 1) * limit
        query = text("""
            WITH LatestJDs AS (
                SELECT 
                    id as jd_id,
                    employee_id, 
                    status,
                    updated_at,
                    ROW_NUMBER() OVER(PARTITION BY employee_id ORDER BY updated_at DESC) as rn
                FROM jd_sessions
            )
            SELECT 
                o.code as employee_id,
                o.employee_name as name,
                o.designation as designation,
                o.department as department,
                o.reporting_manager as reporting_manager,
                lj.jd_id as jd_session_id,
                lj.status as jd_status,
                lj.updated_at as last_updated
            FROM organogram o
            LEFT JOIN LatestJDs lj ON o.code = lj.employee_id AND lj.rn = 1
            WHERE o.code = ANY(:codes)
            ORDER BY o.employee_name ASC
            LIMIT :limit OFFSET :offset
        """)

        result = await db.execute(query, {
            "codes": list(reports),
            "limit": limit,
            "offset": offset
        })
        
        employees = []
        for row in result.mappings():
            status = row.jd_status
            jd_id = row.jd_session_id
            last_updated = row.last_updated
            
            # Resolve zero-bloat shared role approved JDs
            if (not status or status in ["draft", "jd_generated", "collecting"]) and (row.department, row.designation) in approved_map:
                status = "approved"
                jd_id = approved_map[(row.department, row.designation)]
            elif not status or status in ["draft", "jd_generated", "collecting"]:
                status = "Not Submitted"
                
            employees.append({
                "employee_id": row.employee_id,
                "name": row.name,
                "designation": row.designation,
                "department": row.department,
                "reporting_manager": row.reporting_manager,
                "jd_status": status,
                "jd_id": jd_id,
                "last_updated": last_updated.isoformat() if last_updated else None
            })

        return employees

    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail="Failed to fetch team employees")


