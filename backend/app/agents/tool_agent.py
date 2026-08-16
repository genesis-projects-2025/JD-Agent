# backend/app/agents/tool_agent.py
import logging
import asyncio
from app.services.vector_service import (
    find_similar_skills_or_tools,
    get_embeddings_for_text,
)
from app.models.taxonomy_model import Tool

logger = logging.getLogger(__name__)


async def standardize_tools(db, raw_tools: list[str]) -> list[str]:
    """Given a list of raw user-typed tools, returns a standardized list.
    Batches DB queries and API calls to reduce latency from 30s to <2s.
    """
    clean_raw_tools = [raw.strip() for raw in raw_tools if raw and raw.strip()]
    if not clean_raw_tools:
        return []

    standardized = []

    # 1. Batch fetch all similarities at once
    similarity_tasks = [
        find_similar_skills_or_tools(db, "tools", clean_raw, limit=1, threshold=0.82)
        for clean_raw in clean_raw_tools
    ]
    similarity_results = await asyncio.gather(*similarity_tasks, return_exceptions=True)

    # 2. Determine which ones need new embeddings
    tools_needing_embeddings = []
    indices_needing_embeddings = []

    for idx, result in enumerate(similarity_results):
        if isinstance(result, Exception) or not result:
            tools_needing_embeddings.append(clean_raw_tools[idx])
            indices_needing_embeddings.append(idx)
        else:
            standardized.append(result[0]["name"])

    # 3. Batch fetch all embeddings at once
    if tools_needing_embeddings:
        embedding_tasks = [
            get_embeddings_for_text(tool) for tool in tools_needing_embeddings
        ]
        embedding_results = await asyncio.gather(
            *embedding_tasks, return_exceptions=True
        )

        # 4. Register new tools in DB
        for i, emb_result in enumerate(embedding_results):
            tool_name = tools_needing_embeddings[i]
            if isinstance(emb_result, Exception) or not emb_result:
                standardized.append(tool_name)  # Fallback to raw name
                continue

            try:
                new_tool = Tool(name=tool_name, embedding=emb_result)
                db.add(new_tool)
                standardized.append(tool_name)
            except Exception as e:
                await db.rollback()
                logger.warning(f"Tool insertion failed for '{tool_name}': {e}")
                standardized.append(tool_name)

        try:
            await db.commit()
        except Exception as e:
            await db.rollback()
            logger.error(f"Batch tool commit failed: {e}")

    # Deduplicate while preserving order
    return list(dict.fromkeys(standardized))
