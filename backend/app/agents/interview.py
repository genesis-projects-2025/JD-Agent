# backend/app/agents/interview.py
"""
Interview Engine — The core interview logic.

Contains:
  1. InterviewEngine class — shared logic for sync and streaming
  2. interview_node() — LangGraph node wrapper
  3. Message building with agent-specific prompts + shared memory
  4. Response validation — ensures every response ends with a question
  5. Question deduplication — prevents asking the same question twice
  6. Agent transition detection — smooth bridging between agents
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import re
import time
from typing import AsyncIterator

from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.messages import (
    SystemMessage,
    HumanMessage,
    AIMessage,
)

from app.core.config import settings
from app.agents.state import AgentState
from app.agents.dynamic_prompts import (
    build_system_messages,
    _strip_leading_acknowledgment,
    _get_structured_phase_message,
)
from app.agents.prompts import JD_GENERATION_PROMPT
from app.core.langfuse_client import get_compiled_prompt
from app.core.llm_throttle import throttled_ainvoke, throttled_astream

logger = logging.getLogger(__name__)


def _extract_text_content(content) -> str:
    """Extract plain text from Gemini's response content and strip tool leaks.

    With bind_tools(), Gemini returns content as a LIST of dicts:
      [{'type': 'text', 'text': 'actual response...', 'extras': {...}}]
    instead of a plain string. This helper normalizes both formats.
    """
    if content is None:
        return ""
    if isinstance(content, str):
        return _strip_tool_code_leaks(content)
    if isinstance(content, list):
        text_parts = []
        for part in content:
            if isinstance(part, dict):
                text_parts.append(part.get("text", ""))
            elif isinstance(part, str):
                text_parts.append(part)
        return _strip_tool_code_leaks(" ".join(text_parts))
    return _strip_tool_code_leaks(str(content))


# ── Question Deduplication (Semantic + Hash) ──────────────────────────────────

# Stop words for keyword extraction
_STOP_WORDS = {
    "a",
    "an",
    "the",
    "is",
    "are",
    "was",
    "were",
    "be",
    "been",
    "being",
    "have",
    "has",
    "had",
    "do",
    "does",
    "did",
    "will",
    "would",
    "could",
    "should",
    "may",
    "might",
    "shall",
    "can",
    "need",
    "dare",
    "to",
    "of",
    "in",
    "for",
    "on",
    "with",
    "at",
    "by",
    "from",
    "as",
    "into",
    "about",
    "like",
    "through",
    "after",
    "over",
    "between",
    "out",
    "against",
    "during",
    "without",
    "before",
    "under",
    "around",
    "among",
    "and",
    "but",
    "or",
    "nor",
    "not",
    "so",
    "yet",
    "both",
    "either",
    "neither",
    "each",
    "every",
    "all",
    "any",
    "few",
    "more",
    "most",
    "other",
    "some",
    "such",
    "no",
    "only",
    "own",
    "same",
    "than",
    "too",
    "very",
    "just",
    "because",
    "if",
    "when",
    "while",
    "where",
    "how",
    "what",
    "which",
    "who",
    "whom",
    "this",
    "that",
    "these",
    "those",
    "i",
    "me",
    "my",
    "you",
    "your",
    "we",
    "our",
    "they",
    "them",
    "their",
    "it",
    "its",
    "also",
    "tell",
    "please",
    "let",
    "us",
    "know",
    "think",
    "sure",
    # Domain & Interview Generic Terms (prevent false positive dupe matches)
    "role",
    "job",
    "task",
    "tasks",
    "work",
    "responsibilities",
    "responsibility",
    "daily",
    "regular",
    "company",
    "team",
    "department",
    "main",
    "primary",
    "describe",
    "share",
    "details",
    "detail",
    "project",
    "projects",
    "process",
    "processes",
    "provide",
    "used",
    "using",
    "uses",
    "another",
    "other",
    "good",
    "help",
    "make",
    "makes",
}


def _extract_keywords(text: str) -> set:
    """Extract meaningful keywords from text, removing stop words."""
    words = re.findall(r"[a-z]+", text.lower())
    return {w for w in words if w not in _STOP_WORDS and len(w) > 2}


def _compute_question_hash(question_text: str) -> str:
    """Compute a normalized hash of a question for deduplication."""
    normalized = question_text.lower().strip()
    for word in [
        "could you",
        "can you",
        "please",
        "would you",
        "tell me",
        "i'd love to",
        "i'd like to",
        "let's",
        "shall we",
    ]:
        normalized = normalized.replace(word, "")
    normalized = " ".join(normalized.split())
    return hashlib.md5(normalized.encode()).hexdigest()[:12]


def _is_question_repeated(
    question_text: str, questions_asked: list, previous_questions_text: list | None = None
) -> bool:
    """Check if question has been asked using hash match + semantic keyword overlap.

    Two-layer check:
      1. Hash match (fast) — exact normalized match
      2. Keyword overlap (semantic) — >70% keyword overlap with any previous question
    """
    if not questions_asked:
        return False

    # Layer 1: Hash match
    q_hash = _compute_question_hash(question_text)
    if q_hash in questions_asked:
        return True

    # Layer 2: Keyword overlap (only if we have previous question texts)
    if previous_questions_text:
        new_keywords = _extract_keywords(question_text)
        if not new_keywords:
            return False
        for prev_q in previous_questions_text[-10:]:  # Check last 10 questions
            prev_keywords = _extract_keywords(prev_q)
            if not prev_keywords:
                continue
            overlap = len(new_keywords & prev_keywords)
            max_possible = max(1, min(len(new_keywords), len(prev_keywords)))
            # Require >= 70% overlap of specific content keywords to flag as duplicate
            if (overlap / max_possible) >= 0.90:
                logger.debug(
                    f"  [DEDUP] ⚠ Semantic overlap detected ({overlap}/{max_possible} keywords)"
                )
                return True

    return False


# ── Response Validation ───────────────────────────────────────────────────────


def _ensure_ends_with_question(
    response_text: str, agent_name: str, insights: dict, progress: dict
) -> str:
    """Ensure the response ends with a question mark.

    If the LLM forgot to ask a question (or returned empty text), append
    or return a contextually relevant one based on the current agent.
    """
    fallback_questions = {
        "BasicInfoAgent": _get_basic_info_fallback_question(insights),
        "WorkflowIdentifierAgent": "Of all the tasks we discussed, which 3-5 would you say have the biggest business impact?",
        "DeepDiveAgent": _get_workflow_fallback_question(insights),
        "ToolsAgent": "What key tools or software do you rely on?",
        "SkillsAgent": "What underlying technical skills do you use for these tasks?",
        "QualificationAgent": "What education or certifications are required for this role?",
    }
    fallback = fallback_questions.get(agent_name, "Could you tell me more about that?")

    if not response_text or not response_text.strip():
        logger.warning(
            f"  [VALIDATE] ⚠ Empty response detected! Using pure fallback (agent={agent_name})"
        )
        return fallback

    stripped = response_text.strip()

    # JDGeneratorAgent doesn't need to end with a question — it's the final stage
    if agent_name == "JDGeneratorAgent":
        return response_text

    # Check if the response already contains a question ANYWHERE inside of it
    if "?" in stripped:
        return response_text

    logger.info(
        f"  [VALIDATE] ✗ Response does NOT end with a question! Appending fallback (agent={agent_name})"
    )

    if stripped.endswith((".", "!", ",", "-")):
        return f"{stripped} {fallback}"
    return f"{stripped}. {fallback}"


def _get_basic_info_fallback_question(insights: dict) -> str:
    """Generate a contextual fallback question for the BasicInfoAgent."""
    if not insights.get("purpose"):
        return "What is the main goal or value that your role provides to the company?"
    if not insights.get("tasks"):
        return "What are the most important things you do on a regular basis?"
    return "Are there any other important parts of your job that we should include?"


def _get_task_fallback_question(insights: dict) -> str:
    """Generate a contextual fallback question for the TaskAgent."""
    tasks = insights.get("tasks") or []
    count = len(tasks)
    if count == 0:
        return "What are the core tasks that take up most of your time at work?"
    elif count < 4:
        return f"Besides the {count} tasks we've noted, are there any other important parts of your role?"
    return "Is there anything else you do that is important for your job's success?"


def _get_workflow_fallback_question(insights: dict) -> str:
    """Generate a contextual fallback question for the DeepDiveAgent."""
    active_task = insights.get("active_deep_dive_task", "")
    completed = insights.get("_completed_task", "")

    if completed and active_task:
        return f"Since we have everything for '{completed}', how do you normally execute '{active_task}'?"
    elif completed and not active_task:
        return "Now that we've covered all your priority tasks, what technical tools do you use?"
    elif active_task:
        return f"Could you walk me through the main steps and tools you use for the task '{active_task}'?"
    return "What other important steps should we note?"


def _strip_tool_code_leaks(text: str) -> str:
    """Remove occasional LLM hallucinations where it leaks code blocks, python tool calls, internal thoughts, or tab escape artifacts into response text."""
    if not text:
        return ""

    # Strip literal tab escape sequences, escaped tabs, or /t/t/t/ artifacts
    text = re.sub(r"(?:/[tT]|\\t|\t)+/?", " ", text)

    # 1. Strip LLM internal chain-of-thought / reasoning leaks (<thought>...</thought> or thought\nThe user has provided...)
    text = re.sub(r"<thought>[\s\S]*?</thought>", "", text, flags=re.IGNORECASE)
    text = re.sub(
        r"^\s*(?:thought|thinking)\b[\s\S]*?(?=\b(?:When|How|What|Since|Can|Could|Please|Would|In|To|For|As|Tell|Share|Describe|Details|Based|Now|Let|So|First)\b|\Z)",
        "",
        text,
        flags=re.IGNORECASE
    )
    text = re.sub(r"^\s*(?:thought|thinking):\s*.*$", "", text, flags=re.IGNORECASE | re.MULTILINE)

    # 2. Strip tool execution meta-text explanations (e.g. "save these tasks using the save_tasks tool. The save_tasks tool requires...")
    text = re.sub(
        r"(?:save|using)\s+these\s+[a-z_]+\s+using\s+the\s+`?save_[a-z_]+`?\s+tool[\s\S]*?(?=\b(?:When|How|What|Since|Can|Could|Please|Would|In|To|For|As|Tell|Share|Describe|Details|Based|Now|Let|So|First)\b|\Z)",
        "",
        text,
        flags=re.IGNORECASE
    )
    text = re.sub(
        r"The\s+`?save_[a-z_]+`?\s+tool\s+requires[\s\S]*?(?=\b(?:When|How|What|Since|Can|Could|Please|Would|In|To|For|As|Tell|Share|Describe|Details|Based|Now|Let|So|First)\b|\Z)",
        "",
        text,
        flags=re.IGNORECASE
    )
    text = re.sub(
        r"The\s+provided\s+(?:priority\s+)?tasks\s+are:\s*(?:-\s*[\w\s\(\)&-/\.]+:?\s*)?(?=\b(?:When|How|What|Since|Can|Could|Please|Would|In|To|For|As|Tell|Share|Describe|Details|Based|Now|Let|So|First)\b|\Z)",
        "",
        text,
        flags=re.IGNORECASE
    )

    # 3. Strip python / pseudo-code tool execution: tool_code print(default_api.save_workflow(...))
    text = re.sub(
        r"(?:tool_code\s*)?(?:print\s*\(\s*)?default_api\.[a-zA-Z0-9_]+\s*\([\s\S]*?\)(?:\s*\))?",
        "",
        text,
        flags=re.IGNORECASE
    )

    # 4. Aggressive stripping for {"tool_code"...} or {"name": "save...}
    text = re.sub(
        r'\{[^{]*?"tool_code"[^{]*?\}', "", text, flags=re.IGNORECASE | re.DOTALL
    )
    text = re.sub(
        r'\{[^{]*?"name":\s*"save_[^{]*?\}', "", text, flags=re.IGNORECASE | re.DOTALL
    )

    # 5. Strip any code blocks (python, json, generic)
    text = re.sub(
        r"```(?:python|json)?\s*[\s\S]*?```",
        "",
        text,
        flags=re.IGNORECASE | re.DOTALL,
    )

    # 6. Strip leftover tool call tokens
    text = re.sub(r"\btool_code\b", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\btools_used\b", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\bsave_tasks\b", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\bsave_workflow\b", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\bsave_basic_info\b", "", text, flags=re.IGNORECASE)

    # 7. Extract the last clean question if preceded by broken task fragments
    # e.g., "- Financial Planning & Analysis (FP&A): What makes you start working on 'Reconcile. Could you walk me through..."
    if re.search(r"\b(?:Could|How|What|When|Can|Please|Would)\b", text):
        match = re.search(r"((?:Could|How|What|When|Can|Please|Would)\s+(?:you|does|is|are|do|we)\b[\s\S]+)", text)
        if match:
            text = match.group(1)

    # 8. Clean up duplicate question prefixes when a transition occurs
    if "Since we have everything for" in text:
        match = re.search(r"(Since we have everything for [\s\S]+)", text, flags=re.IGNORECASE)
        if match:
            text = match.group(1)

    # Clean up excessive whitespace — preserve newlines for readable formatting
    text = re.sub(r"[^\S\n]+", " ", text)  # Collapse horizontal spaces/tabs only, NOT newlines
    text = re.sub(r"\n{3,}", "\n\n", text)  # Collapse 3+ consecutive newlines to double newline
    text = text.replace("} .", ".").replace("}.", ".").replace(" .", ".")
    text = text.replace("! .", "!").replace("? .", "?")
    text = text.replace("!.", "!").replace("?.", "?")

    return text.strip()


def _trim_duplicate_response(response_text: str) -> str:
    """Detect and trim duplicate/runaway responses.

    The LLM sometimes generates multiple "turns" in a single response.
    This function detects and trims to keep only the first complete response.
    
    IMPORTANT: We preserve context + question pairs. Only trim when there
    are clearly multiple separate response turns (4+ paragraphs with
    questions spread far apart).
    """
    if not response_text or not response_text.strip():
        return response_text

    text = response_text.strip()

    # Strategy 1: Detect transition phrases that signal a "second response"
    # These markers indicate the LLM started a second turn within one response.
    transition_markers = [
        "Okay, that gives us",
        "Okay, that's a great",
        "Now that I understand",
        "Now that I have",
        "Now that we have",
        "Now, let's dive",
        "Now let's dive",
        "Now, moving on",
        "Great, now let",
        "Perfect, now let",
        "Excellent, now let",
        "With that in mind",
        "Building on that",
        "That said, let",
    ]

    for marker in transition_markers:
        idx = text.lower().find(marker.lower())
        if idx > 0:
            before = text[:idx].strip()
            if "?" in before:
                logger.info(
                    f"  [TRIM] ✓ Found transition '{marker}' after question. Trimming."
                )
                return before

    # Strategy 2: If 3+ questions are spread across distant paragraphs, keep only up to the first
    # (Two questions close together are fine — context + question is a valid pattern)
    question_positions = [m.start() for m in re.finditer(r"\?", text)]
    if len(question_positions) >= 3:
        # If questions are far apart with paragraph breaks, likely a runaway response
        if "\n\n" in text[question_positions[0] : question_positions[2]]:
            return text[: question_positions[1] + 1].strip()

    return text


def _truncate_if_too_long(response_text: str) -> str:
    """If the response is excessively long (>90 words), try to trim it."""
    words = response_text.split()
    if len(words) <= 90:
        return response_text

    logger.info(
        f"  [VALIDATE] ⚠ Response is {len(words)} words (target: <90). Trimming."
    )

    sentences = re.split(r"(?<=[.!?])\s+", response_text.strip())
    if len(sentences) <= 3:
        return response_text

    # Keep first 2 sentences + last sentence (the question)
    trimmed = " ".join(sentences[:2]) + " " + sentences[-1]
    return trimmed


def _normalize_agent_response(
    response_text: str,
    agent_name: str,
    insights: dict,
    is_opening_turn: bool,
) -> str:
    """Apply the shared post-generation validation pipeline."""
    normalized = _strip_tool_code_leaks(response_text)
    normalized = _strip_leading_acknowledgment(
        normalized,
        preserve_first_turn_greeting=is_opening_turn,
    )
    normalized = _trim_duplicate_response(normalized)
    normalized = _truncate_if_too_long(normalized)
    normalized = _ensure_ends_with_question(normalized, agent_name, insights, {})
    return normalized.strip()


# ── LLM Instances ─────────────────────────────────────────────────────────────

# Primary interview LLM — handles conversational question generation and streaming.
from app.agents.tools import INTERVIEW_TOOLS, merge_tool_call_into_insights

# Primary interview LLM — handles conversational question generation and streaming.
_interview_llm = ChatGoogleGenerativeAI(
    google_api_key=settings.GEMINI_API_KEY,
    model="gemini-2.5-flash",
    temperature=0.4,
    max_output_tokens=350,
).bind_tools(
    INTERVIEW_TOOLS
)  # CRITICAL: Bind the tools directly to the conversational LLM
# Dedup retry LLM — used only when a question is detected as repeated.
_response_llm = ChatGoogleGenerativeAI(
    google_api_key=settings.GEMINI_API_KEY,
    model="gemini-2.5-flash",
    temperature=0.2,
    max_output_tokens=350,
)

# Add this near your other LLM instances (e.g., below _response_llm)
_json_llm = ChatGoogleGenerativeAI(
    google_api_key=settings.GEMINI_API_KEY,
    model="gemini-2.5-flash",
    temperature=0.2,
    max_output_tokens=800,
    response_mime_type="application/json",  # Forces strict JSON
)


async def _invoke_with_retry(llm, messages, max_retries=2, **kwargs):
    """Invoke LLM with exponential backoff on transient failures and real-time observability logging."""
    start_t = time.perf_counter()
    config = kwargs.get("config") or ({"callbacks": kwargs["callbacks"]} if "callbacks" in kwargs and kwargs["callbacks"] else None)
    for attempt in range(max_retries + 1):
        try:
            res = await throttled_ainvoke(llm, messages, config=config)
            latency_ms = (time.perf_counter() - start_t) * 1000

            prompt_tokens = 0
            completion_tokens = 0
            if hasattr(res, "response_metadata") and isinstance(res.response_metadata, dict):
                usage = res.response_metadata.get("usage_metadata") or res.response_metadata.get("token_usage") or {}
                prompt_tokens = usage.get("prompt_token_count") or usage.get("input_tokens") or 0
                completion_tokens = usage.get("candidates_token_count") or usage.get("output_tokens") or 0

            if not prompt_tokens:
                prompt_text = " ".join(str(m.content) for m in messages)
                prompt_tokens = len(prompt_text) // 4
            if not completion_tokens:
                completion_tokens = len(str(res.content)) // 4

            session_id = kwargs.get("session_id")
            agent_name = kwargs.get("agent_name", "InterviewEngine")
            call_type = kwargs.get("call_type", "question_gen")

            from app.services.token_observability_service import log_llm_call
            full_prompt_str = "\n---\n".join(f"{getattr(m, 'type', 'message')}: {m.content}" for m in messages) if messages else ""
            full_response_str = str(res.content) if res else ""
            asyncio.create_task(
                log_llm_call(
                    session_id=session_id,
                    agent_name=agent_name,
                    call_type=call_type,
                    model_name=getattr(llm, "model", "gemini-2.5-flash"),
                    prompt_tokens=prompt_tokens,
                    completion_tokens=completion_tokens,
                    latency_ms=latency_ms,
                    user_message_snippet=str(messages[-1].content)[:300] if messages else "",
                    prompt_preview=str(messages[-1].content)[:200] if messages else "",
                    response_preview=full_response_str[:200],
                    full_prompt=full_prompt_str,
                    full_response=full_response_str,
                )
            )
            return res
        except Exception as e:
            err = str(e).lower()
            is_retryable = "429" in err or "500" in err or "resource_exhausted" in err
            if is_retryable and attempt < max_retries:
                wait = 2**attempt
                logger.warning(
                    f"LLM retry {attempt + 1}/{max_retries} after {wait}s: {e}"
                )
                await asyncio.sleep(wait)
            else:
                raise


# ── Message Building ──────────────────────────────────────────────────────────


def _compact_insights(insights: dict) -> dict:
    """Return only non-empty fields for context injection."""
    if not isinstance(insights, dict):
        return {}
    return {k: v for k, v in insights.items() if v not in (None, {}, [], "")}

# Context filtering logic to determine what information to inject into the prompt for each agent.
def _apply_context_filter(insights: dict, agent_name: str) -> dict:
    """Provides the agent with access to relevant data while prioritizing their mission.

    CRITICAL: Relaxed filtering ensures the agent is aware of EVERYTHING
    collected so far, preventing repetitive questioning across silos.
    
    TOKEN OPTIMIZATION: Returns compacted insights to reduce token usage.
    Earlier phases get full details; later phases get summaries.
    """
    if not isinstance(insights, dict):
        return {}
    
    result = {}
    
    # Always include identity and basic info (small, critical)
    for key in ["identity_context", "role", "department"]:
        if key in insights:
            result[key] = insights[key]
    
    # BasicInfoAgent and WorkflowIdentifierAgent need full task details
    if agent_name in ["BasicInfoAgent", "WorkflowIdentifierAgent"]:
        for key in ["purpose", "tasks", "priority_tasks"]:
            if key in insights:
                result[key] = insights[key]
    
    # DeepDiveAgent needs workflow details
    elif agent_name == "DeepDiveAgent":
        for key in ["purpose", "tasks", "priority_tasks", "workflows", "visited_tasks"]:
            if key in insights:
                result[key] = insights[key]
    
    # Later agents get summaries of earlier work to save tokens
    else:
        # Summarize purpose (truncate if too long)
        if "purpose" in insights:
            purpose = insights["purpose"]
            if len(purpose) > 100:
                result["purpose"] = purpose[:100] + "..."
            else:
                result["purpose"] = purpose
        
        # Summarize tasks (limit count)
        if "tasks" in insights:
            tasks = insights["tasks"]
            if len(tasks) > 6:
                result["task_count"] = len(tasks)
                result["tasks"] = tasks[:3]  # Only first 3
            else:
                result["tasks"] = tasks
        
        if "priority_tasks" in insights:
            result["priority_tasks"] = insights["priority_tasks"]
        
        if "workflows" in insights:
            workflows = insights["workflows"]
            result["workflow_count"] = len(workflows)
        
        # Tools, skills, qualifications - always include full (needed for these phases)
        for key in ["tools", "technologies", "skills", "qualifications"]:
            if key in insights:
                result[key] = insights[key]
    
    return result

# this function is used to build the identity block for the prompt, which provides pre-filled employee information that the agent can use without asking the user again. It extracts relevant fields from the insights and formats them into a clear block of text.
def _build_identity_block(insights: dict) -> str:
    """Build pre-filled identity context block."""
    identity = insights.get("identity_context") or {}
    if not identity:
        return ""
    lines = ["PRE-FILLED EMPLOYEE INFORMATION (already known — do NOT ask again):"]
    field_map = {
        "employee_name": "Employee Name",
        "title": "Job Title / Designation",
        "department": "Department",
        "location": "Location",
        "reports_to": "Reports To",
    }
    for key, label in field_map.items():
        val = identity.get(key)
        if val:
            lines.append(f"  - {label}: {val}")
    if len(lines) <= 1:
        return ""
    lines.append("\nDo NOT ask the user for any of the above fields.")
    return "\n".join(lines)


def build_interview_messages(
    agent_name: str,
    insights: dict,
    recent_messages: list,
    user_message: str,
    transition_context: str = "",
    **kwargs,
) -> list:
    """Build the LLM message stack for the current agent using dynamic prompting.

    HARDENING: If user_message is empty (common in automated transitions),
    we provide a default instruction to avoid the Gemini API error 'contents are required'.
    """
    messages = []
    is_first_turn = not recent_messages

    # 1. Generate the Master System Prompt (Persona + State + Mission)
    retrieved_context = kwargs.get("retrieved_context", [])
    previous_questions_text = kwargs.get("previous_questions_text") or []
    
    # Extract recent questions to pass to prompt for explicit anti-repetition
    recent_questions = []
    
    # 1a. Seed with all actual question texts from the session memory (cross-phase)
    for q_text in previous_questions_text:
        if q_text and q_text.strip() and q_text.strip() not in recent_questions:
            recent_questions.append(q_text.strip())

    # 1b. Extract from recent messages sliding window as fallback/supplement
    for msg in recent_messages[-10:]:
        if msg.get("role") == "assistant":
            content = msg.get("content", "")
            if "{" in content and "}" in content:
                try:
                    parsed = json.loads(content)
                    content = parsed.get("next_question") or parsed.get("question") or content
                except Exception:
                    pass
            if content and content.strip():
                clean_content = content.strip()
                if clean_content not in recent_questions:
                    recent_questions.append(clean_content)

    from app.agents.dynamic_prompts import build_split_system_messages

    static_content, dynamic_content = build_split_system_messages(
        phase=agent_name,
        insights=insights,
        rag_context=retrieved_context,
        transition_context=transition_context,
        is_first_turn=is_first_turn,
        recent_questions=recent_questions,
    )

    # 1. Append Static System Message (for Gemini implicit context caching)
    messages.append(SystemMessage(content=static_content))

    # 2. Append Dynamic System Message (context/memory state change)
    messages.append(SystemMessage(content=dynamic_content))

    # 2. Append recent history (Conversational Context)
    # OPTIMIZATION: Truncate history to the last 6 messages.
    # Global memory is safely stored in the `insights` dictionary,
    # so keeping the raw transcript small speeds up response times.
    for msg in recent_messages[-6:]:
        role = msg.get("role")
        content = msg.get("content", "")
        if not content or not content.strip():
            continue

        if role == "user":
            messages.append(HumanMessage(content=content))
        else:
            # Strip tool call JSON if present, keep ONLY the clean question text
            text = content
            if "{" in content and "}" in content:
                try:
                    parsed = json.loads(content)
                    if isinstance(parsed, dict):
                        q = parsed.get("next_question") or parsed.get("question")
                        if q and str(q).strip():
                            text = str(q).strip()
                        else:
                            text = "[Question asked]"
                except Exception:
                    pass
            # HARDENING: Never append an AIMessage with empty content or massive JSON
            if text and text.strip():
                messages.append(AIMessage(content=text))

    # 3. Final instruction for current turn
    # HARDENING: Use a generic prompt if the user message is empty to avoid crashing the LLM.
    if not user_message or not user_message.strip():
        user_message = "[User confirmed. Please proceed with the next strategic question based on your mission.]"

    messages.append(HumanMessage(content=user_message))

    return messages


SILENT_AGENTS = {
    "WorkflowIdentifierAgent",
    "ToolsAgent",
    "SkillsAgent",
    "JDGeneratorAgent",
}


def _get_silent_agent_response(agent_name: str, insights: dict) -> str:
    """Return structured, non-LLM copy for UI-driven phases."""
    return _get_structured_phase_message(agent_name, insights)


class InterviewEngine:
    """Core interview logic — usable via LangGraph or directly for streaming."""

    async def _get_rag_context(self, insights: dict, agent_name: str) -> list[str]:
        """Surgically retrieve relevant JD snippets from Pinecone based on current agent phase."""
        from app.services.vector_service import query_advanced_context

        block_types = {
            "BasicInfoAgent": "role_summary",
            "WorkflowIdentifierAgent": "responsibilities",
            "DeepDiveAgent": [
                "responsibilities",
                "workflow",
                "performance_metrics",
                "projects",
            ],
            "ToolsAgent": ["tools", "workflow"],
            "SkillsAgent": "skills",
            "QualificationAgent": "qualification",
        }
        b_type = block_types.get(agent_name, "role_summary")

        id_ctx = insights.get("identity_context") or {}
        role_title = id_ctx.get("title", "") or insights.get("purpose", "")
        dept = id_ctx.get("department")

        exp_level = "Mid"
        title_lower = str(role_title).lower()
        if any(
            k in title_lower
            for k in ["junior", "associate", "trainee", "entry", "intern"]
        ):
            exp_level = "Junior"
        elif any(
            k in title_lower for k in ["senior", "sr.", "lead", "staff", "architect"]
        ):
            exp_level = "Senior"
        elif any(k in title_lower for k in ["manager", "head", "director", "vp"]):
            exp_level = "Expert"

        return await query_advanced_context(
            role_query=role_title,
            block_type=b_type,
            experience_level=exp_level,
            department=dept or "",
            top_k=5,
        )

    async def _auto_populate_priority_tasks(self, insights: dict, rag_context: list[str], user_message: str) -> dict:
        """Dynamically synthesize priority tasks directly from the user's raw message + RAG."""
        # If user already confirmed priority tasks, don't touch them
        if len(insights.get("priority_tasks", [])) >= 3:
            return insights

        target_role = (insights.get("identity_context") or {}).get("title", "this role")
        dept_name = (insights.get("identity_context") or {}).get("department", "")
        purpose = insights.get("purpose", "")
        
        # 1. Check if the Extraction Engine already gave us tasks
        existing_tasks = []
        for t in insights.get("tasks", []):
            if isinstance(t, dict):
                desc = t.get("description", "").strip()
                if desc:
                    existing_tasks.append(desc)
            elif isinstance(t, str) and t.strip():
                existing_tasks.append(t.strip())

        # 2. If we already have >= 5 tasks from the user, format them and return immediately. NO LLM NEEDED.
        if len(existing_tasks) >= 5:
            logger.info(f"[Auto-Populate Tasks] Using {len(existing_tasks)} existing tasks from extraction engine.")
            insights["tasks"] = [{"description": t, "is_suggestion": False} for t in existing_tasks[:10]] # Cap at 10 for UI
            insights["suggested_tasks"] = insights["tasks"]
            return insights

        # 3. If we have fewer than 5 tasks, call LLM to synthesize more from RAG and Purpose
        message_to_parse = user_message if user_message and len(user_message) > 10 else purpose

        prompt = f"""You are an expert HR Architect. Generate a clean list of exactly 5 to 7 priority tasks for the role of '{target_role}'.
        
        ROLE PURPOSE:
        {purpose}

        USER'S RAW CHAT MESSAGE:
        "{message_to_parse}"

        EXISTING TASKS:
        {json.dumps(existing_tasks)}

        INDUSTRY RAG CONTEXT:
        {json.dumps(rag_context[:2])}

        INSTRUCTIONS:
        1. Read the USER'S RAW CHAT MESSAGE carefully. The user might have written long paragraphs about risks, outcomes, or daily work.
        2. Your job is to DECOMPOSE whatever they wrote into 5-7 concrete, actionable professional tasks.
        3. For example, if they wrote "Cash Flow Paralysis: Collections would slow down", generate a task like "Monitor accounts receivable and manage collections to optimize cash flow".
        4. Merge these with any EXISTING TASKS.
        5. STRICTLY EXCLUDE any tasks from other departments.
        
        Return ONLY a valid JSON array of strings. Do not include any other text.
        Example: ["Task 1", "Task 2", "Task 3"]
        """

        try:
            # Use _response_llm to avoid any NameError if _json_llm wasn't defined
            llm_to_use = _response_llm
            response = await _invoke_with_retry(
                llm_to_use, [HumanMessage(content=prompt)],
                session_id=insights.get("session_id"), agent_name="WorkflowIdentifierAgent", call_type="auto_populate_tasks"
            )
            
            content = str(response.content).strip()
            logger.info(f"[Auto-Populate Tasks] RAW LLM RESPONSE: {content}")
            
            # Aggressively clean the response to ensure it's a valid JSON array
            if "```json" in content:
                content = content.split("```json")[1].split("```")[0].strip()
            elif "```" in content:
                content = content.split("```")[1].split("```")[0].strip()
            
            # If the LLM returned an object instead of an array, extract the array
            if content.startswith("{"):
                data = json.loads(content)
                if isinstance(data, dict):
                    # Look for the first list value in the dict
                    for v in data.values():
                        if isinstance(v, list):
                            content = json.dumps(v)
                            break
            
            new_tasks = json.loads(content)
            
            if isinstance(new_tasks, list) and len(new_tasks) > 0:
                insights["tasks"] = [{"description": t, "is_suggestion": False} for t in new_tasks]
                insights["suggested_tasks"] = insights["tasks"]
                logger.info(f"[Auto-Populate Tasks] Successfully generated {len(new_tasks)} tasks.")
            else:
                # Fallback to existing tasks, DO NOT overwrite with default if we have any data
                if existing_tasks:
                    insights["tasks"] = [{"description": t, "is_suggestion": False} for t in existing_tasks]
                else:
                    insights["tasks"] = [{"description": f"Manage core {target_role} responsibilities", "is_suggestion": False}]
                insights["suggested_tasks"] = insights["tasks"]
        except Exception as e:
            logger.error(f"[Auto-Populate Tasks] Failed: {e}")
            # CRITICAL FIX: If LLM fails, fallback to existing tasks instead of overwriting with default
            if existing_tasks:
                insights["tasks"] = [{"description": t, "is_suggestion": False} for t in existing_tasks]
            else:
                insights["tasks"] = [{"description": f"Manage core {target_role} responsibilities", "is_suggestion": False}]
            insights["suggested_tasks"] = insights["tasks"]

        return insights
    async def _auto_populate_inventory(
        self, insights: dict, agent_name: str, rag_context: list[str]
    ) -> dict:
        """Automatically populate tools/skills using ALL context (Purpose, Tasks, Workflows, RAG)."""
        if agent_name not in ["ToolsAgent", "SkillsAgent"]:
            return insights

        field = "tools" if agent_name == "ToolsAgent" else "skills"
        existing = insights.get(field) or []

        if len(existing) >= 8:
            return insights

        logger.info(f"[Auto-Populate] Generating {field} from ALL context...")

        # Gather all available context
        purpose = insights.get("purpose", "")
        raw_tasks = [
            t.get("description", str(t)) if isinstance(t, dict) else str(t)
            for t in insights.get("tasks", [])
        ]
        workflows = insights.get("workflows") or {}

        workflow_texts = []
        for task, wf in workflows.items():
            wf_tools = wf.get("tools") or ""
            wf_steps = wf.get("steps") or ""
            if isinstance(wf_steps, list):
                wf_steps = ", ".join([str(s) for s in wf_steps[:3]])
            workflow_texts.append(
                f"Task: {task} | Tools: {wf_tools} | Steps: {wf_steps}"
            )

        context_text = (
            f"PURPOSE: {purpose}\n"
            f"TASKS: {', '.join(raw_tasks)}\n\n"
            f"WORKFLOWS:\n" + "\n".join(workflow_texts[:5]) + "\n\n"
            f"RAG CONTEXT:\n" + "\n".join(rag_context[:2])
        )

        target_role = (insights.get("identity_context") or {}).get("title", "this role")
        dept_name = (insights.get("identity_context") or {}).get("department", "")

        if field == "tools":
            criteria_text = """CRITICAL CRITERIA FOR 'TOOLS':
        1. ONLY include actual software, platforms, hardware, or specific technical instruments.
        2. STRICTLY EXCLUDE soft skills, concepts, or frameworks."""
        else:
            criteria_text = """CRITICAL CRITERIA FOR 'SKILLS':
        1. ONLY include technical competencies, hard domain skills, and specialized functional expertise.
        2. STRICTLY EXCLUDE soft skills and pure software/tool names.
        3. CLEAN UP BAD DATA: The RAG context may contain poorly formatted strings split by "and" (e.g., "Budgeting, And forecasting"). You MUST merge these into a single, clean, professional string (e.g., "Budgeting & Forecasting"). Do not include the word "And" as a separate item."""

        prompt = f"""Extract a concise list of the most relevant {field} for the role of '{target_role}' from the context below.
        
        CONTEXT:
        {context_text}
        
        {criteria_text}
        
        Respond with ONLY a JSON list of strings, e.g. ["Item 1", "Item 2"]. 
        If no specific {field} are mentioned or implied, return an empty list [].
        """

        try:
            response = await _invoke_with_retry(
                _interview_llm,
                [HumanMessage(content=prompt)],
                session_id=insights.get("session_id"),
                agent_name=agent_name,
                call_type="auto_populate",
            )
            content = str(response.content).strip()
            if "```" in content:
                content = content.split("```")[1]
                if content.startswith("json"):
                    content = content[4:]

            new_items = json.loads(content)
            if isinstance(new_items, list):
                from app.agents.semantic_cleaner import deduplicate_and_professionalize
                from app.agents.validators import separate_tools_and_skills, is_tool

                if field == "tools":
                    raw_merged = list(set(existing) | set(new_items))
                    filtered_tools, _ = separate_tools_and_skills(
                        raw_merged, role_title=target_role
                    )
                    valid_tools = [t for t in filtered_tools if is_tool(t, target_role)]

                    # Fallback domain defaults if fewer than 4 tools
                    if len(valid_tools) < 4:
                        role_title_lower = target_role.lower()
                        dept_lower = (dept_name or "").lower()
                        if any(
                            k in role_title_lower or k in dept_lower
                            for k in [
                                "account",
                                "finance",
                                "billing",
                                "audit",
                                "treasury",
                                "tax",
                            ]
                        ):
                            defaults = [
                                "SAP",
                                "NetSuite",
                                "QuickBooks",
                                "Microsoft Excel",
                                "Power BI",
                                "HighRadius",
                                "Microsoft Teams",
                            ]
                        elif any(
                            k in role_title_lower or k in dept_lower
                            for k in [
                                "software",
                                "developer",
                                "engineer",
                                "tech",
                                "devops",
                                "qa",
                            ]
                        ):
                            defaults = [
                                "VS Code",
                                "Git",
                                "GitHub",
                                "Docker",
                                "Jira",
                                "Postman",
                                "AWS",
                                "Slack",
                            ]
                        elif any(
                            k in role_title_lower or k in dept_lower
                            for k in ["hr", "talent", "recruit", "people"]
                        ):
                            defaults = [
                                "Workday",
                                "BambooHR",
                                "Greenhouse",
                                "ADP",
                                "LinkedIn Recruiter",
                                "Microsoft Teams",
                            ]
                        elif any(
                            k in role_title_lower or k in dept_lower
                            for k in [
                                "sales",
                                "market",
                                "commercial",
                                "business development",
                            ]
                        ):
                            defaults = [
                                "Salesforce",
                                "HubSpot",
                                "LinkedIn Sales Navigator",
                                "ZoomInfo",
                                "Outreach",
                                "Microsoft Excel",
                            ]
                        else:
                            defaults = [
                                "Microsoft Excel",
                                "Microsoft Teams",
                                "Jira",
                                "SAP",
                                "Slack",
                                "Power BI",
                            ]

                        valid_tools = list(set(valid_tools) | set(defaults))

                    insights["tools"] = await deduplicate_and_professionalize(
                        valid_tools,
                        "tools",
                        role_title=target_role,
                        department=dept_name,
                    )
                else:
                    merged = list(set(existing) | set(new_items))
                    insights[field] = await deduplicate_and_professionalize(
                        merged, field, role_title=target_role, department=dept_name
                    )
        except Exception as e:
            logger.error(f"[Auto-Populate] Failed: {e}")

        return insights

    def _pre_process_iteration_state(self, insights: dict, agent_name: str) -> dict:
        """Manage active_deep_dive_task and visited_tasks for iterative workflow.

        STRICT 2+1 TURN PROTOCOL:
        - Turn 1 (compulsory): How the task begins — triggers and inputs.
        - Turn 2 (compulsory): Challenges, quality standards, and expert-level outcomes.
        - Turn 3 (conditional): Only if extraction is incomplete.
        - EXCEPTION: If user provides trigger+steps+output in Turn 1, advance immediately.
        """
        if agent_name != "DeepDiveAgent":
            return insights

        priority_tasks = insights.get("priority_tasks") or []
        visited_tasks = insights.get("visited_tasks") or []
        active_task = insights.get("active_deep_dive_task")
        turn_count = insights.get("deep_dive_turn_count") or 0

        def _mark_visited(task: str) -> None:
            if task and task not in visited_tasks:
                visited_tasks.append(task)
                insights["visited_tasks"] = list(visited_tasks)

        def _is_task_complete(task: str) -> bool:
            """A task is complete if steps AND (trigger OR output) are captured. 
               We relax this so it doesn't loop endlessly if the user gives steps but forgets to mention an output."""
            wf = (insights.get("workflows") or {}).get(task, {})
            has_steps = bool(wf.get("steps"))
            has_trigger = bool(wf.get("trigger"))
            has_output = bool(wf.get("output"))
            
            # If they gave steps, and at least one other piece of info, we can advance.
            return has_steps and (has_trigger or has_output)

        if active_task:
            # CRITICAL FIX: If it's turn 1 but the user already gave us everything, don't force turn 2.
            if turn_count == 1 and _is_task_complete(active_task):
                _mark_visited(active_task)
                insights["_completed_task"] = active_task
                active_task = None
                turn_count = 0
            # Hard ceiling: ALWAYS mark visited after >= 3 turns
            elif turn_count >= 3:
                _mark_visited(active_task)
                insights["_completed_task"] = active_task
                active_task = None
                turn_count = 0
            # After 2 compulsory turns: mark visited ONLY if data is complete
            elif turn_count >= 2 and _is_task_complete(active_task):
                _mark_visited(active_task)
                insights["_completed_task"] = active_task
                active_task = None
                turn_count = 0
            else:
                insights.pop("_completed_task", None)
                turn_count += 1

        # Pick next non-visited priority task (capped to top 5 strategic tasks max)
        if not active_task:
            for pt in priority_tasks[:5]:
                if pt not in (insights.get("visited_tasks") or []):
                    active_task = pt
                    remaining = len(priority_tasks[:5]) - len(visited_tasks)
                    logger.info(
                        f"[DeepDive] Moving to next task: {active_task}. {remaining} remaining."
                    )
                    break

        # If a new active task was picked and turn was reset, start at 1
        if active_task and turn_count == 0:
            turn_count = 1

        insights["deep_dive_turn_count"] = turn_count
        insights["active_deep_dive_task"] = active_task
        return insights

    def _deep_merge_dicts(self, d1: dict, d2: dict) -> dict:
        """Recursively merge d2 into d1."""
        for key, value in d2.items():
            if key in d1 and isinstance(d1[key], dict) and isinstance(value, dict):
                self._deep_merge_dicts(d1[key], value)
            else:
                d1[key] = value
        return d1

    def _normalize_item_text(self, text: str) -> str:
        """Normalize text for semantic deduplication (lowercase, strip, remove extra spaces)."""
        import re

        if not text:
            return ""
        text = text.lower().strip()
        text = re.sub(r"[^a-z0-9\s]", "", text)  # Remove punctuation
        return " ".join(text.split())

    def _merge_extracted_to_insights(
        self, extracted: dict, insights: dict, overwrite: bool = False
    ) -> dict:
        """Consolidated logic to merge newly extracted data into existing session insights.

        HARDENING: Uses the non-destructive merge logic from extraction_engine.
        """
        from app.agents.extraction_engine import merge_extracted

        if overwrite:
            # For synthesis passes where we trust the LLM's full cleanup
            for key, value in extracted.items():
                if value not in (None, "", [], {}):
                    insights[key] = value
            return insights

        # Default: Use the hardened non-destructive logic
        return merge_extracted(insights, extracted)

    def _compress_memory(self, recent_messages: list, turn_count: int) -> list:
        """Compress old messages, keeping the last 16 messages (approx 8 complete turns) for stronger short-term memory."""
        if len(recent_messages) <= 16:
            return recent_messages
        return recent_messages[-16:]

    def _build_conversation_summary(self, insights: dict, agent_name: str) -> str:
        """Build a lightweight rolling summary from collected insights.

        Uses extracted data to synthesize a compressed summary rather than
        making an LLM call, keeping latency at zero.
        """
        parts = []

        # Role context
        identity = insights.get("identity_context") or {}
        title = identity.get("title", "")
        dept = identity.get("department", "")
        if title:
            parts.append(f"Role: {title}")
        if dept:
            parts.append(f"Dept: {dept}")

        # Purpose
        purpose = insights.get("purpose", "")
        if purpose:
            parts.append(f"Mission: {purpose[:80]}")

        # Tasks
        tasks = insights.get("tasks") or []
        if tasks:
            parts.append(f"Tasks collected: {len(tasks)}")

        # Priority tasks
        priorities = insights.get("priority_tasks") or []
        if priorities:
            parts.append(
                f"Priority tasks: {', '.join(str(p)[:25] for p in priorities[:3])}"
            )

        # Workflows
        workflows = insights.get("workflows") or {}
        if workflows:
            completed_wf = [k for k, v in workflows.items() if v.get("output")]
            parts.append(f"Workflows done: {len(completed_wf)}/{len(workflows)}")

        # Tools & Skills
        tools = insights.get("tools") or []
        skills = insights.get("skills") or []
        if tools:
            parts.append(f"Tools: {len(tools)}")
        if skills:
            parts.append(f"Skills: {len(skills)}")

        last_question = str(insights.get("last_question_asked") or "").strip()
        if last_question:
            normalized = " ".join(last_question.split())
            parts.append(f"Last question: {normalized[:90]}")

        parts.append(f"Active agent: {agent_name}")

        return ". ".join(parts)

    def _check_agent_stall(
        self, agent_name: str, extracted: dict, insights: dict
    ) -> bool:
        """Detect if an agent is stalled (no new data after multiple turns).

        Returns True if the agent should be force-advanced.
        Implements the spec rule: 'STOP asking after 2 attempts if no new info'.
        """
        # Silent/terminal agents are never stalled
        if agent_name in ["ToolsAgent", "SkillsAgent", "JDGeneratorAgent"]:
            return False

        agent_stalls = insights.get("agent_stall_counts") or {}
        current_stall = agent_stalls.get(agent_name, 0)

        # Check if new meaningful data was extracted this turn
        has_new_data = bool(
            extracted and any(v not in (None, "", [], {}) for v in extracted.values())
        )

        # Reset stall counter if we got new data
        if has_new_data:
            agent_stalls[agent_name] = 0
            insights["agent_stall_counts"] = agent_stalls
            return False

        # Increment stall counter
        agent_stalls[agent_name] = current_stall + 1
        insights["agent_stall_counts"] = agent_stalls

        # Force advance after 2 consecutive turns with no new data
        max_stall_turns = 2
        if current_stall + 1 >= max_stall_turns:
            logger.warning(
                f"[LoopControl] Agent {agent_name} stalled for {current_stall + 1} turns. "
                "Force-advancing to next agent."
            )
            return True

        return False

    async def _generate_snapshot_draft(self, insights: dict) -> str:
        """Rule 4: Create a high-fidelity snapshot of the JD progress."""
        from app.agents.extraction_engine import serialize_insights

        snapshot_prompt = f"""Provide a concise 'Snapshot' of the Job Description built so far.
Focus on the main themes and tools.

INPUT DATA:
{serialize_insights(insights)}

OUTPUT:
Return 3-5 bullet points under the heading: "### 🏗️ PROGRESS SNAPSHOT".
Keep it professional and brief."""
        try:
            response = await _invoke_with_retry(
                _interview_llm,
                [
                    SystemMessage(
                        content="You are a professional Job Description builder. Summarize progress concisely."
                    ),
                    HumanMessage(content=snapshot_prompt),
                ],
            )
            return _extract_text_content(response.content if response else None).strip()
        except Exception as e:
            logger.error(f"[Snapshot] Failed to generate snapshot: {e}")
            return ""

    async def _generate_final_jd_payload(self, insights: dict) -> dict:
        """Call the core JD generation prompt to produce the final asset."""

        from app.agents.extraction_engine import serialize_insights

        # Use a dedicated LLM with high token limit for JD generation
        jd_llm = ChatGoogleGenerativeAI(
            google_api_key=settings.GEMINI_API_KEY,
            model="gemini-2.5-flash",
            temperature=0.4,
            max_output_tokens=8192,  # CRITICAL FIX: 350 tokens was truncating the JD JSON
            response_mime_type="application/json",  # Enforce JSON output
        )

        response = await _invoke_with_retry(
            jd_llm,
            [
                SystemMessage(
                    content=get_compiled_prompt(
                        "jd-generation-prompt", JD_GENERATION_PROMPT
                    )
                ),
                HumanMessage(
                    content=f"Generate the Job Description from this data:\n{serialize_insights(insights)}"
                ),
            ],
            agent_name="JDGeneratorAgent",
            call_type="jd_generation",
        )
        raw_content = _extract_text_content(
            response.content if response else None
        ).strip()

        # Strip potential markdown code blocks
        if raw_content.startswith("```"):
            raw_content = re.sub(
                r"^```json\n?|\n?```$", "", raw_content, flags=re.MULTILINE
            )

        try:
            return json.loads(raw_content)
        except Exception as e:
            logger.error(f"Failed to parse JD JSON: {e}")
            # Fallback to raw text if parsing still fails
            return {"jd_structured_data": {}, "jd_text_format": raw_content}

    async def run_turn(
        self,
        agent_name: str,
        insights: dict,
        recent_messages: list,
        user_message: str,
        questions_asked: list | None = None,
        transition_context: str = "",
        previous_questions_text: list | None = None,
    ) -> tuple[dict, dict, str, list]:
        """Execute one interview turn (non-streaming).

        Returns: (extracted_data, updated_insights, response_text, updated_questions_asked)
        """
        questions_asked = questions_asked or []
        previous_questions_text = previous_questions_text or []
        is_opening_turn = not recent_messages

        # Increment phase turn count for the incoming agent
        agent_turns = insights.get("agent_turn_counts") or {}
        agent_turns[agent_name] = agent_turns.get(agent_name, 0) + 1
        insights["agent_turn_counts"] = agent_turns

        # Step 0a: Robust Two-Pass Extraction Pipeline
        # Runs the user message through LLM to extract data BEFORE the conversational agent sees it
        from app.agents.extraction_engine import extract_information

        extracted = await extract_information(
            user_message, insights, agent_name, recent_messages
        )
        if extracted:
            insights = self._merge_extracted_to_insights(extracted, insights)
            logger.info(
                f"[Interview] Data Extracted & Merged: {list(extracted.keys())}"
            )

        # --- PRE-PROCESS BEFORE MID-TURN ROUTING ---
        insights = self._pre_process_iteration_state(insights, agent_name)

        # --- MID-TURN ROUTING ---
        from app.agents.router import compute_current_agent, get_transition_message

        new_agent = compute_current_agent(insights, agent_name)
        if new_agent != agent_name:
            logger.info(
                f"[Interview] Mid-Turn Transition: {agent_name} -> {new_agent}"
            )
            transition_context = get_transition_message(agent_name, new_agent)

            # Clean insights data upon phase transition
            from app.agents.semantic_cleaner import deduplicate_and_professionalize

            target_role = (insights.get("identity_context") or {}).get("title", "General Role")
            dept_name = (insights.get("identity_context") or {}).get("department") or insights.get("department") or ""
            if new_agent == "WorkflowIdentifierAgent":
                insights["tasks"] = await deduplicate_and_professionalize(
                    insights.get("tasks") or [], "tasks", role_title=target_role, department=dept_name
                )
            elif new_agent == "DeepDiveAgent":
                insights["priority_tasks"] = await deduplicate_and_professionalize(
                    insights.get("priority_tasks") or [], "priority_tasks", role_title=target_role, department=dept_name
                )
            elif new_agent == "ToolsAgent":
                insights["tools"] = await deduplicate_and_professionalize(
                    insights.get("tools") or [], "tools", role_title=target_role, department=dept_name
                )
            elif new_agent == "SkillsAgent":
                insights["skills"] = await deduplicate_and_professionalize(
                    insights.get("skills") or [], "skills", role_title=target_role, department=dept_name
                )

            agent_name = new_agent
            insights = self._pre_process_iteration_state(insights, agent_name)

        # Step 0b: Advanced RAG Retrieval
        retrieved_context = await self._get_rag_context(insights, agent_name)

        # Step 0c: Auto-populate Inventory (Tools/Skills) if transitioning
        if agent_name in ["ToolsAgent", "SkillsAgent"]:
            insights = await self._auto_populate_inventory(
                insights, agent_name, retrieved_context
            )

        # Step 0c: Update conversation summary (every turn)
        insights["conversation_summary"] = self._build_conversation_summary(
            insights, agent_name
        )

        # Inject deep-dive turn number into insights for prompt context
        if agent_name == "DeepDiveAgent":
            turn_count = insights.get("deep_dive_turn_count") or 1
            insights["_deep_dive_turn_number"] = turn_count

        # Apply context filtering and memory compression
        filtered_insights = _apply_context_filter(insights, agent_name)
        compressed_recent = self._compress_memory(recent_messages, len(recent_messages))

        messages = build_interview_messages(
            agent_name,
            filtered_insights,
            compressed_recent,
            user_message,
            transition_context,
            retrieved_context=retrieved_context,
            previous_questions_text=previous_questions_text,
        )

        # Step 1: Call Conversational LLM for purely "Zero-Filler Questions"
        response_text = ""
        sess_id = insights.get("session_id")
        if agent_name in SILENT_AGENTS:
            logger.info(f"[Interview] Bypassing LLM for Silent Agent: {agent_name}")
            response_text = _get_silent_agent_response(agent_name, insights)
        else:
            response = await _invoke_with_retry(
                _interview_llm,
                messages,
                session_id=sess_id,
                agent_name=agent_name,
                call_type="question_gen",
            )
            response_text = _extract_text_content(response.content if response else None)

        # Step 2: Loop control — check for agent stall
        is_stalled = self._check_agent_stall(agent_name, extracted, insights)
        if is_stalled:
            # Mark agent as force-completed to trigger router advancement
            insights["_force_advance"] = True
            completed = insights.get("completed_phases") or []
            if agent_name not in completed:
                completed.append(agent_name)
                insights["completed_phases"] = completed

        # --- APPLY STRICT VALIDATION PIPELINE ---
        if agent_name not in SILENT_AGENTS:
            response_text = _normalize_agent_response(
                response_text,
                agent_name,
                insights,
                is_opening_turn=is_opening_turn,
            )

        # --- SEMANTIC QUESTION DEDUPLICATION ---
        response_text = response_text.strip()

        if agent_name not in SILENT_AGENTS and _is_question_repeated(
            response_text, questions_asked, previous_questions_text
        ):
            logger.info("  [DEDUP] ⚠ Question is repeated! Generating alternative.")
            dedup_msgs = messages + [
                AIMessage(content=response_text),
                HumanMessage(
                    content=(
                        "SYSTEM: Your previous question was already asked. "
                        "Ask a DIFFERENT question about something NOT yet covered. "
                        "Check the DATA ALREADY COLLECTED section."
                    )
                ),
            ]
            retry_response = await _invoke_with_retry(
                _response_llm,
                dedup_msgs,
                session_id=sess_id,
                agent_name=agent_name,
                call_type="dedup_retry",
            )
            alt_text = _extract_text_content(retry_response.content if retry_response else None).strip()
            if alt_text and not _is_question_repeated(
                alt_text, questions_asked, previous_questions_text
            ):
                response_text = _normalize_agent_response(
                    alt_text,
                    agent_name,
                    insights,
                    is_opening_turn=is_opening_turn,
                )

        # Record the question hash + text
        response_text = response_text.strip()
        insights["last_question_asked"] = response_text
        insights["conversation_summary"] = self._build_conversation_summary(
            insights, agent_name
        )
        q_hash = _compute_question_hash(response_text)
        if q_hash not in questions_asked:
            questions_asked.append(q_hash)
        previous_questions_text.append(response_text)

        # Clean up temporary keys
        insights.pop("_deep_dive_turn_number", None)
        insights.pop("_force_advance", None)

        return extracted, insights, response_text, questions_asked

    async def run_turn_stream(
        self,
        agent_name: str,
        insights: dict,
        recent_messages: list,
        user_message: str,
        questions_asked: list | None = None,
        transition_context: str = "",
        previous_questions_text: list | None = None,
        session_id: str | None = None,
        employee_id: str | None = None,
    ) -> AsyncIterator[dict]:
        """Execute one interview turn with streaming using a single LLM call."""
        questions_asked = questions_asked or []
        previous_questions_text = previous_questions_text or []
        is_opening_turn = not recent_messages

        yield {"type": "chunk", "content": ""}

        # Increment phase turn count
        agent_turns = insights.get("agent_turn_counts") or {}
        agent_turns[agent_name] = agent_turns.get(agent_name, 0) + 1
        insights["agent_turn_counts"] = agent_turns

        start_time = time.perf_counter()

        # 1. CRITICAL FIX: Run Extraction BEFORE routing/generation so state is updated
        from app.agents.extraction_engine import extract_information

        extracted = await extract_information(
            user_message, insights, agent_name, recent_messages
        )
        if extracted:
            insights = self._merge_extracted_to_insights(extracted, insights)
            logger.info(f"[Stream] Data Extracted & Merged: {list(extracted.keys())}")

        # 2. Pre-process iteration state (Deep Dive tracking)
        insights = self._pre_process_iteration_state(insights, agent_name)

        # 3. CRITICAL FIX: Mid-Turn Routing (Check if we need to advance phase based on new data)
        from app.agents.router import compute_current_agent, get_transition_message

        new_agent = compute_current_agent(insights, agent_name)
        if new_agent != agent_name:
            logger.info(f"[Stream] Mid-Turn Transition: {agent_name} -> {new_agent}")
            transition_context = get_transition_message(agent_name, new_agent)

            from app.agents.semantic_cleaner import deduplicate_and_professionalize

            target_role = (insights.get("identity_context") or {}).get(
                "title", "General Role"
            )
            dept_name = (
                (insights.get("identity_context") or {}).get("department")
                or insights.get("department")
                or ""
            )

            if new_agent == "WorkflowIdentifierAgent":
                insights["tasks"] = await deduplicate_and_professionalize(
                    insights.get("tasks") or [],
                    "tasks",
                    role_title=target_role,
                    department=dept_name,
                )
            elif new_agent == "DeepDiveAgent":
                insights["priority_tasks"] = await deduplicate_and_professionalize(
                    insights.get("priority_tasks") or [],
                    "priority_tasks",
                    role_title=target_role,
                    department=dept_name,
                )
            elif new_agent == "ToolsAgent":
                insights["tools"] = await deduplicate_and_professionalize(
                    insights.get("tools") or [],
                    "tools",
                    role_title=target_role,
                    department=dept_name,
                )
            elif new_agent == "SkillsAgent":
                insights["skills"] = await deduplicate_and_professionalize(
                    insights.get("skills") or [],
                    "skills",
                    role_title=target_role,
                    department=dept_name,
                )

            agent_name = new_agent
            insights = self._pre_process_iteration_state(insights, agent_name)

        # 4. RAG Retrieval (Fetch for Silent Agents and WorkflowIdentifier)
        retrieved_context = []
        if agent_name in SILENT_AGENTS or agent_name == "WorkflowIdentifierAgent":
            yield {"type": "status", "content": "Finding relevant standards..."}
            retrieved_context = await self._get_rag_context(insights, agent_name)

        # 5. Auto-populate Inventory (Tools/Skills/Tasks)
        # 5. Auto-populate Inventory (Tools/Skills/Tasks)
        if agent_name == "WorkflowIdentifierAgent":
            yield {"type": "status", "content": "Synthesizing priority tasks..."}
            # Pass user_message directly to the function!
            insights = await self._auto_populate_priority_tasks(
                insights, retrieved_context, user_message
            )
            # CRITICAL: Ensure suggested_tasks is populated for the frontend UI checklist
            insights["suggested_tasks"] = insights.get("tasks", [])

            # CRITICAL: Ensure suggested_tasks is populated for the frontend UI checklist
        elif agent_name in ["ToolsAgent", "SkillsAgent"]:
            yield {
                "type": "status",
                "content": f"Detecting relevant {agent_name.replace('Agent', '').lower()}...",
            }
            insights = await self._auto_populate_inventory(
                insights, agent_name, retrieved_context
            )

        # 6. Update conversation summary (zero-latency)
        insights["conversation_summary"] = self._build_conversation_summary(
            insights, agent_name
        )

        if agent_name == "DeepDiveAgent":
            insights["_deep_dive_turn_number"] = (
                insights.get("deep_dive_turn_count") or 1
            )

        # 7. Apply context filtering and memory compression
        filtered_insights = _apply_context_filter(
            _compact_insights(insights), agent_name
        )
        compressed_recent = self._compress_memory(recent_messages, len(recent_messages))

        # 8. Build messages
        messages = build_interview_messages(
            agent_name,
            filtered_insights,
            compressed_recent,
            user_message,
            transition_context,
            retrieved_context=retrieved_context,
            previous_questions_text=previous_questions_text,
        )

        response_text = ""

        # 9. Execute LLM Call
        if agent_name in SILENT_AGENTS:
            response_text = _get_silent_agent_response(agent_name, insights)
            yield {"type": "chunk", "content": response_text}
        else:
            yield {"type": "status", "content": "Formulating next question..."}

            from app.core.langfuse_client import get_langfuse_callback_handler

            handler = get_langfuse_callback_handler(
                trace_name=f"jd-interview-{agent_name.lower()}",
                session_id=session_id,
                user_id=employee_id,
            )
            callbacks = [handler] if handler else []
            config = {"callbacks": callbacks} if callbacks else None

            full_ai_message = None
            try:
                full_ai_message = await _invoke_with_retry(
                    _interview_llm,
                    messages,
                    session_id=session_id,
                    agent_name=agent_name,
                    call_type="question_and_extract",
                )

                if full_ai_message:
                    # Merge tool calls if LLM used them (supplements the extraction engine)
                    if (
                        hasattr(full_ai_message, "tool_calls")
                        and full_ai_message.tool_calls
                    ):
                        for tc in full_ai_message.tool_calls:
                            tool_name = tc.get("name")
                            tool_args = tc.get("args", {})
                            if tool_name:
                                insights = merge_tool_call_into_insights(
                                    tool_name, tool_args, insights
                                )
                                extracted[tool_name] = tool_args

                    response_text = _extract_text_content(
                        full_ai_message.content
                    ).strip()
                    yield {"type": "chunk", "content": response_text}

            except Exception as e:
                logger.error(f"[Interview] Single-LLM call failed: {e}")
                yield {
                    "type": "chunk",
                    "content": "I'm sorry, could you repeat that? I lost my train of thought.",
                }
                return

        # 10. Check for agent stall (force advance if stuck)
        is_stalled = self._check_agent_stall(agent_name, extracted, insights)
        if is_stalled:
            insights["_force_advance"] = True
            completed = insights.get("completed_phases") or []
            if agent_name not in completed:
                completed.append(agent_name)
                insights["completed_phases"] = completed

        full_text = response_text.strip()

        # 11. Apply validation pipeline
        if agent_name not in SILENT_AGENTS:
            full_text = _normalize_agent_response(
                full_text, agent_name, insights, is_opening_turn=is_opening_turn
            )
        full_text = full_text.strip()

        # 12. Final JD Generation Bridge
        if agent_name == "JDGeneratorAgent":
            yield {
                "type": "status",
                "content": "Architecting your high-fidelity Job Description...",
            }
            jd_payload = await self._generate_final_jd_payload(insights)
            insights["final_jd"] = jd_payload
            full_text = "Your high-fidelity Job Description is architected. Review the preview pane to your right."

        # 13. Record question for deduplication
        insights["last_question_asked"] = full_text
        insights["conversation_summary"] = self._build_conversation_summary(
            insights, agent_name
        )
        q_hash = _compute_question_hash(full_text)
        if q_hash not in questions_asked:
            questions_asked.append(q_hash)
        previous_questions_text.append(full_text)

        insights.pop("_deep_dive_turn_number", None)
        insights.pop("_force_advance", None)
        insights["_engine_current_agent"] = agent_name

        yield {"type": "chunk", "content": full_text}

        yield {
            "type": "done",
            "extracted": extracted,
            "insights": insights,
            "full_text": full_text,
            "questions_asked": questions_asked,
            # ADD THESE LINES: Ensure root level has the data for the frontend
            "suggested_tasks": insights.get("suggested_tasks", []),
            "suggested_tools": insights.get("suggested_tools", []),
            "suggested_skills": insights.get("suggested_skills", []),
            "task_list": insights.get("tasks", []),
        }


# Singleton engine
engine = InterviewEngine()


# ── EXPLICIT AGENT NODES ───────────────────────────────────────────────────


async def _generic_agent_node(state: AgentState, agent_name: str) -> dict:
    """Helper to run a generic interview turn for a specific agent."""
    previous_agent = state.get("previous_agent", "")
    insights = dict(state.get("insights", {}))
    user_message = state.get("user_message", "")
    questions_asked = list(state.get("questions_asked", []))

    # Carry forward conversation intelligence state
    insights["agent_turn_counts"] = dict(state.get("agent_turn_counts", {}))
    insights["conversation_summary"] = state.get("conversation_summary", "")

    # Build transition context if agent just changed
    transition_context = ""
    if previous_agent and previous_agent != agent_name:
        from app.agents.router import get_transition_message

        transition_context = get_transition_message(previous_agent, agent_name)

    # Get recent messages from state (Increased window for better memory)
    recent = []
    for msg in state.get("messages", [])[-16:]:  # Keep last 8 turns (16 messages)
        if isinstance(msg, HumanMessage):
            recent.append({"role": "user", "content": msg.content})
        elif isinstance(msg, AIMessage):
            recent.append({"role": "assistant", "content": msg.content})

    (
        extracted,
        updated_insights,
        response_text,
        updated_questions,
    ) = await engine.run_turn(
        agent_name=agent_name,
        insights=insights,
        recent_messages=recent,
        user_message=user_message,
        questions_asked=questions_asked,
        transition_context=transition_context,
    )

    return {
        "insights": updated_insights,
        "extracted_this_turn": extracted,
        "next_question": response_text,
        "questions_asked": updated_questions,
        "conversation_summary": updated_insights.get("conversation_summary", ""),
        "agent_turn_counts": updated_insights.get("agent_turn_counts") or {},
        "messages": [
            HumanMessage(content=user_message),
            AIMessage(content=response_text),
        ],
        # ADD THIS LINE: Ensure suggested_tasks is at the root for the frontend
        "suggested_tasks": updated_insights.get("suggested_tasks", []),
    }


async def basic_info_node(state: AgentState) -> dict:
    return await _generic_agent_node(state, "BasicInfoAgent")


async def workflow_identifier_node(state: AgentState) -> dict:
    return await _generic_agent_node(state, "WorkflowIdentifierAgent")


async def deep_dive_node(state: AgentState) -> dict:
    return await _generic_agent_node(state, "DeepDiveAgent")


async def tools_node(state: AgentState) -> dict:
    return await _generic_agent_node(state, "ToolsAgent")


async def skills_node(state: AgentState) -> dict:
    return await _generic_agent_node(state, "SkillsAgent")


async def qualification_node(state: AgentState) -> dict:
    return await _generic_agent_node(state, "QualificationAgent")


async def jd_generator_node(state: AgentState) -> dict:
    return await _generic_agent_node(state, "JDGeneratorAgent")
