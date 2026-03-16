# backend/app/services/context_builder.py
#
# WHAT CHANGED:
#  - Uses the new flat insight fields: purpose, responsibilities,
#    working_relationships, skills, tools, education, experience
#  - KPIs / performance_metrics removed from status check and context
#  - Collection order in STATUS NOTE mirrors SYSTEM_PROMPT Step 1-12

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
    messages = []

    # ── 1. System prompt ──────────────────────────────────────────────────────
    messages.append(SystemMessage(content=SYSTEM_PROMPT))

    # ── 2. Accumulated data block ─────────────────────────────────────────────
    raw_insights = (
        session_memory.insights if isinstance(session_memory.insights, dict) else {}
    )
    progress = (
        session_memory.progress if isinstance(session_memory.progress, dict) else {}
    )
    insights = _strip_empty(raw_insights)

    # Working relationships sub-dict (handle both flat and nested)
    wr = insights.get("working_relationships", {})
    if not isinstance(wr, dict):
        wr = {}

    # ── Honest FILLED / MISSING check (mirrors RULE 8 scoring) ───────────────
    def _filled(label: str, value) -> tuple:
        ok = bool(value) and value not in ("", [], {})
        return (label, ok)

    checks = [
        _filled("purpose", insights.get("purpose")),
        _filled(
            "responsibilities (need 8+)",
            len(insights.get("responsibilities", [])) >= 8
            if isinstance(insights.get("responsibilities"), list)
            else False,
        ),
        _filled("reporting_to", wr.get("reporting_to")),
        _filled("team_size", wr.get("team_size")),
        _filled("internal_stakeholders", wr.get("internal_stakeholders")),
        _filled("external_stakeholders", wr.get("external_stakeholders")),
        _filled(
            "skills (need 4+)",
            len(insights.get("skills", [])) >= 4
            if isinstance(insights.get("skills"), list)
            else False,
        ),
        _filled("tools", insights.get("tools")),
        _filled("education", insights.get("education")),
        _filled("experience", insights.get("experience")),
    ]

    filled = [label for label, ok in checks if ok]
    missing = [label for label, ok in checks if not ok]

    status_note = (
        f"FILLED  ({len(filled)}/10): {', '.join(filled) or 'nothing yet'}\n"
        f"MISSING ({len(missing)}/10): {', '.join(missing) or 'all done!'}"
    )

    messages.append(
        SystemMessage(
            content=(
                "=== ACCUMULATED DATA (copy ALL of this into employee_role_insights) ===\n"
                + json.dumps(insights, separators=(",", ":"))
                + "\n\n=== PROGRESS ===\n"
                + json.dumps(progress, separators=(",", ":"))
                + "\n\n=== COLLECTION STATUS ===\n"
                + status_note
                + "\n\n=== YOUR NEXT ACTION ===\n"
                "Look at MISSING above. Ask ONE question about the FIRST missing item.\n"
                "Do NOT ask about anything already in FILLED.\n"
                "Your response employee_role_insights MUST contain every field from "
                "ACCUMULATED DATA — never drop or blank a field that already has a value."
            )
        )
    )

    # ── 3. Session summary (if exists) ────────────────────────────────────────
    if session_memory.summary:
        messages.append(
            SystemMessage(
                content=f"CONVERSATION SUMMARY (older turns): {session_memory.summary}"
            )
        )

    # ── 4. Recent conversation turns (text only — no raw JSON blobs) ──────────
    for msg in session_memory.recent_messages:
        if msg["role"] == "user":
            messages.append(HumanMessage(content=msg["content"]))
        else:
            # Extract just the human-readable response, not the full JSON blob
            try:
                parsed = json.loads(msg["content"])
                text = parsed.get("conversation_response", "")
            except Exception:
                text = msg["content"]
            if text:
                messages.append(AIMessage(content=text))

    # ── 5. Current user message ───────────────────────────────────────────────
    messages.append(HumanMessage(content=user_message))

    return messages
