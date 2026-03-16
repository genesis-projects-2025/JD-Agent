# app/core/cache.py
# Simple Redis cache layer — falls back gracefully if Redis is not available

import json
import logging
import functools
from typing import Optional, Any, Callable
from app.core.config import settings

logger = logging.getLogger(__name__)

# Try to import redis; if not installed, cache is silently disabled
try:
    import redis.asyncio as aioredis

    _redis_client = aioredis.from_url(
        settings.REDIS_URL,
        decode_responses=True,
        socket_connect_timeout=1,
        socket_timeout=1,
    )
    REDIS_AVAILABLE = True
except ImportError:
    _redis_client = None
    REDIS_AVAILABLE = False
    logger.warning("redis package not installed — caching disabled")


def cached_response(key_prefix: str, ttl: int = 60, include_query_params: bool = True):
    """
    Decorator to cache FastAPI route responses in Redis.
    """
    def decorator(func: Callable):
        @functools.wraps(func)
        async def wrapper(*args, **kwargs):
            if not REDIS_AVAILABLE:
                return await func(*args, **kwargs)

            # Generate cache key based on prefix and function arguments
            cache_key = f"cache:{key_prefix}"
            if include_query_params:
                # Simple arg/kwargs string representation for key
                # Note: This is a basic implementation. For production, consider 
                # a more robust key generation strategy.
                args_str = ":".join(str(a) for a in args)
                kwargs_str = ":".join(f"{k}={v}" for k, v in sorted(kwargs.items()) if k != "db")
                cache_key = f"{cache_key}:{args_str}:{kwargs_str}"

            cached_val = await get_cache(cache_key)
            if cached_val is not None:
                logger.debug(f"Cache hit for key: {cache_key}")
                return cached_val

            result = await func(*args, **kwargs)
            await set_cache(cache_key, result, ttl=ttl)
            return result
        return wrapper
    return decorator


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
