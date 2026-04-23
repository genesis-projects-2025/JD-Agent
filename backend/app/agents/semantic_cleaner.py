# backend/app/agents/semantic_cleaner.py
import json
import logging
from typing import List, Union

from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.messages import SystemMessage, HumanMessage

from app.core.config import settings

logger = logging.getLogger(__name__)

# Dedicated LLM for data cleaning with low temperature for consistency
cleaner_llm = ChatGoogleGenerativeAI(
    google_api_key=settings.GEMINI_API_KEY,
    model="gemini-2.5-flash",
    temperature=0.1,
    response_mime_type="application/json",
)

CLEANING_PROMPT = """You are an Enterprise Data Sanctification Specialist parsing HR and job description data.

Your job is to take a raw list of {item_type} and perform Enterprise Semantic Deduplication & Professionalization:
1. SEMANTIC DEDUPLICATION: Group together any items that mean the exact same thing or heavily overlap (e.g., "doing payroll", "employee payroll management", and "payroll management" -> 1 item).
2. PROFESSIONALIZATION: Correct typos. Rewrite the grouped item into a polished, formal business tone suitable for an enterprise job description.

Input List ({item_type}):
{raw_list}

RULES FOR {item_type}:
- If {item_type} == "tasks": Return an array of objects. Each object MUST have:
  - "description": The professionalized task description (strong action verb, clear context).
  - "frequency": Estimate frequency or output "regular".
  - "category": "technical", "administrative", "managerial", or "strategic".
- If {item_type} == "priority_tasks", "tools", or "skills": Return an array of strings. Each string MUST be the formally recognized proper noun or professional phrase (e.g., "node.js" -> "Node.js"). VERY IMPORTANT FOR SKILLS: ONLY return hard, technical, or domain-specific skills (e.g. "Financial Modeling", "Python", "Agile"). COMPLETELY IGNORE AND REMOVE ANY soft skills, generic verbs, or personality traits (e.g. "communication", "working hard", "leadership", "organizing", "mentorship").

OUTPUT REQUIREMENT:
Return ONLY valid JSON in the following format:
{{
    "cleaned_items": [ ... ]
}}
"""

async def deduplicate_and_professionalize(items: List[Union[str, dict]], item_type: str) -> List[Union[str, dict]]:
    """Clean and deduplicate a list of items using an LLM."""
    if not items:
        return []

    logger.debug(f"[SemanticCleaner] Cleaning {len(items)} items of type '{item_type}'")
    
    if item_type in ["tools", "skills"] and len(items) == 1 and isinstance(items[0], str):
        return [items[0].strip().title() if len(items[0]) <= 15 else items[0]]

    try:
        response = await cleaner_llm.ainvoke([
            SystemMessage(content=CLEANING_PROMPT.format(item_type=item_type, raw_list=json.dumps(items))),
            HumanMessage(content="Clean this list.")
        ])

        response_text = str(response.content).strip()
        logger.debug(f"[SemanticCleaner] LLM Response: {response_text[:200]}...")
        
        # Clean up code blocks if present
        if response_text.startswith("```json"):
            response_text = response_text[7:]
        if response_text.endswith("```"):
            response_text = response_text[:-3]

        try:
            parsed = json.loads(response_text)
            cleaned_items = parsed.get("cleaned_items", [])
        except (json.JSONDecodeError, AttributeError):
            logger.warning(f"[SemanticCleaner] Failed to parse JSON for {item_type}. Response: {response_text[:100]}...")
            cleaned_items = []
        
        logger.debug(f"[SemanticCleaner] Resulting cleaned items count: {len(cleaned_items)}")
        
        # Fallback if the LLM returns empty or malformed but the input wasn't empty
        if not cleaned_items and items:
             logger.warning(f"[SemanticCleaner] LLM returned empty list for {item_type}. Returning raw items.")
             return items
             
        logger.info(f"[SemanticCleaner] Successfully cleaned {len(items)} raw {item_type} down to {len(cleaned_items)} professional items.")
        return cleaned_items

    except Exception as e:
        logger.error(f"[SemanticCleaner] Failed to clean items: {e}")
        return items  # Fallback to the original list
