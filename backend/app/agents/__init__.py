# backend/app/agents/__init__.py
"""
Saniya Brain v2.0 — Multi-Agent JD Interview System

Architecture:
  Router → Interview Engine → Tool Executor → Gap Detector → Response Builder

Agents (6-agent architecture):
  1. BasicInfoAgent     — Role purpose and high-level context
  2. TaskAgent          — Exhaustive task collection
  3. PriorityAgent      — Top 3 critical tasks
  4. DeepDiveAgent      — Step-by-step workflows for priorities
  5. ToolsSkillsAgent   — Tools, skills, qualifications
  6. JDGeneratorAgent   — Final JD generation

Orchestration: LangGraph StateGraph
LLM: Gemini 2.5 Flash (interview) + Gemini 2.5 Pro (JD generation)
Memory: 3-tier (Short-Term, Long-Term, Working Memory)
"""
