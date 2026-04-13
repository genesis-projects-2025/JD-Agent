# backend/app/agents/tools.py
"""
LLM Tool Definitions — Pydantic-typed functions that Gemini can call.

These tools are bound to the interview LLM via `llm.bind_tools(INTERVIEW_TOOLS)`.
When the LLM recognizes extractable data in a user's message, it calls the
appropriate tool. The tool functions themselves are lightweight — the real state
merging happens in the graph's process_tool_calls node.

Tool call flow:
  1. LLM detects data in user message → calls save_tasks(tasks=[...])
  2. LangGraph captures the tool_calls from the AIMessage
  3. process_tool_calls node reads args and merges into state.insights
"""

from __future__ import annotations

from langchain_core.tools import tool
from typing import List, Optional


@tool
def save_basic_info(
    purpose: str,
    title: str = "",
    department: str = "",
    location: str = "",
    reports_to: str = "",
) -> str:
    """Save the foundational role information.

    Call this when you understand the role's purpose and basic organisational context.
    The 'purpose' field should be at least 2 sentences describing the role's value.

    Args:
        purpose: What value this role adds to the organisation (≥2 sentences)
        title: Job title or designation (skip if already known from context)
        department: Department or function (skip if already known)
        location: Work location (skip if already known)
        reports_to: Reporting manager (skip if already known)
    """
    return "Basic info saved successfully."


@tool
def save_tasks(
    tasks: List[dict],
) -> str:
    """Save detailed task descriptions extracted from the conversation.

    Call this after the user describes their work activities. Each task MUST have
    a detailed description (not just a label like 'writing code').

    Args:
        tasks: List of task objects. Each should have:
               - description (str): Detailed task description (≥10 words)
               - frequency (str): daily | weekly | monthly | quarterly | ad-hoc
               - category (str): technical | administrative | managerial | strategic
    """
    return f"Saved {len(tasks)} tasks successfully."


@tool
def save_priority_tasks(
    priorities: List[str],
) -> str:
    """Save the employee's top 3-5 most critical or time-consuming tasks.

    Call this after they rank their tasks by importance or time spent.

    Args:
        priorities: List of task names/descriptions ranked by importance.
    """
    return f"Saved {len(priorities)} priority tasks."


@tool
def save_workflow(
    task_name: str,
    trigger: str,
    steps: List[str],
    tools_used: List[str],
    problem_solving: str,
    output: str,
    frequency: str = "",
) -> str:
    """Save a detailed workflow for one priority task.

    Call this after getting the complete step-by-step process for a task.
    Complete one workflow at a time before moving to the next priority task.

    Args:
        task_name: Which priority task this workflow describes
        trigger: What initiates or starts this workflow
        steps: Ordered steps from start to finish (minimum 2)
        tools_used: Tools or software used during this workflow
        problem_solving: How problems or common challenges are handled for this task
        output: The final deliverable or outcome
        frequency: How often this workflow runs (daily/weekly/monthly)
    """
    return f"Workflow saved for: {task_name}"


@tool
def save_tools_tech(
    tools: List[str],
    technologies: List[str],
) -> str:
    """Save tools (software/hardware) and technologies (frameworks/platforms/languages).

    Call this when you have a comprehensive inventory of the employee's tech stack.

    Args:
        tools: Software, hardware, platforms (e.g., Jira, Slack, VS Code)
        technologies: Frameworks, languages, cloud services (e.g., Python, AWS, React)
    """
    return f"Saved {len(tools)} tools and {len(technologies)} technologies."


@tool
def save_skills(
    skills: List[str],
) -> str:
    """Save technical and domain-specific skills.

    CRITICAL: Only save HARD/TECHNICAL skills. Never save soft skills like
    'communication', 'teamwork', 'leadership', 'problem-solving'.

    Args:
        skills: List of technical/domain skills (e.g., REST API Design, SQL, Docker)
    """
    return f"Saved {len(skills)} skills."


@tool
def save_qualifications(
    education: List[str],
    certifications: List[str] = [],
    experience_years: Optional[str] = None,
) -> str:
    """Save education requirements and professional certifications.

    Args:
        education: Required degrees or diplomas (e.g., B.Tech Computer Science)
        certifications: Professional certifications (e.g., AWS Solutions Architect)
        experience_years: Years of experience required (e.g., "3-5 years")
    """
    return "Qualifications saved."


# ── Tool Registry ─────────────────────────────────────────────────────────────

INTERVIEW_TOOLS = [
    save_basic_info,
    save_tasks,
    save_priority_tasks,
    save_workflow,
    save_tools_tech,
    save_skills,
    save_qualifications,
]


def merge_tool_call_into_insights(tool_name: str, tool_args: dict, insights: dict) -> dict:
    """Merge data from a single tool call into the insights dict.

    This is called by the graph's process_tool_calls node. It handles
    deduplication and proper merging for each tool type.
    """
    from app.agents.validators import sanitise_skills

    if tool_name == "save_basic_info":
        if tool_args.get("purpose"):
            insights["purpose"] = tool_args["purpose"]
        basic = insights.get("basic_info", {})
        for key in ("title", "department", "location", "reports_to"):
            if tool_args.get(key):
                basic[key] = tool_args[key]
        insights["basic_info"] = basic

    elif tool_name == "save_tasks":
        existing = insights.get("tasks", [])
        new_tasks = tool_args.get("tasks", [])
        existing_descs = {
            (t["description"].lower() if isinstance(t, dict) else t.lower())
            for t in existing
        }
        for task in new_tasks:
            desc = task.get("description", "") if isinstance(task, dict) else str(task)
            if desc.lower() not in existing_descs:
                existing.append(task if isinstance(task, dict) else {"description": desc, "frequency": "daily", "category": "technical"})
                existing_descs.add(desc.lower())
        insights["tasks"] = existing

    elif tool_name == "save_priority_tasks":
        existing = set(insights.get("priority_tasks", []))
        for p in tool_args.get("priorities", []):
            existing.add(p)
        insights["priority_tasks"] = list(existing)

    elif tool_name == "save_workflow":
        workflows = insights.get("workflows") or {}
        task_name = tool_args.get("task_name", "")
        if task_name:
            wf = workflows.get(task_name, {})
            # merge fields
            wf["trigger"] = tool_args.get("trigger", "") or wf.get("trigger", "")
            wf["steps"] = tool_args.get("steps", []) or wf.get("steps", [])
            wf["tools"] = tool_args.get("tools_used", []) or wf.get("tools", [])
            wf["problem_solving"] = tool_args.get("problem_solving", "") or wf.get("problem_solving", "")
            wf["output"] = tool_args.get("output", "") or wf.get("output", "")
            wf["frequency"] = tool_args.get("frequency", "") or wf.get("frequency", "")
            workflows[task_name] = wf
            # Track visited tasks for iterative workflow
            visited = insights.get("visited_tasks", [])
            if task_name not in visited:
                visited.append(task_name)
                insights["visited_tasks"] = visited
            
            # SYNC: Also add these tools to the global master list for real-time progress tracking!
            global_tools = set(insights.get("tools", []))
            for t in tool_args.get("tools_used", []):
                if t:
                    global_tools.add(t)
            insights["tools"] = list(global_tools)
        insights["workflows"] = workflows

    elif tool_name == "save_tools_tech":
        existing_tools = set(insights.get("tools", []))
        existing_tech = set(insights.get("technologies", []))
        for t in tool_args.get("tools", []):
            existing_tools.add(t)
        for t in tool_args.get("technologies", []):
            existing_tech.add(t)
        insights["tools"] = list(existing_tools)
        insights["technologies"] = list(existing_tech)

    elif tool_name == "save_skills":
        existing = set(insights.get("skills", []))
        new_skills = sanitise_skills(tool_args.get("skills", []))
        for s in new_skills:
            existing.add(s)
        insights["skills"] = list(existing)

    elif tool_name == "save_qualifications":
        quals = insights.get("qualifications", {})
        if tool_args.get("education"):
            existing_edu = set(quals.get("education", []))
            for e in tool_args["education"]:
                existing_edu.add(e)
            quals["education"] = list(existing_edu)
        if tool_args.get("certifications"):
            existing_cert = set(quals.get("certifications", []))
            for c in tool_args["certifications"]:
                existing_cert.add(c)
            quals["certifications"] = list(existing_cert)
        if tool_args.get("experience_years"):
            quals["experience_years"] = tool_args["experience_years"]
        insights["qualifications"] = quals

    return insights
