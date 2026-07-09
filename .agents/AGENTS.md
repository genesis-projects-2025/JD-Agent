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

## 7. Brain Agent v3 Orchestrator
- **Multi-Tool Parsing**: The agent parses XML tags from response content. It uses `re.findall` (not `re.search`) to run all tool tags concurrently.
- **Context Boundaries**: The context window history is limited to the last 6 turns (not 10) to reduce token count.
- **Output Limit**: Gemini 2.5 Flash invocation limits response output to 2000 tokens (`max_output_tokens=2000`).
- **Entity Resolution**: Entities (like Employee IDs and departments) are extracted from user queries, LLM answers, and SQL results to proactively resolve pronouns.
- **Result Formatting**: SQL query outputs are auto-formatted into markdown tables, truncating cell content past 150 characters and capping responses at 30 rows. Semantic search outputs return metadata headers.
- **Post-processing**: The `_clean_response` utility filters out any leaked tool blocks or redundant newlines.
