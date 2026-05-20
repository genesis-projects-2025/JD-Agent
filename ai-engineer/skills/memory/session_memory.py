"""
Session Memory.
Manages fast, short-term session histories and current conversation turns.
"""
class SessionMemory:
    def __init__(self):
        self.history = []

    def add_turn(self, role: str, content: str):
        self.history.append({"role": role, "content": content})\n