# app/services/docx_generator.py
"""
Enterprise DOCX generator for Job Descriptions.
Produces a professionally formatted .docx file matching Pulse Pharma's official JD template.
"""

from io import BytesIO
from docx import Document
from docx.shared import Pt, RGBColor
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn


def _set_cell_shading(cell, color_hex: str):
    """Apply background shading to a table cell."""
    shading = cell._element.get_or_add_tcPr()
    shading_elem = shading.makeelement(
        qn("w:shd"),
        {
            qn("w:fill"): color_hex,
            qn("w:val"): "clear",
        },
    )
    shading.append(shading_elem)


def _set_cell_content(cell, text: str, bold: bool = False, size: int = 10):
    """Set cell text with formatting."""
    cell.text = ""
    p = cell.paragraphs[0]
    run = p.add_run(str(text) if text else "")
    run.font.size = Pt(size)
    run.font.name = "Calibri"
    run.bold = bold


def _add_section_table(
    doc, header: str, rows: list[tuple[str, str]], header_color: str = "1F4E79"
):
    """
    Adds a styled two-column table (Label | Value) with a merged header row.
    `rows` is a list of (label, value) tuples.
    """
    table = doc.add_table(rows=1 + len(rows), cols=2)
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.style = "Table Grid"

    # Header row (merged)
    header_cell = table.cell(0, 0)
    header_cell.merge(table.cell(0, 1))
    _set_cell_content(header_cell, header, bold=True, size=11)
    _set_cell_shading(header_cell, header_color)
    header_cell.paragraphs[0].runs[0].font.color.rgb = RGBColor(0xFF, 0xFF, 0xFF)

    # Data rows
    for i, (label, value) in enumerate(rows, start=1):
        label_cell = table.cell(i, 0)
        value_cell = table.cell(i, 1)
        _set_cell_content(label_cell, label, bold=True, size=10)
        _set_cell_content(value_cell, str(value) if value else "", size=10)
        _set_cell_shading(label_cell, "D6E4F0")

    doc.add_paragraph("")  # spacing


def _list_to_text(items) -> str:
    """Convert a list or string to multi-line text."""
    if isinstance(items, list):
        return "\n".join(f"• {item}" for item in items if item)
    if isinstance(items, str):
        return items
    return str(items) if items else ""


def _dict_list_to_text(items) -> str:
    """Convert a list of strings or dicts to readable text."""
    if isinstance(items, list):
        parts = []
        for item in items:
            if isinstance(item, dict):
                parts.append(", ".join(f"{k}: {v}" for k, v in item.items()))
            else:
                parts.append(str(item))
        return ", ".join(parts)
    if isinstance(items, str):
        return items
    return str(items) if items else ""


def generate_jd_docx(
    jd_data: dict, title: str = None, department: str = None
) -> BytesIO:
    """
    Generate a DOCX file from JD structured data.

    Args:
        jd_data: The jd_structured JSON data from the database.
        title: JD title (fallback if not in jd_data).
        department: Department (fallback if not in jd_data).

    Returns:
        BytesIO stream containing the DOCX file.
    """
    doc = Document()

    # ── Document defaults ─────────────────────────────────────────────────
    style = doc.styles["Normal"]
    font = style.font
    font.name = "Calibri"
    font.size = Pt(10)

    # ── Extract data safely ───────────────────────────────────────────────
    emp_info = jd_data.get("employee_information", {})
    if isinstance(emp_info, str):
        emp_info = {}

    team = jd_data.get("team_structure", {})
    if isinstance(team, str):
        team = {}

    stakeholders = jd_data.get("stakeholder_interactions", {})
    if isinstance(stakeholders, str):
        stakeholders = {}

    work_env = jd_data.get("work_environment", {})
    if isinstance(work_env, str):
        work_env = {}

    additional = jd_data.get("additional_details", {})
    if isinstance(additional, str):
        additional = {}

    role_summary = jd_data.get("role_summary", "")
    if isinstance(role_summary, dict):
        role_summary = role_summary.get("summary", str(role_summary))

    designation = emp_info.get("title", title or "")
    dept = emp_info.get("department", department or "")
    location = emp_info.get("location", "")
    reports_to = emp_info.get("reports_to", "")
    work_type = emp_info.get("work_type", "")

    key_responsibilities = jd_data.get("key_responsibilities", [])
    required_skills = jd_data.get("required_skills", [])
    tools = jd_data.get("tools_and_technologies", [])
    performance_metrics = jd_data.get("performance_metrics", [])

    # ── Company Header ────────────────────────────────────────────────────
    header_para = doc.add_paragraph()
    header_para.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = header_para.add_run("PULSE PHARMA")
    run.bold = True
    run.font.size = Pt(16)
    run.font.color.rgb = RGBColor(0x1F, 0x4E, 0x79)

    subtitle = doc.add_paragraph()
    subtitle.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = subtitle.add_run("Job Description Document")
    run.font.size = Pt(12)
    run.font.color.rgb = RGBColor(0x59, 0x59, 0x59)
    run.italic = True

    doc.add_paragraph("")

    # ── Table 1: Job / Role Information ───────────────────────────────────
    purpose_text = role_summary
    if key_responsibilities:
        resp_text = _list_to_text(key_responsibilities)
        purpose_text = f"{role_summary}\n\nKey Responsibilities:\n{resp_text}"

    _add_section_table(
        doc,
        "Job / Role Information",
        [
            ("Designation", designation),
            ("Band & Band Name", emp_info.get("band", "")),
            ("Grade", emp_info.get("grade", "")),
            ("Function", dept),
            ("Location", location),
            ("Work Type", work_type),
            ("Purpose of the Job / Role", purpose_text),
        ],
    )

    # ── Table 2: Working Relationships ────────────────────────────────────
    team_text = ""
    if team.get("team_size"):
        team_text = f"Team Size: {team['team_size']}"
    if team.get("collaborates_with"):
        collab = _dict_list_to_text(team["collaborates_with"])
        team_text += (
            f"\nCollaborates with: {collab}"
            if team_text
            else f"Collaborates with: {collab}"
        )
    if team.get("direct_reports"):
        team_text += f"\nDirect Reports: {team['direct_reports']}"
    if team.get("mentoring"):
        team_text += f"\nMentoring: {team['mentoring']}"

    internal = _dict_list_to_text(stakeholders.get("internal", []))
    external = _dict_list_to_text(stakeholders.get("external", []))

    _add_section_table(
        doc,
        "Working Relationships",
        [
            ("Reporting to", reports_to),
            ("Team", team_text or "-"),
            ("Internal Stakeholders", internal or "-"),
            ("External Stakeholders", external or "-"),
        ],
        header_color="2E75B6",
    )

    # ── Table 3: Skills / Competencies ────────────────────────────────────
    all_skills = []
    if isinstance(required_skills, list):
        all_skills.extend(required_skills)
    if isinstance(tools, list):
        all_skills.extend([f"{t} (Tool/Platform)" for t in tools])

    skills_text = (
        _list_to_text(all_skills)
        if all_skills
        else "To be confirmed with line manager."
    )

    _add_section_table(
        doc,
        "Skills / Competencies Required",
        [
            ("Skills", skills_text),
        ],
        header_color="548235",
    )

    # ── Table 4: Performance & Success Metrics ────────────────────────────
    metrics_text = (
        _list_to_text(performance_metrics)
        if performance_metrics
        else "To be confirmed with line manager."
    )

    _add_section_table(
        doc,
        "Performance & Success Metrics",
        [
            ("Key Performance Indicators", metrics_text),
        ],
        header_color="BF8F00",
    )

    # ── Table 5: Work Environment & Additional ────────────────────────────
    env_parts = []
    if work_env.get("type"):
        env_parts.append(f"Type: {work_env['type']}")
    if work_env.get("culture"):
        env_parts.append(f"Culture: {work_env['culture']}")
    if work_env.get("work_pace"):
        env_parts.append(f"Pace: {work_env['work_pace']}")
    if work_env.get("work_style"):
        env_parts.append(f"Style: {work_env['work_style']}")
    env_text = "\n".join(env_parts) if env_parts else "-"

    special_projects = _list_to_text(additional.get("special_projects", []))
    unique_contrib = additional.get("unique_contributions", "")
    growth = additional.get("growth_opportunities", "")

    additional_text = ""
    if special_projects:
        additional_text += f"Special Projects:\n{special_projects}\n"
    if unique_contrib:
        additional_text += f"\nUnique Contributions: {unique_contrib}\n"
    if growth:
        additional_text += f"\nGrowth Opportunities: {growth}"

    _add_section_table(
        doc,
        "Work Environment & Additional Details",
        [
            ("Work Environment", env_text),
            ("Special Contributions", additional_text.strip() or "-"),
        ],
        header_color="7030A0",
    )

    # ── Footer Disclaimer ─────────────────────────────────────────────────
    doc.add_paragraph("")
    disclaimer = doc.add_paragraph()
    disclaimer.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = disclaimer.add_run(
        "Pulse Pharma is an equal opportunity employer. "
        "This Job Description was generated from a structured employee role intelligence interview."
    )
    run.font.size = Pt(8)
    run.font.color.rgb = RGBColor(0x99, 0x99, 0x99)
    run.italic = True

    # ── Write to BytesIO ──────────────────────────────────────────────────
    buffer = BytesIO()
    doc.save(buffer)
    buffer.seek(0)
    return buffer
