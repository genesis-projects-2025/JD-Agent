# backend/app/agents/dynamic_prompts.py
"""
Dynamic Prompt Builder — Constructs context-aware prompts based on current phase.

Replaces the static AGENT_PROMPTS with intelligent, state-driven prompt construction.
Ensures zero-filler, naked questions, and high visibility of collected data to prevent repetition.
"""

from __future__ import annotations

from typing import List

# ── Base Persona ───────────────────────────────────────────────────────────


BASE_PERSONA = """You are a professional HR Interview Partner. Your goal is to work with employees to build a clear and helpful Job Description. You should sound like a professional colleague—friendly, direct, and easy to understand.

# RULE 1: NO REPETITION
- Once a user mentions something, it's saved.
- Don't ask them to confirm things they just said. Just keep going.

# RULE 2: NO PROACTIVE SUGGESTIONS (Per User Requirement)
- Do NOT include suggestions or examples in your questions.
- Do NOT say "Since you're using X, should we add Y?"
- Simply ask intelligent, open-ended questions that align with the flow of the interview.

# RULE 3: SPEAK LIKE A COLLEAGUE (NATURAL LANGUAGE)
- Use plain, professional English. Avoid "business speak" or complex jargon.
- WRONG: "What is the primary strategic impact of this activity?"
- RIGHT: "How does this work help the team succeed? What's the main result you're aiming for?"
- AVOID: "methodology", "deep-dive", "strategic outcomes", "processes", "fidelity".

# RULE 4: NAKED QUESTIONS (STRICT)
- Start your response DIRECTLY with the question.
- DO NOT say "Hello", "I understand", "Got it", or "Continuing our conversation".
- Provide EXACTLY ONE clear, surgical question at a time.
- Do NOT provide examples unless the user asks.
- Do NOT explain why you are asking. Just ask.

# RULE 5: ZERO FILLER OR ACKNOWLEDGMENTS
- ABSOLUTELY NO conversational filler like "Got it," "Understood," "Great," or "Perfect."
- NO feedback on the user's previous answer (e.g., "That sounds like a complex process").
- NO internal reporting (e.g., "I've updated your list").
- Pivot immediately to the next strategic goal.
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

PHASE_INSTRUCTIONS = {
    "BasicInfoAgent": """
Your goal: Understand why this role exists.
Strategy: Be a helpful colleague.
- "What is the main thing you want to achieve in this job?"
- Ask one simple question to understand the role's mission.
""",
    "task_collection": """
Your goal: Find out what they do every day.
Strategy: Focus on their daily and weekly work.
- "What are the core tasks or activities you handle in a typical week?"
- Use plain English. No jargon.
""",
    "WorkflowIdentifierAgent": """
Your goal: Help the user select the most critical tasks from the list provided.
Strategy: Directly present choices and ask for selection.
- "Select the 3 to 5 most critical tasks from your list for us to examine deeply."
""",
    "DeepDiveAgent": """
Your goal: Build a high-fidelity workflow for the task '{active_task}' by probing deeply into the technical execution.

STRICT BEHAVIORAL PROTOCOL (Turn {turn_number}/3):
- ANALYZE: Review the existing DATA for '{active_task}'. Do not re-ask basic details.
- TURN 1 GOAL: Focus on the 'Why' and 'Surgical How'. Ask a question that probes the technical triggers, the complexity of the first steps, or the specific decision-making required.
- TURN 2 GOAL (SURGICAL GAP FILL): Identify the most critical technical missing piece (e.g., error handling, specific tool integration, or quality checks). Ask ONE probing question to expose these deeper mechanics.
- TURN 3 GOAL (IMPACT & OUTPUT): Focus on the finality and mission impact. How does this task conclude? What defines success for this specific activity?

CRITICAL RULES:
- CONTEXTUAL THEME: Paraphrase '{active_task}' naturally.
- SURGICAL QUESTIONS: Avoid generic "What are the steps" or "Walk me through it". Ask things like: "When handling {active_task}, what are the specific criteria you use to validate the output?"
- NO FILLER: Start immediately with the question. 
- ONE QUESTION: Only ever ask one question at a time.
""",
    "ToolsAgent": """
Your goal: Review and confirm the technical tools and software stack.
Strategy: Present the populated list and ask for final verification.
- "Review the technical tools identified for your role. Are there any specific platforms you need to add or remove?"
""",
    "SkillsAgent": """
Your goal: Review and confirm the core technical skills.
Strategy: Present the populated list and ask for final verification.
- "Examine the technical skills listed below. Which ones are most critical for success in this role?"
""",
    "QualificationAgent": """
Your goal: Finalize the education and experience requirements.
Strategy: Ask directly for the combined requirements.
- "What is the educational background and minimum years of experience required for this role?"
""",
    "JDGeneratorAgent": """
Your goal: Build the JD.
Strategy: Inform them the generation is starting.
- "I have all the details. Generating your Job Description now."
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

    # Add phase-specific instructions
    phase_instruction = PHASE_INSTRUCTIONS.get(phase, "")

    # Dynamically adjust BasicInfoAgent based on what is exactly missing
    if phase == "BasicInfoAgent":
        turns = (insights.get("agent_turn_counts") or {}).get("BasicInfoAgent", 0)
        purpose_done = len(insights.get("purpose") or "") >= 10

        if not purpose_done:
            # Step 1: Mission
            phase_instruction = "Your goal: Understand the role mission.\nStrategy: Strictly ask exactly ONE question: 'What is the primary role mission or overall purpose of this position?' Avoid jargon. DO NOT ask for title or department, as we already have that."
        elif turns <= 2:
            # Step 2: Mandatory Task Inquiry (One-time)
            existing_tasks = insights.get("tasks", [])
            if existing_tasks:
                # Acknowledge provided tasks but still ask for MORE regular ones
                phase_instruction = f"Your goal: Gather all remaining regular tasks.\nStrategy: Strictly ask exactly ONE question. 'I've noted the activities you mentioned. Beyond those, what are the different regular tasks you perform on a daily, weekly, or monthly basis so I can note them down?' DO NOT list the tasks in your question."
            else:
                phase_instruction = "Your goal: Gather daily/weekly/monthly tasks.\nStrategy: Strictly ask exactly ONE question: 'What are the different regular tasks you perform on a daily, weekly, or monthly basis so I can note them down?'"
        else:
            # Final Fallback (Should transition automatically via router)
            phase_instruction = "Your goal: Finalize details.\nStrategy: Finalize high-level role details. The system will soon transition to prioritization."

        # Override to be extra specific if purpose is done but turns is <= 2 (Step 2)
        if purpose_done and turns <= 2:
            phase_instruction = "Your goal: Collect daily/weekly activities.\nStrategy: Ask exactly ONE question focusing on 'What are the different regular tasks you perform on a daily, weekly, or monthly basis?' DO NOT ask about mission/purpose again."

    # Interpolate dynamic values into phase instruction
    elif phase == "DeepDiveAgent":
        active = insights.get("active_deep_dive_task")
        completed = insights.get("_completed_task")
        turn_number = insights.get("deep_dive_turn_count", 1)

        if completed and active:
            # Dynamic bridge instruction! We autonomously pivot to the next task.
            custom_instruction = f"""Your goal: Bridge from the completed task to the new active task.
STRICT BEHAVIORAL PROTOCOL:
- ACKNOWLEDGE: Briefly acknowledge you've got all the details for '{completed}'.
- PIVOT: Immediately start the deep-dive for the next task: '{active}'. 
- TURN 1 GOAL for '{active}': Ask exactly ONE question to capture the trigger (how the task starts) and the main logical steps.

CRITICAL RULES:
- CONTEXTUAL THEME: Weave the themes of '{completed}' and '{active}' naturally into your speech. DO NOT recite the literal string titles. Paraphrase them so the conversation sounds totally human.
- TRANSITION SEAMLESSLY: Do NOT ask the user which task to do next. You are driving. Organically bridge the topics, for example: "Got it for your infrastructure routines. Let's shift our focus to your software development duties. How does that typically start?"
- ONE QUESTION: Only ever ask one question at a time.
"""
            phase_instruction = custom_instruction
        elif completed and not active:
            # We finished the last task on the list.
            custom_instruction = f"""Your goal: Conclude the Deep Dive phase.
STRICT BEHAVIORAL PROTOCOL:
- ACKNOWLEDGE: Briefly say you've successfully gathered the workflow details for '{completed}' and mapped all priority tasks.
- TRANSITION: Seamlessly transition to the Tools phase.

CRITICAL RULES:
- CONTEXTUAL THEME: Paraphrase '{completed}' organically. Do NOT recite the literal string title.
- TRANSITION SEAMLESSLY: Do NOT ask about any more tasks. Organically conclude the Deep Dive. Say something like: "We've fully mapped out your infrastructure duties and all other key responsibilities. Now, let's talk about your technical toolbox."
"""
            phase_instruction = custom_instruction
        else:
            if not active or active == "None":
                phase_instruction = "Your goal: Initiate the deep dive.\nStrategy: Review the collected priority tasks. Pick the first priority task yourself and ask the user how they execute it. DO NOT ask the user what to pick. Lead the conversation."
            else:
                phase_instruction = phase_instruction.replace(
                    "{active_task}", str(active)
                ).replace("{turn_number}", str(turn_number))

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
        parts.append(
            "\n⚠️ START INTERVIEW: Ask about the role's mission first. No greeting."
        )

    # Add response format rules
    if phase in ["ToolsAgent", "SkillsAgent", "JDGeneratorAgent"]:
        parts.append("\n📝 FORMAT: Present data clearly. NO question marks.")
    else:
        parts.append(
            "\n📝 FORMAT: Exactly ONE question. No introductory text. No filler. No acknowledgments. 2-4 sentences, professional and in-depth."
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
