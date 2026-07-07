import logging
from typing import List, Dict
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.routers.admin_routes import get_current_admin
from app.services.admin_brain_agent_service import AdminBrainAgentService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin/brain-agent", tags=["admin-brain-agent"])

class ChatRequest(BaseModel):
    message: str
    history: List[Dict[str, str]] = None

class ChatResponse(BaseModel):
    status: str
    reply: str

@router.post("/chat", response_model=ChatResponse)
async def chat_with_brain_agent(
    request: ChatRequest,
    db: AsyncSession = Depends(get_db),
    admin_role: str = Depends(get_current_admin),
):
    """
    POST /admin/brain-agent/chat
    Allows authenticated administrators to query the corporate knowledge base
    via the Hybrid RAG/SQL Admin Brain Agent.
    """
    try:
        reply = await AdminBrainAgentService.chat(db, request.message, request.history)
        return ChatResponse(status="success", reply=reply)
    except Exception as e:
        logger.error(f"Error in brain agent chat endpoint: {e}")
        raise HTTPException(status_code=500, detail=str(e))
