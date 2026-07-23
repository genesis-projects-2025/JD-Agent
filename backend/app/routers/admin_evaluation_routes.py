# app/routers/admin_evaluation_routes.py
"""
Admin Evaluation & Token Observability Routes — Real-time token tracking, costs, and request evaluations.
"""

from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional

from app.core.database import get_db
from app.services.token_observability_service import (
    get_observability_stats,
    get_observability_logs,
    get_session_evaluation_detail,
)

router = APIRouter(prefix="/api/admin/evaluation", tags=["Admin Token Evaluation"])


@router.get("/stats")
async def get_evaluation_stats(
    days: int = Query(7, ge=1, le=90),
    db: AsyncSession = Depends(get_db),
):
    """Fetch aggregated LLM token usage, latency, and cost stats for the Admin Observability Dashboard."""
    return await get_observability_stats(db, days=days)


@router.get("/logs")
async def get_evaluation_logs(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    session_id: Optional[str] = Query(None),
    agent_name: Optional[str] = Query(None),
    call_type: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """Fetch paginated real-time LLM token logs with filter support."""
    return await get_observability_logs(
        db,
        limit=limit,
        offset=offset,
        session_id=session_id,
        agent_name=agent_name,
        call_type=call_type,
    )


@router.get("/session/{session_id}")
async def get_session_evaluation(
    session_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Fetch granular turn-by-turn trace evaluation and token breakdown for a specific user session."""
    return await get_session_evaluation_detail(db, session_id=session_id)
