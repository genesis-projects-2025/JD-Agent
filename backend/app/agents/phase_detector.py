# backend/app/agents/phase_detector.py
"""
Phase Detector — Intelligent state-driven phase detection.

Replaces the router's agent selection with dynamic phase detection
based on what data is missing, not a fixed agent order.
"""

from __future__ import annotations

import logging

logger = logging.getLogger(__name__)

# ── Phase Definitions ──────────────────────────────────────────────────────────

PHASES = [
    "role_discovery",
    "task_collection",
    "priority_selection",
    "deep_dive",
    "tools_confirmation",
    "skills_confirmation",
    "qualifications",
    "jd_generation",
]

# Phase weights for progress calculation
PHASE_WEIGHTS = {
    "role_discovery": 0.05,
    "task_collection": 0.15,
    "priority_selection": 0.10,
    "deep_dive": 0.40,
    "tools_confirmation": 0.10,
    "skills_confirmation": 0.10,
    "qualifications": 0.05,
    "jd_generation": 0.05,
}

# Phase floor percentages (minimum progress when in this phase)
PHASE_FLOORS = {
    "role_discovery": 0,
    "task_collection": 5,
    "priority_selection": 20,
    "deep_dive": 30,
    "tools_confirmation": 70,
    "skills_confirmation": 80,
    "qualifications": 90,
    "jd_generation": 95,
}


def detect_phase(insights: dict, current_phase: str = "role_discovery") -> str:
    """
    Intelligent phase detection based on state completeness.

    Unlike the old router which checked agents in fixed order,
    this detects the current phase by analyzing what's missing.

    Returns the phase that needs attention.
    """
    if not isinstance(insights, dict):
        insights = {}

    # Check each phase's completion criteria
    # Move forward only when current phase is complete

    # Phase 1: Role Discovery
    if current_phase == "role_discovery":
        if not _is_role_complete(insights):
            return "role_discovery"

    # Phase 2: Task Collection
    if current_phase in ["role_discovery", "task_collection"]:
        if not _are_tasks_complete(insights):
            return "task_collection"

    # Phase 3: Priority Selection
    if current_phase in ["role_discovery", "task_collection", "priority_selection"]:
        if not _are_priorities_complete(insights):
            return "priority_selection"

    # Phase 4: Deep Dive
    if current_phase in [
        "role_discovery",
        "task_collection",
        "priority_selection",
        "deep_dive",
    ]:
        if not _is_deep_dive_complete(insights):
            return "deep_dive"

    # Phase 5: Tools Confirmation
    if current_phase in PHASES[:5]:
        if not _are_tools_confirmed(insights):
            return "tools_confirmation"

    # Phase 6: Skills Confirmation
    if current_phase in PHASES[:6]:
        if not _are_skills_confirmed(insights):
            return "skills_confirmation"

    # Phase 7: Qualifications
    if current_phase in PHASES[:7]:
        if not _are_qualifications_complete(insights):
            return "qualifications"

    # Phase 8: JD Generation
    return "jd_generation"


def _is_role_complete(insights: dict) -> bool:
    """Check if role discovery is complete."""
    role = insights.get("role", "")
    purpose = insights.get("purpose", "")
    # Role is complete if we have a role title (≥3 chars) or a purpose (≥20 chars)
    return len(role) >= 3 or len(purpose) >= 20


def _are_tasks_complete(insights: dict) -> bool:
    """Check if task collection is complete."""
    tasks = insights.get("tasks", [])
    if not isinstance(tasks, list):
        return False
    # Need at least 6 tasks
    return len(tasks) >= 6


def _are_priorities_complete(insights: dict) -> bool:
    """Check if priority selection is complete."""
    priorities = insights.get("priority_tasks", [])
    if not isinstance(priorities, list):
        return False
    # Need at least 3 priority tasks
    return len(priorities) >= 3


def _is_deep_dive_complete(insights: dict) -> bool:
    """Check if deep dive is complete for all priority tasks."""
    priority_tasks = insights.get("priority_tasks", [])
    if not priority_tasks:
        return False

    workflows = insights.get("workflows", {})
    if not isinstance(workflows, dict):
        return False

    # Check each priority task has a complete workflow
    for task in priority_tasks:
        wf = workflows.get(task, {})
        if not isinstance(wf, dict):
            return False
        # Need trigger, steps (≥2), tools, and output
        if not wf.get("trigger"):
            return False
        steps = wf.get("steps", [])
        if not isinstance(steps, list) or len(steps) < 2:
            return False
        if not wf.get("tools"):
            return False
        if not wf.get("output"):
            return False

    return True


def _are_tools_confirmed(insights: dict) -> bool:
    """Check if tools are confirmed."""
    return insights.get("tools_confirmed", False) is True


def _are_skills_confirmed(insights: dict) -> bool:
    """Check if skills are confirmed."""
    return insights.get("skills_confirmed", False) is True


def _are_qualifications_complete(insights: dict) -> bool:
    """Check if qualifications are complete."""
    quals = insights.get("qualifications", {})
    if not isinstance(quals, dict):
        return False
    education = quals.get("education", "")
    experience = quals.get("experience_years", "")
    # Need education (≥5 chars) and experience
    return len(str(education)) >= 5 and bool(experience)


def compute_progress(insights: dict, current_phase: str) -> dict:
    """
    Compute weighted progress and depth scores.

    Returns:
        {
            "completion_percentage": float,
            "depth_scores": dict,
            "current_phase": str,
            "status": str,
        }
    """
    if not isinstance(insights, dict):
        insights = {}

    # Calculate per-phase progress
    phase_progress = _calculate_phase_progress(insights, current_phase)

    # Calculate depth scores for frontend display
    depth_scores = _calculate_depth_scores(insights)

    # Calculate total weighted progress
    total = 0.0
    completed_phases = (
        PHASES[: PHASES.index(current_phase)] if current_phase in PHASES else []
    )

    for phase in completed_phases:
        total += PHASE_WEIGHTS.get(phase, 0) * 100

    # Add current phase progress
    total += (
        phase_progress.get(current_phase, 0) * PHASE_WEIGHTS.get(current_phase, 0) * 100
    )

    # Apply phase floor
    floor = PHASE_FLOORS.get(current_phase, 0)
    final_percentage = max(
        floor, min(round(total, 1), 99.0 if current_phase != "jd_generation" else 100.0)
    )

    return {
        "completion_percentage": final_percentage,
        "depth_scores": depth_scores,
        "current_phase": current_phase,
        "status": "jd_generated" if current_phase == "jd_generation" else "collecting",
    }


def _calculate_phase_progress(insights: dict, current_phase: str) -> dict:
    """Calculate progress within each phase (0.0 to 1.0)."""
    progress = {}

    if current_phase == "role_discovery":
        role = insights.get("role", "")
        purpose = insights.get("purpose", "")
        role_progress = min(1.0, len(role) / 20)
        purpose_progress = min(1.0, len(purpose) / 50)
        progress["role_discovery"] = max(role_progress, purpose_progress) * 0.5

    elif current_phase == "task_collection":
        tasks = insights.get("tasks", [])
        task_count = len(tasks) if isinstance(tasks, list) else 0
        progress["task_collection"] = min(1.0, task_count / 6)

    elif current_phase == "priority_selection":
        priorities = insights.get("priority_tasks", [])
        priority_count = len(priorities) if isinstance(priorities, list) else 0
        progress["priority_selection"] = min(1.0, priority_count / 3)

    elif current_phase == "deep_dive":
        priority_tasks = insights.get("priority_tasks", [])
        workflows = insights.get("workflows", {})
        if priority_tasks:
            completed = sum(
                1
                for task in priority_tasks
                if task in workflows
                and workflows[task].get("trigger")
                and len(workflows[task].get("steps", [])) >= 2
                and workflows[task].get("tools")
                and workflows[task].get("output")
            )
            progress["deep_dive"] = completed / len(priority_tasks)
        else:
            progress["deep_dive"] = 0

    elif current_phase == "tools_confirmation":
        tools = insights.get("tools", [])
        tool_count = len(tools) if isinstance(tools, list) else 0
        progress["tools_confirmation"] = min(1.0, tool_count / 3) * 0.7
        if insights.get("tools_confirmed"):
            progress["tools_confirmation"] = 1.0

    elif current_phase == "skills_confirmation":
        skills = insights.get("skills", [])
        skill_count = len(skills) if isinstance(skills, list) else 0
        progress["skills_confirmation"] = min(1.0, skill_count / 4) * 0.7
        if insights.get("skills_confirmed"):
            progress["skills_confirmation"] = 1.0

    elif current_phase == "qualifications":
        quals = insights.get("qualifications", {})
        edu_progress = min(1.0, len(str(quals.get("education", ""))) / 20)
        exp_progress = min(1.0, 1.0 if quals.get("experience_years") else 0.0)
        progress["qualifications"] = (edu_progress + exp_progress) / 2

    elif current_phase == "jd_generation":
        progress["jd_generation"] = 1.0

    return progress


def _calculate_depth_scores(insights: dict) -> dict:
    """Calculate depth scores for each data category."""
    tasks = insights.get("tasks", [])
    tools = insights.get("tools", [])
    skills = insights.get("skills", [])
    priorities = insights.get("priority_tasks", [])
    workflows = insights.get("workflows", {})

    return {
        "role": min(100, int(len(insights.get("role", "")) / 20 * 100)),
        "tasks": min(100, int(len(tasks) / 6 * 100)),
        "priorities": min(100, int(len(priorities) / 3 * 100)),
        "deep_dive": min(100, int(len(workflows) / max(len(priorities), 1) * 100))
        if priorities
        else 0,
        "tools": min(100, int(len(tools) / 3 * 100)),
        "skills": min(100, int(len(skills) / 4 * 100)),
        "qualifications": min(
            100,
            int(
                (
                    min(
                        1.0,
                        len(
                            str(insights.get("qualifications", {}).get("education", ""))
                        )
                        / 20,
                    )
                    + (
                        1.0
                        if insights.get("qualifications", {}).get("experience_years")
                        else 0.0
                    )
                )
                / 2
                * 100
            ),
        ),
    }


def get_phase_instructions(phase: str) -> str:
    """Get instructions for the current phase."""
    instructions = {
        "role_discovery": (
            "Focus on understanding the role's primary purpose and mission. "
            "Ask about the value this role creates for the organization."
        ),
        "task_collection": (
            "Collect a comprehensive list of daily, weekly, and monthly tasks. "
            "Aim for at least 6 distinct tasks with detailed descriptions."
        ),
        "priority_selection": (
            "Ask the user to identify their 3-5 most critical or time-consuming tasks. "
            "These will be the focus of deep-dive analysis."
        ),
        "deep_dive": (
            "For each priority task, document the complete workflow: "
            "trigger, step-by-step process, tools used, and output/outcome."
        ),
        "tools_confirmation": (
            "Present the complete list of tools and technologies extracted from workflows. "
            "Ask for confirmation and any additions."
        ),
        "skills_confirmation": (
            "Present the technical skills inferred from tasks and tools. "
            "Ask for confirmation and any missing expertise."
        ),
        "qualifications": (
            "Ask about required education, certifications, and years of experience."
        ),
        "jd_generation": (
            "All data collection is complete. Generate the final Job Description."
        ),
    }
    return instructions.get(phase, "")


def get_transition_message(from_phase: str, to_phase: str) -> str:
    """Get a smooth transition message when switching phases."""
    transitions = {
        (
            "role_discovery",
            "task_collection",
        ): "Thank you for that overview. Now, let's dive into your specific daily and weekly tasks.",
        (
            "task_collection",
            "priority_selection",
        ): "Excellent, I have a comprehensive list of your activities. Now, which of these would you say are your most critical responsibilities?",
        (
            "priority_selection",
            "deep_dive",
        ): "Perfect. Now let's explore each of these priority tasks in detail to understand your expertise.",
        (
            "deep_dive",
            "tools_confirmation",
        ): "Those deep dives were incredibly insightful. Now, let's review the complete list of tools and technologies you use.",
        (
            "tools_confirmation",
            "skills_confirmation",
        ): "Great. Now, what technical expertise is really required to do all this?",
        (
            "skills_confirmation",
            "qualifications",
        ): "Lastly, what academic or experience background would a newcomer need for this role?",
        (
            "qualifications",
            "jd_generation",
        ): "We've captured everything! I'm ready to generate your comprehensive Job Description.",
    }
    return transitions.get((from_phase, to_phase), "")
