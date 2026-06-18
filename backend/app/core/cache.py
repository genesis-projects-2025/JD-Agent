# app/core/cache.py
# Simple Redis cache layer — falls back gracefully if Redis is not available

import json
import logging
import functools
import asyncio
from typing import Optional, Any, Callable
from app.core.config import settings

logger = logging.getLogger(__name__)

# Globally track if Redis is actually responsive
REDIS_AVAILABLE = False
_redis_client = None

# Try to import redis; if not installed, cache is silently disabled
try:
    import redis.asyncio as aioredis

    _redis_client = aioredis.from_url(
        settings.REDIS_URL,
        decode_responses=True,
        socket_connect_timeout=0.25,  # Short timeout for connection
        socket_timeout=0.25,          # Short timeout for socket operations
    )
    REDIS_AVAILABLE = True
except ImportError:
    logger.warning("redis package not installed — caching disabled")


async def check_redis_connection() -> bool:
    """Test Redis connection asynchronously and disable caching if unreachable."""
    global REDIS_AVAILABLE
    if not REDIS_AVAILABLE or _redis_client is None:
        return False
    try:
        await asyncio.wait_for(_redis_client.ping(), timeout=0.3)
        logger.info("✅ Redis server verified - caching layer active")
        return True
    except Exception as e:
        logger.info(f"ℹ️ Redis server not reachable on startup: {e} - disabling caching layer to prevent latency")
        REDIS_AVAILABLE = False
        return False


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
    global REDIS_AVAILABLE
    if not REDIS_AVAILABLE or _redis_client is None:
        return None
    try:
        data = await _redis_client.get(key)
        return json.loads(data) if data else None
    except Exception as e:
        logger.warning(f"⚠️ Redis GET failed for {key}: {e} - disabling caching layer to prevent latency")
        REDIS_AVAILABLE = False
        return None


async def set_cache(key: str, value: Any, ttl: int = 30) -> None:
    """Store value with TTL (seconds). Silent failure if Redis unavailable."""
    global REDIS_AVAILABLE
    if not REDIS_AVAILABLE or _redis_client is None:
        return
    try:
        await _redis_client.setex(key, ttl, json.dumps(value, default=str))
    except Exception as e:
        logger.warning(f"⚠️ Redis SET failed for {key}: {e} - disabling caching layer to prevent latency")
        REDIS_AVAILABLE = False


async def invalidate_cache(*keys: str) -> None:
    """Delete one or more exact cache keys."""
    global REDIS_AVAILABLE
    if not REDIS_AVAILABLE or _redis_client is None:
        return
    try:
        if keys:
            await _redis_client.delete(*keys)
    except Exception as e:
        logger.warning(f"⚠️ Redis DELETE failed: {e} - disabling caching layer to prevent latency")
        REDIS_AVAILABLE = False


async def invalidate_pattern(pattern: str) -> None:
    """Delete all keys matching a glob pattern e.g. 'jds:employee:*'."""
    global REDIS_AVAILABLE
    if not REDIS_AVAILABLE or _redis_client is None:
        return
    try:
        keys = await _redis_client.keys(pattern)
        if keys:
            await _redis_client.delete(*keys)
    except Exception as e:
        logger.warning(f"⚠️ Redis pattern DELETE failed for {pattern}: {e} - disabling caching layer to prevent latency")
        REDIS_AVAILABLE = False


async def cache_health() -> dict[str, str]:
    """Return a lightweight Redis health snapshot without raising."""
    if not REDIS_AVAILABLE or _redis_client is None:
        return {"status": "disabled"}
    try:
        if asyncio.iscoroutinefunction(_redis_client.ping):
            await _redis_client.ping()
        else:
            _redis_client.ping()  # pyright: ignore
        return {"status": "ok"}
    except Exception as e:
        logger.debug(f"Cache PING failed: {e}")
        return {"status": "degraded", "detail": str(e)}
