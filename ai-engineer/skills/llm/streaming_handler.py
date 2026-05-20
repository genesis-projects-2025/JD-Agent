"""
Streaming Handler Skill.
Handles Server-Sent Events (SSE) and token-by-token streaming from Gemini APIs.
"""
class StreamingHandler:
    async def stream_tokens(self, llm_stream: Any):
        async for chunk in llm_stream:
            yield chunk.text\n