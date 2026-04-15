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
        # Ideal: Purpose length >= 10 and at least 3 turns (1 Mission + 1 Tasks)
        (
            len(ins.get("purpose") or "") >= 10
            and (ins.get("agent_turn_counts") or {}).get("BasicInfoAgent", 0) >= 3
        )
        # GUARDRAIL: Hard stop after 5 turns to prevent looping on Purpose
        or (ins.get("agent_turn_counts") or {}).get("BasicInfoAgent", 0) >= 5
    ),
    "WorkflowIdentifierAgent": lambda ins: (
        # Ideal: At least 1 priority task selected (no minimum restriction)
        len(ins.get("priority_tasks") or []) >= 1
        # GUARDRAIL: Hard stop after 4 turns if user doesn't select any
        or (ins.get("agent_turn_counts") or {}).get("WorkflowIdentifierAgent", 0) >= 4
    ),
    "DeepDiveAgent": lambda ins: (
        # Phase is complete if all priority tasks are visited.
        all(
            pt in (ins.get("visited_tasks") or [])
            for pt in (ins.get("priority_tasks") or [])
        )
        if ins.get("priority_tasks")
        else True  # Skip if no tasks identified
    ),
    "ToolsAgent": lambda ins: (
        ins.get("tools_confirmed", False)
        or (ins.get("agent_turn_counts") or {}).get("ToolsAgent", 0) >= 3
    ),
    "SkillsAgent": lambda ins: (
        ins.get("skills_confirmed", False)
        or (ins.get("agent_turn_counts") or {}).get("SkillsAgent", 0) >= 3
    ),
    "QualificationAgent": lambda ins: (
        # REQUIRE at least 2 turns to capture education + certifications
        (
            (ins.get("agent_turn_counts") or {}).get("QualificationAgent", 0) >= 2
            and (
                (ins.get("qualifications") or {}).get("education")
                and len(str((ins.get("qualifications") or {}).get("education"))) > 5
            )
        )
        # GUARDRAIL: Hard stop after 3 turns — questions are now more targeted
        or (ins.get("agent_turn_counts") or {}).get("QualificationAgent", 0) >= 3
    ),
}

# ── Transition Messages ──────────────────────────────────────────────────────

TRANSITION_MESSAGES = {
    (
        "BasicInfoAgent",
        "WorkflowIdentifierAgent",
    ): "Role activities captured. Now selecting priority tasks for detailed analysis.",
    (
        "WorkflowIdentifierAgent",
        "DeepDiveAgent",
    ): "Priority tasks confirmed. Now analyzing each task in detail.",
    (
        "DeepDiveAgent",
        "ToolsAgent",
    ): "Task analysis complete. Now confirming the tools and platforms used.",
    (
        "ToolsAgent",
        "SkillsAgent",
    ): "Tools confirmed. Now confirming the technical skills required.",
    (
        "SkillsAgent",
        "QualificationAgent",
    ): "Skills confirmed. Now capturing educational qualifications.",
    (
        "QualificationAgent",
        "JDGeneratorAgent",
    ): "All information captured. Generating the Job Description.",
}


def compute_current_agent(insights: dict, current_agent: str = "BasicInfoAgent") -> str:
    """Determine which agent should be active based on data depth.

    ENFORCES A LINEAR FLOW: Finds the index of the `current_agent` in `AGENT_ORDER`
    and only checks criteria for agents at or after that index.

    STICKY COMPLETION: If an agent is in `insights["completed_phases"]`, skip it.
    """
    completed_phases = insights.get("completed_phases") or []

    # Find the starting index (default to 0 if not found)
    try:
        start_idx = AGENT_ORDER.index(current_agent)
    except ValueError:
        start_idx = 0

    # Force-advance: skip current agent if stalled
    if insights.get("_force_advance"):
        logger.warning(f"[Router] Force-advancing past {current_agent} (loop control)")
        start_idx = min(start_idx + 1, len(AGENT_ORDER) - 1)
        # Reset stall counts for the stalled agent
        agent_stalls = insights.get("agent_stall_counts", {})
        agent_stalls[current_agent] = 0
        insights["agent_stall_counts"] = agent_stalls
        insights["_force_advance"] = False  # Reset flag

    # Only check agents from current_agent onwards
    for agent_name in AGENT_ORDER[start_idx:-1]:  # Exclude JDGeneratorAgent
        # Skip if explicitly marked complete
        if agent_name in completed_phases:
            continue

        criteria_fn = AGENT_CRITERIA.get(agent_name)
        if criteria_fn and not criteria_fn(insights):
            return agent_name

    return max(
        current_agent,
        "JDGeneratorAgent",
        key=lambda x: AGENT_ORDER.index(x) if x in AGENT_ORDER else -1,
    )


def get_transition_message(from_agent: str, to_agent: str) -> str:
    """Get a smooth transition message when switching agents."""
    return TRANSITION_MESSAGES.get((from_agent, to_agent), "")


def compute_progress(insights: dict, current_agent: str = "BasicInfoAgent") -> dict:
    """Monotonic progress computation with strict per-phase windows.

    Phase ranges (floor → ceiling):
      BasicInfoAgent:          0  → 15%
      WorkflowIdentifierAgent: 15 → 25%
      DeepDiveAgent:           25 → 85%  (60% window split per task)
      ToolsAgent:              85 → 90%
      SkillsAgent:             90 → 95%
      QualificationAgent:      95 → 99%
      JDGeneratorAgent:       100%

    Progress within each phase is interpolated from 0.0→1.0 using real data,
    then scaled to that phase's window. This guarantees the bar NEVER goes down.
    """
    PHASE_RANGES: dict[str, tuple[float, float]] = {
        "BasicInfoAgent": (0.0, 15.0),
        "WorkflowIdentifierAgent": (15.0, 25.0),
        "DeepDiveAgent": (25.0, 85.0),
        "ToolsAgent": (85.0, 90.0),
        "SkillsAgent": (90.0, 95.0),
        "QualificationAgent": (95.0, 99.0),
        "JDGeneratorAgent": (100.0, 100.0),
    }

    floor, ceiling = PHASE_RANGES.get(current_agent, (0.0, 99.0))

    priorities_count = len(insights.get("priority_tasks") or [])
    workflows = insights.get("workflows") or {}
    tasks_count = len(insights.get("tasks") or [])
    tools_count = len(insights.get("tools") or [])
    skills_count = len(insights.get("skills") or [])

    # ── Phase-local progress [0.0, 1.0] ─────────────────────────────────────
    if current_agent == "BasicInfoAgent":
        purpose_score = min(1.0, len(insights.get("purpose") or "") / 50)
        task_score = min(1.0, tasks_count / 6)
        phase_progress = (purpose_score * 0.5) + (task_score * 0.5)

    elif current_agent == "WorkflowIdentifierAgent":
        phase_progress = min(1.0, priorities_count / 3)

    elif current_agent == "DeepDiveAgent":
        if priorities_count == 0:
            phase_progress = 0.0
        else:
            # Done tasks (based on visited_tasks)
            visited = insights.get("visited_tasks") or []
            done_tasks_count = sum(
                1 for p in (insights.get("priority_tasks") or []) if p in visited
            )

            # Partial progress for the current active task (0.33 per task)
            active_task = insights.get("active_deep_dive_task")
            active_turn = insights.get("deep_dive_turn_count") or 0
            partial_progress = 0.0
            if active_task and active_task not in visited:
                # Based on your preference for 3 turns per task in the progress bar
                partial_progress = min(0.9, active_turn / 3)

            # Safety: ensure we never divide by zero if priorities aren't picked yet
            divisor = max(1, priorities_count)
            phase_progress = min(1.0, (done_tasks_count + partial_progress) / divisor)

    elif current_agent == "ToolsAgent":
        phase_progress = (
            1.0 if insights.get("tools_confirmed") else min(1.0, tools_count / 3)
        )

    elif current_agent == "SkillsAgent":
        phase_progress = (
            1.0 if insights.get("skills_confirmed") else min(1.0, skills_count / 4)
        )

    elif current_agent == "QualificationAgent":
        quals = insights.get("qualifications") or {}
        has_edu = bool(quals.get("education"))
        has_exp = bool(quals.get("experience_years"))
        phase_progress = (0.5 if has_edu else 0.0) + (0.5 if has_exp else 0.0)

    elif current_agent == "JDGeneratorAgent":
        phase_progress = 1.0

    else:
        phase_progress = 0.0

    # ── Final percentage (clamped to the phase window) ───────────────────────
    if current_agent == "JDGeneratorAgent":
        final_percentage = 100.0
    else:
        width = ceiling - floor
        final_percentage = min(ceiling, max(floor, floor + width * phase_progress))

    # ── Depth scores for UI pills ─────────────────────────────────────────────
    depth_scores: dict[str, int] = {
        "tasks": min(100, int((tasks_count / 6) * 100)),
        "tools": 100
        if insights.get("tools_confirmed")
        else min(100, int((tools_count / 3) * 100)),
        "skills": 100
        if insights.get("skills_confirmed")
        else min(100, int((skills_count / 4) * 100)),
        "workflow_id": min(100, int((priorities_count / 3) * 100)),
        "deep_dive": 0,
    }
    if priorities_count > 0:
        done = sum(
            1
            for p in (insights.get("priority_tasks") or [])
            if p in workflows and workflows[p].get("output")
        )
        depth_scores["deep_dive"] = min(100, int((done / priorities_count) * 100))

    depth_scores["basic_info"] = depth_scores["tasks"]

    return {
        "completion_percentage": round(final_percentage, 1),
        "depth_scores": depth_scores,
        "current_agent": current_agent,
        "status": "ready_for_generation"
        if current_agent == "JDGeneratorAgent"
        else "collecting",
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

    logger.info(
        f"[Router] Selected agent: {agent} | Progress: {progress['completion_percentage']:.0f}%"
    )

    return {
        "current_agent": agent,
        "previous_agent": previous_agent,
        "progress": progress,
        "ready_for_jd": agent == "JDGeneratorAgent",
    }
