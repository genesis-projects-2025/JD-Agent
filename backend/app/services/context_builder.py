from langchain_core.messages import SystemMessage, HumanMessage, AIMessage
from app.prompts.jd_prompts import SYSTEM_PROMPT
import json

def _strip_empty(d):
    """Remove null / empty values to keep the context lean."""
    if isinstance(d, dict):
        return {k: _strip_empty(v) for k, v in d.items() if v not in (None, {}, [], "")}
    if isinstance(d, list):
        return [_strip_empty(i) for i in d if i not in (None, {}, [], "")]
    return d

def build_context(session_memory, user_message: str) -> list:
    """Prepares the optimized LangChain message list for the LLM."""
    messages = []
    
    # 1. System Prompt
    messages.append(SystemMessage(content=SYSTEM_PROMPT))

    # 2. Accumulated Data (Insights & Progress)
    raw_insights = session_memory.insights or {}
    insights = _strip_empty(raw_insights)
    progress = session_memory.progress or {}
    
    # Identify missing areas for the agent
    missing = progress.get("missing_insight_areas", [])
    status = progress.get("status", "collecting")
    
    next_action = "Continue the interview."
    if status == "ready_for_generation":
        next_action = "The interview is complete. Ask the user if you should generate the JD now."
    elif missing:
        next_action = f"Focus on collecting the following missing information: {', '.join(missing)}."

    data_context = (
        "### CURRENT INTERVIEW STATE\n"
        f"Insights: {json.dumps(insights, separators=(',', ':'))}\n"
        f"Status: {status}\n"
        f"Next Goal: {next_action}"
    )
    messages.append(SystemMessage(content=data_context))

    # 3. Optimized History
    # We only send the last N turns. Assistant messages are stripped of heavy JSON.
    for msg in session_memory.full_history:
        if msg["role"] == "user":
            messages.append(HumanMessage(content=msg["content"]))
        else:
            try:
                # Extract only the conversation response to save tokens
                data = json.loads(msg["content"])
                content = data.get("conversation_response", msg["content"])
                messages.append(AIMessage(content=content))
            except:
                messages.append(AIMessage(content=msg["content"]))

    # 4. Current User Message
    messages.append(HumanMessage(content=user_message))

    return messages
