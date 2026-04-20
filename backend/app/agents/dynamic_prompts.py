# backend/app/agents/dynamic_prompts.py
"""
Dynamic Prompt Builder — Constructs context-aware prompts based on current phase.

Replaces the static AGENT_PROMPTS with intelligent, state-driven prompt construction.
Ensures zero-filler, naked questions, and high visibility of collected data to prevent repetition.
"""

from __future__ import annotations

from typing import List

# ── Base Persona ───────────────────────────────────────────────────────────


BASE_PERSONA = """You are a Professional Job Analysis Assistant. You sound polite, knowledgeable, and approachable. Your language is clear and simple so that every employee in the company understands your questions immediately. You avoid complex professional jargon in favor of direct, understandable inquiries.You job is to build professinal jd for an employee by undetstanding them clearly 

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

RULE 4 — PROFESSIONAL & UNDERSTANDING LANGUAGE. EVERY EMPLOYEE MUST UNDERSTAND THE QUESTION.
Write questions in simple, polite, and professional English that any employee can answer clearly.
- Questions MUST be at least 2 lines long (provide a brief, polite context sentence before the question).
- NO "deep professional" words or academic jargon. Use everyday terms.
- NO embedded option lists. Never ask "is it X, Y, or Z?" — ask an open-ended question instead.
- NO compound questions joined by "and" or "—". One sentence. One question mark.
- NO acronyms or domain-specific terms unless the user introduced them first.
- Use short, natural references to tasks (e.g. "your forecasting work") not long formal task names.
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


def _get_task_short_name(task_name: str) -> str:
    """
    Extract a concise, natural short reference from a full task name.
    Used in questions so employees see a simple phrase, not the full formal name.

    Examples:
      "Regulatory Submission Dossier Preparation"  →  "submission dossier work"
      "Monthly Sales Forecasting"                  →  "sales forecasting"
      "Employee Onboarding Process"                →  "onboarding process"
      "CI/CD Deployment Pipeline Release"          →  "deployment work"
      "Monthly Budget Reconciliation"              →  "budget reconciliation"
    """
    if not task_name or not task_name.strip():
        return "this task"

    # Time/frequency prefixes to drop — they add length without meaning in a question
    DROP_PREFIXES = {
        "monthly",
        "weekly",
        "daily",
        "quarterly",
        "annual",
        "bi-weekly",
        "bi-monthly",
    }
    # Generic structural words that can be trimmed when leading
    DROP_WORDS = {"and", "of", "the", "a", "an", "for", "in", "at", "with"}

    words = task_name.strip().split()

    # Strip leading time prefix (e.g. "Monthly", "Weekly")
    if words and words[0].lower() in DROP_PREFIXES:
        words = words[1:]

    # Remove generic filler words throughout
    meaningful = [w for w in words if w.lower() not in DROP_WORDS]

    if not meaningful:
        # Fallback — just use the first real word lowercased
        return words[0].lower() if words else "this task"

    # Keep max 3 meaningful words for a natural references phrase
    short = " ".join(meaningful[:3]).lower()
    return short


def _get_role_aware_purpose_probe(identity_context: dict) -> str:
    """
    Generate a role-specific purpose question using the known title and department.
    Returns a single, plain, open-ended question — no embedded option lists.
    """
    title = str(identity_context.get("title", "")).strip()
    dept = str(identity_context.get("department", "")).strip()
    title_lower = title.lower()

    # ── Domain-specific purpose framings (plain, single, open-ended) ────────
    if any(k in title_lower for k in ["regulatory", "compliance", "affairs"]):
        return f"As a {title}, I want to learn about your core contribution. What is the main outcome your role exists to deliver?"

    if any(k in title_lower for k in ["sales", "business development", "account"]):
        return f"As a {title}, your focus is very important to the business. What is the main goal or achievement your role exists to reach?"

    if any(
        k in title_lower for k in ["software", "engineer", "developer", "architect"]
    ):
        dept_ref = f" in the {dept} team" if dept else ""
        return f"As a {title}{dept_ref}, I am interested in how your work helps your team. What is the primary thing your expertise contributes to the team?"

    if any(k in title_lower for k in ["data", "analyst", "analytics", "scientist"]):
        return f"As a {title}, your insights are key to our decisions. What specific business questions or decisions does your work help the company solve?"

    if any(k in title_lower for k in ["hr", "talent", "recruit", "people"]):
        dept_ref = f" in {dept}" if dept else ""
        return f"In your position as {title}{dept_ref}, you handle important people-related work. What is the main outcome for our employees that you are responsible for?"

    if any(k in title_lower for k in ["finance", "account", "treasury", "controller"]):
        return f"As a {title}, your role in managing our finances is critical. What is the main financial area or process you are responsible for keeping in order?"

    if any(k in title_lower for k in ["product", "program", "project"]):
        return f"As a {title}, I want to understand what success looks like for you. When you look at your role, what is the main outcome that shows you have done a great job?"

    if any(
        k in title_lower for k in ["operations", "supply", "logistics", "procurement"]
    ):
        dept_ref = f" in {dept}" if dept else ""
        return f"In your role as {title}{dept_ref}, you keep our processes moving smoothly. What is the primary flow or operation that you are responsible for managing?"

    if any(k in title_lower for k in ["marketing", "brand", "content", "digital"]):
        return f"As a {title}, your creative and strategic work is vital to our growth. What is the main result or output that your role is responsible for creating?"

    if any(k in title_lower for k in ["manager", "head", "director", "lead"]):
        dept_ref = f" in the {dept} team" if dept else ""
        return f"As a {title}{dept_ref}, your leadership helps shape the team's success. What is the main outcome or delivery that your team is responsible for as a whole?"

    # Fallback — plain and open-ended
    dept_ref = f" in the {dept} team" if dept else ""
    return f"In your role as {title}{dept_ref}, I'd like to understand your primary focus. What is the most important outcome that your work enables for the company?"


def _get_cadence_probe_from_context(
    purpose: str, tasks: list, identity_context: dict
) -> str:
    """
    Generate a cadence question that references the purpose the user already shared.
    Single, open-ended — no embedded option lists.
    """
    title = str(identity_context.get("title", "your role")).strip()
    purpose_short = (purpose[:55] + "...") if len(purpose) > 55 else purpose

    # Tasks already captured — ask about what's still missing
    if tasks:
        task_descs = " and ".join(
            (t.get("description", str(t)) if isinstance(t, dict) else str(t))
            for t in tasks[:2]
        )
        return f"To help me understand your routine, I've noted your work on {task_descs}. Beyond these, what other regular activities take up your time each week?"

    # No tasks yet — anchor to the purpose they gave
    if purpose_short:
        return f"Since you mentioned your role is about {purpose_short}, I'd like to learn more about your daily work. What does a typical working week look like for you?"

    # Pure fallback
    return f"As a {title}, it would be helpful to understand your schedule. What does a typical working week look like for you in this position?"


def _build_task_aware_deep_dive_question(
    active_task: str, turn_number: int, identity_context: dict, workflows: dict
) -> str:
    """
    Generate a plain, single, open-ended deep-dive question.
    Uses a short natural task reference instead of the full formal task name.
    Domain-matched but written in everyday language any employee can understand.
    """
    task_lower = active_task.lower() if active_task else ""
    existing_wf = (workflows or {}).get(active_task, {})

    # Short natural reference for use inside questions
    short = _get_task_short_name(active_task)

    # ── Turn 1: How does this work START? ───────────────────────────────────
    if turn_number <= 1:
        if any(
            k in task_lower
            for k in ["submission", "dossier", "regulatory", "approval", "filing"]
        ):
            return f"To understand the workflow for your {short}, I'd like to start at the beginning. What usually kicks off this process or triggers the need for it?"

        if any(
            k in task_lower for k in ["audit", "inspection", "compliance", "review"]
        ):
            return f"In regards to your {short}, I'm interested in how it starts. Is it typically planned in advance, or does a specific event bring it to your attention?"

        if any(
            k in task_lower
            for k in ["forecast", "pipeline", "quota", "target", "revenue"]
        ):
            return f"For your {short}, it's helpful to know what gets the work moving. What specific event or request usually kicks off this activity?"

        if any(
            k in task_lower for k in ["demo", "proposal", "pitch", "prospect", "lead"]
        ):
            return f"I'd like to learn more about how your {short} usually begins. What is the first thing that happens or the first piece of information that comes in?"

        if any(
            k in task_lower
            for k in ["deploy", "release", "build", "sprint", "code", "review"]
        ):
            return f"Regarding the process for your {short}, there are often prerequisites. What needs to happen or be ready before you can start this work?"

        if any(
            k in task_lower for k in ["incident", "bug", "issue", "outage", "support"]
        ):
            return f"When you are handling your {short}, the initial response is key. What is the very first thing you do as soon as this comes in?"

        if any(
            k in task_lower
            for k in ["report", "dashboard", "analysis", "insight", "data"]
        ):
            return f"I'm interested in what sets your {short} in motion. What usually triggers this work or creates the initial request for it?"

        if any(
            k in task_lower
            for k in ["hire", "recruit", "onboard", "interview", "appraisal"]
        ):
            return f"To help me map out your {short}, I'd like to start with the first step. How does this process usually get started in your role?"

        if any(
            k in task_lower
            for k in ["budget", "invoice", "payroll", "reconcil", "close", "finance"]
        ):
            return f"For your {short}, it's important to understand the timing. What happens right before you start, and what is the specific trigger for it?"

        if any(
            k in task_lower
            for k in ["vendor", "purchase", "procurement", "supply", "inventory"]
        ):
            return f"Regarding your {short}, I'd like to know what inputs are needed. What information or items must come in before you can start working on this?"

        # Generic fallback — still open-ended and short
        return f"To help me understand the flow of your {short}, I'd like to start at the beginning. What needs to happen or be ready before you can start this work?"

    # ── Turn 2: What is hard / what does good look like? ────────────────────
    elif turn_number == 2:
        known_trigger = existing_wf.get("trigger", "")
        known_steps = existing_wf.get("steps") or []

        if known_trigger or known_steps:
            if any(
                k in task_lower
                for k in ["submission", "dossier", "regulatory", "audit", "compliance"]
            ):
                return f"Regarding your {short}, these processes can be complex. What is the most difficult part for you to get right, and how do you handle those challenges?"

            if any(
                k in task_lower
                for k in ["forecast", "pipeline", "revenue", "report", "analysis"]
            ):
                return f"For your {short}, accuracy is often a priority. What is the trickiest part to manage correctly, and how do you know when it has been done well?"

            if any(
                k in task_lower
                for k in ["deploy", "release", "build", "incident", "bug"]
            ):
                return f"When something goes wrong during your {short}, I'd like to know how you manage it. What specific steps do you take to fix the issue and get things back on track?"

            return f"I'd like to understand the challenges in your {short}. What is the hardest part of this process to get right, and why do you find it challenging?"

        # No Turn 1 data captured — ask for steps
        return f"To help me understand your {short}, I'd like to get a clearer picture of the process. Could you please walk me through how this works from start to finish?"

    # ── Turn 3: Gap fill — plain, targeted ──────────────────────────────────
    else:
        missing = []
        if not existing_wf.get("trigger"):
            missing.append("how it gets started")
        if not existing_wf.get("steps"):
            missing.append("the steps involved")
        if not existing_wf.get("output"):
            missing.append("the final result")

        if missing:
            missing_str = " and ".join(missing)
            return f"To wrap up our discussion on your {short}, I'd like to fill in a few remaining details. Could you please describe {missing_str}?"

        return f"To wrap up our discussion on your {short}, I'd like to ensure I have all the details. Is there anything else important we should capture?"


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
