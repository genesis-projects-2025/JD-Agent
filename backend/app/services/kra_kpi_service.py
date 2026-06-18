# backend/app/services/kra_kpi_service.py
"""
KRA/KPI Service — Orchestrates the 3-step KRA/KPI selection flow:

  Step 1 (kra_selection):    Generate 6–7 KRA suggestions, employee picks 3–5
  Step 2 (kpi_selection):    For each selected KRA, generate 6–7 KPI suggestions, employee picks 3–5 per KRA
  Step 3 (weight_adjustment): Employee adjusts weights via drag-and-drop, then confirms

Prerequisites (ALL THREE must be present before Step 1):
  1. Employee JD Session  — generated JD with insights
  2. Manager JD Session   — manager's generated JD
  3. Manager KRA/KPI      — manager's confirmed or draft KRAKPISession
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.models.jd_session_model import JDSession
from app.models.kra_kpi_model import KRAKPISession
from app.models.user_model import Employee
from app.agents.kra_kpi_agent import (
    generate_kra_suggestions,
    generate_kpi_suggestions_for_kra,
)

logger = logging.getLogger(__name__)


# ── Custom Exceptions ─────────────────────────────────────────────────────────

class MissingPrerequisiteError(Exception):
    def __init__(self, missing: list[str], message: str):
        self.missing = missing
        self.message = message
        super().__init__(message)


class StepError(Exception):
    """Raised when an action is called on the wrong step."""
    pass


# ── Data Extraction Helpers ───────────────────────────────────────────────────

async def _get_manager_employee_id(db: AsyncSession, employee_id: str) -> str | None:
    result = await db.execute(select(Employee).where(Employee.id == employee_id))
    emp = result.scalar_one_or_none()
    if emp and emp.reporting_manager_code:
        return emp.reporting_manager_code
    return None


def _extract_code_from_reports_to(reports_to: str) -> str | None:
    import re
    match = re.search(r"\(([A-Z0-9]+)\)", reports_to)
    return match.group(1) if match else None


def _extract_jd_structured(session: JDSession) -> dict:
    structured = session.jd_structured or {}
    if not structured and session.jd_text:
        import json
        try:
            parsed = json.loads(session.jd_text)
            structured = parsed.get("jd_structured_data", parsed)
        except Exception:
            pass
    return structured


def _extract_employee_data(session: JDSession) -> dict:
    insights = session.insights or {}
    structured = _extract_jd_structured(session)
    identity = insights.get("identity_context", {})

    title = (
        identity.get("title")
        or structured.get("employee_information", {}).get("title")
        or session.title or ""
    )
    department = (
        identity.get("department")
        or structured.get("employee_information", {}).get("department")
        or session.department or ""
    )
    return {
        "title": title,
        "department": department,
        "purpose": insights.get("purpose") or structured.get("purpose") or "",
        "responsibilities": structured.get("responsibilities") or [],
        "priority_tasks": insights.get("priority_tasks") or [],
        "workflows": insights.get("workflows") or {},
        "skills": insights.get("skills") or structured.get("skills") or [],
        "tools": insights.get("tools") or structured.get("tools") or [],
    }


def _extract_manager_jd_data(session: JDSession) -> dict:
    structured = _extract_jd_structured(session)
    insights = session.insights or {}
    identity = insights.get("identity_context", {})
    return {
        "title": identity.get("title") or structured.get("employee_information", {}).get("title") or session.title or "",
        "department": identity.get("department") or session.department or "",
        "responsibilities": structured.get("responsibilities") or [],
    }


# ── Prerequisite Check ────────────────────────────────────────────────────────

COMPLETED_JD_STATUSES = {
    "jd_generated", "sent_to_manager", "manager_approved", "sent_to_hr",
    "hr_approved", "approved", "completed", "manager_rejected", "hr_rejected",
}


async def check_prerequisites(
    db: AsyncSession, jd_session_id: str, employee_id: str, bypass_manager: bool = False,
) -> dict[str, Any]:
    missing = []
    details = {}

    # 1. Employee JD
    emp_result = await db.execute(
        select(JDSession).where(JDSession.id == uuid.UUID(jd_session_id))
    )
    employee_session = emp_result.scalar_one_or_none()

    if not employee_session:
        missing.append("employee_jd")
        details["employee_jd"] = "Employee JD session not found."
    elif not employee_session.jd_text and not employee_session.jd_structured:
        missing.append("employee_jd")
        details["employee_jd"] = (
            "Employee JD has not been generated yet. "
            "Complete the interview and generate the JD first."
        )

    # 2. Manager ID
    manager_employee_id = None
    manager_jd_session = None
    manager_kra_session = None

    if not bypass_manager:
        manager_employee_id = await _get_manager_employee_id(db, employee_id)
        if not manager_employee_id and employee_session and employee_session.insights:
            ic = employee_session.insights.get("identity_context", {})
            manager_employee_id = _extract_code_from_reports_to(ic.get("reports_to", ""))

        if not manager_employee_id:
            missing += ["manager_jd", "manager_kra_kpi"]
            details["manager_jd"] = "Could not identify your reporting manager. Please contact HR to update your reporting structure."
            details["manager_kra_kpi"] = "Manager not identified — cannot check manager KRA/KPI."
            raise MissingPrerequisiteError(missing, _build_missing_message(details))

        # 3. Manager JD
        mgr_jd_result = await db.execute(
            select(JDSession)
            .where(JDSession.employee_id == manager_employee_id)
            .where(JDSession.status.in_(list(COMPLETED_JD_STATUSES)))
            .order_by(JDSession.updated_at.desc())
        )
        manager_jd_session = mgr_jd_result.scalars().first()

        if not manager_jd_session:
            missing.append("manager_jd")
            details["manager_jd"] = (
                f"Your manager's Job Description has not been generated yet. "
                f"Request your manager (ID: {manager_employee_id}) to complete their JD interview first."
            )

        # 4. Manager KRA/KPI
        mgr_kra_result = await db.execute(
            select(KRAKPISession)
            .where(KRAKPISession.employee_id == manager_employee_id)
            .where(KRAKPISession.status.in_(["confirmed", "draft"]))
            .order_by(KRAKPISession.updated_at.desc())
        )
        manager_kra_session = mgr_kra_result.scalars().first()

        if not manager_kra_session:
            missing.append("manager_kra_kpi")
            details["manager_kra_kpi"] = (
                f"Your manager's KRA/KPI framework has not been created yet. "
                f"Request your manager (ID: {manager_employee_id}) to generate their KRAs/KPIs first."
            )
    else:
        # Bypassed manager prerequisites, but let's try to fetch them optionally as reference anyway if they happen to exist!
        try:
            manager_employee_id = await _get_manager_employee_id(db, employee_id)
            if not manager_employee_id and employee_session and employee_session.insights:
                ic = employee_session.insights.get("identity_context", {})
                manager_employee_id = _extract_code_from_reports_to(ic.get("reports_to", ""))
            
            if manager_employee_id:
                mgr_jd_result = await db.execute(
                    select(JDSession)
                    .where(JDSession.employee_id == manager_employee_id)
                    .where(JDSession.status.in_(list(COMPLETED_JD_STATUSES)))
                    .order_by(JDSession.updated_at.desc())
                )
                manager_jd_session = mgr_jd_result.scalars().first()

                mgr_kra_result = await db.execute(
                    select(KRAKPISession)
                    .where(KRAKPISession.employee_id == manager_employee_id)
                    .where(KRAKPISession.status.in_(["confirmed", "draft"]))
                    .order_by(KRAKPISession.updated_at.desc())
                )
                manager_kra_session = mgr_kra_result.scalars().first()
        except Exception:
            pass

    if missing:
        raise MissingPrerequisiteError(missing, _build_missing_message(details))

    return {
        "employee_session": employee_session,
        "manager_employee_id": manager_employee_id,
        "manager_jd_session": manager_jd_session,
        "manager_kra_session": manager_kra_session,
    }


def _build_missing_message(details: dict) -> str:
    lines = ["❌ KRA/KPI generation requires the following missing information:\n"]
    if "employee_jd" in details:
        lines.append(f"📄 Employee JD: {details['employee_jd']}")
    if "manager_jd" in details:
        lines.append(f"👔 Manager JD: {details['manager_jd']}")
    if "manager_kra_kpi" in details:
        lines.append(f"🎯 Manager KRA/KPI: {details['manager_kra_kpi']}")
    lines.append("\nOnce all three are available, KRA/KPI generation will proceed automatically.")
    return "\n".join(lines)


# ── DB Helpers ────────────────────────────────────────────────────────────────

async def get_kra_kpi_by_jd_session(
    db: AsyncSession, jd_session_id: str,
) -> KRAKPISession | None:
    result = await db.execute(
        select(KRAKPISession)
        .where(KRAKPISession.jd_session_id == jd_session_id)
        .order_by(KRAKPISession.updated_at.desc())
    )
    return result.scalars().first()


# ── Step 1: Generate KRA Suggestions ─────────────────────────────────────────

async def generate_kra_suggestions_for_employee(
    db: AsyncSession, jd_session_id: str, employee_id: str, bypass_manager: bool = False,
) -> KRAKPISession:
    """
    Step 1: Check prerequisites → Generate 6–7 KRA suggestions → Save and return.
    Sets generation_step = 'kra_selection'.
    """
    context = await check_prerequisites(db, jd_session_id, employee_id, bypass_manager=bypass_manager)

    employee_session: JDSession = context["employee_session"]
    manager_jd_session: JDSession | None = context.get("manager_jd_session")
    manager_kra_session: KRAKPISession | None = context.get("manager_kra_session")
    manager_employee_id: str | None = context.get("manager_employee_id")

    employee_data = _extract_employee_data(employee_session)
    manager_jd_data = _extract_manager_jd_data(manager_jd_session) if manager_jd_session else {}
    manager_kras = (manager_kra_session.kras or {}).get("kras", []) if manager_kra_session else []

    logger.info(f"[KRAKPIService] Step 1: Generating KRA suggestions for employee={employee_id}")

    kra_payload = await generate_kra_suggestions(
        employee_data=employee_data,
        manager_jd_data=manager_jd_data,
        manager_kras_data=manager_kras,
    )

    now = datetime.now(timezone.utc)

    # Upsert
    existing = await get_kra_kpi_by_jd_session(db, jd_session_id)
    if existing:
        existing.kra_suggestions = kra_payload
        existing.selected_kra_ids = None
        existing.kpi_suggestions = None
        existing.selected_kpi_ids = None
        existing.kras = None
        existing.generation_step = "kra_selection"
        existing.status = "draft"
        existing.manager_employee_id = manager_employee_id
        existing.manager_jd_session_id = str(manager_jd_session.id) if manager_jd_session else None
        existing.manager_kra_kpi_session_id = str(manager_kra_session.id) if manager_kra_session else None
        existing.generation_model = "gemini-2.5-pro"
        existing.generation_error = None
        existing.generated_at = now
        existing.updated_at = now
        record = existing
    else:
        record = KRAKPISession(
            id=uuid.uuid4(),
            jd_session_id=jd_session_id,
            employee_id=employee_id,
            manager_employee_id=manager_employee_id,
            manager_jd_session_id=str(manager_jd_session.id) if manager_jd_session else None,
            manager_kra_kpi_session_id=str(manager_kra_session.id) if manager_kra_session else None,
            kra_suggestions=kra_payload,
            generation_step="kra_selection",
            status="draft",
            generation_model="gemini-2.5-pro",
            generated_at=now,
        )
        db.add(record)

    await db.commit()
    await db.refresh(record)
    return record


# ── Step 2: Select KRAs → Generate KPI Suggestions ───────────────────────────

async def select_kras_and_generate_kpis(
    db: AsyncSession,
    jd_session_id: str,
    selected_kra_ids: list[str],
) -> KRAKPISession:
    """
    Step 2: Employee selects 3–5 KRAs.
    For each selected KRA, generate 6–7 KPI suggestions in parallel.
    Sets generation_step = 'kpi_selection'.

    Validation: 3 ≤ len(selected_kra_ids) ≤ 5
    """
    if not (3 <= len(selected_kra_ids) <= 5):
        raise StepError(
            f"Please select between 3 and 5 KRAs. You selected {len(selected_kra_ids)}."
        )

    record = await get_kra_kpi_by_jd_session(db, jd_session_id)
    if not record:
        raise StepError("No KRA/KPI session found. Generate KRA suggestions first.")
    if record.generation_step not in ("kra_selection", "kpi_selection"):
        raise StepError(f"Cannot select KRAs in step: {record.generation_step}")

    # Resolve the full KRA objects for selected IDs
    all_suggestions = (record.kra_suggestions or {}).get("kra_suggestions", [])
    kra_map = {k["kra_id"]: k for k in all_suggestions}
    selected_kras = [kra_map[kid] for kid in selected_kra_ids if kid in kra_map]

    if not selected_kras:
        raise StepError("None of the selected KRA IDs match generated suggestions.")

    # Load employee data for KPI generation
    emp_session_result = await db.execute(
        select(JDSession).where(JDSession.id == uuid.UUID(record.jd_session_id))
    )
    emp_session = emp_session_result.scalar_one_or_none()
    if not emp_session:
        raise StepError("Employee JD session not found.")
    employee_data = _extract_employee_data(emp_session)

    logger.info(
        f"[KRAKPIService] Step 2: Generating KPI suggestions for {len(selected_kras)} KRAs in parallel"
    )

    # Generate KPI suggestions for all selected KRAs in parallel
    kpi_tasks = [
        generate_kpi_suggestions_for_kra(kra=kra, employee_data=employee_data)
        for kra in selected_kras
    ]
    results = await asyncio.gather(*kpi_tasks)

    # Index by kra_id
    kpi_suggestions = {r["kra_id"]: r for r in results}

    now = datetime.now(timezone.utc)
    record.selected_kra_ids = selected_kra_ids
    record.kpi_suggestions = kpi_suggestions
    record.selected_kpi_ids = None
    record.kras = None
    record.generation_step = "kpi_selection"
    record.updated_at = now

    await db.commit()
    await db.refresh(record)
    return record


# ── Step 3: Select KPIs → Build Final Weight-Adjustment Payload ───────────────

async def select_kpis_and_build_final(
    db: AsyncSession,
    jd_session_id: str,
    selected_kpi_ids: dict[str, list[str]],
) -> KRAKPISession:
    """
    Step 3a: Employee selects 3–5 KPIs per selected KRA.
    Builds the final KRA/KPI payload with equal initial weights.
    Sets generation_step = 'weight_adjustment'.

    selected_kpi_ids format: {"kra_001": ["kpi_001", "kpi_002", ...], ...}
    Validation: 3 ≤ len(kpi_ids) ≤ 5 per KRA
    """
    record = await get_kra_kpi_by_jd_session(db, jd_session_id)
    if not record:
        raise StepError("No KRA/KPI session found.")
    if record.generation_step not in ("kpi_selection", "weight_adjustment"):
        raise StepError(f"Cannot select KPIs in step: {record.generation_step}")

    # Validate KPI counts per KRA
    for kra_id, kpi_ids in selected_kpi_ids.items():
        if not (3 <= len(kpi_ids) <= 5):
            raise StepError(
                f"Select between 3 and 5 KPIs for each KRA. "
                f"KRA '{kra_id}' has {len(kpi_ids)} selected."
            )

    # Resolve full KRA objects
    all_suggestions = (record.kra_suggestions or {}).get("kra_suggestions", [])
    kra_map = {k["kra_id"]: k for k in all_suggestions}

    kpi_suggestion_map = record.kpi_suggestions or {}

    selected_kra_ids = record.selected_kra_ids or []

    # Build final KRAs list
    num_kras = len(selected_kra_ids)
    base_weight = 100 // num_kras
    remainder = 100 - (base_weight * num_kras)

    final_kras = []
    for i, kra_id in enumerate(selected_kra_ids):
        kra_base = kra_map.get(kra_id, {})
        kpi_ids = selected_kpi_ids.get(kra_id, [])

        # Get selected KPI full objects
        kpi_bank = kpi_suggestion_map.get(kra_id, {}).get("kpi_suggestions", [])
        kpi_obj_map = {k["kpi_id"]: k for k in kpi_bank}
        selected_kpis = [kpi_obj_map[kid] for kid in kpi_ids if kid in kpi_obj_map]

        weight = base_weight + (1 if i < remainder else 0)

        final_kras.append({
            "kra_id": kra_id,
            "title": kra_base.get("title", ""),
            "description": kra_base.get("description", ""),
            "source_tasks": kra_base.get("source_tasks", []),
            "weight": weight,
            "manager_impact": kra_base.get("manager_impact", ""),
            "kpis": selected_kpis,
        })

    now = datetime.now(timezone.utc)
    record.selected_kpi_ids = selected_kpi_ids
    record.kras = {"kras": final_kras, "total_weight": 100}
    record.generation_step = "weight_adjustment"
    record.updated_at = now

    await db.commit()
    await db.refresh(record)
    return record


# ── Step 4: Save Weight Adjustments and Confirm ───────────────────────────────

async def save_weights_and_confirm(
    db: AsyncSession,
    jd_session_id: str,
    kras_with_weights: list[dict],
    confirm: bool = False,
) -> KRAKPISession:
    """
    Step 3b: Save drag-and-drop weight adjustments.
    If confirm=True, locks the record (status = 'confirmed').
    Validates weights sum to 100.
    """
    total = sum(k.get("weight", 0) for k in kras_with_weights)
    if abs(total - 100) > 1:  # Allow ±1 for rounding
        raise StepError(f"KRA weights must sum to 100. Current total: {total}")

    record = await get_kra_kpi_by_jd_session(db, jd_session_id)
    if not record:
        raise StepError("No KRA/KPI session found.")

    # Normalize to exactly 100
    if total != 100:
        diff = 100 - total
        kras_with_weights[-1]["weight"] = kras_with_weights[-1]["weight"] + diff

    now = datetime.now(timezone.utc)
    record.kras = {"kras": kras_with_weights, "total_weight": 100}
    record.updated_at = now

    if confirm:
        record.generation_step = "confirmed"
        record.status = "confirmed"
        record.confirmed_at = now

    await db.commit()
    await db.refresh(record)
    return record


async def process_kra_kpi_document(
    db: AsyncSession,
    file_bytes: bytes,
    filename: str,
    file_type: str,  # "pdf" or "docx"
    employee_id: str,
    employee_name: str,
    admin_role: str,
) -> dict:
    from app.services.pdf_processor import PDFProcessor
    from app.services.docx_processor import DOCXProcessor
    from langchain_google_genai import ChatGoogleGenerativeAI
    from langchain_core.prompts import ChatPromptTemplate
    from app.core.config import settings
    from app.core.cache import invalidate_pattern
    from app.routers.admin_jd_routes import (
        _ensure_employee_record,
        generate_jd_text_from_structured_data,
        transform_reference_to_jd_session_schema,
    )
    import json

    file_type_lower = file_type.lower()
    
    # 1. Validate & Extract Text
    if file_type_lower == "pdf":
        is_valid, error_msg = PDFProcessor.validate_pdf(file_bytes)
        if not is_valid:
            raise Exception(f"Invalid PDF: {error_msg}")
        text = PDFProcessor.extract_text(file_bytes)
    elif file_type_lower == "docx":
        is_valid, error_msg = DOCXProcessor.validate_docx(file_bytes)
        if not is_valid:
            raise Exception(f"Invalid DOCX: {error_msg}")
        text = DOCXProcessor.extract_text(file_bytes)
    else:
        raise Exception(f"Unsupported file type: {file_type}")

    if not text or len(text.strip()) == 0:
        raise Exception("Extracted text is empty")

    # 2. Call Gemini to Parse KRA/KPI and JD
    llm = ChatGoogleGenerativeAI(
        google_api_key=settings.GEMINI_API_KEY,
        model="gemini-2.5-flash",
        temperature=0.2,
        max_output_tokens=8192,
        response_mime_type="application/json",
    )
    
    context = f"Employee ID: {employee_id}\nEmployee Name: {employee_name}\n"
    
    prompt = ChatPromptTemplate.from_template("""
    You are an expert HR analyst and organizational designer.
    Extract the KRA (Key Result Area) and KPI (Key Performance Indicator) framework from the provided text, and infer a professional Job Description (JD) matching the role.
    Return the result as a structured JSON object.

    {context}

    KRA/KPI DOCUMENT CONTENT:
    {text}

    EXTRACT AND RETURN A JSON OBJECT WITH THE FOLLOWING STRUCTURE:
    {{
      "jd": {{
        "role_title": "Job title/position (e.g. Senior Software Engineer)",
        "department": "Department or function (e.g. Engineering)",
        "level": "Seniority level (Junior, Mid, Senior, Lead, Head, Director, VP)",
        "purpose": "Inferred main purpose/mission of the role (50-100 words)",
        "tasks": ["Key responsibility 1", "Key responsibility 2", ...],
        "priority_tasks": ["Top priority task 1", "Top priority task 2", ...],
        "skills": ["Required technical or soft skill 1", "Required technical or soft skill 2", ...],
        "tools": ["Tool 1", "Tool 2", ...],
        "technologies": ["Technology/language 1", "Technology/language 2", ...],
        "qualifications": {{
          "education": "Required education (e.g. Bachelor's in CS)",
          "experience_years": "Years of experience (e.g. 5+ years)",
          "certifications": []
        }},
        "working_relationships": {{
          "reports_to": "Reporting manager role title",
          "team_size": "Approximate team size (e.g. 0-5)",
          "stakeholders": []
        }}
      }},
      "kra_kpi": {{
        "kras": [
          {{
            "kra_id": "kra_001",
            "title": "Title of the Key Result Area (e.g. Code Quality)",
            "description": "Description of the Key Result Area",
            "weight": 25,
            "manager_impact": "How this KRA impacts the manager's success",
            "source_tasks": ["Key responsibility 1"],
            "kpis": [
              {{
                "kpi_id": "kpi_001",
                "title": "Title/Metric description (e.g. Sprint Delivery Rate)",
                "description": "Measurement description or targets (e.g. 90% sprint tasks delivered on time)"
              }}
            ]
          }}
        ]
      }}
    }}

    CRITICAL CONSTRAINTS:
    1. Return ONLY valid JSON. Do not include markdown code block formatting (like ```json ... ```).
    2. The weights of all KRAs in the list must sum to exactly 100. If weights are not explicitly mentioned in the text, distribute them logically such that they sum to exactly 100.
    3. Make sure to generate unique IDs like kra_001, kra_002, kpi_001, kpi_002, etc.
    4. Be extremely thorough. Do not summarize or omit responsibilities or indicators.
    """)

    # Format prompt and call
    chain = prompt | llm
    response = await chain.ainvoke({"context": context, "text": text})
    
    # Parse JSON
    raw_content = response.content.strip()
    if raw_content.startswith("```json"):
        raw_content = raw_content[7:]
    elif raw_content.startswith("```"):
        raw_content = raw_content[3:]
    if raw_content.endswith("```"):
        raw_content = raw_content[:-3]
    raw_content = raw_content.strip()
    
    try:
        parsed_data = json.loads(raw_content)
    except Exception as e:
        logger.error(f"Failed to parse LLM response: {raw_content}")
        raise Exception(f"AI parsing did not return valid JSON: {str(e)}")

    extracted_jd = parsed_data.get("jd", {})
    extracted_kra_kpi = parsed_data.get("kra_kpi", {})
    kras_list = extracted_kra_kpi.get("kras", [])
    
    if not kras_list:
        raise Exception("No KRAs or KPIs could be extracted from the document")

    # 3. Ensure Employee Record
    employee = await _ensure_employee_record(db, employee_id, employee_name, extracted_jd.get("department"))

    # 4. Check/Create JD Session
    # Retrieve active JD session
    jd_session_result = await db.execute(
        select(JDSession)
        .where(JDSession.employee_id == employee_id)
        .order_by(JDSession.updated_at.desc())
    )
    jd_session = jd_session_result.scalars().first()
    
    # Transform structured JD data
    ref_jd_data = {
        "employee_id": employee_id,
        "employee_name": employee_name,
        "role_title": extracted_jd.get("role_title", "Unknown Role"),
        "department": extracted_jd.get("department", "Unknown"),
        "purpose": extracted_jd.get("purpose", ""),
        "tasks": extracted_jd.get("tasks", []),
        "priority_tasks": extracted_jd.get("priority_tasks", []),
        "skills": extracted_jd.get("skills", []),
        "tools": extracted_jd.get("tools", []),
        "technologies": extracted_jd.get("technologies", []),
        "qualifications": extracted_jd.get("qualifications", {}),
        "working_relationships": extracted_jd.get("working_relationships", {})
    }
    
    transformed_jd_structured = transform_reference_to_jd_session_schema(ref_jd_data)
    jd_text = generate_jd_text_from_structured_data(transformed_jd_structured)

    if not jd_session:
        jd_session = JDSession(
            id=uuid.uuid4(),
            employee_id=employee_id,
            title=extracted_jd.get("role_title", "Unknown Role"),
            department=extracted_jd.get("department", "Unknown"),
            jd_text=jd_text,
            jd_structured=transformed_jd_structured,
            status="approved",
            version=1
        )
        db.add(jd_session)
        await db.flush()
    else:
        # Update existing session to approved
        jd_session.title = extracted_jd.get("role_title", "Unknown Role")
        jd_session.department = extracted_jd.get("department", "Unknown")
        jd_session.jd_text = jd_text
        jd_session.jd_structured = transformed_jd_structured
        jd_session.status = "approved"
        await db.flush()

    # 5. Check/Create KRA/KPI Session
    # Retrieve active KRA/KPI session
    kra_result = await db.execute(
        select(KRAKPISession)
        .where(KRAKPISession.jd_session_id == str(jd_session.id))
        .order_by(KRAKPISession.updated_at.desc())
    )
    kra_session = kra_result.scalars().first()

    # Get manager details
    manager_employee_id = employee.reporting_manager_code
    manager_jd_session_id = None
    manager_kra_kpi_session_id = None

    if manager_employee_id:
        # Look for manager's active JDSession
        mgr_jd_res = await db.execute(
            select(JDSession)
            .where(JDSession.employee_id == manager_employee_id)
            .order_by(JDSession.updated_at.desc())
        )
        mgr_jd = mgr_jd_res.scalars().first()
        if mgr_jd:
            manager_jd_session_id = str(mgr_jd.id)

        # Look for manager's active KRAKPISession
        mgr_kra_res = await db.execute(
            select(KRAKPISession)
            .where(KRAKPISession.employee_id == manager_employee_id)
            .order_by(KRAKPISession.updated_at.desc())
        )
        mgr_kra = mgr_kra_res.scalars().first()
        if mgr_kra:
            manager_kra_kpi_session_id = str(mgr_kra.id)

    # Distribute weights if they don't sum to 100
    total_weight = sum(k.get("weight", 0) for k in kras_list)
    if total_weight != 100 and kras_list:
        # Adjust last one or normalize
        diff = 100 - total_weight
        kras_list[-1]["weight"] = kras_list[-1].get("weight", 0) + diff

    now = datetime.now(timezone.utc)
    kra_payload = {"kras": kras_list, "total_weight": 100}

    if not kra_session:
        kra_session = KRAKPISession(
            id=uuid.uuid4(),
            jd_session_id=str(jd_session.id),
            employee_id=employee_id,
            manager_employee_id=manager_employee_id,
            manager_jd_session_id=manager_jd_session_id,
            manager_kra_kpi_session_id=manager_kra_kpi_session_id,
            kra_suggestions={"kra_suggestions": kras_list},
            selected_kra_ids=[k.get("kra_id") for k in kras_list],
            kras=kra_payload,
            status="confirmed",
            generation_step="confirmed",
            generation_model="gemini-2.5-flash",
            generated_at=now,
            confirmed_at=now,
            created_at=now,
            updated_at=now
        )
        db.add(kra_session)
    else:
        kra_session.kras = kra_payload
        kra_session.status = "confirmed"
        kra_session.generation_step = "confirmed"
        kra_session.manager_employee_id = manager_employee_id
        kra_session.manager_jd_session_id = manager_jd_session_id
        kra_session.manager_kra_kpi_session_id = manager_kra_kpi_session_id
        kra_session.confirmed_at = now
        kra_session.updated_at = now

    await db.commit()
    await db.refresh(jd_session)
    await db.refresh(kra_session)

    # Invalidate caches
    await invalidate_pattern(f"jds:employee:{employee_id}")
    await invalidate_pattern("cache:manager_pending:*")
    
    return {
        "jd_session_id": str(jd_session.id),
        "kra_kpi_session_id": str(kra_session.id),
        "employee_id": employee_id,
        "employee_name": employee_name,
        "role_title": extracted_jd.get("role_title"),
        "department": extracted_jd.get("department"),
        "kras_count": len(kras_list),
        "status": "success",
    }


async def analyze_kra_kpi_text(
    employee_id: str,
    employee_name: str,
    content: str,
) -> dict:
    """
    Directly call Gemini on the pasted raw text content to extract structured KRA/KPI and JD.
    """
    from langchain_google_genai import ChatGoogleGenerativeAI
    from langchain_core.prompts import ChatPromptTemplate
    from app.core.config import settings
    import json
    
    if not content or len(content.strip()) == 0:
        raise Exception("Pasted content is empty")

    llm = ChatGoogleGenerativeAI(
        google_api_key=settings.GEMINI_API_KEY,
        model="gemini-2.5-flash",
        temperature=0.2,
        max_output_tokens=8192,
        response_mime_type="application/json",
    )
    
    context = f"Employee ID: {employee_id}\nEmployee Name: {employee_name}\n"
    
    prompt = ChatPromptTemplate.from_template("""
    You are an expert HR analyst and organizational designer.
    Extract the KRA (Key Result Area) and KPI (Key Performance Indicator) framework from the provided text, and infer a professional Job Description (JD) matching the role.
    Return the result as a structured JSON object.

    {context}

    PASTED KRA/KPI CONTENT:
    {text}

    EXTRACT AND RETURN A JSON OBJECT WITH THE FOLLOWING STRUCTURE:
    {{
      "jd": {{
        "role_title": "Job title/position (e.g. Senior Software Engineer)",
        "department": "Department or function (e.g. Engineering)",
        "level": "Seniority level (Junior, Mid, Senior, Lead, Head, Director, VP)",
        "purpose": "Inferred main purpose/mission of the role (50-100 words)",
        "tasks": ["Key responsibility 1", "Key responsibility 2", ...],
        "priority_tasks": ["Top priority task 1", "Top priority task 2", ...],
        "skills": ["Required technical or soft skill 1", "Required technical or soft skill 2", ...],
        "tools": ["Tool 1", "Tool 2", ...],
        "technologies": ["Technology/language 1", "Technology/language 2", ...],
        "qualifications": {{
          "education": "Required education (e.g. Bachelor's in CS)",
          "experience_years": "Years of experience (e.g. 5+ years)",
          "certifications": []
        }},
        "working_relationships": {{
          "reports_to": "Reporting manager role title",
          "team_size": "Approximate team size (e.g. 0-5)",
          "stakeholders": []
        }}
      }},
      "kra_kpi": {{
        "kras": [
          {{
            "kra_id": "kra_001",
            "title": "Title of the Key Result Area (e.g. Code Quality)",
            "description": "Description of the Key Result Area",
            "weight": 25,
            "manager_impact": "How this KRA impacts the manager's success",
            "source_tasks": ["Key responsibility 1"],
            "kpis": [
              {{
                "kpi_id": "kpi_001",
                "title": "Title/Metric description (e.g. Sprint Delivery Rate)",
                "description": "Measurement description or targets (e.g. 90% sprint tasks delivered on time)"
              }}
            ]
          }}
        ]
      }}
    }}

    CRITICAL CONSTRAINTS:
    1. Return ONLY valid JSON. Do not include markdown code block formatting (like ```json ... ```).
    2. The weights of all KRAs in the list must sum to exactly 100. If weights are not explicitly mentioned in the text, distribute them logically such that they sum to exactly 100.
    3. Make sure to generate unique IDs like kra_001, kra_002, kpi_001, kpi_002, etc.
    4. Be extremely thorough. Do not summarize or omit responsibilities or indicators.
    """)

    chain = prompt | llm
    response = await chain.ainvoke({"context": context, "text": content})
    
    raw_content = response.content.strip()
    if raw_content.startswith("```json"):
        raw_content = raw_content[7:]
    elif raw_content.startswith("```"):
        raw_content = raw_content[3:]
    if raw_content.endswith("```"):
        raw_content = raw_content[:-3]
    raw_content = raw_content.strip()
    
    try:
        parsed_data = json.loads(raw_content)
    except Exception as e:
        logger.error(f"Failed to parse LLM response: {raw_content}")
        raise Exception(f"AI parsing did not return valid JSON: {str(e)}")

    return parsed_data


async def save_kra_kpi_from_paste(
    db: AsyncSession,
    employee_id: str,
    employee_name: str,
    jd_data: dict,
    kra_kpi_data: dict,
    admin_role: str,
) -> dict:
    """
    Save the confirmed JD and KRA/KPI parsed from the paste action into the database.
    """
    import uuid
    from datetime import datetime, timezone
    from app.core.cache import invalidate_pattern
    from app.routers.admin_jd_routes import (
        _ensure_employee_record,
        generate_jd_text_from_structured_data,
        transform_reference_to_jd_session_schema,
    )
    
    # 1. Ensure Employee Record
    employee = await _ensure_employee_record(db, employee_id, employee_name, jd_data.get("department"))

    # 2. Check/Create JD Session
    # Retrieve active JD session
    jd_session_result = await db.execute(
        select(JDSession)
        .where(JDSession.employee_id == employee_id)
        .order_by(JDSession.updated_at.desc())
    )
    jd_session = jd_session_result.scalars().first()
    
    # Transform structured JD data
    transformed_jd_structured = transform_reference_to_jd_session_schema(jd_data)
    jd_text = generate_jd_text_from_structured_data(transformed_jd_structured)

    if not jd_session:
        jd_session = JDSession(
            id=uuid.uuid4(),
            employee_id=employee_id,
            title=jd_data.get("role_title", "Unknown Role"),
            department=jd_data.get("department", "Unknown"),
            jd_text=jd_text,
            jd_structured=transformed_jd_structured,
            status="approved",
            version=1
        )
        db.add(jd_session)
        await db.flush()
    else:
        # Update existing session to approved
        jd_session.title = jd_data.get("role_title", "Unknown Role")
        jd_session.department = jd_data.get("department", "Unknown")
        jd_session.jd_text = jd_text
        jd_session.jd_structured = transformed_jd_structured
        jd_session.status = "approved"
        await db.flush()

    # 3. Check/Create KRA/KPI Session
    # Retrieve active KRA/KPI session
    kra_result = await db.execute(
        select(KRAKPISession)
        .where(KRAKPISession.jd_session_id == str(jd_session.id))
        .order_by(KRAKPISession.updated_at.desc())
    )
    kra_session = kra_result.scalars().first()

    # Get manager details
    manager_employee_id = employee.reporting_manager_code
    manager_jd_session_id = None
    manager_kra_kpi_session_id = None

    if manager_employee_id:
        mgr_jd_res = await db.execute(
            select(JDSession)
            .where(JDSession.employee_id == manager_employee_id)
            .order_by(JDSession.updated_at.desc())
        )
        mgr_jd = mgr_jd_res.scalars().first()
        if mgr_jd:
            manager_jd_session_id = str(mgr_jd.id)

        mgr_kra_res = await db.execute(
            select(KRAKPISession)
            .where(KRAKPISession.employee_id == manager_employee_id)
            .order_by(KRAKPISession.updated_at.desc())
        )
        mgr_kra = mgr_kra_res.scalars().first()
        if mgr_kra:
            manager_kra_kpi_session_id = str(mgr_kra.id)

    kras_list = kra_kpi_data.get("kras", [])
    
    # Distribute weights if they don't sum to 100
    total_weight = sum(k.get("weight", 0) for k in kras_list)
    if total_weight != 100 and kras_list:
        diff = 100 - total_weight
        kras_list[-1]["weight"] = kras_list[-1].get("weight", 0) + diff

    now = datetime.now(timezone.utc)
    kra_payload = {"kras": kras_list, "total_weight": 100}

    if not kra_session:
        kra_session = KRAKPISession(
            id=uuid.uuid4(),
            jd_session_id=str(jd_session.id),
            employee_id=employee_id,
            manager_employee_id=manager_employee_id,
            manager_jd_session_id=manager_jd_session_id,
            manager_kra_kpi_session_id=manager_kra_kpi_session_id,
            kra_suggestions={"kra_suggestions": kras_list},
            selected_kra_ids=[k.get("kra_id") for k in kras_list],
            kras=kra_payload,
            status="confirmed",
            generation_step="confirmed",
            generation_model="gemini-2.5-flash",
            generated_at=now,
            confirmed_at=now,
            created_at=now,
            updated_at=now
        )
        db.add(kra_session)
    else:
        kra_session.kras = kra_payload
        kra_session.status = "confirmed"
        kra_session.generation_step = "confirmed"
        kra_session.manager_employee_id = manager_employee_id
        kra_session.manager_jd_session_id = manager_jd_session_id
        kra_session.manager_kra_kpi_session_id = manager_kra_kpi_session_id
        kra_session.confirmed_at = now
        kra_session.updated_at = now

    await db.commit()
    await db.refresh(jd_session)
    await db.refresh(kra_session)

    # Invalidate caches
    await invalidate_pattern(f"jds:employee:{employee_id}")
    await invalidate_pattern("cache:manager_pending:*")
    
    return {
        "jd_session_id": str(jd_session.id),
        "kra_kpi_session_id": str(kra_session.id),
        "employee_id": employee_id,
        "employee_name": employee_name,
        "role_title": jd_data.get("role_title"),
        "department": jd_data.get("department"),
        "kras_count": len(kras_list),
        "status": "success",
    }

