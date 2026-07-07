"""
Admin Brain Agent Service v2.

Hybrid SQL + Vector agentic orchestrator with:
- Persistent conversation sessions (DB-backed)
- Langfuse tracing and prompt management
- Multi-tool concurrent execution
- Entity tracking for pronoun resolution
- Proactive anomaly detection on new sessions
- Robust error guardrails
"""

import logging
import re
import uuid
from typing import Any, Dict, List, AsyncIterator, Optional
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.messages import SystemMessage, HumanMessage, AIMessage
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession
import asyncio

from app.core.config import settings
from app.core.langfuse_client import get_compiled_prompt, get_langfuse_callback_handler
from app.agents.prompts import BRAIN_AGENT_SYSTEM_PROMPT
from app.services.db_query_service import execute_safe_select
from app.services.vector_service import get_embeddings, get_index_async
from app.services.brain_agent_anomaly_service import run_diagnostics, format_anomaly_context
from app.models.brain_agent_model import BrainAgentSession, BrainAgentConversationTurn

logger = logging.getLogger(__name__)


def _get_brain_agent_llm():
    return ChatGoogleGenerativeAI(
        google_api_key=settings.GEMINI_API_KEY,
        model="gemini-2.5-flash",
        temperature=0.15,
    )


async def search_brain_agent_knowledge(query_text: str, top_k: int = 5) -> List[str]:
    """Retrieve semantic chunks from Pinecone across all categories."""
    try:
        query_vec = await asyncio.to_thread(
            lambda: get_embeddings().embed_query(query_text)
        )
        idx = await get_index_async()
        if not idx:
            return []

        results = await asyncio.to_thread(
            lambda: idx.query(vector=query_vec, top_k=top_k, include_metadata=True)
        )

        contexts = []
        for match in results.get("matches", []):
            meta = match.get("metadata", {})
            text_val = meta.get("text", "")
            if text_val:
                category = meta.get("category", "general")
                role = meta.get("role_title", "N/A")
                contexts.append(f"[{category.upper()} - Role: {role}] {text_val}")
        return contexts
    except Exception as e:
        logger.error(f"Brain agent vector search failed: {e}")
        return []


def _extract_entities(text: str) -> Dict[str, Any]:
    """
    Zero-cost entity extraction using regex patterns.
    Extracts employee IDs, names (capitalized words), and departments.
    """
    entities = {}

    # Extract employee IDs (E followed by digits)
    emp_ids = re.findall(r'\b(E\d{3,5})\b', text)
    if emp_ids:
        entities["last_employee_id"] = emp_ids[-1]

    # Extract department references from known department keywords
    dept_patterns = [
        r'(?:department|dept|division)\s*(?:of|:)?\s*([A-Z][a-zA-Z\s&]+)',
        r'(?:in|from|under)\s+(Quality\s*(?:Control|Assurance)|Digital\s+Transformation|'
        r'Human\s+Resources|Supply\s+Chain|Research\s+&?\s*Development|'
        r'Regulatory\s+Affairs|Information\s+Technology|Finance|Marketing|'
        r'Production|Maintenance|Engineering|Administration)',
    ]
    for pattern in dept_patterns:
        dept_match = re.search(pattern, text, re.IGNORECASE)
        if dept_match:
            entities["last_department"] = dept_match.group(1).strip()
            break

    return entities


def _format_entity_context(entity_ctx: Dict[str, Any]) -> str:
    """Format entity context into a system prompt injection block."""
    if not entity_ctx:
        return ""

    lines = ["ACTIVE CONTEXT FROM PRIOR TURNS (use to resolve pronouns like 'his', 'her', 'their', 'that department'):"]
    if entity_ctx.get("last_employee_id"):
        lines.append(f"- Last referenced employee ID: {entity_ctx['last_employee_id']}")
    if entity_ctx.get("last_employee_name"):
        lines.append(f"- Last referenced employee name: {entity_ctx['last_employee_name']}")
    if entity_ctx.get("last_department"):
        lines.append(f"- Last referenced department: {entity_ctx['last_department']}")

    return "\n".join(lines)


class AdminBrainAgentService:

    @staticmethod
    async def list_sessions(db: AsyncSession, admin_user: str) -> List[Dict]:
        """List past sessions for an admin user, newest first."""
        try:
            result = await db.execute(
                select(BrainAgentSession)
                .where(BrainAgentSession.admin_user == admin_user)
                .order_by(desc(BrainAgentSession.updated_at))
                .limit(50)
            )
            sessions = result.scalars().all()
            return [s.to_dict() for s in sessions]
        except Exception as e:
            logger.error(f"Error listing brain agent sessions: {e}")
            return []

    @staticmethod
    async def get_session_turns(db: AsyncSession, session_id: str) -> List[Dict]:
        """Get all conversation turns for a specific session."""
        try:
            result = await db.execute(
                select(BrainAgentConversationTurn)
                .where(BrainAgentConversationTurn.session_id == uuid.UUID(session_id))
                .order_by(BrainAgentConversationTurn.turn_index)
            )
            turns = result.scalars().all()
            return [t.to_dict() for t in turns]
        except Exception as e:
            logger.error(f"Error fetching session turns: {e}")
            return []

    @staticmethod
    async def delete_session(db: AsyncSession, session_id: str) -> bool:
        """Delete a session and all its turns."""
        try:
            result = await db.execute(
                select(BrainAgentSession)
                .where(BrainAgentSession.id == uuid.UUID(session_id))
            )
            session = result.scalar_one_or_none()
            if session:
                await db.delete(session)
                await db.commit()
                return True
            return False
        except Exception as e:
            logger.error(f"Error deleting brain agent session: {e}")
            return False

    @staticmethod
    async def chat_stream(
        db: AsyncSession,
        message: str,
        admin_user: str,
        session_id: Optional[str] = None,
        history: Optional[List[Dict[str, str]]] = None,
    ) -> AsyncIterator[Dict[str, Any]]:
        """
        Runs the conversational tool-use loop with full persistence,
        Langfuse tracing, multi-tool concurrency, and entity tracking.
        """
        try:
            llm = _get_brain_agent_llm()

            # ── Session Management ──
            session = None
            entity_context = {}
            is_new_session = session_id is None

            if session_id:
                # Load existing session
                try:
                    result = await db.execute(
                        select(BrainAgentSession)
                        .where(BrainAgentSession.id == uuid.UUID(session_id))
                    )
                    session = result.scalar_one_or_none()
                    if session:
                        entity_context = session.entity_context or {}
                except Exception:
                    pass

            if not session:
                # Create new session
                session = BrainAgentSession(
                    admin_user=admin_user,
                    title=message[:80].strip(),
                    entity_context={},
                )
                db.add(session)
                await db.flush()
                is_new_session = True

            # Emit session_id to frontend
            yield {"type": "session", "session_id": str(session.id)}

            # ── Anomaly Detection (new sessions only) ──
            anomaly_text = ""
            if is_new_session:
                try:
                    yield {"type": "status", "content": "Running organizational diagnostics..."}
                    report = await run_diagnostics(db)
                    anomaly_text = format_anomaly_context(report)
                except Exception as e:
                    logger.warning(f"Anomaly detection failed: {e}")

            # ── Compile System Prompt ──
            entity_text = _format_entity_context(entity_context)
            system_prompt = get_compiled_prompt(
                "brain-agent-system",
                BRAIN_AGENT_SYSTEM_PROMPT,
                entity_context=entity_text,
                anomaly_context=anomaly_text,
            )

            # ── Build LangChain Message History ──
            messages = [SystemMessage(content=system_prompt)]

            # Load persisted turns from DB (last 10 turns for context window)
            if session_id and session:
                db_turns_result = await db.execute(
                    select(BrainAgentConversationTurn)
                    .where(BrainAgentConversationTurn.session_id == session.id)
                    .order_by(BrainAgentConversationTurn.turn_index)
                )
                db_turns = db_turns_result.scalars().all()
                for turn in db_turns[-10:]:
                    if turn.role == "user":
                        messages.append(HumanMessage(content=turn.content))
                    else:
                        messages.append(AIMessage(content=turn.content))

            messages.append(HumanMessage(content=message))

            # ── Persist User Turn ──
            turn_count_result = await db.execute(
                select(BrainAgentConversationTurn)
                .where(BrainAgentConversationTurn.session_id == session.id)
            )
            existing_turns = turn_count_result.scalars().all()
            next_turn_index = len(existing_turns)

            user_turn = BrainAgentConversationTurn(
                session_id=session.id,
                turn_index=next_turn_index,
                role="user",
                content=message,
            )
            db.add(user_turn)
            next_turn_index += 1

            # ── Langfuse Callback ──
            handler = get_langfuse_callback_handler(
                trace_name="brain-agent-chat",
                session_id=str(session.id),
                user_id=admin_user,
                tags=["brain-agent"],
            )
            callbacks = [handler] if handler else []

            # ── Agentic Tool Loop ──
            max_iterations = 5
            current_iteration = 0
            all_tool_calls = []

            while current_iteration < max_iterations:
                current_iteration += 1
                try:
                    response = await llm.ainvoke(messages, config={"callbacks": callbacks})
                except Exception as e:
                    err_str = str(e)
                    logger.error(f"LLM invocation error: {err_str}")
                    if "429" in err_str or "quota" in err_str.lower() or "exhausted" in err_str.lower():
                        yield {
                            "type": "chunk",
                            "content": "\n\n**System Notification**: The model service is currently unavailable due to an API quota limitation (429 Resource Exhausted). Please ensure that billing or prepayment credits are active in your AI Studio project.",
                        }
                    else:
                        yield {
                            "type": "chunk",
                            "content": f"\n\n**System Notification**: An error occurred while communicating with the model service. Please verify service availability.",
                        }
                    await db.commit()
                    return

                content = str(response.content)

                # ── Multi-Tool Parsing (concurrent) ──
                sql_match = re.search(
                    r'<tool\s+name="execute_sql"\s*>(.*?)</tool\s*>',
                    content, re.DOTALL | re.IGNORECASE,
                )
                search_match = re.search(
                    r'<tool\s+name="search_jds_and_goals"\s*>(.*?)</tool\s*>',
                    content, re.DOTALL | re.IGNORECASE,
                )

                if not sql_match and not search_match:
                    # Final response — stream it
                    words = re.split(r'(\s+)', content)
                    for word in words:
                        if word:
                            yield {"type": "chunk", "content": word}
                            await asyncio.sleep(0.008)

                    # Persist assistant turn
                    assistant_turn = BrainAgentConversationTurn(
                        session_id=session.id,
                        turn_index=next_turn_index,
                        role="assistant",
                        content=content,
                        tool_calls=all_tool_calls if all_tool_calls else None,
                    )
                    db.add(assistant_turn)

                    # Update entity context
                    new_entities = _extract_entities(content)
                    if new_entities:
                        entity_context.update(new_entities)
                        session.entity_context = entity_context

                    await db.commit()
                    return

                # Store thought with tool calls
                messages.append(AIMessage(content=content))
                tool_results = []

                # Execute tools concurrently
                async def run_sql(query: str) -> str:
                    try:
                        results = await execute_safe_select(db, query)
                        return f'<tool_result name="execute_sql">\n{str(results)}\n</tool_result>'
                    except Exception as e:
                        return f'<tool_result name="execute_sql">\nError: {str(e)}\n</tool_result>'

                async def run_search(query: str) -> str:
                    try:
                        results = await search_brain_agent_knowledge(query)
                        return f'<tool_result name="search_jds_and_goals">\n{str(results)}\n</tool_result>'
                    except Exception as e:
                        return f'<tool_result name="search_jds_and_goals">\nError: {str(e)}\n</tool_result>'

                tasks = []
                if sql_match:
                    sql_query = sql_match.group(1).strip()
                    yield {"type": "status", "content": "Querying corporate database..."}
                    yield {"type": "tool_call", "tool": "execute_sql", "query": sql_query}
                    tasks.append(run_sql(sql_query))
                    all_tool_calls.append({"tool": "execute_sql", "query": sql_query})

                if search_match:
                    search_query = search_match.group(1).strip()
                    yield {"type": "status", "content": "Querying vector registry..."}
                    yield {"type": "tool_call", "tool": "search_jds_and_goals", "query": search_query}
                    tasks.append(run_search(search_query))
                    all_tool_calls.append({"tool": "search_jds_and_goals", "query": search_query})

                if tasks:
                    results = await asyncio.gather(*tasks)
                    combined_result = "\n\n".join(results)
                    messages.append(HumanMessage(content=combined_result))

            # Iteration limit reached
            yield {
                "type": "chunk",
                "content": "\n\n**System Notification**: Process iteration limit reached. The system was unable to compile the dataset within the allowed operations.",
            }
            await db.commit()

        except Exception as e:
            logger.error(f"Critical error in brain agent stream: {e}")
            yield {
                "type": "chunk",
                "content": f"\n\n**System Notification**: A critical exception occurred within the data synthesis pipeline. Please contact the technical administrator.",
            }
