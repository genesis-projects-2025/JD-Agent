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
from app.core.langfuse_client import get_compiled_prompt
from app.agents.prompts import CRITIC_PROMPT

logger = logging.getLogger(__name__)

# Use a fast model for the critic pass
critic_llm = ChatGoogleGenerativeAI(
    google_api_key=settings.GEMINI_API_KEY,
    model="gemini-2.5-flash",
    temperature=0.1,
    response_mime_type="application/json",
)

# CRITIC_PROMPT has been moved to app/agents/prompts.py


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

        prompt = get_compiled_prompt(
            "critic-engine-prompt",
            CRITIC_PROMPT,
            insights=json.dumps(input_data)
        )

        from langchain_core.messages import SystemMessage, HumanMessage
        from app.core.langfuse_client import get_langfuse_callback_handler

        handler = get_langfuse_callback_handler(trace_name="critic-engine")
        callbacks = [handler] if handler else []

        response = await critic_llm.ainvoke(
            [
                SystemMessage(
                    content="You are a Senior HR Solutions Architect. Clean and synthesize the raw session data. Return ONLY valid JSON."
                ),
                HumanMessage(content=prompt),
            ],
            config={"callbacks": callbacks}
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
        logger.info(f"[Critic] Cleaned insights: {list(cleaned.keys())}")
        return cleaned

    except Exception as e:
        logger.warning(f"[Critic] Pass failed: {e}")
        return {}
