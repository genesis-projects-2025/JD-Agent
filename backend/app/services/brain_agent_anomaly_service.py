"""
Brain Agent Anomaly Detection Service.

Runs a batch of pre-defined diagnostic SQL queries on new session start
and returns a structured anomaly report for proactive issue surfacing.
"""

import logging
from typing import Any, Dict, List
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)


async def run_diagnostics(db: AsyncSession) -> Dict[str, Any]:
    """
    Executes a set of read-only diagnostic queries and returns
    a structured anomaly report. Each check is run in its own subtransaction savepoint
    to avoid poisoning the main transaction in case of SQL errors.
    """
    anomalies: List[Dict[str, Any]] = []

    checks = [
        {
            "title": "Employees Without Job Descriptions",
            "severity": "warning",
            "sql": """
                SELECT o.code, o.employee_name, o.department
                FROM organogram o
                LEFT JOIN jd_sessions js ON js.employee_id = o.code
                WHERE js.id IS NULL
                LIMIT 10
            """,
            "format": lambda rows: f"{len(rows)} employee(s) have no JD session created. Examples: "
                + ", ".join(f"{r['employee_name']} ({r['code']})" for r in rows[:5])
                if rows else None,
        },
        {
            "title": "KRA Frameworks With Weight Not Equal to 100%",
            "severity": "critical",
            "sql": """
                SELECT ks.employee_id, o.employee_name, weight_calc.total_weight
                FROM kra_kpi_sessions ks
                JOIN organogram o ON o.code = ks.employee_id
                CROSS JOIN LATERAL (
                    SELECT SUM((kra->>'weight')::numeric) AS total_weight 
                    FROM jsonb_array_elements(ks.kras->'kras') kra
                ) weight_calc
                WHERE ks.status = 'confirmed'
                  AND weight_calc.total_weight IS NOT NULL
                  AND weight_calc.total_weight != 100
                LIMIT 10
            """,
            "format": lambda rows: f"{len(rows)} framework(s) have weights deviating from 100%. Examples: "
                + ", ".join(
                    f"{r['employee_name']} ({r['employee_id']}): {r['total_weight']}%"
                    for r in rows[:5]
                )
                if rows else None,
        },
        {
            "title": "KRA Sessions Stuck in Draft for Over 14 Days",
            "severity": "warning",
            "sql": """
                SELECT ks.employee_id, o.employee_name, ks.updated_at
                FROM kra_kpi_sessions ks
                JOIN organogram o ON o.code = ks.employee_id
                WHERE ks.status = 'draft'
                  AND ks.updated_at < NOW() - INTERVAL '14 days'
                LIMIT 10
            """,
            "format": lambda rows: f"{len(rows)} KRA session(s) have been in draft status for over 14 days. Examples: "
                + ", ".join(f"{r['employee_name']} ({r['employee_id']})" for r in rows[:5])
                if rows else None,
        },
        {
            "title": "Departments With Zero KRA Completion",
            "severity": "insight",
            "sql": """
                SELECT o.department, COUNT(*) AS total_employees,
                       COUNT(ks.id) FILTER (WHERE ks.status IN ('approved', 'sent_to_manager', 'sent_to_hr')) AS completed
                FROM organogram o
                LEFT JOIN kra_kpi_sessions ks ON ks.employee_id = o.code
                GROUP BY o.department
                HAVING COUNT(ks.id) FILTER (WHERE ks.status IN ('approved', 'sent_to_manager', 'sent_to_hr')) = 0
                LIMIT 10
            """,
            "format": lambda rows: f"{len(rows)} department(s) have 0% KRA completion: "
                + ", ".join(f"{r['department']} ({r['total_employees']} employees)" for r in rows[:5])
                if rows else None,
        },
    ]

    for check in checks:
        try:
            # Use begin_nested() to create a savepoint, preventing transaction poisoning
            async with db.begin_nested():
                result = await db.execute(text(check["sql"]))
                rows = [dict(r) for r in result.mappings().all()]
                if rows:
                    detail = check["format"](rows)
                    if detail:
                        anomalies.append({
                            "severity": check["severity"],
                            "title": check["title"],
                            "detail": detail,
                            "affected_count": len(rows),
                        })
        except Exception as e:
            logger.warning(f"Anomaly check '{check['title']}' failed: {e}")
            continue

    return {"anomalies": anomalies}


def format_anomaly_context(report: Dict[str, Any]) -> str:
    """Format anomaly report into a system prompt injection block."""
    anomalies = report.get("anomalies", [])
    if not anomalies:
        return ""

    severity_icons = {
        "critical": "🔴 CRITICAL",
        "warning": "⚠️ WARNING",
        "insight": "📊 INSIGHT",
    }

    lines = ["PROACTIVE DIAGNOSTIC REPORT (auto-generated on session start):"]
    for a in anomalies:
        icon = severity_icons.get(a["severity"], "ℹ️")
        lines.append(f"- [{icon}] {a['title']}: {a['detail']}")

    lines.append("")
    lines.append(
        "Present these findings to the administrator proactively in your first response. "
        "Structure them clearly with severity indicators and actionable recommendations."
    )

    return "\n".join(lines)
