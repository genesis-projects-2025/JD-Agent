class SessionMemory:

    def __init__(self):
        self.insights = {}
        self.progress = {
            "completion_percentage": 0,
            "missing_fields": [],
            "status": "collecting"
        }
        self.summary = ""
        self.recent_messages = []

    def update_recent(self, role, content, limit=4):
        self.recent_messages.append({"role": role, "content": content})
        self.recent_messages = self.recent_messages[-limit:]
