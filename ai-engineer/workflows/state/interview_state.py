"""
Interview State.
Session state capturing JD interview phases, transcripts, and parsed requirements.
"""
from workflows.state.base_state import AgentState

class InterviewState(AgentState):
    session_id: str
    phase: str
    gathered_info: dict\n