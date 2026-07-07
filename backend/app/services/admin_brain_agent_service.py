import logging
import re
from typing import Any, Dict, List, Tuple
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
        temperature=0.2,
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

# Agent System Prompt
SYSTEM_PROMPT = """You are Pulse Pharma's Executive Admin Intelligence Agent ("Brain Agent").
Your purpose is to answer administrative and management questions about employee job descriptions (JDs), performance goals (KRAs/KPIs), competencies, skills, tools, and organization structure.

You have access to two tools to retrieve factual information from the database and vector knowledge base:
1. execute_sql: Runs a read-only SELECT query on the database.
   - Authorised tables you can query:
     - `employees`: (id, name, email, department, reporting_manager, reporting_manager_code, role, phone_mobile)
     - `organogram`: (code, employee_name, designation, reporting_manager, reporting_manager_code, department, location, job_level)
     - `jd_sessions`: (id, employee_id, title, department, jd_text, jd_structured, status)
     - `kra_kpi_sessions`: (id, employee_id, status, generation_step, kras, total_weight, skill_ratings, improvement_area, improvement_goal, improvement_status)
       * Note: `kras` column is JSON. You can extract it as text or query it. `skill_ratings` is JSON.
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
GUIDELINES FOR TOOL USAGE:
- You are allowed to run multiple tool calls in sequence (up to 3 iterations) to answer a complex question. For example, you can first query SQL to find all employee codes in QA, and then run a vector search or a second SQL query to fetch details about their performance sheets.
- Ensure all SQL queries are valid and only use SELECT. Never write INSERT, UPDATE, DELETE, or alter the schema.
- Always output the tool call exactly inside the XML-like tags, and STOP generating. Once the system executes the tool, you will receive the result and continue your thought process.

---
GUIDELINES FOR RESPONDING:
- Answer professionally, clearly, and highly intelligently. 
- Highlight employee details, statistics, or reporting relationships in clean markdown tables.
- If you find an issue (e.g. weight mismatch, missing KPI, low skill ratings), highlight it, analyze the impact, and offer actionable suggestions.
- Do NOT mention the names of these tools or the XML tags to the final user. Present the findings seamlessly.
"""

class AdminBrainAgentService:
    @staticmethod
    async def chat(db: AsyncSession, message: str, history: List[Dict[str, str]] = None) -> str:
        """
        Runs the conversational tool-use loop with ChatGoogleGenerativeAI
        """
        llm = get_brain_agent_llm()
        history = history or []
        
        # Build message context
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
            response = await llm.ainvoke(messages)
            content = str(response.content)
            
            # Check for execute_sql tool call
            sql_match = re.search(r'<tool\s+name="execute_sql"\s*>(.*?)</tool\s*>', content, re.DOTALL | re.IGNORECASE)
            # Check for search_jds_and_goals tool call
            search_match = re.search(r'<tool\s+name="search_jds_and_goals"\s*>(.*?)</tool\s*>', content, re.DOTALL | re.IGNORECASE)
            
            if not sql_match and not search_match:
                # No tool call, this is the final response
                return content
                
            # Add LLM's thought with tool call to context
            messages.append(AIMessage(content=content))
            
            tool_output = ""
            if sql_match:
                sql_query = sql_match.group(1).strip()
                logger.info(f"AdminBrainAgent SQL tool call: {sql_query}")
                try:
                    results = await execute_safe_select(db, sql_query)
                    tool_output = f"<tool_result name=\"execute_sql\">\n{str(results)}\n</tool_result>"
                except Exception as e:
                    tool_output = f"<tool_result name=\"execute_sql\">\nError executing query: {str(e)}\n</tool_result>"
            elif search_match:
                search_query = search_match.group(1).strip()
                logger.info(f"AdminBrainAgent Pinecone tool call: {search_query}")
                try:
                    results = await search_brain_agent_knowledge(search_query)
                    tool_output = f"<tool_result name=\"search_jds_and_goals\">\n{str(results)}\n</tool_result>"
                except Exception as e:
                    tool_output = f"<tool_result name=\"search_jds_and_goals\">\nError: {str(e)}\n</tool_result>"
                    
            # Append tool output to messages
            messages.append(HumanMessage(content=tool_output))
            
        return "I'm sorry, I encountered an issue while processing your request. Please try again."
