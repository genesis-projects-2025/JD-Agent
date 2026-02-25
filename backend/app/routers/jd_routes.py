# app/routers/jd_routes.py
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from app.schemas.jd_schema import (
    ChatRequest, JDRequest, InitJDRequest, InitJDResponse,
    SaveJDRequest, UpdateJDRequest, UpdateStatusRequest, GenerateJDRequest,
)
from app.services.jd_service import handle_conversation, handle_jd_generation
from app.services.embedding_service import store_employee_jd_session
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
    delete_questionnaire,
)
import uuid

router = APIRouter()

# ── In-memory session store ───────────────────────────────────────────────────
_session_store: dict[str, SessionMemory] = {}


def get_or_create_session(session_id: str) -> SessionMemory:
    if session_id not in _session_store:
        print(f"🆕 Creating new in-memory session: {session_id}")
        _session_store[session_id] = SessionMemory()
    else:
        print(f"♻️  Reusing in-memory session: {session_id}")
    return _session_store[session_id]


async def hydrate_session_from_db(session_id: str, db: AsyncSession) -> SessionMemory:
    memory = _session_store.get(session_id)
    if memory:
        print(f"♻️  Hot session found in memory: {session_id}")
        return memory

    print(f"❄️  Cold start — loading session {session_id} from DB...")
    record = await get_questionnaire(db, session_id)
    memory = SessionMemory()

    if record:
        memory.id = str(record.id)
        memory.employee_id = record.employee_id
        # Employee name ideally resolved from insight dict
        memory.employee_name = record.insights.get("identity_context", {}).get("employee_name") if record.insights else None
        memory.insights = record.insights or {}
        memory.progress = record.conversation_state or {}
        memory.generated_jd = record.jd_text
        memory.jd_structured = record.jd_structured

        history = [{"role": t.role, "content": t.content} for t in (record.conversation_turns or [])]
        memory.load_history_from_db(history, llm_limit=6)

        print(
            f"   -> DB record found | "
            f"insights_keys={list(memory.insights.keys())} | "
            f"full_history_turns={len(memory.full_history)} | "
            f"recent_messages_turns={len(memory.recent_messages)} | "
            f"has_jd={bool(memory.generated_jd)} | "
            f"has_structured={bool(memory.jd_structured)}"
        )
    else:
        print(f"   -> No DB record found for {session_id} — starting blank session")

    _session_store[session_id] = memory
    return memory


# ── Init ──────────────────────────────────────────────────────────────────────
@router.post("/init", response_model=InitJDResponse)
async def init_jd(request: InitJDRequest, db: AsyncSession = Depends(get_db)):
    # Local Dev fix: Auto-create employee if doesn't exist to prevent Foreign Key Error
    from sqlalchemy.future import select
    from app.models.user_model import Employee
    emp_result = await db.execute(select(Employee).filter(Employee.id == request.employee_id))
    emp = emp_result.scalars().first()
    if not emp:
        emp = Employee(id=request.employee_id, name=request.employee_name or "Unknown Employee")
        db.add(emp)
        await db.commit()

    new_id = str(uuid.uuid4())
    memory = SessionMemory()
    memory.id = new_id
    memory.employee_id = request.employee_id
    memory.employee_name = request.employee_name
    _session_store[new_id] = memory

    await sync_session_to_db(
        db=db,
        session_id=new_id,
        insights={},
        progress={"completion_percentage": 0, "status": "collecting", "missing_insight_areas": []},
        conversation_history=[],
        employee_id=request.employee_id,
        employee_name=request.employee_name,
    )

    print(f"🆕 Initialized session: {new_id} | employee: {request.employee_id}")
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
        session_memory=session_memory
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

    return {"reply": reply, "history": updated_history}


# ── Generate JD ───────────────────────────────────────────────────────────────
@router.post("/generate")
async def generate_jd_endpoint(
    request: GenerateJDRequest,
    db: AsyncSession = Depends(get_db)
):
    session_id = request.id
    if not session_id:
        raise HTTPException(status_code=400, detail="Missing session id")

    print(f"\n[backend/app/routers/jd_routes.py] 🎯 /generate called for session: {session_id}")

    session_memory = await hydrate_session_from_db(session_id, db)

    if not session_memory.insights:
        raise HTTPException(
            status_code=400,
            detail="No insights collected yet. Complete the interview first."
        )

    try:
        result = await handle_jd_generation(session_memory)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"JD generation failed: {str(e)}")

    print(f"\n[backend/app/routers/jd_routes.py] 💾 SAVING JD TO DB STATUS: generated...")
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
    print(f"\n[backend/app/routers/jd_routes.py] 💾 /save called for session: {session_id}")

    session_memory = _session_store.get(session_id)
    if not session_memory:
        session_memory = await hydrate_session_from_db(session_id, db)
        if not session_memory.insights:
            raise HTTPException(
                status_code=404,
                detail="Session not found. Please complete the interview first."
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
            status=session_memory.progress.get("status") if isinstance(session_memory.progress, dict) else None,
        )
        print(f"[backend/app/routers/jd_routes.py] ✅ /save success — id={record.id} | title={record.title}")

        try:
            emp_info    = (request.jd_structured or {}).get("employee_information", {})
            job_title   = emp_info.get("job_title", "") or record.title or ""
            department  = emp_info.get("department", "")
            emp_name    = (
                session_memory.employee_name
                or session_memory.insights.get("identity_context", {}).get("employee_name", "")
                or ""
            )

            vectors_stored = await store_employee_jd_session(
                session_id=str(record.id),
                employee_id=record.employee_id,
                employee_name=emp_name,
                job_title=job_title,
                department=department,
                jd_text=request.jd_text,
                jd_structured=request.jd_structured or {},
                insights=session_memory.insights or {},
                conversation_history=db_history,
            )
            print(f"[backend/app/routers/jd_routes.py] 🧠 Pinecone — {vectors_stored} vectors stored")
        except Exception as embed_err:
            print(f"[backend/app/routers/jd_routes.py] ⚠️  Pinecone failed (non-fatal): {embed_err}")

        return {
            "status": "success",
            "id": str(record.id),
            "employee_id": record.employee_id,
            "title": record.title,
            "message": "JD saved successfully to database."
        }
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Failed to save JD: {str(e)}")


# ── List all (admin) ──────────────────────────────────────────────────────────
@router.get("/list")
async def list_jds(db: AsyncSession = Depends(get_db)):
    records = await list_questionnaires(db)
    return [_serialize_list_item(r) for r in records]


# ── List by employee ──────────────────────────────────────────────────────────
@router.get("/employee/{employee_id}")
async def get_employee_jds(employee_id: str, db: AsyncSession = Depends(get_db)):
    records = await list_questionnaires_by_employee(db, employee_id)
    return [_serialize_list_item(r) for r in records]


# ── Get single JD ─────────────────────────────────────────────────────────────
@router.get("/{jd_id}")
async def get_jd(jd_id: str, db: AsyncSession = Depends(get_db)):
    record = await get_questionnaire(db, jd_id)
    if not record:
        raise HTTPException(status_code=404, detail="JD not found")
    history = [{"role": t.role, "content": t.content} for t in (record.conversation_turns or [])]
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
    history = [{"role": t.role, "content": t.content} for t in (record.conversation_turns or [])]
    return {
        "id": str(record.id),
        "title": record.title,
        "status": record.status,
        "conversation_history": history,
        "conversation_state": record.conversation_state,
    }


# ── Update JD content ─────────────────────────────────────────────────────────
@router.put("/{jd_id}")
async def update_jd(jd_id: str, request: UpdateJDRequest, db: AsyncSession = Depends(get_db)):
    try:
        record = await update_questionnaire_jd(
            db=db, jd_id=jd_id,
            jd_text=request.jd_text,
            jd_structured=request.jd_structured,
            employee_id=request.employee_id,
        )
        if not record:
            raise HTTPException(status_code=404, detail="JD not found")
        return {"status": "success", "id": str(record.id), "version": record.version,
                "updated_at": record.updated_at, "message": "JD updated successfully."}
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update JD: {str(e)}")


# ── Update status ─────────────────────────────────────────────────────────────
@router.patch("/{jd_id}/status")
async def update_jd_status(jd_id: str, request: UpdateStatusRequest, db: AsyncSession = Depends(get_db)):
    valid_statuses = ["draft", "sent_to_manager", "approved", "rejected", "jd_generated"]
    if request.status not in valid_statuses:
        raise HTTPException(status_code=400, detail=f"Invalid status. Must be one of: {valid_statuses}")
    try:
        record = await update_questionnaire_status(
            db=db, jd_id=jd_id,
            new_status=request.status,
            employee_id=request.employee_id,
        )
        if not record:
            raise HTTPException(status_code=404, detail="JD not found")
        return {"status": "success", "id": str(record.id), "new_status": record.status,
                "message": f"Status updated to '{record.status}'"}
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update status: {str(e)}")


# ── Delete JD ─────────────────────────────────────────────────────────────────
@router.delete("/{jd_id}")
async def delete_jd(jd_id: str, employee_id: str, db: AsyncSession = Depends(get_db)):
    try:
        success = await delete_questionnaire(db=db, jd_id=jd_id, employee_id=employee_id)
        if not success:
            raise HTTPException(status_code=404, detail="JD not found")
        
        if jd_id in _session_store:
            del _session_store[jd_id]
            
        return {"status": "success", "message": "JD deleted successfully."}
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete JD: {str(e)}")


# ── Serializer ────────────────────────────────────────────────────────────────
def _serialize_list_item(r) -> dict:
    return {
        "id": str(r.id),
        "employee_id": r.employee_id,
        "title": r.title,
        "status": r.status,
        "version": r.version,
        "created_at": r.created_at,
        "updated_at": r.updated_at,
    }