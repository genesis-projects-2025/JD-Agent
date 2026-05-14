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
    separate_tools_and_skills,  # ✅ ADD THIS IMPORT
)
from app.services.vector_service import query_advanced_context

logger = logging.getLogger(__name__)


async def gap_detector_node(state: AgentState) -> dict:
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
            gaps.append(
                {
                    "category": category,
                    "severity": severity_map.get(category, "moderate"),
                    "reason": result["reason"],
                    "suggested_question": question_map.get(category, ""),
                }
            )

    # Sanitise skills if present (side effect — clean on every gap check)
    if "skills" in insights and isinstance(insights["skills"], list):
        insights["skills"] = sanitise_skills(insights["skills"])

    # Compute suggested_skills and suggested_tools for the frontend panels
    suggested_skills = []
    suggested_tools = []

    mem_skills = insights.get("skills") or []
    mem_tools = insights.get("tools") or []

    # ✅ 1. Skills/Tools from memory (manual or previously detected)
    if isinstance(mem_skills, list):
        suggested_skills.extend(mem_skills)
    if isinstance(mem_tools, list):
        suggested_tools.extend(mem_tools)

    # ✅ 2. Extract Tools and Skills from workflows (Intelligent scanning)
    workflows = insights.get("workflows") or {}
    if isinstance(workflows, dict):
        for task_name, wf in workflows.items():
            # Extract TOOLS from workflows only (not skills)
            wf_tools = wf.get("tools")
            if wf_tools:
                if isinstance(wf_tools, list):
                    # Filter out competency-sounding items (skills masquerading as tools)
                    for t in wf_tools:
                        tool_str = str(t).lower().strip()
                        # Only add if it looks like actual software/platform
                        if not any(
                            skill_marker in tool_str
                            for skill_marker in [
                                "development",
                                "design",
                                "architecture",
                                "management",
                                "analysis",
                                "implementation",
                                "optimization",
                            ]
                        ):
                            suggested_tools.append(t)
                else:
                    suggested_tools.append(wf_tools)

    # ✅ 3. RAG Discovery (Automated Professional Suggestions)
    agent_name = state.get("current_agent", "BasicInfoAgent")
    role_title = insights.get("identity_context", {}).get("title", "")
    department = insights.get("identity_context", {}).get("department", "")

    if agent_name in ["ToolsAgent", "SkillsAgent", "DeepDiveAgent"] and role_title:
        logger.info(
            f"[Discovery] Querying RAG for Role: {role_title} in Dept: {department}"
        )

        # Query for TOOLS specifically (software, platforms, services)
        rag_tools = await query_advanced_context(
            role_title, "tools", department=department, top_k=8
        )

        # Query for SKILLS specifically (competencies, expertise areas)
        rag_skills = await query_advanced_context(
            role_title, "skills", department=department, top_k=8
        )

        # Parse RAG tools (often lists or comma-separated)
        for rt in rag_tools:
            items = [
                i.strip()
                for i in str(rt).replace("Tools:", "").replace("-", ",").split(",")
                if i.strip()
            ]
            # Filter out skill-like items
            for item in items:
                if not any(
                    skill_marker in item.lower()
                    for skill_marker in [
                        "development",
                        "design",
                        "architecture",
                        "management",
                    ]
                ):
                    suggested_tools.append(item)

        # Parse RAG skills (expertise areas, competencies)
        for rs in rag_skills:
            items = [
                i.strip()
                for i in str(rs).replace("Skills:", "").replace("-", ",").split(",")
                if i.strip()
            ]
            # Only add if it sounds like a competency (contains development, design, management, etc)
            for item in items:
                item_lower = item.lower()
                # Check for skill indicators
                is_skill = any(
                    marker in item_lower
                    for marker in [
                        "development",
                        "design",
                        "architecture",
                        "management",
                        "analysis",
                        "implementation",
                        "optimization",
                        "engineering",
                    ]
                )
                if is_skill or " " in item:  # Multi-word items are usually skills
                    suggested_skills.append(item)

    # ✅ 4. FINAL STEP: Use the role-agnostic separator for clean separation
    # This ensures ALL employees (Software, Sales, Finance, HR, Operations, etc.)
    # have tools and skills properly separated using universal indicators

    # Combine all collected items and deduplicate
    all_items = list(set(suggested_tools + suggested_skills))

    # Use smart classification to separate them (works for any role)
    suggested_tools, suggested_skills = separate_tools_and_skills(all_items, role_title)

    logger.info(
        f"[GapDetector] Quality: {quality}/100 | Gaps: {len(gaps)} | Tools: {len(suggested_tools)} | Skills: {len(suggested_skills)}"
    )

    return {
        "gaps": gaps,
        "quality_score": quality,
        "ready_for_jd": ready,
        "insights": insights,
        "suggested_skills": suggested_skills,
        "suggested_tools": suggested_tools,
    }
