from fastapi import APIRouter
from app.schemas.jd_schema import ChatRequest, JDRequest
from app.services.jd_service import handle_conversation, generate_jd

router = APIRouter()


@router.post("/chat")
def chat(request: ChatRequest):

    reply, updated_history = handle_conversation(
        request.history,
        request.message
    )

    return {
        "reply": reply,
        "history": updated_history
    }


@router.post("/generate-jd")
def create_jd(request: JDRequest):

    jd = generate_jd(request.history)

    return {"jd": jd}
