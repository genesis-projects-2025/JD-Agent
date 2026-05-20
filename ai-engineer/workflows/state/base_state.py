"""
Base State.
Base schema dictionary shared across multi-agent workflows.
"""
from typing import TypedDict, List

class AgentState(TypedDict):
    messages: List[dict]
    current_agent: str
    errors: List[str]\n