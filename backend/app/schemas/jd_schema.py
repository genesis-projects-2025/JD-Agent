from pydantic import BaseModel, Field
from typing import List, Dict, Optional, Literal, Union


from typing import Any

class EmployeeRoleInsights(BaseModel):
    identity_context: Dict = Field(default_factory=dict)
    daily_activities: Union[List[Any], Dict, str] = Field(default_factory=list)
    execution_processes: Union[List[Any], Dict, str] = Field(default_factory=list)
    tools_and_platforms: Union[List[Any], Dict, str] = Field(default_factory=list)
    team_collaboration: Dict = Field(default_factory=dict)
    stakeholder_interactions: Dict = Field(default_factory=dict)
    decision_authority: Dict = Field(default_factory=dict)
    performance_metrics: Union[List[Any], Dict, str] = Field(default_factory=list)
    work_environment: Dict = Field(default_factory=dict)
    special_contributions: Union[List[Any], Dict, str] = Field(default_factory=list)


class JDStructuredData(BaseModel):
    employee_information: Dict = Field(default_factory=dict)
    role_summary: Union[str, Dict] = Field(default="")
    key_responsibilities: List[str] = Field(default_factory=list)
    required_skills: List[str] = Field(default_factory=list)
    tools_and_technologies: List[str] = Field(default_factory=list)
    team_structure: Dict = Field(default_factory=dict)
    stakeholder_interactions: Dict = Field(default_factory=dict)
    performance_metrics: List[str] = Field(default_factory=list)
    work_environment: Dict = Field(default_factory=dict)
    additional_details: Dict = Field(default_factory=dict)


class Progress(BaseModel):
    completion_percentage: float = 0.0
    missing_insight_areas: List[str] = Field(default_factory=list)
    status: Literal[
        "collecting",
        "ready_for_generation",
        "jd_generated",
        "approval_pending",
        "approved",
    ] = "collecting"


class Analytics(BaseModel):
    questions_asked: int = 0
    questions_answered: int = 0
    insights_collected: int = 0
    estimated_completion_time_minutes: int = 0


class Approval(BaseModel):
    approval_required: bool = False
    approval_status: Literal["pending", "approved", "rejected"] = "pending"


class ChatResponse(BaseModel):
    conversation_response: str

    progress: Progress = Field(default_factory=Progress)

    employee_role_insights: EmployeeRoleInsights = Field(
        default_factory=EmployeeRoleInsights
    )
    
    suggested_skills: List[str] = Field(default_factory=list)

    jd_structured_data: Optional[JDStructuredData] = Field(
        default_factory=JDStructuredData
    )
    jd_text_format: Optional[str] = ""
    approval: Optional[Approval] = Field(default_factory=Approval)
    analytics: Optional[Analytics] = Field(default_factory=Analytics)


# ── Conversation History Turn ─────────────────────────────────────────────────
class ConversationTurn(BaseModel):
    role: str                         # "user" | "assistant"
    content: str
    timestamp: Optional[str] = None  # ISO string


# ── Request / Response Models ─────────────────────────────────────────────────

class ChatRequest(BaseModel):
    id: Optional[str] = None
    message: str
    history: List[Dict]
    current_jd_data: Optional[Dict] = None


class InitJDRequest(BaseModel):
    employee_id: str
    employee_name: Optional[str] = None


class InitJDResponse(BaseModel):
    id: str
    status: str
    # Returned so frontend can immediately associate this session with the employee
    employee_id: Optional[str] = None


class JDRequest(BaseModel):
    history: List[Dict]


class SaveJDRequest(BaseModel):
    id: str
    jd_text: str
    jd_structured: Dict
    employee_id: Optional[str] = None


class UpdateJDRequest(BaseModel):
    jd_text: str
    jd_structured: Dict
    employee_id: str


class UpdateStatusRequest(BaseModel):
    status: str
    employee_id: str

class GenerateJDRequest(BaseModel):
    id: str  # session_id