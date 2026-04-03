# backend/app/memory/session_memory.py
"""
Session Memory — Maintains conversation state across turns.

Three types of memory:
  1. Short-Term (recent_messages) — sliding window for LLM context
  2. Long-Term (insights) — structured extracted data store
  3. Working Memory (questions_asked) — tracks asked questions to prevent repetition
"""

import hashlib

# Agent → phase mapping (matches current 6-agent architecture)
AGENT_PHASE_MAP = {
    "BasicInfoAgent": 1,
    "TaskAgent": 2,
    "PriorityAgent": 3,
    "DeepDiveAgent": 4,
    "ToolsSkillsAgent": 5,
    "JDGeneratorAgent": 6,
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

        # ── Short-Term Memory ──────────────────────────────────────────────
        # Sent to LLM: only last N turns to control token cost
        self.recent_messages = []

        # ── Long-Term Memory ──────────────────────────────────────────────
        # Saved to DB: every single turn, never trimmed
        self.full_history = []

        # ── Working Memory ────────────────────────────────────────────────
        # Tracks question fingerprints to prevent repetition
        self.questions_asked = []  # list of question hashes
        self.agent_transition_log = []  # list of {"from": ..., "to": ..., "turn": ...}
        self.current_stage_question_count = 0  # questions asked in current agent stage

        self.generated_jd = None
        self.jd_structured = None

        # Deprecated: Current interview phase (kept for backward compat)
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

    def _compute_question_hash(self, question_text: str) -> str:
        """Compute a normalized hash of a question for deduplication."""
        # Normalize: lowercase, strip whitespace, remove punctuation
        normalized = question_text.lower().strip()
        # Remove common filler words for better matching
        for word in ["could you", "can you", "please", "would you", "tell me"]:
            normalized = normalized.replace(word, "")
        normalized = " ".join(normalized.split())  # collapse whitespace
        return hashlib.md5(normalized.encode()).hexdigest()[:12]

    def is_question_repeated(self, question_text: str) -> bool:
        """Check if a question (or very similar) has already been asked."""
        q_hash = self._compute_question_hash(question_text)
        return q_hash in self.questions_asked

    def record_question(self, question_text: str):
        """Record a question hash so it won't be asked again."""
        q_hash = self._compute_question_hash(question_text)
        if q_hash not in self.questions_asked:
            self.questions_asked.append(q_hash)
        self.current_stage_question_count += 1

    def record_agent_transition(self, from_agent: str, to_agent: str):
        """Log an agent transition for debugging and flow control."""
        turn = len(self.full_history) // 2
        self.agent_transition_log.append({
            "from": from_agent,
            "to": to_agent,
            "turn": turn,
        })
        self.current_stage_question_count = 0  # Reset per-stage counter

    def add_turn(self, role: str, content: str, llm_limit: int = 6):
        """
        Add one conversation turn.
        - full_history: always appended (goes to DB)
        - recent_messages: sliding window of last llm_limit turns (goes to LLM only)
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

    def to_dict(self) -> dict:
        """Serialize session state for DB persistence."""
        return {
            "current_agent": self.current_agent,
            "current_phase": self.current_phase,
            "questions_asked": self.questions_asked,
            "agent_transition_log": self.agent_transition_log,
            "current_stage_question_count": self.current_stage_question_count,
            "completion_percentage": self.progress.get("completion_percentage", 0),
            "depth_scores": self.progress.get("depth_scores", {}),
            "status": self.progress.get("status", "collecting"),
        }

    def from_dict(self, data: dict):
        """Restore session state from DB dictionary."""
        if not data:
            return
        self.current_agent = data.get("current_agent", "BasicInfoAgent")
        self.current_phase = data.get("current_phase", 1)
        self.questions_asked = data.get("questions_asked", [])
        self.agent_transition_log = data.get("agent_transition_log", [])
        self.current_stage_question_count = data.get("current_stage_question_count", 0)
        
        # Sync progress object
        self.progress.update({
            "completion_percentage": data.get("completion_percentage", 0),
            "depth_scores": data.get("depth_scores", {}),
            "status": data.get("status", "collecting"),
            "current_agent": self.current_agent,
        })
