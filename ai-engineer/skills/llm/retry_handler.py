"""
Retry Handler Skill.
Implements exponential backoff for handling transient third-party API exceptions.
"""
import asyncio

class RetryHandler:
    async def execute_with_retry(self, func, *args, retries=3, delay=1, **kwargs):
        for attempt in range(retries):
            try:
                return await func(*args, **kwargs)
            except Exception as e:
                if attempt == retries - 1:
                    raise e
                await asyncio.sleep(delay * (2 ** attempt))\n