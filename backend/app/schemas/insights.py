# backend/app/schemas/insights.py
"""
Pydantic models for structured role insights.

These models define the SHAPE of data each agent extracts.
Used for validation, documentation, and tool-call schemas.
"""

from __future__ import annotations

from pydantic import BaseModel, Field
from typing import List, Dict, Optional


# ── Per-Agent Extraction Models ───────────────────────────────────────────────


class BasicInfoExtraction(BaseModel):
    """Data extracted by BasicInfoAgent."""
    purpose: str = Field(default="", description="The value this role adds to the organisation (≥2 sentences)")
    title: str = Field(default="", description="Job title / designation")
    department: str = Field(default="", description="Department or function")
    location: str = Field(default="", description="Work location")
    reports_to: str = Field(default="", description="Reporting manager name/title")


class TaskItem(BaseModel):
    """A single detailed task description."""
    description: str = Field(min_length=10, description="Detailed description — not just a label")
    frequency: str = Field(default="daily", description="daily | weekly | monthly | quarterly | ad-hoc")
    category: str = Field(default="technical", description="technical | administrative | managerial | strategic")


class TaskExtraction(BaseModel):
    """Data extracted by TaskAgent."""
    tasks: List[TaskItem] = Field(default_factory=list)


class PriorityExtraction(BaseModel):
    """Data extracted by PriorityAgent."""
    priority_tasks: List[str] = Field(default_factory=list, description="Top 3-5 most critical tasks")


class WorkflowItem(BaseModel):
    """Workflow for a single priority task."""
    task_name: str = Field(description="Which priority task this workflow describes")
    trigger: str = Field(default="", description="What initiates this workflow")
    steps: List[str] = Field(default_factory=list, description="Ordered steps from start to finish")
    tools_used: List[str] = Field(default_factory=list, description="Tools/software used")
    output: str = Field(default="", description="Final deliverable or outcome")
    frequency: str = Field(default="", description="How often this workflow runs")


class WorkflowExtraction(BaseModel):
    """Data extracted by WorkflowDeepDiveAgent."""
    workflows: Dict[str, WorkflowItem] = Field(default_factory=dict)


class ToolsTechExtraction(BaseModel):
    """Data extracted by ToolsTechAgent."""
    tools: List[str] = Field(default_factory=list, description="Software, hardware, platforms")
    technologies: List[str] = Field(default_factory=list, description="Frameworks, languages, cloud services")


class SkillExtraction(BaseModel):
    """Data extracted by SkillExtractionAgent."""
    skills: List[str] = Field(default_factory=list, description="Technical/domain skills ONLY — no soft skills")


class QualificationExtraction(BaseModel):
    """Data extracted by QualificationAgent."""
    education: List[str] = Field(default_factory=list, description="Required degrees/diplomas")
    certifications: List[str] = Field(default_factory=list, description="Professional certifications")
    experience_years: Optional[str] = Field(default=None, description="Years of experience")


# ── Master Schema ─────────────────────────────────────────────────────────────


class RoleInsights(BaseModel):
    """Master schema — the single source of truth for all collected data."""
    identity_context: Dict = Field(default_factory=dict)
    purpose: str = Field(default="")
    basic_info: Dict = Field(default_factory=dict)

    tasks: list = Field(default_factory=list)          # List[TaskItem] or list[str] for backward compat
    priority_tasks: List[str] = Field(default_factory=list)
    workflows: Dict = Field(default_factory=dict)       # {task_name: WorkflowItem}

    tools: List[str] = Field(default_factory=list)
    technologies: List[str] = Field(default_factory=list)
    skills: List[str] = Field(default_factory=list)
    qualifications: Dict = Field(default_factory=dict)  # {education: [], certifications: []}


# ── Gap Report ────────────────────────────────────────────────────────────────


class GapItem(BaseModel):
    """A single data quality gap."""
    category: str = Field(description="Which data category has the gap")
    severity: str = Field(description="critical | moderate | minor")
    reason: str = Field(description="Why this is insufficient")
    suggested_question: str = Field(description="What to ask to fill this gap")


class GapReport(BaseModel):
    """Output of the gap detector."""
    gaps: List[GapItem] = Field(default_factory=list)
    overall_quality: int = Field(default=0, ge=0, le=100)
    ready_for_jd: bool = Field(default=False)
