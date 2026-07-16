import asyncio
import os
import sys

sys.path.append("/Users/manideekshith/Developer/JD-Agent/backend")

from app.core.database import AsyncSessionLocal
from app.services.admin_brain_agent_service import AdminBrainAgentService

async def main():
    message = "so can you tell me about pawan kalyan what is the work he is doing ?"
    print(f"Sending message: '{message}'\n")
    
    async with AsyncSessionLocal() as db:
        async for event in AdminBrainAgentService.chat_stream(
            db=db,
            message=message,
            admin_user="system_test_admin",
            session_id=None
        ):
            if event["type"] == "status":
                print(f"[STATUS] {event['content']}")
            elif event["type"] == "chunk":
                sys.stdout.write(event["content"])
                sys.stdout.flush()
    print("\n\n=== Streaming Finished ===")

if __name__ == "__main__":
    asyncio.run(main())
