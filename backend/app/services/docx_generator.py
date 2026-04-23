# backend/app/services/docx_generator.py
# Pulse Pharma branded DOCX — matches the official company JD template exactly.
# 4-section table layout, grey section headers (#BFBFBF), company logo in header,
# footer disclaimer. Replaces the old multi-colour enterprise format entirely.

from io import BytesIO
import logging
import os
from urllib.request import urlopen

from docx import Document
from docx.shared import Pt, Inches, Emu
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

# Logo path — moved to static assets directory
logger = logging.getLogger(__name__)

_HERE = os.path.dirname(os.path.abspath(__file__))
# Default to static/images/pulse_logo.jpeg relative to the backend root (one level up from app/)
_PROJECT_ROOT = os.path.dirname(os.path.dirname(_HERE))
DEFAULT_LOGO_PATH = os.path.join(_PROJECT_ROOT, "static", "images", "pulse_logo.jpeg")
DEFAULT_LOGO_URL = "https://company-logo-wtn.s3.ap-southeast-2.amazonaws.com/logo.png"
LOGO_PATH = os.getenv("COMPANY_LOGO_PATH", DEFAULT_LOGO_PATH)
LOGO_URL = os.getenv("COMPANY_LOGO_URL", DEFAULT_LOGO_URL)

HEADER_COLOR = "BFBFBF"  # exact grey from company template
BORDER_COLOR = "999999"


# ── Low-level helpers ─────────────────────────────────────────────────────────


def _set_cell_properties(cell, bg_color: str | None = None, borders: bool = True, valign: str | None = None) -> None:
    """Sets cell properties ensuring correct OOXML element order in tcPr."""
    tc = cell._tc
    tcPr = tc.get_or_add_tcPr()

    # Elements must appear in this order: tcW, gridSpan, vMerge, tcBorders, shd, ... vAlign
    
    # 1. Borders
    if borders:
        tcBorders = tcPr.find(qn("w:tcBorders"))
        if tcBorders is not None:
            tcPr.remove(tcBorders)
        tcBorders = OxmlElement("w:tcBorders")
        for side in ("top", "left", "bottom", "right"):
            b = OxmlElement(f"w:{side}")
            b.set(qn("w:val"), "single")
            b.set(qn("w:sz"), "4")
            b.set(qn("w:space"), "0")
            b.set(qn("w:color"), BORDER_COLOR)
            tcBorders.append(b)
        tcPr.append(tcBorders)

    # 2. Shading (Background)
    if bg_color:
        shd = tcPr.find(qn("w:shd"))
        if shd is not None:
            tcPr.remove(shd)
        shd = OxmlElement("w:shd")
        shd.set(qn("w:val"), "clear")
        shd.set(qn("w:color"), "auto")
        shd.set(qn("w:fill"), bg_color)
        tcPr.append(shd)

    # 3. Vertical Alignment
    if valign:
        va = tcPr.find(qn("w:vAlign"))
        if va is not None:
            tcPr.remove(va)
        va = OxmlElement("w:vAlign")
        va.set(qn("w:val"), valign)
        tcPr.append(va)


def _para_spacing(para, before: float = 0, after: float = 0) -> None:
    para.paragraph_format.space_before = Pt(before)
    para.paragraph_format.space_after = Pt(after)


def _load_logo_stream() -> BytesIO | None:
    """Load the company logo from URL first, then fall back to local file."""
    if LOGO_URL:
        try:
            with urlopen(LOGO_URL, timeout=10) as response:
                return BytesIO(response.read())
        except Exception as exc:
            logger.warning("Could not load company logo from URL %s: %s", LOGO_URL, exc)

    if os.path.exists(LOGO_PATH):
        try:
            with open(LOGO_PATH, "rb") as logo_file:
                return BytesIO(logo_file.read())
        except Exception as exc:
            logger.warning("Could not load company logo from file %s: %s", LOGO_PATH, exc)

    return None


# ── Row builders ──────────────────────────────────────────────────────────────


def _section_header_row(table, row_idx: int, text: str) -> None:
    """Merge cols, grey background, bold centred text."""
    row = table.rows[row_idx]
    row.cells[0].merge(row.cells[1])
    cell = row.cells[0]
    _set_cell_properties(cell, bg_color=HEADER_COLOR, borders=True)
    para = cell.paragraphs[0]
    para.alignment = WD_ALIGN_PARAGRAPH.CENTER
    _para_spacing(para)
    run = para.add_run(text)
    run.bold = True
    run.font.size = Pt(11)


def _data_row(table, row_idx: int, label: str, value) -> None:
    """Bold label cell | plain value cell."""
    row = table.rows[row_idx]
    lc, vc = row.cells[0], row.cells[1]

    for cell in (lc, vc):
        _set_cell_properties(cell, borders=True, valign="top")

    # Label
    lp = lc.paragraphs[0]
    _para_spacing(lp)
    lr = lp.add_run(label)
    lr.bold = True
    lr.font.size = Pt(11)

    # Value — list → bulleted paragraphs, string → single paragraph
    if isinstance(value, list):
        for i, item in enumerate(value):
            p = vc.paragraphs[0] if i == 0 else vc.add_paragraph()
            _para_spacing(p, after=2)
            p.paragraph_format.left_indent = Inches(0.15)
            r = p.add_run(f"\u2022 {item}")
            r.font.size = Pt(11)
    else:
        vp = vc.paragraphs[0]
        _para_spacing(vp)
        vr = vp.add_run(str(value) if value else "")
        vr.font.size = Pt(11)


def _job_desc_content_row(
    table, row_idx: int, purpose: str, responsibilities: list
) -> None:
    """Full-width merged cell: Purpose paragraph + Responsibilities list."""
    row = table.rows[row_idx]
    row.cells[0].merge(row.cells[1])
    cell = row.cells[0]
    _set_cell_properties(cell, borders=True, valign="top")

    # Purpose
    if purpose:
        pp = cell.paragraphs[0]
        _para_spacing(pp, before=4)
        r1 = pp.add_run("Purpose of the Job / Role :  ")
        r1.bold = True
        r1.font.size = Pt(11)
        r2 = pp.add_run(purpose)
        r2.font.size = Pt(11)
    else:
        cell.paragraphs[0].clear()

    # Blank separator
    blank = cell.add_paragraph()
    _para_spacing(blank, before=0, after=4)

    # Responsibilities header
    rh = cell.add_paragraph()
    _para_spacing(rh, before=0, after=4)
    rhr = rh.add_run("Job Responsibilities")
    rhr.bold = True
    rhr.font.size = Pt(11)

    # Responsibility bullets
    for resp in responsibilities:
        rp = cell.add_paragraph()
        _para_spacing(rp, after=2)
        rp.paragraph_format.left_indent = Inches(0.2)
        rr = rp.add_run(f"\u2022 {resp}")
        rr.font.size = Pt(11)


# ── Data extraction helpers ───────────────────────────────────────────────────


def _get(data: dict, *keys) -> str:
    emp = data.get("employee_information") or {}
    for k in keys:
        v = data.get(k) or emp.get(k)
        if v and isinstance(v, str) and v.strip():
            return v.strip()
    return ""


def _get_list(data: dict, *keys) -> list:
    for k in keys:
        v = data.get(k)
        if isinstance(v, list) and v:
            return [str(x) for x in v if x]
    return []


def _get_stakeholder(data: dict, itype: str) -> str:
    s = (
        data.get("stakeholder_interactions")
        or data.get("stakeholders")
        or data.get("working_relationships")
        or {}
    )
    if itype == "internal":
        v = s.get("internal") or s.get("internal_stakeholders") or ""
    else:
        v = s.get("external") or s.get("external_stakeholders") or ""
    return ", ".join(v) if isinstance(v, list) else str(v)


# ── Public API ────────────────────────────────────────────────────────────────


def generate_jd_docx(
    jd_data: dict, title: str | None = None, department: str | None = None
) -> BytesIO:
    """
    Generate a Pulse Pharma branded DOCX from structured JD data.

    Args:
        jd_data:    jd_structured dict from the database.
        title:      Fallback job title if not in jd_data.
        department: Fallback department if not in jd_data.

    Returns:
        BytesIO stream of the .docx file, seeked to 0.
    """
    # ── Extract fields ────────────────────────────────────────────────────────
    designation = _get(jd_data, "job_title", "title", "designation") or title or "—"
    band = _get(jd_data, "band")
    grade = _get(jd_data, "grade")
    func = _get(jd_data, "department", "function") or department or "—"
    location = _get(jd_data, "location")

    wr = jd_data.get("working_relationships") or {}
    ts = jd_data.get("team_structure") or {}
    reporting_to = (
        _get(jd_data, "reports_to", "reporting_to")
        or wr.get("reporting_to")
        or ts.get("reports_to")
        or "—"
    )
    team_size = str(ts.get("team_size") or wr.get("team_size") or "—")
    internal = _get_stakeholder(jd_data, "internal") or "—"
    external = _get_stakeholder(jd_data, "external") or "Not applicable"

    purpose = _get(jd_data, "purpose", "role_summary")
    responsibilities = _get_list(jd_data, "responsibilities", "key_responsibilities")
    skills = _get_list(jd_data, "skills", "technical_skills", "required_skills")
    tools = _get_list(jd_data, "tools", "tools_and_technologies")
    all_skills = skills + [f"{t} (Tool/Platform)" for t in tools]
    if not all_skills:
        all_skills = ["To be confirmed with line manager."]

    education = _get(jd_data, "education")
    experience = _get(jd_data, "experience")
    edu_exp = (
        "\n\n".join(filter(None, [education, experience]))
        or "To be confirmed with line manager."
    )

    # ── Document setup ────────────────────────────────────────────────────────
    doc = Document()

    section = doc.sections[0]
    section.page_width = Emu(7556500)  # A4
    section.page_height = Emu(10680700)
    section.top_margin = Emu(914400)  # 1 inch
    section.bottom_margin = Emu(914400)
    section.left_margin = Emu(914400)
    section.right_margin = Emu(914400)

    normal_style = doc.styles["Normal"]
    if hasattr(normal_style, "font"):
        normal_style.font.name = "Calibri"
        normal_style.font.size = Pt(11)

    # ── Logo in header ────────────────────────────────────────────────────────
    header = section.header
    header.is_linked_to_previous = False
    hp = header.paragraphs[0]
    hp.alignment = WD_ALIGN_PARAGRAPH.CENTER
    _para_spacing(hp, after=6)
    logo_stream = _load_logo_stream()
    if logo_stream:
        hp.add_run().add_picture(logo_stream, width=Inches(2.5))
    else:
        # Fallback text if logo file missing
        lr = hp.add_run("PULSE PHARMA")
        lr.bold = True
        lr.font.size = Pt(16)

    # ── TABLE 1: Job / Role Information ──────────────────────────────────────
    t1 = doc.add_table(rows=8, cols=2)
    t1.alignment = WD_TABLE_ALIGNMENT.CENTER

    _section_header_row(t1, 0, "Job / Role Information")
    _data_row(t1, 1, "Designation", designation)
    _data_row(t1, 2, "Band & Band Name", band)
    _data_row(t1, 3, "Grade", grade)
    _data_row(t1, 4, "Function", func)
    _data_row(t1, 5, "Location", location)
    _section_header_row(t1, 6, "Job Description")
    _job_desc_content_row(t1, 7, purpose, responsibilities)

    doc.add_paragraph().paragraph_format.space_after = Pt(6)

    # ── TABLE 2: Working Relationships ────────────────────────────────────────
    t2 = doc.add_table(rows=5, cols=2)
    t2.alignment = WD_TABLE_ALIGNMENT.CENTER

    _section_header_row(t2, 0, "Working Relationships")
    _data_row(t2, 1, "Reporting to", reporting_to)
    _data_row(t2, 2, "Team", team_size)
    _data_row(t2, 3, "Internal Stakeholders", internal)
    _data_row(t2, 4, "External Stakeholders", external)

    doc.add_paragraph().paragraph_format.space_after = Pt(6)

    # ── TABLE 3: Skills / Competencies ────────────────────────────────────────
    t3 = doc.add_table(rows=2, cols=2)
    t3.alignment = WD_TABLE_ALIGNMENT.CENTER

    _section_header_row(t3, 0, "Skills/ Competencies Required")
    _data_row(
        t3,
        1,
        "Skills",
        all_skills,
    )

    doc.add_paragraph().paragraph_format.space_after = Pt(6)

    # ── TABLE 4: Academic Qualifications & Experience ─────────────────────────
    t4 = doc.add_table(rows=2, cols=2)
    t4.alignment = WD_TABLE_ALIGNMENT.CENTER

    _section_header_row(t4, 0, "Academic Qualifications & Experience Required")

    # Custom label (two lines) + value
    row4 = t4.rows[1]
    lc4, vc4 = row4.cells[0], row4.cells[1]
    for cell in (lc4, vc4):
        _set_cell_properties(cell, borders=True, valign="top")

    lp4 = lc4.paragraphs[0]
    _para_spacing(lp4)
    lr4 = lp4.add_run("Required Educational Qualification & \nRelevant experience")
    lr4.bold = True
    lr4.font.size = Pt(11)

    vp4 = vc4.paragraphs[0]
    _para_spacing(vp4)
    vr4 = vp4.add_run(edu_exp)
    vr4.font.size = Pt(11)

    # ── Footer disclaimer ──────────────────────────────────────────────────────
    fp = doc.add_paragraph()
    fp.paragraph_format.space_before = Pt(10)
    fp.paragraph_format.space_after = Pt(0)
    fr = fp.add_run(
        "Pulse Pharma is an equal opportunity employer - we never differentiate candidates "
        "on the basis of religion, caste, gender, language, disabilities or ethnic group. "
        "Pulse reserves the right to place/move any candidate to any company location, "
        "partner location or customer location globally, in the best interest of Pulse business."
    )
    fr.font.size = Pt(10)

    buf = BytesIO()
    doc.save(buf)
    buf.seek(0)
    return buf
