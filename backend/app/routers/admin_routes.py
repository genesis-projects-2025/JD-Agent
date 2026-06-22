from fastapi import APIRouter, Depends, HTTPException, File, Form, UploadFile
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


@router.get("/admin/kra-kpi/template")
async def download_kra_kpi_template(admin_role: str = Depends(get_current_admin)):
    """
    Download the KRA/KPI bulk upload Excel template.
    """
    import io
    import os
    from fastapi.responses import StreamingResponse

    # Build a fresh template using openpyxl
    try:
        import openpyxl
        from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
        from openpyxl.utils import get_column_letter
    except ImportError:
        raise HTTPException(status_code=500, detail="openpyxl not installed on server.")

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "KRA_KPI"

    headers = ["Employee_ID", "Employee_Name", "KRA_Title", "KRA_Weight_%", "KPI_Title", "KPI_Target_Date", "KPI_Description"]
    header_fill = PatternFill(start_color="1E3A5F", end_color="1E3A5F", fill_type="solid")
    header_font = Font(bold=True, color="FFFFFF", size=11)
    thin = Side(style="thin")
    border = Border(left=thin, right=thin, top=thin, bottom=thin)

    for col_idx, header in enumerate(headers, start=1):
        cell = ws.cell(row=1, column=col_idx, value=header)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        cell.border = border

    # Example rows
    example_rows = [
        ("EMP001", "Employee Name", "KRA Title 1", 40, "KPI Title 1", "2026-03-31", "Detailed description of this KPI"),
        ("EMP001", "Employee Name", "KRA Title 1", 40, "KPI Title 2", "2026-06-30", "Description of second KPI"),
        ("EMP001", "Employee Name", "KRA Title 2", 35, "KPI Title 3", "", "Description of third KPI"),
        ("EMP001", "Employee Name", "KRA Title 3", 25, "KPI Title 4", "2026-12-31", "Description of fourth KPI"),
    ]
    alt_fills = [
        PatternFill(start_color="F0F4FF", end_color="F0F4FF", fill_type="solid"),
        PatternFill(start_color="FFFFFF", end_color="FFFFFF", fill_type="solid"),
    ]
    for row_idx, row_data in enumerate(example_rows, start=2):
        fill = alt_fills[row_idx % 2]
        for col_idx, value in enumerate(row_data, start=1):
            cell = ws.cell(row=row_idx, column=col_idx, value=value)
            cell.fill = fill
            cell.alignment = Alignment(wrap_text=True, vertical="center")
            cell.border = border

    col_widths = [15, 22, 45, 15, 50, 18, 60]
    for col_idx, width in enumerate(col_widths, start=1):
        ws.column_dimensions[get_column_letter(col_idx)].width = width

    # Instructions sheet
    ws2 = wb.create_sheet("Instructions")
    ws2["A1"] = "KRA/KPI Bulk Upload Template – Instructions"
    ws2["A1"].font = Font(bold=True, size=14, color="1E3A5F")
    ws2["A3"] = "COLUMN GUIDE:"
    ws2["A3"].font = Font(bold=True)
    guide = [
        ("Employee_ID", "REQUIRED. Must match the exact Employee ID in the system (e.g., TD001, EMP001)."),
        ("Employee_Name", "REQUIRED. Full name of the employee."),
        ("KRA_Title", "REQUIRED. Key Result Area title. Repeat the same value on each row for all KPIs under this KRA."),
        ("KRA_Weight_%", "REQUIRED. Weight of this KRA as a whole number percentage (e.g., 25 for 25%). All KRA weights per employee must sum to 100."),
        ("KPI_Title", "REQUIRED. Title / metric description of the Key Performance Indicator under this KRA."),
        ("KPI_Target_Date", "OPTIONAL. Target completion date in YYYY-MM-DD format."),
        ("KPI_Description", "OPTIONAL. Detailed description, measurement criteria, or target for this KPI."),
    ]
    for i, (col, desc) in enumerate(guide, start=4):
        ws2.cell(row=i, column=1, value=col).font = Font(bold=True)
        ws2.cell(row=i, column=2, value=desc)
    ws2["A12"] = "IMPORTANT RULES:"
    ws2["A12"].font = Font(bold=True, color="CC0000")
    rules = [
        "1. Each row = ONE KPI. Multiple KPIs under the same KRA require the KRA columns repeated on each KPI row.",
        "2. You can include MULTIPLE employees in one file (use different Employee_ID values).",
        "3. KRA weights must add up to exactly 100 per employee.",
        "4. Each employee must have an approved Job Description in the system before uploading.",
        "5. Do NOT rename or reorder the column headers in row 1.",
    ]
    for i, rule in enumerate(rules, start=13):
        ws2.cell(row=i, column=1, value=rule)
    ws2.column_dimensions["A"].width = 25
    ws2.column_dimensions["B"].width = 85

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)

    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=KRA_KPI_Bulk_Upload_Template.xlsx"},
    )


@router.post("/admin/kra-kpi/bulk-upload")
async def bulk_upload_kra_kpi(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    admin_role: str = Depends(get_current_admin),
):
    """
    Bulk upload KRA/KPI for multiple employees from a single structured Excel template.
    The template must have columns: Employee_ID, Employee_Name, KRA_Title, KRA_Weight_%,
    KPI_Title, KPI_Target_Date (optional), KPI_Description (optional).

    Returns a per-employee result summary.
    """
    from app.models.kra_kpi_model import UploadedKRAKPI
    from app.core.cache import invalidate_pattern
    from app.services.kra_kpi_service import parse_kra_kpi_excel_bulk
    import uuid as uuid_mod

    fname = (file.filename or "").lower()
    content_type = file.content_type or ""
    if content_type == "application/octet-stream":
        if fname.endswith(".xlsx"):
            content_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        elif fname.endswith(".xls"):
            content_type = "application/vnd.ms-excel"

    allowed = {
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
        "application/vnd.ms-excel": "xls",
    }
    if content_type not in allowed:
        raise HTTPException(
            status_code=400,
            detail="Bulk upload only accepts Excel files (.xlsx or .xls). Use the template provided.",
        )
    file_type = allowed[content_type]
    file_bytes = await file.read()
    if len(file_bytes) > 10 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="File too large. Maximum 10MB.")

    # Parse the bulk template
    try:
        parsed = parse_kra_kpi_excel_bulk(file_bytes, file_type)
    except ValueError as e:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid template format: {str(e)}. Please download and use the official template.",
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to parse Excel file: {str(e)}")

    results = []
    for emp_id, emp_data in parsed.items():
        emp_name = emp_data.get("employee_name", "")
        kras = emp_data.get("kras", [])

        # Check if employee exists
        emp_res = await db.execute(select(Employee).where(Employee.id == emp_id))
        employee = emp_res.scalars().first()
        if not employee:
            results.append({
                "employee_id": emp_id,
                "employee_name": emp_name,
                "status": "error",
                "message": f"Employee ID '{emp_id}' not found in the system.",
            })
            continue

        # Check approved JD
        jd_res = await db.execute(
            select(JDSession).where(
                JDSession.employee_id == emp_id,
                JDSession.status == "approved",
            )
        )
        jd_session = jd_res.scalars().first()
        if not jd_session:
            results.append({
                "employee_id": emp_id,
                "employee_name": emp_name,
                "status": "error",
                "message": f"No approved Job Description found for {emp_name} ({emp_id}). Approve their JD first.",
            })
            continue

        # Validate weight sum
        defined_weights = [k.get("weight") for k in kras if k.get("weight") is not None]
        if defined_weights:
            total_weight = sum(defined_weights)
            if abs(total_weight - 100) > 1:
                results.append({
                    "employee_id": emp_id,
                    "employee_name": emp_name,
                    "status": "error",
                    "message": f"KRA weights sum to {total_weight}% instead of 100% for {emp_name} ({emp_id}). Please fix the weights.",
                })
                continue

        try:
            # Upsert into UploadedKRAKPI
            existing_res = await db.execute(
                select(UploadedKRAKPI).where(UploadedKRAKPI.employee_id == emp_id)
            )
            existing = existing_res.scalars().first()
            kras_payload = {"kras": kras}
            if existing:
                existing.kras = kras_payload
                existing.employee_name = emp_name or employee.name
            else:
                record = UploadedKRAKPI(
                    id=uuid_mod.uuid4(),
                    employee_id=emp_id,
                    employee_name=emp_name or employee.name,
                    kras=kras_payload,
                )
                db.add(record)
            await db.flush()

            results.append({
                "employee_id": emp_id,
                "employee_name": emp_name or employee.name,
                "status": "success",
                "kras_count": len(kras),
                "kpis_count": sum(len(k.get("kpis", [])) for k in kras),
                "message": f"KRA/KPI saved successfully for {emp_name} ({emp_id}).",
            })
        except Exception as e:
            logger.error(f"[BULK KRA] Save failed for {emp_id}: {e}")
            results.append({
                "employee_id": emp_id,
                "employee_name": emp_name,
                "status": "error",
                "message": f"Failed to save KRA/KPI for {emp_id}: {str(e)}",
            })

    await db.commit()

    # Invalidate caches
    await invalidate_pattern("cache:jd_list:*")
    await invalidate_pattern("cache:dept_stats:*")

    success_count = sum(1 for r in results if r["status"] == "success")
    error_count = len(results) - success_count
    return {
        "status": "done",
        "summary": {
            "total": len(results),
            "success": success_count,
            "errors": error_count,
        },
        "results": results,
    }


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

