"""
Code State.
State variables tracking coding specifications, file paths, test runs, and diff blocks.
"""
from workflows.state.base_state import AgentState

class CodeState(AgentState):
    spec: str
    file_diffs: dict
    test_results: dict\n