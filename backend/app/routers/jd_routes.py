from fastapi import APIRouter
from app.schemas.jd_schema import ChatRequest, JDRequest
from app.services.jd_service import handle_conversation
import json

router = APIRouter()


@router.post("/chat")
def chat(request: ChatRequest):

    reply, updated_history = handle_conversation(
        request.history,
        request.message
    )
    
    # Parse the reply to return a structured object if possible, 
    # but the frontend expects "reply" string + history. 
    # The "reply" string IS the JSON string now.
    
    # However, to be nice to the frontend, we could try to parse it here 
    # and return it as a dict under a "structured_reply" key, 
    # but the requirement says "The agent must ensure jd_structured_data is... Machine readable".
    # The existing frontend expects { "reply": string, "history": [] }.
    # We stick to that contract for the *wrapper*, but the `reply` content itself is now a JSON string.
    
    return {
        "reply": reply,
        "history": updated_history
    }


@router.post("/generate-jd")
def create_jd(request: JDRequest):
    # This endpoint is strictly speaking deprecated as generation happens in chat now.
    # However, if the user manually clicks "Generate" (if we keep that button), 
    # we might want to trigger the "generation" state.
    # For now, let's return a message saying to continue the chat.
    return {"jd": "JD Generation is now handled automatically within the chat. Please continue the conversation."}

