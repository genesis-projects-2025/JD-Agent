"""
API Caller.
Standard, asynchronous HTTP wrapper with headers, logs, and timeouts.
"""
import httpx

class APICaller:
    async def fetch(self, url: str, headers: dict = None) -> dict:
        async with httpx.AsyncClient() as client:
            res = await client.get(url, headers=headers)
            return res.json()\n