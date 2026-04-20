# backend/app/agents/dynamic_prompts.py
"""
Dynamic Prompt Builder — Constructs context-aware prompts based on current phase.

Replaces the static AGENT_PROMPTS with intelligent, state-driven prompt construction.
Ensures zero-filler, naked questions, and high visibility of collected data to prevent repetition.
"""

from __future__ import annotations

from typing import List

# ── Base Persona ───────────────────────────────────────────────────────────


BASE_PERSONA = """You are a Professional Job Analyst conducting a structured interview to build a high-fidelity Job Description. You sound like a knowledgeable colleague — direct, expert, and focused.

BEHAVIORAL CONTRACT (ABSOLUTE — VIOLATING ANY RULE IS A CRITICAL FAILURE):

RULE 1 — RESPONSE = EXACTLY ONE QUESTION. NOTHING ELSE.
No greeting. No acknowledgment. No "Got it". No "Great". No "I understand".
No summary of what the user said. No bridge sentences like "Since we discussed X...".
No examples. No suggestions. No "For instance...". No "Such as...".
Start directly with the question. End with a question mark. That is your entire response.

RULE 2 — NEVER ASK ABOUT DATA ALREADY COLLECTED.
Before asking anything, read the DATA ALREADY COLLECTED section below.
If a piece of information appears there, it is saved. Do not ask for it again.
Do not ask the user to confirm data they already provided. Just move forward.

RULE 3 — SPEAK LIKE A DOMAIN EXPERT, NOT A GENERIC INTERVIEWER.
Adapt your language and technical depth to match the user's role and industry.
Use grounded, plain professional English. No consulting jargon.
BANNED phrases: "strategic impact", "actionable initiatives", "human capital strategy",
"competitive advantage", "KPI", "ROI", "metrics", "targets", "data tracking".
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
    if any(k in title_lower for k in ["software", "engineer", "developer", "architect"]):
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
    if any(k in title_lower for k in ["operations", "supply", "logistics", "procurement"]):
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


def _get_cadence_probe_from_context(purpose: str, tasks: list, identity_context: dict) -> str:
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
        if any(k in task_lower for k in ["submission", "dossier", "regulatory", "approval", "filing"]):
            return (
                f"When a '{active_task}' becomes due, what triggers the process — "
                f"is it a regulatory agency deadline, an internal milestone, or a product change — "
                f"and who hands it off to you to begin?"
            )
        if any(k in task_lower for k in ["audit", "inspection", "compliance", "review"]):
            return (
                f"What initiates a '{active_task}' — is it scheduled annually, triggered by an external "
                f"authority, or does a specific event inside the organisation kick it off?"
            )
        # Sales / revenue tasks
        if any(k in task_lower for k in ["forecast", "pipeline", "quota", "target", "revenue"]):
            return (
                f"What kicks off '{active_task}' — is it a fixed calendar event (month-end/quarter-end), "
                f"a CRM alert, or a request from finance — and what data do you pull first?"
            )
        if any(k in task_lower for k in ["demo", "proposal", "pitch", "prospect", "lead"]):
            return (
                f"How does a '{active_task}' get initiated — does it flow from an inbound enquiry, "
                f"a rep request, or does it come directly from your prospecting activity?"
            )
        # Engineering / technical tasks
        if any(k in task_lower for k in ["deploy", "release", "build", "sprint", "code", "review"]):
            return (
                f"What triggers a '{active_task}' — a Jira ticket, a sprint ceremony, "
                f"a CI pipeline signal, or a direct stakeholder request?"
            )
        if any(k in task_lower for k in ["incident", "bug", "issue", "outage", "support"]):
            return (
                f"When '{active_task}' lands on your plate, what's the first signal — "
                f"a monitoring alert, a ticket, a Slack escalation — and what do you look at first?"
            )
        # Data / analytics tasks
        if any(k in task_lower for k in ["report", "dashboard", "analysis", "insight", "data"]):
            return (
                f"What initiates '{active_task}' — a scheduled run, a stakeholder request, "
                f"or a data anomaly — and what is the primary source you pull from?"
            )
        # HR / people tasks
        if any(k in task_lower for k in ["hire", "recruit", "onboard", "interview", "appraisal"]):
            return (
                f"How does '{active_task}' get kicked off — is it a headcount approval from the "
                f"business, a replacement need, or a proactive talent plan — and who owns the brief?"
            )
        # Finance tasks
        if any(k in task_lower for k in ["budget", "invoice", "payroll", "reconcil", "close", "finance"]):
            return (
                f"What triggers '{active_task}' — a calendar deadline, a system alert, "
                f"or a request from a business unit — and what sign-off is needed before you start?"
            )
        # Operations / procurement tasks
        if any(k in task_lower for k in ["vendor", "purchase", "procurement", "supply", "inventory"]):
            return (
                f"What initiates '{active_task}' — a stock threshold, a business unit requisition, "
                f"or a contract renewal — and who raises it to you?"
            )
        # Generic intelligent fallback — still better than the old template
        return (
            f"When '{active_task}' needs to happen, what is the specific trigger or event that "
            f"starts it — and what information or inputs do you need before you can begin?"
        )

    # ── Turn 2: What goes wrong / what does expert-level look like? ─────────
    elif turn_number == 2:
        # Use what was captured in Turn 1 to pivot
        known_trigger = existing_wf.get("trigger", "")
        known_steps = existing_wf.get("steps") or []

        if known_trigger or known_steps:
            # Anchor to what they shared
            anchor = known_trigger[:50] if known_trigger else "that process"
            if any(k in task_lower for k in ["submission", "dossier", "regulatory", "audit", "compliance"]):
                return (
                    f"In '{active_task}', where does the process most commonly hit a wall — "
                    f"missing data from another team, regulatory ambiguity, timeline compression — "
                    f"and how do you typically resolve it without derailing the deadline?"
                )
            if any(k in task_lower for k in ["forecast", "pipeline", "revenue", "report", "analysis"]):
                return (
                    f"In '{active_task}', what's the most common data quality or accuracy challenge "
                    f"you hit, and what does a high-confidence output look like when the work is done right?"
                )
            if any(k in task_lower for k in ["deploy", "release", "build", "incident", "bug"]):
                return (
                    f"When '{active_task}' runs into a blocker — a failed check, a dependency gap, "
                    f"an escalation — what's your decision framework and what does a clean resolution look like?"
                )
            return (
                f"In '{active_task}', what's the hardest part to get right, and what separates "
                f"an average outcome from a high-quality one in your judgment?"
            )

        # No Turn 1 data captured — ask for process steps
        return (
            f"Walk me through the main steps in '{active_task}' — from the moment you receive it "
            f"to the point where you consider it done. What happens in sequence?"
        )

    # ── Turn 3: Gap fill — missing fields only ──────────────────────────────
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
                f"For '{active_task}', we still need to capture {missing_str}. "
                f"Can you fill in that part specifically?"
            )
        return f"Details for '{active_task}' look complete. What aspect should we revisit or refine?"


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
        identity_context.get("title", "")
        or insights.get("role", "")
        or "this role"
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

    turn_note = (
        f"\n\nTURN MANAGEMENT: This is turn {turns} of 5. "
        + ("Final turn — ask one concise broadening question."
           if turns >= 5
           else f"You have {5 - turns} turn(s) remaining.")
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
        task_q = _build_task_aware_deep_dive_question(active, 1, identity_context, workflows)
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

        task_q = _build_task_aware_deep_dive_question(active, 1, identity_context, workflows)
        return (
            f"Your goal: Begin deep-diving task: '{active}'."
            f"\n\nASK EXACTLY THIS QUESTION (or a close variant):"
            f"\n  {task_q}"
            f"{scope}"
        )

    # ── Active task in progress — use intelligent turn-based questions ────────
    task_q = _build_task_aware_deep_dive_question(active, turn_number, identity_context, workflows)

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
    """Dynamically generate QualificationAgent instructions."""
    quals = insights.get("qualifications", {})
    edu = quals.get("education", "")
    exp = quals.get("experience_years", "")
    certs = quals.get("certifications", [])
    turns = (insights.get("agent_turn_counts") or {}).get("QualificationAgent", 0)

    role_title = (
        insights.get("identity_context", {}).get("title", "")
        or insights.get("role", "")
        or "this role"
    )

    if not edu or not exp:
        return (
            f"Your goal: Capture the minimum qualifications for '{role_title}'."
            f"\nAsk ONE question about the minimum educational background and years of relevant professional experience required for this role."
        )

    if (not certs or len(certs) == 0) and turns < 3:
        return (
            f"Your goal: Identify certifications that help grow in '{role_title}'."
            f"\nAsk ONE question: Are there any professional certifications or specialized training programs that would help someone grow and excel in this role?"
            f"\nFrame it as growth-oriented, not mandatory."
        )

    return (
        f"Your goal: Finalize qualifications for '{role_title}'."
        f"\nAll key qualifications are captured. The system will advance soon."
    )


PHASE_INSTRUCTIONS = {
    "BasicInfoAgent": "",  # Dynamically generated via _build_basic_info_instruction
    "WorkflowIdentifierAgent": """
Your goal: Confirm the priority tasks for deep-dive analysis.
Strategy: Present the top identified tasks based on strategic importance and ask for confirmation.
- "Reviewing the activities we've identified, which tasks are most critical to your role's success? We will examine these in detail for the Job Description."
""",
    "DeepDiveAgent": "",  # Dynamically generated via _build_deep_dive_instruction
    "ToolsAgent": """
Your goal: Finalize the inventory of professional platforms, software, or internal systems.
Strategy: Present the suggested toolkit based on identified workflows for confirmation.
""",
    "SkillsAgent": """
Your goal: Define the core competencies and professional skills required for success.
Strategy: Refine the suggested skill set based on the mapped workflows and industry focus.
""",
    "QualificationAgent": "",  # Dynamically generated via _build_qualification_instruction
    "JDGeneratorAgent": """
Your goal: Synthesize all data into the final Job Description.
Strategy: Inform the user the generation process is beginning.
""",
}

# ── Prompt Builders ──────────────────────────────────────────────────────────


def build_already_collected_summary(insights: dict, agent_name: str) -> str:
    """Build a comprehensive summary of EVERYTHING collected so far.

    This is the primary deduplication signal for the LLM.
    """
    lines = ["\n📊 DATA ALREADY COLLECTED (Do NOT ask for these again):"]

    role = insights.get("role") or insights.get("identity_context", {}).get("title")
    purpose = insights.get("purpose")
    dept = insights.get("department") or insights.get("identity_context", {}).get(
        "department"
    )
    reports = insights.get("reports_to") or insights.get("identity_context", {}).get(
        "reports_to"
    )
    location = insights.get("location") or insights.get("identity_context", {}).get(
        "location"
    )

    if role:
        lines.append(f"  ✓ Role: {role}")
    if dept:
        lines.append(f"  ✓ Department: {dept}")
    if reports:
        lines.append(f"  ✓ Reports To: {reports}")
    if location:
        lines.append(f"  ✓ Location: {location}")
    if purpose:
        lines.append(f"  ✓ Purpose: {purpose[:100]}...")

    # 2. Tasks
    tasks = insights.get("tasks") or []
    if tasks:
        lines.append(f"  ✓ Tasks Collected ({len(tasks)}):")
        # Cap at 5 to keep system prompt lean — agent only needs to know what NOT to ask again
        for i, t in enumerate(tasks[:5]):
            desc = t.get("description", str(t)) if isinstance(t, dict) else str(t)
            lines.append(f"    {i + 1}. {desc[:60]}")
        if len(tasks) > 5:
            lines.append(f"    ... and {len(tasks) - 5} more tasks (already captured)")
        if len(tasks) >= 6:
            lines.append("    [STATUS: TASK COLLECTION COMPLETE]")

    # 3. Priorities
    priorities = insights.get("priority_tasks") or []
    if priorities:
        lines.append(f"  ✓ Priority Tasks: {priorities}")

    # 3b. Visited Deep Dive Tasks — LLM must NEVER revisit these
    visited_tasks = insights.get("visited_tasks") or []
    if visited_tasks:
        lines.append(
            f"  ✓ DEEP DIVE COMPLETE (DO NOT revisit these tasks): {visited_tasks}"
        )

    # 4. Workflows
    workflows = insights.get("workflows") or {}
    if workflows:
        completed = [k for k, v in workflows.items() if v.get("output")]
        if completed:
            lines.append(f"  ✓ Workflows Completed: {completed}")

    active = insights.get("active_deep_dive_task")
    if active:
        lines.append(f"  ➜ CURRENT FOCUS: '{active}'")
        if workflows and active in workflows:
            active_data = workflows.get(active, {})
            missing = []
            if not active_data.get("trigger"):
                missing.append("Trigger (how it starts)")
            if not active_data.get("steps"):
                missing.append("Key Steps (the process)")
            if not active_data.get("output"):
                missing.append("Final Output (the result)")
            if not active_data.get("tools"):
                missing.append("Specific Tools used")

            if missing:
                lines.append(f"    ⚠️ MISSING FOR '{active}': {', '.join(missing)}")
            else:
                lines.append(
                    f"    ✓ ALL BLOCKS CAPTURED FOR '{active}'. Ready for next task."
                )

            # Detail what we ALREADY HAVE to prevent repetition — cap steps to keep prompt lean
            if active_data.get("steps"):
                step_count = len(active_data["steps"])
                shown_steps = active_data["steps"][:3]
                lines.append(
                    f"    ✓ KNOWN STEPS ({step_count} total): {'; '.join(str(s)[:40] for s in shown_steps)}"
                    + (f" ... +{step_count - 3} more" if step_count > 3 else "")
                )
            if active_data.get("tools"):
                lines.append(f"    ✓ KNOWN TOOLS: {active_data['tools'][:4]}")

    # 5. Tools & Tech
    tools = insights.get("tools", [])
    mentioned = insights.get("previously_mentioned_tools", [])
    if tools:
        lines.append(f"  ✓ Confirmed Tools: {tools}")
    elif mentioned:
        lines.append(f"  ✓ Mentioned Tools (unconfirmed): {mentioned}")

    # 6. Skills
    skills = insights.get("skills", [])
    if skills:
        lines.append(f"  ✓ Confirmed Skills: {skills}")

    # 7. Qualifications
    quals = insights.get("qualifications", {})
    if quals.get("education"):
        lines.append(f"  ✓ Education: {quals['education']}")
    if quals.get("experience_years"):
        lines.append(f"  ✓ Experience: {quals['experience_years']} years")
    if quals.get("certifications"):
        lines.append(f"  ✓ Certifications: {quals['certifications']}")

    # 8. Detected Conflicts
    conflicts = insights.get("conflicts", [])
    if conflicts:
        lines.append("\n  ⚠️ DETECTED CONFLICTS (Address these gently):")
        for c in conflicts:
            desc = c.get("description", str(c)) if isinstance(c, dict) else str(c)
            lines.append(f"    - {desc}")

    if len(lines) <= 1:
        return "\n📊 DATA ALREADY COLLECTED: None yet."

    return "\n".join(lines)


def build_dynamic_prompt(
    phase: str,
    insights: dict,
    rag_context: List[str] = None,
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

    # Add phase-specific instructions — DYNAMICALLY GENERATED
    if phase == "BasicInfoAgent":
        phase_instruction = _build_basic_info_instruction(insights)
    elif phase == "DeepDiveAgent":
        phase_instruction = _build_deep_dive_instruction(insights)
    elif phase == "QualificationAgent":
        phase_instruction = _build_qualification_instruction(insights)
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
                "\n📝 FORMAT: Start with the mandated professional greeting and role/team context, followed by EXACTLY ONE question. No filler. No acknowledgments."
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
    rag_context: List[str] = None,
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
