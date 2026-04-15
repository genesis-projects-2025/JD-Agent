# backend/app/agents/extraction_engine.py
"""
Extraction Engine — Extracts structured data from user messages.

This engine runs BEFORE question generation to extract any available
information from the user's input, maximizing information collection
while minimizing turns.
"""

from __future__ import annotations

import json
import re
import logging
from typing import Dict, List, Any, Optional

logger = logging.getLogger(__name__)
from pydantic import BaseModel, Field
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.messages import SystemMessage, HumanMessage

from app.core.config import settings

# ── LLM for Extraction ──────────────────────────────────────────────────────

extraction_llm = ChatGoogleGenerativeAI(
    google_api_key=settings.GEMINI_API_KEY,
    model="gemini-2.5-flash",
    temperature=0.1,  # Low temperature for consistent extraction
)


# ── Extraction Schema ───────────────────────────────────────────────────────
class ExtractedTask(BaseModel):
    description: str = Field(description="Task description")
    frequency: Optional[str] = Field(
        None, description="Frequency (daily/weekly/monthly/ad-hoc)"
    )


class WorkflowDetail(BaseModel):
    trigger: Optional[str] = Field(None, description="What starts the task")
    steps: Optional[List[str]] = Field(None, description="Step by step process")
    tools: Optional[List[str]] = Field(
        None, description="Tools used for this specific task"
    )
    output: Optional[str] = Field(None, description="Final result or deliverable")
    problem_solving: Optional[str] = Field(
        None, description="How challenges are handled"
    )


class Qualifications(BaseModel):
    education: Optional[str] = None
    experience_years: Optional[str] = None
    certifications: Optional[List[str]] = None


class ExtractionSchema(BaseModel):
    role: Optional[str] = None
    department: Optional[str] = None
    reports_to: Optional[str] = None
    purpose: Optional[str] = None
    tasks: Optional[List[ExtractedTask]] = None
    priority_tasks: Optional[List[str]] = None
    workflows: Optional[Dict[str, WorkflowDetail]] = Field(
        None, description="Key is the task name"
    )
    tools: Optional[List[str]] = None
    technologies: Optional[List[str]] = None
    skills: Optional[List[str]] = None
    qualifications: Optional[Qualifications] = None
    conflicts: Optional[List[dict]] = None
    user_wants_to_proceed: Optional[bool] = None


# ── Extraction Prompt ───────────────────────────────────────────────────────

EXTRACTION_PROMPT = """You are a data extraction specialist. Extract structured information from the user's message.

Given the user's message and the current state, extract ANY information that can be mapped to these fields:

FIELDS TO EXTRACT:
1. role: Job title or designation (if mentioned)
2. department: Department or function (if mentioned)
3. reports_to: Who the role reports to or reporting manager name/title (if mentioned)
4. purpose: The role's primary value/mission (if described)
5. tasks: List of task descriptions (if mentioned)
   - Each task should have: description (required), frequency (optional: daily/weekly/monthly/quarterly/ad-hoc)
5. priority_tasks: Tasks identified as most critical (if mentioned)
6. workflows: A DICTIONARY where the key is the task name, and the value is an object containing:
   - trigger: What starts the task
   - steps: Step-by-step process
   - tools: Tools/software used
   - output: Final deliverable
   - problem_solving: How challenges are handled
   Make sure it is ALWAYS a dictionary {{ "Task Name": {{ "trigger": ... }} }}, NOT an array.
7. tools: Software, hardware, platforms mentioned
8. technologies: Frameworks, languages, cloud services mentioned
9. skills: Technical/domain skills mentioned (NOT soft skills)
10. qualifications:
    - education: Degrees/diplomas mentioned
    - experience_years: Years of experience mentioned
    - certifications: Professional certifications mentioned
11. conflicts: List of detected contradictions (if any)
12. user_wants_to_proceed: BOOLEAN. Set to true if the user explicitly says they are done sharing tasks, or that we should move to the next phase, or says "proceed/continue/that's it/no more" when asked about tasks.

RULES:
1. Extract ONLY what is explicitly stated or strongly implied
2. Do NOT hallucinate information
3. FLAT DELTA ONLY: Output ONLY the newest changes in a flat format.
4. ENTITY LINKING: If a tool is mentioned (e.g., "VS Code"), automatically infer and link it to a skill field (e.g., "Software Development").
5. CONFLICT DETECTION: If the user provides data that contradicts their role level (e.g., Senior tasks for a Junior title), output an object `conflicts: [{{ "description": "The user is entry-level but described handling architecture design." }}]`. Do not ask the user; silently record it.
6. PROFESSIONALIZATION: Translate all user inputs into formal, enterprise-grade business terminology. Fix typos and grammar. (e.g., "doing payroll" -> "Payroll Processing & Management")
7. STRICT SKILL FILTERING: For `skills`, absolutely prohibit extracting soft skills. DO NOT extract "communication", "leadership", "hardworking", "mentorship", etc. ONLY extract formal, hard, technical/domain specific skills.
8. SEMANTIC FOLDING & DEDUPLICATION: Group highly similar skills/tools into a single, professional "Expertise Pillar" if they share >70% semantic intent. Example: ["Data Validation", "Data Verification", "Data Reconciliation"] -> "Data Integrity & Reconciliation".
9. ANTI-LEAK RULE: Absolutely DO NOT extract agent questions, system instructions, or conversational filler from the message history as if they were user data. (e.g. If the history shows an agent asking 'What are your tasks?', do NOT extract 'What are your tasks?' as a new task).
10. If CURRENT AGENT MISSION is listed below, heavily prioritize extracting data for that mission!
11. SMARTER PRE-RANKING: When extracting or updating `tasks`, always sort them by strategic importance (Strategic/Architecture > Operational/Implementation > Administrative/Support). List the most critical tasks first.

CURRENT AGENT MISSION:
{current_agent}

CURRENT MEMORY (Do NOT extract these again, unless modifying them):
{current_state}

USER MESSAGE:
{user_message}

Return ONLY valid JSON with the extracted data. Use empty objects/arrays for fields with no new data.
"""

# ── Extraction Functions ────────────────────────────────────────────────────


# Common role patterns
ROLE_PATTERNS = [
    re.compile(
        r"(?:my\s+)?(?:job\s+)?title\s+is\s+([A-Za-z\s]+?)(?:\s*(?:,|\.|$|in\s+))"
    ),
    re.compile(
        r"(?:I\s+)?(?:work\s+)?as\s+(?:a\s+)?([A-Za-z\s]+?)(?:\s*(?:,|\.|$|at\s+))"
    ),
    re.compile(
        r"(?:I\s+)?(?:am\s+)?(?:a\s+)?([A-Za-z\s]+?(?:engineer|developer|manager|analyst|specialist|lead|director|head|architect|scientist|consultant|coordinator|administrator|officer|executive|supervisor|technician|designer|researcher|strategist|planner|advisor))"
    ),
]

# Department patterns
DEPT_PATTERNS = [
    re.compile(
        r"(?:in\s+)?(?:the\s+)?([A-Za-z\s]+?(?:department|division|team|group|unit|section))"
    ),
    re.compile(
        r"(?:from\s+)?(?:the\s+)?([A-Za-z\s]+?(?:department|division|team|group|unit|section))"
    ),
    re.compile(r"(?:working\s+)?in\s+([A-Za-z\s]+?)(?:\s*(?:,|\.|$))"),
]


def extract_role_info(text: str) -> dict:
    """Extract role, department from text using patterns."""
    extracted = {}
    text_lower = text.lower()

    for pattern in ROLE_PATTERNS:
        match = pattern.search(text_lower)
        if match:
            role = match.group(1).strip()
            if len(role.split()) <= 6:
                extracted["role"] = role.title()
            break

    for pattern in DEPT_PATTERNS:
        match = pattern.search(text_lower)
        if match:
            dept = match.group(1).strip()
            if dept and len(dept) > 2 and len(dept.split()) <= 6:
                extracted["department"] = dept.title()
                break

    return extracted


# Task indicator patterns
TASK_INDICATORS = [
    re.compile(
        r"(?:my\s+)?(?:daily|weekly|monthly|regular|typical)\s+(?:tasks?|responsibilities?|duties?)\s*(?:include|are|consist of|involve)\s*[:\-]?\s*(.+)"
    ),
    re.compile(r"(?:I\s+)?(?:am\s+)?(?:responsible\s+)?for\s+(.+)"),
    re.compile(
        r"(?:I\s+)?(?:handle|manage|oversee|lead|work\s+on|do|perform|execute)\s+(.+)"
    ),
    re.compile(
        r"(?:my\s+)?(?:main|key|primary|core)\s+(?:tasks?|responsibilities?|duties?|focus)\s*(?:is|are)\s+(.+)"
    ),
]

# Frequency patterns
FREQUENCY_MAP = {
    "daily": re.compile(r"\b(?:daily|every\s+day|each\s+day)\b"),
    "weekly": re.compile(r"\b(?:weekly|every\s+week|each\s+week)\b"),
    "monthly": re.compile(r"\b(?:monthly|every\s+month|each\s+month)\b"),
    "quarterly": re.compile(r"\b(?:quarterly|every\s+quarter)\b"),
    "ad-hoc": re.compile(
        r"\b(?:occasionally|as\s+needed|when\s+required|from\s+time\s+to\s+time)\b"
    ),
}


def extract_tasks(text: str) -> list:
    """Extract tasks from text using patterns and heuristics."""
    tasks = []
    text_lower = text.lower()

    for pattern in TASK_INDICATORS:
        matches = pattern.finditer(text_lower)
        for match in matches:
            task_text = match.group(1).strip()
            # Split by common delimiters
            potential_tasks = re.split(r"[,;]|\b(?:and|or)\b", task_text)
            for task in potential_tasks:
                task = task.strip()
                if len(task) > 10:  # Minimum task length
                    # Determine frequency
                    frequency = "daily"  # default
                    for freq, freq_pattern in FREQUENCY_MAP.items():
                        if freq_pattern.search(text_lower):
                            frequency = freq
                            break

                    tasks.append(
                        {
                            "description": task,
                            "frequency": frequency,
                            "category": "technical",  # default
                        }
                    )

    # Also look for bullet-pointed tasks
    bullet_tasks = re.findall(r"(?:^|\n)\s*[-•*]\s+(.+)", text)
    for task in bullet_tasks:
        task = task.strip()
        if len(task) > 10 and not any(
            kw in task.lower() for kw in ["i ", "my ", "the ", "a "]
        ):
            tasks.append(
                {
                    "description": task,
                    "frequency": "daily",
                    "category": "technical",
                }
            )

    return tasks


# Common tool/tech patterns
TOOL_PATTERNS = [
    re.compile(
        r"\b(?:using|with|via|through)\s+([A-Za-z0-9\s,]+?)(?:\s*(?:,|\.|$|to\s+))"
    ),
    re.compile(
        r"\b(?:tools?|software|platforms?|systems?|applications?)\s*(?:include|are|such\s+as|like)\s*[:\-]?\s*(.+)"
    ),
    re.compile(
        r"\b(?:experience\s+)?(?:with|in)\s+([A-Za-z0-9\s,]+?)(?:\s*(?:,|\.|$))"
    ),
]


def extract_tools(text: str) -> list:
    """Extract tools and technologies from text."""
    tools = []

    # Known tech keywords (for validation)
    known_tech = {
        "python",
        "java",
        "javascript",
        "typescript",
        "react",
        "angular",
        "vue",
        "node",
        "django",
        "flask",
        "fastapi",
        "spring",
        ".net",
        "c#",
        "cpp",
        "aws",
        "azure",
        "gcp",
        "docker",
        "kubernetes",
        "jenkins",
        "git",
        "sql",
        "postgres",
        "mysql",
        "mongodb",
        "redis",
        "elasticsearch",
        "jira",
        "confluence",
        "slack",
        "teams",
        "salesforce",
        "sap",
        "excel",
        "tableau",
        "powerbi",
        "figma",
        "adobe",
    }

    for pattern in TOOL_PATTERNS:
        matches = pattern.finditer(text.lower())
        for match in matches:
            items = re.split(r"[,;]|\b(?:and|or)\b", match.group(1))
            for item in items:
                item = item.strip()
                if 2 < len(item) < 30:
                    # Check if it looks like a tool/tech name
                    if any(tech in item for tech in known_tech) or item.istitle():
                        tools.append(item.title())

    return list(set(tools))


# Skill patterns
SKILL_PATTERNS = [
    re.compile(
        r"\b(?:skills?|expertise|competencies?|proficiency)\s*(?:include|are|in)\s*[:\-]?\s*(.+)"
    ),
    re.compile(
        r"\b(?:skilled\s+)?(?:in|at|with)\s+([A-Za-z0-9\s,]+?)(?:\s*(?:,|\.|$))"
    ),
    re.compile(
        r"\b(?:strong|solid|excellent)\s+(?:skills\s+)?(?:in\s+)?([A-Za-z0-9\s,]+?)\b"
    ),
]


def extract_skills(text: str) -> list:
    """Extract technical skills from text."""
    skills = []

    # Soft skills to exclude
    soft_skills = {
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
    }

    for pattern in SKILL_PATTERNS:
        matches = pattern.finditer(text.lower())
        for match in matches:
            items = re.split(r"[,;]|\b(?:and|or)\b", match.group(1))
            for item in items:
                item = item.strip().lower()
                if item and item not in soft_skills and len(item) > 2:
                    skills.append(item.title())

    return list(set(skills))


async def extract_with_llm(
    user_message: str, current_state: dict, current_agent: str = ""
) -> dict:
    """Use LLM for comprehensive extraction."""
    try:
        # PERFORMANCE UPGRADE: Truncate history passed to extraction LLM (last 4 messages ONLY)
        # Utility extraction does not need full context, saving tokens and processing time.
        state_summary = serialize_insights(current_state)

        prompt = EXTRACTION_PROMPT.format(
            current_agent=current_agent,
            current_state=state_summary,
            user_message=user_message,
        )

        structured_llm = extraction_llm.with_structured_output(ExtractionSchema)
        response = await structured_llm.ainvoke(
            [
                SystemMessage(
                    content="Extract structured data from the user's message using the strict schema."
                ),
                HumanMessage(content=prompt),
            ]
        )

        if not response:
            return {}

        extracted = response.model_dump(exclude_none=True)

        return extracted

    except Exception as e:
        logger.error(f"[Extraction] LLM extraction failed: {e}")
        return {}


async def extract_information(
    user_message: str, current_state: dict, current_agent: str = ""
) -> dict:
    """
    Main extraction function — combines pattern-based and LLM extraction.

    Args:
        user_message: The user's message text
        current_state: Current insights state
        current_agent: Name of the active agent to prioritize extraction

    Returns:
        Dictionary of extracted data to merge into state
    """
    extracted = {}

    # Phase 1: Quick pattern-based extraction (fast, no LLM)
    role_info = extract_role_info(user_message)
    if role_info:
        extracted.update(role_info)

    tasks = extract_tasks(user_message)
    if tasks:
        extracted["tasks"] = tasks

    tools = extract_tools(user_message)
    if tools:
        existing_tools = set(current_state.get("tools", []))
        new_tools = [t for t in tools if t not in existing_tools]
        if new_tools:
            extracted["tools"] = list(existing_tools | set(new_tools))

    skills = extract_skills(user_message)
    if skills:
        existing_skills = set(current_state.get("skills", []))
        new_skills = [s for s in skills if s not in existing_skills]
        if new_skills:
            extracted["skills"] = list(existing_skills | set(new_skills))

    # Phase 2: LLM extraction
    # We ALWAYS run LLM extraction now because conversational data is too complex for just regex
    if len(user_message) > 5:
        llm_extracted = await extract_with_llm(
            user_message, current_state, current_agent
        )

        # Merge LLM extraction (LLM results take precedence for complex fields)
        for key in [
            "role",
            "department",
            "reports_to",
            "purpose",
            "tasks",
            "priority_tasks",
            "workflows",
            "tools",
            "skills",
            "qualifications",
            "tools_confirmed",
            "skills_confirmed",
            "conflicts",
        ]:
            if key in llm_extracted and llm_extracted[key]:
                extracted[key] = llm_extracted[key]

    # Clean up extracted data
    extracted = {k: v for k, v in extracted.items() if v not in (None, "", [], {})}

    # ── AGENT-SCOPED EXTRACTION FILTER ──────────────────────────────────────
    # Prevent cross-agent data pollution by limiting which fields each agent
    # can extract. This stops BasicInfoAgent from accidentally extracting skills,
    # and keeps DeepDive focused on workflows.
    AGENT_ALLOWED_FIELDS = {
        "BasicInfoAgent": {"role", "department", "reports_to", "purpose", "tasks", "user_wants_to_proceed"},
        "WorkflowIdentifierAgent": {"priority_tasks", "tasks", "user_wants_to_proceed"},
        "DeepDiveAgent": {"workflows", "tools", "tasks", "purpose"},
        "ToolsAgent": {"tools", "technologies", "tools_confirmed"},
        "SkillsAgent": {"skills", "skills_confirmed"},
        "QualificationAgent": {"qualifications"},
    }

    allowed = AGENT_ALLOWED_FIELDS.get(current_agent)
    if allowed:
        filtered = {}
        for key, value in extracted.items():
            if key in allowed:
                filtered[key] = value
            else:
                # Silently drop fields outside this agent's scope
                logger.debug(
                    f"[Extraction] Dropped '{key}' from {current_agent} (out of scope)"
                )
        extracted = filtered

    return extracted


def _deep_merge_dict(d1: dict, d2: dict) -> dict:
    """Recursively merge d2 into d1 with non-destructive rules."""
    import json

    for k, v in d2.items():
        # If value is empty/None, do NOT overwrite (Guardrail 1)
        if v in (None, "", [], {}):
            continue

        if isinstance(v, dict) and k in d1 and isinstance(d1[k], dict):
            d1[k] = _deep_merge_dict(d1[k], v)
        elif isinstance(v, list) and k in d1 and isinstance(d1[k], list):
            # Unique merge for lists
            seen = {
                json.dumps(item, sort_keys=True, default=str)
                if isinstance(item, dict)
                else str(item).lower().strip()
                for item in d1[k]
            }
            for item in v:
                item_key = (
                    json.dumps(item, sort_keys=True, default=str)
                    if isinstance(item, dict)
                    else str(item).lower().strip()
                )
                if item_key not in seen:
                    d1[k].append(item)
                    seen.add(item_key)
        else:
            # Overwrite only if v is meaningful (Guardrail 1)
            if v not in (None, "", [], {}):
                d1[k] = v
    return d1


def merge_extracted(current_state: dict, extracted: dict) -> dict:
    """
    Merge extracted data into current state with STRICT non-destructive guardrails.

    Rules:
    - Never overwrite existing value with None/Empty
    - Deep merge workflows and qualifications
    - Unique-append for lists (tasks, tools, skills)
    """
    import json

    merged = dict(current_state)

    for key, value in extracted.items():
        # GUARDRAIL 1: Never overwrite meaningful data with empty values
        if value in (None, "", [], {}):
            continue

        existing = merged.get(key)

        # Handle specific complex merges
        if isinstance(value, list) and isinstance(existing, list):
            # Unique-append merge
            seen = set()
            result = []
            # Add existing first
            for item in existing:
                item_key = (
                    json.dumps(item, sort_keys=True, default=str)
                    if isinstance(item, dict)
                    else str(item).lower().strip()
                )
                if item_key not in seen:
                    seen.add(item_key)
                    result.append(item)
            # Add new ones
            for item in value:
                item_key = (
                    json.dumps(item, sort_keys=True, default=str)
                    if isinstance(item, dict)
                    else str(item).lower().strip()
                )
                if item_key not in seen:
                    seen.add(item_key)
                    result.append(item)
            merged[key] = result

        elif isinstance(value, dict) and isinstance(existing, dict):
            # Recursive deep merge
            merged[key] = _deep_merge_dict(dict(existing), value)
        else:
            # Atomic overwrite (only because we already checked for empty 'value')
            merged[key] = value

    return merged


# ── Confidence Scoring ──────────────────────────────────────────────────────


def calculate_confidence(field: str, value: Any, context: str) -> float:
    """
    Calculate confidence score for extracted data (0.0 to 1.0).

    Higher confidence = more likely to be correct without confirmation.
    """
    if not value:
        return 0.0

    confidence = 0.5  # Base confidence

    if field == "role":
        # Higher confidence if it's a recognized title pattern
        if isinstance(value, str):
            if any(
                title in value.lower()
                for title in ["engineer", "developer", "manager", "analyst", "lead"]
            ):
                confidence = 0.8
            if len(value) > 3 and len(value) < 50:
                confidence += 0.1

    elif field == "tasks":
        if isinstance(value, list):
            # Higher confidence for detailed descriptions
            detailed_count = sum(
                1
                for t in value
                if isinstance(t, dict) and len(t.get("description", "")) > 15
            )
            if detailed_count > 0:
                confidence = 0.7 + min(0.3, detailed_count * 0.05)

    elif field == "tools":
        if isinstance(value, list):
            # Higher confidence for specific tool names
            known_tools = {
                "python",
                "java",
                "javascript",
                "docker",
                "aws",
                "azure",
                "jira",
                "git",
            }
            known_count = sum(1 for t in value if t.lower() in known_tools)
            confidence = 0.6 + min(0.4, known_count / max(len(value), 1))

    elif field == "purpose":
        if isinstance(value, str) and len(value) > 30:
            confidence = 0.7
        if len(value) > 50:
            confidence = 0.8

    return min(confidence, 1.0)


def serialize_insights(insights: dict) -> str:
    """
    Standardize serialization of insights for LLM prompts.
    Provides a clean, human-readable view of the current state.
    """
    # Create a copy to avoid modifying the original
    # SCRUBBING: Remove conversational metadata to prevent LLM leaks
    excluded_keys = {
        "next_question",
        "conversation_summary",
        "agent_turn_counts",
        "agent_stall_counts",
        "completed_phases",
        "agent_transition_log",
        "final_jd",
    }
    view = {
        k: v
        for k, v in insights.items()
        if not k.startswith("_")
        and k not in excluded_keys
        and v not in (None, {}, [], "")
    }

    # Format specific fields for better readability
    if "tasks" in view and isinstance(view["tasks"], list):
        formatted_tasks = []
        for t in view["tasks"]:
            if isinstance(t, dict):
                desc = t.get("description", "Unknown task")
                freq = t.get("frequency", "regular")
                formatted_tasks.append(f"{desc} ({freq})")
            else:
                formatted_tasks.append(str(t))
        view["tasks"] = formatted_tasks

    return json.dumps(view, indent=2)
