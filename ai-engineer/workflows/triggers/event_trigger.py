"""
Event Trigger.
Launches workflows based on real-time webhooks or PostgreSQL triggers.
"""
class EventTrigger:
    def on_db_event(self, payload: dict):
        print(f"[Trigger] Received database webhook event: {payload}")\n