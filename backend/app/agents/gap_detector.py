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
            gaps.append({
                "category": category,
                "severity": severity_map.get(category, "moderate"),
                "reason": result["reason"],
                "suggested_question": question_map.get(category, ""),
            })

    # Sanitise skills if present (side effect — clean on every gap check)
    if "skills" in insights and isinstance(insights["skills"], list):
        insights["skills"] = sanitise_skills(insights["skills"])

    # Compute suggested_skills and suggested_tools for the frontend panels
    suggested_skills = []
    suggested_tools = []
    
    mem_skills = insights.get("skills", [])
    mem_tools = insights.get("tools", [])
    
    # 1. Skills/Tools from memory (manual or previously detected)
    if isinstance(mem_skills, list):
        suggested_skills.extend(mem_skills)
    if isinstance(mem_tools, list):
        suggested_tools.extend(mem_tools)
        
    # 2. Extract Tools and Skills from workflows (Intelligent scanning)
    workflows = insights.get("workflows", {})
    if isinstance(workflows, dict):
        for wf in workflows.values():
            # Extract tools from workflows
            wf_tools = wf.get("tools")
            if wf_tools:
                if isinstance(wf_tools, list):
                    suggested_tools.extend(wf_tools)
                else:
                    suggested_tools.append(wf_tools)
            
            # Simple keyword extraction from steps (Basic automation)
            steps = wf.get("steps", [])
            for step in steps:
                low_step = str(step).lower()
                # Basic tech keywords (Expandable list)
                for tech in ["python", "java", "react", "next.js", "postgres", "aws", "docker", "kubernetes", "jira", "figma"]:
                    if tech in low_step:
                        suggested_tools.append(tech.capitalize())

    # 3. RAG Discovery (Automated Professional Suggestions)
    agent_name = state.get("current_agent", "BasicInfoAgent")
    role_title = insights.get("identity_context", {}).get("title", "")
    
    if agent_name in ["ToolsAgent", "SkillsAgent", "DeepDiveAgent"] and role_title:
        # Pull from similar JDs in Pulse Pharma
        logger.info(f"[Discovery] Querying RAG for Role: {role_title}")
        rag_tools = await query_advanced_context(role_title, "tools", top_k=8)
        rag_skills = await query_advanced_context(role_title, "skills", top_k=8)
        
        # Parse RAG strings (often lists or comma-separated)
        for rt in rag_tools:
            # Basic cleanup of RAG strings
            items = [i.strip() for i in str(rt).replace("Tools:", "").replace("-", ",").split(",") if i.strip()]
            suggested_tools.extend(items)
        
        for rs in rag_skills:
            items = [i.strip() for i in str(rs).replace("Skills:", "").replace("-", ",").split(",") if i.strip()]
            suggested_skills.extend(items)

    # 4. Extract from simple tasks
    tasks = insights.get("tasks", [])
    for t in tasks:
        t_str = str(t).lower()
        if "using" in t_str or "with" in t_str or "software" in t_str:
            # Simple heuristic: words after "using" or "with" (Cap at 3 words)
            pass # LLM does this better, but we leave space for pattern matching

    # Deduplicate and sanitise
    suggested_skills = sanitise_skills(list(set(suggested_skills)))
    suggested_tools = list(set([str(t).strip() for t in suggested_tools if t and len(str(t)) > 1]))

    logger.info(
        f"[GapDetector] Quality: {quality}/100 | Gaps: {len(gaps)} | Ready: {ready}"
    )

    return {
        "gaps": gaps,
        "quality_score": quality,
        "ready_for_jd": ready,
        "insights": insights,
        "suggested_skills": suggested_skills,
        "suggested_tools": suggested_tools,
    }
