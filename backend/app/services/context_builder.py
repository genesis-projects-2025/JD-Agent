# app/services/context_builder.py
from langchain_core.messages import SystemMessage, HumanMessage, AIMessage
from app.prompts.jd_prompts import SYSTEM_PROMPT
import json


def build_context(session_memory, user_message: str) -> list:
    messages = []

    # 1. System prompt
    messages.append(SystemMessage(content=SYSTEM_PROMPT))

    # 2. Accumulated insights — compact, no extra whitespace to save tokens
    insights = session_memory.insights if isinstance(session_memory.insights, dict) else {}
    progress = session_memory.progress if isinstance(session_memory.progress, dict) else {}

    # Compact JSON (no indent) to reduce token usage and avoid truncation
    messages.append(SystemMessage(content=(
        "=== ACCUMULATED DATA (carry ALL forward in your response) ===\n"
        + json.dumps(insights, separators=(",", ":"))
        + "\n=== PROGRESS ===\n"
        + json.dumps(progress, separators=(",", ":"))
        + "\n=== TASK ===\n"
        "Look at ACCUMULATED DATA. Find the first empty domain. Ask ONE question about it. "
        "Never ask about domains that already have data. "
        "Your response employee_role_insights MUST contain ALL fields from ACCUMULATED DATA above."
    )))

    # 3. Summary if exists
    if session_memory.summary:
        messages.append(SystemMessage(content=f"SUMMARY: {session_memory.summary}"))

    # 4. Recent messages — ONLY the human-readable text, never the JSON blobs
    # This is critical: passing full JSON history wastes tokens and confuses the LLM
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