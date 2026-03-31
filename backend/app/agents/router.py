# backend/app/agents/router.py
"""
Router Node — The "Brain" of the orchestrator.

Rule-based fast-path agent selection.  Evaluates the current insights and
picks the first agent whose completion criteria are NOT met.

This runs at the START of every turn to decide which agent prompt to inject.
"""

from __future__ import annotations

import logging
from app.agents.state import AgentState

logger = logging.getLogger(__name__)

# ── Agent Completion Criteria ─────────────────────────────────────────────────

AGENT_ORDER = [
    "BasicInfoAgent",
    "TaskAgent",
    "PriorityAgent",
    "WorkflowDeepDiveAgent",
    "ToolsTechAgent",
    "SkillExtractionAgent",
    "QualificationAgent",
    "JDGeneratorAgent",
]

AGENT_CRITERIA = {
    "BasicInfoAgent": lambda ins: (
        len(ins.get("purpose", "")) > 10
        and (
            bool(ins.get("basic_info", {}).get("title"))
            or bool(ins.get("identity_context", {}).get("title"))
        )
    ),
    "TaskAgent": lambda ins: len(ins.get("tasks", [])) >= 6,
    "PriorityAgent": lambda ins: len(ins.get("priority_tasks", [])) >= 3,
    "WorkflowDeepDiveAgent": lambda ins: (
        all(
            pt in ins.get("workflows", {})
            and ins["workflows"][pt].get("steps")
            for pt in ins.get("priority_tasks", [])
        )
        if ins.get("priority_tasks")
        else False
    ),
    "ToolsTechAgent": lambda ins: (
        len(ins.get("tools", [])) >= 2 or len(ins.get("technologies", [])) >= 2
    ),
    "SkillExtractionAgent": lambda ins: len(ins.get("skills", [])) >= 4,
    "QualificationAgent": lambda ins: bool(
        ins.get("qualifications", {}).get("education")
    ),
}


def compute_current_agent(insights: dict) -> str:
    """Determine which agent should be active based on data depth.

    Loops through the agent order and returns the FIRST agent whose
    criteria are NOT met.  If all are satisfied, returns JDGeneratorAgent.
    """
    for agent_name in AGENT_ORDER[:-1]:  # Exclude JDGeneratorAgent
        criteria_fn = AGENT_CRITERIA.get(agent_name)
        if criteria_fn and not criteria_fn(insights):
            return agent_name
    return "JDGeneratorAgent"


def compute_progress(insights: dict) -> dict:
    """Compute weighted progress and depth scores."""
    # Depth scores
    tasks = len(insights.get("tasks", []))
    tools = len(insights.get("tools", []))
    tech = len(insights.get("technologies", []))
    skills = len(insights.get("skills", []))

    depth_scores = {
        "tasks": min(100, int((tasks / 6) * 100)),
        "tools": min(100, (tools + tech) * 20),
        "skills": min(100, skills * 25),
    }

    # Weighted progress: Phase 1 = 70%, Phase 2 = 30%
    basic_score = 10 if AGENT_CRITERIA["BasicInfoAgent"](insights) else (
        5 if len(insights.get("purpose", "")) > 10 else 0
    )
    task_score = depth_scores["tasks"] * 0.30
    priority_score = 10 if AGENT_CRITERIA["PriorityAgent"](insights) else (
        5 if len(insights.get("priority_tasks", [])) > 0 else 0
    )
    workflow_score = 20 if AGENT_CRITERIA["WorkflowDeepDiveAgent"](insights) else 0
    tools_score = depth_scores["tools"] * 0.10
    skills_score = depth_scores["skills"] * 0.10
    qual_score = 10 if AGENT_CRITERIA["QualificationAgent"](insights) else 0

    total = basic_score + task_score + priority_score + workflow_score + tools_score + skills_score + qual_score

    current_agent = compute_current_agent(insights)

    return {
        "completion_percentage": min(total, 100),
        "depth_scores": depth_scores,
        "current_agent": current_agent,
        "status": "ready_for_generation" if current_agent == "JDGeneratorAgent" else "collecting",
    }


# ── LangGraph Node ────────────────────────────────────────────────────────────


def router_node(state: AgentState) -> dict:
    """LangGraph node: decide which agent handles this turn."""
    insights = state.get("insights", {})
    agent = compute_current_agent(insights)
    progress = compute_progress(insights)

    logger.info(f"[Router] Selected agent: {agent} | Progress: {progress['completion_percentage']:.0f}%")

    return {
        "current_agent": agent,
        "progress": progress,
        "ready_for_jd": agent == "JDGeneratorAgent",
    }
