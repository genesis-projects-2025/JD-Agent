"""
API Trigger.
FastAPI endpoints triggering autonomous agent loops asynchronously.
"""
class APITrigger:
    async def trigger_run(self, session_id: str):
        print(f"[Trigger] Launching execution loop for {session_id}")\n