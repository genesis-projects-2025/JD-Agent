# backend/app/services/darwinbox_exporter_service.py
"""
Darwinbox KRA/KPI Bulk Export Service

Generates Darwinbox-compatible CSV files for uploading goals and sub-goals:
  - Bulk Goals.csv  (50 columns — parent KRA goals)
  - Bulk Sub Goals.csv (62 columns — child KPI sub-goals)

Supports:
  - Individual employee export (immediate download)
  - Company-wide / department bulk export (consolidated CSV or ZIP)

Data sources (in priority order):
  1. UploadedKRAKPI  (admin-uploaded/pasted frameworks)
  2. KRAKPISession   (AI-guided approved/confirmed frameworks)
"""

import csv
import io
import logging
import re
import zipfile
from dataclasses import dataclass, field
from typing import Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.models.kra_kpi_model import KRAKPISession, UploadedKRAKPI

logger = logging.getLogger(__name__)

# ═══════════════════════════════════════════════════════════════════════════════
# Column Headers — must match Darwinbox templates EXACTLY
# ═══════════════════════════════════════════════════════════════════════════════

BULK_GOALS_HEADERS: list[str] = [
    "EmployeeID*",
    "Goals / Key Result Areas Name",
    "Goals / Key Result Areas Description",
    "Goal Status",
    "Weightage(%)",
    "TimelinesStart date(dd-mm-yyyy)",
    "Timelines End date(dd-mm-yyyy)",
    "New Goal Plan ID*",
    "Is Goal Approved",
    "Achievement mapping",
    "Achievement",
]  # 11 active columns

BULK_SUB_GOALS_HEADERS: list[str] = [
    "Employee ID*",
    "Goals / Key Result Areas ID*",
    "Sub Goal Name*",
    "Subgoal description",
    "Target",
    "Target Prefix",
    "Sub Goal Status",
    "Weightage",
    "Metric",
    "Start Date",
    "End Date",
    "Is Goals / Key Result Areas Approved",
    "My Goal Plan ID",
    "Achievement",
    "Achieved",
]  # 15 active columns


# ═══════════════════════════════════════════════════════════════════════════════
# Normalised internal record used by the CSV builder
# ═══════════════════════════════════════════════════════════════════════════════

@dataclass
class NormalisedKPI:
    """Normalised KPI record extracted from either data source."""
    kpi_id: str = ""
    title: str = ""
    description: str = ""
    weight: float = 0.0
    target: str = "100"
    target_type: str = "Percentage"
    metric: str = "%"
    measurement_method: str = ""
    frequency: str = ""
    threshold: dict = field(default_factory=dict)


@dataclass
class NormalisedKRA:
    """Normalised KRA record extracted from either data source."""
    kra_id: str = ""
    title: str = ""
    description: str = ""
    weight: float = 0.0
    kpis: list[NormalisedKPI] = field(default_factory=list)


@dataclass
class EmployeeExportRecord:
    """Complete export-ready record for one employee."""
    employee_id: str
    employee_name: str = ""
    department: str = ""
    designation: str = ""
    kras: list[NormalisedKRA] = field(default_factory=list)
    source: str = ""  # "uploaded" or "session"


# ═══════════════════════════════════════════════════════════════════════════════
# Goal Plan ID Formatting Helpers
# ═══════════════════════════════════════════════════════════════════════════════

def _format_new_goal_plan_id(goal_plan_name: Optional[str] = None, goal_plan_id: Optional[str] = None) -> str:
    """
    Format New Goal Plan ID for parent goals CSV (Column 8).
    Required format: 'Goal Plan Name (Goal Plan ID)' e.g. 'HRBP_GOAL_PLAN_TESTING (HRBP_Test)'
    """
    g_name = (goal_plan_name or "").strip()
    g_id = (goal_plan_id or "").strip()

    if not g_name and not g_id:
        return "HRBP_GOAL_PLAN_TESTING (HRBP_Test)"

    if "(" in g_name and ")" in g_name:
        return g_name

    if "(" in g_id and ")" in g_id:
        return g_id

    if g_name and g_id:
        if g_name.lower() == g_id.lower():
            return g_name
        return f"{g_name} ({g_id})"

    if g_id:
        return g_id

    return g_name


def _format_my_goal_plan_id(goal_plan_id: Optional[str] = None, goal_plan_name: Optional[str] = None) -> str:
    """
    Format My Goal Plan ID for sub-goals CSV (Column 13).
    Required format: just the short ID e.g. 'HRBP_Test'
    """
    g_id = (goal_plan_id or "").strip()
    g_name = (goal_plan_name or "").strip()

    target_str = g_id or g_name or "HRBP_Test"

    match = re.search(r'\(([^)]+)\)', target_str)
    if match:
        return match.group(1).strip()

    return target_str


# ═══════════════════════════════════════════════════════════════════════════════
# Data Normalisation — unify both JSON shapes
# ═══════════════════════════════════════════════════════════════════════════════

def _parse_numeric_target(raw_target: str | int | float | None) -> str:
    """
    Extract a clean numeric string from targets like '95% of committed points',
    '>95%', '98', None, etc.  Falls back to '100'.
    """
    if raw_target is None:
        return "100"
    s = str(raw_target).strip()
    if not s:
        return "100"

    # Try direct float conversion first
    try:
        return str(round(float(s), 2))
    except ValueError:
        pass

    # Extract leading number from strings like "95% of ..." or ">95%"
    match = re.search(r"[\d]+\.?[\d]*", s)
    if match:
        return match.group()
    return "100"


def _infer_metric(kpi: dict) -> str:
    """Infer metric unit from KPI data."""
    # Check explicit unit field
    unit = kpi.get("unit") or kpi.get("metric") or ""
    if unit and unit.strip():
        return unit.strip()

    # Infer from target string
    target_str = str(kpi.get("target", ""))
    if "%" in target_str:
        return "%"
    if any(word in target_str.lower() for word in ["hours", "hour", "hrs"]):
        return "Hours"
    if any(word in target_str.lower() for word in ["count", "number", "nos"]):
        return "Count"
    if any(word in target_str.lower() for word in ["days", "day"]):
        return "Days"
    if any(word in target_str.lower() for word in ["rupees", "inr", "₹", "lakh", "crore"]):
        return "Currency"

    return "%"


def _infer_target_type(metric: str) -> str:
    """Map metric unit to Darwinbox target type."""
    metric_lower = metric.lower().strip()
    if metric_lower in ("%", "percentage"):
        return "Percentage"
    return "Numeric"


def _infer_darwinbox_metric_name(metric: str) -> str:
    """
    Map KPI metric unit to Darwinbox metric name:
      - Currency (INR / USD)
      - Milestone (BOOL)
      - Number (NUM)
      - Percentage (PCT)
      - TimeLine (DAYS)
    """
    m = metric.lower().strip()
    if m in ("%", "percentage", "pct"):
        return "Percentage"
    elif m in ("days", "day", "hours", "hrs", "timeline"):
        return "TimeLine"
    elif m in ("currency", "inr", "usd", "₹", "$", "rupees"):
        return "Currency"
    elif m in ("bool", "boolean", "milestone", "yes/no"):
        return "Milestone"
    else:
        return "Number"


def _infer_target_prefix(metric_name: str, title: str = "", description: str = "") -> str:
    """Infer target prefix constraint string for Darwinbox sub-goals."""
    combined = f"{title} {description}".lower()
    if metric_name == "TimeLine" or any(w in combined for w in ["reduction", "tat", "turnaround", "latency", "error", "delay", "defect", "cost reduction"]):
        return "Is less than or equal to"
    elif metric_name == "Milestone":
        return "Is equal to"
    else:
        return "Is more than or equal to"


def _build_kpi_description(kpi: dict) -> str:
    """
    Build a rich description for the KPI, embedding threshold info
    if available for manager/HR context.
    """
    desc = kpi.get("description", "") or ""
    threshold = kpi.get("threshold")
    if threshold and isinstance(threshold, dict):
        parts = []
        for level, value in threshold.items():
            label = level.replace("_", " ").title()
            parts.append(f"{label}: {value}")
        if parts:
            thresh_text = " | ".join(parts)
            desc = f"{desc}\n[Thresholds: {thresh_text}]" if desc else f"[Thresholds: {thresh_text}]"

    measurement = kpi.get("measurement_method", "")
    if measurement:
        desc = f"{desc}\n[Measurement: {measurement}]" if desc else f"[Measurement: {measurement}]"

    frequency = kpi.get("frequency", "")
    if frequency:
        desc = f"{desc}\n[Frequency: {frequency}]" if desc else f"[Frequency: {frequency}]"

    return desc.strip()


def normalise_kras(
    kras_json: dict | None,
    employee_id: str,
    source: str,
) -> list[NormalisedKRA]:
    """
    Normalise KRA/KPI JSON from either KRAKPISession or UploadedKRAKPI
    into a uniform list of NormalisedKRA objects.
    """
    if not kras_json:
        return []

    raw_kras = kras_json.get("kras", [])
    if not isinstance(raw_kras, list):
        return []

    result: list[NormalisedKRA] = []
    num_kras = len(raw_kras)

    for kra_idx, kra in enumerate(raw_kras):
        # Resolve weight — evenly distribute if missing
        kra_weight = kra.get("weight")
        if kra_weight is None or kra_weight == 0:
            kra_weight = round(100.0 / max(num_kras, 1), 2)

        normalised_kra = NormalisedKRA(
            kra_id=kra.get("kra_id", f"kra_{kra_idx + 1:03d}"),
            title=kra.get("title", f"KRA {kra_idx + 1}"),
            description=kra.get("description", ""),
            weight=float(kra_weight),
            kpis=[],
        )

        raw_kpis = kra.get("kpis", [])
        num_kpis = len(raw_kpis) if raw_kpis else 0

        for kpi_idx, kpi in enumerate(raw_kpis):
            # Resolve weight — evenly distribute if missing
            kpi_weight = kpi.get("weight")
            if kpi_weight is None or kpi_weight == 0:
                kpi_weight = round(100.0 / max(num_kpis, 1), 2)

            metric = _infer_metric(kpi)
            target_type = _infer_target_type(metric)
            description = _build_kpi_description(kpi)

            normalised_kpi = NormalisedKPI(
                kpi_id=kpi.get("kpi_id", f"kpi_{kra_idx + 1:03d}_{kpi_idx + 1:02d}"),
                title=kpi.get("title") or kpi.get("metric") or f"KPI {kpi_idx + 1}",
                description=description,
                weight=float(kpi_weight),
                target=_parse_numeric_target(kpi.get("target") or kpi.get("target_value")),
                target_type=target_type,
                metric=metric,
                measurement_method=kpi.get("measurement_method", ""),
                frequency=kpi.get("frequency", ""),
                threshold=kpi.get("threshold", {}),
            )
            normalised_kra.kpis.append(normalised_kpi)

        result.append(normalised_kra)

    # Normalise KRA weights to sum to 100 if they don't already
    total_kra_weight = sum(k.weight for k in result)
    if result and abs(total_kra_weight - 100) > 1:
        factor = 100.0 / total_kra_weight if total_kra_weight > 0 else 1.0
        for k in result:
            k.weight = round(k.weight * factor, 2)
        # Fix rounding remainder
        diff = 100.0 - sum(k.weight for k in result)
        if result:
            result[-1].weight = round(result[-1].weight + diff, 2)

    # Normalise KPI weights per KRA to sum to 100
    for kra in result:
        if kra.kpis:
            total_kpi_weight = sum(kp.weight for kp in kra.kpis)
            if abs(total_kpi_weight - 100) > 1:
                factor = 100.0 / total_kpi_weight if total_kpi_weight > 0 else 1.0
                for kp in kra.kpis:
                    kp.weight = round(kp.weight * factor, 2)
                diff = 100.0 - sum(kp.weight for kp in kra.kpis)
                if kra.kpis:
                    kra.kpis[-1].weight = round(kra.kpis[-1].weight + diff, 2)

    return result


# ═══════════════════════════════════════════════════════════════════════════════
# CSV Row Builders
# ═══════════════════════════════════════════════════════════════════════════════

def _status_label(status: str) -> str:
    """Map internal status to Darwinbox status label."""
    mapping = {
        "approved": "Approved",
        "confirmed": "Approved",
        "sent_to_hr": "Approved",
        "sent_to_manager": "Pending",
        "draft": "Pending",
    }
    return mapping.get(status, "Approved")


def build_goal_row(
    employee_id: str,
    kra: NormalisedKRA,
    kra_index: int,
    cycle_start: str = "01-04-2026",
    cycle_end: str = "30-07-2026",
    status: str = "Completed",
    goal_plan_name: str = "HRBP_GOAL_PLAN_TESTING",
    goal_plan_id: str = "HRBP_Test",
) -> list[str]:
    """
    Build a single Bulk Goals row for one KRA with 11 active columns.
    Columns:
      1. EmployeeID*
      2. Goals / Key Result Areas Name
      3. Goals / Key Result Areas Description
      4. Goal Status
      5. Weightage(%)
      6. TimelinesStart date(dd-mm-yyyy)
      7. Timelines End date(dd-mm-yyyy)
      8. New Goal Plan ID*
      9. Is Goal Approved
      10. Achievement mapping
      11. Achievement
    """
    formatted_weight = str(int(kra.weight)) if kra.weight == int(kra.weight) else f"{kra.weight:.2f}"
    formatted_goal_plan_col = _format_new_goal_plan_id(goal_plan_name, goal_plan_id)

    return [
        employee_id,                                # 1: EmployeeID*
        kra.title,                                  # 2: Goals / Key Result Areas Name
        kra.description,                            # 3: Goals / Key Result Areas Description
        status,                                     # 4: Goal Status ("Completed")
        formatted_weight,                           # 5: Weightage(%)
        cycle_start,                                # 6: TimelinesStart date(dd-mm-yyyy)
        cycle_end,                                  # 7: Timelines End date(dd-mm-yyyy)
        formatted_goal_plan_col,                   # 8: New Goal Plan ID* (HRBP_GOAL_PLAN_TESTING (HRBP_Test))
        "Yes",                                      # 9: Is Goal Approved
        "Performance Achievement Mapping",         # 10: Achievement mapping
        "100.00",                                   # 11: Achievement
    ]


def build_sub_goal_row(
    employee_id: str,
    kpi: NormalisedKPI,
    kra_index: int,
    kpi_index: int,
    cycle_start: str = "01-04-2026",
    cycle_end: str = "30-07-2026",
    status: str = "Completed",
    goal_plan_id: str = "HRBP_Test",
    goal_plan_name: str = "HRBP_GOAL_PLAN_TESTING",
    kra_id_override: Optional[str] = None,
) -> list[str]:
    """
    Build a single Bulk Sub Goals CSV row for one KPI with 15 active columns.
    """
    formatted_weight = str(int(kpi.weight)) if kpi.weight == int(kpi.weight) else f"{kpi.weight:.2f}"
    metric_name = _infer_darwinbox_metric_name(kpi.metric)
    target_prefix = _infer_target_prefix(metric_name, kpi.title, kpi.description)
    target_val = kpi.target or "100"
    formatted_subgoal_plan_id = _format_my_goal_plan_id(goal_plan_id, goal_plan_name)

    return [
        employee_id,                                # 1: Employee ID*
        kra_id_override or "",                      # 2: Goals / Key Result Areas ID* (Mapped or Blank)
        kpi.title,                                  # 3: Sub Goal Name*
        kpi.description,                            # 4: Subgoal description
        target_val,                                 # 5: Target
        target_prefix,                              # 6: Target Prefix
        status,                                     # 7: Sub Goal Status ("Completed")
        formatted_weight,                           # 8: Weightage
        metric_name,                                # 9: Metric ("Percentage", "Number", "TimeLine", "Currency", "Milestone")
        cycle_start,                                # 10: Start Date
        cycle_end,                                  # 11: End Date
        "Yes",                                      # 12: Is Goals / Key Result Areas Approved
        formatted_subgoal_plan_id,                 # 13: My Goal Plan ID ("HRBP_Test")
        "100.00",                                   # 14: Achievement
        target_val,                                 # 15: Achieved (Same as Target)
    ]


# ═══════════════════════════════════════════════════════════════════════════════
# Report Parsing & Enriched CSV Generation
# ═══════════════════════════════════════════════════════════════════════════════

def _clean_key_text(text: str) -> str:
    """Helper to clean UTF-8 BOM, strip spaces, and normalize to alphanumeric lowercase."""
    text = str(text).replace('\ufeff', '').strip().lower()
    return re.sub(r'[^a-z0-9]', '', text)


def parse_darwinbox_goals_report(
    report_content: str | bytes | None
) -> tuple[dict[tuple[str, str], str], dict[tuple[str, int], str]]:
    """
    Parse a Darwinbox Goals Report (CSV string, CSV bytes, or Excel bytes) content and extract mappings:
    Returns (title_mapping, index_mapping) where:
      - title_mapping: (employee_id_upper, cleaned_kra_title) -> darwinbox_kra_id
      - index_mapping: (employee_id_upper, kra_index_order) -> darwinbox_kra_id
    """
    if not report_content:
        return {}, {}

    rows: list[list[str]] = []

    if isinstance(report_content, bytes):
        if report_content.startswith(b'PK\x03\x04'):
            try:
                import pandas as pd
                df = pd.read_excel(io.BytesIO(report_content))
                rows = [df.columns.astype(str).tolist()] + df.astype(str).values.tolist()
            except Exception as e:
                logger.warning(f"Failed to parse report bytes as Excel: {e}")
                report_text = report_content.decode("utf-8", errors="replace")
                reader = csv.reader(io.StringIO(report_text.lstrip('\ufeff')))
                rows = list(reader)
        else:
            report_text = report_content.decode("utf-8", errors="replace")
            reader = csv.reader(io.StringIO(report_text.lstrip('\ufeff')))
            rows = list(reader)
    else:
        report_text = str(report_content).lstrip('\ufeff')
        reader = csv.reader(io.StringIO(report_text))
        rows = list(reader)

    if not rows:
        return {}, {}

    title_mapping: dict[tuple[str, str], str] = {}
    index_mapping: dict[tuple[str, int], str] = {}
    seen_kras_per_emp: dict[str, list[str]] = {}

    emp_col_idx = None
    kra_title_col_idx = None
    kra_id_col_idx = None
    header_found = False

    emp_keywords = ['employeeid', 'empid', 'employeecode', 'empcode', 'assignedto', 'employeenumber', 'employeeno', 'userid']
    kra_id_keywords = ['keyresultareasid', 'keyresultareaid', 'kraid', 'goalid', 'goalcode', 'kracode', 'goaluniqueid', 'krauniqueid', 'uniqueid', 'goalskeyresultareasid', 'goalskeyresultareaid']
    kra_title_keywords = ['keyresultareasname', 'keyresultareaname', 'keyresultareas', 'keyresultarea', 'kratitle', 'kraname', 'goalname', 'goaltitle', 'goalskeyresultareasname', 'goalskeyresultareaname']

    for row in rows:
        if not row:
            continue

        clean_row = [_clean_key_text(c) for c in row]

        if not header_found:
            for idx, cell in enumerate(clean_row):
                if any(kw in cell for kw in emp_keywords) and emp_col_idx is None:
                    emp_col_idx = idx
                elif any(kw in cell for kw in kra_id_keywords) and kra_id_col_idx is None:
                    kra_id_col_idx = idx
                elif any(kw in cell for kw in kra_title_keywords) and 'id' not in cell and 'code' not in cell and kra_title_col_idx is None:
                    kra_title_col_idx = idx

            if emp_col_idx is not None and kra_id_col_idx is not None:
                header_found = True
                continue

        if header_found and len(row) > max(emp_col_idx, kra_id_col_idx):
            raw_emp = str(row[emp_col_idx]).strip().upper()
            kra_id = str(row[kra_id_col_idx]).strip()

            if not raw_emp or not kra_id or kra_id.lower() in ('nan', 'none', 'null', ''):
                continue

            raw_title = str(row[kra_title_col_idx]).strip() if (kra_title_col_idx is not None and len(row) > kra_title_col_idx) else ""
            clean_title = _clean_key_text(raw_title)

            emp_variants = [raw_emp, raw_emp.lstrip('0')]

            for emp_var in emp_variants:
                if not emp_var:
                    continue
                if clean_title:
                    title_mapping[(emp_var, clean_title)] = kra_id

                if emp_var not in seen_kras_per_emp:
                    seen_kras_per_emp[emp_var] = []
                if kra_id not in seen_kras_per_emp[emp_var]:
                    order_idx = len(seen_kras_per_emp[emp_var])
                    seen_kras_per_emp[emp_var].append(kra_id)
                    index_mapping[(emp_var, order_idx)] = kra_id

    logger.info(
        f"[DarwinboxExporter] Parsed status report: {len(title_mapping)} title mappings, "
        f"{len(index_mapping)} index mappings across {len(seen_kras_per_emp)} employees."
    )

    return title_mapping, index_mapping


# ═══════════════════════════════════════════════════════════════════════════════
# CSV String Generation
# ═══════════════════════════════════════════════════════════════════════════════

def generate_goals_csv(
    records: list[EmployeeExportRecord],
    cycle_start: str = "01-04-2026",
    cycle_end: str = "30-07-2026",
    goal_plan_name: str = "HRBP_GOAL_PLAN_TESTING",
    goal_plan_id: str = "HRBP_Test",
) -> str:
    """
    Generate the complete Bulk Goals.csv content string for a list of employees.
    Each employee contributes N rows (one per KRA).
    """
    output = io.StringIO()
    writer = csv.writer(output, quoting=csv.QUOTE_ALL)
    writer.writerow(BULK_GOALS_HEADERS)

    for record in records:
        for kra_idx, kra in enumerate(record.kras):
            row = build_goal_row(
                employee_id=record.employee_id,
                kra=kra,
                kra_index=kra_idx,
                cycle_start=cycle_start,
                cycle_end=cycle_end,
                status="Completed",
                goal_plan_name=goal_plan_name,
                goal_plan_id=goal_plan_id,
            )
            writer.writerow(row)

    return output.getvalue()


def generate_sub_goals_csv(
    records: list[EmployeeExportRecord],
    cycle_start: str = "01-04-2026",
    cycle_end: str = "30-07-2026",
    goal_plan_name: str = "HRBP_GOAL_PLAN_TESTING",
    goal_plan_id: str = "HRBP_Test",
    report_csv_content: Optional[str | bytes] = None,
) -> str:
    """
    Generate the complete Bulk Sub Goals.csv content string for a list of employees.
    If report_csv_content is provided, maps Darwinbox KRA IDs into column 2.
    """
    title_mapping, index_mapping = parse_darwinbox_goals_report(report_csv_content) if report_csv_content else ({}, {})

    output = io.StringIO()
    writer = csv.writer(output, quoting=csv.QUOTE_ALL)
    writer.writerow(BULK_SUB_GOALS_HEADERS)

    for record in records:
        emp_id = record.employee_id.strip().upper()
        emp_variants = [emp_id, emp_id.lstrip('0')]

        for kra_idx, kra in enumerate(record.kras):
            clean_kra_title = _clean_key_text(kra.title)
            darwinbox_kra_id = ""

            for ev in emp_variants:
                darwinbox_kra_id = (
                    title_mapping.get((ev, clean_kra_title)) or
                    index_mapping.get((ev, kra_idx)) or
                    ""
                )
                if darwinbox_kra_id:
                    break

            for kpi_idx, kpi in enumerate(kra.kpis):
                row = build_sub_goal_row(
                    employee_id=record.employee_id,
                    kpi=kpi,
                    kra_index=kra_idx,
                    kpi_index=kpi_idx,
                    cycle_start=cycle_start,
                    cycle_end=cycle_end,
                    status="Completed",
                    goal_plan_name=goal_plan_name,
                    goal_plan_id=goal_plan_id,
                    kra_id_override=darwinbox_kra_id,
                )
                writer.writerow(row)

    return output.getvalue()


def generate_zip_bundle(
    records: list[EmployeeExportRecord],
    filename_prefix: str = "Darwinbox_Export",
    cycle_start: str = "01-04-2026",
    cycle_end: str = "30-07-2026",
    goal_plan_name: str = "HRBP_GOAL_PLAN_TESTING",
    goal_plan_id: str = "HRBP_Test",
) -> bytes:
    """
    Generate a ZIP file containing both Bulk Goals.csv and Bulk Sub Goals.csv.
    Returns raw bytes ready for HTTP response.
    """
    goals_csv = generate_goals_csv(
        records, cycle_start=cycle_start, cycle_end=cycle_end, goal_plan_name=goal_plan_name, goal_plan_id=goal_plan_id
    )
    sub_goals_csv = generate_sub_goals_csv(
        records, cycle_start=cycle_start, cycle_end=cycle_end, goal_plan_name=goal_plan_name, goal_plan_id=goal_plan_id
    )

    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(f"{filename_prefix}_Bulk_Goals.csv", goals_csv)
        zf.writestr(f"{filename_prefix}_Bulk_Sub_Goals.csv", sub_goals_csv)

    return zip_buffer.getvalue()


# ═══════════════════════════════════════════════════════════════════════════════
# Database → Export Records  (the main orchestration functions)
# ═══════════════════════════════════════════════════════════════════════════════

async def _fetch_organogram_info(
    db: AsyncSession,
    employee_ids: list[str],
) -> dict[str, dict]:
    """
    Fetch employee metadata from organogram table for the given employee IDs.
    Returns dict keyed by employee code.
    """
    if not employee_ids:
        return {}

    # Build parameterised IN clause
    placeholders = ", ".join(f":emp_{i}" for i in range(len(employee_ids)))
    params = {f"emp_{i}": eid for i, eid in enumerate(employee_ids)}

    query = text(f"""
        SELECT code, employee_name, department, designation
        FROM organogram
        WHERE code IN ({placeholders})
    """)

    async with db.begin_nested():
        result = await db.execute(query, params)
    rows = result.mappings().all()

    return {
        row["code"]: {
            "employee_name": row.get("employee_name", ""),
            "department": row.get("department", ""),
            "designation": row.get("designation", ""),
        }
        for row in rows
    }


async def fetch_employee_export_records(
    db: AsyncSession,
    employee_id: Optional[str] = None,
    department: Optional[str] = None,
    status_filter: Optional[list[str]] = None,
) -> list[EmployeeExportRecord]:
    """
    Fetch and normalise KRA/KPI data for Darwinbox export.

    Priority: UploadedKRAKPI > KRAKPISession (matching existing app behaviour).

    Args:
        db: Async database session
        employee_id: If provided, export only this employee
        department: If provided, filter by department (from organogram)
        status_filter: KRAKPISession statuses to include (default: approved, confirmed, sent_to_hr)

    Returns:
        List of EmployeeExportRecord ready for CSV generation.
    """
    if status_filter is None:
        status_filter = ["approved", "confirmed"]

    records_map: dict[str, EmployeeExportRecord] = {}

    # ── Step 1: Fetch UploadedKRAKPI records (highest priority) ──────────────
    uploaded_query = select(UploadedKRAKPI)
    if employee_id:
        uploaded_query = uploaded_query.where(UploadedKRAKPI.employee_id == employee_id)

    uploaded_result = await db.execute(uploaded_query)
    uploaded_records = uploaded_result.scalars().all()

    for rec in uploaded_records:
        emp_id = rec.employee_id
        kras = normalise_kras(rec.kras, emp_id, source="uploaded")
        if kras:
            records_map[emp_id] = EmployeeExportRecord(
                employee_id=emp_id,
                employee_name=rec.employee_name or "",
                kras=kras,
                source="uploaded",
            )

    # ── Step 2: Fetch KRAKPISession records (fill in employees not in uploaded) ──
    session_query = select(KRAKPISession).where(
        KRAKPISession.status.in_(status_filter),
        KRAKPISession.kras.isnot(None),
    )
    if employee_id:
        session_query = session_query.where(KRAKPISession.employee_id == employee_id)

    # Get latest session per employee
    session_query = session_query.order_by(KRAKPISession.updated_at.desc())

    session_result = await db.execute(session_query)
    session_records = session_result.scalars().all()

    # Deduplicate: only take the latest session per employee
    seen_employees: set[str] = set(records_map.keys())  # Skip those already from uploads
    for rec in session_records:
        emp_id = rec.employee_id
        if emp_id in seen_employees:
            continue
        seen_employees.add(emp_id)

        kras = normalise_kras(rec.kras, emp_id, source="session")
        if kras:
            records_map[emp_id] = EmployeeExportRecord(
                employee_id=emp_id,
                kras=kras,
                source="session",
            )

    # ── Step 3: Enrich with organogram metadata ──────────────────────────────
    all_emp_ids = list(records_map.keys())
    if all_emp_ids:
        org_info = await _fetch_organogram_info(db, all_emp_ids)
        for emp_id, info in org_info.items():
            if emp_id in records_map:
                records_map[emp_id].employee_name = info.get("employee_name", records_map[emp_id].employee_name)
                records_map[emp_id].department = info.get("department", "")
                records_map[emp_id].designation = info.get("designation", "")

    # ── Step 4: Filter by department if requested ────────────────────────────
    result_list = list(records_map.values())
    if department and department.strip() and department.strip().lower() != "all":
        dept_lower = department.strip().lower()
        if dept_lower == "unassigned":
            result_list = [
                r for r in result_list
                if not r.department or not r.department.strip() or r.department.strip().lower() == "unassigned"
            ]
        else:
            result_list = [
                r for r in result_list
                if r.department and r.department.strip().lower() == dept_lower
            ]

    # Sort by employee_id for consistent output
    result_list.sort(key=lambda r: r.employee_id)

    logger.info(
        f"[DarwinboxExporter] Prepared {len(result_list)} employee export records "
        f"({sum(1 for r in result_list if r.source == 'uploaded')} uploaded, "
        f"{sum(1 for r in result_list if r.source == 'session')} session-based)"
    )

    return result_list


# ═══════════════════════════════════════════════════════════════════════════════
# High-level convenience functions (called by routes)
# ═══════════════════════════════════════════════════════════════════════════════

async def export_goals_csv(
    db: AsyncSession,
    employee_id: Optional[str] = None,
    department: Optional[str] = None,
    cycle_start: str = "01-04-2026",
    cycle_end: str = "30-07-2026",
    goal_plan_name: str = "HRBP_GOAL_PLAN_TESTING",
    goal_plan_id: str = "HRBP_Test",
) -> tuple[str, str]:
    """
    Export Bulk Goals CSV.
    Returns (csv_string, suggested_filename).
    """
    records = await fetch_employee_export_records(db, employee_id=employee_id, department=department)
    if not records:
        raise ValueError("No approved KRA/KPI records found for the given filters.")

    csv_content = generate_goals_csv(
        records, cycle_start=cycle_start, cycle_end=cycle_end, goal_plan_name=goal_plan_name, goal_plan_id=goal_plan_id
    )

    if employee_id:
        filename = f"Darwinbox_Goals_{employee_id}.csv"
    elif department:
        filename = f"Darwinbox_Goals_{department.replace(' ', '_')}.csv"
    else:
        filename = "Darwinbox_Goals_Company.csv"

    return csv_content, filename


async def export_sub_goals_csv(
    db: AsyncSession,
    employee_id: Optional[str] = None,
    department: Optional[str] = None,
    cycle_start: str = "01-04-2026",
    cycle_end: str = "30-07-2026",
    goal_plan_name: str = "HRBP_GOAL_PLAN_TESTING",
    goal_plan_id: str = "HRBP_Test",
    report_csv_content: Optional[str | bytes] = None,
) -> tuple[str, str]:
    """
    Export Bulk Sub Goals CSV, optionally mapped with Darwinbox KRA IDs from report_csv_content.
    Returns (csv_string, suggested_filename).
    """
    records = await fetch_employee_export_records(db, employee_id=employee_id, department=department)
    if not records:
        raise ValueError("No approved KRA/KPI records found for the given filters.")

    csv_content = generate_sub_goals_csv(
        records,
        cycle_start=cycle_start,
        cycle_end=cycle_end,
        goal_plan_name=goal_plan_name,
        goal_plan_id=goal_plan_id,
        report_csv_content=report_csv_content,
    )

    if employee_id:
        filename = f"Bulk_Sub_Goals_{employee_id}.csv"
    elif department:
        filename = f"Bulk_Sub_Goals_{department.replace(' ', '_')}.csv"
    else:
        filename = "Bulk_Sub_Goals_Company.csv"

    return csv_content, filename


async def export_zip_bundle(
    db: AsyncSession,
    employee_id: Optional[str] = None,
    department: Optional[str] = None,
    cycle_start: str = "01-04-2026",
    cycle_end: str = "30-07-2026",
    goal_plan_name: str = "HRBP_GOAL_PLAN_TESTING",
    goal_plan_id: str = "HRBP_Test",
) -> tuple[bytes, str]:
    """
    Export ZIP bundle containing both CSVs.
    Returns (zip_bytes, suggested_filename).
    """
    records = await fetch_employee_export_records(db, employee_id=employee_id, department=department)
    if not records:
        raise ValueError("No approved KRA/KPI records found for the given filters.")

    if employee_id:
        prefix = f"Darwinbox_{employee_id}"
        filename = f"Darwinbox_Goals_{employee_id}.zip"
    elif department:
        dept_safe = department.replace(" ", "_")
        prefix = f"Darwinbox_{dept_safe}"
        filename = f"Darwinbox_Goals_{dept_safe}.zip"
    else:
        prefix = "Darwinbox_Company"
        filename = "Darwinbox_Goals_Company.zip"

    zip_bytes = generate_zip_bundle(
        records, filename_prefix=prefix, cycle_start=cycle_start, cycle_end=cycle_end, goal_plan_name=goal_plan_name, goal_plan_id=goal_plan_id
    )
    return zip_bytes, filename


async def get_export_summary(
    db: AsyncSession,
    employee_id: Optional[str] = None,
    department: Optional[str] = None,
) -> dict:
    """
    Return a preview/summary of what would be exported without generating CSVs.
    Useful for the frontend to show confirmation before download.
    """
    records = await fetch_employee_export_records(db, employee_id=employee_id, department=department)

    total_kras = sum(len(r.kras) for r in records)
    total_kpis = sum(sum(len(kra.kpis) for kra in r.kras) for r in records)

    employees_summary = []
    for r in records:
        emp_kras = len(r.kras)
        emp_kpis = sum(len(kra.kpis) for kra in r.kras)
        employees_summary.append({
            "employee_id": r.employee_id,
            "employee_name": r.employee_name,
            "department": r.department,
            "designation": r.designation,
            "source": r.source,
            "num_kras": emp_kras,
            "num_kpis": emp_kpis,
        })

    return {
        "total_employees": len(records),
        "total_kras": total_kras,
        "total_kpis": total_kpis,
        "total_goal_rows": total_kras,
        "total_sub_goal_rows": total_kpis,
        "employees": employees_summary,
    }
