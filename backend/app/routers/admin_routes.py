from fastapi import APIRouter, Depends, HTTPException, File, Form, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import func, text
from pydantic import BaseModel
from typing import Optional

from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import jwt, JWTError

from app.core.database import get_db
from app.core.config import settings
from app.core.security import create_access_token
from app.models.jd_session_model import JDSession
from app.models.user_model import Employee
from app.services.kra_kpi_service import process_kra_kpi_document
import logging

logger = logging.getLogger(__name__)

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
    total_generated_jds: int
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
    # Use config-backed credentials with space trimming and case insensitivity on code
    code_input = (request.code or "").strip()
    pass_input = (request.password or "").strip()
    
    if (
        code_input.lower() == settings.ADMIN_CODE.lower()
        and pass_input == settings.ADMIN_PASSWORD
    ):
        token = create_access_token(subject="ADMIN")
        return AdminLoginResponse(token=token, role="ADMIN")

    raise HTTPException(status_code=401, detail="Invalid admin credentials")


_ADMIN_STATS_CACHE: dict = {}
_ADMIN_CHARTS_CACHE: dict = {}
_ADMIN_CACHE_TTL = 30.0


@router.get("/admin/stats/overview", response_model=StatCardData)
async def get_admin_overview(
    db: AsyncSession = Depends(get_db), admin_role: str = Depends(get_current_admin)
):
    import time
    now = time.time()
    if _ADMIN_STATS_CACHE and (now - _ADMIN_STATS_CACHE.get("ts", 0)) < _ADMIN_CACHE_TTL:
        return _ADMIN_STATS_CACHE["data"]

    # Single-pass SQL query for accurate overview stats (counting unique employees with valid generated/submitted/approved JDs)
    res = await db.execute(
        text("""
        SELECT
            (SELECT COUNT(*) FROM organogram) as total_employees,
            (SELECT COUNT(DISTINCT employee_id) FROM jd_sessions WHERE status IN ('jd_generated', 'sent_to_manager', 'sent_to_hr', 'approved', 'manager_rejected', 'hr_rejected', 'rejected')) as total_generated_jds,
            (SELECT COUNT(DISTINCT employee_id) FROM jd_sessions WHERE status IN ('sent_to_manager', 'sent_to_hr')) as pending_jds,
            (SELECT COUNT(DISTINCT employee_id) FROM jd_sessions WHERE status = 'approved') as approved_jds,
            (SELECT COUNT(DISTINCT employee_id) FROM jd_sessions WHERE status IN ('manager_rejected', 'hr_rejected', 'rejected')) as rejected_jds
    """)
    )
    row = res.mappings().first() or {}
    result_data = StatCardData(
        total_employees=row.get("total_employees", 0),
        total_generated_jds=row.get("total_generated_jds", 0),
        pending_jds=row.get("pending_jds", 0),
        approved_jds=row.get("approved_jds", 0),
        rejected_jds=row.get("rejected_jds", 0),
    )
    _ADMIN_STATS_CACHE["data"] = result_data
    _ADMIN_STATS_CACHE["ts"] = now
    return result_data


@router.get("/admin/stats/charts")
async def get_admin_charts(
    db: AsyncSession = Depends(get_db), admin_active: str = Depends(get_current_admin)
):
    import time
    now = time.time()
    if _ADMIN_CHARTS_CACHE and (now - _ADMIN_CHARTS_CACHE.get("ts", 0)) < _ADMIN_CACHE_TTL:
        return _ADMIN_CHARTS_CACHE["data"]

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
    manager_responded = (
        pipeline_map.get("sent_to_hr", 0)
        + pipeline_map.get("manager_rejected", 0)
        + pipeline_map.get("hr_rejected", 0)
        + pipeline_map.get("approved", 0)
    )
    manager_pending = pipeline_map.get("sent_to_manager", 0)

    response_rate = [
        {"name": "Responded", "value": manager_responded},
        {"name": "Pending", "value": manager_pending},
    ]

    res_dict = {"pipeline": normalized_pipeline, "manager_response": response_rate}
    _ADMIN_CHARTS_CACHE["data"] = res_dict
    _ADMIN_CHARTS_CACHE["ts"] = now
    return res_dict


@router.get("/admin/users")
async def get_admin_users(
    role: Optional[str] = None,
    status: Optional[str] = None,
    search: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    admin_active: str = Depends(get_current_admin),
):
    sql = """
        SELECT 
            o.code as employee_id,
            o.employee_name as name,
            e.email as email,
            o.department as department,
            o.designation as role,
            o.reporting_manager as manager_name,
            COALESCE(js.status, 'No JD') as jd_status,
            js.id::text as jd_session_id,
            js.updated_at as last_active,
            CASE 
                WHEN uk.id IS NOT NULL THEN 'approved'
                ELSE ks.status 
            END as kra_kpi_status
        FROM organogram o
        LEFT JOIN employees e ON e.id = o.code
        LEFT JOIN jd_sessions js ON js.employee_id = o.code
        LEFT JOIN kra_kpi_sessions ks ON ks.employee_id = o.code
        LEFT JOIN uploaded_kra_kpis uk ON uk.employee_id = o.code
        WHERE 1=1
    """
    params = {}
    if role:
        sql += " AND o.designation ILIKE :role"
        params["role"] = f"%{role}%"
    if status:
        if status.lower() == "no jd":
            sql += " AND js.id IS NULL"
        else:
            sql += " AND js.status = :status"
            params["status"] = status
    if search:
        sql += " AND (o.employee_name ILIKE :search OR o.code ILIKE :search OR e.email ILIKE :search)"
        params["search"] = f"%{search}%"

    sql += " ORDER BY o.employee_name ASC"
    result = await db.execute(text(sql), params)
    rows = result.mappings().all()

    formatted_results = []
    seen = set()
    for r in rows:
        emp_id = r["employee_id"]
        if emp_id in seen:
            continue
        seen.add(emp_id)
        formatted_results.append({
            "employee_id": emp_id,
            "name": r["name"] or "Unknown",
            "email": r["email"],
            "department": r["department"],
            "role": r["role"] or "Employee",
            "manager_name": r["manager_name"],
            "jd_status": r["jd_status"],
            "jd_session_id": r["jd_session_id"],
            "kra_kpi_status": r["kra_kpi_status"],
            "last_active": r["last_active"].isoformat() if r.get("last_active") else None,
        })

    return formatted_results


@router.post("/admin/kra-kpi/upload")
async def upload_kra_kpi_document(
    file: UploadFile = File(...),
    employee_id: str = Form(...),
    employee_name: str = Form(...),
    db: AsyncSession = Depends(get_db),
    admin_role: str = Depends(get_current_admin),
):
    """
    Upload and parse existing KRA/KPI document for an employee.
    Supports DOCX, PDF, and Excel (.xlsx, .xls) files.
    Auto-creates JDSession if missing, and creates a confirmed KRAKPISession.
    """

    # Check if target employee has an approved JD session
    jd_res = await db.execute(
        select(JDSession).where(
            JDSession.employee_id == employee_id,
            JDSession.status == "approved"
        )
    )
    jd_session = jd_res.scalars().first()
    if not jd_session:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "MISSING_JD",
                "message": f"Employee {employee_name} ({employee_id}) does not have an approved Job Description yet. Please prepare/approve the JD first."
            }
        )

    allowed_types = {
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
        "application/msword": "docx",  # Coerce .doc to .docx parser if needed, or fallback
        "application/pdf": "pdf",
        # Excel formats
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
        "application/vnd.ms-excel": "xls",
        "application/octet-stream": None,  # Some browsers send xlsx as this
    }

    content_type = file.content_type or ""
    
    # Detect Excel by filename extension if content_type is ambiguous
    fname = (file.filename or "").lower()
    if content_type == "application/octet-stream":
        if fname.endswith(".xlsx"):
            content_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        elif fname.endswith(".xls"):
            content_type = "application/vnd.ms-excel"
        else:
            raise HTTPException(
                status_code=400,
                detail="Could not determine file type. Please upload DOCX, PDF, or Excel (.xlsx/.xls).",
            )

    if content_type not in allowed_types or allowed_types[content_type] is None:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid file type. Accepted: DOCX, PDF, Excel (.xlsx/.xls). Got: {content_type}",
        )

    file_type = allowed_types[content_type]
    file_content = await file.read()

    # Validate size (10MB max)
    if len(file_content) > 10 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="File too large. Maximum 10MB")

    try:
        result = await process_kra_kpi_document(
            db=db,
            file_bytes=file_content,
            filename=file.filename,
            file_type=file_type,
            employee_id=employee_id,
            employee_name=employee_name,
            admin_role=admin_role,
        )
        return {
            "status": "success",
            "message": "KRA/KPI framework uploaded, parsed, and confirmed successfully",
            "data": result,
        }
    except Exception as e:
        import logging
        logger = logging.getLogger(__name__)
        logger.error(f"[UPLOAD KRA] Processing failed: {str(e)}")
        raise HTTPException(
            status_code=400,
            detail=f"Failed to process KRA/KPI document: {str(e)}",
        )


class AnalyzePasteRequest(BaseModel):
    employee_id: str
    employee_name: str
    content: str


class ConfirmPasteRequest(BaseModel):
    employee_id: str
    employee_name: str
    jd: dict
    kra_kpi: dict


@router.post("/admin/kra-kpi/analyze-paste")
async def analyze_kra_kpi_paste_endpoint(
    request: AnalyzePasteRequest,
    db: AsyncSession = Depends(get_db),
    admin_role: str = Depends(get_current_admin),
):
    """
    Directly analyze pasted KRA/KPI raw text and return structured preview before confirmation.
    """
    # Check if target employee has an approved JD session
    jd_res = await db.execute(
        select(JDSession).where(
            JDSession.employee_id == request.employee_id,
            JDSession.status == "approved"
        )
    )
    jd_session = jd_res.scalars().first()
    if not jd_session:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "MISSING_JD",
                "message": f"Employee {request.employee_name} ({request.employee_id}) does not have an approved Job Description yet. Please prepare/approve the JD first."
            }
        )

    from app.services.kra_kpi_service import analyze_kra_kpi_text
    try:
        result = await analyze_kra_kpi_text(
            employee_id=request.employee_id,
            employee_name=request.employee_name,
            content=request.content,
        )
        return {
            "status": "success",
            "data": result,
        }
    except Exception as e:
        logger.error(f"[PASTE KRA] Analysis failed: {str(e)}")
        raise HTTPException(
            status_code=400,
            detail=f"Failed to analyze pasted KRA/KPI content: {str(e)}",
        )


@router.post("/admin/kra-kpi/confirm-paste")
async def confirm_kra_kpi_paste_endpoint(
    request: ConfirmPasteRequest,
    db: AsyncSession = Depends(get_db),
    admin_role: str = Depends(get_current_admin),
):
    """
    Save the confirmed parsed KRA/KPI and inferred JD to the employee's active session.
    """
    # Check if target employee has an approved JD session
    jd_res = await db.execute(
        select(JDSession).where(
            JDSession.employee_id == request.employee_id,
            JDSession.status == "approved"
        )
    )
    jd_session = jd_res.scalars().first()
    if not jd_session:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "MISSING_JD",
                "message": f"Employee {request.employee_name} ({request.employee_id}) does not have an approved Job Description yet. Please prepare/approve the JD first."
            }
        )

    from app.services.kra_kpi_service import save_kra_kpi_from_paste
    try:
        result = await save_kra_kpi_from_paste(
            db=db,
            employee_id=request.employee_id,
            employee_name=request.employee_name,
            jd_data=request.jd,
            kra_kpi_data=request.kra_kpi,
            admin_role=admin_role,
        )
        return {
            "status": "success",
            "message": "KRA/KPI framework confirmed and saved successfully to employee dashboard",
            "data": result,
        }
    except Exception as e:
        logger.error(f"[PASTE KRA] Save failed: {str(e)}")
        raise HTTPException(
            status_code=400,
            detail=f"Failed to confirm KRA/KPI paste: {str(e)}",
        )


class UpdateUploadedKRARequest(BaseModel):
    kras: dict


@router.put("/admin/kra-kpi/{employee_id}")
async def update_admin_kra_kpi(
    employee_id: str,
    request: UpdateUploadedKRARequest,
    db: AsyncSession = Depends(get_db),
    admin_role: str = Depends(get_current_admin),
):
    """
    Update KRA/KPI framework for an employee on the admin side.
    Updates UploadedKRAKPI if exists, otherwise updates KRAKPISession.
    """
    from app.models.kra_kpi_model import UploadedKRAKPI, KRAKPISession
    from app.core.cache import invalidate_pattern
    import logging
    
    logger = logging.getLogger(__name__)
    updated_any = False
    
    # 1. Try to find and update UploadedKRAKPI
    uploaded_res = await db.execute(
        select(UploadedKRAKPI).where(UploadedKRAKPI.employee_id == employee_id)
    )
    uploaded = uploaded_res.scalars().first()
    if uploaded:
        uploaded.kras = request.kras
        logger.info(f"Updated UploadedKRAKPI for employee {employee_id}")
        updated_any = True

    # 2. Try to find and update KRAKPISession
    session_res = await db.execute(
        select(KRAKPISession)
        .where(KRAKPISession.employee_id == employee_id)
        .order_by(KRAKPISession.updated_at.desc())
    )
    session_record = session_res.scalars().first()
    if session_record:
        session_record.kras = request.kras
        logger.info(f"Updated KRAKPISession for employee {employee_id}")
        updated_any = True
        
    if not updated_any:
        raise HTTPException(
            status_code=404,
            detail=f"No KRA/KPI framework found for employee {employee_id}."
        )
        
    await db.commit()
    
    # Invalidate cache patterns
    await invalidate_pattern(f"jds:employee:{employee_id}")
    if session_record:
        await invalidate_pattern(f"cache:jd_detail:*{session_record.jd_session_id}*")
        
    return {
        "status": "success",
        "message": "KRA/KPI framework updated successfully",
        "data": {
            "employee_id": employee_id,
            "kras": request.kras
        }
    }


