# backend/app/agents/kra_kpi_interview_agent.py
import json
import logging
import time
from typing import AsyncIterator, Any
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm.attributes import flag_modified

from app.models.kra_kpi_model import KRAKPISession, KRAKPIConversationTurn
from app.models.jd_session_model import JDSession
from app.models.user_model import Employee
from app.core.database import AsyncSessionLocal
from app.agents.kra_kpi_agent import _get_llm

logger = logging.getLogger(__name__)
from app.core.langfuse_client import get_compiled_prompt
from app.agents.prompts import KRA_KPI_SYSTEM_PROMPT

# KRA_KPI_SYSTEM_PROMPT has been moved to app/agents/prompts.py


class KRAKPIInterviewEngine:
    """Conversational engine for KRA/KPI generation."""

    def __init__(self):
        self.llm = _get_llm()

    async def run_turn_stream(
        self,
        session_id: str,
        user_message: str,
        db: AsyncSession,
    ) -> AsyncIterator[dict]:
        """Execute one conversational turn, streaming updates back to client.

        Yields chunks for SSE format.
        """
        # Hydrate session
        import uuid
        session_uuid = uuid.UUID(session_id) if isinstance(session_id, str) else session_id
        
        q_result = await db.execute(
            select(KRAKPISession).where(KRAKPISession.id == session_uuid)
        )
        record = q_result.scalar_one_or_none()
        if not record:
            yield {"type": "error", "content": "KRA/KPI Session not found."}
            return

        # Fetch employee JD session details for context
        emp_jd_result = await db.execute(
            select(JDSession).where(JDSession.id == uuid.UUID(record.jd_session_id))
        )
        emp_jd = emp_jd_result.scalar_one_or_none()
        
        # Optimize JD context size by extracting ONLY the responsibilities if structured data is present
        emp_jd_text = ""
        if emp_jd:
            if emp_jd.jd_structured:
                struct = emp_jd.jd_structured
                resp = struct.get("responsibilities", [])
                if resp:
                    emp_jd_text = "Responsibilities:\n" + "\n".join(f"- {r}" for r in resp)
                else:
                    emp_jd_text = "No responsibilities defined."
            else:
                emp_jd_text = emp_jd.jd_text or "No JD text available."
        else:
            emp_jd_text = "No JD text available."

        # Fetch manager KRA/KPI context if present
        mgr_kras_text = "Not Available"
        mgr_title = "Not Available"
        if record.manager_kra_kpi_session_id:
            try:
                mgr_session_result = await db.execute(
                    select(KRAKPISession).where(
                        KRAKPISession.id == uuid.UUID(record.manager_kra_kpi_session_id)
                    )
                )
                mgr_session = mgr_session_result.scalar_one_or_none()
                if mgr_session and mgr_session.kras:
                    mgr_kras_text = json.dumps(mgr_session.kras.get("kras", []))
                else:
                    from app.models.kra_kpi_model import UploadedKRAKPI
                    uploaded_res = await db.execute(
                        select(UploadedKRAKPI).where(
                            UploadedKRAKPI.id == uuid.UUID(record.manager_kra_kpi_session_id)
                        )
                    )
                    uploaded_rec = uploaded_res.scalar_one_or_none()
                    if uploaded_rec and uploaded_rec.kras:
                        mgr_kras_text = json.dumps(uploaded_rec.kras.get("kras", []))
            except Exception:
                pass
        
        if record.manager_jd_session_id:
            try:
                mgr_jd_result = await db.execute(
                    select(JDSession).where(
                        JDSession.id == uuid.UUID(record.manager_jd_session_id)
                    )
                )
                mgr_jd = mgr_jd_result.scalar_one_or_none()
                if mgr_jd:
                    mgr_title = mgr_jd.title or "Manager"
            except Exception:
                pass

        # Determine step parameters
        current_step = record.generation_step or "kra_selection"
        active_kra_title = "None"
        progress_pct = 0
        
        # Build prompt variables
        identity = (emp_jd.insights.get("identity_context") or {}) if emp_jd else {}
        role_title = emp_jd.title if emp_jd else "Employee"
        department = emp_jd.department if emp_jd else "General"
        seniority = identity.get("job_level") or "Mid"

        # Check conversation state mapping to identify active KRA
        selected_kras = record.selected_kra_ids or []
        kpi_suggestions = record.kpi_suggestions or {}
        selected_kpi_ids = record.selected_kpi_ids or {}

        # Stage calculations
        if current_step == "kra_selection":
            progress_pct = 15
            active_kra_title = "KRA Extraction Phase"
        elif current_step == "kpi_selection":
            # Find which selected KRA is currently being evaluated
            unconfirmed_kras = [k for k in selected_kras if k not in selected_kpi_ids]
            if unconfirmed_kras:
                active_kra_id = unconfirmed_kras[0]
                # Look up title from kra_suggestions
                suggestions = (record.kra_suggestions or {}).get("kra_suggestions", [])
                for sug in suggestions:
                    if sug.get("kra_id") == active_kra_id:
                        active_kra_title = sug.get("title", "Active KRA")
                        break
            progress_pct = 40 + int(
                (len(selected_kpi_ids) / max(len(selected_kras), 1)) * 40
            )
        elif current_step == "weight_adjustment":
            progress_pct = 90
            active_kra_title = "Finalizing Weights & Balance"
        elif current_step == "confirmed":
            progress_pct = 100
            active_kra_title = "Confirmed"

        system_prompt = get_compiled_prompt(
            "kra-kpi-interview-prompt",
            KRA_KPI_SYSTEM_PROMPT,
            role_title=role_title or "N/A",
            department=department or "N/A",
            seniority=seniority or "N/A",
            employee_jd=emp_jd_text or "N/A",
            manager_title=mgr_title or "N/A",
            manager_kras=mgr_kras_text or "N/A",
            current_step=current_step or "KRA_PROPOSAL",
            active_kra_title=active_kra_title or "N/A",
            progress_pct=int(progress_pct),
        )

        # Build message history matching the langchain agent standard
        from langchain_core.messages import SystemMessage, HumanMessage, AIMessage
        langchain_history = [SystemMessage(content=system_prompt)]
        
        # Load past turns from DB (pruning to last 4 turns to limit context token growth)
        turns_result = await db.execute(
            select(KRAKPIConversationTurn)
            .where(KRAKPIConversationTurn.session_id == record.id)
            .order_by(KRAKPIConversationTurn.turn_index)
        )
        all_turns = turns_result.scalars().all()
        for turn in all_turns[-4:]:
            if turn.role == "user":
                langchain_history.append(HumanMessage(content=turn.content))
            else:
                langchain_history.append(AIMessage(content=turn.content))

        # Add the active user message
        langchain_history.append(HumanMessage(content=user_message))

        # Call streaming model
        full_response = ""
        yield {"type": "status", "content": "Developing your performance metrics..."}
        
        try:
            async for chunk in self.llm.astream(langchain_history):
                content = str(chunk.content)
                if content:
                    full_response += content
                    yield {"type": "chunk", "content": content}
        except Exception as e:
            logger.error(f"[KRAKPIInterview] LLM stream error: {e}")
            yield {"type": "error", "content": f"Failed to generate output: {str(e)}"}
            return

        # Prepare final payload containing the payload structure
        response_data = {
            "next_question": full_response,
            "progress": {
                "completion_percentage": progress_pct,
                "current_step": current_step,
                "active_kra_title": active_kra_title,
            },
            "suggested_kras": record.kra_suggestions if current_step == "kra_selection" else None,
            "suggested_kpis": kpi_suggestions.get(active_kra_id) if current_step == "kpi_selection" and 'active_kra_id' in locals() else None,
            "final_framework": record.kras if current_step == "confirmed" else None,
        }

        yield {"type": "done", "parsed": response_data, "full_text": full_response}


# Singleton engine
kra_kpi_interview_engine = KRAKPIInterviewEngine()
