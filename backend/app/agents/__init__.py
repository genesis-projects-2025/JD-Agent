# backend/app/agents/__init__.py
"""
Saniya Brain v2.2 — Multi-Agent JD Interview System

Architecture:
  Router → Pre-Extraction → Interview Engine → Tool Executor → Gap Detector → Response Builder

Agents (7-agent linear pipeline):
  1. BasicInfoAgent           — Role purpose, mission, and activity collection (≥6 tasks)
  2. WorkflowIdentifierAgent  — Impact assessment: select 3-5 priority tasks
  3. DeepDiveAgent            — Operational process: step-by-step workflows (3 turns/task)
  4. ToolsAgent               — Technical infrastructure validation (silent, deterministic)
  5. SkillsAgent              — Competency profile validation (silent, deterministic)
  6. QualificationAgent       — Academic and professional requirements
  7. JDGeneratorAgent         — Final synthesis and JD generation

Orchestration: LangGraph StateGraph with rule-based router
LLM: Gemini 2.5 Flash (interview) + Gemini 2.5 Pro (JD generation)
Memory: 3-tier (Short-Term, Long-Term, Working Memory)
Extraction: Tool-based (bind_tools) + pattern-based pre-extraction
RAG: Pinecone vector search for role-specific context
"""
