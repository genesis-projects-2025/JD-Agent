"""
Brain Agent Semantic Query Cache Service.

Implements an in-memory cache for semantic query responses using cosine similarity
on query embeddings.
"""

import asyncio
import logging
import math
import time
from typing import Any, Dict, List, Optional

from app.services.vector_service import get_embeddings

logger = logging.getLogger(__name__)

# Configurable constants
CACHE_TTL_SECONDS: float = 1800.0  # 30 minutes
CACHE_SIMILARITY_THRESHOLD: float = 0.92
MAX_CACHE_SIZE: int = 200

# Thread-safe in-memory cache structure
# Dict mapping query_text to cache entry dict
_cache: Dict[str, Dict[str, Any]] = {}
_cache_lock = asyncio.Lock()


def cosine_similarity(v1: List[float], v2: List[float]) -> float:
    """Calculate cosine similarity between two vectors using math.sqrt and sum."""
    if not v1 or not v2 or len(v1) != len(v2):
        return 0.0
    dot_product = sum(a * b for a, b in zip(v1, v2))
    norm_a = math.sqrt(sum(a * a for a in v1))
    norm_b = math.sqrt(sum(b * b for b in v2))
    if norm_a == 0.0 or norm_b == 0.0:
        return 0.0
    return dot_product / (norm_a * norm_b)


async def check_cache(query_text: str) -> Optional[str]:
    """
    Check the semantic cache for a match with query_text.
    
    Generates the query embedding, searches through cached entries,
    and returns the cached response if a semantic match is found within
    the similarity threshold and TTL.
    """
    try:
        embeddings = get_embeddings()
        query_embedding = await asyncio.to_thread(embeddings.embed_query, query_text)
    except Exception as e:
        logger.error(f"Failed to generate embedding for query in cache check: {e}")
        return None

    current_time = time.time()
    best_similarity = -1.0
    best_key: Optional[str] = None
    best_entry: Optional[Dict[str, Any]] = None

    async with _cache_lock:
        expired_keys = []
        for key, entry in list(_cache.items()):
            # TTL check
            if current_time - entry["timestamp"] > CACHE_TTL_SECONDS:
                expired_keys.append(key)
                continue

            sim = cosine_similarity(query_embedding, entry["query_embedding"])
            if sim > best_similarity:
                best_similarity = sim
                best_key = key
                best_entry = entry

        # Evict expired entries found during lookup
        for key in expired_keys:
            _cache.pop(key, None)

        if best_entry and best_similarity >= CACHE_SIMILARITY_THRESHOLD:
            # LRU eviction policy: move hit entry to the end
            # standard python dict maintains insertion order, so pop and push
            _cache.pop(best_key)
            _cache[best_key] = best_entry
            
            logger.info(
                "Cache hit for query '%s' (similarity: %.4f, matched: '%s')",
                query_text,
                best_similarity,
                best_key
            )
            return best_entry["response"]

        logger.info("Cache miss for query '%s'", query_text)
        return None


async def store_cache(query_text: str, response: str, session_id: str) -> None:
    """
    Store a query and its response in the cache.
    
    Generates embedding for the query and inserts the record. Evicts oldest
    entries if cache size exceeds max limit (LRU eviction).
    """
    try:
        embeddings = get_embeddings()
        query_embedding = await asyncio.to_thread(embeddings.embed_query, query_text)
    except Exception as e:
        logger.error(f"Failed to generate embedding for query in cache store: {e}")
        return

    current_time = time.time()
    entry = {
        "query_embedding": query_embedding,
        "response": response,
        "session_id": session_id,
        "timestamp": current_time,
        "query_text": query_text,
    }

    async with _cache_lock:
        # If query_text already exists, remove it first to update its position
        _cache.pop(query_text, None)
        _cache[query_text] = entry

        # Evict oldest entry (LRU) if capacity exceeded
        while len(_cache) > MAX_CACHE_SIZE:
            oldest_key = next(iter(_cache))
            _cache.pop(oldest_key, None)


async def clear_cache() -> None:
    """Clear all entries in the cache."""
    async with _cache_lock:
        _cache.clear()
    logger.info("Cache cleared")
