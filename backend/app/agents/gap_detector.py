# backend/app/agents/gap_detector.py
"""
Gap Detector Node — Evaluates data quality after each extraction.

Two modes:
  1. Rule-based (fast, no LLM call) — used by default
  2. LLM-based (deeper quality assessment) — used when quality is borderline
"""

from __future__ import annotations

import logging

from app.agents.state import AgentState
from app.agents.validators import (
    validate_insights_completeness,
    compute_quality_score,
    is_ready_for_jd,
    sanitise_skills,
)

logger = logging.getLogger(__name__)


def gap_detector_node(state: AgentState) -> dict:
    """LangGraph node: evaluate data quality and identify gaps.

    Uses rule-based checking (fast, no LLM call). Produces a gaps list
    and quality score that the router and response builder use.
    """
    insights = state.get("insights", {})

    # Run completeness checks
    checks = validate_insights_completeness(insights)
    quality = compute_quality_score(insights)
    ready = is_ready_for_jd(insights)

    # Build gaps list from failed checks
    gaps = []
    severity_map = {
        "purpose": "critical",
        "tasks": "critical",
        "priority_tasks": "critical",
        "workflows": "critical",
        "tools": "moderate",
        "skills": "moderate",
        "qualifications": "minor",
    }

    question_map = {
        "purpose": "Can you describe the main purpose and value your role brings to the organization?",
        "tasks": "What are the other tasks and responsibilities you handle regularly?",
        "priority_tasks": "Which of your tasks would you say are the most critical or time-consuming?",
        "workflows": "Can you walk me through the step-by-step process for one of your priority tasks?",
        "tools": "What software, tools, or platforms do you use regularly in your work?",
        "skills": "What technical or domain-specific skills are essential for your role?",
        "qualifications": "What education or certifications would be required for someone in your position?",
    }

    for category, result in checks.items():
        if not result["ok"]:
            gaps.append({
                "category": category,
                "severity": severity_map.get(category, "moderate"),
                "reason": result["reason"],
                "suggested_question": question_map.get(category, ""),
            })

    # Sanitise skills if present (side effect — clean on every gap check)
    if "skills" in insights and isinstance(insights["skills"], list):
        insights["skills"] = sanitise_skills(insights["skills"])

    # Compute suggested_skills for the frontend skills panel
    suggested_skills = []
    if ready:
        mem_skills = insights.get("skills", [])
        mem_tools = insights.get("tools", [])
        if isinstance(mem_skills, list) and isinstance(mem_tools, list):
            suggested_skills = sanitise_skills(list(set(mem_skills + mem_tools)))

    logger.info(
        f"[GapDetector] Quality: {quality}/100 | Gaps: {len(gaps)} | Ready: {ready}"
    )

    return {
        "gaps": gaps,
        "quality_score": quality,
        "ready_for_jd": ready,
        "insights": insights,
        "suggested_skills": suggested_skills,
    }
