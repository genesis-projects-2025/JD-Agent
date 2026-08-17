# backend/app/agents/validators.py
"""
Data quality validators — run after each extraction to ensure quality.
Reuses the existing soft-skill blocklist from jd_service.py.
"""

from __future__ import annotations

import logging
from typing import Tuple
import re

logger = logging.getLogger(__name__)

# ── Soft Skill Blocklist (same as jd_service.py) ─────────────────────────────

SOFT_SKILL_PATTERNS = {
    "communication",
    "teamwork",
    "collaboration",
    "leadership",
    "adaptability",
    "problem solving",
    "problem-solving",
    "critical thinking",
    "attention to detail",
    "time management",
    "interpersonal",
    "result-oriented",
    "results-oriented",
    "self-starter",
    "proactive",
    "detail-oriented",
    "organised",
    "organized",
    "motivated",
    "analytical thinking",
    "strategic thinking",
    "creative thinking",
    "team player",
    "work ethic",
    "multitasking",
    "decision making",
    "decision-making",
    "emotional intelligence",
    "conflict resolution",
    "negotiation skills",
    "presentation skills",
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
        return (
            False,
            f"Task too vague ({len(words)} words): '{description}'. Need ≥5 words.",
        )
    # Check for generic labels
    generic_labels = {
        "writing code",
        "managing reports",
        "attending meetings",
        "doing work",
        "helping team",
        "general tasks",
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
        "reason": f"Have {len(priorities)}/3 priorities"
        if len(priorities) < 3
        else "OK",
    }

    # Workflows
    workflows = insights.get("workflows") or {}
    missing_wf = [
        p for p in priorities if p not in workflows or not workflows[p].get("steps")
    ]
    results["workflows"] = {
        "ok": len(missing_wf) == 0 and len(priorities) > 0,
        "reason": f"Missing workflows for: {missing_wf}" if missing_wf else "OK",
    }

    # Tools
    tools = insights.get("tools", [])
    tech = insights.get("technologies", [])
    # Check if tools were mentioned in recent conversation (semantic detection)
    tools_mentioned = insights.get("tools_mentioned_recently", False)
    results["tools"] = {
        "ok": len(tools) >= 2 or len(tech) >= 2 or tools_mentioned,
        "reason": f"Have {len(tools)} tools, {len(tech)} tech"
        if (len(tools) < 2 and len(tech) < 2 and not tools_mentioned)
        else "OK",
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


# Add these functions to backend/app/agents/validators.py
# ROLE-AGNOSTIC: Works for Software, Sales, Finance, HR, Operations, etc.


def is_tool(item: str, role_title: str = "") -> bool:
    """
    Check if an item is a TOOL (software, platform, hardware, service, specific software package).

    ROLE-AGNOSTIC: Works for all departments.
    Strictly excludes verb phrases, sentences, soft skills, and abstract competencies.
    """
    if not item or not isinstance(item, str):
        return False

    item_clean = item.strip()
    item_lower = item_clean.lower()

    # ── EXCLUSIONS: Sentences, verb phrases, soft skills, and qualities are NEVER tools ──
    
    # 1. Verb/gerund starters (tasks, duties, responsibilities)
    if re.match(r"^(?:conducting|fostering|monitoring|reviewing|managing|developing|communicating|leading|reconciling|overseeing|analyzing|preparing|maintaining|providing|coordinating|executing|evaluating|building|implementing|supporting|ensuring|improving|handling|optimizing)\b", item_lower):
        return False

    # 2. Quality / Soft skill / Ability starters
    if re.match(r"^(?:aptitude|familiarity|commitment|ability|ease|proficiency|strong|in-depth|deep|thorough|comprehensive|understanding|knowledge|experience|passion|demonstrated|proven|track record)\b", item_lower):
        return False

    # 3. Long sentences or multi-word phrases (> 5 words) are NEVER tools
    word_count = len(item_clean.split())
    if word_count > 5:
        return False

    # 4. Contains sentence punctuation or prefix markers
    if any(m in item_lower for m in ["responsibility:", "responsibilities:", "duties:", "tasks:", "and providing", "and forecasting", "and reporting"]):
        return False

    # ── UNIVERSAL TOOL MATCHING ──────────────────────────────────────────────
    universal_tools = [
        "aws", "azure", "gcp", "google cloud", "digitalocean", "heroku",
        "docker", "kubernetes", "k8s", "helm", "swarm",
        "git", "github", "gitlab", "bitbucket", "svn", "perforce",
        "jenkins", "gitlab ci", "github actions", "circleci", "travis", "terraform", "ansible",
        "slack", "teams", "microsoft teams", "discord", "zoom", "webex", "confluence", "notion", "asana", "monday.com",
        "jira", "trello", "linear", "clickup", "smartsheet",
        "vscode", "vs code", "intellij", "pycharm", "eclipse", "xcode", "sublime", "atom", "vim",
        "mysql", "postgresql", "mongodb", "oracle", "sql server", "redis", "elasticsearch", "cassandra", "dynamodb", "firestore", "bigquery", "snowflake", "redshift",
        "tableau", "looker", "power bi", "qlik", "sisense", "datadog", "splunk", "new relic", "grafana",
        "microsoft office", "office 365", "google workspace", "excel", "powerpoint", "word", "sheets", "docs", "outlook",
        "salesforce", "hubspot", "pipedrive", "zoho", "sap", "netsuite", "highradius", "chaser", "tally", "quickbooks", "xero", "wave", "freshbooks",
        "workday", "bamboohr", "adp", "paychex", "greenhouse", "lever", "taleo",
        "mailchimp", "marketo", "pardot", "hootsuite", "buffer", "sprout social",
        "react", "vue", "angular", "svelte", "next.js", "django", "flask", "fastapi", "spring", "express", "node", "nodejs", "python", "java", "csharp", "c#", "go", "rust", "php", "ruby", "kotlin",
        "xcode", "android studio", "flutter", "react native", "postman", "insomnia", "graphql", "swagger",
        "selenium", "cypress", "playwright", "jest", "pytest", "junit",
        "sentry", "cloudwatch", "prometheus",
        "linux", "ubuntu", "macos", "windows", "bash", "shell", "zsh", "powershell",
        "sharepoint", "onedrive", "box", "dropbox",
        "figma", "adobe xd", "sketch", "photoshop", "illustrator", "canva",
        "r", "spss", "stata", "sas", "minitab", "matlab",
        "docusign", "evernote",
        "hplc", "gc-ms", "lc-ms", "ftir", "nmr", "pcr", "elisa", "spectrophotometer", "autoclave", "centrifuge", "microscope", "pyrx", "autodock", "blast", "chemdraw", "graphpad prism", "imagej"
    ]

    if any(tool in item_lower for tool in universal_tools):
        return True

    # ── TOOL SUFFIX / KEYWORD INDICATORS ────────────────────────────────────
    tool_keywords = [
        "software", "erp", "crm", "platform", "system", "suite", "tool", "tools",
        "app", "application", "database", "dashboard", "package", "packages",
        "portal", "terminal", "sdk", "api", "ide", "framework", "workbench"
    ]
    if any(kw in item_lower for kw in tool_keywords):
        return True

    # ── SKILL INDICATOR EXCLUSIONS ──────────────────────────────────────────
    skill_indicators = [
        "management", "planning", "strategy", "analysis", "development", "design", "architecture",
        "implementation", "optimization", "testing", "debugging", "integration", "deployment",
        "research", "validation", "synthesis", "formulation", "communication", "leadership", "teamwork",
        "collaboration", "problem solving", "critical thinking", "decision making",
        "financial", "accounting", "sales", "marketing", "operations", "supply chain", "procurement",
        "logistics", "manufacturing", "quality assurance", "compliance", "governance", "risk",
        "recruitment", "talent", "employee relations", "compensation", "benefits",
        "agile", "scrum", "devops", "full stack", "microservices", "api design"
    ]
    if any(indicator in item_lower for indicator in skill_indicators):
        return False

    # ── STRICT HEURISTIC FOR UNLISTED PROPER NOUN TOOLS ───────────────────────
    # Short capitalized noun or acronym (1-3 words) with NO verbs/clauses
    if word_count <= 3 and not re.search(r"\b(?:and|or|in|with|for|to|of|on|by|at|from)\b", item_lower):
        if item_clean[0].isupper() or item_clean.isupper():
            return True

    return False


def is_skill(item: str, role_title: str = "") -> bool:
    """Check if an item is a SKILL (competency, expertise area).

    Skills are ABSTRACT COMPETENCIES: expertise areas, knowledge domains,
    professional capabilities.
    """
    return not is_tool(item, role_title)


def separate_tools_and_skills(
    mixed_list: list, role_title: str = ""
) -> tuple[list, list]:
    """
    Separate a mixed list of tools and skills into two lists.

    Works for ANY role: Software, Sales, Finance, HR, Operations, etc.

    Args:
        mixed_list: Potentially mixed list of tools and skills
        role_title: Optional job title for context (e.g., "Junior Software Developer")

    Returns:
        (tools_list, skills_list)
    """
    tools = []
    skills = []
    seen_tools = set()
    seen_skills = set()

    for item in mixed_list:
        if not item or not isinstance(item, str):
            continue

        item_clean = str(item).strip()
        item_lower = item_clean.lower()

        # Skip duplicates
        if item_lower in seen_tools or item_lower in seen_skills:
            continue

        if is_tool(item_clean, role_title):
            if item_lower not in seen_tools:
                tools.append(item_clean)
                seen_tools.add(item_lower)
        else:
            if item_lower not in seen_skills:
                skills.append(item_clean)
                seen_skills.add(item_lower)

    return tools, skills


# ── DEBUGGING HELPER ─────────────────────────────────────────────────────


def classify_item(item: str, role_title: str = "") -> dict:
    """
    Debug helper: classify an item and return classification details.

    Returns:
        {
            "item": "...",
            "classification": "tool" | "skill",
            "confidence": "high" | "medium" | "low",
            "reason": "Why it was classified this way"
        }
    """
    item_lower = str(item).lower().strip()

    # Quick checks for confidence
    if any(
        tool in item_lower
        for tool in [
            "aws",
            "azure",
            "docker",
            "git",
            "jira",
            "slack",
            "salesforce",
            "tableau",
            "excel",
            "mysql",
            "postgres",
        ]
    ):
        return {
            "item": item,
            "classification": "tool",
            "confidence": "high",
            "reason": "Matches known tool pattern",
        }

    if any(
        skill in item_lower
        for skill in ["management", "analysis", "development", "design", "planning"]
    ):
        return {
            "item": item,
            "classification": "skill",
            "confidence": "high",
            "reason": "Matches known skill pattern",
        }

    # Medium confidence based on word count
    word_count = len(item.split())
    if word_count >= 3:
        return {
            "item": item,
            "classification": "skill",
            "confidence": "medium",
            "reason": "Multi-word phrase (typically skills)",
        }
    else:
        return {
            "item": item,
            "classification": "tool",
            "confidence": "medium",
            "reason": "Short phrase (typically tools)",
        }
