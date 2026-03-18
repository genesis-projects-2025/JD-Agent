from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
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
)
from app.services.jd_service import (
    handle_conversation,
    handle_conversation_stream,
    handle_jd_generation,
)
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
from app.core.cache import cached_response, invalidate_pattern
from app.services.docx_generator import generate_jd_docx

logger = logging.getLogger(__name__)

router = APIRouter()

# ── Session Management (Stateless) ───────────────────────────────────────────


def get_or_create_session(session_id: str) -> SessionMemory:
    logger.debug(f"Creating transient session object: {session_id}")
    memory = SessionMemory()
    memory.id = session_id
    return memory


async def hydrate_session_from_db(session_id: str, db: AsyncSession) -> SessionMemory:
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
        memory.employee_id = record.employee_id
        memory.employee_name = (
            record.insights.get("identity_context", {}).get("employee_name")
            if record.insights
            else None
        )
        memory.insights = record.insights or {}
        memory.progress = record.conversation_state or {}
        memory.generated_jd = record.jd_text
        memory.jd_structured = record.jd_structured

        turns_result = await db.execute(
            fut_select(ConversationTurn)
            .where(ConversationTurn.session_id == record.id)
            .order_by(ConversationTurn.turn_index.desc())
            .limit(10)
        )
        recent_turns = list(reversed(turns_result.scalars().all()))
        history = [{"role": t.role, "content": t.content} for t in recent_turns]
        memory.load_history_from_db(history, llm_limit=10)

    return memory


# ── Init ──────────────────────────────────────────────────────────────────────
@router.post("/init", response_model=InitJDResponse)
async def init_jd(request: InitJDRequest, db: AsyncSession = Depends(get_db)):
    from sqlalchemy.future import select
    from app.models.user_model import Employee

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
        if emp.department:
            identity_context["department"] = emp.department
        if emp.reporting_manager:
            identity_context["reports_to"] = (
                f"{emp.reporting_manager} ({emp.reporting_manager_code})"
            )
        if emp.email:
            identity_context["email"] = emp.email
        if emp.phone_mobile:
            identity_context["phone"] = emp.phone_mobile

        from sqlalchemy import text

        org_query = text("""
            SELECT designation, location, date_of_joining
            FROM organogram
            WHERE code = :code
        """)
        org_res = await db.execute(org_query, {"code": request.employee_id})
        org_row = org_res.mappings().first()
        if org_row:
            if org_row.get("designation"):
                identity_context["title"] = org_row["designation"]
            if org_row.get("location"):
                identity_context["location"] = org_row["location"]
            if org_row.get("date_of_joining"):
                identity_context["date_of_joining"] = org_row["date_of_joining"]
        elif emp.role:
            identity_context["title"] = emp.role

        if identity_context:
            starting_insights["identity_context"] = identity_context

    memory.insights = starting_insights

    await sync_session_to_db(
        db=db,
        session_id=new_id,
        insights=starting_insights,
        progress={
            "completion_percentage": 5,
            "status": "collecting",
            "missing_insight_areas": [],
        },
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
        progress=session_memory.progress,
        conversation_history=session_memory.full_history,
        employee_id=session_memory.employee_id,
        employee_name=session_memory.employee_name,
        generated_jd=session_memory.generated_jd,
        jd_structured=session_memory.jd_structured,
        status=session_memory.progress.get("status"),
    )

    await invalidate_pattern(f"cache:jd_detail:*{session_id}*")

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
                progress=session_memory.progress,
                conversation_history=session_memory.full_history,
                employee_id=session_memory.employee_id,
                employee_name=session_memory.employee_name,
                generated_jd=session_memory.generated_jd,
                jd_structured=session_memory.jd_structured,
                status=session_memory.progress.get("status"),
            )
            await invalidate_pattern(f"cache:jd_detail:*{session_id}*")
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
        progress=session_memory.progress,
        conversation_history=session_memory.full_history,
        employee_id=session_memory.employee_id,
        employee_name=session_memory.employee_name,
        status="jd_generated",
    )

    await invalidate_pattern(f"cache:jd_detail:*{session_id}*")

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

    try:
        record = await save_questionnaire_jd(
            db=db,
            session_id=session_id,
            jd_text=request.jd_text,
            jd_structured=request.jd_structured,
            employee_insights=session_memory.insights,
            progress=session_memory.progress,
            employee_id=request.employee_id or session_memory.employee_id,
            conversation_history=db_history,
            status=session_memory.progress.get("status")
            if isinstance(session_memory.progress, dict)
            else None,
        )

        await invalidate_pattern("cache:jd_list:*")
        await invalidate_pattern("cache:manager_pending:*")
        await invalidate_pattern("cache:hr_pending:*")
        await invalidate_pattern("cache:dept_stats:*")
        await invalidate_pattern(f"cache:jd_detail:*{session_id}*")

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

    # Update insights with confirmed skills
    session_memory.insights["skills"] = request.skills

    # Update status to ready_for_generation
    session_memory.progress["status"] = "ready_for_generation"

    await sync_session_to_db(
        db=db,
        session_id=jd_id,
        insights=session_memory.insights,
        progress=session_memory.progress,
        conversation_history=session_memory.full_history,
        employee_id=session_memory.employee_id,
        status="ready_for_generation",
    )

    return {"status": "success", "message": "Skills confirmed and stored."}


@router.get("/")
def health_check():
    return {"status": "ok"}


# ── List all (admin) ──────────────────────────────────────────────────────────
@router.get("/list")
@cached_response("jd_list", ttl=300)
async def list_jds(submitted_only: bool = False, db: AsyncSession = Depends(get_db)):
    status_filter = (
        ["sent_to_manager", "manager_rejected", "sent_to_hr", "hr_rejected", "approved"]
        if submitted_only
        else None
    )
    records = await list_questionnaires(db, status_in=status_filter)
    return [_serialize_list_item(r) for r in records]


# ── List by employee ──────────────────────────────────────────────────────────
@router.get("/employee/{employee_id}")
async def get_employee_jds(employee_id: str, db: AsyncSession = Depends(get_db)):
    records = await list_questionnaires_by_employee(db, employee_id)
    # records might be already serialised (from cache) or raw objects
    if records and isinstance(records[0], dict):
        return records
    return [_serialize_list_item(r) for r in records]


# ── List pending for Manager ──────────────────────────────────────────────────
@router.get("/manager/{manager_id}/pending")
@cached_response("manager_pending", ttl=300)
async def get_manager_pending_jds(manager_id: str, db: AsyncSession = Depends(get_db)):
    records = await list_manager_pending_jds(db, manager_id)
    return [_serialize_list_item(r) for r in records]


# ── List pending for HR ───────────────────────────────────────────────────────
@router.get("/hr/pending")
@cached_response("hr_pending", ttl=300)
async def get_hr_pending_jds(db: AsyncSession = Depends(get_db)):
    records = await list_hr_pending_jds(db)
    return [_serialize_list_item(r) for r in records]


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
    jd_id: str, filename: str = None, db: AsyncSession = Depends(get_db)
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

    docx_buffer = generate_jd_docx(
        jd_data=record.jd_structured,
        title=record.title,
        department=record.department,
    )

    title = record.title or "Job Description"
    dept = record.department or ""
    safe_filename = f"{title} - {dept}.docx" if dept else f"{title}.docx"
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

@router.get("/{jd_id}")
@cached_response("jd_detail", ttl=600)
async def get_jd(jd_id: str, db: AsyncSession = Depends(get_db)):
    record = await get_questionnaire(db, jd_id)
    if not record:
        raise HTTPException(status_code=404, detail="JD not found")
    history = [
        {"role": t.role, "content": t.content}
        for t in (record.conversation_turns or [])
    ]
    return {
        "id": str(record.id),
        "employee_id": record.employee_id,
        "title": record.title,
        "status": record.status,
        "version": record.version,
        "generated_jd": record.jd_text,
        "jd_structured": record.jd_structured,
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
@router.patch("/{jd_id}/status")
async def update_jd_status(
    jd_id: str, request: UpdateStatusRequest, db: AsyncSession = Depends(get_db)
):
    valid_statuses = [
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
        record = await update_questionnaire_status(
            db=db,
            jd_id=jd_id,
            new_status=request.status,
            employee_id=request.employee_id,
        )
        if not record:
            raise HTTPException(status_code=404, detail="JD not found")

        await invalidate_pattern("cache:jd_list:*")
        await invalidate_pattern("cache:manager_pending:*")
        await invalidate_pattern("cache:hr_pending:*")
        await invalidate_pattern("cache:dept_stats:*")
        await invalidate_pattern(f"cache:jd_detail:*{jd_id}*")

        return {
            "status": "success",
            "id": str(record.id),
            "new_status": record.status,
            "message": f"Status updated to '{record.status}'",
        }
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
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
def _serialize_list_item(r) -> dict:
    if isinstance(r, dict):
        return r
    return {
        "id": str(r.id),
        "employee_id": r.employee_id,
        "title": r.title,
        "status": r.status,
        "version": r.version,
        "created_at": r.created_at,
        "updated_at": r.updated_at,
    }
