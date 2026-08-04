# backend/app/core/llm_throttle.py
"""
Global LLM Concurrency Throttle.

Prevents API rate limit exhaustion (HTTP 429) when multiple employees
use the system simultaneously. Limits concurrent outbound Gemini API
calls to a safe ceiling.
"""

import asyncio
import logging

logger = logging.getLogger(__name__)

# Global semaphore: max 15 concurrent Gemini API calls across all workers.
# Gemini 2.5 Flash allows ~2000 RPM, but bursty parallel calls from
# asyncio.gather and multi-agent pipelines can spike to 200+ calls/sec.
# 15 concurrent slots ensures smooth throughput without triggering 429s.
LLM_SEMAPHORE = asyncio.Semaphore(15)


async def throttled_ainvoke(llm, messages_or_prompt, **kwargs):
    """Invoke LLM with global concurrency throttle.
    
    Drop-in replacement for `await llm.ainvoke(...)` that respects
    the global semaphore to prevent API rate limit exhaustion.
    """
    async with LLM_SEMAPHORE:
        return await llm.ainvoke(messages_or_prompt, **kwargs)


async def throttled_astream(llm, messages_or_prompt, **kwargs):
    """Stream LLM with global concurrency throttle.
    
    Acquires the semaphore before starting the stream and holds it
    until the stream is fully consumed.
    """
    async with LLM_SEMAPHORE:
        async for chunk in llm.astream(messages_or_prompt, **kwargs):
            yield chunk
