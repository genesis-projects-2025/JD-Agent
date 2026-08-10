# backend/app/services/darwinbox_jd_exporter_service.py
import csv
import io
import re
import uuid
import logging
from typing import Optional, Any
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from app.models.jd_session_model import JDSession

logger = logging.getLogger(__name__)

# Order MUST match Job_Descriptions (1).csv EXACTLY
DARWINBOX_JD_HEADERS = [
    "Job Description Title*", "Designation Code*", "Office Location Work Area Code", "Position Description",
    "Experience From (Years)", "Experience To (Years)", "Salary Currency", "Salary Range - Min",
    "Salary Range - Max", "Salary Timeframe", "Primary Responsibilities", "Additional Responsibilities",
    "Reporting Team - Reporting Designation Code", "Reporting Team - Reporting Department Code",
    "Education - Category", "Education - Category - Other", "Education - Field of Specialisation",
    "Education - Field of Specialisation - Other", "Education - Degree", "Education - Degree - Other",
    "Institution Tier", "Academic Score", "Required Certification/s", "Required Training/s",
    "Work Experience - Industry", "Work Experience - Role", "Work Experience - From (Years)",
    "Work Experience - To (Years)", "Key Performance Indicators", "Required Competencies",
    "Required Knowledge", "Required Skills", "Required Abilities - Physical", "Required Abilities - Other",
    "Work Environment Details", "Specific Requirements - Travel", "Specific Requirements - Vehicle",
    "Specific Requirements - Work Permit", "Other Details - Pay Rate", "Other Details - Contract Types",
    "Other Details - Time Constraints", "Other Details - Compliance Related", "Other Details - Union Affiliation",
    "Job Description File Name", "Is Draft", "Competencies"
]

def parse_experience_range(exp_str: Optional[str]) -> tuple[Optional[int], Optional[int]]:
    """Robustly extracts min and max years of experience from a string (e.g. '0-2 years')."""
    if not exp_str:
        return None, None
    nums = re.findall(r"\d+", exp_str)
    if len(nums) >= 2:
        return int(nums[0]), int(nums[1])
    elif len(nums) == 1:
        if "+" in exp_str or "above" in exp_str.lower() or "more" in exp_str.lower():
            return int(nums[0]), None
        return int(nums[0]), int(nums[0])
    return None, None

async def generate_darwinbox_jd_csv(db: AsyncSession, jd_session_id: str) -> str:
    """
    Generates a Darwinbox-compatible CSV string for a single Job Description session.
    Queries the organogram to pull designations, locations, and manager hierarchies.
    """
    # 1. Fetch JD Session
    try:
        session_uuid = uuid.UUID(str(jd_session_id))
    except ValueError:
        raise ValueError(f"Invalid JD session ID: {jd_session_id}")

    res = await db.execute(select(JDSession).where(JDSession.id == session_uuid))
    session_rec = res.scalar_one_or_none()
    if not session_rec:
        raise ValueError("Job Description session not found.")

    jd_structured = session_rec.jd_structured or {}
    emp_id = session_rec.employee_id

    # 2. Fetch Employee details from organogram
    emp_desig, emp_loc, emp_dept, mgr_code = "", "", "", ""
    if emp_id:
        try:
            async with db.begin_nested():
                emp_res = await db.execute(
                    text("SELECT designation, location, department, reporting_manager_code FROM organogram WHERE code = :code"),
                    {"code": emp_id}
                )
            emp_org = emp_res.mappings().first()
            if emp_org:
                emp_desig = emp_org.get("designation") or ""
                emp_loc = emp_org.get("location") or ""
                emp_dept = emp_org.get("department") or ""
                mgr_code = emp_org.get("reporting_manager_code") or ""
        except Exception as e:
            logger.error(f"Error querying organogram for employee {emp_id}: {e}")

    # 3. Fetch Manager details from organogram
    mgr_desig, mgr_dept = "", ""
    if mgr_code:
        try:
            async with db.begin_nested():
                mgr_res = await db.execute(
                    text("SELECT designation, department FROM organogram WHERE code = :code"),
                    {"code": mgr_code}
                )
            mgr_org = mgr_res.mappings().first()
            if mgr_org:
                mgr_desig = mgr_org.get("designation") or ""
                mgr_dept = mgr_org.get("department") or ""
        except Exception as e:
            logger.error(f"Error querying organogram for manager {mgr_code}: {e}")

    # 4. Map and Format fields
    title = session_rec.title or jd_structured.get("employee_information", {}).get("job_title") or emp_desig or "Job Description"
    purpose = jd_structured.get("purpose") or jd_structured.get("role_summary") or ""
    
    experience_str = jd_structured.get("experience")
    exp_from, exp_to = parse_experience_range(experience_str)
    
    # Responsibilities -> Numbered List
    resps_list = jd_structured.get("responsibilities") or jd_structured.get("key_responsibilities") or []
    primary_resps = "\n".join(f"{i+1}. {r}" for i, r in enumerate(resps_list)) if resps_list else ""

    # Skills / Tools / Education
    skills_list = jd_structured.get("skills") or []
    tools_list = jd_structured.get("tools") or []
    req_skills = ", ".join(skills_list)
    req_knowledge = ", ".join(tools_list)
    education_text = jd_structured.get("education") or ""

    file_name = f"{emp_id} - {title} - JD.docx" if emp_id else f"{title} - JD.docx"
    is_draft = "No" if session_rec.status in ("approved", "sent_to_hr", "completed") else "Yes"

    # Construct Darwinbox row
    row_data = {col: "" for col in DARWINBOX_JD_HEADERS}
    row_data["Job Description Title*"] = title
    row_data["Designation Code*"] = emp_id or ""
    row_data["Office Location Work Area Code"] = emp_loc
    row_data["Position Description"] = purpose
    row_data["Experience From (Years)"] = exp_from if exp_from is not None else ""
    row_data["Experience To (Years)"] = exp_to if exp_to is not None else ""
    row_data["Primary Responsibilities"] = primary_resps
    row_data["Reporting Team - Reporting Designation Code"] = mgr_code or ""
    row_data["Reporting Team - Reporting Department Code"] = mgr_dept or emp_dept
    row_data["Education - Degree"] = education_text
    row_data["Work Experience - From (Years)"] = exp_from if exp_from is not None else ""
    row_data["Work Experience - To (Years)"] = exp_to if exp_to is not None else ""
    row_data["Required Competencies"] = req_skills
    row_data["Required Knowledge"] = req_knowledge
    row_data["Required Skills"] = req_skills
    row_data["Job Description File Name"] = file_name
    row_data["Is Draft"] = is_draft

    # Write CSV with correct quoting
    output = io.StringIO()
    # Darwinbox expects double quotes for multi-line/comma text
    writer = csv.DictWriter(output, fieldnames=DARWINBOX_JD_HEADERS, quoting=csv.QUOTE_ALL)
    writer.writeheader()
    writer.writerow(row_data)
    
    return output.getvalue()
