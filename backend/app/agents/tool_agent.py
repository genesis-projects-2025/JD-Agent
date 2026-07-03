# backend/app/agents/tool_agent.py
import logging
from app.services.vector_service import find_similar_skills_or_tools, get_embeddings_for_text
from app.models.taxonomy_model import Tool

logger = logging.getLogger(__name__)

async def standardize_tools(db, raw_tools: list[str]) -> list[str]:
    """Given a list of raw user-typed tools, returns a standardized list.
    If a tool matches a standard one in the database (similarity >= 0.82), uses that.
    Otherwise, embeds and registers the new tool in the 'tools' table.
    """
    standardized = []
    for raw in raw_tools:
        clean_raw = raw.strip()
        if not clean_raw:
            continue
            
        try:
            # Search for highly similar tool
            similar = await find_similar_skills_or_tools(db, "tools", clean_raw, limit=1, threshold=0.82)
            if similar:
                standardized.append(similar[0]["name"])
            else:
                # Get embedding and save the new tool
                embedding = await get_embeddings_for_text(clean_raw)
                new_tool = Tool(name=clean_raw, embedding=embedding)
                db.add(new_tool)
                await db.commit()
                standardized.append(clean_raw)
        except Exception as e:
            await db.rollback()
            logger.warning(f"Tool standardization/insertion failed for '{clean_raw}': {e}")
            # Fallback
            standardized.append(clean_raw)
            
    return list(dict.fromkeys(standardized))  # Deduplicate while preserving order
