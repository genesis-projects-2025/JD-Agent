# app/services/context_builder.py
from langchain_core.messages import SystemMessage, HumanMessage, AIMessage
from app.prompts.jd_prompts import SYSTEM_PROMPT
import json


def strip_empty(d):
    """Recursively remove empty values from dicts/lists to save tokens."""
    if isinstance(d, dict):
        return {k: strip_empty(v) for k, v in d.items() if v not in (None, {}, [], "")}
    if isinstance(d, list):
        return [strip_empty(i) for i in d if i not in (None, {}, [], "")]
    return d


def build_context(session_memory, user_message: str) -> list:
    messages = []

    # 1. System prompt
    messages.append(SystemMessage(content=SYSTEM_PROMPT))

    # 2. Accumulated insights — strip empty fields to save tokens and avoid context overflow
    raw_insights = session_memory.insights if isinstance(session_memory.insights, dict) else {}
    progress = session_memory.progress if isinstance(session_memory.progress, dict) else {}
    insights = strip_empty(raw_insights)

    messages.append(SystemMessage(content=(
        "=== ACCUMULATED DATA (carry ALL forward in your response) ===\n"
        + json.dumps(insights, separators=(",", ":"))
        + "\n=== PROGRESS ===\n"
        + json.dumps(progress, separators=(",", ":"))
        + "\n=== TASK ===\n"
        "Look at ACCUMULATED DATA. Find the first empty domain. Ask EXACTLY ONE question about it. "
        "NEVER ask two questions in one response. "
        "Never ask about domains that already have data. "
        "Your response employee_role_insights MUST contain ALL fields from ACCUMULATED DATA above."
    )))

    # 3. Summary if exists
    if session_memory.summary:
        messages.append(SystemMessage(content=f"SUMMARY: {session_memory.summary}"))

    # 4. Recent messages — ONLY the human-readable text, never the JSON blobs
    for msg in session_memory.recent_messages:
        if msg["role"] == "user":
            messages.append(HumanMessage(content=msg["content"]))
        else:
            try:
                parsed = json.loads(msg["content"])
                text = parsed.get("conversation_response", "")
            except Exception:
                text = msg["content"]
            messages.append(AIMessage(content=text))

    # 5. Current message
    messages.append(HumanMessage(content=user_message))

    return messages