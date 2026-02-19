# app/routers/jd_routes.py
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from app.schemas.jd_schema import ChatRequest, JDRequest, InitJDRequest, InitJDResponse, SaveJDRequest, UpdateJDRequest, UpdateStatusRequest
from app.services.jd_service import handle_conversation
from app.memory.session_memory import SessionMemory
from app.core.database import get_db
from app.crud.jd_crud import (
    save_questionnaire_jd,
    get_questionnaire,
    list_questionnaires,
    update_questionnaire_jd,
    update_questionnaire_status,
    list_questionnaires_by_employee,
)
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

# Interview conversation
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

# saving to the database
@router.post("/save")
async def save_jd(
    request: SaveJDRequest,
    db: AsyncSession = Depends(get_db)
):
    """Save generated JD to MySQL database using Questionnaire model."""
    session_id = request.id

    # Get insights and progress from session memory
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

# get database information
@router.get("/list")
async def list_jds(db: AsyncSession = Depends(get_db)):
    """List all saved questionnaires."""
    records = await list_questionnaires(db)
    return [
        {
            "id": r.id,
            "employee_id": r.employee_id,
            "title": r.title,
            "status": r.status,
            "version": r.version,
            "created_at": r.created_at,
            "updated_at": r.updated_at,
        }
        for r in records
    ]


# List JDs for a specific employee
@router.get("/employee/{employee_id}")
async def get_employee_jds(employee_id: str, db: AsyncSession = Depends(get_db)):
    """List all JDs for a specific employee."""
    records = await list_questionnaires_by_employee(db, employee_id)
    return [
        {
            "id": r.id,
            "employee_id": r.employee_id,
            "title": r.title,
            "status": r.status,
            "version": r.version,
            "created_at": r.created_at,
            "updated_at": r.updated_at,
        }
        for r in records
    ]


@router.get("/{jd_id}")
async def get_jd(jd_id: str, db: AsyncSession = Depends(get_db)):
    """Get a specific questionnaire JD by ID."""
    record = await get_questionnaire(db, jd_id)
    if not record:
        raise HTTPException(status_code=404, detail="JD not found")
    return {
        "id": record.id,
        "employee_id": record.employee_id,
        "title": record.title,
        "status": record.status,
        "version": record.version,
        "generated_jd": record.generated_jd,
        "jd_structured": record.jd_structured,
        "responses": record.responses,
        "conversation_state": record.conversation_state,
        "created_at": record.created_at,
        "updated_at": record.updated_at,
    }


# Update JD content
@router.put("/{jd_id}")
async def update_jd(
    jd_id: str,
    request: UpdateJDRequest,
    db: AsyncSession = Depends(get_db)
):
    """Update a JD's content. Increments version. Validates ownership."""
    try:
        record = await update_questionnaire_jd(
            db=db,
            jd_id=jd_id,
            jd_text=request.jd_text,
            jd_structured=request.jd_structured,
            employee_id=request.employee_id,
        )
        if not record:
            raise HTTPException(status_code=404, detail="JD not found")
        return {
            "status": "success",
            "id": record.id,
            "version": record.version,
            "updated_at": record.updated_at,
            "message": "JD updated successfully."
        }
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update JD: {str(e)}")


# Update JD status
@router.patch("/{jd_id}/status")
async def update_jd_status(
    jd_id: str,
    request: UpdateStatusRequest,
    db: AsyncSession = Depends(get_db)
):
    """Update a JD's status (e.g., draft -> sent_to_manager -> approved)."""
    valid_statuses = ["draft", "sent_to_manager", "approved", "rejected"]
    if request.status not in valid_statuses:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid status. Must be one of: {valid_statuses}"
        )
    try:
        record = await update_questionnaire_status(
            db=db,
            jd_id=jd_id,
            new_status=request.status,
            employee_id=request.employee_id,
        )
        if not record:
            raise HTTPException(status_code=404, detail="JD not found")
        return {
            "status": "success",
            "id": record.id,
            "new_status": record.status,
            "message": f"Status updated to '{record.status}'"
        }
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update status: {str(e)}")


@router.post("/init", response_model=InitJDResponse)
async def init_jd(request: InitJDRequest):
    new_id = str(uuid.uuid4())
    _session_store[new_id] = SessionMemory()
    return {"id": new_id, "status": "collecting"}


@router.post("/generate-jd")
def create_jd(request: JDRequest):
    return {"jd": "JD Generation is handled automatically within the chat."}