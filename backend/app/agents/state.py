# backend/app/agents/state.py
"""
LangGraph shared state — the single structure that flows through all nodes.
"""

from __future__ import annotations

from typing import TypedDict, Annotated
from langchain_core.messages import BaseMessage
from langgraph.graph.message import add_messages


class AgentState(TypedDict):
    """Shared state for the LangGraph interview orchestrator.

    Every node reads from and writes to this dict. LangGraph automatically
    merges partial updates returned by each node.
    """

    # ── Conversation ──────────────────────────────────────────────────────
    messages: Annotated[list[BaseMessage], add_messages]
    user_message: str  # Current user input (raw text)

    # ── Agent Control ─────────────────────────────────────────────────────
    current_agent: str   # Active agent name (e.g. "TaskAgent")
    turn_count: int      # Total conversation turns in this session

    # ── Extracted Data (Shared Memory) ────────────────────────────────────
    insights: dict        # Master data store — accumulated across all agents
    identity_context: dict  # Pre-filled from DB (name, dept, title, etc.)
    extracted_this_turn: dict  # Data extracted in the CURRENT turn only

    # ── Quality Tracking ──────────────────────────────────────────────────
    gaps: list            # Current gaps identified by GapDetector
    quality_score: int    # 0-100 overall data quality
    ready_for_jd: bool   # All agents satisfied?

    # ── Progress (sent to frontend) ───────────────────────────────────────
    progress: dict  # {completion_percentage, status, current_agent, depth_scores}

    # ── Output ────────────────────────────────────────────────────────────
    next_question: str       # The conversational response to send to user
    suggested_skills: list   # Skills panel for frontend


def create_initial_state(
    user_message: str,
    insights: dict | None = None,
    identity_context: dict | None = None,
    current_agent: str = "BasicInfoAgent",
    turn_count: int = 0,
    progress: dict | None = None,
    messages: list | None = None,
) -> AgentState:
    """Create a fresh AgentState for a new turn."""
    return AgentState(
        messages=messages or [],
        user_message=user_message,
        current_agent=current_agent,
        turn_count=turn_count,
        insights=insights or {},
        identity_context=identity_context or {},
        extracted_this_turn={},
        gaps=[],
        quality_score=0,
        ready_for_jd=False,
        progress=progress or {
            "completion_percentage": 0,
            "status": "collecting",
            "current_agent": current_agent,
            "depth_scores": {},
        },
        next_question="",
        suggested_skills=[],
    )
