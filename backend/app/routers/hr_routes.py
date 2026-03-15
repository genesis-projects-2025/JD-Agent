from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from app.core.database import get_db

router = APIRouter()

@router.get("/department-stats")
async def get_department_stats(db: AsyncSession = Depends(get_db)):
    """
    Fetches the total number of employees per department directly from the organogram table,
    and calculates Granular JD statuses for each department from jd_sessions.
    Computes a completion percentage.
    """
    try:
        # Step 1: Get Total Headcount per Department from Organogram
        headcount_query = text("""
            SELECT department, COUNT(*) as headcount
            FROM organogram
            WHERE department IS NOT NULL AND department != ''
            GROUP BY department
        """)
        headcount_res = await db.execute(headcount_query)
        headcounts = {row.department: row.headcount for row in headcount_res.mappings()}

        # Step 2: Get Granular JD Counts per Department
        jd_query = text("""
            SELECT 
                e.department, 
                COUNT(CASE WHEN j.status = 'sent_to_manager' THEN 1 END) as submitted,
                COUNT(CASE WHEN j.status = 'sent_to_hr' THEN 1 END) as under_review,
                COUNT(CASE WHEN j.status = 'approved' THEN 1 END) as approved
            FROM jd_sessions j
            JOIN employees e ON j.employee_id = e.id
            WHERE e.department IS NOT NULL AND e.department != ''
              AND j.status IN ('sent_to_manager', 'sent_to_hr', 'approved')
            GROUP BY e.department
        """)
        jd_res = await db.execute(jd_query)
        status_counts = {row.department: {
            "submitted": row.submitted,
            "under_review": row.under_review,
            "approved": row.approved,
            "completed_jds": row.submitted + row.under_review + row.approved
        } for row in jd_res.mappings()}

        # Step 3: Combine arrays
        stats = []
        for dept, total in headcounts.items():
            counts = status_counts.get(dept, {"submitted": 0, "under_review": 0, "approved": 0, "completed_jds": 0})
            completed = counts["completed_jds"]
            percentage = round((completed / total) * 100) if total > 0 else 0
            
            stats.append({
                "department": dept,
                "total_employees": total,
                "completed_jds": completed,
                "submitted": counts["submitted"],
                "under_review": counts["under_review"],
                "approved": counts["approved"],
                "completion_percentage": percentage
            })
            
        stats.sort(key=lambda x: x["department"])
        return stats

    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Failed to fetch department stats: {str(e)}")


@router.get("/departments/{department_name}/employees")
async def get_department_employees(
    department_name: str, 
    page: int = 1, 
    limit: int = 50, 
    only_submitted: bool = False,
    db: AsyncSession = Depends(get_db)
):
    """
    Fetches all employees for a given department along with their current JD status.
    Drafts are marked as 'Not Submitted'. Support pagination.
    If only_submitted is True, filters out employees without a submitted JD.
    """
    try:
        offset = (page - 1) * limit
        
        # We query the organogram to get employees in this department
        # We join on jd_sessions to get the status. 
        # If only_submitted is True, we use an INNER JOIN to filter out those without JDs,
        # and we further filter the JD status to excluding drafts.
        
        join_type = "JOIN" if only_submitted else "LEFT JOIN"
        status_filter = ""
        if only_submitted:
            status_filter = "AND lj.status IN ('sent_to_manager', 'manager_rejected', 'sent_to_hr', 'hr_rejected', 'approved', 'rejected', 'revision_requested')"

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
                o.reporting_manager as reporting_manager,
                lj.jd_id as jd_session_id,
                lj.status as jd_status,
                lj.updated_at as last_updated
            FROM organogram o
            {join_type} LatestJDs lj ON o.code = lj.employee_id AND lj.rn = 1 {status_filter}
            WHERE o.department = :dept
            ORDER BY o.employee_name ASC
            LIMIT :limit OFFSET :offset
        """)
        
        result = await db.execute(query, {
            "dept": department_name,
            "limit": limit,
            "offset": offset
        })
        
        employees = []
        for row in result.mappings():
            status = row.jd_status
            if not status or status in ["draft", "jd_generated"]:
                status = "Not Submitted"
                
            employees.append({
                "employee_id": row.employee_id,
                "name": row.name,
                "designation": row.designation,
                "reporting_manager": row.reporting_manager,
                "jd_status": status,
                "last_updated": row.last_updated.isoformat() if row.last_updated else None
            })
            
        return employees
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Failed to fetch department employees: {str(e)}")
