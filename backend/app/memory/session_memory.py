# app/memory/session_memory.py

class SessionMemory:
    def __init__(self):
        self.insights = {}
        self.progress = {
            "completion_percentage": 0,
            "missing_insight_areas": [],  # ✅ Fixed key name to match Pydantic schema
            "status": "collecting"
        }
        self.summary = ""
        self.recent_messages = []

    def update_recent(self, role: str, content: str, limit: int = 6):
        self.recent_messages.append({"role": role, "content": content})
        self.recent_messages = self.recent_messages[-limit:]