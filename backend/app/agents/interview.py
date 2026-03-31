# backend/app/agents/interview.py
"""
Interview Engine — The core interview logic.

Contains:
  1. InterviewEngine class — shared logic for sync and streaming
  2. interview_node() — LangGraph node wrapper
  3. Message building with agent-specific prompts + shared memory
"""

from __future__ import annotations

import asyncio
import json
import logging
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
                wait = 2 ** attempt
                logger.warning(f"LLM retry {attempt + 1}/{max_retries} after {wait}s: {e}")
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
        lines.append(f"  ✓ Role purpose: \"{purpose[:80]}...\"")
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
        task_names = [t.get("description", str(t))[:60] if isinstance(t, dict) else str(t)[:60] for t in tasks[:5]]
        lines.append(f"  ✓ Tasks ({len(tasks)} collected): {', '.join(task_names)}")
        if len(tasks) >= 6:
            lines.append("    → Tasks collection is COMPLETE. Move to priorities.")
        has_data = True

    priorities = insights.get("priority_tasks", [])
    if priorities:
        lines.append(f"  ✓ Priority tasks ({len(priorities)}): {', '.join(str(p)[:40] for p in priorities[:4])}")
        has_data = True

    workflows = insights.get("workflows", {})
    if workflows:
        wf_names = list(workflows.keys())
        lines.append(f"  ✓ Workflows completed ({len(workflows)}): {', '.join(n[:40] for n in wf_names)}")
        # Show which priority tasks still NEED workflows
        if priorities:
            missing_wf = [p for p in priorities if p not in workflows and str(p)[:40] not in [str(w)[:40] for w in wf_names]]
            if missing_wf:
                lines.append(f"  ✗ Workflows MISSING for: {', '.join(str(m)[:40] for m in missing_wf)}")
        has_data = True

    tools = insights.get("tools", [])
    tech = insights.get("technologies", [])
    if tools or tech:
        lines.append(f"  ✓ Tools ({len(tools)}): {', '.join(tools[:5])}")
        lines.append(f"  ✓ Technologies ({len(tech)}): {', '.join(tech[:5])}")
        has_data = True

    skills = insights.get("skills", [])
    if skills:
        lines.append(f"  ✓ Skills ({len(skills)}): {', '.join(skills[:5])}")
        has_data = True

    quals = insights.get("qualifications", {})
    if quals:
        if quals.get("education"):
            lines.append(f"  ✓ Education: {', '.join(quals['education'])}")
        if quals.get("certifications"):
            lines.append(f"  ✓ Certifications: {', '.join(quals['certifications'])}")
        if quals.get("experience_years"):
            lines.append(f"  ✓ Experience: {quals['experience_years']}")
        has_data = True

    if not has_data:
        return "DATA ALREADY COLLECTED: Nothing yet. This is the first turn."

    lines.append("\nYour NEXT question must be about something NOT listed above.")
    return "\n".join(lines)


def build_interview_messages(
    agent_name: str,
    insights: dict,
    recent_messages: list,
    user_message: str,
) -> list:
    """Build the LLM message stack for the current agent."""
    messages = []

    # 1. Base prompt + orchestrator
    messages.append(SystemMessage(content=BASE_PROMPT))
    messages.append(SystemMessage(content=ORCHESTRATOR_PROMPT))

    # 2. Active agent prompt
    agent_prompt = AGENT_PROMPTS.get(agent_name, AGENT_PROMPTS["BasicInfoAgent"])
    messages.append(SystemMessage(content=f"CURRENT ACTIVE AGENT: {agent_name}\n{agent_prompt}"))

    # 3. Identity context
    identity_block = _build_identity_block(insights)
    if identity_block:
        messages.append(SystemMessage(content=identity_block))

    # 4. Already-collected summary (explicit checklist of what NOT to ask)
    already_collected = _build_already_collected_summary(insights)
    messages.append(SystemMessage(content=already_collected))

    # 5. Shared memory (current state — full JSON for tool calling reference)
    compact = _compact_insights(insights)
    state_msg = (
        "SHARED MEMORY (Current State — full data):\n"
        f"{json.dumps(compact, indent=2)}\n\n"
        f"AGENT GOAL: Extract and refine data for {agent_name} category. "
        "Ask about MISSING data only. Do NOT repeat questions about data already collected above."
    )
    messages.append(SystemMessage(content=state_msg))

    # 6. Recent conversation history (last 6 turns)
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
                    # Try multiple possible keys for the question text
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

    # 7. Current user message
    messages.append(HumanMessage(content=user_message))

    return messages


# ── Interview Engine ──────────────────────────────────────────────────────────


class InterviewEngine:
    """Core interview logic — usable via LangGraph or directly for streaming."""

    async def run_turn(
        self,
        agent_name: str,
        insights: dict,
        recent_messages: list,
        user_message: str,
    ) -> tuple[dict, str]:
        """Execute one interview turn (non-streaming).

        Returns: (extracted_data, response_text)
        """
        messages = build_interview_messages(agent_name, insights, recent_messages, user_message)

        # Step 1: Call LLM with tools — may return tool_calls + content
        response = await _invoke_with_retry(_interview_llm_with_tools, messages)

        # Step 2: Process tool calls (data extraction)
        extracted = {}
        if response.tool_calls:
            for tc in response.tool_calls:
                extracted = merge_tool_call_into_insights(
                    tc["name"], tc["args"], extracted
                )
            logger.info(f"[Interview] Tool calls: {[tc['name'] for tc in response.tool_calls]}")

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

        if not response_text.strip():
            response_text = "Could you tell me more about your role?"

        return extracted, response_text.strip()

    async def run_turn_stream(
        self,
        agent_name: str,
        insights: dict,
        recent_messages: list,
        user_message: str,
    ) -> AsyncIterator[dict]:
        """Execute one interview turn with streaming.

        Yields: {"type": "extraction", "data": {...}}
                {"type": "chunk", "content": "..."}
                {"type": "done", "extracted": {...}, "full_text": "..."}
        """
        messages = build_interview_messages(agent_name, insights, recent_messages, user_message)

        # Step 1: Call LLM with tools (NOT streamed — extraction happens fast)
        response = await _invoke_with_retry(_interview_llm_with_tools, messages)

        # Step 2: Process tool calls
        extracted = {}
        if response.tool_calls:
            for tc in response.tool_calls:
                extracted = merge_tool_call_into_insights(
                    tc["name"], tc["args"], extracted
                )
            logger.info(f"[Interview Stream] Tool calls: {[tc['name'] for tc in response.tool_calls]}")

        # Step 3: Stream the conversational response
        full_text = ""

        initial_text = _extract_text_content(response.content)
        if initial_text.strip():
            # Gemini returned content WITH tool calls — stream it in chunks
            full_text = initial_text.strip()
            chunk_size = 30
            for i in range(0, len(full_text), chunk_size):
                chunk = full_text[i:i + chunk_size]
                yield {"type": "chunk", "content": chunk}
                await asyncio.sleep(0.02)
        elif response.tool_calls:
            # Need a follow-up call — stream that
            follow_up_msgs = messages + [response]
            for tc in response.tool_calls:
                tc_id = tc.get("id") or tc.get("tool_call_id") or f"call_{tc['name']}"
                follow_up_msgs.append(
                    ToolMessage(content="Data saved successfully.", tool_call_id=tc_id)
                )
            async for chunk in _response_llm.astream(follow_up_msgs):
                chunk_text = _extract_text_content(chunk.content)
                if chunk_text:
                    full_text += chunk_text
                    yield {"type": "chunk", "content": chunk_text}
                    await asyncio.sleep(0.02)
        else:
            # No tool calls, no content — stream directly
            async for chunk in _interview_llm.astream(messages):
                chunk_text = _extract_text_content(chunk.content)
                if chunk_text:
                    full_text += chunk_text
                    yield {"type": "chunk", "content": chunk_text}
                    await asyncio.sleep(0.02)

        if not full_text.strip():
            full_text = "Could you tell me more about your role?"

        yield {"type": "done", "extracted": extracted, "full_text": full_text.strip()}


# Singleton engine
engine = InterviewEngine()


# ── LangGraph Node ────────────────────────────────────────────────────────────


async def interview_node(state: AgentState) -> dict:
    """LangGraph node: run one interview turn."""
    agent_name = state.get("current_agent", "BasicInfoAgent")
    insights = dict(state.get("insights", {}))
    user_message = state.get("user_message", "")

    # Get recent messages from state
    recent = []
    for msg in state.get("messages", [])[-6:]:
        if isinstance(msg, HumanMessage):
            recent.append({"role": "user", "content": msg.content})
        elif isinstance(msg, AIMessage):
            recent.append({"role": "assistant", "content": msg.content})

    # run_turn returns extracted data as a SEPARATE dict — merge_tool_call_into_insights
    # was already called inside run_turn, so 'extracted' contains the merged structure
    extracted, response_text = await engine.run_turn(
        agent_name=agent_name,
        insights=insights,
        recent_messages=recent,
        user_message=user_message,
    )

    # Merge extracted data into the session insights
    # extracted is already structured correctly by merge_tool_call_into_insights,
    # so we do a simple deep merge here
    for key, value in extracted.items():
        if value in (None, "", [], {}):
            continue
        existing = insights.get(key)
        if isinstance(value, list) and isinstance(existing, list):
            seen = {json.dumps(v, sort_keys=True, default=str) if isinstance(v, dict) else str(v) for v in existing}
            for item in value:
                item_key = json.dumps(item, sort_keys=True, default=str) if isinstance(item, dict) else str(item)
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
        "messages": [
            HumanMessage(content=user_message),
            AIMessage(content=response_text),
        ],
    }
