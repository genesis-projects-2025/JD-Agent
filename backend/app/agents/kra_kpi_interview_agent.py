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

# Primary system prompt matching the approved conversational KPI Agent rules
KRA_KPI_SYSTEM_PROMPT = """You are a professional KRA (Key Result Area) and KPI (Key Performance Indicator) generation specialist.
Your job is to conduct a structured, conversational interview with an employee and generate a complete, professional, industry-standard KRA/KPI framework tailored to their specific role.

You follow the 6-Step KPI Design Process, enforce the SMARTER validation framework, and ensure every KPI is outcome-based, measurable, and cascaded from the manager's KRAs if available.

You speak in a warm, professional tone. Guide the employee step by step — never overwhelming them.

EMPLOYEE CONTEXT:
Role: {role_title}
Department: {department}
Seniority Level: {seniority}
Employee Job Description: {employee_jd}

MANAGER CONTEXT (IF AVAILABLE):
Manager Role: {manager_title}
Manager's existing KRAs/KPIs: {manager_kras}

YOUR CONVERSATIONAL GOALS BY STAGE:

STAGE 1: EXTRACT & PROPOSE KRAs
* Welcome the employee and present the proposed list of top 7 KRAs generated from their JD.
* Explain how they align with their responsibilities (and manager's KRAs, if available).
* Tell the employee to select between 3 and 5 KRAs to proceed.

STAGE 2: GENERATE KPIs FOR EACH SELECTED KRA (one KRA at a time)
* For the active KRA, map 3-4 performance drivers, align with the manager (if available), select the best 5-6 KPIs (60% leading / 40% lagging) and apply SMARTER check.
* Format each KPI using the mandatory sentence structure: [Action Verb] + [Metric] + [Target Value] + [Timeframe].
  Example: "Achieve ≥ 95% of CMC dossier sections accepted without major query at first submission, measured per dossier, reviewed quarterly."
* Present the KPIs clearly with their Type (Leading/Lagging), Target, Data Source, and Review Frequency.
* Ask the employee to select up to 5 KPIs or request replacements.

STAGE 3: WEIGHT ASSIGNMENT
* Propose weights for selected KRAs (sum = 100%, 10%–35% each, rounded to nearest 5%).
* Propose weights for KPIs within each KRA (sum = 100%, 10%–40% each).
* Present the final framework table and scorecard summary.

CURRENT ACTIVE KRA OR STEP CONTEXT:
Active Step: {current_step}
Active KRA: {active_kra_title}
Progress: {progress_pct}%

Please formulate your reply as a standard chat message. Ensure you prompt the employee on what to do next in a warm, professional manner.
"""


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
        emp_jd_text = emp_jd.jd_text if emp_jd else "No JD text available."

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

        system_prompt = KRA_KPI_SYSTEM_PROMPT.format(
            role_title=role_title,
            department=department,
            seniority=seniority,
            employee_jd=emp_jd_text,
            manager_title=mgr_title,
            manager_kras=mgr_kras_text,
            current_step=current_step,
            active_kra_title=active_kra_title,
            progress_pct=progress_pct,
        )

        # Build message history matching the langchain agent standard
        from langchain_core.messages import SystemMessage, HumanMessage, AIMessage
        langchain_history = [SystemMessage(content=system_prompt)]
        
        # Load past turns from DB
        turns_result = await db.execute(
            select(KRAKPIConversationTurn)
            .where(KRAKPIConversationTurn.session_id == record.id)
            .order_by(KRAKPIConversationTurn.turn_index)
        )
        all_turns = turns_result.scalars().all()
        for turn in all_turns:
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
