# backend/app/memory/session_memory.py

# Agent → phase mapping for backward compatibility with frontend/DB code
AGENT_PHASE_MAP = {
    "BasicInfoAgent": 1,
    "TaskAgent": 2,
    "PriorityAgent": 3,
    "WorkflowDeepDiveAgent": 4,
    "ToolsTechAgent": 5,
    "SkillExtractionAgent": 6,
    "QualificationAgent": 7,
    "JDGeneratorAgent": 8,
}


class SessionMemory:
    def __init__(self):
        self.id = None
        self.employee_id = None
        self.employee_name = None
        self.insights = {}
        self.progress = {
            "completion_percentage": 0,
            "depth_scores": {},
            "status": "collecting",
            "current_agent": "BasicInfoAgent",
        }
        self.summary = ""

        # Current active agent
        self.current_agent = "BasicInfoAgent"

        # TWO SEPARATE LISTS — never mix these
        # Sent to LLM: only last N turns to control token cost
        self.recent_messages = []
        # Saved to DB: every single turn, never trimmed
        self.full_history = []

        self.generated_jd = None
        self.jd_structured = None

        # Deprecated: Current interview phase
        self.current_phase = 1

        # Cached joined user-text for duplicate scan avoidance
        self._user_history_text_cache = None

    @property
    def user_history_text(self) -> str:
        """Cached lowercase join of all user messages. Avoids repeated O(n) scans."""
        if self._user_history_text_cache is None:
            self._user_history_text_cache = " ".join(
                m.get("content", "")
                for m in self.full_history
                if m.get("role") == "user"
            ).lower()
        return self._user_history_text_cache

    @property
    def agent_name(self) -> str:
        return self.current_agent

    def add_turn(self, role: str, content: str, llm_limit: int = 6):
        """
        Add one conversation turn.
        - full_history: always appended (goes to DB)
        - recent_messages: sliding window of last llm_limit turns (goes to LLM only)
        Reduced from 10 to 6 for phase-based token efficiency.
        """
        turn = {"role": role, "content": content}
        self.full_history.append(turn)
        self.recent_messages.append(turn)
        self.recent_messages = self.recent_messages[-llm_limit:]
        # Invalidate cached text when new turns are added
        self._user_history_text_cache = None

    def update_recent(self, role: str, content: str, limit: int = 6):
        """Backward-compatible alias for add_turn."""
        self.add_turn(role, content, llm_limit=limit)

    def load_history_from_db(self, db_history: list, llm_limit: int = 6):
        """
        Called during cold-start hydration from DB.
        Restores full_history completely, recent_messages as sliding window.
        """
        self.full_history = list(db_history)
        self.recent_messages = db_history[-llm_limit:]
        self._user_history_text_cache = None
