# backend/app/agents/__init__.py
"""
Saniya Brain v2.0 — Multi-Agent JD Interview System

Architecture:
  Router → Interview Engine → Tool Executor → Gap Detector → Response Builder

Agents: BasicInfo, Task, Priority, WorkflowDeepDive, ToolsTech, SkillExtraction, Qualification
Orchestration: LangGraph StateGraph
LLM: Gemini 2.5 Flash (interview) + Gemini 2.5 Pro (JD generation)
"""
