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
    "DeepDiveAgent",
    "ToolsSkillsAgent",
    "JDGeneratorAgent",
]

AGENT_CRITERIA = {
    "BasicInfoAgent": lambda ins: (
        len(ins.get("purpose", "")) >= 15
    ),
    "TaskAgent": lambda ins: len(ins.get("tasks", [])) >= 6,
    "PriorityAgent": lambda ins: len(ins.get("priority_tasks", [])) >= 3,
    "DeepDiveAgent": lambda ins: (
        all(
            pt in ins.get("workflows", {})
            and ins["workflows"][pt].get("steps")
            for pt in ins.get("priority_tasks", [])
        )
        if ins.get("priority_tasks")
        else False
    ),
    "ToolsSkillsAgent": lambda ins: (
        len(ins.get("tools", [])) >= 2 
        and len(ins.get("skills", [])) >= 3
    ),
}

# ── Transition Messages ──────────────────────────────────────────────────────

TRANSITION_MESSAGES = {
    ("BasicInfoAgent", "TaskAgent"): "That gives me a great picture of your role's purpose.",
    ("TaskAgent", "PriorityAgent"): "Excellent — we've captured a solid list of your responsibilities.",
    ("PriorityAgent", "DeepDiveAgent"): "Great priorities identified.",
    ("DeepDiveAgent", "ToolsSkillsAgent"): "Those workflows are very detailed and helpful.",
    ("ToolsSkillsAgent", "JDGeneratorAgent"): "We now have a comprehensive picture of your role.",
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


def get_transition_message(from_agent: str, to_agent: str) -> str:
    """Get a smooth transition message when switching agents."""
    return TRANSITION_MESSAGES.get((from_agent, to_agent), "")


def compute_progress(insights: dict) -> dict:
    """Compute weighted progress and depth scores for 6 agents.
    
    Weights:
      BasicInfo: 10%, Tasks: 35%, Priority: 10%, DeepDive: 20%, ToolsSkills: 15%, JDReady: 10%
    """
    tasks = len(insights.get("tasks", []))
    tools = len(insights.get("tools", []))
    tech = len(insights.get("technologies", []))
    skills = len(insights.get("skills", []))
    priorities = len(insights.get("priority_tasks", []))
    workflows = insights.get("workflows", {})

    depth_scores = {
        "basic_info": 100 if AGENT_CRITERIA["BasicInfoAgent"](insights) else min(100, int(len(insights.get("purpose", "")) / 15 * 100)),
        "tasks": min(100, int((tasks / 6) * 100)),
        "priorities": min(100, int((priorities / 3) * 100)),
        "workflows": min(100, int((len(workflows) / max(priorities, 1)) * 100)) if priorities > 0 else 0,
        "tools_skills": min(100, int(((tools + tech + skills) / 7) * 100)),
    }

    # Weighted percentage
    basic_score = 10 if AGENT_CRITERIA["BasicInfoAgent"](insights) else (
        5 if len(insights.get("purpose", "")) > 5 else 0
    )
    task_score = depth_scores["tasks"] * 0.35
    priority_score = 10 if AGENT_CRITERIA["PriorityAgent"](insights) else (
        5 if priorities > 0 else 0
    )

    # DeepDive: partial credit for each completed workflow
    if priorities > 0:
        workflows_done = sum(
            1 for pt in insights.get("priority_tasks", [])
            if pt in workflows and workflows[pt].get("steps")
        )
        workflow_score = (workflows_done / priorities) * 20
    else:
        workflow_score = 0

    tools_skills_score = depth_scores["tools_skills"] * 0.15

    total = basic_score + task_score + priority_score + workflow_score + tools_skills_score
    current_agent = compute_current_agent(insights)

    return {
        "completion_percentage": min(round(total, 1), 100),
        "depth_scores": depth_scores,
        "current_agent": current_agent,
        "status": "ready_for_generation" if current_agent == "JDGeneratorAgent" else "collecting",
    }


# ── LangGraph Node ────────────────────────────────────────────────────────────


def router_node(state: AgentState) -> dict:
    """LangGraph node: decide which agent handles this turn."""
    insights = state.get("insights", {})
    previous_agent = state.get("current_agent", "BasicInfoAgent")
    agent = compute_current_agent(insights)
    progress = compute_progress(insights)

    # Detect agent transition
    if agent != previous_agent:
        logger.info(f"[Router] TRANSITION: {previous_agent} → {agent}")

    logger.info(f"[Router] Selected agent: {agent} | Progress: {progress['completion_percentage']:.0f}%")

    return {
        "current_agent": agent,
        "previous_agent": previous_agent,
        "progress": progress,
        "ready_for_jd": agent == "JDGeneratorAgent",
    }
