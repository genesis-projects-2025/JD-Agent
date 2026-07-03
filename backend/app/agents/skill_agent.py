# backend/app/agents/skill_agent.py
import logging
from app.services.vector_service import find_similar_skills_or_tools, get_embeddings_for_text
from app.models.taxonomy_model import Skill

logger = logging.getLogger(__name__)

async def standardize_skills(db, raw_skills: list[str]) -> list[str]:
    """Given a list of raw user-typed skills, returns a standardized list.
    If a skill matches a standard one in the database (similarity >= 0.82), uses that.
    Otherwise, embeds and registers the new skill in the 'skills' table.
    """
    standardized = []
    for raw in raw_skills:
        clean_raw = raw.strip()
        if not clean_raw:
            continue
            
        try:
            # Search for highly similar skill
            similar = await find_similar_skills_or_tools(db, "skills", clean_raw, limit=1, threshold=0.82)
            if similar:
                standardized.append(similar[0]["name"])
            else:
                # Get embedding and save the new skill
                embedding = await get_embeddings_for_text(clean_raw)
                new_skill = Skill(name=clean_raw, embedding=embedding)
                db.add(new_skill)
                await db.commit()
                standardized.append(clean_raw)
        except Exception as e:
            await db.rollback()
            logger.warning(f"Skill standardization/insertion failed for '{clean_raw}': {e}")
            # Fallback
            standardized.append(clean_raw)
            
    return list(dict.fromkeys(standardized))  # Deduplicate while preserving order
