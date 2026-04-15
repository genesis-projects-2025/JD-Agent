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


# ── Phase-Specific Instructions ──────────────────────────────────────────────


def _build_basic_info_instruction(insights: dict) -> str:
    """Dynamically generate BasicInfoAgent instructions based on what's missing."""
    purpose = insights.get("purpose") or ""
    tasks = insights.get("tasks") or []
    turns = (insights.get("agent_turn_counts") or {}).get("BasicInfoAgent", 0)

    role_title = (
        insights.get("identity_context", {}).get("title", "")
        or insights.get("role", "")
        or "this role"
    )

    # Scope boundary — absolutely critical
    scope = (
        "\n\nSCOPE BOUNDARY (ABSOLUTE):"
        "\n- You MUST NOT ask about tools, software, platforms, skills, certifications, or any deep process details."
        "\n- You MUST NOT ask about challenges, problem-solving approaches, or quality standards."
        "\n- Your domain is ONLY: role purpose, daily work, weekly work, monthly work, and regular responsibilities."
        "\n- If the user mentions tools or skills, silently note them but do NOT follow up on them."
    )

    if len(purpose) < 10:
        # No purpose captured yet — ask about role mission
        return (
            f"Your goal: Understand why the role '{role_title}' exists."
            f"\nAsk ONE intelligent question about the core mission or primary purpose of this role."
            f"\nDo NOT use jargon. Ask in plain, grounded language."
            f"{scope}"
        )

    if len(tasks) < 3:
        # Purpose captured, need tasks
        return (
            f"Your goal: Map the regular work activities for '{role_title}'."
            f"\nAsk ONE question about what the person does on a daily, weekly, or monthly basis."
            f"\nFocus on breadth — get a wide view of all their regular responsibilities."
            f"\nDo NOT repeat tasks already listed in DATA ALREADY COLLECTED."
            f"{scope}"
        )

    if len(tasks) < 6 and turns < 4:
        # Have some tasks, need more
        return (
            f"Your goal: Expand the task list for '{role_title}' (currently {len(tasks)} tasks, need ~6+)."
            f"\nAsk ONE question about any ad-hoc, periodic, or less frequent responsibilities not yet captured."
            f"\nDo NOT repeat any tasks already listed in DATA ALREADY COLLECTED."
            f"\nIf the user has shared enough, the system will automatically move forward."
            f"{scope}"
        )

    # Tasks are sufficient — finalize
    return (
        f"Your goal: Final check for '{role_title}'."
        f"\nAsk ONE brief question about any remaining important aspects of the role not yet discussed."
        f"\nKeep it short. The system will transition to the next phase soon."
        f"{scope}"
    )


def _build_deep_dive_instruction(insights: dict) -> str:
    """Dynamically generate DeepDiveAgent instructions based on active task and turn."""
    active = insights.get("active_deep_dive_task")
    completed = insights.get("_completed_task")
    turn_number = insights.get("deep_dive_turn_count", 1)
    visited = insights.get("visited_tasks") or []

    # Scope boundary
    scope = (
        "\n\nDEEP DIVE RULES:"
        "\n- Every question MUST explicitly name the task you are asking about."
        "\n- Do NOT say 'I am recording' or 'I have noted'. Just ask the next question."
        "\n- Do NOT ask the user which task to discuss. YOU lead the conversation."
    )

    if completed and active:
        # Transitioning from one task to the next
        return (
            f"'{completed}' is captured. Now deep-diving: '{active}'."
            f"\nAsk exactly ONE question about how '{active}' begins — what triggers it and what inputs are needed to start?"
            f"{scope}"
        )

    if completed and not active:
        # All tasks are done
        return (
            "All priority tasks have been deep-dived."
            "\nThe system will transition to the Tools phase automatically."
            "\nSay: 'All priority tasks have been mapped in detail.'"
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

        return (
            f"Your goal: Begin deep-diving task: '{active}'."
            f"\nAsk exactly ONE question about how '{active}' begins — what triggers it and what inputs are needed?"
            f"{scope}"
        )

    # Active task in progress — turn-based protocol
    if turn_number <= 1:
        return (
            f"CURRENT TASK: '{active}' — Turn {turn_number}/3"
            f"\nAsk about how '{active}' begins — what triggers this task and what are the initial inputs or requests needed to start it?"
            f"{scope}"
        )
    elif turn_number == 2:
        return (
            f"CURRENT TASK: '{active}' — Turn {turn_number}/3"
            f"\nAsk about the challenges and quality standards in '{active}' — what are the most difficult aspects, and what defines an expert-level outcome for this specific task?"
            f"{scope}"
        )
    else:
        # Turn 3 — conditional, focus on gaps
        wf = (insights.get("workflows") or {}).get(active, {})
        missing = []
        if not wf.get("trigger"):
            missing.append("how it starts")
        if not wf.get("steps"):
            missing.append("the step-by-step process")
        if not wf.get("output"):
            missing.append("the final output or deliverable")

        if missing:
            missing_str = ", ".join(missing)
            return (
                f"CURRENT TASK: '{active}' — Turn {turn_number}/3 (FINAL)"
                f"\nWe still need: {missing_str} for '{active}'."
                f"\nAsk ONE targeted question to capture the missing information."
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
        for i, t in enumerate(tasks):
            desc = t.get("description", str(t)) if isinstance(t, dict) else str(t)
            lines.append(f"    {i + 1}. {desc[:60]}...")
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

            # Detail what we ALREADY HAVE to prevent repetition
            if active_data.get("steps"):
                lines.append(
                    f"    ✓ KNOWN STEPS: {len(active_data['steps'])} steps recorded."
                )
            if active_data.get("tools"):
                lines.append(f"    ✓ KNOWN TOOLS: {active_data['tools']}")

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

    # Add RAG suggestions
    if rag_context:
        examples = "\n".join([f"  • {ex}" for ex in rag_context[:3]])
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
