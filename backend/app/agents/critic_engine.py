# backend/app/agents/critic_engine.py
"""
Critic Engine — Performs active synthesis, semantic folding, and cleaning of extracted data.

This engine runs AFTER extraction but BEFORE conversation to ensure the data is
organized into strategic Expertise Pillars" and "Impact Areas."
"""

from __future__ import annotations
import json
import logging
from typing import Dict
from langchain_google_genai import ChatGoogleGenerativeAI
from app.core.config import settings
from app.core.llm_throttle import throttled_ainvoke
from app.core.langfuse_client import get_compiled_prompt
from app.agents.prompts import CRITIC_PROMPT

logger = logging.getLogger(__name__)

# Use a fast model for the critic pass
critic_llm = ChatGoogleGenerativeAI(
    google_api_key=settings.GEMINI_API_KEY,
    model="gemini-2.5-flash",
    temperature=0.1,
    max_output_tokens=500,
    response_mime_type="application/json",
)


# CRITIC_PROMPT has been moved to app/agents/prompts.py
def _force_merge_tasks(tasks: list) -> list:
    """Python-side bulletproof merge to fix LLM splitting tasks at 'and'/'or'."""
    if not tasks:
        return []

    merged = []
    for task in tasks:
        task_str = str(task).strip()
        if not task_str:
            continue

        # If the task starts with 'and ' or 'or ', append it to the previous task
        if (
            task_str.lower().startswith("and ") or task_str.lower().startswith("or ")
        ) and merged:
            # Remove 'and '/'or ' from the start and append it to the last task
            clean_addition = task_str.split(" ", 1)[1] if " " in task_str else task_str
            merged[-1] = f"{merged[-1]} and {clean_addition}"
        else:
            merged.append(task_str)

    return merged


async def run_critic_pass(insights: dict) -> dict:
    """Run the semantic folding and cleaning pass on insights."""
    try:
        # Prepare cleaning input (focus on skills, tools, and tasks)
        input_data = {
            "tasks": insights.get("tasks", []),
            "tools": insights.get("tools", []),
            "skills": insights.get("skills", []),
            "expertise_pillars": insights.get("expertise_pillars", []),
        }

        # Don't waste tokens if there's nothing to clean
        if not any(input_data.values()):
            return {}

        # Fetch role context to prevent HR tasks in DevOps JDs
        id_ctx = insights.get("identity_context", {})
        role_title = id_ctx.get("title", "Unknown Role")
        department = id_ctx.get("department", "Unknown Department")

        prompt = f"""
        You are a Senior HR Solutions Architect. Clean and synthesize the raw session data for the role of '{role_title}' in the '{department}' department.
        
        CRITICAL RULES FOR TASKS:
        1. NEVER SPLIT BY CONJUNCTIONS: If the raw data says "CI/CD pipelines and production failures", you MUST combine them into ONE task: "Manage CI/CD pipelines and resolve production failures". Do not split tasks at the word "and", "or", or commas.
        2. REWRITE FOR CONCISENESS: Rewrite every task to be a short, punchy bullet point (max 8-10 words). 
           - BAD: "Work on error resolvement for the servers, optimizing server performance and efficiency."
           - GOOD: "Resolve server errors and optimize performance"
        3. MERGE DUPLICATES: Combine duplicate or overlapping ideas into one single task.
        4. REMOVE IRRELEVANT TASKS: Strictly DELETE any tasks that do not belong to the '{role_title}' role. (e.g., If the role is DevOps, DELETE any HR, Mechanical, or QA tasks).
        5. ACTION VERBS: Every task MUST start with a strong action verb (e.g., Resolve, Maintain, Optimize, Monitor, Implement).
        
        CRITICAL RULES FOR TOOLS & SKILLS:
        1. Deduplicate and merge synonyms.
        2. Remove generic soft skills (e.g., "Communication") unless explicitly requested.
        
        Return ONLY valid JSON with keys: "tasks", "tools", "skills", "expertise_pillars".
        
        RAW DATA TO CLEAN:
        {json.dumps(input_data)}
        """

        from langchain_core.messages import SystemMessage, HumanMessage
        from app.core.langfuse_client import get_langfuse_callback_handler

        handler = get_langfuse_callback_handler(trace_name="critic-engine")
        callbacks = [handler] if handler else []

        response = await throttled_ainvoke(
            critic_llm,
            [
                SystemMessage(
                    content="You are a Senior HR Solutions Architect. Clean and synthesize the raw session data. Return ONLY valid JSON."
                ),
                HumanMessage(content=prompt),
            ],
            config={"callbacks": callbacks},
        )
        text = (
            response.content
            if isinstance(response.content, str)
            else str(response.content)
        )

        # Clean up Markdown code blocks if present
        if "```json" in text:
            text = text.split("```json")[1].split("```")[0].strip()
        elif "```" in text:
            text = text.split("```")[1].strip()

        cleaned = json.loads(text)
        
        # ─── BULLETPROOF PYTHON MERGE ───
        # If the LLM failed to merge them, forcefully merge them in Python
        if "tasks" in cleaned and isinstance(cleaned["tasks"], list):
            cleaned["tasks"] = _force_merge_tasks(cleaned["tasks"])
        # ──────────────────────────────────
        
        logger.info(f"[Critic] Cleaned insights: {list(cleaned.keys())}")
        return cleaned

    except Exception as e:
        logger.warning(f"[Critic] Pass failed: {e}")
        return {}
