# backend/app/routers/admin_jd_routes.py
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import delete
from datetime import datetime, timezone
import uuid
import os
import logging
from pathlib import Path

# from app.dependencies.auth import get_current_admin
from app.core.database import get_db
from app.models.reference_jd_model import ReferenceJD
from app.models.jd_session_model import JDSession
from app.services.jd_intelligence import JDIntelligenceService
from app.services.pdf_processor import PDFProcessor

# Ensure uploads directory exists
UPLOADS_DIR = Path("uploads/jds")
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

router = APIRouter(prefix="/admin/jds", tags=["admin-jd"])
logger = logging.getLogger(__name__)


def transform_reference_to_jd_session_schema(ref_data: dict) -> dict:
    """Maps reference JD fields to jd_sessions.jd_structured format"""
    return {
        "employee_information": {
            "job_title": ref_data.get("role_title", ""),
            "department": ref_data.get("department", ""),
            "reports_to": ref_data.get("working_relationships", {}).get("reports_to", ""),
            "team_size": ref_data.get("working_relationships", {}).get("team_size", ""),
        },
        "purpose": ref_data.get("purpose", ""),
        "responsibilities": ref_data.get("tasks", []),
        "skills": ref_data.get("skills", []),
        "tools": ref_data.get("tools", []) + ref_data.get("technologies", []),
        "education": ref_data.get("qualifications", {}).get("education", ""),
        "experience": ref_data.get("qualifications", {}).get("experience_years", ""),
        "working_relationships": {
            "reports_to": ref_data.get("working_relationships", {}).get("reports_to", ""),
            "team_size": ref_data.get("working_relationships", {}).get("team_size", ""),
            "stakeholders": ref_data.get("working_relationships", {}).get("stakeholders", []),
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


@router.post("/upload")
async def upload_jd_pdf(
    file: UploadFile = File(...),
    employee_id: str = Form(...),
    employee_name: str = Form(...),
    db: AsyncSession = Depends(get_db),
    # admin_role: str = Depends(get_current_admin),
):
    """Upload and process a JD PDF"""
    # Validate file
    if not file.filename.lower().endswith('.pdf'):
        raise HTTPException(status_code=400, detail="Only PDF files are allowed")

    if file.size > 10 * 1024 * 1024:  # 10MB limit
        raise HTTPException(status_code=400, detail="File size exceeds 10MB limit")

    # Read file content
    pdf_bytes = await file.read()

    # Validate PDF
    is_valid, validation_msg = PDFProcessor.validate_pdf(pdf_bytes)
    if not is_valid:
        raise HTTPException(status_code=400, detail=f"Invalid PDF: {validation_msg}")

    # Process JD with AI (optional - will fallback to basic processing if API key is invalid)
    intelligence_service = JDIntelligenceService()
    try:
        result = await intelligence_service.process_jd_pdf(
            pdf_bytes=pdf_bytes,
            filename=file.filename,
            uploaded_by="admin",  # Since we commented out admin_role
            employee_id=employee_id,
            employee_name=employee_name
        )
    except Exception as ai_error:
        # If AI processing fails, create basic result structure
        logger.warning(f"AI processing failed for {file.filename}: {str(ai_error)}")
        logger.info("Falling back to basic PDF processing without AI")

        # Basic fallback - extract minimal metadata
        metadata = PDFProcessor.extract_metadata(pdf_bytes)
        text = PDFProcessor.extract_text(pdf_bytes)

        result = {
            "id": str(uuid.uuid4()),
            "employee_id": employee_id,
            "employee_name": employee_name,
            "structured_data": {
                "role_title": "Unknown Role (AI Processing Failed)",
                "department": "Unknown",
                "level": "Mid",
                "purpose": "PDF uploaded but AI processing failed. Please check API key configuration.",
                "tasks": ["PDF content available but not processed"],
                "priority_tasks": ["Manual review required"],
                "skills": [],
                "tools": [],
                "technologies": [],
                "qualifications": {
                    "education": "",
                    "experience_years": "",
                    "certifications": []
                },
                "working_relationships": {
                    "reports_to": "",
                    "team_size": "",
                    "stakeholders": []
                }
            },
            "pdf_filename": file.filename,
            "num_pages": metadata.get("num_pages", 0),
            "processing_status": "ai_failed",
            "uploaded_by": "admin",
            "uploaded_at": datetime.now(timezone.utc).isoformat(),
            "text_length": len(text),
        }

    # Generate JD ID
    jd_id = str(uuid.uuid4())

    # Save PDF file
    try:
        file_path = UPLOADS_DIR / f"{jd_id}_{file.filename}"
        with open(file_path, "wb") as f:
            f.write(pdf_bytes)
        file_saved = True
        pdf_path = str(file_path)
    except Exception as file_error:
        logger.warning(f"Failed to save PDF file: {str(file_error)}")
        file_saved = False
        pdf_path = None

    # Save to database (optional - will work without database for file processing demo)
    try:
        reference_jd = ReferenceJD(
            id=jd_id,
            employee_id=employee_id,
            employee_name=employee_name,
            department=result.get("structured_data", {}).get("department", ""),
            role_title=result.get("structured_data", {}).get("role_title", ""),
            level=result.get("structured_data", {}).get("level", "Mid"),
            structured_data=result.get("structured_data", {}),
            pdf_path=pdf_path,
            pdf_filename=file.filename,
            processing_status="processed" if result.get("processing_status") == "processed" else "ai_failed",
            uploaded_by="admin",
            uploaded_at=datetime.now(timezone.utc)
        )

        db.add(reference_jd)
        await db.commit()
        await db.refresh(reference_jd)
        db_saved = True
    except Exception as db_error:
        logger.warning(f"Failed to save to database: {str(db_error)}")
        db_saved = False
        reference_jd = None

    # Return appropriate response
    if file_saved and db_saved:
        return {
            "status": "success",
            "message": "JD uploaded, processed, and saved successfully",
            "data": {
                "id": jd_id,
                "role_title": result.get("structured_data", {}).get("role_title", "Unknown Role"),
                "department": result.get("structured_data", {}).get("department", "Unknown"),
                "employee_name": employee_name,
                "uploaded_at": datetime.now(timezone.utc).isoformat(),
                "processing_status": result.get("processing_status", "ai_failed"),
                "ai_processed": result.get("processing_status") == "processed"
            }
        }
    elif file_saved:
        return {
            "status": "partial_success",
            "message": "JD uploaded and processed, but database save failed. File is available locally.",
            "data": {
                "id": jd_id,
                "role_title": result.get("structured_data", {}).get("role_title", "Unknown Role"),
                "department": result.get("structured_data", {}).get("department", "Unknown"),
                "employee_name": employee_name,
                "uploaded_at": datetime.now(timezone.utc).isoformat(),
                "processing_status": result.get("processing_status", "ai_failed"),
                "ai_processed": result.get("processing_status") == "processed",
                "file_saved": True,
                "db_saved": False
            }
        }
    else:
        raise HTTPException(
            status_code=500,
            detail="Failed to save JD file. Please check file permissions and try again."
        )


@router.get("/")
async def list_reference_jds(
    skip: int = 0,
    limit: int = 50,
    db: AsyncSession = Depends(get_db),
    # admin_role: str = Depends(get_current_admin),
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
                "employee_name": jd.employee_name,
                "processing_status": jd.processing_status,
                "uploaded_at": jd.uploaded_at.isoformat(),
                "pdf_filename": jd.pdf_filename,
            }
            for jd in jds
        ],
        "total": len(jds),
        "skip": skip,
        "limit": limit
    }


@router.get("/{jd_id}")
async def get_reference_jd(
    jd_id: str,
    db: AsyncSession = Depends(get_db),
    # admin_role: str = Depends(get_current_admin),
):
    """Get a single reference JD"""
    result = await db.execute(select(ReferenceJD).where(ReferenceJD.id == jd_id))
    jd = result.scalar_one_or_none()

    if not jd:
        raise HTTPException(status_code=404, detail="JD not found")

    return {
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
        "published_at": jd.published_at.isoformat() if jd.published_at else None
    }


@router.delete("/{jd_id}")
async def delete_reference_jd(
    jd_id: str,
    db: AsyncSession = Depends(get_db),
    # admin_role: str = Depends(get_current_admin),
):
    """Delete a reference JD"""
    result = await db.execute(select(ReferenceJD).where(ReferenceJD.id == jd_id))
    jd = result.scalar_one_or_none()

    if not jd:
        raise HTTPException(status_code=404, detail="JD not found")

    # Delete file
    if jd.pdf_path and os.path.exists(jd.pdf_path):
        os.remove(jd.pdf_path)

    # Delete from database
    await db.execute(delete(ReferenceJD).where(ReferenceJD.id == jd_id))
    await db.commit()

    return {"status": "success", "message": "JD deleted successfully"}


@router.get("/{jd_id}/preview")
async def preview_reference_jd(
    jd_id: str,
    db: AsyncSession = Depends(get_db),
    # admin_role: str = Depends(get_current_admin),
):
    """Get transformed JD data and markdown for admin preview"""
    result = await db.execute(select(ReferenceJD).where(ReferenceJD.id == jd_id))
    jd = result.scalar_one_or_none()

    if not jd:
        raise HTTPException(status_code=404, detail="JD not found")

    # Transform to jd_sessions schema
    transformed_data = transform_reference_to_jd_session_schema(jd.structured_data)

    # Generate markdown text
    jd_text = generate_jd_text_from_structured_data(transformed_data)

    return {
        "data": {
            "id": jd.id,
            "jd_structured": transformed_data,
            "jd_text": jd_text,
            "role_title": jd.role_title,
            "department": jd.department
        }
    }


@router.post("/{jd_id}/publish")
async def publish_jd(
    jd_id: str,
    db: AsyncSession = Depends(get_db),
    # admin_role: str = Depends(get_current_admin),
):
    """
    Publish a JD (make it available for reference)
    Also creates/updates corresponding JD session for employee dashboard
    """

    result = await db.execute(select(ReferenceJD).where(ReferenceJD.id == jd_id))
    jd = result.scalar_one_or_none()

    if not jd:
        raise HTTPException(status_code=404, detail="JD not found")

    # Transform to jd_sessions schema
    transformed_data = transform_reference_to_jd_session_schema(jd.structured_data)

    # Generate markdown text
    jd_text = generate_jd_text_from_structured_data(transformed_data)

    jd.processing_status = "published"
    jd.published_at = datetime.now(timezone.utc)  # timezone-aware datetime

    # Check if a session already exists for this employee from this reference JD
    session_result = await db.execute(
        select(JDSession).where(
            JDSession.employee_id == jd.employee_id,
            JDSession.title == jd.role_title,  # Simple matching - could be improved
        )
    )
    existing_session = session_result.scalar_one_or_none()

    if existing_session:
        # Update existing session with transformed data
        from sqlalchemy import update
        await db.execute(
            update(JDSession)
            .where(JDSession.id == existing_session.id)
            .values(
                jd_text=jd_text,
                jd_structured=transformed_data,
                status="approved",
                updated_at=datetime.now(timezone.utc),
            )
        )
    else:
        # Create new session for employee dashboard visibility
        new_session = JDSession(
            employee_id=jd.employee_id,
            title=jd.role_title,
            department=jd.department,
            jd_text=jd_text,
            jd_structured=transformed_data,
            status="approved",
            version=1,
        )
        db.add(new_session)

    await db.commit()

    return {"status": "success", "message": "JD published successfully"}
