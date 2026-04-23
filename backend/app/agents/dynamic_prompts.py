# backend/app/agents/dynamic_prompts.py
"""
Dynamic Prompt Builder — Constructs context-aware prompts based on current phase.

Replaces the static AGENT_PROMPTS with intelligent, state-driven prompt construction.
Ensures zero-filler, naked questions, and high visibility of collected data to prevent repetition.
"""

from __future__ import annotations

import re
from typing import List


# ── Acknowledgment Stripper ───────────────────────────────────────────────────

_ACK_STARTERS = (
    "great", "sure", "perfect", "absolutely", "noted", "thanks", "thank you",
    "understood", "of course", "got it", "i see", "i understand", "certainly",
    "excellent", "good", "wonderful", "alright", "okay", "ok", "right",
    "indeed", "makes sense", "that's clear", "that's helpful", "that helps",
)


def _strip_leading_acknowledgment(text: str, preserve_first_turn_greeting: bool = False) -> str:
    """Remove any leading acknowledgment sentence before the actual question.

    The LLM occasionally generates a short affirmative confirmation before asking
    even with strict instructions. This hard-enforces the no-filler rule.

    Examples stripped:
      "Got it. What triggers this task?"     -> "What triggers this task?"
      "Great, I understand. How does..."    -> "How does..."
      "Perfect. Walk me through..."         -> "Walk me through..."

    Agent status statements (no question mark nearby) are preserved.
    """
    if not text:
        return text

    if preserve_first_turn_greeting:
        return text

    # Split on sentence boundaries
    sentences = re.split(r'(?<=[.!])\s+', text.strip())
    if len(sentences) <= 1:
        return text

    first = sentences[0].lower().strip()

    is_ack_start = any(first.startswith(ack) for ack in _ACK_STARTERS)
    is_short = len(sentences[0].split()) <= 12  # filler sentences are short
    no_question = "?" not in sentences[0]       # filler never contains a question

    if is_ack_start and is_short and no_question:
        remainder = " ".join(sentences[1:]).strip()
        return remainder if remainder else text

    return text

# ── Base Persona ───────────────────────────────────────────────────────────


BASE_PERSONA = """You are a Professional Job Analyst conducting a structured interview to build a high-fidelity Job Description. You sound like a knowledgeable colleague — direct, expert, and focused.

BEHAVIORAL CONTRACT (ABSOLUTE — VIOLATING ANY RULE IS A CRITICAL FAILURE):

RULE 1 — RESPONSE MODE DEPENDS ON THE TURN.
Opening turn only: greet the user professionally, mention the known role/team context, then ask exactly one question.
All later turns: ask exactly one question and start directly with the question itself.
Outside the opening turn, absolutely NO greetings, acknowledgments, "Got it", "Great", "I understand", summaries, bridge sentences, examples, or filler of any kind.
If a later-turn response starts with any affirmative sentence (Great, Sure, Perfect, Absolutely, Noted, Thanks, Understood, Of course, Excellent, Alright) — delete that sentence and start with the question.

RULE 2 — NEVER ASK ABOUT DATA ALREADY COLLECTED.
Before forming a question, read the DATA ALREADY COLLECTED section. If information appears there, it is saved. Move forward. Never ask the user to confirm data they already gave.

RULE 3 — SPEAK LIKE A DOMAIN EXPERT.
Adapt your language to the user's specific role and industry. Use precise, grounded professional English. No jargon or consulting speak.
"""


def _get_industry_strategy(insights: dict) -> str:
    """Returns a simple industry strategy for questioning."""
    role = str(
        insights.get("role") or insights.get("identity_context", {}).get("title", "")
    ).lower()
    department = str(
        insights.get("department")
        or insights.get("identity_context", {}).get("department", "")
    ).lower()

    if "software" in role or "engineering" in department or "developer" in role:
        return "Focus on the tools they use, how they build things, and how they work with the team on code."
    if "sales" in role or "business development" in department or "account" in role:
        return "Focus on meeting goals, using the CRM, finding new clients, and managing their area."
    if "market" in role or "marketing" in department:
        return "Focus on running campaigns, tracking results, and the tools they use for social media or ads."
    if (
        "hr" in role
        or "human resources" in department
        or "talent" in role
        or "recruit" in role
    ):
        return "Focus on finding new hires, helping employees, following rules, and using HR software."
    if "data" in role or "analytics" in department:
        return "Focus on how they handle data, the reports they make, and the tools they use to find insights."
    if "product" in role or "design" in role:
        return "Focus on the product roadmap, how they design features, and how they understand what users need."
    if "finance" in role or "account" in role:
        return "Focus on handling money, budgets, using the finance system, and keeping correct records."
    if "operations" in role or "supply" in role or "logistics" in role:
        return "Focus on how things get done, managing vendors, and making sure the process is smooth."
    if "admin" in role or "assist" in role:
        return "Focus on organizing schedules, managing the office, and helping the team with daily tasks."

    return "Focus on the actual daily work, the tools they use, and how they get things done in their specific role."


def _get_role_aware_purpose_probe(identity_context: dict) -> str:
    """
    Generate a role-specific purpose question using the known title and department.
    Returns a direct, context-loaded question — not a generic survey phrase.
    """
    title = str(identity_context.get("title", "")).strip()
    dept = str(identity_context.get("department", "")).strip()
    title_lower = title.lower()
    dept_lower = dept.lower()

    # ── Domain-specific purpose framings ───────────────────────────────────
    if any(k in title_lower for k in ["regulatory", "compliance", "affairs"]):
        return (
            f"As a {title}, what is the core regulatory outcome your role is directly accountable "
            f"for delivering — is it submission approvals, audit readiness, or something else?"
        )
    if any(k in title_lower for k in ["sales", "business development", "account"]):
        return (
            f"As a {title}, what is the primary commercial output your role is measured against — "
            f"revenue targets, pipeline conversion, new account acquisition?"
        )
    if any(
        k in title_lower for k in ["software", "engineer", "developer", "architect"]
    ):
        return (
            f"As a {title} in the {dept} team, what is the primary engineering outcome your work "
            f"contributes to — product features, platform reliability, or developer tooling?"
        )
    if any(k in title_lower for k in ["data", "analyst", "analytics", "scientist"]):
        return (
            f"As a {title}, what business decisions does your analysis directly feed into — "
            f"and who in the org relies on your outputs to act?"
        )
    if any(k in title_lower for k in ["hr", "talent", "recruit", "people"]):
        return (
            f"As a {title} in {dept}, what is the core people outcome your role owns — "
            f"is it hiring velocity, employee lifecycle, or workforce planning?"
        )
    if any(k in title_lower for k in ["finance", "account", "treasury", "controller"]):
        return (
            f"As a {title}, what financial process are you the primary owner of — "
            f"is it reporting accuracy, budgeting cycles, or transaction controls?"
        )
    if any(k in title_lower for k in ["product", "program", "project"]):
        return (
            f"As a {title}, what does delivery success look like for you — "
            f"shipping features on time, stakeholder alignment, or roadmap health?"
        )
    if any(
        k in title_lower for k in ["operations", "supply", "logistics", "procurement"]
    ):
        return (
            f"As a {title} in {dept}, what operational flow are you responsible for keeping "
            f"efficient — is it vendor contracts, inventory movement, or process throughput?"
        )
    if any(k in title_lower for k in ["marketing", "brand", "content", "digital"]):
        return (
            f"As a {title}, what is the campaign or channel output your role is directly "
            f"accountable for — lead generation, brand reach, or conversion?"
        )
    if any(k in title_lower for k in ["manager", "head", "director", "lead"]):
        dept_context = f"in the {dept} team" if dept else ""
        return (
            f"As a {title} {dept_context}, what is the primary outcome your team is "
            f"hired to deliver — and what would break if your role didn't exist?"
        )

    # Fallback — still more targeted than the old generic question
    dept_context = f"in the {dept} team" if dept else ""
    return (
        f"In your role as {title} {dept_context}, what is the single most "
        f"important outcome your work enables for the organization?"
    )


def _get_cadence_probe_from_context(
    purpose: str, tasks: list, identity_context: dict
) -> str:
    """
    Generate a cadence question that references the purpose the user already shared.
    Avoids the blank survey form feel by anchoring to what's known.
    """
    title = str(identity_context.get("title", "your role")).strip()
    purpose_short = (purpose[:60] + "...") if len(purpose) > 60 else purpose

    # If we have some tasks already, ask specifically about what's missing
    task_count = len(tasks) if tasks else 0
    if task_count > 0:
        task_descs = ", ".join(
            (t.get("description", str(t)) if isinstance(t, dict) else str(t))
            for t in tasks[:2]
        )
        return (
            f"Beyond {task_descs}, what else fills your week as a {title} — "
            f"are there recurring reviews, approvals, or reporting cycles that are just as critical?"
        )

    # No tasks yet — anchor to purpose
    if purpose_short:
        return (
            f"For a role centered on {purpose_short}, what does a typical working week look like — "
            f"the daily routines, the weekly checkpoints, and the monthly obligations you own?"
        )

    # Pure fallback
    return (
        f"What does a typical working week look like for you as a {title} — "
        f"the daily routines, the weekly meetings, and the end-of-month deliverables?"
    )


def _build_task_aware_deep_dive_question(
    active_task: str, turn_number: int, identity_context: dict, workflows: dict
) -> str:
    """
    Generate an intelligent, task-specific deep-dive question.
    Uses the task name and role domain to frame a precise, expert-sounding question
    instead of a generic 'what triggers this task?' template.
    """
    title = str(identity_context.get("title", "")).lower()
    dept = str(identity_context.get("department", "")).lower()
    task_lower = active_task.lower() if active_task else ""
    existing_wf = (workflows or {}).get(active_task, {})

    # ── Turn 1: How does this task START? (trigger + input) ────────────────
    if turn_number <= 1:
        # Regulatory / compliance tasks
        if any(
            k in task_lower
            for k in ["submission", "dossier", "regulatory", "approval", "filing"]
        ):
            return (
                f"When a '{active_task}' becomes due, what triggers the process — "
                f"is it a regulatory agency deadline, an internal milestone, or a product change — "
                f"and who hands it off to you to begin?"
            )
        if any(
            k in task_lower for k in ["audit", "inspection", "compliance", "review"]
        ):
            return (
                f"What initiates a '{active_task}' — is it scheduled annually, triggered by an external "
                f"authority, or does a specific event inside the organisation kick it off?"
            )
        # Sales / revenue tasks
        if any(
            k in task_lower
            for k in ["forecast", "pipeline", "quota", "target", "revenue"]
        ):
            return (
                f"What kicks off '{active_task}' — is it a fixed calendar event (month-end/quarter-end), "
                f"a CRM alert, or a request from finance — and what data do you pull first?"
            )
        if any(
            k in task_lower for k in ["demo", "proposal", "pitch", "prospect", "lead"]
        ):
            return (
                f"How does a '{active_task}' get initiated — does it flow from an inbound enquiry, "
                f"a rep request, or does it come directly from your prospecting activity?"
            )
        # Engineering / technical tasks
        if any(
            k in task_lower
            for k in ["deploy", "release", "build", "sprint", "code", "review"]
        ):
            return (
                f"What triggers a '{active_task}' — a Jira ticket, a sprint ceremony, "
                f"a CI pipeline signal, or a direct stakeholder request?"
            )
        if any(
            k in task_lower for k in ["incident", "bug", "issue", "outage", "support"]
        ):
            return (
                f"When '{active_task}' lands on your plate, what's the first signal — "
                f"a monitoring alert, a ticket, a Slack escalation — and what do you look at first?"
            )
        # Data / analytics tasks
        if any(
            k in task_lower
            for k in ["report", "dashboard", "analysis", "insight", "data"]
        ):
            return (
                f"What initiates '{active_task}' — a scheduled run, a stakeholder request, "
                f"or a data anomaly — and what is the primary source you pull from?"
            )
        # HR / people tasks
        if any(
            k in task_lower
            for k in ["hire", "recruit", "onboard", "interview", "appraisal"]
        ):
            return (
                f"How does '{active_task}' get kicked off — is it a headcount approval from the "
                f"business, a replacement need, or a proactive talent plan — and who owns the brief?"
            )
        # Finance tasks
        if any(
            k in task_lower
            for k in ["budget", "invoice", "payroll", "reconcil", "close", "finance"]
        ):
            return (
                f"What triggers '{active_task}' — a calendar deadline, a system alert, "
                f"or a request from a business unit — and what sign-off is needed before you start?"
            )
        # Operations / procurement tasks
        if any(
            k in task_lower
            for k in ["vendor", "purchase", "procurement", "supply", "inventory"]
        ):
            return (
                f"What initiates '{active_task}' — a stock threshold, a business unit requisition, "
                f"or a contract renewal — and who raises it to you?"
            )
        # Generic intelligent fallback — still better than the old template
        return (
            f"When '{active_task}' needs to happen, what is the specific trigger or event that "
            f"starts it — and what information or inputs do you need before you can begin?"
        )

    # ── Turn 2: Anchor to Turn 1 captured data + probe for challenges/quality ────
    elif turn_number == 2:
        known_trigger = existing_wf.get("trigger", "")
        known_steps = existing_wf.get("steps") or []
        known_tools = existing_wf.get("tools") or []

        # Build a precise anchor clause from Turn 1 captured data
        anchor_parts = []
        if known_trigger:
            anchor_parts.append(f"triggered by \u2018{str(known_trigger)[:55]}\u2019")
        if known_steps:
            anchor_parts.append(f"involving \u2018{str(known_steps[0])[:45]}\u2019")
        if known_tools:
            anchor_parts.append(f"using {', '.join(str(t) for t in known_tools[:2])}")
        anchor_clause = (" and ".join(anchor_parts) + " — ") if anchor_parts else ""

        if known_trigger or known_steps:
            if any(k in task_lower for k in ["submission", "dossier", "regulatory", "audit", "compliance", "filing"]):
                return (
                    f"For \u2018{active_task}\u2019 ({anchor_clause}where does the process most commonly hit a wall — "
                    f"missing data from another team, regulatory ambiguity, or timeline compression — "
                    f"and how do you resolve it without derailing the deadline?"
                )
            if any(k in task_lower for k in ["forecast", "pipeline", "revenue", "report", "analysis", "dashboard"]):
                return (
                    f"For \u2018{active_task}\u2019 ({anchor_clause}what is the most common data quality or accuracy "
                    f"issue you encounter, and what does a fully correct output look like when done right?"
                )
            if any(k in task_lower for k in ["deploy", "release", "build", "incident", "bug", "code", "sprint"]):
                return (
                    f"For \u2018{active_task}\u2019 ({anchor_clause}when it hits a blocker — a failed check, "
                    f"a dependency gap, or an escalation — what is your decision process and what does "
                    f"a clean resolution look like?"
                )
            if any(k in task_lower for k in ["hire", "recruit", "onboard", "appraisal", "performance"]):
                return (
                    f"For \u2018{active_task}\u2019 ({anchor_clause}what is the most common bottleneck — "
                    f"candidate quality, stakeholder alignment, or process delays — and how do you keep it on track?"
                )
            # Generic but explicitly anchored
            return (
                f"For \u2018{active_task}\u2019 ({anchor_clause}what is the hardest part to get right, and what "
                f"separates an average outcome from a high-quality one in your judgment?"
            )

        # No Turn 1 data was captured — restart with process steps
        return (
            f"Walk me through the main steps in \u2018{active_task}\u2019 — from when you receive it "
            f"to the point you consider it done. What happens in sequence?"
        )

    # ── Turn 3: Precision gap fill — only missing fields ──────────────────────
    else:
        missing = []
        if not existing_wf.get("trigger"):
            missing.append("how it gets initiated")
        if not existing_wf.get("steps"):
            missing.append("the step-by-step process")
        if not existing_wf.get("output"):
            missing.append("the final deliverable or outcome")

        if missing:
            missing_str = " and ".join(missing)
            return (
                f"For \u2018{active_task}\u2019, we still need {missing_str} — "
                f"can you fill in that part specifically?"
            )
        return f"For \u2018{active_task}\u2019 — what aspect should we revisit or add more depth to?"


# ── Phase-Specific Instructions ──────────────────────────────────────────────


def _build_basic_info_instruction(insights: dict) -> str:
    """
    Dynamically generate BasicInfoAgent instructions using role signals from identity_context.
    Produces targeted, role-aware questions instead of generic HR survey prompts.
    """
    purpose = insights.get("purpose") or ""
    tasks = insights.get("tasks") or []
    turns = (insights.get("agent_turn_counts") or {}).get("BasicInfoAgent", 0)
    cadence_probed = insights.get("cadence_probed", False)
    identity_context = insights.get("identity_context") or {}

    role_title = (
        identity_context.get("title", "") or insights.get("role", "") or "this role"
    )
    dept = identity_context.get("department", "")
    dept_clause = f" in the {dept} team" if dept else ""

    # Scope boundary — absolutely critical
    scope = (
        "\n\nSCOPE BOUNDARY (ABSOLUTE):"
        "\n- Do NOT ask about tools, software, platforms, skills, certifications, or deep process details."
        "\n- Do NOT ask about challenges, problem-solving, or quality standards."
        "\n- Only cover: role purpose, daily work, weekly work, monthly work, and regular responsibilities."
        "\n- If the user mentions tools or skills, silently note them but do NOT follow up."
    )

    turn_note = f"\n\nTURN MANAGEMENT: This is turn {turns} of 5. " + (
        "Final turn — ask one concise broadening question."
        if turns >= 5
        else f"You have {5 - turns} turn(s) remaining."
    )

    # ── TURN 1: Purpose not captured — use role-specific framing ─────────────
    if len(purpose) < 10:
        role_q = _get_role_aware_purpose_probe(identity_context)
        return (
            f"Your goal: Understand the core purpose of the '{role_title}'{dept_clause} role."
            f"\n\nASK EXACTLY THIS QUESTION (or a very close variant that preserves the intent):"
            f"\n  {role_q}"
            f"\n\nThis question is pre-crafted to match their specific role — use it as-is or refine "
            f"only if you have stronger contextual signal from the conversation so far."
            f"{scope}"
        )

    # ── TURN 2: Cadence not yet probed — anchor to their purpose ────────────
    if not cadence_probed:
        cadence_q = _get_cadence_probe_from_context(purpose, tasks, identity_context)
        return (
            f"Your goal: Map the recurring work rhythm of '{role_title}'{dept_clause}."
            f"\n\nASK EXACTLY THIS QUESTION (or a very close variant that preserves the intent):"
            f"\n  {cadence_q}"
            f"\n\nThis anchors on the purpose they already shared. Do NOT substitute with a generic "
            f"'daily/weekly/monthly' survey question. The framing above is intentional."
            f"\nDo NOT repeat tasks already listed in DATA ALREADY COLLECTED."
            f"{scope}"
            f"{turn_note}"
        )

    # ── TURN 3+: Cadence probed, tasks still sparse — probe the gaps ─────────
    if len(tasks) < 4 and turns < 5:
        # Identify what cadence is missing based on collected tasks
        task_freqs = [
            (t.get("frequency", "") if isinstance(t, dict) else "").lower()
            for t in tasks
        ]
        has_daily = any(f in task_freqs for f in ["daily", "every day"])
        has_monthly = any(f in task_freqs for f in ["monthly", "every month"])

        if not has_monthly:
            gap_probe = (
                f"Beyond the day-to-day work of a {role_title}, are there end-of-month "
                f"obligations — reviews, reports, governance activities, or cross-team "
                f"deliverables — that are just as critical to your role?"
            )
        elif not has_daily:
            gap_probe = (
                f"Inside a typical day as a {role_title}, what recurring micro-tasks or "
                f"check-ins happen that aren't captured yet — things you do almost on autopilot?"
            )
        else:
            gap_probe = (
                f"Aside from what we've captured so far, are there project-based or "
                f"ad-hoc activities in your role as {role_title} that are strategically important "
                f"even if they don't happen on a fixed schedule?"
            )

        return (
            f"Your goal: Fill coverage gaps in regular work for '{role_title}'{dept_clause}."
            f"\nThe user has shared {len(tasks)} task(s). Probe for any missing cadence."
            f"\n\nASK EXACTLY THIS QUESTION (or a close variant):"
            f"\n  {gap_probe}"
            f"\nDo NOT repeat tasks already listed in DATA ALREADY COLLECTED."
            f"{scope}"
            f"{turn_note}"
        )

    # ── Final turn: Wrap up ───────────────────────────────────────────────────
    return (
        f"Your goal: Final confirmation pass for '{role_title}'{dept_clause}."
        f"\nAsk ONE brief question about any remaining responsibilities not yet discussed."
        f"\nKeep it short and specific — the system will transition soon."
        f"{scope}"
        f"{turn_note}"
    )


def _build_deep_dive_instruction(insights: dict) -> str:
    """
    Dynamically generate DeepDiveAgent instructions using task name + role domain signals.
    Produces expert-sounding, task-specific questions instead of generic trigger/challenge templates.
    """
    active = insights.get("active_deep_dive_task")
    completed = insights.get("_completed_task")
    turn_number = insights.get("deep_dive_turn_count", 1)
    visited = insights.get("visited_tasks") or []
    identity_context = insights.get("identity_context") or {}
    workflows = insights.get("workflows") or {}

    # Scope boundary
    scope = (
        "\n\nDEEP DIVE RULES:"
        "\n- Every question MUST explicitly name the task you are asking about."
        "\n- Do NOT say 'I am recording' or 'I have noted'. Just ask the next question."
        "\n- Do NOT ask the user which task to discuss. YOU lead the conversation."
        "\n- The question below is pre-crafted for this task's domain — use it as-is or refine only with stronger context."
    )

    if completed and not active:
        # All tasks are done
        return (
            "All priority tasks have been deep-dived."
            "\nThe system will transition to the Tools phase automatically."
            "\nSay: 'All priority tasks have been mapped in detail.'"
        )

    if completed and active:
        # Transitioning from one task to the next — craft intelligent opener for new task
        task_q = _build_task_aware_deep_dive_question(
            active, 1, identity_context, workflows
        )
        return (
            f"'{completed}' is captured. Now deep-diving: '{active}'."
            f"\n\nASK EXACTLY THIS QUESTION (or a close variant):"
            f"\n  {task_q}"
            f"{scope}"
        )

    if not active or active == "None":
        # Pick the first unvisited priority task
        priority_tasks = insights.get("priority_tasks") or []
        for pt in priority_tasks:
            if pt not in visited:
                active = pt
                break
        if not active:
            return "All tasks are visited. Say: 'All priority tasks have been mapped.'"

        task_q = _build_task_aware_deep_dive_question(
            active, 1, identity_context, workflows
        )
        return (
            f"Your goal: Begin deep-diving task: '{active}'."
            f"\n\nASK EXACTLY THIS QUESTION (or a close variant):"
            f"\n  {task_q}"
            f"{scope}"
        )

    # ── Active task in progress — use intelligent turn-based questions ────────
    task_q = _build_task_aware_deep_dive_question(
        active, turn_number, identity_context, workflows
    )

    if turn_number <= 1:
        return (
            f"CURRENT TASK: '{active}' — Turn {turn_number}/3"
            f"\n\nASK EXACTLY THIS QUESTION (or a close variant):"
            f"\n  {task_q}"
            f"{scope}"
        )
    elif turn_number == 2:
        return (
            f"CURRENT TASK: '{active}' — Turn {turn_number}/3"
            f"\n\nASK EXACTLY THIS QUESTION (or a close variant):"
            f"\n  {task_q}"
            f"{scope}"
        )
    else:
        # Turn 3 — conditional gap fill
        wf = workflows.get(active, {})
        missing = []
        if not wf.get("trigger"):
            missing.append("how it gets initiated")
        if not wf.get("steps"):
            missing.append("the step-by-step process")
        if not wf.get("output"):
            missing.append("the final deliverable")

        if missing:
            missing_str = " and ".join(missing)
            return (
                f"CURRENT TASK: '{active}' — Turn {turn_number}/3 (FINAL)"
                f"\n\nASK EXACTLY THIS QUESTION (or a close variant):"
                f"\n  {task_q}"
                f"\n(Focus on: {missing_str})"
                f"{scope}"
            )
        else:
            return (
                f"CURRENT TASK: '{active}' — All data captured."
                f"\nSay: 'Details for {active} are complete.'"
                f"{scope}"
            )


def _build_qualification_instruction(insights: dict) -> str:
    """Dynamically generate QualificationAgent instructions — role-domain-aware."""
    quals = insights.get("qualifications", {})
    edu = quals.get("education", "")
    exp = quals.get("experience_years", "")
    certs = quals.get("certifications", [])
    turns = (insights.get("agent_turn_counts") or {}).get("QualificationAgent", 0)

    identity_context = insights.get("identity_context") or {}
    role_title = (
        identity_context.get("title", "")
        or insights.get("role", "")
        or "this role"
    )
    title_lower = role_title.lower()

    # ── Role-domain-aware education + experience question ───────────────────────────
    if not edu or not exp:
        if any(k in title_lower for k in ["software", "engineer", "developer", "architect", "devops", "sre"]):
            edu_q = (
                f"For a \u2018{role_title}\u2019 — is a Computer Science or Engineering degree a hard requirement, "
                f"or is equivalent hands-on experience accepted, and what is the baseline years of relevant experience?"
            )
        elif any(k in title_lower for k in ["data", "analyst", "scientist", "ml", "ai"]):
            edu_q = (
                f"For \u2018{role_title}\u2019 — is a degree in Statistics, Mathematics, or a quantitative field required, "
                f"or can strong applied experience substitute, and what is the minimum years of experience expected?"
            )
        elif any(k in title_lower for k in ["finance", "account", "treasury", "controller"]):
            edu_q = (
                f"For \u2018{role_title}\u2019 — is a Finance or Accounting degree mandatory, and does the role require a "
                f"professional qualification like CA, CPA, or CFA alongside years of experience?"
            )
        elif any(k in title_lower for k in ["hr", "talent", "recruit", "people"]):
            edu_q = (
                f"For \u2018{role_title}\u2019 — is a degree in HR Management or Psychology required, and are certifications "
                f"like SHRM or CIPD expected or preferred alongside years of experience?"
            )
        elif any(k in title_lower for k in ["regulatory", "compliance", "legal", "affairs"]):
            edu_q = (
                f"For \u2018{role_title}\u2019 — is a law degree or regulatory sciences background required, "
                f"and what is the minimum years of industry-specific experience the role demands?"
            )
        elif any(k in title_lower for k in ["manager", "head", "director", "lead"]):
            edu_q = (
                f"For a \u2018{role_title}\u2019 position — is a specific academic degree required, "
                f"or is demonstrated leadership and domain experience the primary qualifier, and what is the minimum years expected?"
            )
        else:
            edu_q = (
                f"For \u2018{role_title}\u2019 — what is the minimum educational background and how many years of relevant "
                f"professional experience does the role require?"
            )
        return f"Your goal: Capture minimum qualifications for \u2018{role_title}\u2019.\nASK EXACTLY THIS QUESTION:\n  {edu_q}"

    # ── Certification probe — growth-oriented and role-specific ────────────────────
    if (not certs or len(certs) == 0) and turns < 3:
        if any(k in title_lower for k in ["software", "engineer", "developer", "devops", "cloud", "sre"]):
            cert_q = f"Are there any cloud or platform certifications (AWS, GCP, Azure, Kubernetes) that would give a candidate an edge in this \u2018{role_title}\u2019 role, or is the focus mainly on demonstrated project output?"
        elif any(k in title_lower for k in ["data", "analyst", "scientist"]):
            cert_q = f"Are there any data platform or analytics certifications (Databricks, dbt, Google Analytics) that would strengthen a candidate's profile for \u2018{role_title}\u2019?"
        elif any(k in title_lower for k in ["finance", "account"]):
            cert_q = f"Beyond the core qualification, are certifications like CFA, CPA, or FRM expected for \u2018{role_title}\u2019 — or are they recognized but not required?"
        else:
            cert_q = f"Are there any specialized certifications or training programs that would help someone grow into the \u2018{role_title}\u2019 role, even if not mandatory on day one?"
        return f"Your goal: Identify relevant certifications for \u2018{role_title}\u2019.\nASK EXACTLY THIS QUESTION:\n  {cert_q}"

    return (
        f"Your goal: Finalize qualifications for \u2018{role_title}\u2019.\n"
        f"All key qualifications are captured. The system will advance soon."
    )


def _build_workflow_identifier_instruction(insights: dict) -> str:
    """Dynamically generate WorkflowIdentifierAgent instruction using actual collected tasks.

    Presents the real task list to the user and asks them to pick highest-impact ones,
    framed to their specific role domain instead of a static boilerplate question.
    """
    tasks = insights.get("tasks") or []
    identity_context = insights.get("identity_context") or {}
    title = identity_context.get("title", "your role") or "your role"
    title_lower = title.lower()

    # Build numbered task list
    task_lines = []
    for i, t in enumerate(tasks[:8], 1):
        desc = (t.get("description", str(t)) if isinstance(t, dict) else str(t))[:70]
        task_lines.append(f"  {i}. {desc}")
    task_list_str = "\n".join(task_lines) if task_lines else "  (No tasks collected yet)"

    # Role-domain framing for the impact question
    if any(k in title_lower for k in ["software", "engineer", "developer", "architect", "devops"]):
        impact_frame = "highest system-level or product impact"
    elif any(k in title_lower for k in ["sales", "account", "business development"]):
        impact_frame = "most direct revenue or commercial impact"
    elif any(k in title_lower for k in ["data", "analyst", "scientist"]):
        impact_frame = "highest business-decision or analytical impact"
    elif any(k in title_lower for k in ["hr", "talent", "recruit", "people"]):
        impact_frame = "most critical to people and org health outcomes"
    elif any(k in title_lower for k in ["finance", "account"]):
        impact_frame = "most critical to financial accuracy or business control"
    elif any(k in title_lower for k in ["manager", "head", "director", "lead"]):
        impact_frame = "highest team or business impact"
    elif any(k in title_lower for k in ["regulatory", "compliance", "legal"]):
        impact_frame = "most critical to regulatory compliance or risk"
    elif any(k in title_lower for k in ["operations", "supply", "logistics"]):
        impact_frame = "most operationally critical or highest throughput impact"
    else:
        impact_frame = "highest overall business impact"

    return (
        f"Your goal: Identify which tasks have the highest priority for the Job Description.\n"
        f"\nTASKS IDENTIFIED FOR '{title}':\n{task_list_str}\n"
        f"\nASK EXACTLY THIS QUESTION:\n"
        f"  From this list, which 3 to 5 activities have the {impact_frame} — "
        f"the ones where a gap in execution would directly affect the team or business outcome?\n"
        f"\nRULES:\n"
        f"- Present the numbered task list EXACTLY as shown above.\n"
        f"- Then ask the question above. ONE question. Nothing else.\n"
        f"- Do NOT say 'Based on our discussion' or 'I have noted'. Start with the task list."
    )


def _get_priority_selection_copy(insights: dict) -> str:
    """Build structured copy for the WorkflowIdentifierAgent UI."""
    identity_context = insights.get("identity_context") or {}
    title = identity_context.get("title") or insights.get("role") or "this role"
    title_lower = str(title).lower()

    if any(k in title_lower for k in ["software", "engineer", "developer", "architect", "devops"]):
        impact_frame = "the highest system or product impact"
    elif any(k in title_lower for k in ["sales", "account", "business development"]):
        impact_frame = "the most direct revenue impact"
    elif any(k in title_lower for k in ["data", "analyst", "scientist"]):
        impact_frame = "the strongest decision-making impact"
    elif any(k in title_lower for k in ["hr", "talent", "recruit", "people"]):
        impact_frame = "the strongest people and org impact"
    elif any(k in title_lower for k in ["finance", "account"]):
        impact_frame = "the strongest control or financial accuracy impact"
    else:
        impact_frame = "the highest business impact"

    task_count = len(insights.get("tasks") or [])
    count_hint = "3 to 5" if task_count >= 3 else "the most important"

    return (
        f"Review the tasks below for the {title} role and select {count_hint} activities with {impact_frame}. "
        "These are the responsibilities we will analyze in detail next. "
        "Add anything essential if the list is missing a critical responsibility."
    )


def _get_structured_phase_message(agent_name: str, insights: dict) -> str:
    """Return user-facing copy for structured confirmation phases."""
    if agent_name == "WorkflowIdentifierAgent":
        return _get_priority_selection_copy(insights)

    if agent_name == "ToolsAgent":
        role = (
            insights.get("identity_context", {}).get("title")
            or insights.get("role")
            or "this role"
        )
        return (
            f"Review the tools surfaced for {role} and confirm which ones are genuinely part of the day-to-day toolkit. "
            "Remove anything incidental and add any core platform that is missing."
        )

    if agent_name == "SkillsAgent":
        role = (
            insights.get("identity_context", {}).get("title")
            or insights.get("role")
            or "this role"
        )
        return (
            f"Review the technical skills suggested for {role} and keep the ones that truly drive performance in the job. "
            "Add any missing hard skills or domain expertise before continuing."
        )

    if agent_name == "JDGeneratorAgent":
        return (
            "All core details are captured. The high-fidelity Job Description is ready for generation."
        )

    return ""


PHASE_INSTRUCTIONS = {
    "BasicInfoAgent": "",        # Dynamically generated
    "WorkflowIdentifierAgent": "",  # Dynamically generated
    "DeepDiveAgent": "",         # Dynamically generated
    "ToolsAgent": "Your goal: Finalize the inventory of professional platforms, software, or internal systems used in this role. Present the suggested toolkit from identified workflows for confirmation.",
    "SkillsAgent": "Your goal: Define the core technical competencies required for success. Refine the suggested skill set based on the mapped workflows and role domain.",
    "QualificationAgent": "",    # Dynamically generated
    "JDGeneratorAgent": "Your goal: Synthesize all collected data into the final Job Description. Inform the user that generation is beginning.",
}

# ── Prompt Builders ──────────────────────────────────────────────────────────


def build_already_collected_summary(insights: dict, agent_name: str) -> str:
    """Build a phase-scoped summary of collected data.

    Each agent only sees fields relevant to its mission, reducing token waste.
    This is the primary deduplication signal for the LLM.
    """
    lines = ["\n📊 DATA ALREADY COLLECTED (Do NOT ask for these again):"]

    # Always show identity — all agents need it to avoid asking for known info
    role = insights.get("role") or insights.get("identity_context", {}).get("title")
    purpose = insights.get("purpose")
    dept = insights.get("department") or insights.get("identity_context", {}).get("department")
    reports = insights.get("reports_to") or insights.get("identity_context", {}).get("reports_to")

    if role:
        lines.append(f"  ✓ Role: {role}")
    if dept:
        lines.append(f"  ✓ Department: {dept}")
    if reports:
        lines.append(f"  ✓ Reports To: {reports}")
    if purpose:
        purpose_text = str(purpose)
        purpose_preview = purpose_text[:70] + ("..." if len(purpose_text) > 70 else "")
        lines.append(f"  ✓ Purpose: {purpose_preview}")

    # ── PHASE-SCOPED DATA INJECTION ────────────────────────────────────────────
    # Only inject fields relevant to this agent's mission to reduce token waste.

    tasks = insights.get("tasks") or []
    priorities = insights.get("priority_tasks") or []
    workflows = insights.get("workflows") or {}
    visited_tasks = insights.get("visited_tasks") or []
    active = insights.get("active_deep_dive_task")

    # BasicInfoAgent + WorkflowIdentifierAgent: show tasks + priorities
    if agent_name in ("BasicInfoAgent", "WorkflowIdentifierAgent"):
        if tasks:
            lines.append(f"  ✓ Tasks Collected ({len(tasks)}):")
            task_cap = 4 if agent_name == "BasicInfoAgent" else 5
            for i, t in enumerate(tasks[:task_cap]):
                desc = t.get("description", str(t)) if isinstance(t, dict) else str(t)
                lines.append(f"    {i + 1}. {desc[:58]}")
            if len(tasks) > task_cap:
                lines.append(f"    ... and {len(tasks) - task_cap} more (already captured)")
            if len(tasks) >= task_cap:
                lines.append("    [STATUS: TASK COLLECTION COMPLETE]")
        if priorities:
            shown = [str(p)[:55] for p in priorities[:5]]
            lines.append(f"  ✓ Priority Tasks Selected: {shown}")

    # DeepDiveAgent: focus only on active task workflow + visited list
    elif agent_name == "DeepDiveAgent":
        if priorities:
            lines.append(f"  ✓ Priority Tasks: {[str(p)[:55] for p in priorities[:5]]}")
        if visited_tasks:
            shown_visited = [str(v)[:45] for v in visited_tasks[:4]]
            lines.append(f"  ✓ DEEP DIVE COMPLETE — DO NOT revisit: {shown_visited}")
        if active:
            lines.append(f"  ➜ CURRENT FOCUS: '{active}'")
            active_data = workflows.get(active, {})
            if active_data:
                missing = []
                if not active_data.get("trigger"): missing.append("trigger")
                if not active_data.get("steps"): missing.append("steps")
                if not active_data.get("output"): missing.append("output")
                if missing:
                    lines.append(f"    ⚠️ MISSING FOR '{active}': {', '.join(missing)}")
                else:
                    lines.append(f"    ✓ ALL BLOCKS CAPTURED FOR '{active}'.")
                if active_data.get("trigger"):
                    lines.append(f"    ✓ TRIGGER: {str(active_data['trigger'])[:70]}")
                if active_data.get("steps"):
                    shown = active_data["steps"][:2]
                    lines.append(f"    ✓ STEPS ({len(active_data['steps'])} total): {'; '.join(str(s)[:40] for s in shown)}...")
                if active_data.get("tools"):
                    lines.append(f"    ✓ TOOLS: {active_data['tools'][:3]}")

    # ToolsAgent: tools + workflow-mentioned tools
    elif agent_name == "ToolsAgent":
        tools = insights.get("tools", [])
        if tools:
            lines.append(f"  ✓ Confirmed Tools: {[str(t)[:30] for t in tools[:8]]}")
        wf_tools: set = set()
        for wf in workflows.values():
            for t in (wf.get("tools") or []):
                wf_tools.add(str(t))
        if wf_tools:
            lines.append(f"  ✓ Tools Mentioned in Workflows: {sorted(wf_tools)[:5]}")

    # SkillsAgent: skills + workflow tool mentions for context
    elif agent_name == "SkillsAgent":
        skills = insights.get("skills", [])
        if skills:
            lines.append(f"  ✓ Confirmed Skills: {[str(s)[:32] for s in skills[:8]]}")
        wf_tools: set = set()
        for wf in workflows.values():
            for t in (wf.get("tools") or []):
                wf_tools.add(str(t))
        if wf_tools:
            lines.append(f"  ✓ Workflow Tool Signals: {sorted(wf_tools)[:4]}")

    # QualificationAgent: qualifications only
    elif agent_name == "QualificationAgent":
        quals = insights.get("qualifications", {})
        if quals.get("education"):
            lines.append(f"  ✓ Education: {quals['education']}")
        if quals.get("experience_years"):
            lines.append(f"  ✓ Experience: {quals['experience_years']} years")
        if quals.get("certifications"):
            lines.append(f"  ✓ Certifications: {quals['certifications']}")

    # All agents: surface conflicts if any
    conflicts = insights.get("conflicts", [])
    if conflicts:
        lines.append("\n  ⚠️ DETECTED CONFLICTS:")
        for c in conflicts:
            desc = c.get("description", str(c)) if isinstance(c, dict) else str(c)
            lines.append(f"    - {desc}")

    if len(lines) <= 1:
        return "\n📊 DATA ALREADY COLLECTED: None yet."

    return "\n".join(lines)


def build_dynamic_prompt(
    phase: str,
    insights: dict,
    rag_context: List[str] | None = None,
    transition_context: str = "",
    is_first_turn: bool = False,
) -> str:
    """
    Build a complete, context-aware prompt for the current phase.
    """
    if rag_context is None:
        rag_context = []

    parts = [BASE_PERSONA]

    industry_strategy = _get_industry_strategy(insights)
    parts.append(
        f"\n🧠 INDUSTRY STRATEGY:\n{industry_strategy}\nUse this specific lens when formulating your questions. Do not ask generic HR questions."
    )

    # Add Identity Context (Already Known Information)
    identity = insights.get("identity_context", {})
    if identity:
        parts.append("\n👤 IDENTITY CONTEXT (ALREADY KNOWN - DO NOT ASK FOR THIS):")
        if identity.get("title"):
            parts.append(f"  - Job Title: {identity['title']}")
        if identity.get("department"):
            parts.append(f"  - Department: {identity['department']}")
        if identity.get("reports_to"):
            parts.append(f"  - Reports To: {identity['reports_to']}")
        parts.append(
            "Use the above title/department as context for your questions, but never ask the user to provide or confirm them."
        )

    # Add phase-specific instructions — ALL DYNAMICALLY GENERATED
    if phase == "BasicInfoAgent":
        phase_instruction = _build_basic_info_instruction(insights)
    elif phase == "DeepDiveAgent":
        phase_instruction = _build_deep_dive_instruction(insights)
    elif phase == "QualificationAgent":
        phase_instruction = _build_qualification_instruction(insights)
    elif phase == "WorkflowIdentifierAgent":
        phase_instruction = _build_workflow_identifier_instruction(insights)
    else:
        phase_instruction = PHASE_INSTRUCTIONS.get(phase, "")

    if phase_instruction:
        parts.append(f"\n🎯 CURRENT MISSION:\n{phase_instruction}")

    # Add already collected summary (Surfaces everything to prevent repetition)
    collected_summary = build_already_collected_summary(insights, phase)
    parts.append(collected_summary)

    # Add transition context
    if transition_context:
        parts.append(f"\n🔄 TRANSITION: {transition_context}")
        parts.append("Go immediately to the next question. No bridge sentences.")

    # Add RAG suggestions — capped at 2 to keep system prompt lean and reduce TTFB
    if rag_context:
        examples = "\n".join([f"  • {ex}" for ex in rag_context[:2]])
        parts.append(f"\n💡 CONTEXTUAL EXAMPLES (Do NOT copy verbatim):\n{examples}")

    # Add first turn greeting
    if is_first_turn:
        user_name = insights.get("identity_context", {}).get("employee_name", "User")
        role = insights.get("identity_context", {}).get("title", "this role")
        dept = insights.get("identity_context", {}).get(
            "department", "the organization"
        )

        parts.append(
            f"\n⚠️ FIRST MESSAGE PROTOCOL (MANDATORY): Start by greeting {user_name} professionally. "
            f"Explicitly mention their position as '{role}' within the '{dept}' team. "
            f"Then immediately ask your first question about the core purpose of their role. Keep it to 2 sentences max."
        )

    # Add response format rules
    if phase in ["ToolsAgent", "SkillsAgent", "JDGeneratorAgent"]:
        parts.append("\n📝 FORMAT: Present data clearly. NO question marks.")
    else:
        if is_first_turn:
            parts.append(
                "\n📝 FORMAT: Start with the mandated professional greeting and role/team context, then ask EXACTLY ONE question. No filler after the greeting and no extra acknowledgment phrases."
            )
        else:
            parts.append(
                "\n📝 FORMAT: Exactly ONE question. No introductory text. No filler. No acknowledgments. 2-4 sentences max."
            )

    # RULE: ABSOLUTE ROLE ISOLATION for BasicInfoAgent Turn 1
    turns = (insights.get("agent_turn_counts") or {}).get("BasicInfoAgent", 0)
    if phase == "BasicInfoAgent" and turns <= 1:
        for i in range(len(parts)):
            if "🧠 INDUSTRY STRATEGY" in parts[i]:
                parts[i] = (
                    "🧠 INDUSTRY STRATEGY: Stay grounded and universal for this initial mission inquiry."
                )

    return "\n".join(parts)


def build_system_messages(
    phase: str,
    insights: dict,
    rag_context: List[str] | None = None,
    transition_context: str = "",
    is_first_turn: bool = False,
) -> str:
    """
    Build the complete system message for the LLM.
    """
    return build_dynamic_prompt(
        phase=phase,
        insights=insights,
        rag_context=rag_context,
        transition_context=transition_context,
        is_first_turn=is_first_turn,
    )
