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
from typing import AsyncIterator

from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.messages import (
    SystemMessage,
    HumanMessage,
    AIMessage,
    ToolMessage,
)

from app.core.config import settings
from app.agents.state import AgentState
from app.agents.prompts import BASE_PROMPT, ORCHESTRATOR_PROMPT, AGENT_PROMPTS
from app.agents.tools import INTERVIEW_TOOLS, merge_tool_call_into_insights

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


# ── Question Deduplication ────────────────────────────────────────────────────


def _compute_question_hash(question_text: str) -> str:
    """Compute a normalized hash of a question for deduplication."""
    normalized = question_text.lower().strip()
    # Remove common filler words
    for word in ["could you", "can you", "please", "would you", "tell me",
                 "i'd love to", "i'd like to", "let's", "shall we"]:
        normalized = normalized.replace(word, "")
    normalized = " ".join(normalized.split())
    return hashlib.md5(normalized.encode()).hexdigest()[:12]


def _is_question_repeated(question_text: str, questions_asked: list) -> bool:
    """Check if question (or very similar) has already been asked."""
    if not questions_asked:
        return False
    q_hash = _compute_question_hash(question_text)
    return q_hash in questions_asked


# ── Response Validation ───────────────────────────────────────────────────────


def _ensure_ends_with_question(
    response_text: str, agent_name: str, insights: dict, progress: dict
) -> str:
    """Ensure the response ends with a question mark.

    If the LLM forgot to ask a question (or returned empty text), append 
    or return a contextually relevant one based on the current agent.
    """
    fallback_questions = {
        "BasicInfoAgent": "For example, I help manage vendor relationships. Could you describe the main purpose your role serves?",
        "TaskAgent": _get_task_fallback_question(insights),
        "PriorityAgent": "Of all the tasks we discussed, which 3 would you say have the biggest business impact?",
        "DeepDiveAgent": _get_workflow_fallback_question(insights),
        "ToolsSkillsAgent": "What key tools or software do you rely on daily in your work?",
    }
    fallback = fallback_questions.get(agent_name, "Could you tell me more about that?")

    if not response_text or not response_text.strip():
        print(f"  [VALIDATE] ⚠ Empty response detected! Using pure fallback (agent={agent_name})")
        return fallback

    stripped = response_text.strip()

    # JDGeneratorAgent doesn't need to end with a question — it's the final stage
    if agent_name == "JDGeneratorAgent":
        return response_text

    # Check if the response already contains a question in the latter half
    last_segment = stripped[-150:] if len(stripped) > 150 else stripped
    if "?" in last_segment:
        return response_text

    print(f"  [VALIDATE] ✗ Response does NOT end with a question! Appending fallback (agent={agent_name})")



    if stripped.endswith((".","!",",","-")):
        return f"{stripped} {fallback}"
    return f"{stripped}. {fallback}"


def _get_task_fallback_question(insights: dict) -> str:
    """Generate a contextual fallback question for the TaskAgent."""
    tasks = insights.get("tasks", [])
    count = len(tasks)
    if count == 0:
        return "Could you walk me through what a typical work week looks like for you?"
    elif count < 4:
        return f"We've captured {count} tasks so far. Are there any other weekly or monthly tasks we haven't covered yet?"
    return "Is there anything else you'd like to add about your responsibilities?"


def _get_workflow_fallback_question(insights: dict) -> str:
    """Generate a contextual fallback question for the DeepDiveAgent."""
    priorities = insights.get("priority_tasks", [])
    workflows = insights.get("workflows", {})

    for p in priorities:
        if p not in workflows or not workflows.get(p, {}).get("steps"):
            return f"When you work on '{p}', what's the very first step you take?"

    return "Is there anything else you'd like to add about how you handle these tasks?"


def _strip_tool_code_leaks(text: str) -> str:
    """Remove occasional LLM hallucinations where it leaks JSON tool calls into the response text."""
    if not text:
        return text
    
    # Remove {"tool_code": ... } or similar JSON-like structures that the model might leak
    text = re.sub(r'\{"tool_code".*?\}', '', text, flags=re.IGNORECASE | re.DOTALL)
    text = re.sub(r'\{"name":\s*"save_.*?\}', '', text, flags=re.IGNORECASE | re.DOTALL)
    
    # Also strip trailing or inline ```json ... ``` blocks
    text = re.sub(r'```(?:json)?\s*\{.*?\}\s*```', '', text, flags=re.IGNORECASE | re.DOTALL)
    
    # Fix up any dangling punctuation left behind (e.g. "Thank you! . Could you...")
    text = re.sub(r'\s+', ' ', text)
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
            print("  [TRIM] ✓ First paragraph has question — trimming extra paragraphs.")
            return first_para

        if len(paragraphs) >= 2 and "?" in paragraphs[1]:
            print("  [TRIM] ✓ Question in 2nd para — keeping first two.")
            return paragraphs[0] + "\n\n" + paragraphs[1]

    # Strategy 2: Detect transition phrases that signal a "second response"
    transition_markers = [
        "Okay, that gives us", "Okay, that's a great", "Now that I understand",
        "Now that I have", "Now that we have", "Now, let's dive", "Now let's dive",
        "Now, moving on", "Great, now let", "Perfect, now let", "Excellent, now let",
        "With that in mind", "Building on that", "That said, let",
    ]

    for marker in transition_markers:
        idx = text.lower().find(marker.lower())
        if idx > 0:
            before = text[:idx].strip()
            if "?" in before:
                print(f"  [TRIM] ✓ Found transition '{marker}' after question. Trimming.")
                return before

    # Strategy 3: If 2+ questions are far apart, keep only up to the first
    question_positions = [m.start() for m in re.finditer(r"\?", text)]
    if len(question_positions) >= 2:
        if "\n\n" in text[question_positions[0]:question_positions[1]]:
            return text[:question_positions[0] + 1].strip()
        if question_positions[1] - question_positions[0] > 120:
            return text[:question_positions[0] + 1].strip()

    return text


def _truncate_if_too_long(response_text: str) -> str:
    """If the response is excessively long (>90 words), try to trim it."""
    words = response_text.split()
    if len(words) <= 90:
        return response_text

    print(f"  [VALIDATE] ⚠ Response is {len(words)} words (target: <90). Trimming.")

    sentences = re.split(r"(?<=[.!?])\s+", response_text.strip())
    if len(sentences) <= 3:
        return response_text

    # Keep first 2 sentences + last sentence (the question)
    trimmed = " ".join(sentences[:2]) + " " + sentences[-1]
    return trimmed


# ── LLM Instances ─────────────────────────────────────────────────────────────

# Interview LLM — used for tool-calling extraction + conversation
_interview_llm = ChatGoogleGenerativeAI(
    google_api_key=settings.GEMINI_API_KEY,
    model="gemini-2.5-flash",
    temperature=0.4,
)

# Same model but bound with tools
_interview_llm_with_tools = _interview_llm.bind_tools(INTERVIEW_TOOLS)

# Plain LLM for follow-up responses (no tools, no JSON mode)
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


def _build_identity_block(insights: dict) -> str:
    """Build pre-filled identity context block."""
    identity = insights.get("identity_context", {})
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


def _build_already_collected_summary(insights: dict) -> str:
    """Build a plain-text summary of what data has ALREADY been collected.

    This gives the LLM an explicit checklist of what NOT to ask again.
    """
    lines = ["DATA ALREADY COLLECTED (do NOT ask about these again):"]
    has_data = False

    purpose = insights.get("purpose", "")
    if purpose:
        lines.append(f'  ✓ Role purpose: "{purpose[:80]}..."')
        has_data = True

    basic = insights.get("basic_info", {})
    if basic.get("title"):
        lines.append(f"  ✓ Job title: {basic['title']}")
        has_data = True
    if basic.get("department"):
        lines.append(f"  ✓ Department: {basic['department']}")
        has_data = True

    tasks = insights.get("tasks", [])
    if tasks:
        task_names = [
            t.get("description", str(t))[:60] if isinstance(t, dict) else str(t)[:60]
            for t in tasks[:6]
        ]
        lines.append(f"  ✓ Tasks ({len(tasks)} collected): {', '.join(task_names)}")
        if len(tasks) >= 4:
            lines.append(
                "    → [COMPLETE] You have enough tasks. DO NOT ask for more tasks."
            )
        else:
            lines.append(f"    → Need {4 - len(tasks)} more tasks.")
        has_data = True

    priorities = insights.get("priority_tasks", [])
    if priorities:
        lines.append(
            f"  ✓ Priority tasks ({len(priorities)}): {', '.join(str(p)[:40] for p in priorities[:4])}"
        )
        if len(priorities) >= 3:
            lines.append("    → [COMPLETE] Priorities are set. DO NOT ask to rank tasks again.")
        has_data = True

    workflows = insights.get("workflows", {})
    if workflows:
        wf_names = list(workflows.keys())
        lines.append(
            f"  ✓ Workflows completed ({len(workflows)}): {', '.join(n[:40] for n in wf_names)}"
        )
        missing_wf = []
        if priorities:
            missing_wf = [
                p for p in priorities
                if p not in workflows
                and str(p)[:40] not in [str(w)[:40] for w in wf_names]
            ]
            if missing_wf:
                lines.append(
                    f"  ✗ Workflows MISSING for: {', '.join(str(m)[:40] for m in missing_wf)}"
                )
            else:
                lines.append("    → [COMPLETE] Workflows collected for all priority tasks. DO NOT ask for more.")
        has_data = True

    tools = insights.get("tools", [])
    tech = insights.get("technologies", [])
    if tools or tech:
        lines.append(f"  ✓ Tools & Tech ({len(tools) + len(tech)}): {', '.join(tools[:5] + tech[:5])}")
        if len(tools) + len(tech) >= 2:
            lines.append("    → [SUFFICIENT] You have enough tools.")
        has_data = True

    skills = insights.get("skills", [])
    if skills:
        lines.append(f"  ✓ Skills ({len(skills)}): {', '.join(skills[:5])}")
        if len(skills) >= 3:
            lines.append("    → [COMPLETE] You have enough skills. DO NOT ask for more skills.")
        has_data = True

    quals = insights.get("qualifications", {})
    if quals:
        if quals.get("education"):
            lines.append(f"  ✓ Education: {', '.join(quals['education'])}")
        if quals.get("certifications"):
            lines.append(f"  ✓ Certifications: {', '.join(quals['certifications'])}")
        has_data = True

    if not has_data:
        return "DATA ALREADY COLLECTED: Nothing yet. This is the first turn."

    lines.append("\nCRITICAL INSTRUCTIONS:")
    lines.append("1. Your NEXT question must be about something NOT marked as ✓ above.")
    lines.append("2. If the user mentions something already listed, acknowledge it briefly and ASK ABOUT A DIFFERENT TOPIC.")
    lines.append("3. If the user says they already provided information or says 'nothing more', move to the next field immediately.")
    
    return "\n".join(lines)


def _build_response_reminder(agent_name: str) -> str:
    """Build response format reminder."""
    if agent_name == "JDGeneratorAgent":
        return (
            "═══ FINAL FORMAT RULE ═══\n"
            "The interview is COMPLETE. Thank the employee and summarize.\n"
            "Do NOT ask any more data-collection questions.\n"
        )
    return (
        "═══ FINAL FORMAT RULE ═══\n"
        "1. Write 2-3 sentences max. ALWAYS include a short example of what you're looking for.\n"
        "2. Follow immediately with exactly ONE question ending with '?'.\n"
        "3. NEVER repeat the user's answer back to them.\n"
        "4. DO NOT ask questions about data marked [COMPLETE] above.\n"
        "5. DO NOT generate multiple turns — output ONE response only.\n"
    )


def build_interview_messages(
    agent_name: str,
    insights: dict,
    recent_messages: list,
    user_message: str,
    transition_context: str = "",
) -> list:
    """Build the LLM message stack for the current agent."""
    messages = []

    print(f"\n{'=' * 60}")
    print(f"[BUILD MESSAGES] Agent: {agent_name}")
    print(f"[BUILD MESSAGES] Turn user message: {user_message[:80]}...")
    print(f"[BUILD MESSAGES] Recent messages count: {len(recent_messages)}")

    # 1. Base prompt + orchestrator
    messages.append(SystemMessage(content=BASE_PROMPT))
    messages.append(SystemMessage(content=ORCHESTRATOR_PROMPT))

    # 2. Active agent prompt
    agent_prompt = AGENT_PROMPTS.get(agent_name, AGENT_PROMPTS["BasicInfoAgent"])
    messages.append(
        SystemMessage(content=f"CURRENT ACTIVE AGENT: {agent_name}\n{agent_prompt}")
    )

    # 3. Identity context
    identity_block = _build_identity_block(insights)
    if identity_block:
        messages.append(SystemMessage(content=identity_block))

    # 4. Already-collected summary (explicit checklist of what NOT to ask)
    already_collected = _build_already_collected_summary(insights)
    messages.append(SystemMessage(content=already_collected))
    print(
        f"[BUILD MESSAGES] Collected data summary injected ({len(already_collected)} chars)"
    )

    # 5. Transition context (if agent just changed)
    if transition_context:
        messages.append(SystemMessage(content=(
            f"AGENT TRANSITION: {transition_context}\n"
            "Start your response with a brief, natural bridge sentence before "
            "asking your first question for this new topic."
        )))

    # 6. Response format reminder
    messages.append(SystemMessage(content=_build_response_reminder(agent_name)))

    # 7. Shared memory (current state — full JSON for tool calling reference)
    compact = _compact_insights(insights)
    state_msg = (
        "SHARED MEMORY (Current State — full data):\n"
        f"{json.dumps(compact, indent=2)}\n\n"
        f"AGENT GOAL: Extract and refine data for {agent_name} category. "
        "Ask about MISSING data only. Do NOT repeat questions about data already collected above."
    )
    messages.append(SystemMessage(content=state_msg))

    # 8. Recent conversation history (last 6 turns)
    for msg in recent_messages[-6:]:
        if msg["role"] == "user":
            messages.append(HumanMessage(content=msg["content"]))
        else:
            # Extract just the conversational text from assistant's JSON response
            text = ""
            content = msg.get("content", "")
            if content:
                try:
                    parsed = json.loads(content)
                    text = (
                        parsed.get("next_question")
                        or parsed.get("question")
                        or parsed.get("response")
                        or ""
                    )
                except (json.JSONDecodeError, TypeError, AttributeError):
                    text = content
            if text and text.strip():
                messages.append(AIMessage(content=text.strip()))

    # 9. Current user message
    messages.append(HumanMessage(content=user_message))

    return messages


def _fallback_extraction(agent_name: str, user_message: str) -> dict:
    """Manual fallback extraction when LLM fails to call tools."""
    extracted = {}
    msg = user_message.strip()
    msg_low = msg.lower()

    # 1. Global Heuristics (Always check these)
    
    # Tasks: keywords + length
    if "task" in msg_low or "responsible" in msg_low or "do " in msg_low:
        potential_tasks = [t.strip() for t in msg.split(",") if len(t.strip()) > 10]
        if potential_tasks:
            extracted["tasks"] = [{"description": t, "frequency": "daily", "category": "technical"} for t in potential_tasks]

    # Tools/Tech: commas + length
    if any(k in msg_low for k in ["use", "tool", "software", "tech"]):
        items = [i.strip() for i in msg.split(",") if 2 < len(i.strip()) < 20]
        if items:
            extracted["tools"] = items

    # 2. Agent-Specific Priority (If not already caught)
    
    if agent_name == "BasicInfoAgent" and not extracted.get("purpose") and len(msg) >= 15:
        extracted["purpose"] = msg

    elif agent_name == "PriorityAgent" and not extracted.get("priority_tasks"):
        items = [i.strip() for i in msg.replace("\n", ",").split(",") if len(i.strip()) > 5]
        if items:
            extracted["priority_tasks"] = items[:3]

    elif agent_name == "DeepDiveAgent" and not extracted.get("workflows"):
        steps = [s.strip() for s in msg.replace("\n", ".").split(".") if len(s.strip()) > 8]
        if len(steps) >= 2:
            extracted["workflows"] = {
                "User Provided": {
                    "steps": steps,
                    "trigger": "User indicated",
                    "output": "Result of process"
                }
            }

    return extracted


# ── Interview Engine ──────────────────────────────────────────────────────────


class InterviewEngine:
    """Core interview logic — usable via LangGraph or directly for streaming."""

    async def run_turn(
        self,
        agent_name: str,
        insights: dict,
        recent_messages: list,
        user_message: str,
        questions_asked: list | None = None,
        transition_context: str = "",
    ) -> tuple[dict, str, list]:
        """Execute one interview turn (non-streaming).

        Returns: (extracted_data, response_text, updated_questions_asked)
        """
        questions_asked = questions_asked or []

        messages = build_interview_messages(
            agent_name, insights, recent_messages, user_message, transition_context
        )

        # Step 1: Call LLM with tools — may return tool_calls + content
        response = await _invoke_with_retry(_interview_llm_with_tools, messages)

        # Step 2: Process tool calls (data extraction)
        extracted = {}
        if response.tool_calls:
            for tc in response.tool_calls:
                extracted = merge_tool_call_into_insights(
                    tc["name"], tc["args"], extracted
                )
            logger.info(
                f"[Interview] Tool calls: {[tc['name'] for tc in response.tool_calls]}"
            )

        # Fallback manual extraction
        if not response.tool_calls:
            extracted = _fallback_extraction(agent_name, user_message)

        # Step 3: Get conversational response
        response_text = _extract_text_content(response.content)

        # If Gemini only returned tool calls without content, make a follow-up call
        if not response_text.strip() and response.tool_calls:
            follow_up_msgs = messages + [response]
            for tc in response.tool_calls:
                tc_id = tc.get("id") or tc.get("tool_call_id") or f"call_{tc['name']}"
                follow_up_msgs.append(
                    ToolMessage(content="Data saved successfully.", tool_call_id=tc_id)
                )
            follow_up = await _invoke_with_retry(_response_llm, follow_up_msgs)
            response_text = _extract_text_content(follow_up.content)

        # --- APPLY STRICT VALIDATION PIPELINE ---
        response_text = _strip_tool_code_leaks(response_text)
        response_text = _trim_duplicate_response(response_text)
        response_text = _truncate_if_too_long(response_text)
        response_text = _ensure_ends_with_question(
            response_text, agent_name, insights, {}
        )

        # --- QUESTION DEDUPLICATION ---
        response_text = response_text.strip()
        if _is_question_repeated(response_text, questions_asked):
            print(f"  [DEDUP] ⚠ Question is repeated! Generating alternative.")
            # Try to get a new question by adding a strong instruction
            dedup_msgs = messages + [
                AIMessage(content=response_text),
                HumanMessage(content=(
                    "SYSTEM: Your previous question was already asked. "
                    "Ask a DIFFERENT question about something NOT yet covered. "
                    "Check the DATA ALREADY COLLECTED section."
                )),
            ]
            retry_response = await _invoke_with_retry(_response_llm, dedup_msgs)
            alt_text = _extract_text_content(retry_response.content).strip()
            if alt_text and not _is_question_repeated(alt_text, questions_asked):
                response_text = alt_text
                response_text = _strip_tool_code_leaks(response_text)
                response_text = _trim_duplicate_response(response_text)
                response_text = _truncate_if_too_long(response_text)
                response_text = _ensure_ends_with_question(
                    response_text, agent_name, insights, {}
                )

        # Record the question hash
        q_hash = _compute_question_hash(response_text)
        if q_hash not in questions_asked:
            questions_asked.append(q_hash)

        return extracted, response_text.strip(), questions_asked

    async def run_turn_stream(
        self,
        agent_name: str,
        insights: dict,
        recent_messages: list,
        user_message: str,
        questions_asked: list | None = None,
        transition_context: str = "",
    ) -> AsyncIterator[dict]:
        """Execute one interview turn with streaming.

        Yields: {"type": "extraction", "data": {...}}
                {"type": "chunk", "content": "..."}
                {"type": "done", "extracted": {...}, "full_text": "...", "questions_asked": [...]}
        """
        questions_asked = questions_asked or []

        messages = build_interview_messages(
            agent_name, insights, recent_messages, user_message, transition_context
        )

        # Step 1: Call LLM with tools (NOT streamed — extraction happens fast)
        response = await _invoke_with_retry(_interview_llm_with_tools, messages)

        # Step 2: Process tool calls
        extracted = {}
        if response.tool_calls:
            for tc in response.tool_calls:
                extracted = merge_tool_call_into_insights(
                    tc["name"], tc["args"], extracted
                )
            logger.info(
                f"[Interview Stream] Tool calls: {[tc['name'] for tc in response.tool_calls]}"
            )

        # Fallback manual extraction
        if not response.tool_calls:
            extracted = _fallback_extraction(agent_name, user_message)

        # Step 3: Buffer, Validate, then Stream the conversational response
        full_text = ""
        initial_text = _extract_text_content(response.content)

        if initial_text.strip():
            full_text = initial_text.strip()
        elif response.tool_calls:
            follow_up_msgs = messages + [response]
            for tc in response.tool_calls:
                tc_id = tc.get("id") or tc.get("tool_call_id") or f"call_{tc['name']}"
                follow_up_msgs.append(
                    ToolMessage(content="Data saved successfully.", tool_call_id=tc_id)
                )
            follow_up = await _invoke_with_retry(_response_llm, follow_up_msgs)
            full_text = _extract_text_content(follow_up.content)
        else:
            direct_response = await _invoke_with_retry(_interview_llm, messages)
            full_text = _extract_text_content(direct_response.content)

        # --- APPLY STRICT VALIDATION PIPELINE ---
        full_text = _strip_tool_code_leaks(full_text)
        full_text = _trim_duplicate_response(full_text)
        full_text = _truncate_if_too_long(full_text)
        full_text = _ensure_ends_with_question(full_text, agent_name, insights, {})
        full_text = full_text.strip()

        # --- QUESTION DEDUPLICATION ---
        if _is_question_repeated(full_text, questions_asked):
            print(f"  [DEDUP STREAM] ⚠ Question is repeated! Generating alternative.")
            dedup_msgs = messages + [
                AIMessage(content=full_text),
                HumanMessage(content=(
                    "SYSTEM: Your previous question was already asked. "
                    "Ask a DIFFERENT question about something NOT yet covered."
                )),
            ]
            retry_response = await _invoke_with_retry(_response_llm, dedup_msgs)
            alt_text = _extract_text_content(retry_response.content).strip()
            if alt_text and not _is_question_repeated(alt_text, questions_asked):
                full_text = alt_text
                full_text = _strip_tool_code_leaks(full_text)
                full_text = _trim_duplicate_response(full_text)
                full_text = _truncate_if_too_long(full_text)
                full_text = _ensure_ends_with_question(full_text, agent_name, insights, {})
                full_text = full_text.strip()

        # Record the question hash
        q_hash = _compute_question_hash(full_text)
        if q_hash not in questions_asked:
            questions_asked.append(q_hash)

        # Stream the exact validated string smoothly
        chunk_size = 30
        for i in range(0, len(full_text), chunk_size):
            chunk = full_text[i : i + chunk_size]
            yield {"type": "chunk", "content": chunk}
            await asyncio.sleep(0.02)

        yield {
            "type": "done",
            "extracted": extracted,
            "full_text": full_text,
            "questions_asked": questions_asked,
        }


# Singleton engine
engine = InterviewEngine()


# ── LangGraph Node ────────────────────────────────────────────────────────────


async def interview_node(state: AgentState) -> dict:
    """LangGraph node: run one interview turn."""
    agent_name = state.get("current_agent", "BasicInfoAgent")
    previous_agent = state.get("previous_agent", "")
    insights = dict(state.get("insights", {}))
    user_message = state.get("user_message", "")
    questions_asked = list(state.get("questions_asked", []))

    # Build transition context if agent just changed
    transition_context = ""
    if previous_agent and previous_agent != agent_name:
        from app.agents.router import get_transition_message
        transition_context = get_transition_message(previous_agent, agent_name)

    # Get recent messages from state
    recent = []
    for msg in state.get("messages", [])[-6:]:
        if isinstance(msg, HumanMessage):
            recent.append({"role": "user", "content": msg.content})
        elif isinstance(msg, AIMessage):
            recent.append({"role": "assistant", "content": msg.content})

    extracted, response_text, updated_questions = await engine.run_turn(
        agent_name=agent_name,
        insights=insights,
        recent_messages=recent,
        user_message=user_message,
        questions_asked=questions_asked,
        transition_context=transition_context,
    )

    # Merge extracted data into the session insights
    for key, value in extracted.items():
        if value in (None, "", [], {}):
            continue
        existing = insights.get(key)
        if isinstance(value, list) and isinstance(existing, list):
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
            existing.update(value)
            insights[key] = existing
        else:
            insights[key] = value

    return {
        "insights": insights,
        "extracted_this_turn": extracted,
        "next_question": response_text,
        "questions_asked": updated_questions,
        "messages": [
            HumanMessage(content=user_message),
            AIMessage(content=response_text),
        ],
    }
