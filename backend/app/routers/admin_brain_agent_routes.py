import logging
import json
from typing import List, Dict
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
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

@router.post("/chat/stream")
async def chat_stream_endpoint(
    request: ChatRequest,
    db: AsyncSession = Depends(get_db),
    admin_role: str = Depends(get_current_admin),
):
    """
    POST /admin/brain-agent/chat/stream
    Allows authenticated administrators to query the corporate knowledge base
    via the Hybrid RAG/SQL Admin Brain Agent, streaming responses back in real-time.
    """
    async def event_generator():
        try:
            async for event in AdminBrainAgentService.chat_stream(
                db=db,
                message=request.message,
                history=request.history
            ):
                yield f"data: {json.dumps(event)}\n\n"
        except Exception as e:
            logger.error(f"Error in brain agent chat stream: {e}")
            yield f"data: {json.dumps({'type': 'chunk', 'content': f' Error during processing: {str(e)}'})}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")
