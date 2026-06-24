# backend/app/agents/gap_detector.py
"""
Gap Detector Node — Evaluates data quality after each extraction.

Two modes:
  1. Rule-based (fast, no LLM call) — used by default
  2. LLM-based (deeper quality assessment) — used when quality is borderline
"""

from __future__ import annotations

import json
import logging
import re

from langchain_google_genai import ChatGoogleGenerativeAI
from app.core.config import settings
from app.core.langfuse_client import get_compiled_prompt
from app.agents.prompts import GAP_DETECTOR_PROMPT

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


def clean_rag_items(text: str, prefix_marker: str) -> list[str]:
    """Cleans RAG document texts by removing metadata prefixes and splitting elements.

    Filters out any sub-segments that contain metadata markers such as 'Role:', 'Tools:', 'Skills:', or 'Responsibilities:'.
    """
    if not text:
        return []

    content = text
    lower_text = text.lower()
    lower_marker = prefix_marker.lower()

    if lower_marker in lower_text:
        idx = lower_text.find(lower_marker)
        content = text[idx + len(prefix_marker):]

    normalized = content.replace("\n", ",").replace(";", ",").replace("- ", ",").replace("* ", ",")

    raw_splits = []
    for part in normalized.split(","):
        part_clean = part.strip()
        if not part_clean:
            continue

        part_lower = part_clean.lower()
        if any(marker in part_lower for marker in ["role:", "tools:", "skills:", "responsibilities:", "category:", "department:"]):
            continue

        part_clean = part_clean.strip('"`\'-* \t')
        if part_clean:
            raw_splits.append(part_clean)

    return raw_splits


async def synthesize_tools_and_skills_with_llm(
    role_title: str,
    department: str,
    purpose: str,
    tasks: list[str],
    workflows: dict,
    raw_rag_tools: list[str],
    raw_rag_skills: list[str],
) -> tuple[list[str], list[str]]:
    """
    Synthesize and filter highly precise, role-appropriate tools and skills using the LLM.
    Leverages raw RAG matches as suggestions, filtering out unrelated department noise.
    """
    llm = ChatGoogleGenerativeAI(
        google_api_key=settings.GEMINI_API_KEY,
        model="gemini-2.5-flash",
        temperature=0.1,
    )
    
    workflows_summary = []
    if isinstance(workflows, dict):
        for t_name, wf in workflows.items():
            wf_tools = wf.get("tools") or []
            wf_steps = wf.get("steps") or []
            workflows_summary.append(f"- Task: {t_name} | Steps: {', '.join(wf_steps)} | Tools: {wf_tools}")

    workflows_summary_str = "\n".join(workflows_summary)

    prompt = get_compiled_prompt(
        "gap-detector-prompt",
        GAP_DETECTOR_PROMPT,
        role_title=role_title,
        department=department,
        purpose=purpose,
        tasks=', '.join(tasks),
        workflows_summary_str=workflows_summary_str,
        raw_rag_tools=', '.join(raw_rag_tools),
        raw_rag_skills=', '.join(raw_rag_skills)
    )
    try:
        from app.core.langfuse_client import get_langfuse_callback_handler
        handler = get_langfuse_callback_handler(trace_name="gap-detector")
        callbacks = [handler] if handler else []
        response = await llm.ainvoke(prompt, config={"callbacks": callbacks})
        text = str(response.content).strip()
        if "```" in text:
            # Try to extract content between ```json ... ``` or ``` ... ```
            match = re.search(r"```(?:json)?\s*(.*?)\s*```", text, re.DOTALL)
            if match:
                text = match.group(1).strip()
        data = json.loads(text)
        return data.get("suggested_tools", []), data.get("suggested_skills", [])
    except Exception as e:
        logger.error(f"Failed to synthesize tools/skills via LLM: {e}")
        return [], []


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

    # Initialize suggested_tasks list
    suggested_tasks = []

    # ✅ 3. RAG Discovery (Automated Professional Suggestions)
    agent_name = state.get("current_agent", "BasicInfoAgent")
    role_title = insights.get("identity_context", {}).get("title", "")
    department = insights.get("identity_context", {}).get("department", "")

    if role_title:
        # A. Query for TASKS & RESPONSIBILITIES specifically during tasks phase
        if agent_name in ["WorkflowIdentifierAgent", "DeepDiveAgent"]:
            logger.info(
                f"[Discovery] Querying RAG for Responsibilities for Role: {role_title} in Dept: {department}"
            )
            rag_tasks_1 = await query_advanced_context(
                role_title, "responsibilities", department=department, top_k=6
            )
            rag_tasks_2 = await query_advanced_context(
                role_title, "tasks", department=department, top_k=6
            )
            for rt in rag_tasks_1 + rag_tasks_2:
                items = clean_rag_items(str(rt), "Responsibilities:")
                if not items:
                    items = clean_rag_items(str(rt), "Tasks:")
                for item in items:
                    cleaned_task = item[0].upper() + item[1:] if len(item) > 1 else item.upper()
                    if cleaned_task not in suggested_tasks and len(cleaned_task) > 10:
                        suggested_tasks.append(cleaned_task)

        # B. Query for TOOLS & SKILLS specifically during tools/skills/deepdive phases
        if agent_name in ["ToolsAgent", "SkillsAgent", "DeepDiveAgent"]:
            logger.info(
                f"[Discovery] Querying RAG for Tools/Skills for Role: {role_title} in Dept: {department}"
            )
            rag_tools = await query_advanced_context(
                role_title, "tools", department=department, top_k=8
            )
            rag_skills = await query_advanced_context(
                role_title, "skills", department=department, top_k=8
            )

            # Parse raw RAG items to pass to the LLM Synthesis
            raw_rag_tools = []
            for rt in rag_tools:
                raw_rag_tools.extend(clean_rag_items(str(rt), "Tools:"))

            raw_rag_skills = []
            for rs in rag_skills:
                raw_rag_skills.extend(clean_rag_items(str(rs), "Skills:"))

            # Call LLM synthesis for precise curating/filtering
            tasks_list = []
            if isinstance(insights.get("tasks"), list):
                for t in insights["tasks"]:
                    if isinstance(t, dict):
                        tasks_list.append(t.get("description", str(t)))
                    else:
                        tasks_list.append(str(t))

            synthesized_tools, synthesized_skills = await synthesize_tools_and_skills_with_llm(
                role_title=role_title,
                department=department,
                purpose=insights.get("purpose", ""),
                tasks=tasks_list,
                workflows=workflows,
                raw_rag_tools=raw_rag_tools,
                raw_rag_skills=raw_rag_skills,
            )

            if synthesized_tools or synthesized_skills:
                suggested_tools.extend(synthesized_tools)
                suggested_skills.extend(synthesized_skills)
            else:
                logger.info("[Discovery] LLM synthesis returned empty or failed. Falling back to rules-based parsing.")
                # Fallback to legacy rules-based parsing
                # Parse RAG tools
                for rt in rag_tools:
                    items = clean_rag_items(str(rt), "Tools:")
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

                # Parse RAG skills
                for rs in rag_skills:
                    items = clean_rag_items(str(rs), "Skills:")
                    for item in items:
                        item_lower = item.lower()
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
                        if is_skill or " " in item:
                            suggested_skills.append(item)

    # ✅ 4. FINAL STEP: Use the role-agnostic separator for clean separation
    # Combine all collected items and deduplicate
    all_items = list(set(suggested_tools + suggested_skills))

    # Use smart classification to separate them (works for any role)
    suggested_tools, suggested_skills = separate_tools_and_skills(all_items, role_title)

    logger.info(
        f"[GapDetector] Quality: {quality}/100 | Gaps: {len(gaps)} | Tasks: {len(suggested_tasks)} | Tools: {len(suggested_tools)} | Skills: {len(suggested_skills)}"
    )

    return {
        "gaps": gaps,
        "quality_score": quality,
        "ready_for_jd": ready,
        "insights": insights,
        "suggested_skills": suggested_skills,
        "suggested_tools": suggested_tools,
        "suggested_tasks": suggested_tasks,
    }
