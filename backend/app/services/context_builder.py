# backend/app/services/context_builder.py
#
# Agent-aware context builder — sends ORCHESTRATOR_PROMPT + current agent prompt + relevant context.
# FIXES:
#   1. Identity context (title, dept, location, reports_to) injected explicitly
#   2. Assistant history correctly reads "next_question" key (was "conversation_response")

from langchain_core.messages import SystemMessage, HumanMessage, AIMessage
from app.prompts.jd_prompts import (
    BASE_PROMPT, 
    ORCHESTRATOR_PROMPT, 
    BASIC_INFO_AGENT_PROMPT, 
    TASK_AGENT_PROMPT, 
    PRIORITY_AGENT_PROMPT,
    WORKFLOW_DEEP_DIVE_AGENT_PROMPT, 
    TOOLS_TECH_AGENT_PROMPT, 
    SKILL_EXTRACTION_AGENT_PROMPT,
    QUALIFICATION_AGENT_PROMPT
)
import json

AGENT_PROMPTS = {
    "BasicInfoAgent": BASIC_INFO_AGENT_PROMPT,
    "TaskAgent": TASK_AGENT_PROMPT,
    "PriorityAgent": PRIORITY_AGENT_PROMPT,
    "WorkflowDeepDiveAgent": WORKFLOW_DEEP_DIVE_AGENT_PROMPT,
    "ToolsTechAgent": TOOLS_TECH_AGENT_PROMPT,
    "SkillExtractionAgent": SKILL_EXTRACTION_AGENT_PROMPT,
    "QualificationAgent": QUALIFICATION_AGENT_PROMPT
}

def _compact_insights(insights: dict) -> dict:
    """Return only non-empty fields."""
    if not isinstance(insights, dict):
        return {}
    return {k: v for k, v in insights.items() if v not in (None, {}, [], "")}


def _build_identity_block(insights: dict) -> str:
    """Build a pre-filled identity context block from init data."""
    identity = insights.get("identity_context", {})
    if not identity:
        return ""
    
    lines = ["PRE-FILLED EMPLOYEE INFORMATION (already known — do NOT ask for these again):"]
    field_map = {
        "employee_name": "Employee Name",
        "title": "Job Title / Designation",
        "department": "Department",
        "location": "Location",
        "reports_to": "Reports To",
        "email": "Email",
        "phone": "Phone",
        "date_of_joining": "Date of Joining",
    }
    for key, label in field_map.items():
        val = identity.get(key)
        if val:
            lines.append(f"  - {label}: {val}")
    
    if len(lines) <= 1:
        return ""
    
    lines.append("\nDo NOT ask the user for any of the above fields. They are already confirmed.")
    return "\n".join(lines)


def build_context(session_memory, user_message: str) -> list:
    """Build the LLM message list for the current active agent."""
    messages = []
    agent_name = session_memory.current_agent or "BasicInfoAgent"

    # 1. Base Prompt & Orchestrator context
    messages.append(SystemMessage(content=BASE_PROMPT))
    messages.append(SystemMessage(content=ORCHESTRATOR_PROMPT))

    # 2. Active Agent specific instructions
    agent_prompt = AGENT_PROMPTS.get(agent_name, BASIC_INFO_AGENT_PROMPT)
    messages.append(SystemMessage(content=f"CURRENT ACTIVE AGENT: {agent_name}\n{agent_prompt}"))

    # 3. Inject Identity Context (pre-filled from DB/init)
    raw_insights = session_memory.insights if isinstance(session_memory.insights, dict) else {}
    identity_block = _build_identity_block(raw_insights)
    if identity_block:
        messages.append(SystemMessage(content=identity_block))

    # 4. Inject Shared Memory (Global State)
    compact_data = _compact_insights(raw_insights)
    
    state_msg = (
        "SHARED MEMORY (Current State):\n"
        f"{json.dumps(compact_data, indent=2)}\n\n"
        f"AGENT GOAL: Extract and refine data for {agent_name} category. "
        "Refer back to what they just said."
    )
    messages.append(SystemMessage(content=state_msg))

    # 5. Recent conversation history (extract assistant text correctly)
    for msg in session_memory.recent_messages[-6:]:
        if msg["role"] == "user":
            messages.append(HumanMessage(content=msg["content"]))
        else:
            text = ""
            try:
                parsed = json.loads(msg["content"])
                # The assistant stores replies under "next_question"
                text = parsed.get("next_question", "")
            except Exception:
                text = msg["content"]
            if text and text.strip():
                messages.append(AIMessage(content=text.strip()))

    # 6. Current user message
    messages.append(HumanMessage(content=user_message))

    return messages
