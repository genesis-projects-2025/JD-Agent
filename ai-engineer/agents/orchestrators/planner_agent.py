"""
Planner Agent - Top-level orchestrator.
Responsible for decomposing high-level development goals into sequential, structured sub-tasks.
"""
from typing import List, Dict, Any
from pydantic import BaseModel, Field

class SubTask(BaseModel):
    task_id: int
    title: str
    description: str
    assigned_agent: str
    dependencies: List[int] = Field(default_factory=list)

class DevelopmentPlan(BaseModel):
    goal: str
    steps: List[SubTask]

class PlannerAgent:
    def __init__(self, llm_client=None):
        self.llm = llm_client

    async def analyze_goal(self, goal: str, codebase_context: str) -> DevelopmentPlan:
        """
        Decomposes a user goal into subtasks, choosing the best agent type for each task.
        """
        print(f"[Planner] Decomposing goal: {goal}")
        # Call LLM to break down goal into steps
        return DevelopmentPlan(goal=goal, steps=[])\n