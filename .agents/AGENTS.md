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
