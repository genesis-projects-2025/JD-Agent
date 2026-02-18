# app/routers/jd_routes.py
from fastapi import APIRouter
from app.schemas.jd_schema import ChatRequest, JDRequest, InitJDRequest, InitJDResponse, SaveJDRequest
from app.services.jd_service import handle_conversation
from app.memory.session_memory import SessionMemory
import uuid

router = APIRouter()

# ✅ In-memory session store — persists memory across requests for the same session
# Key: session_id (str), Value: SessionMemory instance
_session_store: dict[str, SessionMemory] = {}


def get_or_create_session(session_id: str) -> SessionMemory:
    """Get existing session memory or create a new one."""
    if session_id not in _session_store:
        print(f"🆕 Creating new session: {session_id}")
        _session_store[session_id] = SessionMemory()
    else:
        print(f"♻️  Reusing existing session: {session_id}")
    return _session_store[session_id]


@router.post("/chat")
async def chat(request: ChatRequest):
    # ✅ Use session ID from request to persist memory across turns
    # Falls back to a default key if no ID provided (single-user dev mode)
    session_id = request.id or "default"

    session_memory = get_or_create_session(session_id)

    print(f"\n📦 Session {session_id} — insights before: {list(session_memory.insights.keys())}")

    reply, updated_history = handle_conversation(
        request.history,
        request.message,
        session_memory
    )

    print(f"📦 Session {session_id} — insights after: {session_memory.insights}")

    return {
        "reply": reply,
        "history": updated_history
    }


@router.post("/init", response_model=InitJDResponse)
async def init_jd(request: InitJDRequest):
    """Create a new JD session and return its ID."""
    new_id = str(uuid.uuid4())
    # Pre-create the session memory so it's ready
    _session_store[new_id] = SessionMemory()
    print(f"🆕 Initialized new JD session: {new_id}")
    return {"id": new_id, "status": "collecting"}


@router.post("/save")
async def save_jd(request: SaveJDRequest):
    return {"status": "saved", "id": request.id}


@router.post("/generate-jd")
def create_jd(request: JDRequest):
    return {
        "jd": "JD Generation is handled automatically within the chat. Please continue the conversation."
    }