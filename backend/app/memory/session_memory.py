# app/memory/session_memory.py


class SessionMemory:
    def __init__(self):
        self.id = None
        self.employee_id = None
        self.employee_name = None  # persisted from /init and LLM insights
        self.insights = {}
        self.progress = {
            "completion_percentage": 0,
            "missing_insight_areas": [],
            "status": "collecting",
        }
        self.summary = ""

        # ── TWO SEPARATE LISTS — never mix these ──────────────────────────────
        # Sent to LLM: only last N turns to control token cost
        self.recent_messages = []

        # Saved to DB: every single turn, never trimmed
        self.full_history = []

        self.generated_jd = None
        self.jd_structured = None

    def add_turn(self, role: str, content: str, llm_limit: int = 20):
        """
        Add one conversation turn.
        - full_history: always appended (goes to DB)
        - recent_messages: sliding window of last llm_limit turns (goes to LLM only)
        """
        turn = {"role": role, "content": content}
        self.full_history.append(turn)
        self.recent_messages.append(turn)
        self.recent_messages = self.recent_messages[-llm_limit:]

    def update_recent(self, role: str, content: str, limit: int = 20):
        """
        Backward-compatible alias for add_turn.
        Existing callers in jd_service.py use this — it now correctly
        writes to BOTH full_history and recent_messages.
        """
        self.add_turn(role, content, llm_limit=limit)

    def load_history_from_db(self, db_history: list, llm_limit: int = 20):
        """
        Called during cold-start hydration from DB.
        Restores full_history completely, recent_messages as sliding window.
        """
        self.full_history = list(db_history)
        self.recent_messages = db_history[-llm_limit:]
