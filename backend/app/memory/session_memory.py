# app/memory/session_memory.py

class SessionMemory:
    def __init__(self):
        self.id = None
        self.employee_id = None
        self.insights = {}
        self.progress = {
            "completion_percentage": 0,
            "missing_insight_areas": [],
            "status": "collecting"
        }
        self.summary = ""
        self.recent_messages = []
        self.generated_jd = None
        self.jd_structured = None

    def update_recent(self, role: str, content: str, limit: int = 4):
        self.recent_messages.append({"role": role, "content": content})
        self.recent_messages = self.recent_messages[-limit:]