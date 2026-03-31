# backend/app/agents/validators.py
"""
Data quality validators — run after each extraction to ensure quality.
Reuses the existing soft-skill blocklist from jd_service.py.
"""

from __future__ import annotations

import logging
from typing import Tuple

logger = logging.getLogger(__name__)

# ── Soft Skill Blocklist (same as jd_service.py) ─────────────────────────────

SOFT_SKILL_PATTERNS = {
    "communication", "teamwork", "collaboration", "leadership", "adaptability",
    "problem solving", "problem-solving", "critical thinking", "attention to detail",
    "time management", "interpersonal", "result-oriented", "results-oriented",
    "self-starter", "proactive", "detail-oriented", "organised", "organized",
    "motivated", "analytical thinking", "strategic thinking", "creative thinking",
    "team player", "work ethic", "multitasking", "decision making",
    "decision-making", "emotional intelligence", "conflict resolution",
    "negotiation skills", "presentation skills",
}


def sanitise_skills(skills: list) -> list:
    """Remove soft skills and duplicates from a skills list."""
    if not skills:
        return []
    seen: set[str] = set()
    clean: list[str] = []
    for s in skills:
        if not s or not isinstance(s, str):
            continue
        stripped = s.strip()
        lower = stripped.lower()
        if lower in seen:
            continue
        if any(pattern in lower for pattern in SOFT_SKILL_PATTERNS):
            continue
        clean.append(stripped)
        seen.add(lower)
    return clean


def validate_task_description(description: str) -> Tuple[bool, str]:
    """Ensure a task description is detailed enough."""
    if not description or not isinstance(description, str):
        return False, "Empty task description"
    words = description.strip().split()
    if len(words) < 5:
        return False, f"Task too vague ({len(words)} words): '{description}'. Need ≥5 words."
    # Check for generic labels
    generic_labels = {
        "writing code", "managing reports", "attending meetings",
        "doing work", "helping team", "general tasks",
    }
    if description.strip().lower() in generic_labels:
        return False, f"Task is a generic label: '{description}'"
    return True, ""


def validate_workflow(workflow: dict) -> Tuple[bool, str]:
    """Ensure a workflow has meaningful content."""
    if not workflow:
        return False, "Empty workflow"
    steps = workflow.get("steps", [])
    if len(steps) < 2:
        task = workflow.get("task_name", "unknown")
        return False, f"Workflow for '{task}' needs at least 2 steps."
    if not workflow.get("trigger"):
        task = workflow.get("task_name", "unknown")
        return False, f"Workflow for '{task}' needs a trigger."
    return True, ""


def validate_insights_completeness(insights: dict) -> dict:
    """Quick rule-based quality check. Returns {category: {ok, reason}}."""
    results = {}

    # Purpose
    purpose = insights.get("purpose", "")
    results["purpose"] = {
        "ok": len(purpose) > 30,
        "reason": "Purpose needs ≥30 characters" if len(purpose) <= 30 else "OK",
    }

    # Tasks
    tasks = insights.get("tasks", [])
    task_count = len(tasks)
    results["tasks"] = {
        "ok": task_count >= 6,
        "reason": f"Have {task_count}/6 tasks" if task_count < 6 else "OK",
    }

    # Priority tasks
    priorities = insights.get("priority_tasks", [])
    results["priority_tasks"] = {
        "ok": len(priorities) >= 3,
        "reason": f"Have {len(priorities)}/3 priorities" if len(priorities) < 3 else "OK",
    }

    # Workflows
    workflows = insights.get("workflows", {})
    missing_wf = [p for p in priorities if p not in workflows or not workflows[p].get("steps")]
    results["workflows"] = {
        "ok": len(missing_wf) == 0 and len(priorities) > 0,
        "reason": f"Missing workflows for: {missing_wf}" if missing_wf else "OK",
    }

    # Tools
    tools = insights.get("tools", [])
    tech = insights.get("technologies", [])
    results["tools"] = {
        "ok": len(tools) >= 2 or len(tech) >= 2,
        "reason": f"Have {len(tools)} tools, {len(tech)} tech" if (len(tools) < 2 and len(tech) < 2) else "OK",
    }

    # Skills
    skills = insights.get("skills", [])
    results["skills"] = {
        "ok": len(skills) >= 4,
        "reason": f"Have {len(skills)}/4 skills" if len(skills) < 4 else "OK",
    }

    # Qualifications
    quals = insights.get("qualifications", {})
    has_edu = bool(quals.get("education"))
    results["qualifications"] = {
        "ok": has_edu,
        "reason": "Missing education" if not has_edu else "OK",
    }

    return results


def compute_quality_score(insights: dict) -> int:
    """Compute an overall quality score 0-100."""
    checks = validate_insights_completeness(insights)
    weights = {
        "purpose": 10,
        "tasks": 30,
        "priority_tasks": 10,
        "workflows": 20,
        "tools": 10,
        "skills": 10,
        "qualifications": 10,
    }
    score = sum(weights[k] for k, v in checks.items() if v["ok"] and k in weights)
    return min(score, 100)


def is_ready_for_jd(insights: dict) -> bool:
    """Check if all critical categories are satisfied."""
    checks = validate_insights_completeness(insights)
    critical = ["purpose", "tasks", "priority_tasks", "workflows"]
    return all(checks.get(c, {}).get("ok", False) for c in critical)
