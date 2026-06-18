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

Your job is to take a raw list of {item_type} and perform Enterprise Semantic Deduplication & Professionalization for the role of '{role_title}' in the department of '{department}':
1. SEMANTIC DEDUPLICATION & MERGING: Group together any items that mean the exact same thing or heavily overlap (e.g. merge 'SAP', 'Ariba', and 'ERP systems' into a single professional item like 'SAP Ariba' or 'ERP Systems (SAP)').
2. PROFESSIONALIZATION: Correct typos. Rewrite the grouped item into a polished, formal business tone (concise noun phrases only).
3. NOISE EXCLUSION: Completely remove explanatory notes, descriptive clauses, parenthetical side notes, or complete sentences (e.g. 'Depending on industry...').
4. DEPARTMENT & ROLE RELEVANCE FILTER: Strictly filter out tools or skills that are irrelevant to the '{department}' department or the role of '{role_title}'. The tools/skills must be standard, specific, and appropriate to '{department}' (e.g., scientific/experimental tools/skills for R&D/Quality, manufacturing/operations/machinery tools/skills for Plant, financial/billing tools/skills for Finance, and IT/software tools/skills for Tech).
5. SIZE CAP & SORT: Select and return AT MOST 20 of the most critical and relevant items, sorted by importance (most crucial items first).

CRITICAL RULES FOR ITEM TYPE '{item_type}':

IF ITEM_TYPE == "tools":
  - ONLY return actual SOFTWARE, PLATFORMS, HARDWARE, SERVICES, or IDES.
  - Examples: "AWS", "Docker", "MySQL", "PostgreSQL", "VS Code", "Git", "Jira", "Slack", "FastAPI"
  - DO NOT include: "API Design", "System Architecture", "Backend Development", "Problem Solving" (these are SKILLS)
  - Return format: Array of strings (proper nouns/technical names)
  - Examples: ["AWS", "Docker", "PostgreSQL", "Git", "VS Code"]

IF ITEM_TYPE == "skills":
  - ONLY return HARD, TECHNICAL, or DOMAIN-SPECIFIC COMPETENCIES.
  - Examples: "Backend Development", "Frontend Development", "API Design", "Database Management", "Cloud & DevOps"
  - DO NOT include: "Communication", "Leadership", "Teamwork" (SOFT SKILLS - remove these)
  - DO NOT include: Actual tools like "AWS", "Docker", "MySQL" (these are TOOLS, not skills)
  - Return format: Array of strings (expertise areas/competencies)
  - Examples: ["Backend Development", "API Design and Development", "Database Management", "Cloud & DevOps"]

Input List ({item_type}):
{raw_list}

OUTPUT REQUIREMENT:
Return ONLY valid JSON in the following format:
{{
    "cleaned_items": [ ... ]
}}
"""


async def deduplicate_and_professionalize(
    items: List[Union[str, dict]], 
    item_type: str, 
    role_title: str = "General Role",
    department: str = ""
) -> List[Union[str, dict]]:
    """Clean and deduplicate a list of items using an LLM.

    CRITICALLY SEPARATES TOOLS FROM SKILLS.
    """
    if not items:
        return []

    logger.debug(f"[SemanticCleaner] Cleaning {len(items)} items of type '{item_type}' in department '{department}'")

    if (
        item_type in ["tools", "skills"]
        and len(items) == 1
        and isinstance(items[0], str)
    ):
        return [items[0].strip().title() if len(items[0]) <= 15 else items[0]]

    try:
        dept_str = department if department else "General Department"
        response = await cleaner_llm.ainvoke(
            [
                SystemMessage(
                    content=CLEANING_PROMPT.format(
                        item_type=item_type,
                        raw_list=json.dumps(items),
                        role_title=role_title,
                        department=dept_str,
                    )
                ),
                HumanMessage(
                    content=f"Clean and professionalize this list of {item_type} for the '{role_title}' in the '{dept_str}' department. Keep tools and skills completely separate, select at most 20 of the most important items, and filter out all noise."
                ),
            ]
        )

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
            logger.warning(
                f"[SemanticCleaner] Failed to parse JSON for {item_type}. Response: {response_text[:100]}..."
            )
            cleaned_items = []

        logger.debug(
            f"[SemanticCleaner] Resulting cleaned items count: {len(cleaned_items)}"
        )

        # Fallback if the LLM returns empty or malformed but the input wasn't empty
        if not cleaned_items and items:
            logger.warning(
                f"[SemanticCleaner] LLM returned empty list for {item_type}. Returning raw items."
            )
            return items

        logger.info(
            f"[SemanticCleaner] Successfully cleaned {len(items)} raw {item_type} down to {len(cleaned_items)} professional items."
        )
        return cleaned_items

    except Exception as e:
        logger.error(f"[SemanticCleaner] Failed to clean items: {e}")
        return items  # Fallback to the original list
