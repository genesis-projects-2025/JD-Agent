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

logger = logging.getLogger(__name__)


def _extract_text_content(content) -> str:
    """Extract plain text from Gemini's response content.

    With bind_tools(), Gemini returns content as a LIST of dicts:
      [{'type': 'text', 'text': 'actual response...', 'extras': {...}}]
    instead of a plain string. This helper normalizes both formats.
    """
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        text_parts = []
        for part in content:
            if isinstance(part, dict):
                text_parts.append(part.get("text", ""))
            elif isinstance(part, str):
                text_parts.append(part)
        return " ".join(text_parts).strip()
    return str(content)


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
      2. Keyword overlap (semantic) — >60% keyword overlap with any previous question
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
            # Trigger semantic duplicate at 40% overlap instead of 50% for aggressive dupe-catching
            if (overlap / max_possible) >= 0.40:
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
    """Remove occasional LLM hallucinations where it leaks JSON tool calls into the response text."""
    if not text:
        return text

    # Aggressive stripping for {"tool_code"...} or {"name": "save...}
    text = re.sub(
        r'\{[^{]*?"tool_code"[^{]*?\}', "", text, flags=re.IGNORECASE | re.DOTALL
    )
    text = re.sub(
        r'\{[^{]*?"name":\s*"save_[^{]*?\}', "", text, flags=re.IGNORECASE | re.DOTALL
    )

    # Also strip backticks containing json
    text = re.sub(
        r"```(?:json)?\s*[\{\[].*?[\}\]]\s*```",
        "",
        text,
        flags=re.IGNORECASE | re.DOTALL,
    )

    # Clean up double punctuation
    text = re.sub(r"\s+", " ", text)
    text = text.replace("} .", ".").replace("}.", ".").replace(" .", ".")
    text = text.replace("! .", "!").replace("? .", "?")
    text = text.replace("!.", "!").replace("?.", "?")

    return text.strip()


def _trim_duplicate_response(response_text: str) -> str:
    """Detect and trim duplicate/runaway responses.

    The LLM sometimes generates multiple "turns" in a single response.
    This function detects and trims to keep only the first complete response.
    """
    if not response_text or not response_text.strip():
        return response_text

    text = response_text.strip()

    # Strategy 1: Split on double newlines
    paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]

    if len(paragraphs) > 1:
        first_para = paragraphs[0]
        if "?" in first_para:
            logger.info(
                "  [TRIM] ✓ First paragraph has question — trimming extra paragraphs."
            )
            return first_para

        if len(paragraphs) >= 2 and "?" in paragraphs[1]:
            logger.info("  [TRIM] ✓ Question in 2nd para — keeping first two.")
            return paragraphs[0] + "\n\n" + paragraphs[1]

    # Strategy 2: Detect transition phrases that signal a "second response"
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

    # Strategy 3: If 2+ questions are far apart, keep only up to the first
    question_positions = [m.start() for m in re.finditer(r"\?", text)]
    if len(question_positions) >= 2:
        if "\n\n" in text[question_positions[0] : question_positions[1]]:
            return text[: question_positions[0] + 1].strip()
        if question_positions[1] - question_positions[0] > 120:
            return text[: question_positions[0] + 1].strip()

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

# Interview LLM — used for streaming conversational questions
# Using gemini-2.0-flash for lower TTFB: 2.5-flash has internal thinking mode
# that causes 3-6s delays. 2.0-flash streams first byte in ~0.5-1.5s.
_interview_llm = ChatGoogleGenerativeAI(
    google_api_key=settings.GEMINI_API_KEY,
    model="gemini-2.5-flash",
    temperature=0.4,
)


# Dedup retry LLM — used only when a question is detected as repeated
# Also on 2.0-flash for consistent low latency
_response_llm = ChatGoogleGenerativeAI(
    google_api_key=settings.GEMINI_API_KEY,
    model="gemini-2.5-flash",
    temperature=0.4,
)


async def _invoke_with_retry(llm, messages, max_retries=2):
    """Invoke LLM with exponential backoff on transient failures."""
    for attempt in range(max_retries + 1):
        try:
            return await llm.ainvoke(messages)
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
    
    # Extract recent questions to pass to prompt for explicit anti-repetition
    recent_questions = []
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
                recent_questions.append(content.strip())

    system_content = build_system_messages(
        phase=agent_name,
        insights=insights,
        rag_context=retrieved_context,
        transition_context=transition_context,
        is_first_turn=is_first_turn,
        recent_questions=recent_questions,
    )

    messages.append(SystemMessage(content=system_content))

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
            # Strip tool call JSON if present, keep only the question text
            text = content
            if "{" in content and "}" in content:
                try:
                    parsed = json.loads(content)
                    text = (
                        parsed.get("next_question") or parsed.get("question") or content
                    )
                except:
                    pass
            # HARDENING: Never append an AIMessage with empty content
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

        # 1. Map agent to specific RAG category
        block_types = {
            "BasicInfoAgent": "role_summary",
            "WorkflowIdentifierAgent": "responsibilities",
            "DeepDiveAgent": [
                "responsibilities",
                "workflow",
                "performance_metrics",
                "projects",
            ],
            "ToolsAgent": ["tools", "workflow"],  # Tools often appear in workflows
            "SkillsAgent": "skills",
            "QualificationAgent": "qualification",
        }
        b_type = block_types.get(agent_name, "role_summary")

        # 2. Extract metadata filters from memory
        id_ctx = insights.get("identity_context") or {}
        role_title = id_ctx.get("title", "") or insights.get("purpose", "")
        dept = id_ctx.get("department")

        # Guess experience level for sharper filtering
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

        # 3. Perform surgical retrieval
        return await query_advanced_context(
            role_query=role_title,
            block_type=b_type,
            experience_level=exp_level,
            department=dept or "",
            top_k=5,
        )

    async def _auto_populate_inventory(
        self, insights: dict, agent_name: str, rag_context: list[str]
    ) -> dict:
        """Automatically populate tools/skills from RAG and collected context if they are empty."""
        if agent_name not in ["ToolsAgent", "SkillsAgent"]:
            return insights

        field = "tools" if agent_name == "ToolsAgent" else "skills"
        existing = insights.get(field) or []

        # Only auto-populate if we have very little data (less than 3 items)
        if len(existing) >= 8:
            return insights

        logger.info(
            f"[Auto-Populate] Generating {field} from RAG and collected context..."
        )

        # Build a prompt to extract items from RAG and collected workflows
        workflows = insights.get("workflows") or {}
        workflow_texts = []
        for task, wf in workflows.items():
            workflow_texts.append(
                f"Task: {task}\nSteps: {wf.get('steps', '')}\nTools: {wf.get('tools', '')}"
            )

        context_text = (
            "\n\n".join(workflow_texts) + "\n\nRAG CONTEXT:\n" + "\n".join(rag_context)
        )

        prompt = f"""Extract a concise list of the most relevant {field} for this role from the context below.
        
        CONTEXT:
        {context_text}
        
        Respond with ONLY a JSON list of strings, e.g. ["Item 1", "Item 2"]. 
        Focus on technical/professional items. Do NOT include generic soft skills for 'tools'.
        """

        try:
            from langchain_core.messages import HumanMessage

            response = await _interview_llm.ainvoke([HumanMessage(content=prompt)])
            content = str(response.content).strip()
            # Clean possible markdown wrap
            if "```" in content:
                content = content.split("```")[1]
                if content.startswith("json"):
                    content = content[4:]

            new_items = json.loads(content)
            if isinstance(new_items, list):
                # Professionalize and merge
                from app.agents.semantic_cleaner import deduplicate_and_professionalize

                merged = list(set(existing) | set(new_items))
                insights[field] = await deduplicate_and_professionalize(merged, field)
                logger.info(f"[Auto-Populate] Added {len(new_items)} items to {field}.")
        except Exception as e:
            logger.error(f"[Auto-Populate] Failed: {e}")

        return insights

    def _pre_process_iteration_state(self, insights: dict, agent_name: str) -> dict:
        """Manage active_deep_dive_task and visited_tasks for iterative workflow.

        STRICT 2+1 TURN PROTOCOL:
        - Turn 1 (compulsory): How the task begins — triggers and inputs.
        - Turn 2 (compulsory): Challenges, quality standards, and expert-level outcomes.
        - Turn 3 (conditional): Only if extraction is incomplete (missing trigger/steps/output).
        - After turn 3 OR if data is complete at turn 2: mark visited, advance.
        - Once visited, a task is NEVER revisited.
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
            """A task is complete if trigger, steps AND output are captured."""
            wf = (insights.get("workflows") or {}).get(task, {})
            return bool(wf.get("trigger") and wf.get("steps") and wf.get("output"))

        if active_task:
            # Hard ceiling: ALWAYS mark visited after >= 3 turns
            if turn_count >= 3:
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

        # Pick next non-visited priority task
        if not active_task:
            for pt in priority_tasks:
                if pt not in (insights.get("visited_tasks") or []):
                    active_task = pt
                    remaining = len(priority_tasks) - len(visited_tasks)
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

        existing = insights.get(key)

        # Defense mechanism: If workflows comes in as a list, dynamically convert it to a dict
        if key == "workflows" and isinstance(value, list):
            converted = {}
            for idx, item in enumerate(value):
                if isinstance(item, dict):
                    # Use the active deep dive task, or a task name, or a fallback generator
                    task_name = (
                        item.get("task")
                        or insights.get("active_deep_dive_task")
                        or f"Task_{idx + 1}"
                    )
                    converted[task_name] = item
            value = converted

        if isinstance(value, list) and isinstance(existing, list):
            # Intelligent list deduplication merge
            if key in ["tasks", "tools", "skills", "priority_tasks"]:
                # Semantic deduplication for known list types
                seen_normalized = set()
                for item in existing:
                    text = (
                        item.get("description") if isinstance(item, dict) else str(item)
                    )
                    seen_normalized.add(self._normalize_item_text(text))

                for item in value:
                    text = (
                        item.get("description") if isinstance(item, dict) else str(item)
                    )
                    norm = self._normalize_item_text(text)
                    if norm not in seen_normalized:
                        existing.append(item)
                        seen_normalized.add(norm)
            else:
                # Fallback to exact JSON match deduplication
                seen = {
                    json.dumps(v, sort_keys=True, default=str)
                    if isinstance(v, dict)
                    else str(v)
                    for v in existing
                }
                for item in value:
                    item_key = (
                        json.dumps(item, sort_keys=True, default=str)
                        if isinstance(item, dict)
                        else str(item)
                    )
                    if item_key not in seen:
                        existing.append(item)
                        seen.add(item_key)
                insights[key] = existing
        elif isinstance(value, dict) and isinstance(existing, dict):
            # Deep Merge dictionaries
            insights[key] = self._deep_merge_dicts(existing, value)
        else:
            # Overwrite primitives
            insights[key] = value
        return insights

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

        response = await _invoke_with_retry(
            _interview_llm,
            [
                SystemMessage(content=JD_GENERATION_PROMPT),
                HumanMessage(
                    content=f"Generate the Job Description from this data:\n{serialize_insights(insights)}"
                ),
            ],
        )
        raw_content = _extract_text_content(response.content if response else None).strip()

        # Strip potential markdown code blocks
        if raw_content.startswith("```"):
            raw_content = re.sub(
                r"^```json\n?|\n?```$", "", raw_content, flags=re.MULTILINE
            )

        try:
            return json.loads(raw_content)
        except Exception as e:
            logger.error(f"Failed to parse JD JSON: {e}")
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

            if new_agent == "WorkflowIdentifierAgent":
                insights["tasks"] = await deduplicate_and_professionalize(
                    insights.get("tasks") or [], "tasks"
                )
            elif new_agent == "DeepDiveAgent":
                insights["priority_tasks"] = await deduplicate_and_professionalize(
                    insights.get("priority_tasks") or [], "priority_tasks"
                )
            elif new_agent == "ToolsAgent":
                insights["tools"] = await deduplicate_and_professionalize(
                    insights.get("tools") or [], "tools"
                )
            elif new_agent == "SkillsAgent":
                insights["skills"] = await deduplicate_and_professionalize(
                    insights.get("skills") or [], "skills"
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
        )

        # Step 1: Call Conversational LLM for purely "Zero-Filler Questions"
        response_text = ""
        if agent_name in SILENT_AGENTS:
            logger.info(f"[Interview] Bypassing LLM for Silent Agent: {agent_name}")
            response_text = _get_silent_agent_response(agent_name, insights)
        else:
            response = await _invoke_with_retry(_interview_llm, messages)
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
            retry_response = await _invoke_with_retry(_response_llm, dedup_msgs)
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
    ) -> AsyncIterator[dict]:
        """Execute one interview turn with streaming.

        Yields: {"type": "extraction", "data": {...}}
                {"type": "chunk", "content": "..."}
                {"type": "done", "extracted": {...}, "full_text": "...", "questions_asked": [...]}
        """
        questions_asked = questions_asked or []
        previous_questions_text = previous_questions_text or []
        is_opening_turn = not recent_messages

        # ✅ CRITICAL: Yield an immediate heartbeat chunk to prevent frontend timeouts
        yield {"type": "chunk", "content": ""}

        # Increment phase turn count for the incoming agent
        agent_turns = insights.get("agent_turn_counts") or {}
        agent_turns[agent_name] = agent_turns.get(agent_name, 0) + 1
        insights["agent_turn_counts"] = agent_turns

        # Step 0a: Parallel Extraction & RAG Pipeline
        from app.agents.extraction_engine import extract_information

        # Performance Tracking
        start_time = time.perf_counter()

        # Run Extraction and RAG Retrieval in parallel to save ~3-5s
        yield {"type": "status", "content": "Analyzing your input..."}
        extraction_task = extract_information(
            user_message, insights, agent_name, recent_messages
        )
        rag_task = self._get_rag_context(insights, agent_name)

        extracted, retrieved_context = await asyncio.gather(extraction_task, rag_task)

        parallel_time = time.perf_counter() - start_time
        logger.info(f"[Perf] Extraction + RAG took {parallel_time:.2f}s")

        if extracted:
            # PHASE ADVANCEMENT: If user explicitly wants to proceed, mark phase complete
            if (
                extracted.get("user_wants_to_proceed")
                and agent_name == "BasicInfoAgent"
                and agent_turns[agent_name] >= 2
            ):
                completed = insights.get("completed_phases", [])
                if agent_name not in completed:
                    completed.append(agent_name)
                    insights["completed_phases"] = completed
                logger.info(
                    "[Interview Stream] User requested early transition to Priority Selection."
                )

            insights = self._merge_extracted_to_insights(extracted, insights)
            logger.info(
                f"[Interview Stream] Data Extracted & Merged: {list(extracted.keys())}"
            )

        # Step 0b: Pre-process iteration state BEFORE routing
        # (This avoids a redundant Critic Engine LLM call, shifting synthesis to Extraction Engine)
        insights = self._pre_process_iteration_state(insights, agent_name)

        # Step 0c: Mid-Turn Routing
        from app.agents.router import compute_current_agent, get_transition_message

        new_agent = compute_current_agent(insights, agent_name)
        if new_agent != agent_name:
            logger.info(
                f"[Interview Stream] Mid-Turn Transition: {agent_name} -> {new_agent}"
            )

            # STICKY COMPLETION: Mark current agent as complete
            completed = insights.get("completed_phases", [])
            if agent_name not in completed:
                completed.append(agent_name)
                insights["completed_phases"] = completed

            transition_context = get_transition_message(agent_name, new_agent)

            from app.agents.semantic_cleaner import deduplicate_and_professionalize

            cleaning_tasks = []

            if new_agent == "WorkflowIdentifierAgent":
                yield {
                    "type": "status",
                    "content": "Professionalizing your task list...",
                }
                cleaning_tasks.append(
                    deduplicate_and_professionalize(
                        insights.get("tasks") or [], "tasks"
                    )
                )
            elif new_agent == "DeepDiveAgent":
                yield {"type": "status", "content": "Analyzing priority tasks..."}
                cleaning_tasks.append(
                    deduplicate_and_professionalize(
                        insights.get("priority_tasks", []), "priority_tasks"
                    )
                )
            elif new_agent == "ToolsAgent":
                yield {"type": "status", "content": "Refining technical toolset..."}
                cleaning_tasks.append(
                    deduplicate_and_professionalize(insights.get("tools", []), "tools")
                )
            elif new_agent == "SkillsAgent":
                yield {"type": "status", "content": "Validating technical skills..."}
                cleaning_tasks.append(
                    deduplicate_and_professionalize(
                        insights.get("skills", []), "skills"
                    )
                )

            if cleaning_tasks:
                cleaning_results = await asyncio.gather(*cleaning_tasks)
                # Map results back to insights
                if new_agent == "WorkflowIdentifierAgent":
                    insights["tasks"] = cleaning_results[0]
                elif new_agent == "DeepDiveAgent":
                    insights["priority_tasks"] = cleaning_results[0]
                elif new_agent == "ToolsAgent":
                    insights["tools"] = cleaning_results[0]
                elif new_agent == "SkillsAgent":
                    insights["skills"] = cleaning_results[0]

            agent_name = new_agent
            insights = self._pre_process_iteration_state(insights, agent_name)

        # Step 0b: Advanced RAG Retrieval (Already done in Parallel Pipeline Step 0a)

        # Step 0c: Auto-populate Inventory (Tools/Skills) if transitioning
        if agent_name in ["ToolsAgent", "SkillsAgent"]:
            yield {
                "type": "status",
                "content": f"Detecting relevant {agent_name.replace('Agent', '').lower()}...",
            }
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

        logger.info(
            f"[Interview Stream] Agent: {agent_name} | User Message: {repr(user_message)}"
        )

        # Step 1: Call Conversational LLM for purely "Zero-Filler Questions"
        messages = build_interview_messages(
            agent_name,
            filtered_insights,
            compressed_recent,
            user_message,
            transition_context,
            retrieved_context=retrieved_context,
        )

        response_text = ""

        if agent_name in SILENT_AGENTS:
            logger.info(
                f"[Interview Stream] Bypassing LLM for Silent Agent: {agent_name}"
            )
            response_text = _get_silent_agent_response(agent_name, insights)
        else:
            response_chunks = []
            is_first_chunk = True
            llm_start_time = time.perf_counter()

            # Signal to frontend that the agent is actively formulating
            # This covers the TTFB gap while the LLM is generating
            yield {"type": "status", "content": "Formulating next question..."}

            try:
                async for chunk in _interview_llm.astream(messages):
                    if chunk.content:
                        if is_first_chunk:
                            ttfb = time.perf_counter() - llm_start_time
                            logger.info(f"[Perf] LLM Time to First Byte: {ttfb:.2f}s")
                            is_first_chunk = False
                        response_chunks.append(chunk.content)

                        # Yield cumulative chunk immediately for real-time streaming
                        # (Frontend expects cumulative text in setStreamingQuestion)
                        yield {"type": "chunk", "content": "".join(response_chunks)}
            except Exception as e:
                logger.error(f"[Interview] Streaming failed: {e}")
                yield {
                    "type": "chunk",
                    "content": "I encountered an error processing your request. Could you rephrase your last point?",
                }
                return

            response_text = "".join(response_chunks)

        # Step 2: Loop control — check for agent stall
        is_stalled = self._check_agent_stall(agent_name, extracted, insights)
        if is_stalled:
            insights["_force_advance"] = True
            completed = insights.get("completed_phases", [])
            if agent_name not in completed:
                completed.append(agent_name)
                insights["completed_phases"] = completed
            # CRITICAL: Merge extracted data INTO insights immediately for streaming persistence
            insights = self._merge_extracted_to_insights(extracted, insights)

        full_text = response_text.strip()

        logger.debug(
            f"====== RAW SET RESPONSE (BEFORE PROCESSING) ======\n{repr(full_text)}"
        )

        # --- APPLY STRICT VALIDATION PIPELINE ---
        if agent_name not in SILENT_AGENTS:
            full_text = _normalize_agent_response(
                full_text,
                agent_name,
                insights,
                is_opening_turn=is_opening_turn,
            )
        full_text = full_text.strip()

        # Snapshot generation removed — it was polluting the chat response with
        # internal analysis blocks that leak into the user-facing conversation.

        # --- FINAL JD GENERATION BRIDGE ---
        if agent_name == "JDGeneratorAgent":
            logger.info("[JD Fix] Executing final high-fidelity JD generation...")
            yield {
                "type": "status",
                "content": "Architecting your high-fidelity Job Description...",
            }
            jd_payload = await self._generate_final_jd_payload(insights)
            insights["final_jd"] = jd_payload
            full_text = "Your high-fidelity Job Description is architected. Review the preview pane to your right."

        # --- SEMANTIC QUESTION DEDUPLICATION STATUS ---
        # Disabled post-streaming deduplication.
        # Overwriting text after it has already streamed to the frontend causes a UI glitch.

        # Record the question hash + text
        insights["last_question_asked"] = full_text
        insights["conversation_summary"] = self._build_conversation_summary(
            insights, agent_name
        )
        q_hash = _compute_question_hash(full_text)
        if q_hash not in questions_asked:
            questions_asked.append(q_hash)
        previous_questions_text.append(full_text)

        # Debug state logging (kept as debug level for development troubleshooting)
        logger.debug(f">> [USER MESSAGE]: {user_message}")
        logger.debug(f">> [EXTRACTED DATA]: {list(extracted.keys())}")
        logger.debug(f">> [AGENT RESPONSE]: {full_text}")

        # Clean up temporary keys before persisting
        insights.pop("_deep_dive_turn_number", None)
        insights.pop("_force_advance", None)

        # Yield to ensure validated/final text is sent before 'done'
        yield {"type": "chunk", "content": full_text}

        yield {
            "type": "done",
            "extracted": extracted,
            "insights": insights,
            "full_text": full_text,
            "questions_asked": questions_asked,
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
