"""
Pulse Dynamic Insights Service.

Generates live, contextual suggestion cards for the Pulse admin dashboard
by running lightweight diagnostic SQL queries against the database.
"""

import logging
import asyncio
from typing import Any, Dict, List
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)


async def _run_insight_query(db: AsyncSession, sql: str) -> List[Dict]:
    """Run a single insight query inside a savepoint to avoid transaction poisoning."""
    try:
        async with db.begin_nested():
            result = await db.execute(text(sql))
            return [dict(r) for r in result.mappings().all()]
    except Exception as e:
        logger.warning(f"Insight query failed: {e}")
        return []


async def generate_dynamic_insights(db: AsyncSession) -> List[Dict[str, Any]]:
    """
    Run 6 diagnostic queries concurrently and return up to 4 prioritized
    suggestion cards for the Pulse dashboard.
    """

    # Define all insight queries
    queries = {
        "weight_mismatch": """
            SELECT COUNT(DISTINCT ks.employee_id) AS cnt
            FROM kra_kpi_sessions ks
            CROSS JOIN LATERAL (
                SELECT SUM((kra->>'weight')::numeric) AS total_weight
                FROM jsonb_array_elements(ks.kras->'kras') kra
            ) wc
            WHERE ks.status IN ('confirmed', 'sent_to_manager', 'sent_to_hr', 'approved')
              AND wc.total_weight IS NOT NULL
              AND wc.total_weight != 100
        """,
        "stalled_jds": """
            SELECT COUNT(*) AS cnt
            FROM jd_sessions
            WHERE status = 'sent_to_manager'
              AND sent_to_manager_at < NOW() - INTERVAL '7 days'
        """,
        "dept_kra_progress": """
            SELECT o.department,
                   COUNT(DISTINCT o.code) AS total,
                   COUNT(DISTINCT ks.employee_id) FILTER (
                       WHERE ks.status IN ('confirmed', 'sent_to_manager', 'sent_to_hr', 'approved')
                   ) AS completed
            FROM organogram o
            LEFT JOIN kra_kpi_sessions ks ON ks.employee_id = o.code
            WHERE o.department IS NOT NULL AND o.department != ''
            GROUP BY o.department
            ORDER BY (COUNT(DISTINCT ks.employee_id) FILTER (
                WHERE ks.status IN ('confirmed', 'sent_to_manager', 'sent_to_hr', 'approved')
            ))::float / GREATEST(COUNT(DISTINCT o.code), 1) ASC
            LIMIT 1
        """,
        "no_jd": """
            SELECT COUNT(DISTINCT o.code) AS cnt
            FROM organogram o
            LEFT JOIN jd_sessions js ON js.employee_id = o.code
            WHERE js.id IS NULL
        """,
        "skill_coverage": """
            SELECT o.department, COUNT(DISTINCT s.name) AS skill_count
            FROM organogram o
            LEFT JOIN employee_skills es ON es.employee_id = o.code
            LEFT JOIN skills s ON s.id = es.skill_id
            WHERE o.department IS NOT NULL AND o.department != ''
            GROUP BY o.department
            ORDER BY COUNT(DISTINCT s.name) ASC
            LIMIT 1
        """,
        "recent_activity": """
            SELECT
                (SELECT COUNT(*) FROM jd_sessions WHERE created_at > NOW() - INTERVAL '7 days') AS jds_this_week,
                (SELECT COUNT(*) FROM kra_kpi_sessions WHERE created_at > NOW() - INTERVAL '7 days') AS kras_this_week
        """,
    }

    # Run all queries concurrently
    results = await asyncio.gather(
        _run_insight_query(db, queries["weight_mismatch"]),
        _run_insight_query(db, queries["stalled_jds"]),
        _run_insight_query(db, queries["dept_kra_progress"]),
        _run_insight_query(db, queries["no_jd"]),
        _run_insight_query(db, queries["skill_coverage"]),
        _run_insight_query(db, queries["recent_activity"]),
    )

    weight_rows, stalled_rows, dept_rows, no_jd_rows, skill_rows, activity_rows = results

    insights: List[Dict[str, Any]] = []

    # 1. Weight mismatch (critical)
    cnt = weight_rows[0]["cnt"] if weight_rows else 0
    if cnt > 0:
        insights.append({
            "title": "KRA Weight Mismatch",
            "description": f"{cnt} employee(s) have KRA weights not summing to 100%.",
            "query": "List all employees whose KRA framework weights do not sum to 100%. Show their names, departments, and actual total weight in a table.",
            "severity": "critical",
            "icon": "alert",
        })

    # 2. Stalled JD approvals (warning)
    cnt = stalled_rows[0]["cnt"] if stalled_rows else 0
    if cnt > 0:
        insights.append({
            "title": "Stalled JD Approvals",
            "description": f"{cnt} JD(s) awaiting manager approval for over a week.",
            "query": "Show all Job Descriptions that have been sent to manager but not approved for more than 7 days. Include employee name, department, and the date they were sent.",
            "severity": "warning",
            "icon": "clock",
        })

    # 3. Department KRA progress (insight)
    if dept_rows:
        row = dept_rows[0]
        dept = row.get("department", "Unknown")
        total = row.get("total", 0)
        completed = row.get("completed", 0)
        if total > 0 and completed < total:
            insights.append({
                "title": f"{dept} KRA Progress",
                "description": f"Only {completed} of {total} employees have submitted KRA frameworks.",
                "query": f"Show the complete KRA/KPI completion breakdown for the {dept} department. For each employee, show their name, JD status, and KRA status in a table.",
                "severity": "warning" if completed / total < 0.3 else "insight",
                "icon": "chart",
            })

    # 4. Employees without JDs (warning)
    cnt = no_jd_rows[0]["cnt"] if no_jd_rows else 0
    if cnt > 0:
        insights.append({
            "title": "Missing Job Descriptions",
            "description": f"{cnt} employee(s) have no Job Description created.",
            "query": "List all employees in the organogram who do not have a JD session created. Show their name, department, designation, and reporting manager in a table.",
            "severity": "warning" if cnt > 5 else "insight",
            "icon": "users",
        })

    # 5. Skill coverage gaps (insight)
    if skill_rows:
        row = skill_rows[0]
        dept = row.get("department", "Unknown")
        skill_count = row.get("skill_count", 0)
        if skill_count < 10:
            insights.append({
                "title": f"Low Skill Coverage",
                "description": f"{dept} has only {skill_count} mapped skill(s) across all JDs.",
                "query": f"Analyze the skill coverage for the {dept} department. List all employees and their mapped skills. Identify any critical skill gaps.",
                "severity": "insight",
                "icon": "skills",
            })

    # 6. Recent activity (insight — always include as a neutral card)
    if activity_rows:
        row = activity_rows[0]
        jds = row.get("jds_this_week", 0)
        kras = row.get("kras_this_week", 0)
        insights.append({
            "title": "Weekly Activity",
            "description": f"{jds} JD(s) and {kras} KRA framework(s) created this week.",
            "query": "Show a summary of all JDs and KRA frameworks created or updated in the last 7 days, grouped by department. Include employee names and current statuses.",
            "severity": "insight",
            "icon": "activity",
        })

    # Prioritize: critical > warning > insight, return max 4
    severity_order = {"critical": 0, "warning": 1, "insight": 2}
    insights.sort(key=lambda x: severity_order.get(x["severity"], 3))

    return insights[:4]
