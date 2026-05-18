import asyncio
import logging
import os
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload
from pathlib import Path

from app.core.config import settings
from app.core.database import get_db
from app.models.jd_session_model import JDSession
from app.models.reference_jd_model import ReferenceJD
from app.models.user_model import Employee
from app.routers.admin_routes import get_current_admin
from app.services.jd_intelligence import JDIntelligenceService
from app.services.pdf_processor import PDFProcessor
from app.services.vector_service import index_approved_jd

# Ensure uploads directory exists
UPLOADS_DIR = settings.jd_upload_dir
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

router = APIRouter(prefix="/admin/jds", tags=["admin-jd"])
logger = logging.getLogger(__name__)


async def _ensure_employee_record(
    db: AsyncSession,
    employee_id: str,
    employee_name: str,
    department: str | None = None,
) -> Employee:
    employee = await db.get(Employee, employee_id)
    if employee:
        if employee_name and employee.name != employee_name:
            employee.name = employee_name
        if department and not employee.department:
            employee.department = department
        return employee

    from sqlalchemy import text

    org_result = await db.execute(
        text(
            """
            SELECT code, employee_name, department, reporting_manager, reporting_manager_code
            FROM organogram
            WHERE code = :code
        """
        ),
        {"code": employee_id},
    )
    org_row = org_result.mappings().first()

    employee = Employee(
        id=employee_id,
        name=(org_row.get("employee_name") if org_row else None)
        or employee_name
        or "Unknown Employee",
        email=None,
        department=(org_row.get("department") if org_row else None) or department,
        reporting_manager=org_row.get("reporting_manager") if org_row else None,
        reporting_manager_code=org_row.get("reporting_manager_code")
        if org_row
        else None,
        role="employee",
        phone_mobile=None,
    )
    db.add(employee)
    await db.flush()
    return employee


async def _sync_published_reference_jd(
    db: AsyncSession,
    jd: ReferenceJD,
    *,
    commit: bool,
) -> JDSession:
    # pyrefly: ignore [bad-argument-type]
    transformed_data = transform_reference_to_jd_session_schema(
        # pyrefly: ignore [bad-argument-type]
        jd.structured_data or {}
    )
    jd_text = generate_jd_text_from_structured_data(transformed_data)

    await _ensure_employee_record(
        db,
        # pyrefly: ignore [bad-argument-type]
        jd.employee_id,
        # pyrefly: ignore [bad-argument-type]
        jd.employee_name or "Unknown Employee",
        # pyrefly: ignore [bad-argument-type]
        jd.department,
    )

    result = await db.execute(
        select(JDSession)
        .options(selectinload(JDSession.employee))
        .where(JDSession.source_reference_jd_id == jd.id)
    )
    session = result.scalar_one_or_none()

    if session is None:
        session = JDSession(
            employee_id=jd.employee_id,
            source_reference_jd_id=jd.id,
            title=jd.role_title,
            department=jd.department,
            jd_text=jd_text,
            jd_structured=transformed_data,
            status="approved",
            version=1,
        )
        db.add(session)
    else:
        session.employee_id = jd.employee_id
        session.title = jd.role_title
        session.department = jd.department
        session.jd_text = jd_text
        session.jd_structured = transformed_data
        session.status = "approved"

    # pyrefly: ignore [bad-assignment]
    jd.processing_status = "published"
    # pyrefly: ignore [bad-assignment]
    jd.published_at = jd.published_at or datetime.now(timezone.utc)

    await db.flush()
    if commit:
        await db.commit()
        await db.refresh(session)

    asyncio.create_task(
        index_approved_jd(
            jd_id=str(session.id),
            structured_data=transformed_data,
            # pyrefly: ignore [bad-argument-type]
            department=jd.department or "General",
            # pyrefly: ignore [bad-argument-type]
            title_override=jd.role_title,
            # pyrefly: ignore [bad-argument-type]
            experience_level=jd.level or "Mid",
            source="published_reference_jd",
        )
    )

    return session


def transform_reference_to_jd_session_schema(ref_data: dict) -> dict:
    """Maps reference JD fields to jd_sessions.jd_structured format"""
    if not isinstance(ref_data, dict):
        import json
        if isinstance(ref_data, str):
            try:
                ref_data = json.loads(ref_data)
            except:
                ref_data = {}
        else:
            ref_data = {}

    def safe_get_dict(d, key):
        val = d.get(key)
        return val if isinstance(val, dict) else {}

    def safe_get_list(d, key):
        val = d.get(key)
        return val if isinstance(val, list) else []

    wr = safe_get_dict(ref_data, "working_relationships")
    qual = safe_get_dict(ref_data, "qualifications")

    # Combine tools and technologies safely
    tools_list = safe_get_list(ref_data, "tools")
    tech_list = safe_get_list(ref_data, "technologies")
    combined_tools = tools_list + tech_list

    return {
        "employee_information": {
            "job_title": ref_data.get("role_title") or ref_data.get("title") or "Unknown",
            "department": ref_data.get("department") or "Unknown",
            "reports_to": wr.get("reports_to") or "",
            "team_size": wr.get("team_size") or "",
        },
        "purpose": ref_data.get("purpose") or "",
        "responsibilities": safe_get_list(ref_data, "tasks") or safe_get_list(ref_data, "responsibilities"),
        "skills": safe_get_list(ref_data, "skills"),
        "tools": combined_tools,
        "education": qual.get("education") or "",
        "experience": qual.get("experience_years") or qual.get("experience") or "",
        "working_relationships": {
            "reports_to": wr.get("reports_to") or "",
            "team_size": wr.get("team_size") or "",
            "stakeholders": safe_get_list(wr, "stakeholders"),
        },
    }


def generate_jd_text_from_structured_data(structured_data: dict) -> str:
    """Generate markdown text from structured JD data for employee dashboard"""
    md = []

    # Employee Information
    emp_info = structured_data.get("employee_information", {})
    md.append(f"# {emp_info.get('job_title', 'Job Title')}")
    md.append(f"**Department:** {emp_info.get('department', '')}")
    md.append(f"**Reports to:** {emp_info.get('reports_to', '')}")
    md.append(f"**Team Size:** {emp_info.get('team_size', '')}")
    md.append("")

    # Purpose
    if structured_data.get("purpose"):
        md.append("## Purpose")
        md.append(structured_data["purpose"])
        md.append("")

    # Responsibilities
    if structured_data.get("responsibilities"):
        md.append("## Responsibilities")
        for resp in structured_data["responsibilities"]:
            md.append(f"- {resp}")
        md.append("")

    # Skills
    if structured_data.get("skills"):
        md.append("## Skills")
        for skill in structured_data["skills"]:
            md.append(f"- {skill}")
        md.append("")

    # Tools
    if structured_data.get("tools"):
        md.append("## Tools & Technologies")
        for tool in structured_data["tools"]:
            md.append(f"- {tool}")
        md.append("")

    # Education
    if structured_data.get("education"):
        md.append("## Education")
        md.append(structured_data["education"])
        md.append("")

    # Experience
    if structured_data.get("experience"):
        md.append("## Experience")
        md.append(structured_data["experience"])
        md.append("")

    # Working Relationships
    wr = structured_data.get("working_relationships", {})
    if any([wr.get("reports_to"), wr.get("team_size"), wr.get("stakeholders")]):
        md.append("## Working Relationships")
        if wr.get("reports_to"):
            md.append(f"**Reports to:** {wr['reports_to']}")
        if wr.get("team_size"):
            md.append(f"**Team Size:** {wr['team_size']}")
        if wr.get("stakeholders"):
            md.append("**Key Stakeholders:**")
            for stakeholder in wr["stakeholders"]:
                md.append(f"- {stakeholder}")
        md.append("")

    return "\n".join(md)


# REPLACEMENT FOR: @router.post("/upload") endpoint in admin_jd_routes.py
# Replace lines 255-390 in your current admin_jd_routes.py with this:


@router.post("/upload")
async def upload_jd_document(
    file: UploadFile = File(...),
    employee_id: str = Form(...),
    employee_name: str = Form(...),
    db: AsyncSession = Depends(get_db),
    admin_role: str = Depends(get_current_admin),
):
    """
    Upload and process JD document (DOCX, DOC, or PDF)
    Multi-page extraction with complete content preservation
    """

    # ===== STEP 1: VALIDATE FILE TYPE =====
    allowed_types = {
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
        "application/msword": "doc",
        "application/pdf": "pdf",
    }

    if file.content_type not in allowed_types:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid file type. Accepted: DOCX, DOC, PDF. Got: {file.content_type}",
        )

    file_type = allowed_types[file.content_type]

    # ===== STEP 2: READ FILE =====
    file_content = await file.read()

    # Validate file size (10MB max)
    if len(file_content) > 10 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="File too large. Maximum 10MB")

    # ===== STEP 3: ENSURE EMPLOYEE EXISTS =====
    try:
        employee = await _ensure_employee_record(db, employee_id, employee_name)
        logger.info(f"[UPLOAD] Employee {employee_id} ensured in database")
    except Exception as e:
        logger.warning(f"[UPLOAD] Warning ensuring employee: {str(e)}")

    # ===== STEP 4: GENERATE IDS =====
    jd_id = str(uuid.uuid4())
    logger.info(f"[UPLOAD] Processing {file.filename} with ID {jd_id}")

    # ===== STEP 5: PROCESS WITH JD INTELLIGENCE =====
    intelligence_service = JDIntelligenceService()
    # Uses new multi-page extraction
    try:
        result = await intelligence_service.process_jd_document(
            file_bytes=file_content,
            # pyrefly: ignore [bad-argument-type]
            filename=file.filename,
            file_type=file_type,
            uploaded_by=admin_role,
            employee_id=employee_id,
            employee_name=employee_name,
        )
    except Exception as e:
        logger.error(f"[UPLOAD] Processing failed: {str(e)}")
        raise HTTPException(
            status_code=400,
            detail=f"Failed to process JD: {str(e)}",
        )

    logger.info(
        f"[UPLOAD] Processing successful. Extracted {result.get('char_count', 0)} chars"
    )

    # ===== STEP 6: SAVE FILE =====
    file_saved = False
    pdf_path = None
    try:
        # Save original file
        file_path = UPLOADS_DIR / f"{jd_id}_{file.filename}"
        file_path.parent.mkdir(parents=True, exist_ok=True)
        with open(file_path, "wb") as f:
            f.write(file_content)

        pdf_path = str(file_path)
        file_saved = True
        logger.info(f"[UPLOAD] File saved to {pdf_path}")
    except Exception as file_error:
        logger.warning(f"[UPLOAD] File save failed: {str(file_error)}")
        file_saved = False

    # ===== STEP 7: SAVE TO REFERENCE_JD TABLE =====
    db_saved = False
    reference_jd = None
    try:
        structured_data = result.get("structured_data", {})

        reference_jd = ReferenceJD(
            id=jd_id,
            employee_id=employee_id,
            employee_name=employee_name,
            department=structured_data.get("department", "Unknown"),
            role_title=structured_data.get("role_title", "Unknown"),
            level=structured_data.get("level", "Mid-level"),
            structured_data=structured_data,
            pdf_path=pdf_path,
            pdf_filename=file.filename,
            processing_status="processed"
            if result.get("processing_status") == "processed"
            else "ai_failed",
            uploaded_by=admin_role,
            uploaded_at=datetime.now(timezone.utc),
        )

        db.add(reference_jd)
        await db.commit()
        await db.refresh(reference_jd)
        db_saved = True
        logger.info(f"[UPLOAD] Saved to ReferenceJD: {jd_id}")
    except Exception as db_error:
        logger.warning(f"[UPLOAD] Database save failed: {str(db_error)}")
        db_saved = False
        reference_jd = None

    # ===== STEP 8: RETURN RESPONSE =====
    structured_data = result.get("structured_data", {})

    if file_saved and db_saved:
        return {
            "status": "success",
            "message": f"{file_type.upper()} uploaded, processed, and saved successfully",
            "data": {
                "id": jd_id,
                "role_title": structured_data.get("role_title", "Unknown Role"),
                "department": structured_data.get("department", "Unknown"),
                "employee_name": employee_name,
                "employee_id": employee_id,
                "file_type": file_type,
                "uploaded_at": datetime.now(timezone.utc).isoformat(),
                "processing_status": result.get("processing_status", "ai_failed"),
                "ai_processed": result.get("processing_status") == "processed",
                "char_count": result.get("char_count", 0),  # Multi-page stat
            },
        }
    elif file_saved:
        return {
            "status": "partial_success",
            "message": f"{file_type.upper()} uploaded and processed, but database save failed.",
            "data": {
                "id": jd_id,
                "role_title": structured_data.get("role_title", "Unknown Role"),
                "department": structured_data.get("department", "Unknown"),
                "employee_name": employee_name,
                "file_type": file_type,
                "uploaded_at": datetime.now(timezone.utc).isoformat(),
                "processing_status": result.get("processing_status", "ai_failed"),
                "ai_processed": result.get("processing_status") == "processed",
                "file_saved": True,
                "db_saved": False,
                "char_count": result.get("char_count", 0),
            },
        }
    else:
        raise HTTPException(
            status_code=500,
            detail="Failed to save JD file. Please check file permissions and try again.",
        )


@router.get("/")
async def list_reference_jds(
    skip: int = 0,
    limit: int = 50,
    db: AsyncSession = Depends(get_db),
    admin_role: str = Depends(get_current_admin),
):
    """List all reference JDs"""
    result = await db.execute(
        select(ReferenceJD)
        .offset(skip)
        .limit(limit)
        .order_by(ReferenceJD.uploaded_at.desc())
    )
    jds = result.scalars().all()

    return {
        "data": [
            {
                "id": jd.id,
                "role_title": jd.role_title,
                "department": jd.department,
                "level": jd.level,
                "employee_id": jd.employee_id,
                "employee_name": jd.employee_name,
                "processing_status": jd.processing_status,
                "uploaded_at": jd.uploaded_at.isoformat(),
                "pdf_filename": jd.pdf_filename,
            }
            for jd in jds
        ],
        "total": len(jds),
        "skip": skip,
        "limit": limit,
    }


@router.get("/{jd_id}")
async def get_reference_jd(
    jd_id: str,
    db: AsyncSession = Depends(get_db),
    admin_role: str = Depends(get_current_admin),
):
    """Get a single reference JD"""
    result = await db.execute(select(ReferenceJD).where(ReferenceJD.id == jd_id))
    jd = result.scalar_one_or_none()

    if not jd:
        raise HTTPException(status_code=404, detail="JD not found")

    return {
        "data": {
            "id": jd.id,
            "role_title": jd.role_title,
            "department": jd.department,
            "level": jd.level,
            "employee_name": jd.employee_name,
            "employee_id": jd.employee_id,
            "structured_data": jd.structured_data,
            "pdf_filename": jd.pdf_filename,
            "processing_status": jd.processing_status,
            "uploaded_at": jd.uploaded_at.isoformat(),
            "published_at": jd.published_at.isoformat() if jd.published_at else None,
            "uploaded_by": jd.uploaded_by,
        }
    }


@router.delete("/{jd_id}")
async def delete_reference_jd(
    jd_id: str,
    db: AsyncSession = Depends(get_db),
    admin_role: str = Depends(get_current_admin),
):
    """Delete a reference JD"""
    result = await db.execute(select(ReferenceJD).where(ReferenceJD.id == jd_id))
    jd = result.scalar_one_or_none()

    if not jd:
        raise HTTPException(status_code=404, detail="JD not found")

    # Delete file
    # pyrefly: ignore [bad-argument-type]
    if jd.pdf_path and os.path.exists(jd.pdf_path):
        # pyrefly: ignore [bad-argument-type]
        os.remove(jd.pdf_path)

    # Delete from database
    await db.execute(delete(ReferenceJD).where(ReferenceJD.id == jd_id))
    await db.commit()

    return {"status": "success", "message": "JD deleted successfully"}


@router.get("/{jd_id}/preview")
async def preview_reference_jd(
    jd_id: str,
    db: AsyncSession = Depends(get_db),
    admin_role: str = Depends(get_current_admin),
):
    """Get transformed JD data and markdown for admin preview"""
    result = await db.execute(select(ReferenceJD).where(ReferenceJD.id == jd_id))
    jd = result.scalar_one_or_none()

    if not jd:
        raise HTTPException(status_code=404, detail="JD not found")

    # Transform to jd_sessions schema
    # pyrefly: ignore [bad-argument-type]
    transformed_data = transform_reference_to_jd_session_schema(jd.structured_data)

    # Generate markdown text
    jd_text = generate_jd_text_from_structured_data(transformed_data)

    return {
        "data": {
            "id": jd.id,
            "jd_structured": transformed_data,
            "jd_text": jd_text,
            "reference_data": {
                "id": jd.id,
                "role_title": jd.role_title,
                "department": jd.department,
                "processing_status": jd.processing_status,
                "employee_id": jd.employee_id,
                "employee_name": jd.employee_name,
            },
        }
    }


@router.post("/{jd_id}/publish")
async def publish_jd(
    jd_id: str,
    db: AsyncSession = Depends(get_db),
    admin_role: str = Depends(get_current_admin),
):
    """
    Publish a JD (make it available for reference)
    Also creates/updates corresponding JD session for employee dashboard
    """

    result = await db.execute(select(ReferenceJD).where(ReferenceJD.id == jd_id))
    jd = result.scalar_one_or_none()

    if not jd:
        raise HTTPException(status_code=404, detail="JD not found")

    session = await _sync_published_reference_jd(db, jd, commit=True)

    return {
        "status": "success",
        "message": "JD published successfully",
        "data": {
            "reference_jd_id": jd.id,
            "jd_session_id": str(session.id),
            "employee_id": jd.employee_id,
            "processing_status": jd.processing_status,
            "published_at": jd.published_at.isoformat() if jd.published_at else None,
        },
    }
