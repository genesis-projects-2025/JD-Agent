# backend/app/core/llm_throttle.py
"""
Global LLM Concurrency Throttle.

Prevents API rate limit exhaustion (HTTP 429) when multiple employees
use the system simultaneously. Limits concurrent outbound Gemini API
calls to a safe ceiling, and retries transient failures instead of
letting them propagate as silent data loss to callers.
"""

import asyncio
import logging
import random

logger = logging.getLogger(__name__)

LLM_SEMAPHORE = asyncio.Semaphore(15)

MAX_RETRIES = 3
BASE_BACKOFF_SECONDS = 1.5


def _is_retryable(exc: Exception) -> bool:
    msg = str(exc).lower()
    retryable_markers = [
        "429",
        "rate limit",
        "resource exhausted",
        "quota",
        "503",
        "502",
        "500",
        "timeout",
        "timed out",
        "deadline exceeded",
        "unavailable",
        "connection",
    ]
    return any(marker in msg for marker in retryable_markers)


async def throttled_ainvoke(llm, messages_or_prompt, **kwargs):
    last_exc: Exception | None = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            async with LLM_SEMAPHORE:
                return await llm.ainvoke(messages_or_prompt, **kwargs)
        except Exception as e:
            last_exc = e
            if not _is_retryable(e) or attempt == MAX_RETRIES:
                logger.error(
                    f"[throttled_ainvoke] Failed permanently on attempt {attempt}/{MAX_RETRIES}: {e}"
                )
                raise
            backoff = BASE_BACKOFF_SECONDS * attempt + random.uniform(0, 0.5)
            logger.warning(
                f"[throttled_ainvoke] Attempt {attempt}/{MAX_RETRIES} failed ({e}); retrying in {backoff:.1f}s"
            )
            await asyncio.sleep(backoff)
    raise last_exc  # type: ignore[misc]


async def throttled_astream(llm, messages_or_prompt, **kwargs):
    async with LLM_SEMAPHORE:
        async for chunk in llm.astream(messages_or_prompt, **kwargs):
            yield chunk
