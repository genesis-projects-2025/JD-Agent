"""
Admin Brain Agent Service v3.

Hybrid SQL + Vector agentic orchestrator with:
- Persistent conversation sessions (DB-backed)
- Langfuse tracing and prompt management
- Multi-tool concurrent execution (all tool calls per response)
- Entity tracking from user messages, assistant responses, and SQL results
- Proactive anomaly detection on new sessions
- Markdown-formatted tool results for token efficiency
- Response cleanup and 2000-token output limit
- 6-turn conversation history window
"""

import logging
import re
import uuid
import json
from typing import Any, Dict, List, AsyncIterator, Optional
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.messages import SystemMessage, HumanMessage, AIMessage
from sqlalchemy import select, desc, text
from sqlalchemy.ext.asyncio import AsyncSession
import asyncio

from app.core.config import settings
from app.core.langfuse_client import get_compiled_prompt, get_langfuse_callback_handler
from app.agents.prompts import BRAIN_AGENT_SYSTEM_PROMPT
from app.services.db_query_service import execute_safe_select
from app.services.vector_service import get_embeddings, get_index_async
from app.services.brain_agent_anomaly_service import run_diagnostics, format_anomaly_context
from app.models.brain_agent_model import BrainAgentSession, BrainAgentConversationTurn
from app.agents.admin_brain_state import BaseAgentState

logger = logging.getLogger(__name__)


# Maximum output tokens for brain agent responses
MAX_OUTPUT_TOKENS = 2000


def _get_brain_agent_llm():
    return ChatGoogleGenerativeAI(
        google_api_key=settings.GEMINI_API_KEY,
        model="gemini-2.5-flash",
        temperature=0.1,
        max_tokens=4000,
        max_output_tokens=4000,
    )


async def search_brain_agent_knowledge(
    query_text: str,
    top_k: int = 8,
    token_budget: int = 2000,
    filters: Optional[Dict[str, Any]] = None,
) -> List[Dict[str, Any]]:
    """Enhanced semantic search with reranking, dedup, token budget, and dynamic filters for Brain Agent."""
    try:
        query_vec = await asyncio.to_thread(
            lambda: get_embeddings().embed_query(query_text)
        )
        idx = await get_index_async()
        if not idx:
            return []

        query_args = {
            "vector": query_vec,
            "top_k": max(top_k * 3, 20),
            "include_metadata": True,
        }
        if filters:
            query_args["filter"] = filters

        results = await asyncio.to_thread(
            lambda: idx.query(**query_args)
        )

        scored = []
        seen_keys = {}  # track count per role::category
        for match in results.get("matches", []):
            meta = match.get("metadata", {})
            text_val = meta.get("text", "").strip()
            score = float(match.get("score", 0))

            if score < 0.35 or not text_val:
                continue

            role = meta.get("role_title", "N/A")
            category = meta.get("category", "general")
            department = meta.get("department", "N/A")
            emp_id = meta.get("employee_id") or "N/A"

            # Light dedup: max 2 chunks per role+category combo
            dedup_key = f"{role}::{category}"
            if seen_keys.get(dedup_key, 0) >= 2:
                continue
            seen_keys[dedup_key] = seen_keys.get(dedup_key, 0) + 1

            scored.append({
                "score": score,
                "text": text_val,
                "category": category,
                "role_title": role,
                "department": department,
                "employee_id": emp_id,
            })

        scored.sort(key=lambda x: x["score"], reverse=True)

        # Token-budget-aware truncation
        results_out = []
        consumed = 0
        for item in scored:
            est = len(item["text"]) // 4
            if consumed + est > token_budget:
                break
            results_out.append(item)
            consumed += est
            if len(results_out) >= top_k:
                break

        return results_out
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


def _extract_entities_from_sql_results(results: List[Dict]) -> Dict[str, Any]:
    """Extract employee IDs and names from SQL query results for entity tracking."""
    entities = {}
    if not results:
        return entities
    for row in results:
        for key, val in row.items():
            val_str = str(val).strip()
            # Employee IDs
            if re.match(r'^E\d{3,5}$', val_str):
                entities["last_employee_id"] = val_str
            # Employee names from common column names
            if key in ("name", "employee_name", "emp_name") and val_str and len(val_str) > 2:
                entities["last_employee_name"] = val_str
            # Department
            if key in ("department", "dept") and val_str and len(val_str) > 2:
                entities["last_department"] = val_str
    return entities


def _format_sql_results_as_markdown(results: List[Dict]) -> str:
    """Convert SQL results to a compact markdown table for token efficiency."""
    if not results:
        return "No results found."
    # Cap rows to prevent token explosion
    truncated = False
    if len(results) > 30:
        results = results[:30]
        truncated = True

    headers = list(results[0].keys())
    lines = ["| " + " | ".join(str(h) for h in headers) + " |"]
    lines.append("| " + " | ".join(["---"] * len(headers)) + " |")
    for row in results:
        row_vals = []
        for h in headers:
            val = row.get(h, "")
            # Truncate long cell values
            val_str = str(val) if val is not None else ""
            if len(val_str) > 150:
                val_str = val_str[:147] + "..."
            row_vals.append(val_str)
        lines.append("| " + " | ".join(row_vals) + " |")

    table = "\n".join(lines)
    if truncated:
        table += "\n\n*Results truncated to 30 rows. Use more specific filters to narrow down.*"
    return table


def _format_search_results(results: List[Dict]) -> str:
    """Format vector search results with metadata context."""
    if not results:
        return "No matching documents found in the knowledge base."
    lines = []
    for r in results:
        lines.append(
            f"**[{r.get('category', 'general').upper()}]** "
            f"Role: {r.get('role_title', 'N/A')} | "
            f"Dept: {r.get('department', 'N/A')}\n{r.get('text', '')}"
        )
    return "\n\n---\n\n".join(lines)


def _clean_response(content: str) -> str:
    """Post-process: remove leaked tool XML, clean formatting."""
    # Remove any leaked tool/tool_result tags
    content = re.sub(r'<tool[^>]*>.*?</tool\s*>', '', content, flags=re.DOTALL)
    content = re.sub(r'<tool_result[^>]*>.*?</tool_result\s*>', '', content, flags=re.DOTALL)
    # Remove empty headers
    content = re.sub(r'#{1,4}\s*\n', '', content)
    # Collapse excessive newlines
    content = re.sub(r'\n{4,}', '\n\n\n', content)
    # Collapse excessive spaces (5 or more consecutive spaces to 4 spaces)
    content = re.sub(r' {5,}', '    ', content)
    return content.strip()


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


def _format_containerized_memories(memories: List[Dict[str, Any]]) -> str:
    """Format retrieved vector database memories into string-bounded containers."""
    if not memories:
        return "No verified corporate records found matching this query in the vector store."
    
    containers = []
    for m in memories:
        containers.append(
            f"--- [VERIFIED ENTERPRISE RECORD] ---\n"
            f"ROLE: {m.get('role_title', 'N/A')}\n"
            f"DEPT: {m.get('department', 'N/A')}\n"
            f"CATEGORY: {m.get('category', 'general').upper()}\n"
            f"CONTENT: {m.get('text', '')}\n"
            f"-----------------"
        )
    return "\n\n".join(containers)


def _format_resolved_employee_record(resolved: Dict[str, Any]) -> str:
    """Format resolved SQL employee record into a verified profile block."""
    if not resolved:
        return ""
    return (
        f"--- [VERIFIED ENTERPRISE RECORD: EMPLOYEE PROFILE] ---\n"
        f"EMPLOYEE ID: {resolved.get('code', 'N/A')}\n"
        f"NAME: {resolved.get('employee_name', 'N/A')}\n"
        f"DEPARTMENT: {resolved.get('department', 'N/A')}\n"
        f"DESIGNATION: {resolved.get('designation', 'N/A')}\n"
        f"------------------------------------------------------"
    )


async def _detect_query_intent(message: str, llm) -> Dict[str, Any]:
    """Parse user message to extract scope, target name, and analytical query types."""
    intent_prompt = f"""You are the query routing parser for Pulse Pharma's Executive Intelligence System.
Analyze the user's incoming message and determine all relevant query types that are required to answer the query fully.

Allowed target_scope values:
- "EMPLOYEE": The query targets a specific individual (e.g. "What are Naresh's KPIs?", "List tools used by E102", "Bhanu Prasad profile").
- "DEPARTMENT": The query targets a department (e.g. "QC skills gap", "What are the roles in Quality Assurance?", "Accounts team software").
- "GLOBAL": The query is company-wide, general, compares departments, or checks company metrics (e.g. "Weight compliance issues", "Compare automation ranks across departments", "List all employees without JDs").

Allowed query_type values to include in the query_types array:
- "POINT_LOOKUP": Lookup queries about a single specific employee or a single specific role (e.g. "What is Hema's JD?", "Who does E1014 report to?").
- "AGGREGATE_RANKING": High-level rankings, comparisons, or metrics queries across departments or roles (e.g. "which tasks in Accounts have the highest automation potential?", "list top manual roles in Production").
- "QUALITATIVE_SUMMARY": Queries asking for general summaries of what a team or department does (e.g. "what is the QA team doing?", "summarize the work of the HR department").
- "RELATIONSHIP_QUERY": Queries exploring coordination, dependencies, or reporting paths between departments or roles (e.g. "how does IT's work affect accounts?", "who reports to the Director of Production?").
- "BOTTLENECK_ANALYSIS": Audits of operational bottlenecks, delays, stalled workflows, or compliance issues (e.g. "where are the bottlenecks in QA?", "what are the operational risks in Production?").

User Message: "{message}"

Return ONLY a raw JSON object matching this schema, without any markdown formatting, backticks, or prefix/suffix text:
{{
  "query_types": ["query_type_1", "query_type_2", ...],
  "target_scope": "EMPLOYEE" | "DEPARTMENT" | "GLOBAL",
  "target_name": "name of employee/department extracted" | null
}}
"""
    try:
        response = await llm.ainvoke([
            SystemMessage(content="You are a strict JSON parser. Output only valid raw JSON. No markdown blocks."),
            HumanMessage(content=intent_prompt)
        ])
        content = response.content.strip()
        if content.startswith("```"):
            lines = content.split("\n")
            if lines[0].startswith("```json") or lines[0].startswith("```"):
                content = "\n".join(lines[1:-1]).strip()
        parsed = json.loads(content)
        qtypes = parsed.get("query_types", [])
        if not qtypes and "query_type" in parsed:
            qtypes = [parsed["query_type"]]
        if not qtypes:
            qtypes = ["POINT_LOOKUP"]
            
        return {
            "query_type": qtypes[0],
            "query_types": qtypes,
            "target_scope": parsed.get("target_scope", "GLOBAL"),
            "target_name": parsed.get("target_name"),
            "analytical_intent": "LOOKUP"  # Kept for backward compatibility in state
        }
    except Exception as e:
        logger.warning(f"Failed to parse query intent: {e}. Defaulting to POINT_LOOKUP.")
        return {
            "query_type": "POINT_LOOKUP",
            "query_types": ["POINT_LOOKUP"],
            "target_scope": "GLOBAL",
            "target_name": None,
            "analytical_intent": "LOOKUP"
        }


def _get_department_aliases(dept_name: str) -> List[str]:
    """Map a department name to all possible synonyms in both organogram and enrichment tables."""
    dept_lower = dept_name.lower().strip()
    
    groups = [
        # Accounts / Finance Group
        {"accounts", "finance", "finance & accounting", "finance and accounting", "accounts department"},
        # QA / Quality Group
        {"quality assurance", "qa", "cqa", "quality", "head - quality", "quality assurance department"},
        # QC / Quality Control Group
        {"quality control", "qc"},
        # HR Group
        {"hr", "hrd", "hr & admin", "hrd (plant)", "human resources development (hrd)", "hr operations", "learning & development", "learing & development"},
        # Procurement / Sourcing Group
        {"procurement", "material sourcing", "procurement (material sourcing)", "scm & commercials", "scm"},
        # R&D Group
        {"research & development", "r&d", "research and development", "analytical r&d", "formulation r&d", "api r&d", "nano r&d", "nano r&d (formulations)"},
        # Production Group
        {"production", "production-tts", "production (liq)", "production (osd)", "plant operations"}
    ]
    
    # If the dept_name falls into any group, return the whole group
    for g in groups:
        if any(alias in dept_lower or dept_lower in alias for alias in g):
            # Normalize list to return strings exactly matching the cases we saw in database
            # We want to match what's in the DB:
            db_candidates = [
                "Finance & Accounting", "Accounts", "Finance",
                "Quality Assurance", "Quality Control", "CQA", "Quality",
                "HRD", "HRD (Plant)", "HR", "HR & Admin", "Human Resources Development (HRD)", "Learing & Development",
                "Procurement", "Material Sourcing", "Procurement (Material Sourcing)", "SCM & Commercials",
                "Research & Development", "Analytical R&D", "Formulation R&D", "API R&D", "Nano R&D",
                "Production", "Production-TTS", "Production (Liq)", "Production (OSD)", "Plant Operations"
            ]
            matched = []
            for candidate in db_candidates:
                if candidate.lower() in g:
                    matched.append(candidate)
            if matched:
                return matched
            return list(g)
            
    return [dept_name]


async def _resolve_entities(state: BaseAgentState, db: AsyncSession) -> BaseAgentState:
    """Fuzzy-match and resolve target names (employee/department) to verified database entries."""
    scope = state["target_scope"]
    name = state["target_name"]
    
    if scope == "EMPLOYEE" and name:
        # Check if direct ID search (e.g. E104)
        if re.match(r'^E\d{3,5}$', name.strip(), re.IGNORECASE):
            emp_id = name.strip().upper()
            query = text("""
                SELECT code, employee_name, department, designation 
                FROM organogram 
                WHERE code = :emp_id 
                LIMIT 1
            """)
            res = await db.execute(query, {"emp_id": emp_id})
            row = res.mappings().first()
            if row:
                state["target_id"] = row["code"]
                state["target_name"] = row["employee_name"]
                state["worker_results"]["resolved_employee"] = dict(row)
                return state
        
        # 1. Fetch all employees to perform fuzzy/partial/disambiguation checks in memory
        query_all = text("SELECT code, employee_name, department, designation FROM organogram")
        res_all = await db.execute(query_all)
        all_employees = [dict(r) for r in res_all.mappings().all()]
        
        # 2. Check if a department is mentioned in the user message for disambiguation
        mentioned_depts = []
        user_msg_lower = state["user_message"].lower()
        for group in [
            {"accounts", "finance", "finance & accounting", "accounts department"},
            {"quality assurance", "qa", "cqa", "quality", "quality assurance department"},
            {"quality control", "qc", "quality control department"},
            {"hr", "hrd", "hr & admin", "hrd (plant)", "human resources development (hrd)", "learning & development"},
            {"procurement", "material sourcing", "scm"},
            {"research & development", "r&d", "analytical r&d", "formulation r&d", "api r&d", "nano r&d"},
            {"production", "production-tts", "production (liq)", "production (osd)", "plant operations"}
        ]:
            if any(alias in user_msg_lower for alias in group):
                mentioned_depts.extend(group)
        
        # 3. Filter candidates based on name matching
        name_to_resolve = name.strip().lower()
        candidates = []
        
        for emp in all_employees:
            emp_name_lower = emp["employee_name"].lower()
            words = name_to_resolve.split()
            # If all words of the search name are in the employee name, or it's a substring
            if all(w in emp_name_lower for w in words) or emp_name_lower in words:
                candidates.append(emp)
                
        # If no substring matches, try difflib get_close_matches for typo-tolerance
        if not candidates:
            import difflib
            emp_names = [emp["employee_name"] for emp in all_employees]
            close_names = difflib.get_close_matches(name, emp_names, n=5, cutoff=0.4)
            candidates = [emp for emp in all_employees if emp["employee_name"] in close_names]
            
        # 4. If we have multiple candidates and a department is mentioned, filter by department
        if len(candidates) > 1 and mentioned_depts:
            filtered = [
                emp for emp in candidates
                if emp["department"].lower() in mentioned_depts
                or any(alias in emp["department"].lower() for alias in mentioned_depts)
            ]
            if filtered:
                candidates = filtered
                
        # 5. Handle resolved candidates
        if not candidates:
            state["is_final"] = True
            state["final_response"] = f"Data Error: No employee matching the name '{name}' was found within the company database."
        elif len(candidates) == 1:
            resolved = candidates[0]
            state["target_id"] = resolved["code"]
            state["target_name"] = resolved["employee_name"]
            state["worker_results"]["resolved_employee"] = resolved
            
            # If the matched name is different from the input name, add a resolution note
            if resolved["employee_name"].lower() != name.strip().lower():
                state["worker_results"]["resolution_note"] = f"Showing records for **{resolved['employee_name']}**, as no exact match was found for '{name}'."
        else:
            state["is_final"] = True
            options_str = "\n".join(f"- **{emp['employee_name']}** ({emp['code']}) — {emp['designation']} in {emp['department']}" for emp in candidates)
            state["final_response"] = (
                f"I found multiple employees matching '{name}' in the database. "
                f"Please specify which of the following you are referring to:\n\n{options_str}"
            )
            
    elif scope == "DEPARTMENT" and name:
        # Match department substrings in organogram
        query = text("""
            SELECT DISTINCT department 
            FROM organogram 
            WHERE department ILIKE :dept 
            LIMIT 1
        """)
        res = await db.execute(query, {"dept": f"%{name.strip()}%"})
        row = res.mappings().first()
        if row:
            state["target_name"] = row["department"]
        else:
            # Fallback to checking task_automation_scores
            query_tas = text("""
                SELECT DISTINCT department 
                FROM task_automation_scores 
                WHERE department ILIKE :dept 
                LIMIT 1
            """)
            res_tas = await db.execute(query_tas, {"dept": f"%{name.strip()}%"})
            row_tas = res_tas.mappings().first()
            if row_tas:
                state["target_name"] = row_tas["department"]
            else:
                # Fallback to checking mapping of abbreviations / aliases (e.g. QC, QA, HR, IT, R&D)
                name_lower = name.lower().strip()
                resolved_dept = None
                
                if "qc" in name_lower or "quality control" in name_lower:
                    resolved_dept = "Quality Control"
                elif "qa" in name_lower or "quality assurance" in name_lower:
                    resolved_dept = "Quality Assurance"
                elif "cqa" in name_lower:
                    resolved_dept = "CQA"
                elif "hr" in name_lower or "human resources" in name_lower or "hrd" in name_lower:
                    resolved_dept = "HR & Admin"
                elif "finance" in name_lower or "accounts" in name_lower:
                    resolved_dept = "Finance"
                elif "r&d" in name_lower or "research" in name_lower:
                    resolved_dept = "Research & Development"
                elif "production" in name_lower:
                    resolved_dept = "Production"
                elif "it" in name_lower or "tech" in name_lower:
                    resolved_dept = "IT"
                
                if resolved_dept:
                    query_verify = text("""
                        SELECT DISTINCT department 
                        FROM organogram 
                        WHERE department ILIKE :dept 
                        LIMIT 1
                    """)
                    res_ver = await db.execute(query_verify, {"dept": f"%{resolved_dept}%"})
                    row_ver = res_ver.mappings().first()
                    if row_ver:
                        state["target_name"] = row_ver["department"]
            
    return state


def _build_in_clause(prefix: str, items: list[str]) -> tuple[str, dict[str, str]]:
    """Build a standard SQL IN clause placeholder string and its bind parameter dictionary."""
    if not items:
        return "('')", {}
    placeholders = [f":{prefix}_{i}" for i in range(len(items))]
    in_str = f"({', '.join(placeholders)})"
    binds = {f"{prefix}_{i}": item for i, item in enumerate(items)}
    return in_str, binds


async def _retrieve_knowledge(state: BaseAgentState, db: AsyncSession) -> BaseAgentState:
    """Build dynamic metadata filters and retrieve context based on query_types routing."""
    if state["is_final"]:
        return state
        
    query_types = state.get("query_types", [state.get("query_type", "POINT_LOOKUP")])
    all_memories = []
    
    for query_type in query_types:
        if query_type == "POINT_LOOKUP":
            filters = {}
            if state["target_scope"] == "EMPLOYEE" and state["target_id"]:
                emp_code = state["target_id"]
                # Retrieve approved JD session ID if it exists
                jd_query = text("SELECT id FROM jd_sessions WHERE employee_id = :emp_code AND status = 'approved' LIMIT 1")
                jd_res = await db.execute(jd_query, {"emp_code": emp_code})
                jd_row = jd_res.mappings().first()
                
                # Build dynamic OR-filter compatibility for old and new indexes
                filter_list = [
                    {"employee_id": emp_code},
                    {"jd_id": f"KRA_{emp_code}"}
                ]
                if jd_row:
                    filter_list.append({"jd_id": str(jd_row["id"])})
                    
                filters = {"$or": filter_list}
                
            elif state["target_scope"] == "DEPARTMENT" and state["target_name"]:
                filters = {"department": state["target_name"]}
                
            state["worker_results"]["pinecone_filters"] = filters
            
            # Execute query
            results = await search_brain_agent_knowledge(
                query_text=state["enhanced_query"],
                top_k=8,
                filters=filters
            )
            
            # Fallback for DEPARTMENT: if filtered search returns 0, try without department filter
            if state["target_scope"] == "DEPARTMENT" and not results and filters:
                logger.info(f"Department filter {filters} returned 0 results. Retrying search without department filter.")
                # Clear filters in worker results so that the agent's tools don't inherit the broken filter either
                state["worker_results"]["pinecone_filters"] = None
                results = await search_brain_agent_knowledge(
                    query_text=state["enhanced_query"],
                    top_k=8,
                    filters=None
                )

            # Safeguard: if target_scope is EMPLOYEE but zero vector results returned, short-circuit
            if state["target_scope"] == "EMPLOYEE" and not results:
                state["is_final"] = True
                state["final_response"] = f"Data Error: No employee matching the name '{state['target_name']}' was found within the company database."
                return state
            else:
                all_memories.extend(results)
                
        elif query_type == "AGGREGATE_RANKING":
            dept = state["target_name"]
            if state["target_scope"] == "DEPARTMENT" and dept:
                # Check if user wants manual tasks or automatable tasks
                user_msg = state["user_message"].lower()
                sort_order = "ASC" if any(k in user_msg for k in ["manual", "hand", "physical", "non-automated", "lowest"]) else "DESC"
                
                depts = _get_department_aliases(dept)
                in_str, binds = _build_in_clause("dept", depts)
                q = text(f"""
                    SELECT tas.employee_id, o.employee_name, o.designation, tas.task_text, tas.automation_score, tas.automation_reasoning, tas.suggested_tooling, tas.category
                    FROM task_automation_scores tas
                    LEFT JOIN organogram o ON o.code = tas.employee_id
                    WHERE tas.department IN {in_str} OR o.department IN {in_str}
                    ORDER BY tas.automation_score {sort_order}
                    LIMIT 10
                """)
                res = await db.execute(q, binds)
                rows = [dict(r) for r in res.mappings().all()]
                for r in rows:
                    tools = r.get("suggested_tooling", [])
                    tools_str = ", ".join(tools) if isinstance(tools, list) else str(tools)
                    emp_name = r.get("employee_name") or "Unknown Employee"
                    designation = r.get("designation") or "Staff"
                    all_memories.append({
                        "score": float(r["automation_score"]),
                        "category": r.get("category", "responsibilities"),
                        "role_title": f"{emp_name} ({designation})",
                        "department": dept,
                        "employee_id": r["employee_id"],
                        "text": f"Employee Name: {emp_name} ({r['employee_id']}) | Role: {designation}\nTask: {r['task_text']}\nAutomation Score: {r['automation_score']}\nReasoning: {r['automation_reasoning']}\nSuggested Tooling: {tools_str}"
                    })
            else:
                q = text("""
                    SELECT department, avg_automation_score, pct_tasks_high_automation_manual, headcount, cross_dept_dependency_count
                    FROM department_rollup_metrics
                    ORDER BY avg_automation_score DESC
                """)
                res = await db.execute(q)
                rows = [dict(r) for r in res.mappings().all()]
                for r in rows:
                    all_memories.append({
                        "score": float(r["avg_automation_score"]),
                        "category": "general",
                        "role_title": "Department Metric Rollup",
                        "department": r["department"],
                        "text": f"Department: {r['department']}\nAverage Automation Score: {r['avg_automation_score']}\nPercentage of High Automation Manual Tasks: {r['pct_tasks_high_automation_manual']}% | Headcount: {r['headcount']} | Cross-Department Dependencies: {r['cross_dept_dependency_count']}"
                    })

        elif query_type == "QUALITATIVE_SUMMARY":
            scope = state["target_scope"]
            name = state["target_name"]
            if scope == "DEPARTMENT" and name:
                depts = _get_department_aliases(name)
                in_str, binds = _build_in_clause("dept", depts)
                q = text(f"""
                    SELECT ws.employee_id, o.employee_name, o.designation, ws.summary_text, ws.top_tools 
                    FROM employee_work_summary ws
                    JOIN organogram o ON o.code = ws.employee_id
                    WHERE ws.department IN {in_str} OR o.department IN {in_str}
                    LIMIT 10
                """)
                res = await db.execute(q, binds)
                rows = [dict(r) for r in res.mappings().all()]
                for r in rows:
                    tools = r.get("top_tools", [])
                    tools_str = ", ".join(tools) if isinstance(tools, list) else str(tools)
                    all_memories.append({
                        "score": 1.0,
                        "category": "role_summary",
                        "role_title": f"{r['employee_name']} ({r['designation']})",
                        "department": name,
                        "employee_id": r["employee_id"],
                        "text": f"Employee: {r['employee_name']} ({r['employee_id']})\nRole: {r['designation']}\nSummary: {r['summary_text']}\nKey Tools Mapped: {tools_str}"
                    })
            elif scope == "EMPLOYEE" and state["target_id"]:
                q = text("""
                    SELECT ws.employee_id, ws.summary_text, ws.top_tools 
                    FROM employee_work_summary ws
                    WHERE ws.employee_id = :emp_id
                """)
                res = await db.execute(q, {"emp_id": state["target_id"]})
                row = res.mappings().first()
                if row:
                    tools = row.get("top_tools", [])
                    tools_str = ", ".join(tools) if isinstance(tools, list) else str(tools)
                    all_memories.append({
                        "score": 1.0,
                        "category": "role_summary",
                        "role_title": "Employee Summary",
                        "department": state["target_name"] or "General",
                        "employee_id": state["target_id"],
                        "text": f"Work Summary: {row['summary_text']}\nKey Tools Mapped: {tools_str}"
                    })

        elif query_type == "RELATIONSHIP_QUERY":
            scope = state["target_scope"]
            name = state["target_name"]
            if scope == "EMPLOYEE" and state["target_id"]:
                q = text("""
                    WITH RECURSIVE org_hierarchy AS (
                        SELECT code, employee_name, reporting_manager_code, designation, 1 AS depth
                        FROM organogram
                        WHERE code = :emp_id
                        
                        UNION ALL
                        
                        SELECT o.code, o.employee_name, o.reporting_manager_code, o.designation, h.depth + 1
                        FROM organogram o
                        JOIN org_hierarchy h ON o.code = h.reporting_manager_code
                        WHERE h.depth < 4
                    )
                    SELECT * FROM org_hierarchy;
                """)
                res = await db.execute(q, {"emp_id": state["target_id"]})
                rows = [dict(r) for r in res.mappings().all()]
                chain_str = "\n".join(f"Level {r['depth']}: {r['employee_name']} ({r['code']}), designation: {r['designation']} reports to manager code: {r['reporting_manager_code']}" for r in rows)
                all_memories.append({
                    "score": 1.0,
                    "category": "general",
                    "role_title": "Reporting Hierarchy Chain",
                    "department": "General",
                    "text": f"Reporting hierarchy (up to 3 hops):\n{chain_str}"
                })
            elif scope == "DEPARTMENT" and name:
                depts = _get_department_aliases(name)
                in_str, binds = _build_in_clause("dept", depts)
                q = text(f"""
                    SELECT from_department, to_department, dependency_type, description, confidence
                    FROM department_dependencies
                    WHERE from_department IN {in_str} OR to_department IN {in_str}
                    ORDER BY confidence DESC
                    LIMIT 15
                """)
                res = await db.execute(q, binds)
                rows = [dict(r) for r in res.mappings().all()]
                for r in rows:
                    all_memories.append({
                        "score": float(r["confidence"]),
                        "category": "general",
                        "role_title": "Department Dependency",
                        "department": name,
                        "text": f"Dependency: {r['from_department']} is linked to {r['to_department']} ({r['dependency_type']}). Description: {r['description']}"
                    })

        elif query_type == "BOTTLENECK_ANALYSIS":
            name = state["target_name"]
            if name:
                depts = _get_department_aliases(name)
                in_str, binds = _build_in_clause("dept", depts)
                q = text(f"""
                    SELECT insight_text, severity, evidence
                    FROM bottleneck_insights
                    WHERE department IN {in_str}
                    ORDER BY severity DESC
                """)
                res = await db.execute(q, binds)
                rows = [dict(r) for r in res.mappings().all()]
                for r in rows:
                    all_memories.append({
                        "score": 1.0,
                        "category": "general",
                        "role_title": "Bottleneck Insight",
                        "department": name,
                        "text": f"[{r['severity'].upper()}] Insight: {r['insight_text']}\nEvidence Metrics: {json.dumps(r['evidence'])}"
                    })
            else:
                q = text("""
                    SELECT department, insight_text, severity, evidence
                    FROM bottleneck_insights
                    ORDER BY severity DESC
                    LIMIT 20
                """)
                res = await db.execute(q)
                rows = [dict(r) for r in res.mappings().all()]
                for r in rows:
                    all_memories.append({
                        "score": 1.0,
                        "category": "general",
                        "role_title": "Bottleneck Insight",
                        "department": r["department"],
                        "text": f"Department: {r['department']}\n[{r['severity'].upper()}] Insight: {r['insight_text']}\nEvidence Metrics: {json.dumps(r['evidence'])}"
                    })
                    
    state["retrieved_memories"] = all_memories
    return state
        
    return state


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
    ) -> AsyncIterator[Dict[str, Any]]:
        """
        Runs the conversational tool-use loop with full persistence,
        Langfuse tracing, multi-tool concurrency, entity tracking,
        intent parsing, strict metadata filtering, and compliance safeguards.
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

            # ── BaseAgentState Initialization ──
            state: BaseAgentState = {
                "user_message": message,
                "target_scope": "GLOBAL",
                "target_name": None,
                "target_id": None,
                "analytical_intent": "LOOKUP",
                "retrieved_memories": [],
                "enhanced_query": message,
                "worker_results": {},
                "is_final": False,
                "final_response": None,
            }

            # ── Node 1: Intent Detection ──
            yield {"type": "status", "content": "Analyzing query scope and intent..."}
            parsed_intent = await _detect_query_intent(message, llm)
            state.update(parsed_intent)
            
            # If entity context has a department or employee name, and intent detector didn't find one, resolve from context
            if not state["target_name"] and state["target_scope"] == "EMPLOYEE" and entity_context.get("last_employee_name"):
                state["target_name"] = entity_context["last_employee_name"]
            if not state["target_name"] and state["target_scope"] == "DEPARTMENT" and entity_context.get("last_department"):
                state["target_name"] = entity_context["last_department"]

            # ── Node 2: Entity Resolution (SQL verification) ──
            yield {"type": "status", "content": f"Resolving entities for {state['target_scope']} scope..."}
            state = await _resolve_entities(state, db)

            # ── Node 3: Filter & Retrieval Node ──
            if not state["is_final"]:
                yield {"type": "status", "content": "Retrieving context records from knowledge base..."}
                state = await _retrieve_knowledge(state, db)

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

            # ── Safeguard Short-Circuit Check ──
            if state["is_final"] and state["final_response"]:
                # Stream the error/safe response directly
                content = state["final_response"]
                words = re.split(r'(\s+)', content)
                for word in words:
                    if word:
                        yield {"type": "chunk", "content": word}
                        await asyncio.sleep(0.008)

                assistant_turn = BrainAgentConversationTurn(
                    session_id=session.id,
                    turn_index=next_turn_index,
                    role="assistant",
                    content=content,
                    tool_calls=None,
                )
                db.add(assistant_turn)
                
                # Write to query_logs
                try:
                    from app.models.enrichment_model import QueryLog
                    async with db.begin_nested():
                        log = QueryLog(
                            query=message,
                            query_type=state.get("query_type", "POINT_LOOKUP"),
                            answer=content
                        )
                        db.add(log)
                except Exception as _le:
                    logger.warning(f"Failed to log short-circuit query: {_le}")

                await db.commit()
                return

            # ── Node 4: Anomaly Diagnostics (Disabled by User Request) ──
            anomaly_text = ""

            # ── Node 5: Compliance Oracle Prompt Assembly ──
            entity_text = _format_entity_context(entity_context)
            system_prompt = get_compiled_prompt(
                "brain-agent-system",
                BRAIN_AGENT_SYSTEM_PROMPT,
                entity_context=entity_text,
                anomaly_context=anomaly_text,
            )
            
            # Format and inject containerized verified memories
            resolved_emp = state["worker_results"].get("resolved_employee")
            profile_context = _format_resolved_employee_record(resolved_emp)
            containerized_context = _format_containerized_memories(state["retrieved_memories"])
            
            if profile_context:
                containerized_context = profile_context + "\n\n" + containerized_context
                
            compliance_block = f"""
--- [COMPLIANCE ORACLE RESTRICTIONS] ---
You are a rigid corporate compliance oracle. You have zero external training knowledge. 
If the containerized context blocks do not contain the answer, you MUST use your tools (execute_sql and search_jds_and_goals) to search the database and vector registry for the necessary records. 
Only if you have exhausted your tool calls and still cannot find the data in the retrieved context blocks or SQL results, should you state:
"Sufficient internal data not found to fulfill this query."
Do not synthesize, infer, or hallucinate names, metrics, or software tools. Rely ONLY on the verified records.
----------------------------------------

--- [CONTAINERIZED KNOWLEDGE BASE MEMORIES] ---
{containerized_context}
-----------------------------------------------
"""
            system_prompt = system_prompt + "\n\n" + compliance_block

            # ── Build LangChain Message History ──
            messages = [SystemMessage(content=system_prompt)]

            # Load persisted turns from DB (last 6 turns)
            if session_id and session:
                db_turns_result = await db.execute(
                    select(BrainAgentConversationTurn)
                    .where(BrainAgentConversationTurn.session_id == session.id)
                    .order_by(BrainAgentConversationTurn.turn_index)
                )
                db_turns = db_turns_result.scalars().all()
                for turn in db_turns[-6:]:
                    if turn.role == "user":
                        messages.append(HumanMessage(content=turn.content))
                    else:
                        messages.append(AIMessage(content=turn.content))

            messages.append(HumanMessage(content=message))

            # ── Extract entities from user message ──
            user_entities = _extract_entities(message)
            if user_entities:
                entity_context.update(user_entities)

            # ── Langfuse Callback ──
            handler = get_langfuse_callback_handler(
                trace_name="brain-agent-chat",
                session_id=str(session.id),
                user_id=admin_user,
                tags=["brain-agent"],
            )
            callbacks = [handler] if handler else []

            # If there's a resolution note from fuzzy matching, yield it to the user first
            if "resolution_note" in state.get("worker_results", {}):
                note = state["worker_results"]["resolution_note"]
                yield {"type": "chunk", "content": f"*{note}*\n\n"}

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

                # ── Multi-Tool Parsing (all tool calls via findall) ──
                sql_matches = re.findall(
                    r'<tool\s+name\s*=\s*["\']?execute_sql["\']?\s*>(.*?)</tool\s*>',
                    content, re.DOTALL | re.IGNORECASE,
                )
                search_matches = re.findall(
                    r'<tool\s+name\s*=\s*["\']?search_jds_and_goals["\']?\s*>(.*?)</tool\s*>',
                    content, re.DOTALL | re.IGNORECASE,
                )

                if not sql_matches and not search_matches:
                    # Final response — clean and stream it
                    content = _clean_response(content)
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

                    # Update entity context from response
                    new_entities = _extract_entities(content)
                    if new_entities:
                        entity_context.update(new_entities)
                        session.entity_context = entity_context

                    # Write to query_logs
                    try:
                        from app.models.enrichment_model import QueryLog
                        async with db.begin_nested():
                            log = QueryLog(
                                query=message,
                                query_type=state.get("query_type", "POINT_LOOKUP"),
                                answer=content
                            )
                            db.add(log)
                    except Exception as _le:
                        logger.warning(f"Failed to log standard query: {_le}")

                    await db.commit()
                    return

                # Store thought with tool calls
                messages.append(AIMessage(content=content))

                # Execute ALL tools concurrently
                async def run_sql(query: str) -> str:
                    try:
                        results = await execute_safe_select(db, query)
                        # Extract entities from SQL results for context tracking
                        sql_entities = _extract_entities_from_sql_results(results)
                        if sql_entities:
                            entity_context.update(sql_entities)
                        formatted = _format_sql_results_as_markdown(results)
                        return f'<tool_result name="execute_sql">\n{formatted}\n</tool_result>'
                    except Exception as e:
                        return f'<tool_result name="execute_sql">\nError: {str(e)}\n</tool_result>'

                async def run_search(query: str) -> str:
                    try:
                        # Strictly pass the resolved filters to prevent context bleeding in searches
                        results = await search_brain_agent_knowledge(
                            query, 
                            filters=state["worker_results"].get("pinecone_filters")
                        )
                        formatted = _format_search_results(results)
                        return f'<tool_result name="search_jds_and_goals">\n{formatted}\n</tool_result>'
                    except Exception as e:
                        return f'<tool_result name="search_jds_and_goals">\nError: {str(e)}\n</tool_result>'

                tasks = []
                # Process ALL SQL tool calls
                for sql_query_str in sql_matches:
                    sql_query = sql_query_str.strip()
                    yield {"type": "status", "content": "Querying corporate database..."}
                    yield {"type": "tool_call", "tool": "execute_sql", "query": sql_query}
                    tasks.append(run_sql(sql_query))
                    all_tool_calls.append({"tool": "execute_sql", "query": sql_query})

                # Process ALL search tool calls
                for search_query_str in search_matches:
                    search_query = search_query_str.strip()
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
