# backend/app/agents/graph.py
"""
LangGraph StateGraph — wires all nodes together.

Graph topology (single pass per user message):
   START → router → interview → gap_detector → END

The graph is compiled once and reused for all sessions.
For streaming, the InterviewEngine is called directly (not via LangGraph)
to preserve SSE chunk delivery.
"""

from __future__ import annotations

import json
import logging
from typing import AsyncIterator

from langgraph.graph import StateGraph, END, START
from typing import Any

from app.agents.state import AgentState, create_initial_state
from app.agents.router import (
    router_node,
    compute_current_agent,
    compute_progress,
    get_transition_message,
)
from app.agents.interview import (
    basic_info_node,
    workflow_identifier_node,
    deep_dive_node,
    tools_node,
    skills_node,
    qualification_node,
    jd_generator_node,
    engine as interview_engine,
)
from app.agents.gap_detector import gap_detector_node


logger = logging.getLogger(__name__)


def _build_graph() -> Any:
    """Build and compile the interview state graph."""
    graph = StateGraph(AgentState)  # type: ignore[bad-specialization]

    # Add nodes
    graph.add_node("router", router_node)
    graph.add_node("basic_info", basic_info_node)
    graph.add_node("workflow_identifier", workflow_identifier_node)
    graph.add_node("deep_dive", deep_dive_node)
    graph.add_node("tools", tools_node)
    graph.add_node("skills", skills_node)
    graph.add_node("qualification", qualification_node)
    graph.add_node("jd_generator", jd_generator_node)
    graph.add_node("gap_detector", gap_detector_node)

    # Helper for conditional routing
    def route_to_agent(state: AgentState):
        return state.get("current_agent", "BasicInfoAgent")

    # Wire edges
    graph.add_edge(START, "router")

    # Conditional routing from router to specific agent nodes
    graph.add_conditional_edges(
        "router",
        route_to_agent,
        {
            "BasicInfoAgent": "basic_info",
            "WorkflowIdentifierAgent": "workflow_identifier",
            "DeepDiveAgent": "deep_dive",
            "ToolsAgent": "tools",
            "SkillsAgent": "skills",
            "QualificationAgent": "qualification",
            "JDGeneratorAgent": "jd_generator",
        },
    )

    # All agent nodes flow into gap_detector
    for node in [
        "basic_info",
        "workflow_identifier",
        "deep_dive",
        "tools",
        "skills",
        "qualification",
        "jd_generator",
    ]:
        graph.add_edge(node, "gap_detector")

    graph.add_edge("gap_detector", END)

    return graph.compile()


# Compile once, reuse for all sessions
_compiled_graph = _build_graph()


# ── Entry Points (called from jd_service.py) ──────────────────────────────────


async def run_interview_turn(
    session_memory,
    user_message: str,
    history: list,
) -> tuple[str, list]:
    """Execute one interview turn via LangGraph (non-streaming).

    Args:
        session_memory: SessionMemory instance (hydrated from DB)
        user_message: The user's message text
        history: Conversation history from the request

    Returns:
        (reply_json_string, updated_history)
    """
    # Build initial state from session memory
    insights = dict(session_memory.insights or {})
    initial_state = create_initial_state(
        user_message=user_message,
        insights=insights,
        identity_context=insights.get("identity_context", {}),
        current_agent=session_memory.current_agent or "BasicInfoAgent",
        previous_agent=session_memory.current_agent or "BasicInfoAgent",
        turn_count=len(session_memory.full_history) // 2,
        progress=dict(session_memory.progress or {}),
        messages=[],
        questions_asked=list(getattr(session_memory, "questions_asked", []) or []),
        agent_transition_log=list(
            getattr(session_memory, "agent_transition_log", []) or []
        ),
        visited_tasks=list(getattr(session_memory, "visited_tasks", []) or []),
        active_deep_dive_task=getattr(session_memory, "active_deep_dive_task", None),
        conversation_summary=getattr(session_memory, "conversation_summary", ""),
        agent_turn_counts=dict(getattr(session_memory, "agent_turn_counts", {}) or {}),
    )

    # Run the graph
    result = await _compiled_graph.ainvoke(initial_state)

    # Detect and log agent transitions
    old_agent = session_memory.current_agent
    new_agent = result.get("current_agent", old_agent)
    if new_agent != old_agent:
        session_memory.record_agent_transition(old_agent, new_agent)
        logger.info(f"[Graph] Agent transition: {old_agent} → {new_agent}")

    # Update session memory from result
    session_memory.insights = result.get("insights", session_memory.insights)
    session_memory.current_agent = new_agent
    session_memory.progress = result.get("progress", session_memory.progress)
    session_memory.questions_asked = result.get(
        "questions_asked", session_memory.questions_asked
    )
    session_memory.visited_tasks = result.get("visited_tasks", [])
    session_memory.active_deep_dive_task = result.get("active_deep_dive_task")
    session_memory.conversation_summary = result.get("conversation_summary", "")
    session_memory.agent_turn_counts = result.get("agent_turn_counts", {})

    # Record the question
    next_q = result.get("next_question", "")
    if next_q:
        session_memory.record_question(next_q)

    # Build the response JSON matching frontend contract
    response_json = _build_frontend_response(result, session_memory)
    reply_content = json.dumps(response_json, separators=(",", ":"))

    # Update conversation history
    session_memory.update_recent("user", user_message)
    session_memory.update_recent("assistant", reply_content)

    history.append({"role": "user", "content": user_message})
    history.append({"role": "assistant", "content": reply_content})

    logger.info(f"[Graph] Turn completed — Agent: {session_memory.current_agent}")

    return reply_content, history


async def run_interview_turn_stream(
    session_memory,
    user_message: str,
) -> AsyncIterator[str]:
    """Execute one interview turn with SSE streaming.

    Yields SSE-formatted strings: data: {"type": "chunk|done|error", ...}

    Uses the InterviewEngine directly (not LangGraph) for streaming support.
    """
    try:
        # 1. Compute current agent
        old_agent = session_memory.current_agent or "BasicInfoAgent"
        agent_name = compute_current_agent(session_memory.insights or {}, old_agent)

        # 2. Detect transition
        transition_context = ""
        if agent_name != old_agent:
            transition_context = get_transition_message(old_agent, agent_name)
            session_memory.record_agent_transition(old_agent, agent_name)
            logger.info(f"[Graph Stream] Agent transition: {old_agent} → {agent_name}")

        session_memory.current_agent = agent_name

        # 3. Get recent messages for context
        recent_messages = session_memory.recent_messages[-10:]

        # 4. Get questions already asked (for deduplication)
        questions_asked = list(getattr(session_memory, "questions_asked", []) or [])
        previous_questions_text = list(
            getattr(session_memory, "previous_questions_text", []) or []
        )

        # 5. Stream the interview turn
        full_text = ""
        insights: dict = dict(session_memory.insights or {})

        async for event in interview_engine.run_turn_stream(
            agent_name=agent_name,
            insights=dict(session_memory.insights or {}),
            recent_messages=recent_messages,
            user_message=user_message,
            questions_asked=questions_asked,
            transition_context=transition_context,
            previous_questions_text=previous_questions_text,
        ):
            if event["type"] == "chunk":
                yield f"data: {json.dumps({'type': 'chunk', 'content': event['content']}, separators=(',', ':'))}\n\n"

            elif event["type"] == "done":
                insights = event.get("insights") or insights
                full_text = event.get("full_text", "")
                # Update questions_asked and previous_questions_text from engine
                session_memory.questions_asked = event.get(
                    "questions_asked", questions_asked
                )
                # Persist question texts for cross-session semantic dedup
                if full_text:
                    session_memory.previous_questions_text.append(full_text)
                    # Keep bounded to last 20
                    session_memory.previous_questions_text = (
                        session_memory.previous_questions_text[-20:]
                    )

                # Update iterative helpers
                session_memory.visited_tasks = insights.get("visited_tasks", [])
                session_memory.active_deep_dive_task = insights.get(
                    "active_deep_dive_task"
                )
                session_memory.conversation_summary = insights.get(
                    "conversation_summary", ""
                )
                session_memory.agent_turn_counts = insights.get("agent_turn_counts", {})
                session_memory.insights = insights

        # 7. Run gap detection (lightweight, no LLM call)
        from app.agents.gap_detector import gap_detector_node as _gap_check

        gap_state = {
            "messages": [],
            "user_message": "",
            "current_agent": session_memory.current_agent,
            "previous_agent": "",
            "turn_count": 0,
            "insights": session_memory.insights,
            "identity_context": {},
            "extracted_this_turn": {},
            "questions_asked": [],
            "agent_transition_log": [],
            "gaps": [],
            "quality_score": 0,
            "ready_for_jd": False,
            "progress": {},
        }
        # pyrefly: ignore [bad-argument-type]
        gap_result = await _gap_check(gap_state)  # pyright: ignore

        # 8. Update session memory — capture the agent the ENGINE actually used.
        # The interview engine does its own mid-turn routing internally.
        # We must read the engine's final agent from insights to avoid double-routing
        # which inflates turn counts and can skip phases like WorkflowIdentifierAgent.
        engine_agent = (
            insights.get("_engine_current_agent") or session_memory.current_agent
        )
        insights.pop("_engine_current_agent", None)  # Clean up internal key

        # Only re-route if the engine didn't already transition
        if engine_agent == session_memory.current_agent:
            # Engine didn't transition — check if we should advance now
            new_agent = compute_current_agent(
                session_memory.insights, session_memory.current_agent
            )
        else:
            # Engine already transitioned — trust its routing
            new_agent = engine_agent
            logger.info(f"[Graph Stream] Trusting engine transition to: {new_agent}")

        if new_agent != session_memory.current_agent:
            session_memory.record_agent_transition(
                session_memory.current_agent, new_agent
            )
        session_memory.current_agent = new_agent
        session_memory.progress = compute_progress(insights, new_agent)

        # Record the question
        if full_text:
            session_memory.record_question(full_text)

        # 9. Build and send final response
        result = {
            "insights": insights,
            "current_agent": session_memory.current_agent,
            "progress": session_memory.progress,
            "next_question": full_text,
            "ready_for_jd": gap_result.get("ready_for_jd", False),
            "suggested_skills": gap_result.get("suggested_skills", []),
            "suggested_tools": gap_result.get("suggested_tools", []),
            "gaps": gap_result.get("gaps", []),
            "quality_score": gap_result.get("quality_score", 0),
        }

        response_json = _build_frontend_response(result, session_memory)

        # Update conversation history
        reply_content = json.dumps(response_json, separators=(",", ":"))
        session_memory.update_recent("user", user_message)
        session_memory.update_recent("assistant", reply_content)

        yield f"data: {json.dumps({'type': 'done', 'parsed': response_json})}\n\n"

    except Exception as e:
        error_msg = str(e)
        logger.error(f"[Graph Stream] Error: {error_msg}")
        import traceback

        traceback.print_exc()

        is_rate_limit = (
            "429" in error_msg
            or "quota" in error_msg.lower()
            or "resource_exhausted" in error_msg.lower()
        )

        payload = {"type": "error", "message": error_msg}
        if is_rate_limit:
            payload["is_rate_limit"] = "true"
        yield f"data: {json.dumps(payload)}\n\n"

    logger.info(
        f"[Graph Stream] Turn completed — Agent: {session_memory.current_agent}"
    )


# ── Response Builder ──────────────────────────────────────────────────────────


def _with_selection_fallback(
    next_question: str,
    *,
    current_agent: str,
    task_list: list[dict],
    suggested_tools: list[str],
    suggested_skills: list[str],
) -> str:
    """Append a compact plain-text inventory summary so the UI degrades gracefully.

    NOTE: WorkflowIdentifierAgent, ToolsAgent, and SkillsAgent handle their own
    structured UI rendering — do NOT append summaries to their responses.
    Only append for conversational agents as a fallback.
    """
    # For structured selection agents, return the question as-is
    # The frontend will render task_list, suggested_tools, or suggested_skills separately
    if current_agent in ("WorkflowIdentifierAgent", "ToolsAgent", "SkillsAgent"):
        return next_question.strip()

    # For other agents, optionally append a compact fallback (kept for safety)
    suffix = ""
    if task_list and current_agent not in ("WorkflowIdentifierAgent",):
        items = ", ".join(task["description"] for task in task_list[:3])
        suffix = f" Key tasks: {items}."

    if not suffix or suffix.strip() in next_question:
        return next_question
    return f"{next_question.rstrip()} {suffix}".strip()


def _build_frontend_response(result: dict, session_memory) -> dict:
    """Build the response JSON matching the frontend's expected contract."""
    insights = result.get("insights", {})
    progress = result.get("progress", session_memory.progress)
    current_agent = result.get("current_agent", session_memory.current_agent)

    # Build task_list for WorkflowIdentifierAgent phase
    task_list = []
    logger.info(f"[Graph] Building response. Current Agent: {current_agent}")

    if current_agent == "WorkflowIdentifierAgent":
        raw_tasks = insights.get("tasks", [])
        logger.info(
            f"[Graph] Building task list for WorkflowIdentifierAgent. Raw count: {len(raw_tasks)}, types: {[type(t).__name__ for t in raw_tasks[:3]]}"
        )
        if not raw_tasks:
            raw_tasks = insights.get("basic_info", {}).get("tasks", [])
            logger.info(f"[Graph] Fallback to basic_info.tasks: {len(raw_tasks)} items")

        for t in raw_tasks:
            desc = ""
            if isinstance(t, dict):
                desc = t.get("description") or t.get("name") or t.get("task") or ""
            else:
                desc = str(t)

            if not desc.strip():
                continue

            desc_lower = desc.lower().strip()
            is_conversational = (
                desc_lower.startswith(
                    (
                        "would you",
                        "can you",
                        "please tell",
                        "tell me about",
                        "should i",
                        "could you",
                        "what are",
                        "how do",
                    )
                )
                and "?" in desc
            )
            if is_conversational:
                logger.warning(
                    f"[Graph] Filtering conversational leak from task_list: {desc}"
                )
                continue

            if isinstance(t, dict):
                task_list.append(
                    {
                        "description": desc,
                        "frequency": t.get("frequency", "regular"),
                        "category": t.get("category", "technical"),
                    }
                )
            else:
                task_list.append(
                    {
                        "description": desc,
                        "frequency": "regular",
                        "category": "operational",
                    }
                )

        logger.info(f"[Graph] Final task_list count for frontend: {len(task_list)}")

    final_jd = insights.get("final_jd", {})

    # ✅ INITIALIZE these BEFORE using them
    suggested_skills = []
    suggested_tools = []

    # ✅ ONLY populate for their respective agents
    if current_agent == "ToolsAgent":
        suggested_tools = result.get("suggested_tools", [])
        logger.info(f"[Graph] ToolsAgent: Showing {len(suggested_tools)} tools")
    elif current_agent == "SkillsAgent":
        suggested_skills = result.get("suggested_skills", [])
        logger.info(f"[Graph] SkillsAgent: Showing {len(suggested_skills)} skills")
    # For all other agents, they remain empty []

    next_question = _with_selection_fallback(
        result.get("next_question", ""),
        # pyrefly: ignore [bad-argument-type]
        current_agent=current_agent,
        task_list=task_list,
        suggested_tools=suggested_tools,
        # pyrefly: ignore [bad-argument-type, unbound-name]
        suggested_skills=suggested_skills,
    )

    return {
        "next_question": next_question,
        "progress": progress,
        "employee_role_insights": insights,
        "jd_structured_data": final_jd.get("jd_structured_data", {}),
        "jd_text_format": final_jd.get("jd_text_format", ""),
        "suggested_skills": suggested_skills,
        "suggested_tools": suggested_tools,
        "task_list": task_list,
        "current_agent": current_agent,
        "analytics": {
            "questions_asked": len(session_memory.full_history) // 2,
            "questions_answered": len(
                [m for m in session_memory.full_history if m.get("role") == "user"]
            ),
            "insights_collected": len(
                [v for v in insights.values() if v not in (None, {}, [], "")]
            ),
            "estimated_completion_time_minutes": max(
                5,
                # pyrefly: ignore [missing-attribute]
                15 - int(progress.get("completion_percentage", 0)) // 10,
            ),
        },
        "approval": {
            "approval_required": False,
            "approval_status": "pending",
        },
    }
