# Workspace Memory & Rules for JD-Agent

This repository is integrated with Langfuse for prompt management and LLM observability (tracing).

## 1. Prompt Management
- **Centralized Fallbacks**: All fallback templates are stored inside `backend/app/agents/prompts.py` using double-curly brace Mustache syntax (`{{variable}}`).
- **Prompt Compiling**: Never format templates manually. Always import `get_compiled_prompt` from `app.core.langfuse_client` to compile templates.
  ```python
  from app.core.langfuse_client import get_compiled_prompt
  from app.agents.prompts import MY_PROMPT_TEMPLATE
  
  compiled = get_compiled_prompt("my-prompt-name", MY_PROMPT_TEMPLATE, var1="value1")
  ```
- **Fallback Guarantee**: If Langfuse credentials are not set or the API call fails, the client automatically defaults to local Mustache compilation using the static template in `prompts.py`.

## 2. Tracing & Observability
- All LangChain `ainvoke` operations are instrumented with Langfuse callback handlers.
- To retrieve a handler, import `get_langfuse_callback_handler` and pass it to `ainvoke`:
  ```python
  from app.core.langfuse_client import get_langfuse_callback_handler
  
  handler = get_langfuse_callback_handler(trace_name="my-trace-name")
  callbacks = [handler] if handler else []
  
  response = await llm.ainvoke(messages, callbacks=callbacks)
  ```

## 3. Environment Setup
- Langfuse is configured in `backend/.env` via the following keys:
  - `LANGFUSE_PUBLIC_KEY`
  - `LANGFUSE_SECRET_KEY`
  - `LANGFUSE_BASE_URL`

## 4. SQL Transaction Safety (Critical)
- **Savepoints (begin_nested)**: Any service or router running raw/arbitrary SQL queries on the SQLAlchemy session (such as user-submitted/LLM-generated queries) MUST wrap execution inside a savepoint transaction block:
  ```python
  async with db.begin_nested():
      result = await db.execute(...)
  ```
- **Transaction Poisoning**: If a raw query encounters a database error (e.g. column name mismatch or syntax error) and is *not* protected by `begin_nested()`, the entire PostgreSQL transaction is poisoned. All subsequent commits on the same session will crash with `InFailedSqlTransaction`.

## 5. PostgreSQL Column Types & Casting Quirks
- **UUID vs String(36)**: `KRAKPISession.jd_session_id` is defined as a `String(36)` rather than a standard Postgres `UUID` type.
- **Type Compatibility**: When executing session queries using SQLAlchemy, always cast UUID objects to strings using `str(uuid_val)`. Attempting to query `String` columns directly with UUID objects raises `UndefinedFunctionError` or `ProgrammingError` from asyncpg.

## 6. KRA/KPI Executive Bypass
- **Prerequisite Rules**: Normal KRA/KPI generation requires that both the employee's JD, the manager's JD, and the manager's KRA/KPI frameworks exist and are approved.
- **Bypass Rule**: Executive/high-level roles (Director, VP, CEO, MD, President) reporting directly to managing structures do not require manager JDs/KRAs. Check employee designation or level in `organogram` and bypass these checks when true inside `kra_kpi_service.py`.

## 7. Brain Agent v3 Orchestrator & Optimizations
- **Semantic Caching**: Uses a thread-safe, TTL-expiring, LRU in-memory query cache (`brain_agent_cache_service.py`) to skip LLM calls on repeated/similar queries (similarity threshold `0.92`).
- **JIT Tool Execution & Sequential Processing**: Pre-retrieval knowledge loading is disabled. The agent queries corporate data dynamically. Multiple SQL queries are processed sequentially (not concurrently) to prevent SQLAlchemy `AsyncSession` connection errors.
- **Zero-Cost Intent Classification**: Classified query intent is logged dynamically based on actual tool usage (e.g. `SQL_QUERY`, `VECTOR_SEARCH`), eliminating the intent detection LLM call.
- **History Summarization**: Older assistant turns (past the last 2 recent turns) are represented in history via short one-sentence Python-generated summaries to save token space.
- **Tightened Data Limits**: SQL markdown tables are capped at 15 rows (from 30) and cell contents are truncated at 80 characters (from 150). Vector searches are capped at `top_k=4` and `1200` tokens.
- **PostgreSQL Column Naming**: The job level column in the `organogram` table is physically named `joblevel` (without underscore). The system prompt must always specify `joblevel` to avoid `UndefinedColumnError`.
- **Post-processing**: The `_clean_response` utility filters out any leaked tool blocks or redundant newlines.

## 8. Strict Prompt Token Optimization & Payload Isolation
- **Clean History Text Enforcement**: `SessionMemory.add_turn`, `SessionMemory.load_history_from_db`, `run_interview_turn`, `run_interview_turn_stream`, `handle_conversation`, and `sync_session_to_db` MUST NEVER store full response JSON payloads (e.g. `employee_role_insights`, `suggested_tasks`) inside `ConversationTurn` or `recent_messages`.
- **Payload Sanitization**: Always use `clean_history_content()` to extract ONLY the plain `next_question` text string (~200 chars / 50 tokens). Raw JSON objects in assistant turns must be stripped before being saved to PostgreSQL DB or passed into Gemini `AIMessage` prompt history.
- **Auto-Population Prompt Capping**: `_auto_populate_inventory` in `interview.py` must truncate workflow step descriptions and cap RAG context snippets to keep batch prompts under 1,200 tokens.
- **Token Efficiency Guarantee**: Keeps interview prompt stack size at ~2.5k tokens per turn (down from 402,000 tokens), guaranteeing JD creation cost remains ~₹0.50 INR per complete session without losing any structured insights or UI state functionality.
