# backend/app/services/context_builder.py

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


def _compact_insights(insights: dict) -> dict:
    """Return only non-empty fields, one level deep for nested dicts."""
    if not isinstance(insights, dict):
        return {}
    result = {}
    for k, v in insights.items():
        if v in (None, {}, [], ""):
            continue
        if isinstance(v, dict):
            nested = {nk: nv for nk, nv in v.items() if nv not in (None, {}, [], "")}
            if nested:
                result[k] = nested
        else:
            result[k] = v
    return result


def build_context(session_memory, user_message: str) -> list:
    messages = []

    # ── 1. System prompt ──────────────────────────────────────────────────────
    messages.append(SystemMessage(content=SYSTEM_PROMPT))

    # ── 2. Extract last user message for dynamic follow-up injection ──────────
    last_user_msg = ""
    for msg in reversed(session_memory.full_history):
        if msg.get("role") == "user":
            last_user_msg = msg.get("content", "")[:300]
            break

    # ── 3. Compact accumulated data (only non-empty fields) ───────────────────
    raw_insights = (
        session_memory.insights if isinstance(session_memory.insights, dict) else {}
    )
    progress = (
        session_memory.progress if isinstance(session_memory.progress, dict) else {}
    )
    insights = _compact_insights(raw_insights)

    # ── 4. Honest FILLED / MISSING check ─────────────────────────────────────
    wr = insights.get("working_relationships", {})
    if not isinstance(wr, dict):
        wr = {}

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
    current_status = progress.get("status", "collecting")

    # ── 5. Build next action with dynamic follow-up ───────────────────────────
    if current_status == "ready_for_generation":
        next_action = (
            "ALL fields collected. Status is ready_for_generation.\n"
            "DO NOT ask any more data questions.\n"
            "Ask the employee to confirm JD generation: "
            "'I now have everything I need. Shall I generate your Job Description?'\n"
            "Set suggested_skills to the full list from employee_role_insights.skills + tools.\n"
            "Keep status = ready_for_generation."
        )
    elif not missing:
        # Use cached user history text instead of re-scanning full_history
        full_check_text = f"{session_memory.user_history_text} {user_message.lower()}"
        is_ready_status = (
            session_memory.progress.get("status") == "ready_for_generation"
        )
        skills_confirmed = (
            "confirm these required skills" in full_check_text
            or "confirm" in full_check_text
            or is_ready_status
        )
        if not skills_confirmed:
            next_action = (
                "All fields are now filled. In your next response:\n"
                "1. Set status = ready_for_generation\n"
                "2. Provide the full list of suggested_skills (technical skills + tools only, NO soft skills)\n"
                "3. Ask the employee to confirm if these skills are correct."
            )
        else:
            next_action = (
                "All fields filled and skills confirmed. In your next response:\n"
                "1. Set status = ready_for_generation\n"
                "2. Do NOT provide suggested_skills anymore\n"
                "3. Ask the employee to confirm JD generation."
            )
    else:
        first_missing = missing[0] if missing else "unknown"
        if last_user_msg:
            next_action = (
                f"NEXT FIELD TO COLLECT: '{first_missing}'\n\n"
                f'The user\'s last message was: "{last_user_msg}"\n\n'
                f"IMPORTANT: Frame your question by referencing something SPECIFIC from what they just said above.\n"
                f"Do NOT ask a generic template question — make it about THEIR specific context.\n"
                f"Example: if they said 'I manage the PMT pipeline', ask about what handoff looks like in THEIR pipeline.\n"
                f"Do NOT ask about anything already in FILLED below."
            )
        else:
            next_action = (
                f"NEXT FIELD TO COLLECT: '{first_missing}'\n"
                f"Ask ONE focused question about this field."
            )

    status_note = (
        f"FILLED  ({len(filled)}/10): {', '.join(filled) or 'nothing yet'}\n"
        f"MISSING ({len(missing)}/10): {', '.join(missing) or 'all done!'}\n"
        f"CURRENT STATUS: {current_status}"
    )

    messages.append(
        SystemMessage(
            content=(
                "=== FILLED DATA (do NOT re-ask these fields) ===\n"
                + json.dumps(insights, separators=(",", ":"))
                + "\n\n=== COLLECTION STATUS ===\n"
                + status_note
                + "\n\n=== YOUR NEXT ACTION ===\n"
                + next_action
            )
        )
    )

    # ── 6. Session summary (if exists) ────────────────────────────────────────
    if session_memory.summary:
        messages.append(
            SystemMessage(
                content=f"CONVERSATION SUMMARY (older turns): {session_memory.summary}"
            )
        )

    # ── 7. Recent conversation turns — TEXT ONLY, no JSON blobs ──────────────
    for msg in session_memory.recent_messages:
        if msg["role"] == "user":
            messages.append(HumanMessage(content=msg["content"]))
        else:
            # Extract only the conversation_response text — never send full JSON to LLM
            text = ""
            try:
                parsed = json.loads(msg["content"])
                text = parsed.get("conversation_response", "")
            except Exception:
                text = msg["content"]
            if text and text.strip():
                messages.append(AIMessage(content=text.strip()))

    # ── 8. Current user message ───────────────────────────────────────────────
    messages.append(HumanMessage(content=user_message))

    return messages
