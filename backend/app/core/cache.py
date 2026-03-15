# app/core/cache.py
# Simple Redis cache layer — falls back gracefully if Redis is not available

import json
import logging
from typing import Optional, Any

logger = logging.getLogger(__name__)

# Try to import redis; if not installed, cache is silently disabled
try:
    import redis.asyncio as aioredis

    _redis_client = aioredis.from_url(
        "redis://localhost:6379",
        decode_responses=True,
        socket_connect_timeout=1,
        socket_timeout=1,
    )
    REDIS_AVAILABLE = True
except ImportError:
    _redis_client = None
    REDIS_AVAILABLE = False
    logger.warning("redis package not installed — caching disabled")


async def get_cache(key: str) -> Optional[Any]:
    """Return cached value or None if miss / Redis unavailable."""
    if not REDIS_AVAILABLE or _redis_client is None:
        return None
    try:
        data = await _redis_client.get(key)
        return json.loads(data) if data else None
    except Exception as e:
        logger.debug(f"Cache GET failed for {key}: {e}")
        return None


async def set_cache(key: str, value: Any, ttl: int = 30) -> None:
    """Store value with TTL (seconds). Silent failure if Redis unavailable."""
    if not REDIS_AVAILABLE or _redis_client is None:
        return
    try:
        await _redis_client.setex(key, ttl, json.dumps(value, default=str))
    except Exception as e:
        logger.debug(f"Cache SET failed for {key}: {e}")


async def invalidate_cache(*keys: str) -> None:
    """Delete one or more exact cache keys."""
    if not REDIS_AVAILABLE or _redis_client is None:
        return
    try:
        if keys:
            await _redis_client.delete(*keys)
    except Exception as e:
        logger.debug(f"Cache DELETE failed: {e}")


async def invalidate_pattern(pattern: str) -> None:
    """Delete all keys matching a glob pattern e.g. 'jds:employee:*'."""
    if not REDIS_AVAILABLE or _redis_client is None:
        return
    try:
        keys = await _redis_client.keys(pattern)
        if keys:
            await _redis_client.delete(*keys)
    except Exception as e:
        logger.debug(f"Cache pattern DELETE failed for {pattern}: {e}")
