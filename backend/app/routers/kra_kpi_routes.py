# backend/app/routers/kra_kpi_routes.py
"""
KRA/KPI Routes — 3-step guided flow:

  GET  /kra-kpi/{jd_session_id}/status               → Check prerequisites + current step
  POST /kra-kpi/generate/{jd_session_id}             → Step 1: Generate 6–7 KRA suggestions
  GET  /kra-kpi/{jd_session_id}                      → Fetch current record (any step)
  POST /kra-kpi/{jd_session_id}/select-kras          → Step 2: Select 3–5 KRAs → triggers KPI generation
  POST /kra-kpi/{jd_session_id}/select-kpis          → Step 3a: Select 3–5 KPIs per KRA
  PUT  /kra-kpi/{jd_session_id}/weights              → Step 3b: Employee sets weights + confirms
  POST /kra-kpi/{jd_session_id}/send-for-approval    → Step 4: Send confirmed KRA/KPI for manager approval
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
        if len(v) < 1:
            raise ValueError("Select at least 1 KRA.")
        return v


class SelectKPIsRequest(BaseModel):
    # {"kra_001": ["kpi_id_1", "kpi_id_2", ...], ...}
    selected_kpi_ids: dict[str, list[str]]

    @field_validator("selected_kpi_ids")
    @classmethod
    def validate_counts(cls, v: dict[str, list[str]]) -> dict[str, list[str]]:
        for kra_id, kpi_ids in v.items():
            if len(kpi_ids) < 1:
                raise ValueError(
                    f"Select at least 1 KPI for KRA '{kra_id}'."
                )
        return v


class CustomKRARequest(BaseModel):
    title: str
    description: str
    selected_ids: list[str] | None = None


class CustomKPIRequest(BaseModel):
    kra_id: str
    metric: str
    target: str
    measurement_method: str
    frequency: str
    selected_ids: dict[str, list[str]] | None = None


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
                "KRA/KPI requires: (1) Your Job Description (approved by your manager), "
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
    from sqlalchemy import select
    from app.models.kra_kpi_model import UploadedKRAKPI

    # Check if there is an admin-uploaded KRA/KPI first
    uploaded_res = await db.execute(
        select(UploadedKRAKPI).where(UploadedKRAKPI.employee_id == employee_id)
    )
    uploaded = uploaded_res.scalars().first()
    if uploaded:
        return PrerequisiteStatusResponse(
            ready=True,
            missing=[],
            message="KRA/KPI framework is confirmed (Admin Uploaded).",
            current_step="uploaded",
        )

    record = await get_kra_kpi_by_jd_session(db, jd_session_id)
    current_step = record.generation_step if record else None
    status_val = record.status if record else None

    if current_step == "confirmed" or status_val in ("confirmed", "sent_to_manager", "sent_to_hr", "approved", "manager_rejected", "hr_rejected"):
        return PrerequisiteStatusResponse(
            ready=True,
            missing=[],
            message="KRA/KPI framework is confirmed or active in workflow.",
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
    from sqlalchemy import select
    from app.models.kra_kpi_model import UploadedKRAKPI
    from app.models.jd_session_model import JDSession
    import uuid

    # Try to find employee_id from jd_session_id
    employee_id = None
    try:
        jd_uuid = uuid.UUID(jd_session_id)
        jd_res = await db.execute(select(JDSession).where(JDSession.id == jd_uuid))
        jd_session = jd_res.scalars().first()
        if jd_session:
            employee_id = jd_session.employee_id
    except Exception:
        pass

    if employee_id:
        # Check if there is an admin-uploaded KRA/KPI for this employee
        uploaded_res = await db.execute(
            select(UploadedKRAKPI).where(UploadedKRAKPI.employee_id == employee_id)
        )
        uploaded = uploaded_res.scalars().first()
        if uploaded:
            return {
                "id": str(uploaded.id),
                "jd_session_id": jd_session_id,
                "employee_id": uploaded.employee_id,
                "manager_employee_id": None,
                "generation_step": "uploaded",
                "kra_suggestions": None,
                "selected_kra_ids": None,
                "kpi_suggestions": None,
                "selected_kpi_ids": None,
                "kras": uploaded.kras, # e.g. {"kras": [...]}
                "status": "approved",
                "generation_model": "uploaded",
                "generation_error": None,
                "conversation_state": None,
                "generated_at": uploaded.created_at.isoformat() if uploaded.created_at else None,
                "confirmed_at": uploaded.updated_at.isoformat() if uploaded.updated_at else None,
                "created_at": uploaded.created_at.isoformat() if uploaded.created_at else None,
                "updated_at": uploaded.updated_at.isoformat() if uploaded.updated_at else None,
            }

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


@router.post("/{jd_session_id}/custom-kra")
async def add_custom_kra(
    jd_session_id: str,
    request: CustomKRARequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Employee adds a custom KRA.
    Saves it to kra_suggestions and adds it to selected_kra_ids.
    """
    from sqlalchemy.orm.attributes import flag_modified
    import uuid

    record = await get_kra_kpi_by_jd_session(db, jd_session_id)
    if not record:
        raise HTTPException(status_code=404, detail="No KRA/KPI session found.")

    kra_id = f"custom_kra_{uuid.uuid4().hex[:6]}"
    new_kra = {
        "kra_id": kra_id,
        "title": request.title,
        "description": request.description,
        "source_tasks": ["Manually Added"],
        "suggested_weight": 20,
        "manager_impact": "Direct addition by employee"
    }

    if not record.kra_suggestions:
        record.kra_suggestions = {}
    if "kra_suggestions" not in record.kra_suggestions:
        record.kra_suggestions["kra_suggestions"] = []
    
    record.kra_suggestions["kra_suggestions"].append(new_kra)

    if request.selected_ids is not None:
        record.selected_kra_ids = request.selected_ids

    if record.selected_kra_ids is None:
        record.selected_kra_ids = []
    if kra_id not in record.selected_kra_ids:
        record.selected_kra_ids.append(kra_id)

    flag_modified(record, "kra_suggestions")
    flag_modified(record, "selected_kra_ids")

    await db.commit()
    await db.refresh(record)

    return {
        "status": "success",
        "kra": new_kra,
        "selected_kra_ids": record.selected_kra_ids,
        "kra_suggestions": record.kra_suggestions,
    }


@router.post("/{jd_session_id}/custom-kpi")
async def add_custom_kpi(
    jd_session_id: str,
    request: CustomKPIRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Employee adds a custom KPI to a specific KRA.
    Saves it to kpi_suggestions and adds it to selected_kpi_ids.
    """
    from sqlalchemy.orm.attributes import flag_modified
    import uuid

    record = await get_kra_kpi_by_jd_session(db, jd_session_id)
    if not record:
        raise HTTPException(status_code=404, detail="No KRA/KPI session found.")

    kpi_id = f"{request.kra_id}_custom_kpi_{uuid.uuid4().hex[:6]}"
    new_kpi = {
        "kpi_id": kpi_id,
        "metric": request.metric,
        "description": "Manually added KPI",
        "target": request.target,
        "measurement_method": request.measurement_method,
        "frequency": request.frequency,
        "threshold": {
            "excellent": "Exceeds target",
            "meets_expectation": "Meets target",
            "below_expectation": "Below target"
        }
    }

    if record.kpi_suggestions is None:
        record.kpi_suggestions = {}
    
    if request.kra_id not in record.kpi_suggestions:
        # Fetch the KRA title from suggestions if possible
        kra_title = ""
        if record.kra_suggestions:
            for k in record.kra_suggestions.get("kra_suggestions", []):
                if k.get("kra_id") == request.kra_id:
                    kra_title = k.get("title", "")
                    break
        record.kpi_suggestions[request.kra_id] = {
            "kra_title": kra_title,
            "kpi_suggestions": []
        }

    if "kpi_suggestions" not in record.kpi_suggestions[request.kra_id]:
        record.kpi_suggestions[request.kra_id]["kpi_suggestions"] = []

    record.kpi_suggestions[request.kra_id]["kpi_suggestions"].append(new_kpi)

    if request.selected_ids is not None:
        record.selected_kpi_ids = request.selected_ids

    if record.selected_kpi_ids is None:
        record.selected_kpi_ids = {}
    
    if request.kra_id not in record.selected_kpi_ids:
        record.selected_kpi_ids[request.kra_id] = []
    
    if kpi_id not in record.selected_kpi_ids[request.kra_id]:
        record.selected_kpi_ids[request.kra_id].append(kpi_id)

    flag_modified(record, "kpi_suggestions")
    flag_modified(record, "selected_kpi_ids")

    await db.commit()
    await db.refresh(record)

    return {
        "status": "success",
        "kpi": new_kpi,
        "selected_kpi_ids": record.selected_kpi_ids,
        "kpi_suggestions": record.kpi_suggestions,
    }


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


@router.post("/{jd_session_id}/send-for-approval")
async def send_for_approval_endpoint(
    jd_session_id: str,
    db: AsyncSession = Depends(get_db),
):
    """
    Step 4: Send confirmed KRA/KPI framework for manager approval.
    Transitions status from 'confirmed' → 'sent_to_manager'.
    Only allowed when generation_step == 'confirmed' and weights sum to 100.
    """
    from datetime import datetime, timezone
    record = await get_kra_kpi_by_jd_session(db, jd_session_id)
    if not record:
        raise HTTPException(status_code=404, detail="No KRA/KPI session found.")
    if record.generation_step != "confirmed":
        raise HTTPException(
            status_code=400,
            detail="KRA/KPI must be confirmed (weights set) before sending for approval.",
        )
    if record.status in ("sent_to_manager", "sent_to_hr", "approved"):
        raise HTTPException(
            status_code=400,
            detail=f"KRA/KPI is already in status: {record.status}",
        )

    # Validate weights sum to 100
    kras = (record.kras or {}).get("kras", [])
    total = sum((k.get("weight") or 0) for k in kras)
    if abs(total - 100) > 1:
        raise HTTPException(
            status_code=400,
            detail=f"KRA weights must sum to 100 before sending for approval. Current total: {total}",
        )

    now = datetime.now(timezone.utc)
    
    # Dynamic Routing Logic: If employee has no manager or reports directly to HR (E6679)
    from app.models.user_model import Employee
    from sqlalchemy import select
    emp_res = await db.execute(select(Employee).where(Employee.id == record.employee_id))
    employee = emp_res.scalar_one_or_none()
    
    target_status = "sent_to_manager"
    message = "KRA/KPI framework sent to manager for approval."
    if employee:
        mgr_code = employee.reporting_manager_code
        if not mgr_code or str(mgr_code).strip() == "" or str(mgr_code).strip() == "E6679":
            target_status = "sent_to_hr"
            message = "KRA/KPI framework sent directly to HR for approval."

    record.status = target_status
    record.updated_at = now
    await db.commit()
    await db.refresh(record)

    from app.core.cache import invalidate_pattern
    await invalidate_pattern("cache:jd_list:*")
    await invalidate_pattern("cache:manager_pending:*")
    await invalidate_pattern("cache:hr_pending:*")
    await invalidate_pattern("cache:dept_stats:*")
    await invalidate_pattern(f"cache:jd_detail:*{jd_session_id}*")
    await invalidate_pattern(f"jds:employee:{record.employee_id}")

    return {
        "status": "success",
        "message": message,
        "kra_kpi_status": record.status,
    }


from fastapi.responses import StreamingResponse
import json
from app.schemas.jd_schema import ChatRequest
from app.agents.kra_kpi_interview_agent import kra_kpi_interview_engine
from app.services.kra_kpi_service import sync_kra_kpi_session_to_db


@router.post("/chat/stream")
async def chat_stream(request: ChatRequest, db: AsyncSession = Depends(get_db)):
    session_id = request.id
    if not session_id:
        raise HTTPException(status_code=400, detail="Missing session id")

    async def event_generator():
        try:
            conversation_history = list(request.history)
            conversation_history.append({"role": "user", "content": request.message})

            parsed_done_data = None
            async for chunk in kra_kpi_interview_engine.run_turn_stream(
                session_id=session_id,
                user_message=request.message,
                db=db,
            ):
                if chunk.get("type") == "done":
                    parsed_done_data = chunk.get("parsed")
                    yield f"data: {json.dumps(chunk)}\n\n"
                else:
                    yield f"data: {json.dumps(chunk)}\n\n"

            if parsed_done_data:
                # Add assistant response to history
                conversation_history.append({
                    "role": "assistant",
                    "content": json.dumps(parsed_done_data),
                })
                # Sync turns and state
                await sync_kra_kpi_session_to_db(
                    db=db,
                    session_id=session_id,
                    conversation_state=parsed_done_data.get("progress", {}),
                    conversation_history=conversation_history,
                )
        except Exception as e:
            logger.error(f"[KRAKPIRoutes] Stream error: {e}")
            yield f"data: {json.dumps({'type': 'error', 'content': str(e)})}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


@router.post("/chat")
async def chat(request: ChatRequest, db: AsyncSession = Depends(get_db)):
    session_id = request.id
    if not session_id:
        raise HTTPException(status_code=400, detail="Missing session id")

    conversation_history = list(request.history)
    conversation_history.append({"role": "user", "content": request.message})

    # Retrieve all chunks and extract the final "done" parsed payload
    reply_content = ""
    parsed_done_data = None

    async for chunk in kra_kpi_interview_engine.run_turn_stream(
        session_id=session_id,
        user_message=request.message,
        db=db,
    ):
        if chunk.get("type") == "chunk":
            reply_content += chunk.get("content", "")
        elif chunk.get("type") == "done":
            parsed_done_data = chunk.get("parsed")

    if not parsed_done_data:
        raise HTTPException(
            status_code=500,
            detail="Failed to generate conversational KRA/KPI response.",
        )

    # Add assistant response to history
    conversation_history.append({
        "role": "assistant",
        "content": json.dumps(parsed_done_data),
    })

    # Sync state and turns to db
    await sync_kra_kpi_session_to_db(
        db=db,
        session_id=session_id,
        conversation_state=parsed_done_data.get("progress", {}),
        conversation_history=conversation_history,
    )

    return {"reply": json.dumps(parsed_done_data), "history": conversation_history}


# ── Review and Improvement Plan Routes ────────────────────────────────────────

class KRAKPIReviewRequest(BaseModel):
    action: str  # approved | rejected
    comment: str | None = None
    skill_ratings: list[dict] | None = None
    improvement_area: str | None = None
    improvement_goal: str | None = None
    reviewer_id: str


@router.get("/improvements")
async def get_improvements(
    employee_id: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    """Retrieve the latest KRA/KPI session improvements for the employee."""
    from sqlalchemy import select
    from app.models.kra_kpi_model import KRAKPISession
    
    # Query for approved KRAKPISessions with sent_to_employee improvements
    # We sort by updated_at descending to get the latest
    result = await db.execute(
        select(KRAKPISession)
        .where(
            KRAKPISession.employee_id == employee_id,
            KRAKPISession.improvement_status == "sent_to_employee"
        )
        .order_by(KRAKPISession.updated_at.desc())
    )
    session = result.scalars().first()
    if not session:
        return {
            "has_improvement_plan": False,
            "skill_ratings": [],
            "improvement_area": "",
            "improvement_goal": ""
        }
        
    return {
        "has_improvement_plan": True,
        "skill_ratings": session.skill_ratings,
        "improvement_area": session.improvement_area,
        "improvement_goal": session.improvement_goal,
        "updated_at": session.updated_at.isoformat() if session.updated_at else None,
        "reviewed_by": session.reviewed_by
    }


@router.get("/{jd_session_id}/review-skills")
async def get_review_skills(
    jd_session_id: str,
    db: AsyncSession = Depends(get_db),
):
    """
    Fetch consolidated unique skills for manager review.
    If already generated, returns the stored skills. Otherwise, invokes LLM to generate them.
    """
    from sqlalchemy import select
    from app.models.kra_kpi_model import KRAKPISession
    from app.models.jd_session_model import JDSession
    from app.agents.kra_kpi_agent import consolidate_skills_for_review
    import uuid

    # 1. Fetch KRA/KPI session
    record = await get_kra_kpi_by_jd_session(db, jd_session_id)
    if not record:
        raise HTTPException(
            status_code=404,
            detail="No KRA/KPI session found for this Job Description."
        )

    # If manager has already generated or rated, return them
    if record.skill_ratings:
        return {"skills": record.skill_ratings}

    # 2. Fetch employee JD session to get the JD skills
    try:
        jd_uuid = uuid.UUID(jd_session_id)
        jd_res = await db.execute(select(JDSession).where(JDSession.id == jd_uuid))
        jd_session = jd_res.scalars().first()
    except Exception:
        jd_session = None

    jd_skills = []
    if jd_session and jd_session.jd_structured:
        # Extract skills from structured data
        jd_skills = jd_session.jd_structured.get("skills", [])

    # Extract current KRAs & KPIs from session
    kras = (record.kras or {}).get("kras", [])

    # 3. Call AI agent to consolidate
    try:
        raw_skills = await consolidate_skills_for_review(jd_skills=jd_skills, kras=kras)
        # Sanitise the skills names returned by the LLM (remove duplicates & soft-skills)
        from app.agents.validators import SOFT_SKILL_PATTERNS
        cleaned_skills = []
        seen_names = set()
        for s in raw_skills:
            if not s or not isinstance(s, dict):
                continue
            name = s.get("name", "").strip()
            desc = s.get("description", "").strip()
            if not name or name.lower() in seen_names:
                continue
            # Filter soft skills
            if any(pattern in name.lower() for pattern in SOFT_SKILL_PATTERNS):
                continue
            cleaned_skills.append({"name": name, "description": desc, "rating": None})
            seen_names.add(name.lower())
        skills = cleaned_skills
    except Exception as e:
        logger.error(f"Error in skills consolidation: {e}")
        # Fallback list based on raw JD skills
        skills = [{"name": s, "description": f"Competency in {s}.", "rating": None} for s in jd_skills]

    # Initialize ratings field as null
    for s in skills:
        if "rating" not in s:
            s["rating"] = None

    # 4. Save to DB so it is locked and deterministic for subsequent requests
    record.skill_ratings = skills
    await db.commit()
    await db.refresh(record)

    return {"skills": record.skill_ratings}


@router.post("/{jd_session_id}/review")
async def review_kra_kpi(
    jd_session_id: str,
    request: KRAKPIReviewRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Submit manager review of KRA/KPI framework.
    Rates skills and updates session status.
    """
    from datetime import datetime, timezone
    from app.models.user_model import Employee
    from sqlalchemy import select

    record = await get_kra_kpi_by_jd_session(db, jd_session_id)
    if not record:
        raise HTTPException(status_code=404, detail="No KRA/KPI session found.")

    if request.action not in ["approved", "rejected"]:
        raise HTTPException(
            status_code=400,
            detail="Invalid action. Must be 'approved' or 'rejected'."
        )

    # 1. Fetch reviewer role
    reviewer_res = await db.execute(
        select(Employee).where(Employee.id == request.reviewer_id)
    )
    reviewer = reviewer_res.scalar_one_or_none()
    reviewer_role = reviewer.role if reviewer else "manager"

    # 2. Update status based on reviewer role and action
    now = datetime.now(timezone.utc)
    record.reviewed_by = request.reviewer_id
    record.reviewer_comment = request.comment
    record.reviewed_at = now

    if request.action == "rejected":
        if reviewer_role in ["hr", "admin"]:
            record.status = "hr_rejected"
        else:
            record.status = "manager_rejected"
    elif request.action == "approved":
        if reviewer_role in ["hr", "admin"]:
            record.status = "approved"
        else:
            record.status = "sent_to_hr"
            # Set improvements only when manager approves
            if request.skill_ratings is not None:
                record.skill_ratings = request.skill_ratings
            # We clear/ignore the improvement areas/goals since we only use ratings now
            record.improvement_area = None
            record.improvement_goal = None
            record.improvement_status = "sent_to_employee"

    record.updated_at = now
    await db.commit()
    await db.refresh(record)

    # 3. Invalidate Redis cache
    from app.core.cache import invalidate_pattern
    await invalidate_pattern("cache:jd_list:*")
    await invalidate_pattern("cache:manager_pending:*")
    await invalidate_pattern("cache:hr_pending:*")
    await invalidate_pattern("cache:dept_stats:*")
    await invalidate_pattern(f"cache:jd_detail:*{jd_session_id}*")
    await invalidate_pattern(f"jds:employee:{record.employee_id}")

    return {
        "status": "success",
        "message": f"KRA/KPI framework successfully {request.action} by {reviewer_role}.",
        "kra_kpi_status": record.status,
    }
