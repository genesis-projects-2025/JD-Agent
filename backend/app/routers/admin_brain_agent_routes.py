"""
Admin Brain Agent Routes.

Exposes:
- POST /admin/brain-agent/chat/stream — Streaming chat with tool-use loop
- GET  /admin/brain-agent/insights — Dynamic suggestion cards from live DB
- GET  /admin/brain-agent/sessions — List past sessions
- GET  /admin/brain-agent/sessions/{session_id} — Get session conversation turns
- DELETE /admin/brain-agent/sessions/{session_id} — Delete a session
- POST /admin/brain-agent/export-csv — Export SQL query results as CSV
"""

import io
import csv
import logging
import json
from typing import List, Dict, Optional
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.routers.admin_routes import get_current_admin
from app.services.admin_brain_agent_service import AdminBrainAgentService
from app.services.db_query_service import execute_safe_select
from app.services.brain_agent_insights_service import generate_dynamic_insights

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin/brain-agent", tags=["admin-brain-agent"])


class ChatRequest(BaseModel):
    message: str
    session_id: Optional[str] = None
    history: Optional[List[Dict[str, str]]] = None


class ExportCSVRequest(BaseModel):
    query: str


# ── Streaming Chat ──

@router.post("/chat/stream")
async def chat_stream_endpoint(
    request: ChatRequest,
    db: AsyncSession = Depends(get_db),
    admin_user: str = Depends(get_current_admin),
):
    """Stream Brain Agent responses with tool-use loop and persistent sessions."""

    async def event_generator():
        try:
            async for event in AdminBrainAgentService.chat_stream(
                db=db,
                message=request.message,
                admin_user=admin_user,
                session_id=request.session_id,
            ):
                yield f"data: {json.dumps(event)}\n\n"
        except Exception as e:
            logger.error(f"Error in brain agent chat stream: {e}")
            yield f"data: {json.dumps({'type': 'chunk', 'content': f'**System Notification**: Stream error: {str(e)}'})}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


# ── Dynamic Insights ──

@router.get("/insights")
async def get_insights(
    db: AsyncSession = Depends(get_db),
    admin_user: str = Depends(get_current_admin),
):
    """Return dynamic suggestion cards based on live database state."""
    try:
        insights = await generate_dynamic_insights(db)
        return {"insights": insights}
    except Exception as e:
        logger.error(f"Error generating insights: {e}")
        return {"insights": []}


# ── Session Management ──

@router.get("/sessions")
async def list_sessions(
    db: AsyncSession = Depends(get_db),
    admin_user: str = Depends(get_current_admin),
):
    """List all past Brain Agent sessions for the authenticated admin."""
    sessions = await AdminBrainAgentService.list_sessions(db, admin_user)
    return {"sessions": sessions}


@router.get("/sessions/{session_id}")
async def get_session_turns(
    session_id: str,
    db: AsyncSession = Depends(get_db),
    admin_user: str = Depends(get_current_admin),
):
    """Get all conversation turns for a specific session."""
    turns = await AdminBrainAgentService.get_session_turns(db, session_id)
    return {"turns": turns}


@router.delete("/sessions/{session_id}")
async def delete_session(
    session_id: str,
    db: AsyncSession = Depends(get_db),
    admin_user: str = Depends(get_current_admin),
):
    """Delete a Brain Agent session and all its conversation turns."""
    success = await AdminBrainAgentService.delete_session(db, session_id)
    if not success:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"status": "deleted"}


# ── CSV Export ──

@router.post("/export-csv")
async def export_csv(
    request: ExportCSVRequest,
    db: AsyncSession = Depends(get_db),
    admin_user: str = Depends(get_current_admin),
):
    """Execute a validated SQL query and return results as a CSV download."""
    try:
        rows = await execute_safe_select(db, request.query)
        if not rows:
            raise HTTPException(status_code=404, detail="Query returned no results")

        output = io.StringIO()
        writer = csv.DictWriter(output, fieldnames=rows[0].keys())
        writer.writeheader()
        writer.writerows(rows)
        output.seek(0)

        return StreamingResponse(
            iter([output.getvalue()]),
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=brain_agent_export.csv"},
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"CSV export error: {e}")
        raise HTTPException(status_code=400, detail=str(e))
