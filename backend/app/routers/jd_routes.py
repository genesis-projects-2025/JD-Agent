# app/routers/jd_routes.py
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from app.schemas.jd_schema import ChatRequest, JDRequest, InitJDRequest, InitJDResponse, SaveJDRequest
from app.services.jd_service import handle_conversation
from app.memory.session_memory import SessionMemory
from app.core.database import get_db
from app.crud.jd_crud import (
    save_questionnaire_jd,
    get_questionnaire,
    list_questionnaires,
    approve_questionnaire,
    reject_questionnaire,
    get_dashboard_stats,
    get_recent_activity,
)
from pydantic import BaseModel
from typing import Optional
import uuid

router = APIRouter()

# In-memory session store
_session_store: dict[str, SessionMemory] = {}


def get_or_create_session(session_id: str) -> SessionMemory:
    if session_id not in _session_store:
        print(f"🆕 Creating new session: {session_id}")
        _session_store[session_id] = SessionMemory()
    else:
        print(f"♻️  Reusing session: {session_id}")
    return _session_store[session_id]


# ── Chat ─────────────────────────────────────────────────────────────────────

@router.post("/chat")
async def chat(request: ChatRequest):
    session_id = request.id or "default"
    session_memory = get_or_create_session(session_id)

    reply, updated_history = handle_conversation(
        request.history,
        request.message,
        session_memory
    )

    return {"reply": reply, "history": updated_history}


# ── Init ──────────────────────────────────────────────────────────────────────

@router.post("/init", response_model=InitJDResponse)
async def init_jd(request: InitJDRequest):
    new_id = str(uuid.uuid4())
    _session_store[new_id] = SessionMemory()
    return {"id": new_id, "status": "collecting"}


# ── Save ──────────────────────────────────────────────────────────────────────

@router.post("/save")
async def save_jd(
    request: SaveJDRequest,
    db: AsyncSession = Depends(get_db)
):
    """Save generated JD to database."""
    session_id = request.id

    session_memory = _session_store.get(session_id)
    if not session_memory:
        raise HTTPException(
            status_code=404,
            detail="Session not found. Please complete the interview first."
        )

    try:
        record = await save_questionnaire_jd(
            db=db,
            session_id=session_id,
            jd_text=request.jd_text,
            jd_structured=request.jd_structured,
            employee_insights=session_memory.insights,
            progress=session_memory.progress,
        )
        return {
            "status": "success",
            "id": record.id,
            "employee": record.employee_id,
            "message": "JD saved successfully to database."
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save JD: {str(e)}")


# ── Dashboard Stats ───────────────────────────────────────────────────────────

@router.get("/stats")
async def dashboard_stats(db: AsyncSession = Depends(get_db)):
    """Return real-time dashboard statistics computed from the database."""
    stats = await get_dashboard_stats(db)
    return stats


# ── Activity Feed ─────────────────────────────────────────────────────────────

@router.get("/activity")
async def recent_activity(db: AsyncSession = Depends(get_db)):
    """Return recent activity events derived from JD status changes."""
    activity = await get_recent_activity(db, limit=10)
    return activity


# ── JD List ───────────────────────────────────────────────────────────────────

@router.get("/list")
async def list_jds(db: AsyncSession = Depends(get_db)):
    """List all JDs with all fields the frontend needs."""
    records = await list_questionnaires(db)
    return [
        {
            "id": r.id,
            "employee_id": r.employee_id,
            "employee_name": r.employee_name or r.employee_id,
            "role_title": r.role_title or "Unknown Role",
            "department": r.department or "Unknown Department",
            "status": r.status,
            "jd_text": r.generated_jd or "",
            "jd_structured": r.jd_structured or {},
            "completion_percentage": r.completion_percentage or 0,
            "reviewer_comment": r.reviewer_comment,
            "reviewed_by": r.reviewed_by,
            "reviewed_at": r.reviewed_at.isoformat() if r.reviewed_at else None,
            "created_at": r.created_at.isoformat() if r.created_at else "",
            "updated_at": r.updated_at.isoformat() if r.updated_at else (
                r.created_at.isoformat() if r.created_at else ""
            ),
        }
        for r in records
    ]


# ── Approve ───────────────────────────────────────────────────────────────────

class ApproveRequest(BaseModel):
    reviewed_by: Optional[str] = "HR Manager"


async def approve_jd(
    jd_id: str,
    body: ApproveRequest = ApproveRequest(),
    db: AsyncSession = Depends(get_db)
):
    """Approve a JD and record who approved it."""
    record = await approve_questionnaire(db, jd_id, reviewed_by=body.reviewed_by)
    if not record:
        raise HTTPException(status_code=404, detail="JD not found")
    return {"status": "approved", "id": record.id, "reviewed_by": record.reviewed_by}


# ── Reject ────────────────────────────────────────────────────────────────────

class RejectRequest(BaseModel):
    comment: str
    reviewed_by: Optional[str] = "HR Manager"


@router.post("/{jd_id}/reject")
async def reject_jd(
    jd_id: str,
    body: RejectRequest,
    db: AsyncSession = Depends(get_db)
):
    """Return a JD for revision with a feedback comment."""
    if not body.comment.strip():
        raise HTTPException(status_code=400, detail="A rejection comment is required")
    record = await reject_questionnaire(db, jd_id, comment=body.comment, reviewed_by=body.reviewed_by)
    if not record:
        raise HTTPException(status_code=404, detail="JD not found")
    return {"status": "rejected", "id": record.id, "comment": record.reviewer_comment}


# ── Get Single JD ─────────────────────────────────────────────────────────────

@router.get("/{jd_id}")
async def get_jd(jd_id: str, db: AsyncSession = Depends(get_db)):
    """Get a specific JD by ID."""
    record = await get_questionnaire(db, jd_id)
    if not record:
        raise HTTPException(status_code=404, detail="JD not found")
    return {
        "id": record.id,
        "employee_id": record.employee_id,
        "employee_name": record.employee_name or record.employee_id,
        "role_title": record.role_title or "Unknown Role",
        "department": record.department or "Unknown Department",
        "status": record.status,
        "jd_text": record.generated_jd or "",
        "jd_structured": record.jd_structured or {},
        "completion_percentage": record.completion_percentage or 0,
        "reviewer_comment": record.reviewer_comment,
        "reviewed_by": record.reviewed_by,
        "reviewed_at": record.reviewed_at.isoformat() if record.reviewed_at else None,
        "created_at": record.created_at.isoformat() if record.created_at else "",
        "updated_at": record.updated_at.isoformat() if record.updated_at else "",
    }


# ── Generate JD (legacy stub) ─────────────────────────────────────────────────

@router.post("/generate-jd")
def create_jd(request: JDRequest):
    return {"jd": "JD Generation is handled automatically within the chat."}