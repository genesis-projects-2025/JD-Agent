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

logger = logging.getLogger(__name__)

# Use a fast model for the critic pass
critic_llm = ChatGoogleGenerativeAI(
    google_api_key=settings.GEMINI_API_KEY,
    model="gemini-2.5-flash",
    temperature=0.1,
    response_mime_type="application/json",
)

CRITIC_PROMPT = """You are a Senior HR Solutions Architect and Data Strategist.
Your job is to "clean" and "synthesize" the raw session memory of a Job Description interview.

### GOALS:
1. **Semantic Folding (Deduplication)**: 
   - Group highly similar skills/tools into a single, professional "Expertise Pillar".
   - Example: ["Data Validation", "Data Verification", "Data Reconciliation"] -> "Data Integrity & Reconciliation".
   - Rule: Only fold if they share >70% semantic intent.

2. **Clean Noise**:
   - Remove conversational filler from task descriptions (e.g., "In the company I manage...", "Basically doing...").
   - Strip redundant phrases.

3. **Strategic Prioritization**:
   - Look at the `tasks` list. Rank them by inferred strategic value to the business.

### INPUT:
Current Session Insights:
{insights}

### OUTPUT:
Return a JSON object containing ONLY the keys that need updating in the state. 
If a list of skills is folded, provide the NEW consolidated list.

EXAMPLE OUTPUT:
{{
  "skills": ["Data Integrity & Reconciliation", "System Architecture", ...],
  "tasks": [
     {{ "description": "Cleaned description 1", "priority": "high" }},
     ...
  ],
  "expertise_pillars": ["Cloud Infrastructure", "Security Compliance"]
}}

Return ONLY valid JSON.
"""


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

        prompt = CRITIC_PROMPT.format(insights=json.dumps(input_data))

        from langchain_core.messages import SystemMessage, HumanMessage

        response = await critic_llm.ainvoke(
            [
                SystemMessage(
                    content="You are a Senior HR Solutions Architect. Clean and synthesize the raw session data. Return ONLY valid JSON."
                ),
                HumanMessage(content=prompt),
            ]
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
