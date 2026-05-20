"""
Webhook Interface.
Handles incoming JSON payloads from GitHub, Jira, or custom apps.
"""
class WebhookInterface:
    def process_payload(self, source: str, payload: dict):
        print(f"[Webhook] Processing external payload from {source}")\n