from pydantic import BaseModel, Field
from typing import List, Dict, Optional, Literal, Union

class EmployeeRoleInsights(BaseModel):
    identity_context: Dict = Field(default_factory=dict)
    daily_activities: List[str] = Field(default_factory=list)
    execution_processes: List[str] = Field(default_factory=list)
    tools_and_platforms: List[str] = Field(default_factory=list)
    team_collaboration: Dict = Field(default_factory=dict)
    stakeholder_interactions: Dict = Field(default_factory=dict)
    decision_authority: Dict = Field(default_factory=dict)
    performance_metrics: List[str] = Field(default_factory=list)
    work_environment: Dict = Field(default_factory=dict)
    special_contributions: List[str] = Field(default_factory=list)

class JDStructuredData(BaseModel):
    # Keeping this flexible as it's the final derived output
    employee_information: Dict = Field(default_factory=dict)
    role_summary: Union[str, Dict] = Field(default_factory=dict)
    key_responsibilities: List[str] = Field(default_factory=list)
    required_skills: List[str] = Field(default_factory=list)
    tools_and_technologies: List[str] = Field(default_factory=list)
    team_structure: Dict = Field(default_factory=dict)
    stakeholder_interactions: Dict = Field(default_factory=dict)
    performance_metrics: List[str] = Field(default_factory=list)
    work_environment: Dict = Field(default_factory=dict)
    additional_details: Dict = Field(default_factory=dict)

class Progress(BaseModel):
    completion_percentage: float
    missing_insight_areas: List[str]
    status: Literal["collecting", "ready_for_generation", "jd_generated", "approval_pending", "approved"]

class Analytics(BaseModel):
    questions_asked: int
    questions_answered: int
    insights_collected: int
    estimated_completion_time_minutes: int

class Approval(BaseModel):
    approval_required: bool
    approval_status: Literal["pending", "approved", "rejected"]

class ChatResponse(BaseModel):
    conversation_response: str
    progress: Progress
    employee_role_insights: EmployeeRoleInsights
    jd_structured_data: JDStructuredData
    jd_text_format: str
    analytics: Analytics
    approval: Approval

class ChatRequest(BaseModel):
    message: str
    history: List[Dict]
    # We might need to pass the current structured data back to the backend/LLM 
    # if we are being stateless, or we assume the backend handles it.
    # For now, let's keep it simple and maybe add it if needed by the prompt engineering strategy.
    current_jd_data: Optional[Dict] = None 

class JDRequest(BaseModel):
    history: List[Dict]

