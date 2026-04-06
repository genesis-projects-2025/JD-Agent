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
from app.agents.prompts import BASE_PROMPT, AGENT_PROMPTS
from app.agents.tools import (
    merge_tool_call_into_insights,
    save_basic_info, save_tasks, save_priority_tasks,
    save_workflow, save_tools_tech, save_skills, save_qualifications
)

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
        "BasicInfoAgent": _get_basic_info_fallback_question(insights),
        "WorkflowIdentifierAgent": "Of all the tasks we discussed, which 3-5 would you say have the biggest business impact?",
        "DeepDiveAgent": _get_workflow_fallback_question(insights),
        "ToolsAgent": "What key tools or software do you rely on?",
        "SkillsAgent": "What underlying technical skills do you use for these tasks?",
        "QualificationAgent": "What education or certifications are required for this role?",
    }
    fallback = fallback_questions.get(agent_name, "Could you tell me more about that?")

    if not response_text or not response_text.strip():
        print(
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

    print(
        f"  [VALIDATE] ✗ Response does NOT end with a question! Appending fallback (agent={agent_name})"
    )

    if stripped.endswith((".", "!", ",", "-")):
        return f"{stripped} {fallback}"
    return f"{stripped}. {fallback}"


def _get_basic_info_fallback_question(insights: dict) -> str:
    """Generate a contextual fallback question for the BasicInfoAgent."""
    if not insights.get("purpose"):
        return "For example, I help manage vendor relationships. Could you describe the main purpose your role serves?"
    if not insights.get("tasks"):
        return "Could you tell me more about your typical daily, weekly, or occasional tasks?"
    return "Are there any other key responsibilities we might have missed?"


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
    return "Could you elaborate on the specific steps, tools used, and the ultimate output of this task?"


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
            print(
                "  [TRIM] ✓ First paragraph has question — trimming extra paragraphs."
            )
            return first_para

        if len(paragraphs) >= 2 and "?" in paragraphs[1]:
            print("  [TRIM] ✓ Question in 2nd para — keeping first two.")
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
                print(
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

def _get_tools_for_agent(agent_name: str) -> list:
    """Return only the tools allowed for the active agent."""
    mapping = {
        "BasicInfoAgent": [save_basic_info, save_tasks],
        "WorkflowIdentifierAgent": [save_priority_tasks],
        "DeepDiveAgent": [save_workflow],
        "ToolsAgent": [save_tools_tech],
        "SkillsAgent": [save_skills],
        "QualificationAgent": [save_qualifications],
        "JDGeneratorAgent": []
    }
    return mapping.get(agent_name, [])

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


def _apply_context_filter(insights: dict, agent_name: str) -> dict:
    """Filter insights to provide only relevant data for the current agent."""
    if agent_name == "BasicInfoAgent":
        return {k: insights.get(k) for k in ["purpose", "tasks"] if k in insights}
    elif agent_name == "WorkflowIdentifierAgent":
        return {
            k: insights.get(k)
            for k in ["purpose", "tasks", "priority_tasks"]
            if k in insights
        }
    elif agent_name == "DeepDiveAgent":
        return {
            k: insights.get(k)
            for k in [
                "priority_tasks",
                "workflows",
                "active_deep_dive_task",
                "visited_tasks",
                "deep_dive_turn_count",
            ]
            if k in insights
        }
    elif agent_name == "ToolsAgent":
        # Sees workflows, tasks (to context), role title, and currently extracted tools
        extracted_tools = []
        for wf in insights.get("workflows", {}).values():
            if wf.get("tools"):
                t = wf["tools"]
                if isinstance(t, list):
                    extracted_tools.extend(t)
                else:
                    extracted_tools.append(t)
        
        return {
            "role_title": insights.get("identity_context", {}).get("title", ""),
            "previously_mentioned_tools": list(set(extracted_tools)),
            "workflows": insights.get("workflows", {}),
            "tools": insights.get("tools", []),
        }
    elif agent_name == "SkillsAgent":
        # Sees everything relevant to infer skills
        return {
            "role_title": insights.get("identity_context", {}).get("title", ""),
            "workflows": insights.get("workflows", {}),
            "tasks": insights.get("tasks", []),
            "tools": insights.get("tools", []),
            "skills": insights.get("skills", []),
        }
    elif agent_name == "QualificationAgent":
        return {k: insights.get(k) for k in ["qualifications"] if k in insights}
    return insights


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


def _build_already_collected_summary(insights: dict, agent_name: str) -> str:
    """Build a siloed summary of what data has been collected for the active agent.
    
    Ensures that the LLM only sees the 'checkmarks' for the data categories it is 
    actually responsible for, maintaining the isolation architecture.
    """
    lines = [f"MISSION DATA STATUS ({agent_name}):"]
    has_relevant_data = False

    if agent_name == "BasicInfoAgent":
        purpose = insights.get("purpose", "")
        if purpose:
            lines.append(f'  ✓ Role mission: "{purpose[:60]}..."')
            has_relevant_data = True
        tasks = insights.get("tasks", [])
        if tasks:
            lines.append(f"  ✓ Activities ({len(tasks)}): {', '.join(str(t)[:40] for t in tasks[:3])}...")
            if len(tasks) >= 6:
                lines.append("    [STATUS: MISSION COMPLETE - DO NOT ASK FOR MORE ACTIVITIES]")
            has_relevant_data = True

    elif agent_name == "WorkflowIdentifierAgent":
        tasks = insights.get("tasks", [])
        priorities = insights.get("priority_tasks", [])
        if tasks:
            lines.append(f"  ✓ Tasks available: {len(tasks)}")
        if priorities:
            lines.append(f"  ✓ Priority selection: {', '.join(str(p)[:40] for p in priorities)}")
            if len(priorities) >= 3:
                lines.append("    [STATUS: SELECTION COMPLETE - DO NOT ASK TO PICK MORE]")
            has_relevant_data = True

    elif agent_name == "DeepDiveAgent":
        priorities = insights.get("priority_tasks", [])
        workflows = insights.get("workflows", {})
        active = insights.get("active_deep_dive_task")
        if priorities:
            lines.append(f"  ✓ Total roadmap: {len(priorities)} tasks")
        if workflows:
            lines.append(f"  ✓ Deep dives done: {', '.join(str(w)[:30] for w in workflows.keys())}")
        if active:
            lines.append(f"  ➜ ACTIVE FOCUS: \"{active}\"")
        has_relevant_data = True

    elif agent_name == "ToolsAgent":
        tools = insights.get("tools", [])
        mentioned = insights.get("previously_mentioned_tools", [])
        if mentioned:
            lines.append(f"  ✓ Inferred from workflows: {', '.join(str(m) for m in mentioned[:5])}")
        if tools:
            lines.append(f"  ✓ Confirmed inventory: {', '.join(str(t) for t in tools[:5])}")
        if len(tools) >= 3:
            lines.append("    [STATUS: SUFFICIENT DATA]")
        has_relevant_data = True

    elif agent_name == "SkillsAgent":
        skills = insights.get("skills", [])
        if skills:
            lines.append(f"  ✓ Technical skills: {', '.join(str(s) for s in skills[:5])}")
            if len(skills) >= 3:
                lines.append("    [STATUS: SUFFICIENT DATA]")
        has_relevant_data = True

    elif agent_name == "QualificationAgent":
        quals = insights.get("qualifications", {})
        if quals:
            if quals.get("education"):
                lines.append(f"  ✓ Education: {quals['education']}")
            if quals.get("experience_years"):
                lines.append(f"  ✓ Experience: {quals['experience_years']} years")
            has_relevant_data = True

    if not has_relevant_data:
        return f"ALREADY COLLECTED ({agent_name}): Nothing yet for this specialist mission."

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
    **kwargs,
) -> list:
    """Build the LLM message stack for the current agent."""
    messages = []

    print(f"\n{'=' * 60}")
    print(f"[BUILD MESSAGES] Agent: {agent_name}")
    print(f"[BUILD MESSAGES] Turn user message: {user_message[:80]}...")
    print(f"[BUILD MESSAGES] Recent messages count: {len(recent_messages)}")

    # 1. Base prompt (Orchestrator removed for specialist silos)
    messages.append(SystemMessage(content=BASE_PROMPT))

    # 2. Active agent prompt (Formatted with real-time state)
    agent_prompt_raw = AGENT_PROMPTS.get(agent_name, AGENT_PROMPTS["BasicInfoAgent"])
    
    # Extract dynamic values for placeholders
    tasks_list = insights.get("tasks", [])
    task_count = len(tasks_list)
    mentioned_tools = _apply_context_filter(insights, agent_name).get("previously_mentioned_tools", [])
    mentioned_tools_str = ", ".join(mentioned_tools) if mentioned_tools else "the software mentioned"
    
    # Apply interpolation
    agent_prompt = agent_prompt_raw.replace("{task_count}", str(task_count))
    agent_prompt = agent_prompt.replace("{previously_mentioned_tools}", mentioned_tools_str)

    # 2b. Inject RAG context if available
    retrieved_context = kwargs.get("retrieved_context", [])
    context_block = ""
    if retrieved_context:
        examples = "\n\n".join([f"- {ex}" for ex in retrieved_context])
        context_block = (
            "\n\n═══ COMPANY STANDARDS & EXAMPLES ═══\n"
            "Based on other approved JDs in the company/department, here are professional examples. "
            "Use these to suggest relevant items if the user is unsure or provides shallow answers:\n"
            f"{examples}\n"
        )

    messages.append(
        SystemMessage(
            content=f"CURRENT ACTIVE AGENT: {agent_name}\n{agent_prompt}{context_block}"
        )
    )

    # 3. Identity context
    identity_block = _build_identity_block(insights)
    if identity_block:
        messages.append(SystemMessage(content=identity_block))

    # 4. Already-collected summary (Agent-specific checklist)
    already_collected = _build_already_collected_summary(insights, agent_name)
    messages.append(SystemMessage(content=already_collected))
    print(
        f"[BUILD MESSAGES] {agent_name} data status injected ({len(already_collected)} chars)"
    )

    # 5. Transition context (if agent just changed)
    if transition_context:
        messages.append(
            SystemMessage(
                content=(
                    f"AGENT TRANSITION: {transition_context}\n"
                    "Start your response with a brief, natural bridge sentence before "
                    "asking your first question for this new topic."
                )
            )
        )

    # 6. Response format reminder
    messages.append(SystemMessage(content=_build_response_reminder(agent_name)))

    # 7. First-turn greeting (if history is empty)
    if not recent_messages:
        messages.append(
            SystemMessage(
                content=(
                    "FIRST TURN: This is the very beginning of the interview. "
                    "GREET the user warmly as Saniya, a Senior HR Specialist at Pulse Pharma. "
                    "Set a professional yet collaborative tone before asking your first question "
                    "about the role's primary mission/purpose."
                )
            )
        )

    # 8. Shared memory (Strict Context Isolated — only fields this agent needs)
    filtered_insights = _apply_context_filter(insights, agent_name)
    compact = _compact_insights(filtered_insights)
    
    state_msg = (
        f"SPECIALIST MEMORY WINDOW ({agent_name}):\n"
        f"{json.dumps(compact, indent=2)}\n\n"
        "You ONLY have access to the data above. Focus strictly on your mission."
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

    # 9. Gaps (Strictly Mission-Filtered context — only show gaps this agent can fix)
    # Mapping of agent to the gap categories it is responsible for
    mission_categories = {
        "BasicInfoAgent": ["purpose", "tasks"],
        "WorkflowIdentifierAgent": ["priority_tasks"],
        "DeepDiveAgent": ["workflows"],
        "ToolsAgent": ["tools"],
        "SkillsAgent": ["skills"],
        "QualificationAgent": ["qualifications"],
    }
    
    agent_mission_cats = mission_categories.get(agent_name, [])
    gaps = insights.get("gaps", [])
    relevant_gaps = [g for g in gaps if g["category"] in agent_mission_cats]
    
    if relevant_gaps:
        gap_block = (
            "CRITICAL DATA GAPS (YOUR MISSION ONLY):\n"
            + "\n".join([f"- {g['category']}: {g['reason']}" for g in relevant_gaps])
            + "\n\nAddress these gaps before proceeding."
        )
        messages.append(SystemMessage(content=gap_block))
        
    # 10. Current user message
    messages.append(HumanMessage(content=user_message))

    return messages


def _fallback_extraction(agent_name: str, user_message: str) -> dict:
    """Manual fallback extraction when LLM fails to call tools."""
    extracted = {}
    msg = user_message.strip()
    msg_low = msg.lower()

    # Check for explicit confirmation signals
    if "confirmed" in msg_low or "proceed" in msg_low:
        if agent_name == "ToolsAgent":
            extracted["tools_confirmed"] = True
        elif agent_name == "SkillsAgent":
            extracted["skills_confirmed"] = True

    # 1. Global Heuristics (Always check these)

    # Tasks: keywords + length
    if "task" in msg_low or "responsible" in msg_low or "do " in msg_low:
        potential_tasks = [t.strip() for t in msg.split(",") if len(t.strip()) > 10]
        if potential_tasks:
            extracted["tasks"] = [
                {"description": t, "frequency": "daily", "category": "technical"}
                for t in potential_tasks
            ]

    # Tools/Tech: commas + length
    if any(k in msg_low for k in ["use", "tool", "software", "tech"]):
        items = [i.strip() for i in msg.split(",") if 2 < len(i.strip()) < 20]
        if items:
            extracted["tools"] = items

    # 2. Agent-Specific Priority (If not already caught)

    if (
        agent_name == "BasicInfoAgent"
        and not extracted.get("purpose")
        and len(msg) >= 15
    ):
        extracted["purpose"] = msg

    elif agent_name == "PriorityAgent" and not extracted.get("priority_tasks"):
        items = [
            i.strip() for i in msg.replace("\n", ",").split(",") if len(i.strip()) > 5
        ]
        if items:
            extracted["priority_tasks"] = items[:3]

    elif agent_name == "DeepDiveAgent" and not extracted.get("workflows"):
        steps = [
            s.strip() for s in msg.replace("\n", ".").split(".") if len(s.strip()) > 8
        ]
        if len(steps) >= 2:
            extracted["workflows"] = {
                "User Provided": {
                    "steps": steps,
                    "trigger": "User indicated",
                    "output": "Result of process",
                }
            }

    return extracted


class InterviewEngine:
    """Core interview logic — usable via LangGraph or directly for streaming."""

    async def _get_rag_context(self, insights: dict, agent_name: str) -> list[str]:
        """Surgically retrieve relevant JD snippets from Pinecone based on current agent phase."""
        from app.services.vector_service import query_advanced_context

        # 1. Map agent to specific RAG category
        block_types = {
            "BasicInfoAgent": "role_summary",
            "WorkflowIdentifierAgent": "responsibilities",
            "DeepDiveAgent": ["responsibilities", "workflow", "performance_metrics", "projects"],
            "ToolsAgent": ["tools", "workflow"], # Tools often appear in workflows
            "SkillsAgent": "skills",
            "QualificationAgent": "qualification",
        }
        b_type = block_types.get(agent_name, "role_summary")

        # 2. Extract metadata filters from memory
        id_ctx = insights.get("identity_context", {})
        role_title = id_ctx.get("title", "") or insights.get("purpose", "")
        dept = id_ctx.get("department")

        # Guess experience level for sharper filtering
        exp_level = "Mid"
        title_lower = str(role_title).lower()
        if any(k in title_lower for k in ["junior", "associate", "trainee", "entry", "intern"]):
            exp_level = "Junior"
        elif any(k in title_lower for k in ["senior", "sr.", "lead", "staff", "architect"]):
            exp_level = "Senior"
        elif any(k in title_lower for k in ["manager", "head", "director", "vp"]):
            exp_level = "Expert"

        # 3. Perform surgical retrieval
        return await query_advanced_context(
            role_query=role_title,
            block_type=b_type,
            experience_level=exp_level,
            department=dept,
            top_k=5
        )

    def _pre_process_iteration_state(self, insights: dict, agent_name: str) -> dict:
        """Manage active_deep_dive_task and visited_tasks for iterative workflow."""
        if agent_name != "DeepDiveAgent":
            return insights

        priority_tasks = insights.get("priority_tasks", [])
        visited_tasks = insights.get("visited_tasks", [])
        active_task = insights.get("active_deep_dive_task")
        turn_count = insights.get("deep_dive_turn_count", 0)

        # 1. If currently in workflows correctly, check for completion
        if active_task and active_task in insights.get("workflows", {}):
            wf = insights["workflows"][active_task]
            # Minimal criteria for "visited": has an output or 3 steps
            # or we hit the maximum allowed turns per task (2 to 3)
            if (wf.get("output") and wf.get("tools")) or turn_count >= 2:
                if active_task not in visited_tasks:
                    visited_tasks.append(active_task)
                    insights["visited_tasks"] = visited_tasks
                # Force pick next one
                active_task = None
                turn_count = 0
            else:
                turn_count += 1
        elif active_task:
            turn_count += 1

        insights["deep_dive_turn_count"] = turn_count

        # 2. If no active task (or just completed one), pick first non-visited priority
        if not active_task:
            for pt in priority_tasks:
                if pt not in visited_tasks:
                    insights["active_deep_dive_task"] = pt
                    insights["deep_dive_turn_count"] = 1
                    break
        else:
            # Sync active_task from tool call if insights has it
            insights["active_deep_dive_task"] = active_task

        return insights

    
    def _merge_extracted_to_insights(self, extracted: dict, insights: dict) -> dict:
        """Consolidated logic to merge newly extracted data into existing session insights."""
        for key, value in extracted.items():
            if value in (None, "", [], {}):
                continue
            
            existing = insights.get(key)
            
            if isinstance(value, list) and isinstance(existing, list):
                # Standard list deduplication merge
                seen = {
                    json.dumps(v, sort_keys=True, default=str) if isinstance(v, dict) else str(v)
                    for v in existing
                }
                for item in value:
                    item_key = json.dumps(item, sort_keys=True, default=str) if isinstance(item, dict) else str(item)
                    if item_key not in seen:
                        existing.append(item)
                        seen.add(item_key)
                insights[key] = existing
            elif isinstance(value, dict) and isinstance(existing, dict):
                # Merge dictionaries
                existing.update(value)
                insights[key] = existing
            else:
                # Overwrite primitives
                insights[key] = value
        return insights

    def _compress_memory(self, recent_messages: list, turn_count: int) -> list:
        """Compress old messages if token count or turn count becomes high."""
        if len(recent_messages) <= 4:
            return recent_messages

        # Summary of older turns if needed
        # For now, just keep the most recent 4 turns to ensure precision
        return recent_messages[-4:]

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

        # Step 0: Advanced RAG Retrieval
        retrieved_context = await self._get_rag_context(insights, agent_name)

        # Pre-process iteration state (active_deep_dive_task)
        insights = self._pre_process_iteration_state(insights, agent_name)

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

        # Step 1: Call LLM with tools — may return tool_calls + content
        agent_tools = _get_tools_for_agent(agent_name)
        if agent_tools:
            agent_specific_llm = _interview_llm.bind_tools(agent_tools)
        else:
            agent_specific_llm = _interview_llm
            
        response = await _invoke_with_retry(agent_specific_llm, messages)

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
            # Merge extracted data INTO insights immediately so they are available for next turn/logic
            insights = self._merge_extracted_to_insights(extracted, insights)

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
            print("  [DEDUP] ⚠ Question is repeated! Generating alternative.")
            # Try to get a new question by adding a strong instruction
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

        return extracted, insights, response_text.strip(), questions_asked

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

        # Step 0: Advanced RAG Retrieval
        retrieved_context = await self._get_rag_context(insights, agent_name)

        # Pre-process iteration state (active_deep_dive_task)
        insights = self._pre_process_iteration_state(insights, agent_name)

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

        # Step 1: Call LLM with tools (NOT streamed — extraction happens fast)
        agent_tools = _get_tools_for_agent(agent_name)
        if agent_tools:
            agent_specific_llm = _interview_llm.bind_tools(agent_tools)
        else:
            agent_specific_llm = _interview_llm
            
        response = await _invoke_with_retry(agent_specific_llm, messages)

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
            # CRITICAL: Merge extracted data INTO insights immediately for streaming persistence
            insights = self._merge_extracted_to_insights(extracted, insights)
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

            # Silent agents (Tools, Skills, JD) should NOT ask questions
            silent_agents = ["ToolsAgent", "SkillsAgent", "JDGeneratorAgent"]
            instruction = (
                "Provide a professional and concise summary. DO NOT ASK ANY QUESTIONS."
                if agent_name in silent_agents
                else "Acknowledge the user's input smoothly. Based on your AGENT GOAL, ask the NEXT logical question. YOU MUST ALWAYS INCLUDE A QUESTION IN YOUR RESPONSE."
            )
            follow_up_msgs.append(SystemMessage(content=instruction))

            follow_up = await _invoke_with_retry(_response_llm, follow_up_msgs)
            full_text = _extract_text_content(follow_up.content)
        else:
            direct_response = await _invoke_with_retry(_interview_llm, messages)
            full_text = _extract_text_content(direct_response.content)

        print("\n\n" + "*" * 60)
        print("====== RAW LLM RESPONSE (BEFORE PROCESSING) ======")
        print(repr(full_text))  # Using repr() to expose invisible characters/newlines
        print("*" * 60 + "\n\n")

        # --- APPLY STRICT VALIDATION PIPELINE ---
        full_text = _strip_tool_code_leaks(full_text)
        full_text = _trim_duplicate_response(full_text)
        full_text = _truncate_if_too_long(full_text)
        full_text = _ensure_ends_with_question(full_text, agent_name, insights, {})
        full_text = full_text.strip()

        # --- QUESTION DEDUPLICATION ---
        if _is_question_repeated(full_text, questions_asked):
            print("  [DEDUP STREAM] ⚠ Question is repeated! Generating alternative.")
            dedup_msgs = messages + [
                AIMessage(content=full_text),
                HumanMessage(
                    content=(
                        "SYSTEM: Your previous question was already asked. "
                        "Ask a DIFFERENT question about something NOT yet covered."
                    )
                ),
            ]
            retry_response = await _invoke_with_retry(_response_llm, dedup_msgs)
            alt_text = _extract_text_content(retry_response.content).strip()
            if alt_text and not _is_question_repeated(alt_text, questions_asked):
                full_text = alt_text
                full_text = _strip_tool_code_leaks(full_text)
                full_text = _trim_duplicate_response(full_text)
                full_text = _truncate_if_too_long(full_text)
                full_text = _ensure_ends_with_question(
                    full_text, agent_name, insights, {}
                )
                full_text = full_text.strip()

        # Record the question hash
        q_hash = _compute_question_hash(full_text)
        if q_hash not in questions_asked:
            questions_asked.append(q_hash)

        # Print state to console securely for live debugging
        import pprint

        print("\n" + "=" * 60)
        print(">>> [USER MESSAGE]:")
        print(user_message)
        print("\n>>> [EXTRACTED THIS TURN]:")
        pprint.pprint(extracted, width=100)
        print("\n>>> [TOTAL MEMORY STATE]:")
        pprint.pprint(
            {
                "purpose": insights.get("purpose", ""),
                "tasks_count": len(insights.get("tasks", [])),
                "priority_tasks": insights.get("priority_tasks", []),
                "workflows": list(insights.get("workflows", {}).keys()),
                "tools": insights.get("tools", []),
                "skills": insights.get("skills", []),
                "visited_tasks": insights.get("visited_tasks", []),
            },
            width=100,
        )
        print("\n>>> [AGENT RESPONSE]:")
        print(full_text)
        print("=" * 60 + "\n")

        # Stream the exact validated string smoothly
        chunk_size = 30
        for i in range(0, len(full_text), chunk_size):
            chunk = full_text[i : i + chunk_size]
            yield {"type": "chunk", "content": chunk}
            await asyncio.sleep(0.02)

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

    # Build transition context if agent just changed
    transition_context = ""
    if previous_agent and previous_agent != agent_name:
        from app.agents.router import get_transition_message

        transition_context = get_transition_message(previous_agent, agent_name)

    # Get recent messages from state
    recent = []
    for msg in state.get("messages", [])[-4:]:  # Keep it tight
        if isinstance(msg, HumanMessage):
            recent.append({"role": "user", "content": msg.content})
        elif isinstance(msg, AIMessage):
            recent.append({"role": "assistant", "content": msg.content})

    extracted, updated_insights, response_text, updated_questions = await engine.run_turn(
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
