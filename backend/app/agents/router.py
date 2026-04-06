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
    "WorkflowIdentifierAgent",
    "DeepDiveAgent",
    "ToolsAgent",
    "SkillsAgent",
    "QualificationAgent",
    "JDGeneratorAgent",
]

AGENT_CRITERIA = {
    "BasicInfoAgent": lambda ins: (
        len(ins.get("purpose", "")) >= 20 and len(ins.get("tasks", [])) >= 6
    ),
    "WorkflowIdentifierAgent": lambda ins: len(ins.get("priority_tasks", [])) >= 3,
    "DeepDiveAgent": lambda ins: (
        all(
            pt in ins.get("workflows", {})
            and ins["workflows"][pt].get("trigger")
            and ins["workflows"][pt].get("steps")
            and ins["workflows"][pt].get("output")
            and ins["workflows"][pt].get("tools")
            for pt in ins.get("priority_tasks", [])
        )
        if ins.get("priority_tasks")
        else False
    ),
    "ToolsAgent": lambda ins: ins.get("tools_confirmed", False),
    "SkillsAgent": lambda ins: ins.get("skills_confirmed", False),
    "QualificationAgent": lambda ins: (
        ins.get("qualifications", {}).get("education") and
        len(str(ins.get("qualifications", {}).get("education"))) > 5 and
        ins.get("qualifications", {}).get("experience_years")
    ),
}

# ── Transition Messages ──────────────────────────────────────────────────────

TRANSITION_MESSAGES = {
    ("BasicInfoAgent", "WorkflowIdentifierAgent"): "That's a very clear picture of your mission and daily activities.",
    ("WorkflowIdentifierAgent", "DeepDiveAgent"): "Perfect roadmap! Now, let's dive into each of these tasks one by one to capture your expertise.",
    ("DeepDiveAgent", "ToolsAgent"): "Those deep dives were incredibly insightful. Now, let's quickly inventory the tools you use.",
    ("ToolsAgent", "SkillsAgent"): "Great. Now, what technical expertise is really required to do all this?",
    ("SkillsAgent", "QualificationAgent"): "Lastly, what academic or experience background would a newcomer need?",
    ("QualificationAgent", "JDGeneratorAgent"): "We've captured everything! I'm ready to generate your comprehensive Job Description.",
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
    """Compute weighted progress and depth scores for 7 agents.
    
    Weights:
      BasicInfo: 10%, WorkflowID: 10%, DeepDive: 50%, Tools: 10%, Skills: 10%, Quals: 5%, JDReady: 5%
    """
    try:
        current_idx = AGENT_ORDER.index(current_agent)
    except ValueError:
        current_idx = 0

    # Progressive percentage floor based on phase index
    phase_floors = [0, 10, 20, 70, 80, 90, 95]
    progress_floor = phase_floors[current_idx] if current_idx < len(phase_floors) else 95

    tasks_count = len(insights.get("tasks", []))
    tools_count = len(insights.get("tools", []))
    skills_count = len(insights.get("skills", []))
    priorities_count = len(insights.get("priority_tasks", []))
    workflows = insights.get("workflows", {})

    # Map to frontend keys: "tasks", "tools", "skills"
    depth_scores = {
        "tasks": 100 if AGENT_CRITERIA["BasicInfoAgent"](insights) else min(100, int((len(insights.get("purpose", "")) / 20 * 50) + (tasks_count / 6 * 50))),
        "workflow_id": min(100, int((priorities_count / 3) * 100)),
        "deep_dive": min(100, int((len(workflows) / max(priorities_count, 3)) * 100)) if priorities_count > 0 else 0,
        "tools": 100 if insights.get("tools_confirmed") else min(100, int((tools_count / 3) * 100)),
        "skills": 100 if insights.get("skills_confirmed") else min(100, int((skills_count / 4) * 100)),
    }
    # Keep 'basic_info' for internal score weighting (line 125)
    depth_scores["basic_info"] = depth_scores["tasks"]

    # Weighting logic
    basic_score = min(10, depth_scores["basic_info"] * 0.10)
    workflow_id_score = min(10, depth_scores["workflow_id"] * 0.10)
    
    if priorities_count > 0:
        workflows_done = sum(1 for p in insights.get("priority_tasks", []) if p in workflows and workflows[p].get("output"))
        deep_dive_score = (workflows_done / max(priorities_count, 3)) * 50 # Up to 50%
    else:
        deep_dive_score = 0

    tools_score = 10 if insights.get("tools_confirmed") else min(10, depth_scores["tools"] * 0.10)
    skills_score = 10 if insights.get("skills_confirmed") else min(10, depth_scores["skills"] * 0.10)
    quals_score = 5 if AGENT_CRITERIA["QualificationAgent"](insights) else 0

    total = basic_score + workflow_id_score + deep_dive_score + tools_score + skills_score + quals_score
    
    # Force 100% only if in JDGenerator phase
    if current_agent == "JDGeneratorAgent":
        final_percentage = 100.0
    else:
        final_percentage = max(progress_floor, min(round(total, 1), 99.0))

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
