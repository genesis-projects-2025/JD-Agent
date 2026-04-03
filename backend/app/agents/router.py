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
    "TaskAgent": lambda ins: len(ins.get("tasks", [])) >= 4,
    "PriorityAgent": lambda ins: len(ins.get("priority_tasks", [])) >= 3,
    "DeepDiveAgent": lambda ins: (
        all(
            pt in ins.get("workflows", {})
            and ins["workflows"][pt].get("steps")
            and ins["workflows"][pt].get("tools")
            and ins["workflows"][pt].get("problem_solving")
            for pt in ins.get("priority_tasks", [])
        )
        if ins.get("priority_tasks")
        else False
    ),
    "ToolsSkillsAgent": lambda ins: (
        len(ins.get("tools", [])) >= 2 
        and len(ins.get("skills", [])) >= 3
        and (
            ins.get("qualifications", {}).get("education") or 
            ins.get("qualifications", {}).get("experience_years")
        )
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


def compute_current_agent(insights: dict, current_agent: str = "BasicInfoAgent") -> str:
    """Determine which agent should be active based on data depth.

    ENFORCES A LINEAR FLOW: Finds the index of the `current_agent` in `AGENT_ORDER`
    and only checks criteria for agents at or after that index.
    """
    # Find the starting index (default to 0 if not found)
    try:
        start_idx = AGENT_ORDER.index(current_agent)
    except ValueError:
        start_idx = 0

    # Only check agents from current_agent onwards
    for agent_name in AGENT_ORDER[start_idx:-1]:  # Exclude JDGeneratorAgent
        criteria_fn = AGENT_CRITERIA.get(agent_name)
        if criteria_fn and not criteria_fn(insights):
            return agent_name
            
    # Once we move past an agent, we never go back
    return max(current_agent, "JDGeneratorAgent", key=lambda x: AGENT_ORDER.index(x) if x in AGENT_ORDER else -1)


def get_transition_message(from_agent: str, to_agent: str) -> str:
    """Get a smooth transition message when switching agents."""
    return TRANSITION_MESSAGES.get((from_agent, to_agent), "")


def compute_progress(insights: dict, current_agent: str = "BasicInfoAgent") -> dict:
    """Compute weighted progress and depth scores for 6 agents.
    
    Weights:
      BasicInfo: 10%, Tasks: 20%, Priority: 10%, DeepDive: 30%, ToolsSkills: 20%, JDReady: 10%
    """
    try:
        current_idx = AGENT_ORDER.index(current_agent)
    except ValueError:
        current_idx = 0

    # Progressive percentage floor based on phase index
    # (Phase 1: 0%, Phase 2: 10%, Phase 3: 30%, Phase 4: 40%, Phase 5: 70%, Phase 6: 90%)
    phase_floors = [0, 10, 30, 40, 70, 90]
    progress_floor = phase_floors[current_idx] if current_idx < len(phase_floors) else 90

    tasks_count = len(insights.get("tasks", []))
    tools_count = len(insights.get("tools", []))
    tech_count = len(insights.get("technologies", []))
    skills_count = len(insights.get("skills", []))
    priorities_count = len(insights.get("priority_tasks", []))
    workflows = insights.get("workflows", {})

    depth_scores = {
        "basic_info": 100 if AGENT_CRITERIA["BasicInfoAgent"](insights) else min(100, int(len(insights.get("purpose", "")) / 15 * 100)),
        "tasks": min(100, int((tasks_count / 4) * 100)),
        "priorities": min(100, int((priorities_count / 3) * 100)),
        "workflows": min(100, int((len(workflows) / max(priorities_count, 1)) * 100)) if priorities_count > 0 else 0,
        "tools_skills": min(100, int(((tools_count + tech_count + skills_count) / 7) * 100)),
    }

    # Weighting logic (more granular)
    basic_score = 10 if AGENT_CRITERIA["BasicInfoAgent"](insights) else min(10, depth_scores["basic_info"] * 0.1)
    task_score = min(20, depth_scores["tasks"] * 0.20)
    priority_score = 10 if AGENT_CRITERIA["PriorityAgent"](insights) else min(10, depth_scores["priorities"] * 0.1)

    # DeepDive: gradual credit for workflows
    if priorities_count > 0:
        workflows_done = sum(
            1 for pt in insights.get("priority_tasks", [])
            if pt in workflows and (workflows[pt].get("steps") or workflows[pt].get("steps_count", 0) > 0)
        )
        workflow_score = (workflows_done / 3) * 30 # Goal is 3 workflows
    else:
        workflow_score = 0

    tools_skills_score = min(20, depth_scores["tools_skills"] * 0.20)

    total = basic_score + task_score + priority_score + workflow_score + tools_skills_score
    
    # Ensure progress is at least the floor for the current phase, and never exceeds 100
    final_percentage = max(progress_floor, min(round(total, 1), 100))
    
    # Final check: JDGeneratorAgent means we are at 100 or close
    if current_agent == "JDGeneratorAgent":
        final_percentage = 100.0

    return {
        "completion_percentage": final_percentage,
        "depth_scores": depth_scores,
        "current_agent": current_agent,
        "status": "ready_for_generation" if current_agent == "JDGeneratorAgent" else "collecting",
    }


# ── LangGraph Node ────────────────────────────────────────────────────────────


def router_node(state: AgentState) -> dict:
    """LangGraph node: decide which agent handles this turn."""
    insights = state.get("insights", {})
    previous_agent = state.get("current_agent", "BasicInfoAgent")
    agent = compute_current_agent(insights, previous_agent)
    progress = compute_progress(insights, agent)

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
