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
    "Goals / Key Result Areas Code*",
    "Methodology",
    "Enable Sub Goal",
    "Allow to add or remove Sub Goal",
    "Goals / Key Result Areas Name",
    "Tagged To",
    "Assigned To",
    "Mandatory",
    "Achievement %",
    "Goals / Key Result Areas Description",
    "Is Goals / Key Result Areas Description Editable?",
    "Timelines Start Date",
    "Timelines End Date",
    "Is Timelines editable?",
    "Goals / Key Result Areas Status",
    "Weightage",
    "Is Weightage editable?",
    "Target",
    "Target type",
    "Is Target editable?",
    "Metric",
    "Is Metric editable?",
    "Achieved",
    "Scorecard Pillar",
    "Is Scorecard Pillar editable?",
    "Tags Option",
    "Is Tags Option editable?",
    "Achievement Mapping",
    "Is Achievement Mapping editable?",
    "Goals / Key Result Areas Score Formula",
    "Is Goals / Key Result Areas Score Formula editable?",
    "Custom Field 1 ID",
    "Custom Field 1 Value",
    "Is Custom Field 1 editable?",
    "Custom Field 2 ID",
    "Custom Field 2 Value",
    "Is Custom Field 2 editable?",
    "Custom Field 3 ID",
    "Custom Field 3 Value",
    "Is Custom Field 3 editable?",
    "Custom Field 4 ID",
    "Custom Field 4 Value",
    "Is Custom Field 4 editable?",
    "Custom Field 5 ID",
    "Custom Field 5 Value",
    "Is Custom Field 5 editable?",
    "Custom Field 6 ID",
    "Custom Field 6 Value",
    "Is Custom Field 6 editable?",
    "Actions",
]  # 50 columns

BULK_SUB_GOALS_HEADERS: list[str] = [
    "Sub Goal ID",
    "Goals / Key Result Areas Code*",
    "Sub Goal Name",
    "Achievement %",
    "Description",
    "Is Description Editable?",
    "Timeline Start Date",
    "Timeline End Date",
    "Is Timeline editable?",
    "Sub Goal Status",
    "Weightage",
    "Is Weightage editable?",
    "Target",
    "Is Target editable?",
    "Target Type",
    "Metric",
    "Is Metric editable?",
    "Achieved",
    "Sub Goal Score Formula",
    "Is Goal Score Formula editable?",
    "Custom Field 1 ID",
    "Custom Field 1 Value",
    "Is Custom Field 1 editable?",
    "Custom Field 2 ID",
    "Custom Field 2 Value",
    "Is Custom Field 2 editable?",
    "Custom Field 3 ID",
    "Custom Field 3 Value",
    "Is Custom Field 3 editable?",
    "Custom Field 4 ID",
    "Custom Field 4 Value",
    "Is Custom Field 4 editable?",
    "Custom Field 5 ID",
    "Custom Field 5 Value",
    "Is Custom Field 5 editable?",
    "Custom Field 6 ID",
    "Custom Field 6 Value",
    "Is Custom Field 6 editable?",
    "Actions",
    "Enable Activities?",
    "Make Activities Alias Editable?",
    "Activity Id",
    "Activity 1 Title",
    "Activity 1 Status",
    "Activity 1 Start Date",
    "Activity 1 Due Date",
    "Activity 2 Title",
    "Activity 2 Status",
    "Activity 2 Start Date",
    "Activity 2 Due Date",
    "Activity 3 Title",
    "Activity 3 Status",
    "Activity 3 Start Date",
    "Activity 3 Due Date",
    "Activity 4 Title",
    "Activity 4 Status",
    "Activity 4 Start Date",
    "Activity 4 Due Date",
    "Activity 5 Title",
    "Activity 5 Status",
    "Activity 5 Start Date",
    "Activity 5 Due Date",
]  # 62 columns


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
    import re
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
    cycle_start: str = "01-04-2025",
    cycle_end: str = "31-03-2026",
    status: str = "approved",
) -> list[str]:
    """
    Build a single Bulk Goals.csv row for one KRA.
    Returns a list of exactly 50 string values matching BULK_GOALS_HEADERS.
    """
    goal_code = f"{employee_id}_KRA_{kra_index + 1:02d}"

    return [
        goal_code,                                  # Goals / Key Result Areas Code*
        "Goal Base",                                # Methodology
        "Yes",                                      # Enable Sub Goal
        "Yes",                                      # Allow to add or remove Sub Goal
        kra.title,                                  # Goals / Key Result Areas Name
        "Individual",                               # Tagged To
        employee_id,                                # Assigned To
        "No",                                       # Mandatory
        "0",                                        # Achievement %
        kra.description,                            # Goals / Key Result Areas Description
        "Yes",                                      # Is Description Editable?
        cycle_start,                                # Timelines Start Date
        cycle_end,                                  # Timelines End Date
        "Yes",                                      # Is Timelines editable?
        _status_label(status),                      # Goals / Key Result Areas Status
        str(int(kra.weight)) if kra.weight == int(kra.weight) else f"{kra.weight:.2f}",  # Weightage
        "Yes",                                      # Is Weightage editable?
        "100",                                      # Target
        "Percentage",                               # Target type
        "Yes",                                      # Is Target editable?
        "%",                                        # Metric
        "Yes",                                      # Is Metric editable?
        "",                                         # Achieved
        "",                                         # Scorecard Pillar
        "Yes",                                      # Is Scorecard Pillar editable?
        "",                                         # Tags Option
        "Yes",                                      # Is Tags Option editable?
        "",                                         # Achievement Mapping
        "Yes",                                      # Is Achievement Mapping editable?
        "",                                         # Goals / Key Result Areas Score Formula
        "Yes",                                      # Is Score Formula editable?
        "",                                         # Custom Field 1 ID
        "",                                         # Custom Field 1 Value
        "Yes",                                      # Is Custom Field 1 editable?
        "",                                         # Custom Field 2 ID
        "",                                         # Custom Field 2 Value
        "Yes",                                      # Is Custom Field 2 editable?
        "",                                         # Custom Field 3 ID
        "",                                         # Custom Field 3 Value
        "Yes",                                      # Is Custom Field 3 editable?
        "",                                         # Custom Field 4 ID
        "",                                         # Custom Field 4 Value
        "Yes",                                      # Is Custom Field 4 editable?
        "",                                         # Custom Field 5 ID
        "",                                         # Custom Field 5 Value
        "Yes",                                      # Is Custom Field 5 editable?
        "",                                         # Custom Field 6 ID
        "",                                         # Custom Field 6 Value
        "Yes",                                      # Is Custom Field 6 editable?
        "Add",                                      # Actions
    ]


def build_sub_goal_row(
    employee_id: str,
    kpi: NormalisedKPI,
    kra_index: int,
    kpi_index: int,
    cycle_start: str = "01-04-2025",
    cycle_end: str = "31-03-2026",
    status: str = "approved",
) -> list[str]:
    """
    Build a single Bulk Sub Goals.csv row for one KPI.
    Returns a list of exactly 62 string values matching BULK_SUB_GOALS_HEADERS.
    """
    parent_goal_code = f"{employee_id}_KRA_{kra_index + 1:02d}"
    sub_goal_id = f"{employee_id}_KPI_{kra_index + 1:02d}_{kpi_index + 1:02d}"

    # Build score formula from measurement method if available
    score_formula = kpi.measurement_method or ""

    return [
        sub_goal_id,                                # Sub Goal ID
        parent_goal_code,                           # Goals / Key Result Areas Code*  (FK link)
        kpi.title,                                  # Sub Goal Name
        "0",                                        # Achievement %
        kpi.description,                            # Description
        "Yes",                                      # Is Description Editable?
        cycle_start,                                # Timeline Start Date
        cycle_end,                                  # Timeline End Date
        "Yes",                                      # Is Timeline editable?
        _status_label(status),                      # Sub Goal Status
        str(int(kpi.weight)) if kpi.weight == int(kpi.weight) else f"{kpi.weight:.2f}",  # Weightage
        "Yes",                                      # Is Weightage editable?
        kpi.target,                                 # Target
        "Yes",                                      # Is Target editable?
        kpi.target_type,                            # Target Type
        kpi.metric,                                 # Metric
        "Yes",                                      # Is Metric editable?
        "",                                         # Achieved
        score_formula,                              # Sub Goal Score Formula
        "Yes",                                      # Is Goal Score Formula editable?
        "",                                         # Custom Field 1 ID
        "",                                         # Custom Field 1 Value
        "Yes",                                      # Is Custom Field 1 editable?
        "",                                         # Custom Field 2 ID
        "",                                         # Custom Field 2 Value
        "Yes",                                      # Is Custom Field 2 editable?
        "",                                         # Custom Field 3 ID
        "",                                         # Custom Field 3 Value
        "Yes",                                      # Is Custom Field 3 editable?
        "",                                         # Custom Field 4 ID
        "",                                         # Custom Field 4 Value
        "Yes",                                      # Is Custom Field 4 editable?
        "",                                         # Custom Field 5 ID
        "",                                         # Custom Field 5 Value
        "Yes",                                      # Is Custom Field 5 editable?
        "",                                         # Custom Field 6 ID
        "",                                         # Custom Field 6 Value
        "Yes",                                      # Is Custom Field 6 editable?
        "Add",                                      # Actions
        "No",                                       # Enable Activities?
        "Yes",                                      # Make Activities Alias Editable?
        "",                                         # Activity Id
        "",                                         # Activity 1 Title
        "",                                         # Activity 1 Status
        "",                                         # Activity 1 Start Date
        "",                                         # Activity 1 Due Date
        "",                                         # Activity 2 Title
        "",                                         # Activity 2 Status
        "",                                         # Activity 2 Start Date
        "",                                         # Activity 2 Due Date
        "",                                         # Activity 3 Title
        "",                                         # Activity 3 Status
        "",                                         # Activity 3 Start Date
        "",                                         # Activity 3 Due Date
        "",                                         # Activity 4 Title
        "",                                         # Activity 4 Status
        "",                                         # Activity 4 Start Date
        "",                                         # Activity 4 Due Date
        "",                                         # Activity 5 Title
        "",                                         # Activity 5 Status
        "",                                         # Activity 5 Start Date
        "",                                         # Activity 5 Due Date
    ]


# ═══════════════════════════════════════════════════════════════════════════════
# CSV String Generation
# ═══════════════════════════════════════════════════════════════════════════════

def generate_goals_csv(
    records: list[EmployeeExportRecord],
    cycle_start: str = "01-04-2025",
    cycle_end: str = "31-03-2026",
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
                status="approved",
            )
            writer.writerow(row)

    return output.getvalue()


def generate_sub_goals_csv(
    records: list[EmployeeExportRecord],
    cycle_start: str = "01-04-2025",
    cycle_end: str = "31-03-2026",
) -> str:
    """
    Generate the complete Bulk Sub Goals.csv content string for a list of employees.
    Each KPI becomes one row, linked to its parent KRA via the goal code.
    """
    output = io.StringIO()
    writer = csv.writer(output, quoting=csv.QUOTE_ALL)
    writer.writerow(BULK_SUB_GOALS_HEADERS)

    for record in records:
        for kra_idx, kra in enumerate(record.kras):
            for kpi_idx, kpi in enumerate(kra.kpis):
                row = build_sub_goal_row(
                    employee_id=record.employee_id,
                    kpi=kpi,
                    kra_index=kra_idx,
                    kpi_index=kpi_idx,
                    cycle_start=cycle_start,
                    cycle_end=cycle_end,
                    status="approved",
                )
                writer.writerow(row)

    return output.getvalue()


def generate_zip_bundle(
    records: list[EmployeeExportRecord],
    filename_prefix: str = "Darwinbox_Export",
    cycle_start: str = "01-04-2025",
    cycle_end: str = "31-03-2026",
) -> bytes:
    """
    Generate a ZIP file containing both Bulk Goals.csv and Bulk Sub Goals.csv.
    Returns raw bytes ready for HTTP response.
    """
    goals_csv = generate_goals_csv(records, cycle_start, cycle_end)
    sub_goals_csv = generate_sub_goals_csv(records, cycle_start, cycle_end)

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
        status_filter = ["approved", "confirmed", "sent_to_hr"]

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
    if department:
        dept_lower = department.strip().lower()
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
    cycle_start: str = "01-04-2025",
    cycle_end: str = "31-03-2026",
) -> tuple[str, str]:
    """
    Export Bulk Goals CSV.
    Returns (csv_string, suggested_filename).
    """
    records = await fetch_employee_export_records(db, employee_id=employee_id, department=department)
    if not records:
        raise ValueError("No approved KRA/KPI records found for the given filters.")

    csv_content = generate_goals_csv(records, cycle_start, cycle_end)

    if employee_id:
        filename = f"Bulk_Goals_{employee_id}.csv"
    elif department:
        filename = f"Bulk_Goals_{department.replace(' ', '_')}.csv"
    else:
        filename = "Bulk_Goals_Company.csv"

    return csv_content, filename


async def export_sub_goals_csv(
    db: AsyncSession,
    employee_id: Optional[str] = None,
    department: Optional[str] = None,
    cycle_start: str = "01-04-2025",
    cycle_end: str = "31-03-2026",
) -> tuple[str, str]:
    """
    Export Bulk Sub Goals CSV.
    Returns (csv_string, suggested_filename).
    """
    records = await fetch_employee_export_records(db, employee_id=employee_id, department=department)
    if not records:
        raise ValueError("No approved KRA/KPI records found for the given filters.")

    csv_content = generate_sub_goals_csv(records, cycle_start, cycle_end)

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
    cycle_start: str = "01-04-2025",
    cycle_end: str = "31-03-2026",
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

    zip_bytes = generate_zip_bundle(records, filename_prefix=prefix, cycle_start=cycle_start, cycle_end=cycle_end)
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
