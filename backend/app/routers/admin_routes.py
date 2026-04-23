from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import func
from pydantic import BaseModel
from typing import Optional

from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import jwt, JWTError

from app.core.database import get_db
from app.core.config import settings
from app.core.security import create_access_token
from app.models.jd_session_model import JDSession
from app.models.user_model import Employee

router = APIRouter(tags=["Admin"])
security = HTTPBearer()


class AdminLoginRequest(BaseModel):
    code: str
    password: str


class AdminLoginResponse(BaseModel):
    token: str
    role: str


class StatCardData(BaseModel):
    total_employees: int
    pending_jds: int
    approved_jds: int
    rejected_jds: int


async def get_current_admin(
    credentials: HTTPAuthorizationCredentials = Depends(security),
):
    """Dependency to protect routes — verifies the JWT token."""
    token = credentials.credentials
    try:
        payload = jwt.decode(
            token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM]
        )
        role = payload.get("sub")
        if role != "ADMIN":
            raise HTTPException(status_code=403, detail="Not authorized as admin")
        return role
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired admin token")


@router.post("/auth/admin-login", response_model=AdminLoginResponse)
async def admin_login(request: AdminLoginRequest):
    # Use config-backed credentials
    if (
        request.code == settings.ADMIN_CODE
        and request.password == settings.ADMIN_PASSWORD
    ):
        token = create_access_token(subject="ADMIN")
        return AdminLoginResponse(token=token, role="ADMIN")

    raise HTTPException(status_code=401, detail="Invalid admin credentials")


@router.get("/admin/stats/overview", response_model=StatCardData)
async def get_admin_overview(
    db: AsyncSession = Depends(get_db), admin_role: str = Depends(get_current_admin)
):
    # total employees
    emp_res = await db.execute(select(func.count(Employee.id)))
    total_employees = emp_res.scalar_one()

    # pending jds (waiting on manager or hr)
    pending_res = await db.execute(
        select(func.count(JDSession.id)).where(
            JDSession.status.in_(["sent_to_manager", "sent_to_hr"])
        )
    )
    pending_jds = pending_res.scalar_one()

    # approved
    approved_res = await db.execute(
        select(func.count(JDSession.id)).where(JDSession.status == "approved")
    )
    approved_jds = approved_res.scalar_one()

    # rejected (by manager or hr)
    rejected_res = await db.execute(
        select(func.count(JDSession.id)).where(
            JDSession.status.in_(["manager_rejected", "hr_rejected"])
        )
    )
    rejected_jds = rejected_res.scalar_one()

    return StatCardData(
        total_employees=total_employees,
        pending_jds=pending_jds,
        approved_jds=approved_jds,
        rejected_jds=rejected_jds,
    )


@router.get("/admin/stats/charts")
async def get_admin_charts(
    db: AsyncSession = Depends(get_db), admin_active: str = Depends(get_current_admin)
):
    # 1. Pipeline Chart (Bar Chart)
    pipeline_res = await db.execute(
        select(JDSession.status, func.count(JDSession.id).label("count")).group_by(
            JDSession.status
        )
    )
    status_counts = pipeline_res.all()

    pipeline_data = [{"status": row[0], "count": row[1]} for row in status_counts]

    pipeline_map = {item["status"]: item["count"] for item in pipeline_data}
    normalized_pipeline = [
        {
            "status": "Drafting",
            "count": pipeline_map.get("collecting", 0)
            + pipeline_map.get("draft", 0)
            + pipeline_map.get("jd_generated", 0),
        },
        {"status": "Pending Manager", "count": pipeline_map.get("sent_to_manager", 0)},
        {"status": "Pending HR", "count": pipeline_map.get("sent_to_hr", 0)},
        {"status": "Approved", "count": pipeline_map.get("approved", 0)},
        {
            "status": "Rejected",
            "count": pipeline_map.get("manager_rejected", 0)
            + pipeline_map.get("hr_rejected", 0),
        },
    ]

    # 2. Manager Response Chart (Doughnut)
    # JDs that have reached 'sent_to_manager' or further
    manager_responded_res = await db.execute(
        select(func.count(JDSession.id)).where(
            JDSession.status.in_(
                ["sent_to_hr", "manager_rejected", "hr_rejected", "approved"]
            )
        )
    )
    manager_responded = manager_responded_res.scalar_one()

    manager_pending_res = await db.execute(
        select(func.count(JDSession.id)).where(JDSession.status == "sent_to_manager")
    )
    manager_pending = manager_pending_res.scalar_one()

    response_rate = [
        {"name": "Responded", "value": manager_responded},
        {"name": "Pending", "value": manager_pending},
    ]

    return {"pipeline": normalized_pipeline, "manager_response": response_rate}


@router.get("/admin/users")
async def get_admin_users(
    role: Optional[str] = None,
    status: Optional[str] = None,
    search: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    admin_active: str = Depends(get_current_admin),
):
    query = select(Employee, JDSession).outerjoin(
        JDSession, Employee.id == JDSession.employee_id
    )

    if role:
        query = query.where(Employee.role.ilike(f"%{role}%"))

    if status:
        if status.lower() == "no jd":
            query = query.where(JDSession.id.is_(None))
        else:
            query = query.where(JDSession.status == status)

    if search:
        search_filter = f"%{search}%"
        query = query.where(
            (Employee.name.ilike(search_filter))
            | (Employee.id.ilike(search_filter))
            | (Employee.email.ilike(search_filter))
        )

    query = query.order_by(Employee.name)
    result = await db.execute(query)
    # the result has 2 elements per tuple: (Employee instance, JDSession instance)
    rows = result.all()

    formatted_results = []
    seen_emps = set()

    for emp, session in rows:
        if emp.id in seen_emps:
            continue

        seen_emps.add(emp.id)
        formatted_results.append(
            {
                "employee_id": emp.id,
                "name": emp.name,
                "email": emp.email,
                "department": emp.department,
                "role": emp.role,
                "manager_name": emp.reporting_manager,
                "jd_status": session.status if session else "No JD",
                "jd_session_id": str(session.id) if session else None,
                "last_active": session.updated_at.isoformat()
                if session and session.updated_at
                else None,
            }
        )

    return formatted_results
