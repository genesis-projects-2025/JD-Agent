# backend/app/agents/kra_kpi_agent.py
"""
KRA/KPI Generator Agent — Two-phase generation process:

Phase 1 — KRA Suggestion:
  Generates 6–7 KRA suggestions primarily from the employee's own JD.
  Manager JD + KRAs are REFERENCE ONLY — used to identify which employee tasks
  most impact the manager's KRAs and assign those higher suggested weights.

Phase 2 — KPI Suggestion (per selected KRA):
  For each KRA the employee selects, generates 6–7 KPI suggestions.
  Employee selects 3–5 per KRA.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any

from langchain_google_genai import ChatGoogleGenerativeAI
from app.core.config import settings

logger = logging.getLogger(__name__)


# ── LLM ──────────────────────────────────────────────────────────────────────

def _get_llm() -> ChatGoogleGenerativeAI:
    return ChatGoogleGenerativeAI(
        google_api_key=settings.GEMINI_API_KEY,
        model="gemini-2.5-pro",
        temperature=0.25,
    )


# ── Domain Strategy ───────────────────────────────────────────────────────────

def _get_domain_rules(title: str, department: str) -> str:
    t = (title + " " + department).lower()
    if any(k in t for k in ["software", "engineer", "developer", "devops", "architect", "sre", "qa", "test"]):
        return (
            "Domain: Engineering/Technology. KRAs should cover: delivery quality, system reliability, "
            "technical excellence, process improvement, and cross-functional collaboration. "
            "KPIs reference tools like: Jira, SonarQube, GitHub, Datadog, CI/CD pipelines."
        )
    if any(k in t for k in ["sales", "business development", "account", "revenue", "growth"]):
        return (
            "Domain: Sales/Business Development. KRAs should cover: pipeline management, revenue "
            "attainment, new client acquisition, account retention, and market expansion. "
            "KPIs reference tools like: Salesforce, HubSpot, CRM dashboards."
        )
    if any(k in t for k in ["hr", "talent", "recruit", "people", "learning", "training"]):
        return (
            "Domain: Human Resources. KRAs should cover: talent acquisition, employee engagement, "
            "learning & development, HR operations, and compliance. "
            "KPIs reference tools like: HRMS, Darwinbox, survey platforms."
        )
    if any(k in t for k in ["data", "analyst", "analytics", "scientist", "bi", "reporting", "insight"]):
        return (
            "Domain: Data & Analytics. KRAs should cover: data quality, dashboard adoption, "
            "analytical depth, data pipeline reliability, and stakeholder enablement. "
            "KPIs reference tools like: SQL, Power BI, Tableau, dbt, Airflow."
        )
    if any(k in t for k in ["finance", "account", "treasury", "controller", "cfo", "audit"]):
        return (
            "Domain: Finance/Accounting. KRAs should cover: financial accuracy, close cycle, "
            "budget management, compliance, and risk management. "
            "KPIs reference tools like: SAP, Oracle, ERP dashboards, Excel."
        )
    if any(k in t for k in ["product", "program", "project", "pmo", "scrum", "agile"]):
        return (
            "Domain: Product/Project Management. KRAs should cover: delivery velocity, stakeholder "
            "alignment, scope management, quality, and team effectiveness. "
            "KPIs reference tools like: Jira, Confluence, Asana, Monday.com."
        )
    if any(k in t for k in ["marketing", "brand", "content", "digital", "seo", "campaign"]):
        return (
            "Domain: Marketing. KRAs should cover: lead generation, brand visibility, campaign ROI, "
            "content quality, and channel performance. "
            "KPIs reference tools like: Google Analytics, HubSpot, SEMrush, Meta Ads."
        )
    if any(k in t for k in ["operations", "supply", "logistics", "procurement", "vendor"]):
        return (
            "Domain: Operations/Supply Chain. KRAs should cover: process efficiency, vendor management, "
            "cost optimization, delivery reliability, and compliance. "
            "KPIs reference tools like: ERP, WMS, procurement dashboards."
        )
    if any(k in t for k in ["regulatory", "compliance", "legal", "quality", "pharmacovigilance", "ra"]):
        return (
            "Domain: Regulatory/Compliance. KRAs should cover: submission timelines, audit readiness, "
            "CAPA management, regulatory intelligence, and SOPs. "
            "KPIs reference tools like: QMS, document management, regulatory trackers."
        )
    return (
        "Use industry-standard KRA domains relevant to this role. "
        "KPIs must be specific and measurable with references to actual tools."
    )


# ── Phase 1: KRA Suggestion Prompt ───────────────────────────────────────────

def _build_kra_suggestion_prompt(
    employee_title: str,
    employee_department: str,
    employee_purpose: str,
    employee_responsibilities: list[str],
    employee_priority_tasks: list[str],
    employee_workflows: dict,
    employee_skills: list[str],
    employee_tools: list[str],
    manager_title: str,
    manager_responsibilities: list[str],
    manager_kras: list[dict],
) -> str:
    domain_rules = _get_domain_rules(employee_title, employee_department)

    # Build task detail block
    task_lines = []
    for task in employee_priority_tasks[:7]:
        wf = employee_workflows.get(task, {})
        output = wf.get("output", "")
        tools_wf = ", ".join(wf.get("tools", [])[:3]) if wf.get("tools") else ""
        line = f"  • {task}"
        if output:
            line += f" → Deliverable: {output}"
        if tools_wf:
            line += f" (Tools: {tools_wf})"
        task_lines.append(line)
    tasks_block = "\n".join(task_lines) if task_lines else "  (Priority tasks not specified)"

    resp_block = "; ".join(employee_responsibilities[:8]) if employee_responsibilities else "N/A"
    tools_str = ", ".join(employee_tools[:10]) if employee_tools else "N/A"
    skills_str = ", ".join(employee_skills[:8]) if employee_skills else "N/A"

    # Manager KRAs as reference
    mgr_kra_lines = []
    for k in manager_kras[:5]:
        title = k.get("title", "")
        if title:
            mgr_kra_lines.append(f"  • {title}")
    mgr_kras_block = "\n".join(mgr_kra_lines) if mgr_kra_lines else "  (Not available)"
    mgr_resp_block = "; ".join(manager_responsibilities[:5]) if manager_responsibilities else "N/A"

    return f"""You are a Senior HR Performance Management Expert.
Your task: Suggest exactly 10 Key Result Areas (KRAs) for the employee described below.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EMPLOYEE PROFILE (PRIMARY SOURCE — base KRAs on this)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Title: {employee_title}
Department: {employee_department}
Role Purpose: {employee_purpose}
Key Responsibilities: {resp_block}

Priority Tasks (with deliverables):
{tasks_block}

Skills: {skills_str}
Tools: {tools_str}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MANAGER CONTEXT (REFERENCE ONLY — for alignment)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Manager Title: {manager_title}
Manager Responsibilities: {mgr_resp_block}

Manager's KRAs (use to identify which employee tasks most directly support the manager's goals):
{mgr_kras_block}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DOMAIN CONTEXT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{domain_rules}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RULES (STRICT — violations break the system)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. Generate EXACTLY 10 KRAs. No more, no less.
2. Each KRA must be distinct.
3. KRAs must align with the employee's actual responsibilities and tasks.
4. Do NOT include weights — the employee will assign weights manually after selection.
5. KRA titles MUST be phrased as achievable outcomes or results rather than simple category headings (e.g. use "Improved system performance" instead of "Quality Assurance", and "Enhanced customer satisfaction" instead of "Customer Service"). They should directly describe what is achieved.
6. The description field MUST be returned as an empty string ("").
7. The source_tasks field MUST be returned as an empty array ([]).
8. The manager_impact field MUST be returned as an empty string ("").
9. DO NOT generate KPIs in this step — only KRA suggestions.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OUTPUT — RETURN ONLY THIS JSON (no markdown, no extra text)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{{
  "kra_suggestions": [
    {{
      "kra_id": "kra_001",
      "title": "Achievable Outcome Title",
      "description": "",
      "source_tasks": [],
      "manager_impact": ""
    }}
  ]
}}"""


# ── Phase 2: KPI Suggestion Prompt (per KRA) ─────────────────────────────────

def _build_kpi_suggestion_prompt(
    kra_title: str,
    kra_description: str,
    source_tasks: list[str],
    employee_title: str,
    employee_department: str,
    employee_tools: list[str],
    employee_workflows: dict,
) -> str:
    domain_rules = _get_domain_rules(employee_title, employee_department)
    tools_str = ", ".join(employee_tools[:10]) if employee_tools else "N/A"

    # Pull workflow details for source tasks
    task_detail_lines = []
    for task in source_tasks[:3]:
        wf = employee_workflows.get(task, {})
        steps = "; ".join(wf.get("steps", [])[:3]) if wf.get("steps") else ""
        output = wf.get("output", "")
        wf_tools = ", ".join(wf.get("tools", [])[:3]) if wf.get("tools") else ""
        line = f"  • {task}"
        if steps:
            line += f"\n    Steps: {steps}"
        if output:
            line += f"\n    Deliverable: {output}"
        if wf_tools:
            line += f"\n    Tools: {wf_tools}"
        task_detail_lines.append(line)
    tasks_block = "\n".join(task_detail_lines) if task_detail_lines else "  (See source tasks)"

    return f"""You are a Senior HR Performance Management Expert.
Generate 6 to 7 KPI suggestions for a specific KRA.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
KRA TO MEASURE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
KRA Title: {kra_title}
KRA Description: {kra_description}
Source Tasks:
{tasks_block}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EMPLOYEE CONTEXT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Role: {employee_title} | Department: {employee_department}
Tools Available: {tools_str}

Domain: {domain_rules}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. Generate EXACTLY 6 to 7 KPIs. Each must measure a different dimension of the KRA.
2. Every target must be a SPECIFIC number, percentage, or time-bound value. NO vague targets.
3. measurement_method must reference an ACTUAL tool from the tools list above where possible.
4. frequency: "Monthly" for operational, "Quarterly" for strategic.
5. Include 3-tier thresholds (excellent / meets_expectation / below_expectation) — specific values only.
6. Each KPI must measure something DIFFERENT — no redundancy.
7. NO soft skill KPIs (no "communication", "collaboration", etc.)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OUTPUT — RETURN ONLY THIS JSON (no markdown, no extra text)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{{
  "kra_id": "{kra_title.lower().replace(' ', '_')}",
  "kra_title": "{kra_title}",
  "kpi_suggestions": [
    {{
      "kpi_id": "kpi_001",
      "metric": "Short metric name (3–6 words)",
      "description": "What exactly is being measured.",
      "target": "Specific measurable target (e.g., ≥ 95% on-time, ≤ 3 days TAT)",
      "measurement_method": "Tool or report used to measure",
      "frequency": "Monthly",
      "threshold": {{
        "excellent": "Specific value",
        "meets_expectation": "Specific value or range",
        "below_expectation": "Specific value"
      }}
    }}
  ]
}}"""


# ── JSON Parser Helper ────────────────────────────────────────────────────────

def _parse_llm_json(raw: str) -> dict:
    raw = raw.strip()
    if "```" in raw:
        match = re.search(r"```(?:json)?\s*(.*?)\s*```", raw, re.DOTALL)
        if match:
            raw = match.group(1).strip()
    return json.loads(raw)


# ── Weight Normalizer ─────────────────────────────────────────────────────────

def _normalize_weights(items: list[dict], weight_key: str = "suggested_weight") -> list[dict]:
    """Ensure weights sum to exactly 100."""
    total = sum(k.get(weight_key, 0) for k in items)
    if total == 0:
        per = round(100 / len(items))
        for k in items:
            k[weight_key] = per
        items[-1][weight_key] += 100 - sum(k[weight_key] for k in items)
    elif total != 100:
        factor = 100 / total
        running = 0
        for k in items[:-1]:
            k[weight_key] = round(k.get(weight_key, 0) * factor)
            running += k[weight_key]
        items[-1][weight_key] = 100 - running
    return items


# ── Phase 1: Generate KRA Suggestions ────────────────────────────────────────

async def generate_kra_suggestions(
    employee_data: dict[str, Any],
    manager_jd_data: dict[str, Any],
    manager_kras_data: list[dict],
) -> dict:
    """
    Phase 1: Generate 6–7 KRA suggestions.

    Employee JD is the primary source.
    Manager JD + KRAs are reference context for weight calibration.

    Returns:
        {"kra_suggestions": [...], "total_suggested_weight": 100}
    """
    prompt = _build_kra_suggestion_prompt(
        employee_title=employee_data.get("title", ""),
        employee_department=employee_data.get("department", ""),
        employee_purpose=employee_data.get("purpose", ""),
        employee_responsibilities=employee_data.get("responsibilities", []),
        employee_priority_tasks=employee_data.get("priority_tasks", []),
        employee_workflows=employee_data.get("workflows", {}),
        employee_skills=employee_data.get("skills", []),
        employee_tools=employee_data.get("tools", []),
        manager_title=manager_jd_data.get("title", ""),
        manager_responsibilities=manager_jd_data.get("responsibilities", []),
        manager_kras=manager_kras_data,
    )

    llm = _get_llm()
    logger.info(f"[KRAKPIAgent] Phase 1: Generating KRA suggestions for {employee_data.get('title')}")

    response = await llm.ainvoke(prompt)
    payload = _parse_llm_json(str(response.content))

    suggestions = payload.get("kra_suggestions", [])
    if not suggestions:
        raise ValueError("LLM returned no KRA suggestions")

    # Ensure IDs and cap at 10, strip any weight the LLM may have hallucinated
    suggestions = suggestions[:10]
    for i, kra in enumerate(suggestions):
        if not kra.get("kra_id"):
            kra["kra_id"] = f"kra_{i+1:03d}"
        # Ensure description, source_tasks and manager_impact are empty/null to remove reference KRAs
        kra["description"] = ""
        kra["source_tasks"] = []
        kra["manager_impact"] = ""
        # Remove any weight fields — weights are set by the employee, not the agent
        kra.pop("suggested_weight", None)
        kra.pop("weight", None)

    payload["kra_suggestions"] = suggestions

    logger.info(f"[KRAKPIAgent] Phase 1 complete: {len(suggestions)} KRAs suggested")
    return payload


# ── Phase 2: Generate KPI Suggestions (per KRA) ──────────────────────────────

async def generate_kpi_suggestions_for_kra(
    kra: dict,
    employee_data: dict[str, Any],
) -> dict:
    """
    Phase 2: Generate 6–7 KPI suggestions for a single selected KRA.

    Args:
        kra: The selected KRA dict (must have kra_id, title, description, source_tasks)
        employee_data: Employee context dict

    Returns:
        {"kra_id": ..., "kra_title": ..., "kpi_suggestions": [...]}
    """
    prompt = _build_kpi_suggestion_prompt(
        kra_title=kra.get("title", ""),
        kra_description=kra.get("description", ""),
        source_tasks=kra.get("source_tasks", []),
        employee_title=employee_data.get("title", ""),
        employee_department=employee_data.get("department", ""),
        employee_tools=employee_data.get("tools", []),
        employee_workflows=employee_data.get("workflows", {}),
    )

    llm = _get_llm()
    logger.info(f"[KRAKPIAgent] Phase 2: Generating KPI suggestions for KRA: {kra.get('title')}")

    response = await llm.ainvoke(prompt)
    payload = _parse_llm_json(str(response.content))

    suggestions = payload.get("kpi_suggestions", [])
    if not suggestions:
        raise ValueError(f"LLM returned no KPI suggestions for KRA: {kra.get('title')}")

    # Ensure IDs and cap at 7
    suggestions = suggestions[:7]
    kra_prefix = kra.get("kra_id", "kra_001")
    for i, kpi in enumerate(suggestions):
        kpi["kpi_id"] = f"{kra_prefix}_kpi_{i+1:02d}"
        if not kpi.get("threshold"):
            kpi["threshold"] = {
                "excellent": "Exceeds target",
                "meets_expectation": "Meets target",
                "below_expectation": "Below target",
            }

    payload["kpi_suggestions"] = suggestions
    payload["kra_id"] = kra.get("kra_id")
    payload["kra_title"] = kra.get("title")

    logger.info(f"[KRAKPIAgent] Phase 2 complete: {len(suggestions)} KPIs for '{kra.get('title')}'")
    return payload
