# backend/app/routers/kra_kpi_routes.py
"""
KRA/KPI Routes — 3-step guided flow:

  GET  /kra-kpi/{jd_session_id}/status         → Check prerequisites + current step
  POST /kra-kpi/generate/{jd_session_id}        → Step 1: Generate 6–7 KRA suggestions
  GET  /kra-kpi/{jd_session_id}                 → Fetch current record (any step)
  POST /kra-kpi/{jd_session_id}/select-kras     → Step 2: Select 3–5 KRAs → triggers KPI generation
  POST /kra-kpi/{jd_session_id}/select-kpis     → Step 3a: Select 3–5 KPIs per KRA
  PUT  /kra-kpi/{jd_session_id}/weights         → Step 3b: Save weight adjustments (+ optional confirm)
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, field_validator
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.services.kra_kpi_service import (
    MissingPrerequisiteError,
    StepError,
    check_prerequisites,
    generate_kra_suggestions_for_employee,
    get_kra_kpi_by_jd_session,
    save_weights_and_confirm,
    select_kpis_and_build_final,
    select_kras_and_generate_kpis,
)

router = APIRouter(prefix="/kra-kpi", tags=["KRA/KPI"])
logger = logging.getLogger(__name__)


# ── Request Schemas ───────────────────────────────────────────────────────────

class SelectKRAsRequest(BaseModel):
    selected_kra_ids: list[str]

    @field_validator("selected_kra_ids")
    @classmethod
    def validate_count(cls, v: list[str]) -> list[str]:
        if not (3 <= len(v) <= 5):
            raise ValueError(f"Select between 3 and 5 KRAs. Got {len(v)}.")
        return v


class SelectKPIsRequest(BaseModel):
    # {"kra_001": ["kpi_id_1", "kpi_id_2", ...], ...}
    selected_kpi_ids: dict[str, list[str]]

    @field_validator("selected_kpi_ids")
    @classmethod
    def validate_counts(cls, v: dict[str, list[str]]) -> dict[str, list[str]]:
        for kra_id, kpi_ids in v.items():
            if not (3 <= len(kpi_ids) <= 5):
                raise ValueError(
                    f"Select 3–5 KPIs for each KRA. KRA '{kra_id}' has {len(kpi_ids)}."
                )
        return v


class SaveWeightsRequest(BaseModel):
    kras: list[dict]  # Full KRA list with updated weight fields
    confirm: bool = False


class PrerequisiteStatusResponse(BaseModel):
    ready: bool
    missing: list[str]
    message: str
    current_step: str | None = None


# ── Helper: format errors ─────────────────────────────────────────────────────

def _missing_error(e: MissingPrerequisiteError):
    raise HTTPException(
        status_code=422,
        detail={
            "error": "missing_prerequisites",
            "missing": e.missing,
            "message": e.message,
            "action_required": (
                "KRA/KPI requires: (1) Your completed JD, "
                "(2) Your manager's completed JD, (3) Your manager's KRA/KPI."
            ),
        },
    )


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("/{jd_session_id}/status", response_model=PrerequisiteStatusResponse)
async def get_status(
    jd_session_id: str,
    employee_id: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    """Check prerequisites and return current step."""
    record = await get_kra_kpi_by_jd_session(db, jd_session_id)
    current_step = record.generation_step if record else None
    status_val = record.status if record else None

    if current_step == "confirmed" or status_val == "confirmed":
        return PrerequisiteStatusResponse(
            ready=True,
            missing=[],
            message="KRA/KPI framework is confirmed.",
            current_step=current_step,
        )

    try:
        await check_prerequisites(db, jd_session_id, employee_id)
        return PrerequisiteStatusResponse(
            ready=True,
            missing=[],
            message="All prerequisites are available.",
            current_step=current_step,
        )
    except MissingPrerequisiteError as e:
        return PrerequisiteStatusResponse(
            ready=False,
            missing=e.missing,
            message=e.message,
            current_step=current_step,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/generate/{jd_session_id}")
async def generate_kra_suggestions_endpoint(
    jd_session_id: str,
    employee_id: str = Query(...),
    bypass_manager: bool = Query(False),
    db: AsyncSession = Depends(get_db),
):
    """Step 1: Generate 6–7 KRA suggestions (employee JD as primary source)."""
    try:
        record = await generate_kra_suggestions_for_employee(
            db, jd_session_id, employee_id, bypass_manager=bypass_manager
        )
        return {
            "status": "success",
            "kra_kpi_id": str(record.id),
            "generation_step": record.generation_step,
            "kra_suggestions": record.kra_suggestions,
        }
    except MissingPrerequisiteError as e:
        _missing_error(e)
    except Exception as e:
        logger.error(f"[KRAKPIRoutes] Generate error: {e}")
        import traceback; traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{jd_session_id}")
async def get_kra_kpi(jd_session_id: str, db: AsyncSession = Depends(get_db)):
    """Fetch the current KRA/KPI record at any step."""
    record = await get_kra_kpi_by_jd_session(db, jd_session_id)
    if not record:
        raise HTTPException(status_code=404, detail={"error": "not_found", "message": "No KRA/KPI generated yet."})
    return record.to_dict()


@router.post("/{jd_session_id}/select-kras")
async def select_kras_endpoint(
    jd_session_id: str,
    request: SelectKRAsRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Step 2: Employee selects 3–5 KRAs.
    Triggers parallel KPI suggestion generation for each selected KRA.
    """
    try:
        record = await select_kras_and_generate_kpis(
            db=db,
            jd_session_id=jd_session_id,
            selected_kra_ids=request.selected_kra_ids,
        )
        return {
            "status": "success",
            "generation_step": record.generation_step,
            "selected_kra_ids": record.selected_kra_ids,
            "kpi_suggestions": record.kpi_suggestions,
        }
    except StepError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"[KRAKPIRoutes] Select KRAs error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{jd_session_id}/select-kpis")
async def select_kpis_endpoint(
    jd_session_id: str,
    request: SelectKPIsRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Step 3a: Employee selects 3–5 KPIs per KRA.
    Builds the final KRA/KPI payload with initial equal weights for drag-and-drop.
    """
    try:
        record = await select_kpis_and_build_final(
            db=db,
            jd_session_id=jd_session_id,
            selected_kpi_ids=request.selected_kpi_ids,
        )
        return {
            "status": "success",
            "generation_step": record.generation_step,
            "kras": record.kras,
        }
    except StepError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"[KRAKPIRoutes] Select KPIs error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/{jd_session_id}/weights")
async def save_weights_endpoint(
    jd_session_id: str,
    request: SaveWeightsRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Step 3b: Save drag-and-drop weight adjustments.
    Set confirm=true to lock the KRA/KPI as confirmed.
    """
    try:
        record = await save_weights_and_confirm(
            db=db,
            jd_session_id=jd_session_id,
            kras_with_weights=request.kras,
            confirm=request.confirm,
        )
        return {
            "status": "confirmed" if request.confirm else "saved",
            "generation_step": record.generation_step,
            "kras": record.kras,
            "confirmed_at": record.confirmed_at.isoformat() if record.confirmed_at else None,
        }
    except StepError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"[KRAKPIRoutes] Save weights error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
