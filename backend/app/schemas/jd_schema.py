from pydantic import BaseModel, Field
from typing import List, Dict, Optional, Literal




class EmployeeRoleInsights(BaseModel):
    # Shared Memory Data
    basic_info: Dict = Field(default_factory=dict)         # title, dept, location, reports_to, band, etc.
    purpose: str = Field(default="")
    tasks: List[str] = Field(default_factory=list)         # Replaced daily/weekly tasks
    priority_tasks: List[str] = Field(default_factory=list)# Stage 3 Priority Ranking
    workflows: Dict = Field(default_factory=dict)          # Deep Dive: {task_name: {frequency, trigger, steps, tools, output}}
    tools: List[str] = Field(default_factory=list)         # Software/Hardware
    technologies: List[str] = Field(default_factory=list)  # Frameworks/Platforms
    skills: List[str] = Field(default_factory=list)        # Technical/Domain skills
    qualifications: Dict = Field(default_factory=dict)     # {"education": [], "certifications": []}
    
    # Deprecated fields (kept for backward compatibility during transition if needed)
    identity_context: Dict = Field(default_factory=dict)
    responsibilities: List[str] = Field(default_factory=list)
    working_relationships: Dict = Field(default_factory=dict)
    education: str = Field(default="")
    experience: str = Field(default="")
    daily_tasks: List[str] = Field(default_factory=list)
    weekly_tasks: List[str] = Field(default_factory=list)

class DepthTracking(BaseModel):
    category: str
    count: int
    is_complete: bool
    threshold: int


class JDStructuredData(BaseModel):
    employee_information: Dict = Field(default_factory=dict)
    purpose: str = Field(default="")
    responsibilities: List[str] = Field(default_factory=list)
    working_relationships: Dict = Field(default_factory=dict)
    skills: List[str] = Field(default_factory=list)
    tools: List[str] = Field(default_factory=list)
    education: str = Field(default="")
    experience: str = Field(default="")
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
    current_phase: int = 1
    current_agent: str = "BasicInfoAgent"
    depth_scores: Dict[str, int] = Field(default_factory=dict)


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
    jd_text: Optional[str] = None
    jd_structured: Dict
    employee_id: Optional[str] = None


class UpdateJDRequest(BaseModel):
    jd_text: Optional[str] = None
    jd_structured: Dict
    employee_id: str


class UpdateStatusRequest(BaseModel):
    status: str
    employee_id: str

class GenerateJDRequest(BaseModel):
    id: str  # session_id


class CreateReviewRequest(BaseModel):
    action: Literal["rejected", "approved", "revision_requested"]
    target_role: Literal["employee", "manager"]
    comment: Optional[str] = None
    reviewer_id: str


class ConfirmSkillsRequest(BaseModel):
    skills: List[str]