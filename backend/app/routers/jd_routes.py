from fastapi import APIRouter, Depends, HTTPException, Response, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text,select
from typing import Optional
import logging
import re
import json
import uuid

from app.schemas.jd_schema import (
    ChatRequest,
    InitJDRequest,
    InitJDResponse,
    SaveJDRequest,
    UpdateJDRequest,
    UpdateStatusRequest,
    GenerateJDRequest,
    ConfirmSkillsRequest,
    ConfirmToolsRequest,
    ConfirmPriorityTasksRequest,
)
from app.services.jd_service import (
    handle_conversation,
    handle_conversation_stream,
    handle_jd_generation,
)
from app.agents.router import compute_current_agent, compute_progress
from app.memory.session_memory import SessionMemory
from app.core.database import get_db
from app.crud.jd_crud import (
    save_questionnaire_jd,
    sync_session_to_db,
    get_questionnaire,
    list_questionnaires,
    update_questionnaire_jd,
    update_questionnaire_status,
    list_questionnaires_by_employee,
    list_manager_pending_jds,
    list_hr_pending_jds,
    delete_questionnaire,
    create_review_comment,
    get_review_comments_for_jd,
    get_unread_feedback_for_user,
    get_all_feedback_for_user,
    mark_feedback_read,
)
from app.core.cache import cached_response, invalidate_pattern, get_cache, set_cache
from app.services.docx_generator import generate_jd_docx
from app.core.auth import get_current_user
from app.models.user_model import Employee
from sqlalchemy import column, text

logger = logging.getLogger(__name__)

# Session cache TTL — 5 minutes for active interviews
_SESSION_CACHE_TTL = 300

router = APIRouter()


def get_or_create_session(session_id: str) -> SessionMemory:
    logger.debug(f"Creating transient session object: {session_id}")
    memory = SessionMemory()
    memory.id = session_id
    return memory


def _session_to_cache_dict(memory: SessionMemory) -> dict:
    """Serialize a SessionMemory to a cache-friendly dict."""
    return {
        "id": memory.id,
        "employee_id": memory.employee_id,
        "employee_name": memory.employee_name,
        "insights": memory.insights,
        "progress": memory.progress,
        "generated_jd": memory.generated_jd,
        "jd_structured": memory.jd_structured,
        "recent_messages": memory.recent_messages,
        "full_history": memory.full_history[-6:],  # Only cache recent turns
        "current_phase": memory.current_phase,
        "current_agent": memory.current_agent,
        "working_memory": memory.to_dict(),  # Include everything (questions_asked, etc)
    }

def _session_from_cache_dict(data: dict) -> SessionMemory:
    """Restore a SessionMemory from a cached dict."""
    memory = SessionMemory()
    memory.id = data.get("id")
    memory.employee_id = data.get("employee_id")
    memory.employee_name = data.get("employee_name")
    memory.insights = data.get("insights", {})
    memory.progress = data.get("progress", {})
    memory.generated_jd = data.get("generated_jd")
    memory.jd_structured = data.get("jd_structured")
    memory.current_agent = data.get("current_agent", "BasicInfoAgent")
    history = data.get("full_history", [])
    memory.load_history_from_db(history, llm_limit=6)

    # Restore working memory if present
    if "working_memory" in data:
        memory.from_dict(data["working_memory"])
    return memory


async def _cache_session(memory: SessionMemory):
    """Cache a hot session in Redis for fast retrieval."""
    try:
        await set_cache(
            f"session:{memory.id}",
            _session_to_cache_dict(memory),
            ttl=_SESSION_CACHE_TTL,
        )
    except Exception:
        pass  # Cache failures are non-critical


def _reconcile_session_memory(memory: SessionMemory) -> SessionMemory:
    """Normalize resume state so stale payloads do not park sessions in the wrong phase."""
    if not memory.id:
        return memory

    review_statuses = {
        "jd_generated",
        "sent_to_manager",
        "manager_rejected",
        "sent_to_hr",
        "hr_rejected",
        "approved",
    }
    current_status = str(memory.progress.get("status", "collecting"))
    if current_status in review_statuses:
        return memory

    derived_agent = compute_current_agent(
        dict(memory.insights or {}),
        memory.current_agent or "BasicInfoAgent",
    )
    derived_progress = compute_progress(memory.insights or {}, derived_agent)

    if memory.generated_jd or memory.jd_structured:
        if derived_agent == "JDGeneratorAgent":
            derived_progress["status"] = "jd_generated"
        elif derived_progress.get("completion_percentage", 0) >= 95:
            derived_progress["status"] = "ready_for_generation"

    memory.current_agent = derived_agent
    memory.progress.update(derived_progress)
    memory.progress["current_agent"] = derived_agent
    return memory


async def hydrate_session_from_db(session_id: str, db: AsyncSession) -> SessionMemory:
    # Try Redis cache first — ~1ms vs ~50-100ms for DB
    cached = await get_cache(f"session:{session_id}")
    if cached:
        logger.debug(f"Session {session_id} loaded from Redis cache")
        return _reconcile_session_memory(_session_from_cache_dict(cached))

    logger.debug(f"Hydrating session {session_id} from DB...")
    from sqlalchemy.future import select as fut_select
    from app.models.jd_session_model import JDSession, ConversationTurn

    # Local safe_uuid helper
    def _to_uuid(val):
        if isinstance(val, uuid.UUID):
            return val
        return uuid.UUID(str(val))

    result = await db.execute(
        fut_select(JDSession).where(JDSession.id == _to_uuid(session_id))
    )
    record = result.scalar_one_or_none()
    memory = SessionMemory()

    if record:
        memory.id = str(record.id)
        # pyrefly: ignore [bad-assignment]
        memory.employee_id = record.employee_id
        memory.employee_name = (
            record.insights.get("identity_context", {}).get("employee_name")
            if record.insights
            else None
        )
        # pyrefly: ignore [bad-assignment]
        memory.insights = record.insights or {}
        # Restore full session state (questions_asked, progress, etc)
        # pyrefly: ignore [bad-argument-type]
        memory.from_dict(record.conversation_state or {})
        # Make sure progress status matches the database column record status (source of truth)
        if record.status:
            memory.progress["status"] = record.status
        # pyrefly: ignore [bad-assignment]
        memory.generated_jd = record.jd_text
        # pyrefly: ignore [bad-assignment]
        memory.jd_structured = record.jd_structured

        turns_result = await db.execute(
            fut_select(ConversationTurn)
            .where(ConversationTurn.session_id == record.id)
            .order_by(ConversationTurn.turn_index.asc())
        )
        all_turns = turns_result.scalars().all()
        history = [{"role": t.role, "content": t.content} for t in all_turns]
        memory.load_history_from_db(history, llm_limit=6)

    # Cache for next request
    memory = _reconcile_session_memory(memory)
    await _cache_session(memory)

    return memory


# ── Init ──────────────────────────────────────────────────────────────────────
@router.post("/init", response_model=InitJDResponse)
async def init_jd(
    request: InitJDRequest,
    template_session_id: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    from sqlalchemy.future import select
    from app.models.user_model import Employee
    from app.models.jd_session_model import JDSession

    # 1. Ensure Employee exists
    emp_result = await db.execute(
        select(Employee).filter(Employee.id == request.employee_id)
    )
    emp = emp_result.scalars().first()
    if not emp:
        emp = Employee(
            id=request.employee_id, name=request.employee_name or "Unknown Employee"
        )
        db.add(emp)
        await db.commit()

    # 2. Prevent duplicate sessions: Check if employee already has a session
    existing_res = await db.execute(
        select(JDSession)
        .where(JDSession.employee_id == request.employee_id)
        .order_by(JDSession.updated_at.desc())
    )
    existing_session = existing_res.scalars().first()

    # If employee has an existing active or approved session, return it directly!
    if existing_session and not template_session_id:
        # If approved or already submitted, do not let them re-interview
        if existing_session.status in ("approved", "sent_to_manager", "sent_to_hr"):
            return {
                "id": str(existing_session.id),
                "status": existing_session.status,
                "employee_id": existing_session.employee_id,
            }

    if template_session_id:
        try:
            template_uuid = uuid.UUID(template_session_id)
            template_res = await db.execute(
                select(JDSession).where(JDSession.id == template_uuid)
            )
            template_session = template_res.scalar_one_or_none()
            if template_session:
                # Check if this employee already has any JD session (approved or not)
                existing_res = await db.execute(
                    select(JDSession)
                    .where(JDSession.employee_id == request.employee_id)
                    .order_by(JDSession.updated_at.desc())
                )
                existing_session = existing_res.scalars().first()
                if existing_session:
                    return {
                        "id": str(existing_session.id),
                        "status": existing_session.status,
                        "employee_id": existing_session.employee_id
                    }

                # Otherwise, create a pre-approved copy of the standardized JD session
                new_id = str(uuid.uuid4())
                new_session = JDSession(
                    id=uuid.UUID(new_id),
                    employee_id=request.employee_id,
                    title=template_session.title,
                    department=template_session.department,
                    jd_text=template_session.jd_text,
                    jd_structured=template_session.jd_structured,
                    insights=template_session.insights,
                    status="approved",
                    version=1,
                )
                db.add(new_session)
                await db.commit()

                await invalidate_pattern("cache:jd_list:*")
                await invalidate_pattern("cache:dept_stats:*")
                await invalidate_pattern("cache:dept_employees:*")

                return {
                    "id": new_id,
                    "status": "approved",
                    "employee_id": request.employee_id
                }
        except Exception as e:
            logger.error(f"Failed to copy template session {template_session_id}: {e}")

    new_id = str(uuid.uuid4())
    memory = SessionMemory()
    memory.id = new_id
    memory.employee_id = request.employee_id
    memory.employee_name = request.employee_name

    starting_insights = {}
    if emp:
        identity_context = {}
        if emp.name and emp.name != "Unknown Employee":
            identity_context["employee_name"] = emp.name
        
        # DO NOT use emp.department or emp.reporting_manager here. 
        # We will get them strictly from the organogram raw SQL query below.

        from sqlalchemy import text

        org_query = text("""
            SELECT designation, department, location, date_of_joining, joblevel, reporting_manager
            FROM organogram
            WHERE code = :code
        """)
        org_res = await db.execute(org_query, {"code": request.employee_id})
        org_row = org_res.mappings().first()
        
        if org_row:
            if org_row.get("designation"):
                identity_context["title"] = org_row["designation"]
            if org_row.get("department"):
                identity_context["department"] = org_row["department"]
            if org_row.get("reporting_manager"):
                identity_context["reports_to"] = f"{org_row.get('reporting_manager')} (Unknown Code)"
            if org_row.get("location"):
                identity_context["location"] = org_row["location"]
            if org_row.get("date_of_joining"):
                identity_context["date_of_joining"] = str(org_row["date_of_joining"])
            if org_row.get("joblevel"):
                identity_context["job_level"] = org_row["joblevel"]
        elif emp.role:
            identity_context["title"] = emp.role

        if identity_context:
            starting_insights["identity_context"] = identity_context

    memory.insights = starting_insights

    await sync_session_to_db(
        db=db,
        session_id=new_id,
        insights=starting_insights,
        progress=memory.to_dict(),
        conversation_history=[],
        employee_id=request.employee_id,
        employee_name=request.employee_name,
    )

    await invalidate_pattern("cache:jd_list:*")
    await invalidate_pattern("cache:dept_stats:*")
    await invalidate_pattern("cache:dept_employees:*")

    return {"id": new_id, "status": "collecting", "employee_id": request.employee_id}


# ── Chat ──────────────────────────────────────────────────────────────────────
@router.post("/chat")
async def chat(request: ChatRequest, db: AsyncSession = Depends(get_db)):
    session_id = request.id
    if not session_id:
        raise HTTPException(status_code=400, detail="Missing session id")

    session_memory = await hydrate_session_from_db(session_id, db)

    reply, updated_history = await handle_conversation(
        history=request.history,
        user_message=request.message,
        session_memory=session_memory,
    )

    await sync_session_to_db(
        db=db,
        session_id=session_id,
        insights=session_memory.insights,
        progress=session_memory.to_dict(),  # Persistence: Sync full state
        conversation_history=session_memory.full_history,
        employee_id=session_memory.employee_id or "",
        employee_name=session_memory.employee_name,
        generated_jd=session_memory.generated_jd,
        jd_structured=session_memory.jd_structured,
        # pyrefly: ignore [bad-argument-type]
        status=session_memory.progress.get("status"),
    )

    await invalidate_pattern(f"cache:jd_detail:*{session_id}*")
    await _cache_session(session_memory)

    return {"reply": reply, "history": updated_history}


@router.post("/chat/stream")
async def chat_stream(request: ChatRequest, db: AsyncSession = Depends(get_db)):
    session_id = request.id
    if not session_id:
        raise HTTPException(status_code=400, detail="Missing session id")

    session_memory = await hydrate_session_from_db(session_id, db)

    async def event_generator():
        try:
            async for chunk in handle_conversation_stream(
                history=request.history,
                user_message=request.message,
                session_memory=session_memory,
            ):
                yield chunk

            await sync_session_to_db(
                db=db,
                session_id=session_id,
                insights=session_memory.insights,
                progress=session_memory.to_dict(),  # Persistence: Sync full state
                conversation_history=session_memory.full_history,
                employee_id=session_memory.employee_id or "",
                employee_name=session_memory.employee_name,
                generated_jd=session_memory.generated_jd,
                jd_structured=session_memory.jd_structured,
                # pyrefly: ignore [bad-argument-type]
                status=session_memory.progress.get("status"),
            )
            await invalidate_pattern(f"cache:jd_detail:*{session_id}*")
            await _cache_session(session_memory)
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


# ── Generate JD ───────────────────────────────────────────────────────────────
@router.post("/generate")
async def generate_jd_endpoint(
    request: GenerateJDRequest, db: AsyncSession = Depends(get_db)
):
    session_id = request.id
    if not session_id:
        raise HTTPException(status_code=400, detail="Missing session id")

    session_memory = await hydrate_session_from_db(session_id, db)

    if not session_memory.insights:
        raise HTTPException(
            status_code=400,
            detail="No insights collected yet. Complete the interview first.",
        )

    try:
        result = await handle_jd_generation(session_memory)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        import traceback

        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"JD generation failed: {str(e)}")

    await sync_session_to_db(
        db=db,
        session_id=session_id,
        insights=session_memory.insights,
        progress=session_memory.to_dict(),
        conversation_history=session_memory.full_history,
        employee_id=session_memory.employee_id or "",
        employee_name=session_memory.employee_name,
        generated_jd=result["jd_text"],
        jd_structured=result["jd_structured"],
        status="jd_generated",
    )

    await invalidate_pattern(f"cache:jd_detail:*{session_id}*")
    await invalidate_pattern(f"session:{session_id}")
    await _cache_session(session_memory)

    return {
        "id": session_id,
        "jd_text": result["jd_text"],
        "jd_structured": result["jd_structured"],
        "status": "jd_generated",
    }


# ── Save ──────────────────────────────────────────────────────────────────────
@router.post("/save")
async def save_jd(request: SaveJDRequest, db: AsyncSession = Depends(get_db)):
    session_id = request.id

    session_memory = await hydrate_session_from_db(session_id, db)
    if not session_memory.insights:
        raise HTTPException(
            status_code=404,
            detail="Session not found. Please complete the interview first.",
        )

    db_history = [
        {"role": m["role"], "content": m["content"]}
        for m in (session_memory.full_history or [])
    ]

    # Update local session memory object to keep it consistent
    session_memory.generated_jd = request.jd_text
    session_memory.jd_structured = request.jd_structured
    session_memory.progress["status"] = "jd_generated"

    # ── Stamp job_level and location from organogram into jd_structured so PDF always renders them ──
    jd_structured_with_level = dict(request.jd_structured or {})
    needs_level = not jd_structured_with_level.get("job_level") and not jd_structured_with_level.get("joblevel")
    needs_location = not jd_structured_with_level.get("location")
    if (needs_level or needs_location) and (request.employee_id or session_memory.employee_id):
        try:
            from sqlalchemy import text as _text
            emp_id = request.employee_id or session_memory.employee_id or ""
            if emp_id:
                fields = []
                if needs_level:
                    fields.append("joblevel")
                if needs_location:
                    fields.append("location")
                query_str = f"SELECT {', '.join(fields)} FROM organogram WHERE code = :code"
                lv_res = await db.execute(_text(query_str), {"code": emp_id})
                lv_row = lv_res.mappings().first()
                if lv_row:
                    if "employee_information" not in jd_structured_with_level or not isinstance(jd_structured_with_level["employee_information"], dict):
                        jd_structured_with_level["employee_information"] = {}
                    if needs_level and lv_row.get("joblevel"):
                        jd_structured_with_level["job_level"] = lv_row["joblevel"]
                        jd_structured_with_level["employee_information"]["job_level"] = lv_row["joblevel"]
                    if needs_location and lv_row.get("location"):
                        jd_structured_with_level["location"] = lv_row["location"]
                        jd_structured_with_level["employee_information"]["location"] = lv_row["location"]
        except Exception as _e:
            logger.warning(f"Could not stamp organogram fields into jd_structured: {_e}")

    # Preserve status if document is already submitted or approved
    target_status = "jd_generated"
    existing_record = await get_questionnaire(db, session_id)
    if existing_record and existing_record.status in ("sent_to_manager", "sent_to_hr", "approved", "manager_rejected", "hr_rejected"):
        target_status = existing_record.status

    try:
        record = await save_questionnaire_jd(
            db=db,
            session_id=session_id,
            jd_text=request.jd_text,
            jd_structured=jd_structured_with_level,
            employee_insights=session_memory.insights,
            progress=session_memory.to_dict(),
            employee_id=request.employee_id or session_memory.employee_id or "",
            conversation_history=db_history,
            status=target_status,
        )

        await invalidate_pattern("cache:jd_list:*")
        await invalidate_pattern("cache:manager_pending:*")
        await invalidate_pattern("cache:hr_pending:*")
        await invalidate_pattern("cache:dept_stats:*")
        await invalidate_pattern(f"cache:jd_detail:*{session_id}*")
        await invalidate_pattern(f"session:{session_id}")
        await _cache_session(session_memory)

        return {
            "status": "success",
            "id": str(record.id),
            "employee_id": record.employee_id,
            "title": record.title,
            "message": "JD saved successfully to database.",
        }
    except Exception as e:
        import traceback

        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Failed to save JD: {str(e)}")


@router.post("/{jd_id}/confirm-skills")
async def confirm_skills(
    jd_id: str, request: ConfirmSkillsRequest, db: AsyncSession = Depends(get_db)
):
    session_memory = await hydrate_session_from_db(jd_id, db)
    if not session_memory.insights:
        raise HTTPException(status_code=404, detail="Session not found")

    from app.agents.skill_agent import standardize_skills
    std_skills = await standardize_skills(db, request.skills)

    # Update insights with confirmed skills
    session_memory.insights["skills"] = std_skills
    session_memory.insights["skills_confirmed"] = True

    # Do NOT hardcode status; let the router/sync logic recalculate it
    await sync_session_to_db(
        db=db,
        session_id=jd_id,
        insights=session_memory.insights,
        progress=session_memory.to_dict(),
        conversation_history=session_memory.full_history,
        employee_id=session_memory.employee_id or "",
    )
    await invalidate_pattern(f"cache:jd_detail:*{jd_id}*")
    await _cache_session(session_memory)

    return {"status": "success", "message": "Skills confirmed and stored."}


@router.post("/{jd_id}/confirm-tools")
async def confirm_tools(
    jd_id: str, request: ConfirmToolsRequest, db: AsyncSession = Depends(get_db)
):
    session_memory = await hydrate_session_from_db(jd_id, db)
    if not session_memory.insights:
        raise HTTPException(status_code=404, detail="Session not found")

    from app.agents.tool_agent import standardize_tools
    std_tools = await standardize_tools(db, request.tools)

    # Update insights with confirmed tools
    session_memory.insights["tools"] = std_tools
    session_memory.insights["tools_confirmed"] = True

    await sync_session_to_db(
        db=db,
        session_id=jd_id,
        insights=session_memory.insights,
        progress=session_memory.to_dict(),
        conversation_history=session_memory.full_history,
        employee_id=session_memory.employee_id or "",
    )
    await invalidate_pattern(f"cache:jd_detail:*{jd_id}*")
    await _cache_session(session_memory)

    return {"status": "success", "message": "Tools confirmed and stored."}


@router.post("/{jd_id}/confirm-priority-tasks")
async def confirm_priority_tasks(
    jd_id: str, request: ConfirmPriorityTasksRequest, db: AsyncSession = Depends(get_db)
):
    session_memory = await hydrate_session_from_db(jd_id, db)
    if not session_memory.insights:
        raise HTTPException(status_code=404, detail="Session not found")

    # Save priority tasks directly into insights so WorkflowIdentifierAgent criteria is met
    existing = set(session_memory.insights.get("priority_tasks", []))
    for pt in request.priority_tasks:
        existing.add(pt)
    final_priorities = list(existing)
    session_memory.insights["priority_tasks"] = final_priorities

    # Pre-initialize Deep Dive active task to prevent "silent" phase hangs
    if final_priorities and not session_memory.insights.get("active_deep_dive_task"):
        session_memory.insights["active_deep_dive_task"] = final_priorities[0]
        session_memory.insights["deep_dive_turn_count"] = 1
        logger.info(f"[Routes] Initialized Deep Dive with task: {final_priorities[0]}")

    await sync_session_to_db(
        db=db,
        session_id=jd_id,
        insights=session_memory.insights,
        progress=session_memory.to_dict(),
        conversation_history=session_memory.full_history,
        employee_id=session_memory.employee_id or "",
    )
    await invalidate_pattern(f"cache:jd_detail:*{jd_id}*")
    await _cache_session(session_memory)

    return {
        "status": "success",
        "message": "Priority tasks saved.",
        "priority_tasks": list(existing),
    }


@router.get("/")
def health_check():
    return {"status": "ok"}


async def _attach_kra_kpi_status(db: AsyncSession, records: list) -> None:
    if not records:
        return
    # Filter out dicts
    session_ids = [str(r.id) for r in records if not isinstance(r, dict)]
    if not session_ids:
        return
    from app.models.kra_kpi_model import KRAKPISession, UploadedKRAKPI
    from sqlalchemy import select
    result = await db.execute(
        select(KRAKPISession.jd_session_id, KRAKPISession.status)
        .where(KRAKPISession.jd_session_id.in_(session_ids))
    )
    kra_statuses = {row[0]: row[1] for row in result.all()}

    # Also check uploaded_kra_kpis for employee IDs
    emp_ids = [r.employee_id for r in records if not isinstance(r, dict) and getattr(r, "employee_id", None)]
    uploaded_emp_ids = set()
    if emp_ids:
        up_res = await db.execute(
            select(UploadedKRAKPI.employee_id)
            .where(UploadedKRAKPI.employee_id.in_(emp_ids))
        )
        uploaded_emp_ids = {row[0] for row in up_res.all()}

    for r in records:
        if not isinstance(r, dict):
            status_val = kra_statuses.get(str(r.id))
            if not status_val and getattr(r, "employee_id", None) in uploaded_emp_ids:
                status_val = "approved"
            r.kra_kpi_status = status_val


# ── List all (admin) ──────────────────────────────────────────────────────────
# backend/app/routers/jd_routes.py


async def fetch_employee_names(db: AsyncSession, emp_ids: list) -> dict:
    """Helper to bulk-fetch employee names from the organogram table."""
    if not emp_ids:
        return {}

    # Sanitize IDs for SQL query
    clean_ids = [str(eid).replace("'", "''") for eid in emp_ids if eid]
    if not clean_ids:
        return {}

    formatted_ids = "','".join(clean_ids)
    query = text(
        f"SELECT code, employee_name FROM organogram WHERE code IN ('{formatted_ids}')"
    )

    result = await db.execute(query)
    # Return as a dictionary: { 'E10696': 'Mahesh Kumar', ... }
    return {row[0]: row[1] for row in result.fetchall()}


# ── YOUR EXACT CODE GOES HERE ──
@router.get("/list")
async def list_jds(submitted_only: bool = False, db: AsyncSession = Depends(get_db)):
    status_filter = (
        ["sent_to_manager", "manager_rejected", "sent_to_hr", "hr_rejected", "approved"]
        if submitted_only
        else None
    )
    records = await list_questionnaires(db, status_in=status_filter)
    await _attach_kra_kpi_status(db, records)

    # --- FIX: Bulk fetch employee names safely ---
    emp_ids = []
    for r in records:
        eid = (
            r.get("employee_id")
            if isinstance(r, dict)
            else getattr(r, "employee_id", None)
        )
        if eid:
            emp_ids.append(eid)

    emp_map = await fetch_employee_names(db, emp_ids)

    result = []
    for r in records:
        data = _serialize_list_item(r)
        eid = data.get("employee_id")
        if not data.get("employee_name") and eid in emp_map:
            data["employee_name"] = emp_map[eid]
        result.append(data)

    return result


@router.get("/employee/{employee_id}/role-template")
async def get_employee_role_template(
    employee_id: str, db: AsyncSession = Depends(get_db)
):
    """
    Check if there is an approved JD (template) for the employee's role/designation in their department.
    If one exists, return it, so the employee can instantly view/download it without creating a new session.
    """
    from app.models.user_model import Employee
    from app.models.jd_session_model import JDSession
    from app.models.reference_jd_model import ReferenceJD
    from sqlalchemy.future import select
    from sqlalchemy import text, func

    # 1. Fetch employee record
    emp_result = await db.execute(select(Employee).filter(Employee.id == employee_id))
    emp = emp_result.scalars().first()
    if not emp:
        return {"exists": False, "message": "Employee not found"}

    # 2. Extract department and designation from Organogram (Primary Source)
    org_query = text("""
        SELECT designation, department
        FROM organogram
        WHERE code = :code
    """)
    org_res = await db.execute(org_query, {"code": employee_id})
    org_row = org_res.mappings().first()

    raw_designation = None
    raw_department = None

    if org_row:
        raw_designation = org_row.get("designation")
        raw_department = org_row.get("department")

    if not raw_designation:
        emp_role = getattr(emp, "role", None)
        raw_designation = emp_role() if callable(emp_role) else emp_role

    if not raw_department:
        emp_dept = getattr(emp, "department", None)
        raw_department = emp_dept() if callable(emp_dept) else emp_dept

    if isinstance(raw_designation, property):
        raw_designation = None
    if isinstance(raw_department, property):
        raw_department = None

    if not raw_department or not raw_designation:
        return {
            "exists": False,
            "message": "Employee lacks department or designation details",
        }

    dept_str = str(raw_department).strip().lower()
    desig_str = str(raw_designation).strip().lower()

    # ─── NEW CHECK: Does this employee already have ANY JD session? ───
    # If they have a draft, collecting, or pending JD, we should NOT auto-clone a template.
    existing_any_jd_query = select(JDSession).where(JDSession.employee_id == employee_id)
    res_any_jd = await db.execute(existing_any_jd_query)
    if res_any_jd.scalars().first() is not None:
        # They already have a JD in some state. Let them finish it.
        return {
            "exists": False,
            "message": "Employee already has an active JD session."
        }
    # 3. Step A: Check if THIS specific employee has an approved JDSession with content
    emp_session_query = (
        select(JDSession)
        .where(
            JDSession.employee_id == employee_id,
            JDSession.status == "approved",
            (JDSession.jd_text.isnot(None)) | (JDSession.jd_structured.isnot(None)),
        )
        .order_by(JDSession.updated_at.desc())
    )
    res_emp = await db.execute(emp_session_query)
    emp_approved = res_emp.scalars().first()

    if emp_approved:
        return {
            "exists": True,
            "id": str(emp_approved.id),
            "title": emp_approved.title,
            "department": emp_approved.department,
            "jd_text": emp_approved.jd_text,
            "jd_structured": emp_approved.jd_structured,
            "version": emp_approved.version,
            "updated_at": (
                emp_approved.updated_at.isoformat() if emp_approved.updated_at else None
            ),
        }

    # Step B: Check ReferenceJD for this specific employee_id (Admin Uploaded or Approved)
    ref_emp_query = select(ReferenceJD).where(
        ReferenceJD.employee_id == employee_id,
        ReferenceJD.is_active == True,
        ReferenceJD.processing_status == "published",
    ).order_by(ReferenceJD.uploaded_at.desc())
    res_ref_emp = await db.execute(ref_emp_query)
    ref_emp = res_ref_emp.scalars().first()
    if ref_emp:
        struct_data = dict(ref_emp.structured_data or {})
        has_struct = bool(struct_data and len(struct_data.keys()) > 0)
        if has_struct and ref_emp.role_title != "Approved Role JD":
            return {
                "exists": True,
                "id": str(ref_emp.id),
                "title": ref_emp.role_title or str(raw_designation),
                "department": ref_emp.department or str(raw_department),
                "jd_text": struct_data.get("purpose", "")
                or struct_data.get("role_summary", ""),
                "jd_structured": struct_data,
                "version": 1,
                "updated_at": (
                    ref_emp.uploaded_at.isoformat() if ref_emp.uploaded_at else None
                ),
            }

    # Step C: Fallback to SAME DEPARTMENT + SAME ROLE matching
    dept_session_query = (
        select(JDSession)
        .where(
            func.trim(func.lower(JDSession.department)) == dept_str,
            func.trim(func.lower(JDSession.title)) == desig_str,
            JDSession.status == "approved",
            (JDSession.jd_text.isnot(None)) | (JDSession.jd_structured.isnot(None)),
        )
        .order_by(JDSession.updated_at.desc())
    )
    res_dept = await db.execute(dept_session_query)
    dept_approved = res_dept.scalars().first()

    if dept_approved:
        # ─── FIX: Strictly check if the JD actually has meaningful content ───
        has_text = dept_approved.jd_text and len(str(dept_approved.jd_text).strip()) > 0
        has_struct = (
            dept_approved.jd_structured and len(dept_approved.jd_structured.keys()) > 0
        )

        if not has_text and not has_struct:
            logger.warning(
                f"Source JD {dept_approved.id} is empty. Skipping auto-clone."
            )
        else:
            import uuid

            new_session_id = uuid.uuid4()
            cloned_session = JDSession(
                id=new_session_id,
                employee_id=employee_id,
                title=dept_approved.title or str(raw_designation),
                department=dept_approved.department or str(raw_department),
                jd_text=dept_approved.jd_text,
                jd_structured=dept_approved.jd_structured,
                status="approved",
                version=1,
                conversation_state={"template_copied_from": str(dept_approved.id)},
            )
            db.add(cloned_session)
            await db.commit()
            await db.refresh(cloned_session)

            from app.core.redis_client import invalidate_pattern

            await invalidate_pattern(f"jds:employee:{employee_id}")

            return {
                "exists": True,
                "id": str(cloned_session.id),
                "title": cloned_session.title,
                "department": cloned_session.department,
                "jd_text": cloned_session.jd_text,
                "jd_structured": cloned_session.jd_structured,
                "version": cloned_session.version,
                "updated_at": (
                    cloned_session.updated_at.isoformat()
                    if cloned_session.updated_at
                    else None
                ),
            }

    # Step D: Check ReferenceJD by department and title
    # FIX: Use `text` instead of `_text`
    ref_dept_query = select(ReferenceJD).where(
        func.trim(func.lower(text("reference_jds.department"))) == dept_str,
        func.trim(func.lower(text("reference_jds.role_title"))) == desig_str,
    )

    res_ref_dept = await db.execute(ref_dept_query)
    ref_dept = res_ref_dept.scalars().first()
    if ref_dept:
        struct_data = dict(ref_dept.structured_data or {})

        # ─── FIX: Strictly check if the Reference JD actually has meaningful content ───
        has_struct = struct_data and len(struct_data.keys()) > 0

        if not has_struct:
            logger.warning(f"Reference JD {ref_dept.id} is empty. Skipping clone.")
        else:
            import uuid

            new_session_id = uuid.uuid4()
            cloned_session = JDSession(
                id=new_session_id,
                employee_id=employee_id,
                title=ref_dept.role_title or str(raw_designation),
                department=ref_dept.department or str(raw_department),
                jd_text=struct_data.get("purpose", "")
                or struct_data.get("role_summary", ""),
                jd_structured=struct_data,
                status="approved",
                version=1,
                conversation_state={"template_copied_from_ref": str(ref_dept.id)},
            )
            db.add(cloned_session)
            await db.commit()
            await db.refresh(cloned_session)

            from app.core.redis_client import invalidate_pattern

            await invalidate_pattern(f"jds:employee:{employee_id}")

            return {
                "exists": True,
                "id": str(cloned_session.id),
                "title": cloned_session.title,
                "department": cloned_session.department,
                "jd_text": cloned_session.jd_text,
                "jd_structured": cloned_session.jd_structured,
                "version": 1,
                "updated_at": (
                    cloned_session.updated_at.isoformat()
                    if cloned_session.updated_at
                    else None
                ),
            }

    # FIX: THE MISSING RETURN STATEMENT!
    return {
        "exists": False,
        "message": "No approved standard JD found for this role and department",
    }


# ── List by employee ──────────────────────────────────────────────────────────
@router.get("/employee/{employee_id}")
async def get_employee_jds(employee_id: str, db: AsyncSession = Depends(get_db)):
    records = await list_questionnaires_by_employee(db, employee_id)
    # records might be already serialised or raw objects
    if records and isinstance(records[0], dict):
        return records
    return [_serialize_list_item(r) for r in records]


# ── List pending for Manager ──────────────────────────────────────────────────
@router.get("/manager/{manager_id}/pending")
async def get_manager_pending_jds(manager_id: str, db: AsyncSession = Depends(get_db)):
    records = await list_manager_pending_jds(db, manager_id)
    await _attach_kra_kpi_status(db, records)

    # --- FIX: Bulk fetch employee names safely ---
    emp_ids = []
    for r in records:
        eid = (
            r.get("employee_id")
            if isinstance(r, dict)
            else getattr(r, "employee_id", None)
        )
        if eid:
            emp_ids.append(eid)

    emp_map = await fetch_employee_names(db, emp_ids)

    result = []
    for r in records:
        data = _serialize_list_item(r)
        eid = data.get("employee_id")
        if not data.get("employee_name") and eid in emp_map:
            data["employee_name"] = emp_map[eid]
        result.append(data)

    return result


# ── List pending for HR ───────────────────────────────────────────────────────
@router.get("/hr/pending")
async def get_hr_pending_jds(db: AsyncSession = Depends(get_db)):
    records = await list_hr_pending_jds(db)
    await _attach_kra_kpi_status(db, records)

    # --- FIX: Bulk fetch employee names safely ---
    emp_ids = []
    for r in records:
        eid = (
            r.get("employee_id")
            if isinstance(r, dict)
            else getattr(r, "employee_id", None)
        )
        if eid:
            emp_ids.append(eid)

    emp_map = await fetch_employee_names(db, emp_ids)

    result = []
    for r in records:
        data = _serialize_list_item(r)
        eid = data.get("employee_id")
        if not data.get("employee_name") and eid in emp_map:
            data["employee_name"] = emp_map[eid]
        result.append(data)

    return result


# ── Feedback (must be before /{jd_id} to avoid route conflict) ────────────────


@router.get("/feedback/{employee_id}")
async def get_user_feedback(
    employee_id: str, role: str = "employee", db: AsyncSession = Depends(get_db)
):
    try:
        feedback = await get_unread_feedback_for_user(db, employee_id, role)
        return feedback
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to fetch feedback: {str(e)}"
        )


@router.get("/feedback/all/{employee_id}")
async def get_all_user_feedback(
    employee_id: str, role: str = "employee", db: AsyncSession = Depends(get_db)
):
    try:
        feedback = await get_all_feedback_for_user(db, employee_id, role)
        return feedback
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to fetch all feedback: {str(e)}"
        )


@router.patch("/feedback/{comment_id}/read")
async def mark_read(comment_id: str, db: AsyncSession = Depends(get_db)):
    try:
        success = await mark_feedback_read(db, comment_id)
        if not success:
            raise HTTPException(status_code=404, detail="Comment not found")
        return {"status": "success", "message": "Feedback marked as read"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to mark feedback: {str(e)}"
        )


# ── Download JD as DOCX (only download format — PDF is now client-side) ──────
@router.get("/{jd_id}/download/docx/{filename}")
@router.get("/{jd_id}/download")
async def download_jd_docx(
    jd_id: str, filename: str | None = None, db: AsyncSession = Depends(get_db)
):
    """Generate and stream a Pulse Pharma branded DOCX file for the given JD."""
    record = await get_questionnaire(db, jd_id)
    if not record:
        raise HTTPException(status_code=404, detail="JD not found")

    if not record.jd_structured:
        raise HTTPException(
            status_code=400,
            detail="No generated JD available for download. Please generate a JD first.",
        )

    from app.services.kra_kpi_service import get_kra_kpi_by_jd_session
    kra_kpi_rec = await get_kra_kpi_by_jd_session(db, jd_id)
    kra_kpi_data = None
    if kra_kpi_rec and (kra_kpi_rec.generation_step == "confirmed" or kra_kpi_rec.status in ("confirmed", "sent_to_manager", "sent_to_hr", "approved")):
        kra_kpi_data = kra_kpi_rec.kras

    docx_buffer = generate_jd_docx(
        # pyrefly: ignore [bad-argument-type]
        jd_data=record.jd_structured,
        # pyrefly: ignore [bad-argument-type]
        title=record.title or "Untitled JD",
        # pyrefly: ignore [bad-argument-type]
        department=record.department or "",
        kra_kpi_data=kra_kpi_data,
    )

    title = record.title or "Job Description"
    dept = record.department or ""
    
    from sqlalchemy.future import select
    from app.models.user_model import Employee
    emp_res = await db.execute(select(Employee).where(Employee.id == record.employee_id))
    employee_obj = emp_res.scalar_one_or_none()
    emp_name = employee_obj.name if employee_obj else None
    
    if not emp_name and record.jd_structured:
        emp_name = record.jd_structured.get("employee_information", {}).get("employee_name")
    
    if emp_name and str(emp_name).strip() and str(emp_name).strip().lower() != "employee":
        safe_filename = f"{emp_name.strip()} - {title} - JD.docx"
    elif dept and str(dept).strip():
        safe_filename = f"{title} - {dept} - JD.docx"
    else:
        safe_filename = f"{title} - JD.docx"

    safe_filename = re.sub(r'[<>:"/\\|?*]', "", safe_filename)

    # Use a plain Response with explicit Content-Length.
    # We force 'identity' encoding to prevent GZipMiddleware from compressing
    # the already-compressed docx file, which can lead to browser corruption.
    content = docx_buffer.getvalue()
    return Response(
        content=content,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={
            "Content-Disposition": f'attachment; filename="{safe_filename}"',
            "Content-Encoding": "identity",
            "Access-Control-Expose-Headers": "Content-Disposition",
        },
    )


@router.get("/{jd_id}/download/darwinbox")
async def download_jd_darwinbox_csv(jd_id: str, db: AsyncSession = Depends(get_db)):
    """Generate and stream a Darwinbox-compatible CSV file for the employee's JD."""
    import io
    from fastapi import Response
    from app.services.darwinbox_jd_exporter_service import generate_darwinbox_jd_csv
    try:
        csv_content = await generate_darwinbox_jd_csv(db, jd_id)
        
        # Query employee name to create a safe, recognizable filename
        record = await get_questionnaire(db, jd_id)
        emp_name = None
        if record:
            from sqlalchemy.future import select
            from app.models.user_model import Employee
            emp_res = await db.execute(select(Employee).where(Employee.id == record.employee_id))
            employee_obj = emp_res.scalar_one_or_none()
            emp_name = employee_obj.name if employee_obj else None
            if not emp_name and record.jd_structured:
                emp_name = record.jd_structured.get("employee_information", {}).get("employee_name")
        
        title = record.title or "Job Description" if record else "Job Description"
        prefix = f"{emp_name.strip()} - {title}" if emp_name else title
        prefix = re.sub(r'[<>:"/\\|?*]', "", prefix)
        filename = f"{prefix} - Darwinbox JD.csv"
        
        return Response(
            content=csv_content,
            media_type="text/csv",
            headers={
                "Content-Disposition": f'attachment; filename="{filename}"',
                "Access-Control-Expose-Headers": "Content-Disposition",
            }
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to generate Darwinbox JD CSV: {e}")
        raise HTTPException(status_code=500, detail="Internal server error while exporting CSV.")


@router.get("/{jd_id}")
async def get_jd(jd_id: str, db: AsyncSession = Depends(get_db)):
    record = await get_questionnaire(db, jd_id)
    if not record:
        # Fallback to checking reference_jds table for Admin-uploaded JDs
        try:
            from app.models.reference_jd_model import ReferenceJD
            from sqlalchemy.future import select as _select
            ref_res = await db.execute(_select(ReferenceJD).where(ReferenceJD.id == jd_id))
            ref_rec = ref_res.scalar_one_or_none()
            if ref_rec:
                struct_data = dict(ref_rec.structured_data or {})
                return {
                    "id": str(ref_rec.id),
                    "employee_id": ref_rec.employee_id or "",
                    "employee_name": ref_rec.employee_name or "Employee",
                    "title": ref_rec.role_title or "Approved Role JD",
                    "status": "approved",
                    "kra_kpi_status": "approved",
                    "version": 1,
                    "jd_text": struct_data.get("purpose", "") or struct_data.get("role_summary", ""),
                    "jd_structured": struct_data,
                    "created_at": ref_rec.uploaded_at.isoformat() if ref_rec.uploaded_at else None,
                    "updated_at": ref_rec.uploaded_at.isoformat() if ref_rec.uploaded_at else None,
                    "history": [],
                }
        except Exception as _e:
            logger.warning(f"Failed reference_jds fallback lookup for {jd_id}: {_e}")
        raise HTTPException(status_code=404, detail="JD not found")
    
    from app.models.user_model import Employee
    from sqlalchemy.future import select
    emp_result = await db.execute(select(Employee).where(Employee.id == record.employee_id))
    emp_record = emp_result.scalar_one_or_none()
    employee_name = emp_record.name if emp_record else "Unknown Employee"

    # ── Stamp job_level, location, responsibilities, education if missing ──
    jd_structured = dict(record.jd_structured or {})
    needs_level = not jd_structured.get("job_level") and not jd_structured.get("joblevel")
    needs_location = not jd_structured.get("location")
    if (needs_level or needs_location) and record.employee_id:
        try:
            from sqlalchemy import text as _text
            fields = []
            if needs_level:
                fields.append("joblevel")
            if needs_location:
                fields.append("location")
            query_str = f"SELECT {', '.join(fields)} FROM organogram WHERE code = :code"
            lv_res = await db.execute(_text(query_str), {"code": record.employee_id})
            lv_row = lv_res.mappings().first()
            if lv_row:
                if "employee_information" not in jd_structured or not isinstance(jd_structured["employee_information"], dict):
                    jd_structured["employee_information"] = {}
                if needs_level and lv_row.get("joblevel"):
                    jd_structured["job_level"] = lv_row["joblevel"]
                    jd_structured["employee_information"]["job_level"] = lv_row["joblevel"]
                if needs_location and lv_row.get("location"):
                    jd_structured["location"] = lv_row["location"]
                    jd_structured["employee_information"]["location"] = lv_row["location"]
        except Exception as _e:
            logger.warning(f"Could not stamp organogram fields in GET /{jd_id}: {_e}")

    # Backfill responsibilities from insights if empty
    curr_resp = jd_structured.get("responsibilities") or jd_structured.get("key_responsibilities") or []
    if not curr_resp and record.insights and isinstance(record.insights, dict):
        extracted_wf = record.insights.get("extracted_workflows") or {}
        derived_resp = []
        if isinstance(extracted_wf, dict):
            for t_name, wf in extracted_wf.items():
                if isinstance(wf, dict):
                    steps = wf.get("steps") or []
                    if steps:
                        derived_resp.append(f"{t_name}: {', '.join(steps)}")
                    else:
                        derived_resp.append(str(t_name))
        if derived_resp:
            jd_structured["responsibilities"] = derived_resp

    # Backfill education & experience if missing
    if not jd_structured.get("education") and record.insights:
        edu_val = record.insights.get("identity_context", {}).get("education") or record.insights.get("education")
        if edu_val:
            jd_structured["education"] = str(edu_val)

    if not jd_structured.get("experience") and record.insights:
        exp_val = record.insights.get("identity_context", {}).get("experience") or record.insights.get("experience")
        if exp_val:
            jd_structured["experience"] = str(exp_val)

    history = [
        {"role": t.role, "content": t.content}
        for t in (record.conversation_turns or [])
    ]

    from app.models.kra_kpi_model import KRAKPISession
    kra_res = await db.execute(
        select(KRAKPISession.status).where(KRAKPISession.jd_session_id == str(record.id))
    )
    kra_kpi_status = kra_res.scalars().first()

    return {
        "id": str(record.id),
        "employee_id": record.employee_id,
        "employee_name": employee_name,
        "reporting_manager_code": emp_record.reporting_manager_code if emp_record else None,
        "title": record.title,
        "status": record.status,
        "kra_kpi_status": kra_kpi_status,
        "version": record.version,
        "generated_jd": record.jd_text,
        "jd_structured": jd_structured,
        "responses": record.insights,
        "conversation_history": history,
        "conversation_state": record.conversation_state,
        "created_at": record.created_at,
        "updated_at": record.updated_at,
    }


# ── Conversation history only ─────────────────────────────────────────────────
@router.get("/{jd_id}/conversation")
async def get_jd_conversation(jd_id: str, db: AsyncSession = Depends(get_db)):
    record = await get_questionnaire(db, jd_id)
    if not record:
        raise HTTPException(status_code=404, detail="JD not found")
    history = [
        {"role": t.role, "content": t.content}
        for t in (record.conversation_turns or [])
    ]
    return {
        "id": str(record.id),
        "title": record.title,
        "status": record.status,
        "conversation_history": history,
        "conversation_state": record.conversation_state,
    }


# ── Update JD content ─────────────────────────────────────────────────────────
@router.put("/{jd_id}")
async def update_jd(
    jd_id: str, request: UpdateJDRequest, db: AsyncSession = Depends(get_db)
):
    try:
        record = await update_questionnaire_jd(
            db=db,
            jd_id=jd_id,
            jd_text=request.jd_text,
            jd_structured=request.jd_structured,
            employee_id=request.employee_id,
        )
        if not record:
            raise HTTPException(status_code=404, detail="JD not found")

        await invalidate_pattern(f"cache:jd_detail:*{jd_id}*")

        return {
            "status": "success",
            "id": str(record.id),
            "version": record.version,
            "updated_at": record.updated_at,
            "message": "JD updated successfully.",
        }
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update JD: {str(e)}")


# ── Update status ─────────────────────────────────────────────────────────────
# backend/app/routers/jd_routes.py


@router.patch("/{jd_id}/status")
async def update_jd_status(
    jd_id: str,
    request: UpdateStatusRequest,
    db: AsyncSession = Depends(get_db),
    current_user: Employee = Depends(get_current_user),
):
    valid_statuses = [
        "collecting",
        "ready_for_generation",
        "draft",
        "sent_to_manager",
        "manager_rejected",
        "sent_to_hr",
        "hr_rejected",
        "approved",
        "jd_generated",
    ]
    if request.status not in valid_statuses:
        raise HTTPException(
            status_code=400, detail=f"Invalid status. Must be one of: {valid_statuses}"
        )

    try:
        from sqlalchemy import text as sql_text

        # 1. Fetch the JD record FIRST
        record = await get_questionnaire(db, jd_id)
        if not record:
            raise HTTPException(status_code=404, detail="JD not found")

        # 2. Check organogram directly for who manages the owner of this JD
        is_manager = False
        org_res = await db.execute(
            sql_text(
                "SELECT reporting_manager_code FROM organogram WHERE LOWER(TRIM(code)) = LOWER(TRIM(:code))"
            ),
            {"code": record.employee_id},
        )
        org_row = org_res.mappings().first()

        if org_row and org_row.get("reporting_manager_code"):
            if (
                str(org_row["reporting_manager_code"]).strip().upper()
                == str(current_user.id).strip().upper()
            ):
                is_manager = True

        # 3. Check recursive reports in organogram (Indirect managers)
        if not is_manager:
            from app.services.dashboard_service import DashboardService

            recursive_reports = await DashboardService.get_recursive_reports(
                db, current_user.id
            )
            if record.employee_id in recursive_reports:
                is_manager = True

        # 4. Check HR privileges (Hardcoded E6679, DB role, or Organogram designation)
        user_role = (current_user.role or "").lower()
        if current_user.id.strip().upper() == "E6679":
            user_role = "hr"

        if user_role not in ["hr", "admin"]:
            org_emp_res = await db.execute(
                sql_text(
                    "SELECT designation FROM organogram WHERE LOWER(TRIM(code)) = LOWER(TRIM(:code))"
                ),
                {"code": current_user.id},
            )
            org_emp_row = org_emp_res.mappings().first()
            if org_emp_row:
                desig = (org_emp_row.get("designation") or "").lower()
                if any(kw in desig for kw in ["hr", "human resource", "admin"]):
                    user_role = "hr"

        is_hr = user_role in ["hr", "admin"]
        is_owner = record.employee_id == current_user.id

        # 5. Final Permission Check
        if not is_hr and not is_owner and not is_manager:
            raise HTTPException(
                status_code=403,
                detail="You can only update status of your own JDs, or JDs submitted to you.",
            )

        # 6. DIRECTLY UPDATE THE DATABASE (Bypassing the buggy CRUD function)
        record.status = request.status

        # Sync status to KRAKPISession if it exists
        from app.models.kra_kpi_model import KRAKPISession

        kra_res = await db.execute(
            select(KRAKPISession).where(KRAKPISession.jd_session_id == str(record.id))
        )
        kra_session = kra_res.scalars().first()
        if kra_session:
            kra_session.status = request.status

        await db.commit()
        await db.refresh(record)
        updated_record = record

        # Invalidate caches
        await invalidate_pattern("cache:jd_list:*")
        await invalidate_pattern("cache:manager_pending:*")
        await invalidate_pattern("cache:hr_pending:*")
        await invalidate_pattern("cache:dept_stats:*")
        await invalidate_pattern("cache:dept_employees:*")
        await invalidate_pattern(f"jds:employee:{record.employee_id}")
        await invalidate_pattern(f"cache:jd_detail:*{jd_id}*")
        await invalidate_pattern(f"session:{jd_id}")

        return {
            "status": "success",
            "id": str(updated_record.id),
            "new_status": updated_record.status,
            "message": f"Status updated to '{updated_record.status}'",
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to update status: {str(e)}"
        )


# ── Delete JD ─────────────────────────────────────────────────────────────────
@router.delete("/{jd_id}")
async def delete_jd(jd_id: str, employee_id: str, db: AsyncSession = Depends(get_db)):
    try:
        success = await delete_questionnaire(
            db=db, jd_id=jd_id, employee_id=employee_id
        )
        if not success:
            raise HTTPException(status_code=404, detail="JD not found")

        await invalidate_pattern("cache:jd_list:*")
        await invalidate_pattern("cache:manager_pending:*")
        await invalidate_pattern("cache:hr_pending:*")
        await invalidate_pattern("cache:dept_stats:*")
        await invalidate_pattern(f"cache:jd_detail:*{jd_id}*")
        await invalidate_pattern(f"session:{jd_id}")

        return {"status": "success", "message": "JD deleted successfully."}
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete JD: {str(e)}")


# ── Review / Feedback ─────────────────────────────────────────────────────────


@router.post("/{jd_id}/review")
async def submit_review(jd_id: str, request: dict, db: AsyncSession = Depends(get_db)):
    action = request.get("action")
    target_role = request.get("target_role", "employee")
    comment = request.get("comment")
    reviewer_id = request.get("reviewer_id")

    if not action or not reviewer_id:
        raise HTTPException(
            status_code=400, detail="action and reviewer_id are required"
        )

    valid_actions = ["rejected", "approved", "revision_requested"]
    if action not in valid_actions:
        raise HTTPException(
            status_code=400, detail=f"Invalid action. Must be one of: {valid_actions}"
        )

    try:
        review = await create_review_comment(
            db=db,
            jd_session_id=jd_id,
            reviewer_id=reviewer_id,
            target_role=target_role,
            action=action,
            comment=comment,
        )

        await invalidate_pattern("cache:jd_list:*")
        await invalidate_pattern("cache:manager_pending:*")
        await invalidate_pattern("cache:hr_pending:*")
        await invalidate_pattern("cache:dept_stats:*")
        await invalidate_pattern(f"cache:jd_detail:*{jd_id}*")

        return {
            "status": "success",
            "id": str(review.id),
            "message": f"Review action '{action}' recorded successfully.",
        }
    except Exception as e:
        import traceback

        traceback.print_exc()
        raise HTTPException(
            status_code=500, detail=f"Failed to create review: {str(e)}"
        )


@router.get("/{jd_id}/reviews")
async def get_reviews(jd_id: str, db: AsyncSession = Depends(get_db)):
    try:
        comments = await get_review_comments_for_jd(db, jd_id)
        return comments
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to fetch reviews: {str(e)}"
        )


# ── Serializer ────────────────────────────────────────────────────────────────
def _resolve_session_title(r) -> str:
    title_str = getattr(r, "title", None)
    if title_str and str(title_str).strip():
        t = str(title_str).strip()
        if t.lower() not in ("head", "executive", "none", "job description", "untitled role") and not t.startswith("Untitled"):
            return t

    struct = getattr(r, "jd_structured", None)
    if struct and isinstance(struct, dict):
        emp_info = struct.get("employee_information") or {}
        t = emp_info.get("title") or struct.get("title") or struct.get("job_title") or struct.get("role_title")
        if t and str(t).strip() and str(t).strip().lower() not in ("head", "executive", "none", "job description"):
            return str(t).strip()

    if title_str and str(title_str).strip():
        return str(title_str).strip()

    return "Job Description"


def _serialize_list_item(r) -> dict:
    if isinstance(r, dict):
        return r
    employee = r.__dict__.get("employee")
    return {
        "id": str(r.id),
        "employee_id": r.employee_id,
        "employee_name": employee.name if employee else None,
        "department": r.department or (employee.department if employee else None),
        "title": _resolve_session_title(r),
        "status": r.status,
        "kra_kpi_status": getattr(r, "kra_kpi_status", None),
        "version": r.version,
        "created_at": r.created_at,
        "updated_at": r.updated_at,
    }
