"""
Offline Pipeline & Enrichment Services.

Implements:
1. Per-task automation scoring (LLM)
2. Per-employee work summary (LLM)
3. Cross-department dependency extraction (LLM)
4. Rollup and bottleneck analysis synthesis (SQL + LLM)
"""

import json
import logging
import re
import uuid
import datetime
from typing import Any, Dict, List, Optional
from sqlalchemy import select, text, func
from sqlalchemy.ext.asyncio import AsyncSession
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.messages import SystemMessage, HumanMessage

from app.core.config import settings
from app.models.jd_session_model import JDSession
from app.models.kra_kpi_model import KRAKPISession
from app.models.enrichment_model import (
    TaskAutomationScore,
    EmployeeWorkSummary,
    DepartmentDependency,
    DepartmentRollupMetric,
    BottleneckInsight,
)

logger = logging.getLogger(__name__)


def _get_enrichment_llm():
    return ChatGoogleGenerativeAI(
        google_api_key=settings.GEMINI_API_KEY,
        model="gemini-2.5-flash",
        temperature=0.1,
    )


def _clean_json_response(content: str) -> str:
    """Helper to strip markdown code blocks from LLM JSON response."""
    content = content.strip()
    if content.startswith("```"):
        lines = content.split("\n")
        if lines[0].startswith("```json") or lines[0].startswith("```"):
            content = "\n".join(lines[1:-1]).strip()
    return content


async def run_task_automation_scoring(db: AsyncSession, jd_session: JDSession) -> List[TaskAutomationScore]:
    """
    Offline Job 1: Score each task/responsibility in a Job Description for automation potential.
    """
    # Keep local copies of values to prevent lazy-loading issues after transaction commits/rollbacks
    jd_id = jd_session.id
    jd_title = jd_session.title
    jd_department = jd_session.department
    jd_employee_id = jd_session.employee_id

    try:
        jd_structured = jd_session.jd_structured or {}
        tasks = (
            jd_structured.get("key_responsibilities", [])
            or jd_structured.get("responsibilities", [])
            or jd_structured.get("tasks", [])
        )
        if not tasks:
            logger.info(f"No tasks found for JD {jd_id} ({jd_title})")
            return []

        # Format responsibilities list for the LLM
        tasks_list_str = "\n".join(f"- {t}" for t in tasks)

        prompt = f"""You are a task analysis engine for a pharmaceutical operations system.
Analyze the following list of job responsibilities for a role and evaluate each task's potential for automation.

Role Title: {jd_title}
Department: {jd_department}
Responsibilities:
{tasks_list_str}

Return a raw JSON object containing an array of scored tasks. Do not include markdown backticks or formatting.
Output Schema:
{{
  "tasks": [
    {{
      "task_text": "string (the exact task text analyzed)",
      "automation_score": float (between 0.00 and 1.00; where 1.00 is highly automatable and 0.00 is strictly manual/human-required),
      "automation_reasoning": "string (explaining why this score was assigned)",
      "suggested_tooling": ["string (software/tools that can automate or assist in this task)"],
      "category": "technical" | "administrative" | "managerial" | "strategic"
    }}
  ]
}}
"""
        llm = _get_enrichment_llm()
        response = await llm.ainvoke([
            SystemMessage(content="You are a strict JSON parser. Output only valid raw JSON. No markdown blocks."),
            HumanMessage(content=prompt)
        ])
        
        cleaned = _clean_json_response(response.content)
        parsed = json.loads(cleaned)
        if isinstance(parsed, list):
            tasks_data = parsed
        else:
            tasks_data = parsed.get("tasks", [])

        # Delete existing automation scores for this JD session to prevent duplicates
        async with db.begin_nested():
            await db.execute(
                text("DELETE FROM task_automation_scores WHERE jd_id = :jd_id"),
                {"jd_id": jd_id}
            )

        inserted_records = []
        async with db.begin_nested():
            for task_data in tasks_data:
                # Basic sanitation
                score_val = float(task_data.get("automation_score", 0.50))
                score_val = max(0.00, min(1.00, score_val))
                
                score_record = TaskAutomationScore(
                    employee_id=jd_employee_id,
                    department=jd_department or "General",
                    jd_id=jd_id,
                    task_text=task_data.get("task_text", ""),
                    automation_score=score_val,
                    automation_reasoning=task_data.get("automation_reasoning", ""),
                    suggested_tooling=task_data.get("suggested_tooling", []),
                    category=task_data.get("category", "technical")
                )
                db.add(score_record)
                inserted_records.append(score_record)

        await db.commit()
        logger.info(f"Successfully scored {len(inserted_records)} tasks for JD {jd_id}")
        return inserted_records

    except Exception as e:
        await db.rollback()
        logger.error(f"Task automation scoring failed for JD {jd_id}: {e}")
        return []


async def run_employee_summary(db: AsyncSession, employee_id: str) -> Optional[EmployeeWorkSummary]:
    """
    Offline Job 2: Generates a short per-employee summary based on JD + confirmed KRA/KPI framework.
    """
    try:
        # 1. Fetch latest approved JD session
        jd_res = await db.execute(
            select(JDSession)
            .where(JDSession.employee_id == employee_id, JDSession.status == "approved")
            .order_by(JDSession.updated_at.desc())
        )
        jd_session = jd_res.scalars().first()

        # 2. Fetch latest confirmed KRA session
        kra_res = await db.execute(
            select(KRAKPISession)
            .where(KRAKPISession.employee_id == employee_id, KRAKPISession.status == "confirmed")
            .order_by(KRAKPISession.updated_at.desc())
        )
        kra_session = kra_res.scalars().first()

        if not jd_session:
            logger.info(f"Cannot generate summary for employee {employee_id}: No approved JDSession found.")
            return None

        # Fetch employee designation from organogram
        org_res = await db.execute(
            text("SELECT employee_name, designation, department FROM organogram WHERE code = :emp_id LIMIT 1"),
            {"emp_id": employee_id}
        )
        org_row = org_res.mappings().first()
        employee_name = org_row["employee_name"] if org_row else "Unknown"
        designation = org_row["designation"] if org_row else (jd_session.title or "Employee")
        department = org_row["department"] if org_row else (jd_session.department or "General")

        # Format KRA text if available
        kras_text = "No active KRA/KPI performance framework confirmed."
        if kra_session and kra_session.kras:
            kras_list = kra_session.kras.get("kras", [])
            kras_formatted = []
            for kra in kras_list:
                kpis = ", ".join(k.get("title", "") for k in kra.get("kpis", []))
                kras_formatted.append(f"- KRA: {kra.get('title')} (Weight: {kra.get('weight')}%). KPIs: {kpis}")
            kras_text = "\n".join(kras_formatted)

        prompt = f"""You are an executive summarization engine. Synthesize the Job Description and KRA/KPI framework for this employee into a brief, professional work summary.

Employee Name: {employee_name}
Designation: {designation}
Department: {department}
Job Description:
{jd_session.jd_text}
KRA Goals:
{kras_text}

Return a raw JSON object matching the schema below. Do not include markdown formatting or backticks.
Output Schema:
{{
  "summary_text": "string (brief summary of their core function and key business impact, max 4 sentences)",
  "top_tools": ["string (list of primary tools, software, or portals they actively operate)"]
}}
"""
        llm = _get_enrichment_llm()
        response = await llm.ainvoke([
            SystemMessage(content="You are a strict JSON parser. Output only valid raw JSON. No markdown blocks."),
            HumanMessage(content=prompt)
        ])
        
        cleaned = _clean_json_response(response.content)
        parsed = json.loads(cleaned)

        async with db.begin_nested():
            # Delete old summary if exists
            await db.execute(
                text("DELETE FROM employee_work_summary WHERE employee_id = :emp_id"),
                {"emp_id": employee_id}
            )
            
            summary_record = EmployeeWorkSummary(
                employee_id=employee_id,
                department=department,
                summary_text=parsed.get("summary_text", ""),
                top_tools=parsed.get("top_tools", [])
            )
            db.add(summary_record)

        await db.commit()
        logger.info(f"Successfully generated work summary for employee {employee_id}")
        return summary_record

    except Exception as e:
        await db.rollback()
        logger.error(f"Employee summary generation failed for {employee_id}: {e}")
        return None


async def run_dependency_extraction(db: AsyncSession, jd_session: JDSession) -> List[DepartmentDependency]:
    """
    Offline Job 3: Scans task descriptions & workflows to extract cross-department dependencies.
    """
    # Keep local copies of values to prevent lazy-loading issues after transaction commits/rollbacks
    jd_id = jd_session.id
    jd_title = jd_session.title
    jd_department = jd_session.department

    try:
        jd_structured = jd_session.jd_structured or {}
        tasks = (
            jd_structured.get("key_responsibilities", [])
            or jd_structured.get("responsibilities", [])
            or jd_structured.get("tasks", [])
        )
        if not tasks:
            return []

        tasks_list_str = "\n".join(f"- {t}" for t in tasks)

        # Get workflows if any exist in the structured data
        workflows = jd_structured.get("workflows", {})
        wf_str = ""
        if workflows and isinstance(workflows, dict):
            wf_formatted = []
            for wf_name, wf_data in workflows.items():
                steps = " -> ".join(wf_data.get("steps", []))
                wf_formatted.append(f"Workflow '{wf_name}' trigger: {wf_data.get('trigger')}. Steps: {steps}")
            wf_str = "\n".join(wf_formatted)

        prompt = f"""You are a organizational dependency extraction engine. 
Analyze the job responsibilities and task workflows for this employee. Extract any explicit or implicit operational dependencies they have on other departments, teams, or external roles (e.g. coordinates with, submits reports to, requires approval from, hands off data to).

Employee Role: {jd_title}
Department: {jd_department}
Tasks & Responsibilities:
{tasks_list_str}
Workflows:
{wf_str}

Return a raw JSON object matching the schema below. Do not include markdown formatting or backticks.
Output Schema:
{{
  "dependencies": [
    {{
      "to_department": "string (name of the target department they depend on or coordinate with)",
      "dependency_type": "data_handoff" | "approval" | "coordination" | "system_access",
      "description": "string (details of the handoff or coordination)",
      "confidence": float (between 0.00 and 1.00, representing extraction certainty)"
    }}
  ]
}}
"""
        llm = _get_enrichment_llm()
        response = await llm.ainvoke([
            SystemMessage(content="You are a strict JSON parser. Output only valid raw JSON. No markdown blocks."),
            HumanMessage(content=prompt)
        ])
        
        cleaned = _clean_json_response(response.content)
        parsed = json.loads(cleaned)
        if isinstance(parsed, list):
            deps_data = parsed
        else:
            deps_data = parsed.get("dependencies", [])

        # Fetch newly stored task scores to try linking task evidence
        scores_res = await db.execute(
            select(TaskAutomationScore)
            .where(TaskAutomationScore.jd_id == jd_id)
        )
        scores = scores_res.scalars().all()

        inserted_deps = []
        async with db.begin_nested():
            # Delete existing department dependencies from this department
            await db.execute(
                text("DELETE FROM department_dependencies WHERE from_department = :dept"),
                {"dept": jd_department}
            )

            for dep_data in deps_data:
                to_dept = dep_data.get("to_department", "").strip()
                if not to_dept or to_dept.lower() == jd_department.lower():
                    continue

                # Fuzzy link to a specific task evidence if possible
                evidence_id = None
                desc = dep_data.get("description", "")
                desc_lower = desc.lower()
                for score in scores:
                    task_words = set(score.task_text.lower().split())
                    desc_words = set(desc_lower.split())
                    # If sharing significant word overlap, link it
                    if len(task_words & desc_words) > 3:
                        evidence_id = score.id
                        break

                confidence_val = float(dep_data.get("confidence", 0.70))
                confidence_val = max(0.00, min(1.00, confidence_val))

                dependency_record = DepartmentDependency(
                    from_department=jd_department,
                    to_department=to_dept,
                    dependency_type=dep_data.get("dependency_type", "coordination"),
                    description=desc,
                    evidence_task_id=evidence_id,
                    confidence=confidence_val
                )
                db.add(dependency_record)
                inserted_deps.append(dependency_record)

        await db.commit()
        logger.info(f"Successfully extracted {len(inserted_deps)} dependencies for JD {jd_id}")
        return inserted_deps

    except Exception as e:
        await db.rollback()
        logger.error(f"Dependency extraction failed for JD {jd_id}: {e}")
        return []


async def run_nightly_rollup_and_insights(db: AsyncSession) -> Dict[str, Any]:
    """
    Offline Job 4: Scheduled nightly job compiling metrics per department via SQL, 
    followed by a single LLM synthesis to extract bottleneck insights.
    """
    try:
        logger.info("Executing scheduled nightly rollup metrics...")
        
        # 1. Clear old rollups (will cascade delete bottleneck insights)
        async with db.begin_nested():
            await db.execute(text("DELETE FROM department_rollup_metrics"))
        
        # Get unique departments from organogram
        dept_res = await db.execute(text("SELECT DISTINCT department FROM organogram WHERE department IS NOT NULL AND department != ''"))
        departments = [r[0] for r in dept_res.all()]
        
        rollup_records = []
        
        # 2. Run SQL Aggregations per department
        for dept in departments:
            async with db.begin_nested():
                # Headcount
                hc_res = await db.execute(text("SELECT COUNT(*) FROM organogram WHERE department = :dept"), {"dept": dept})
                headcount = hc_res.scalar() or 0
                
                # Average automation score
                auto_res = await db.execute(
                    text("SELECT COALESCE(AVG(automation_score), 0) FROM task_automation_scores WHERE department = :dept"),
                    {"dept": dept}
                )
                avg_auto_score = float(auto_res.scalar() or 0.00)
                
                # Pct high automation tasks (suitable for automation but currently manual)
                tasks_res = await db.execute(
                    text("""
                        SELECT 
                            COUNT(*) FILTER (WHERE automation_score >= 0.70) AS high_auto,
                            COUNT(*) AS total
                        FROM task_automation_scores 
                        WHERE department = :dept
                    """),
                    {"dept": dept}
                )
                tasks_row = tasks_res.mappings().first()
                high_auto = tasks_row["high_auto"] if tasks_row else 0
                total_tasks = tasks_row["total"] if tasks_row else 0
                pct_high = float((high_auto / total_tasks * 100.0) if total_tasks > 0 else 0.00)
                
                # Stalled drafts & overdue KRA percentage
                # Definition: confirmed is completed. Stuck draft > 14 days is stalled.
                stuck_res = await db.execute(
                    text("""
                        SELECT 
                            COUNT(*) FILTER (WHERE status = 'draft' AND updated_at < NOW() - INTERVAL '14 days') AS stuck_drafts,
                            COUNT(*) FILTER (WHERE status != 'confirmed') AS not_confirmed,
                            COUNT(*) AS total_sessions
                        FROM kra_kpi_sessions ks
                        JOIN organogram o ON o.code = ks.employee_id
                        WHERE o.department = :dept
                    """),
                    {"dept": dept}
                )
                stuck_row = stuck_res.mappings().first()
                stuck_drafts = stuck_row["stuck_drafts"] if stuck_row else 0
                not_confirmed = stuck_row["not_confirmed"] if stuck_row else 0
                total_sessions = stuck_row["total_sessions"] if stuck_row else 0
                
                # Calculate overdue KRA framework % based on headcount
                overdue_pct = float((not_confirmed / headcount * 100.0) if headcount > 0 else 0.00)
                
                # Cross-department dependency count
                dep_res = await db.execute(
                    text("SELECT COUNT(*) FROM department_dependencies WHERE from_department = :dept"),
                    {"dept": dept}
                )
                dep_count = dep_res.scalar() or 0
                
                rollup = DepartmentRollupMetric(
                    department=dept,
                    avg_automation_score=avg_auto_score,
                    pct_tasks_high_automation_manual=pct_high,
                    overdue_kra_pct=overdue_pct,
                    draft_stuck_count=stuck_drafts,
                    headcount=headcount,
                    cross_dept_dependency_count=dep_count
                )
                db.add(rollup)
                rollup_records.append(rollup)

        await db.commit()
        logger.info(f"Successfully computed rollup metrics for {len(rollup_records)} departments")

        # 3. LLM synthesis call over rollup table to write bottleneck insights
        llm = _get_enrichment_llm()
        insights_generated = 0

        for rollup in rollup_records:
            prompt = f"""You are an executive operational auditor for Pulse Pharma.
Analyze these aggregated metrics for the {rollup.department} department and identify operational bottlenecks, systemic delays, or compliance risks.

Department Metrics:
- Headcount: {rollup.headcount}
- Average Task Automation Score: {rollup.avg_automation_score}
- Percentage of Manual Tasks suitable for Automation: {rollup.pct_tasks_high_automation_manual}%
- Overdue KRA Frameworks: {rollup.overdue_kra_pct}%
- KRA Sessions stuck in draft status: {rollup.draft_stuck_count}
- Active Cross-Department Dependencies: {rollup.cross_dept_dependency_count}

Return a raw JSON object containing prioritized bottleneck insights. Do not include markdown formatting or backticks.
Return only insights where there is a clear warning or critical issue based on metrics (e.g. overdue KRAs > 25%, stuck drafts > 0, high percentage of automatable manual work).
If the department is completely healthy, return an empty array.

Output Schema:
{{
  "insights": [
    {{
      "insight_text": "string (clear, direct explanation of the bottleneck, risk, or compliance deviation)",
      "severity": "critical" | "warning" | "insight",
      "evidence": {{
        "metric_key": "string (e.g. overdue_kra_pct or draft_stuck_count)",
        "value": float (the corresponding numeric value)"
      }}
    }}
  ]
}}
"""
            response = await llm.ainvoke([
                SystemMessage(content="You are a strict JSON parser. Output only valid raw JSON. No markdown blocks."),
                HumanMessage(content=prompt)
            ])

            cleaned = _clean_json_response(response.content)
            try:
                parsed = json.loads(cleaned)
                insights_data = parsed.get("insights", [])
                
                async with db.begin_nested():
                    for insight in insights_data:
                        insight_rec = BottleneckInsight(
                            department=rollup.department,
                            insight_text=insight.get("insight_text", ""),
                            severity=insight.get("severity", "insight"),
                            evidence=insight.get("evidence", {})
                        )
                        db.add(insight_rec)
                        insights_generated += 1
                await db.commit()
            except Exception as e:
                logger.error(f"Failed to parse bottleneck insights for {rollup.department}: {e}")
                continue

        logger.info(f"Nightly rollup completed. Generated {insights_generated} bottleneck insights.")
        return {"status": "ok", "departments_rolled": len(rollup_records), "insights_generated": insights_generated}

    except Exception as e:
        await db.rollback()
        logger.error(f"Nightly rollup failed: {e}")
        return {"status": "failed", "detail": str(e)}
