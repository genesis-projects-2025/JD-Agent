# app/routers/admin_evaluation_routes.py
"""
Admin Evaluation & Token Observability Routes — Real-time token tracking, costs, and request evaluations.
"""

from fastapi import APIRouter, Depends, Query, HTTPException
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional

from app.core.database import get_db
from app.services.token_observability_service import (
    get_observability_stats,
    get_observability_logs,
    get_session_evaluation_detail,
    export_observability_csv,
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
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    session_id: Optional[str] = Query(None),
    trace_id: Optional[str] = Query(None),
    agent_name: Optional[str] = Query(None),
    call_type: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    only_anomalies: bool = Query(False),
    db: AsyncSession = Depends(get_db),
):
    """Fetch paginated real-time LLM token logs with filter support."""
    return await get_observability_logs(
        db,
        limit=limit,
        offset=offset,
        session_id=session_id,
        trace_id=trace_id,
        agent_name=agent_name,
        call_type=call_type,
        status=status,
        only_anomalies=only_anomalies,
    )


@router.get("/session/{session_id}")
async def get_session_evaluation(
    session_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Fetch granular turn-by-turn trace evaluation and token breakdown for a specific user session."""
    return await get_session_evaluation_detail(db, session_id=session_id)


@router.get("/export")
async def export_logs_csv(
    days: int = Query(7, ge=1, le=90),
    db: AsyncSession = Depends(get_db),
):
    """Export LLM token observability logs as downloadable CSV."""
    csv_content = await export_observability_csv(db, days=days)
    return Response(
        content=csv_content,
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=llm_token_logs_{days}d.csv"},
    )
