"""
Meta Agent - Top-level router.
Decides WHICH orchestrator (e.g. Planner, Critic, Debugger, or Direct Solver) is best suited for the user's input.
"""
from typing import Dict, Any

class MetaAgent:
    async def route_request(self, user_query: str) -> str:
        """
        Classifies incoming user intent and returns the name of the target orchestrator agent.
        """
        print(f"[MetaAgent] Classifying route for query: {user_query}")
        # Logic to route to Planner, Critic, or direct agent
        return "planner_agent"\n