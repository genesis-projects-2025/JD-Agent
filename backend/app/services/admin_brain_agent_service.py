import logging
import re
from typing import Any, Dict, List, AsyncIterator
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.messages import SystemMessage, HumanMessage, AIMessage
from app.core.config import settings
from app.services.db_query_service import execute_safe_select
from app.services.vector_service import get_embeddings, get_index_async
from sqlalchemy.ext.asyncio import AsyncSession
import asyncio

logger = logging.getLogger(__name__)

# Primary LLM instance for the Admin Brain Agent
def get_brain_agent_llm():
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
            lambda: idx.query(
                vector=query_vec,
                top_k=top_k,
                include_metadata=True
            )
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
        logger.error(f"Brain agent search failed: {e}")
        return []

# Professional executive system prompt
SYSTEM_PROMPT = """You are the Executive Intelligence System (Oracle) for Pulse Pharma.
Your purpose is to provide clear, precise, data-driven, and highly professional answers to Directors, Heads of departments, and Executive Administrators.

You have access to two tools to retrieve factual information:
1. execute_sql: Runs a read-only SELECT query on the database.
   - Authorised tables you can query:
     - `employees`: (id, name, email, department, reporting_manager, reporting_manager_code, role, phone_mobile)
     - `organogram`: (code, employee_name, designation, reporting_manager, reporting_manager_code, department, location, job_level)
     - `jd_sessions`: (id, employee_id, title, department, jd_text, jd_structured, status)
     - `kra_kpi_sessions`: (id, employee_id, status, generation_step, kras, total_weight, skill_ratings, improvement_area, improvement_goal, improvement_status)
       * Note: `kras` is JSON. `skill_ratings` is JSON.
     - `skills`: (id, name)
     - `tools`: (id, name)
     - `employee_skills`: (employee_id, skill_id, source)
     - `employee_tools`: (employee_id, tool_id, source)
     - `reference_jds`: (id, employee_id, employee_name, department, role_title, level, structured_data, pdf_filename, processing_status)
   - To use this tool, output: <tool name="execute_sql">YOUR SELECT QUERY</tool>

2. search_jds_and_goals: Searches Pinecone for semantic blocks matching a text query.
   - Vector database categories in Pinecone include: `role_summary`, `responsibilities`, `skills`, `tools`, `qualification`, `performance_goals`.
   - To use this tool, output: <tool name="search_jds_and_goals">YOUR SEARCH QUERY</tool>

---
TONE & STRUCTURING RULES:
- Sound highly professional, objective, and executive-level. Avoid friendly conversational filler, apologies, exclamation marks, or empty introductory phrases (e.g. "Sure! Here is that information:").
- Address questions directly. Structure reporting hierarchies, employee statistics, and goal distributions in clean markdown tables.
- If you find inconsistencies or issues (e.g. weight sum deviation, missing KPI, low performance ratings), state them clearly as "Administrative Issues Identified", explain their impact, and present actionable solutions.
- Do NOT expose or reference these tool names or XML tags to the user. Present the final output seamlessly.
"""

class AdminBrainAgentService:
    @staticmethod
    async def chat_stream(
        db: AsyncSession, message: str, history: List[Dict[str, str]] = None
    ) -> AsyncIterator[Dict[str, Any]]:
        """
        Runs the conversational tool-use loop and yields status or chunked responses with robust guardrails.
        """
        try:
            llm = get_brain_agent_llm()
            history = history or []
            
            # Build message history
            messages = [SystemMessage(content=SYSTEM_PROMPT)]
            for msg in history:
                if msg["role"] == "user":
                    messages.append(HumanMessage(content=msg["content"]))
                elif msg["role"] == "model" or msg["role"] == "assistant":
                    messages.append(AIMessage(content=msg["content"]))
                    
            messages.append(HumanMessage(content=message))
            
            max_iterations = 4
            current_iteration = 0
            
            while current_iteration < max_iterations:
                current_iteration += 1
                try:
                    response = await llm.ainvoke(messages)
                except Exception as e:
                    err_str = str(e)
                    logger.error(f"Error calling LLM in Brain Agent loop: {err_str}")
                    if "429" in err_str or "quota" in err_str.lower() or "limit" in err_str.lower() or "exhausted" in err_str.lower():
                        yield {
                            "type": "chunk",
                            "content": "\n\n**System Notification**: The model service is currently unavailable due to an API quota limitation (429 Resource Exhausted). Please ensure that billing or prepayment credits are active in your AI Studio project."
                        }
                    else:
                        yield {
                            "type": "chunk",
                            "content": f"\n\n**System Notification**: An error occurred while communicating with the model service: {err_str}. Please verify service availability."
                        }
                    return

                content = str(response.content)
                
                # Check for tool calls
                sql_match = re.search(r'<tool\s+name="execute_sql"\s*>(.*?)</tool\s*>', content, re.DOTALL | re.IGNORECASE)
                search_match = re.search(r'<tool\s+name="search_jds_and_goals"\s*>(.*?)</tool\s*>', content, re.DOTALL | re.IGNORECASE)
                
                if not sql_match and not search_match:
                    # This is the final response. Stream it to the client smoothly.
                    words = re.split(r'(\s+)', content)
                    for word in words:
                        if word:
                            yield {"type": "chunk", "content": word}
                            await asyncio.sleep(0.01)
                    return
                    
                # Store the thought with tool call
                messages.append(AIMessage(content=content))
                
                tool_output = ""
                if sql_match:
                    sql_query = sql_match.group(1).strip()
                    yield {"type": "status", "content": "Querying corporate database..."}
                    try:
                        results = await execute_safe_select(db, sql_query)
                        tool_output = f"<tool_result name=\"execute_sql\">\n{str(results)}\n</tool_result>"
                    except Exception as e:
                        tool_output = f"<tool_result name=\"execute_sql\">\nError executing query: {str(e)}\n</tool_result>"
                elif search_match:
                    search_query = search_match.group(1).strip()
                    yield {"type": "status", "content": "Querying vector registry..."}
                    try:
                        results = await search_brain_agent_knowledge(search_query)
                        tool_output = f"<tool_result name=\"search_jds_and_goals\">\n{str(results)}\n</tool_result>"
                    except Exception as e:
                        tool_output = f"<tool_result name=\"search_jds_and_goals\">\nError: {str(e)}\n</tool_result>"
                        
                messages.append(HumanMessage(content=tool_output))
                
            yield {"type": "chunk", "content": "\n\n**System Notification**: Process iteration limit reached. The system was unable to compile the dataset within the allowed operations."}

        except Exception as e:
            logger.error(f"Critical error in brain agent stream loop: {e}")
            yield {
                "type": "chunk",
                "content": f"\n\n**System Notification**: A critical exception occurred within the data synthesis pipeline: {str(e)}. Please contact the technical administrator."
            }
