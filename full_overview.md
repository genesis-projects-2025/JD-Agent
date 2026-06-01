# Project Architecture & File Registry: `full_overview.md`

> **Generated from live codebase analysis — May 2026**  
> Stack: FastAPI · LangGraph · Google Gemini · Pinecone · PostgreSQL · Redis · Next.js 14 · TypeScript

---

## 1. System-Wide Architecture Overview

JD-Agent is a **Multi-Agent, Layered Architecture** application for AI-driven Job Description creation. Its architectural pattern combines:

- **Multi-Agent Orchestration (LangGraph)** — A compiled `StateGraph` routes each user message through a pipeline of 7 specialized agents: `BasicInfoAgent → WorkflowIdentifierAgent → DeepDiveAgent → ToolsAgent → SkillsAgent → QualificationAgent → JDGeneratorAgent`, each enforcing strict completion criteria before advancing.
- **Layered Backend (FastAPI)** — `Routers → Services → Agents/CRUD → Database`. HTTP routes are thin; all business logic lives in services and agents.
- **Event-Driven Streaming** — The primary path is SSE (Server-Sent Events) via `/jd/chat/stream`, where Gemini token chunks are streamed back to the frontend in real time.
- **Vector-Augmented Generation (RAG)** — Pinecone stores embeddings of approved JDs and reference JDs. During `ToolsAgent`, `SkillsAgent`, and `DeepDiveAgent` phases, the `GapDetector` node queries Pinecone and synthesizes suggestions with an LLM call before returning them to the frontend.
- **Session Hydration** — Every HTTP request is stateless. Session state (`SessionMemory`) is hydrated from **Redis first** (~1 ms), then **PostgreSQL** as fallback (~50–100 ms). After each turn, the updated session is persisted back to both.

### High-Level Data Flow

```
Browser (Next.js)
│
│  POST /jd/init          → Creates JDSession row, returns session UUID
│  POST /jd/chat/stream   → SSE stream: chunks → done event (JSON)
│  POST /jd/generate      → Calls Gemini Pro for final JD text
│  POST /jd/save          → Persists JD text + structured JSON to DB
│  PATCH /jd/{id}/status  → Manager / HR approval workflow
│
FastAPI (jd_routes.py)
│  Hydrate SessionMemory ← Redis cache OR PostgreSQL (conversation_turns + jd_sessions)
│  Call jd_service.handle_conversation_stream()
│       └─ agents/graph.run_interview_turn_stream()
│             ├─ router.compute_current_agent()     — Rule-based agent selection
│             ├─ interview.InterviewEngine.run_turn_stream()
│             │       └─ Gemini Flash (streaming)
│             └─ gap_detector.gap_detector_node()
│                     ├─ validators.validate_insights_completeness()
│                     └─ vector_service.query_advanced_context()  (Pinecone RAG)
│  Persist SessionMemory → PostgreSQL (sync_session_to_db) + Redis (cache)
│  Stream SSE chunks → Browser
│
PostgreSQL
│  jd_sessions (primary record + JSONB insights)
│  conversation_turns (every user/assistant turn)
│  employees, organogram, reference_jds, jd_review_comments, feedbacks
│
Pinecone
│  Index: jd-agent
│  Stores: approved JD chunks + reference JD chunks
│  Queried by: gap_detector_node (RAG suggestions)
```

---

## 2. Global Dependency Map

```
backend/
├── app/main.py                 ← FastAPI app entry; mounts all routers
│
├── app/core/
│   ├── config.py               ← Pydantic Settings; env vars; DATABASE_URL; storage paths
│   ├── database.py             ← SQLAlchemy async engine; init_db(); get_db() dependency
│   ├── auth.py                 ← get_current_user(); hr_required(); manager_required()
│   ├── cache.py                ← Redis async client; cached_response decorator; invalidate_*
│   └── security.py             ← JWT creation (create_access_token); bcrypt hashing
│
├── app/agents/                 ← THE BRAIN — LangGraph multi-agent system
│   ├── state.py                ← AgentState TypedDict (shared graph state); create_initial_state()
│   ├── graph.py                ← Compiled StateGraph; run_interview_turn(); run_interview_turn_stream()
│   ├── router.py               ← compute_current_agent() rule-based; compute_progress(); router_node
│   ├── interview.py            ← InterviewEngine; all 7 agent node functions
│   ├── gap_detector.py         ← gap_detector_node; RAG queries; LLM tool/skill synthesis
│   ├── dynamic_prompts.py      ← build_system_messages() per agent
│   ├── prompts.py              ← JD_GENERATION_PROMPT constant
│   ├── validators.py           ← validate_insights_completeness(); compute_quality_score(); sanitise_skills()
│   ├── extraction_engine.py    ← LLM-based structured data extractor
│   ├── critic_engine.py        ← Response quality critic
│   ├── semantic_cleaner.py     ← Cleans LLM text artifacts
│   └── tools.py                ← LangChain tool definitions for agents
│
├── app/services/
│   ├── jd_service.py           ← handle_conversation(); handle_conversation_stream(); handle_jd_generation()
│   ├── vector_service.py       ← Pinecone client; index_jd_document(); query_advanced_context()
│   ├── jd_intelligence.py      ← JDIntelligenceService; PDF → structured JD via Gemini
│   ├── dashboard_service.py    ← DashboardService; recursive org tree queries
│   ├── docx_generator.py       ← generate_jd_docx(); Pulse Pharma branded DOCX
│   ├── docx_extractor.py       ← DOCXTableExtractor; extract_docx_complete()
│   ├── docx_processor.py       ← DOCXProcessor; table-aware extraction
│   ├── pdf_processor.py        ← PDFProcessor; PDF text extraction
│   └── token_budget.py         ← Token estimation utilities
│
├── app/memory/
│   └── session_memory.py       ← SessionMemory class; 3-layer memory model; to_dict()/from_dict()
│
├── app/routers/
│   ├── jd_routes.py            ← /jd/* endpoints; session hydration; SSE streaming
│   ├── admin_routes.py         ← /auth/admin-login; /admin/stats; JWT verification
│   ├── admin_jd_routes.py      ← /admin/jds/*; PDF upload; reference JD management; Pinecone indexing
│   ├── hr_routes.py            ← /api/hr/*; department stats; team views
│   ├── feedback_routes.py      ← /feedback; /admin/feedback; review submission
│   └── organogram_routes.py    ← /auth/sso-sync; /auth/me; /auth/organogram
│
├── app/models/
│   ├── jd_session_model.py     ← JDSession, ConversationTurn, JDVersion SQLAlchemy models
│   ├── user_model.py           ← Employee model
│   ├── feedback_model.py       ← Feedback model
│   ├── review_comment_model.py ← JDReviewComment model
│   ├── reference_jd_model.py   ← ReferenceJD model
│   └── taxonomy_model.py       ← Skill, JDSessionSkill, EmployeeSkill models
│
├── app/schemas/
│   ├── jd_schema.py            ← Pydantic request/response models
│   └── insights.py             ← Insights schema types
│
├── app/crud/
│   └── jd_crud.py              ← All DB read/write operations
│
└── app/utils/
    └── text_utils.py           ← strip_reasoning_tags()

frontend/
├── app/layout.tsx              ← Root layout; Google Fonts; providers
├── app/page.tsx                ← Landing / entry redirect
├── app/globals.css             ← Global CSS
├── app/(dashboard)/            ← Employee-facing routes (require SSO auth)
├── app/admin/                  ← Admin panel (JWT-protected)
├── app/sso/page.tsx            ← SSO login (organogram-based)
│
├── hooks/
│   ├── useChat.ts              ← Core interview state machine (streaming, sessions, JD gen)
│   ├── useJDQueries.ts         ← TanStack Query hooks for JD CRUD
│   ├── useReferenceJDs.ts      ← TanStack Query hooks for reference JDs
│   └── useVoiceConversation.ts ← Voice input hook (Web Speech API)
│
├── lib/
│   ├── api.ts                  ← All API fetch functions; auth utilities; SSE stream handler
│   ├── auth.ts                 ← Re-exports from api.ts
│   ├── cookies.ts              ← setCookie/getCookie/deleteCookie + cookieKeys constants
│   └── design-tokens.ts        ← Design system tokens
│
└── types/
    ├── jd-agent.ts             ← JDAgentResponse, Progress, EmployeeRoleInsights
    ├── jd.ts                   ← JD-related types
    ├── message.ts              ← Message interface for chat
    ├── reference-jd.ts         ← ReferenceJD API response types
    └── session.ts              ← SessionListItem, SessionDetail, SessionConversationTurn
```

---

## 3. Detailed File-by-File Registry

---

### 📄 `backend/app/main.py`

- **Core Purpose & Responsibility:** FastAPI application entry point. Creates the `FastAPI` instance, registers all routers, attaches CORS and GZip middleware, and exposes liveness/readiness health-check endpoints. The `lifespan` context manager calls `init_db()` exactly once on startup.
- **Behavior & Internal Logic:**
  - `lifespan(app)` async context manager: on enter calls `await init_db()`. On exit, yields.
  - `GET /health/live` (always 200), `GET /health/ready` (parallel DB ping + `cache_health()` + `vector_health()`).
  - Middleware stack: `CORSMiddleware` (parses `CORS_ORIGINS` from settings), `GZipMiddleware` (>1 KB responses).
- **Inbound Connections:** Application entry point called by Gunicorn as `app.main:app`.
- **Outbound Connections:**
  - `app/version.py` → reads `VERSION`.
  - `app/core/database.py` → `init_db()`, `engine`.
  - `app/core/config.py` → `settings.cors_origins_list`.
  - `app/core/cache.py` → `cache_health()`.
  - `app/services/vector_service.py` → `vector_health()`.
  - All 6 routers (`jd_routes`, `admin_routes`, `admin_jd_routes`, `hr_routes`, `feedback_routes`, `organogram_routes`).
- **Critical Failure Points:**
  - `init_db()` failure (DB unreachable on cold start) crashes app before serving any requests.
  - `CORS_ORIGINS` misconfiguration blocks all browser requests.

---

### 📄 `backend/app/version.py`

- **Core Purpose & Responsibility:** Single-source-of-truth for semantic version string. Exports `VERSION = "1.0.0"` and `get_version()`.
- **Inbound Connections:** `main.py`.
- **Outbound Connections:** None.

---

### 📄 `backend/app/core/config.py`

- **Core Purpose & Responsibility:** Centralizes all environment-variable configuration using `pydantic-settings`. Every module that needs a secret or external URL imports the singleton `settings` object.
- **Behavior & Internal Logic:**
  - `Settings(BaseSettings)`: reads from `.env` and environment. Contains DB credentials, `GEMINI_API_KEY`, `PINECONE_API_KEY`, `REDIS_URL`, `CORS_ORIGINS`, `SECRET_KEY`, `ADMIN_CODE`, `ADMIN_PASSWORD`.
  - `@property DATABASE_URL`: selects `postgresql+asyncpg://` if DB fields present, else falls back to `sqlite+aiosqlite:///test.db`.
  - `@property storage_root`, `jd_upload_dir`: Path objects for file storage.
- **Inbound Connections:** Nearly every backend file — `database.py`, `security.py`, `cache.py`, `vector_service.py`, `jd_service.py`, `interview.py`, `gap_detector.py`, `admin_routes.py`, `admin_jd_routes.py`.
- **Critical Failure Points:**
  - Missing required env vars raise `ValidationError` at import time, crashing the entire application.
  - `DATABASE_SSL="require"` with no valid cert chain causes `ssl.SSLError`.

---

### 📄 `backend/app/core/database.py`

- **Core Purpose & Responsibility:** Configures the async SQLAlchemy engine and session factory. Provides the `get_db()` FastAPI dependency. Runs idempotent PostgreSQL DDL migrations in `init_db()`.
- **Behavior & Internal Logic:**
  - `create_async_engine`: pool_size=5, `pool_recycle=1800s`, `pool_pre_ping=True`.
  - `AsyncSessionLocal`: `expire_on_commit=False`.
  - `get_db()`: async generator that yields session, rolls back on exception, closes on exit.
  - `init_db()`: checks the database dialect; if using SQLite, it returns early to skip PostgreSQL-specific DDL and PL/pgSQL triggers, ensuring safe local startup. Otherwise, it idempotently adds `sent_to_manager_at`/`sent_to_hr_at` columns, `touch_updated_at` trigger function, `trg_jd_sessions_updated` trigger, and `source_reference_jd_id` column + unique partial index using `DO $$ ... $$` blocks.
- **Inbound Connections:** `main.py` → `init_db()`, `engine`. All routers → `get_db` dependency. `gunicorn.conf.py` → `engine.sync_engine.dispose()`.
- **Outbound Connections:** `app/core/config.py` → `settings.DATABASE_URL`, `settings.DATABASE_SSL`.
- **Critical Failure Points:**
  - Concurrent worker startup races in `init_db()` are intentionally caught and suppressed.
  - Tables must exist before `ALTER TABLE` in `init_db()` — run Alembic first on new deploys.

---

### 📄 `backend/app/core/auth.py`

- **Core Purpose & Responsibility:** FastAPI dependency functions for user authentication. Reads `X-Employee-ID` header, validates employee exists in DB. Provides `hr_required()` and `manager_required()` role guards.
- **Behavior & Internal Logic:**
  - `get_current_user()`: trusts `X-Employee-ID` header (no JWT for employees). Raises 401 if missing or employee not found.
  - `hr_required()` / `manager_required()`: check `user.role` against allowed roles, raise 403 otherwise.
- **Inbound Connections:** `hr_routes.py` → `Depends(hr_required)`, `Depends(manager_required)`.
- **Outbound Connections:** `app/core/database.py` → `get_db`. `app/models/user_model.py` → `Employee`.
- **Critical Failure Points:**
  - `X-Employee-ID` trusted without cryptographic verification — replace with JWT for production.
  - Empty `employees` table (pre-SSO-sync) causes all authenticated requests to 401.

---

### 📄 `backend/app/core/cache.py`

- **Core Purpose & Responsibility:** Redis-backed caching layer with graceful degradation. If Redis is unavailable, all operations silently no-op.
- **Behavior & Internal Logic:**
  - On import: connects to `settings.REDIS_URL` with 1-second timeouts. Sets `REDIS_AVAILABLE` flag.
  - `cached_response(key_prefix, ttl)`: decorator for FastAPI routes. Generates cache key from prefix + stringified args, checks/stores in Redis.
  - `get_cache`, `set_cache`, `invalidate_cache`, `invalidate_pattern`: low-level async Redis operations (all silent-fail).
  - `cache_health()`: returns `{"status": "ok"}` or `{"status": "degraded"}`.
- **Inbound Connections:** `main.py`, `jd_routes.py`, `jd_crud.py`, `hr_routes.py`.
- **Outbound Connections:** `app/core/config.py` → `settings.REDIS_URL`.
- **Critical Failure Points:**
  - `invalidate_pattern` uses `KEYS *` glob scan — O(N), can cause Redis latency spikes. Migrate to `SCAN`.

---

### 📄 `backend/app/core/security.py`

- **Core Purpose & Responsibility:** JWT token creation and bcrypt password hashing for admin authentication.
- **Behavior & Internal Logic:**
  - `create_access_token(subject, expires_delta)`: creates HS256 JWT with `sub` and `exp` claims.
  - `verify_password` / `get_password_hash`: passlib bcrypt wrappers.
- **Inbound Connections:** `admin_routes.py` → `create_access_token()`.
- **Outbound Connections:** `app/core/config.py` → `settings.SECRET_KEY`, `settings.ALGORITHM`.
- **Critical Failure Points:** Weak `SECRET_KEY` makes tokens forgeable. No refresh token mechanism.

---

### 📄 `backend/app/agents/state.py`

- **Core Purpose & Responsibility:** Defines `AgentState` TypedDict — the single object passed through every LangGraph node. Also provides `create_initial_state()` to build a fresh state from `SessionMemory`.
- **Behavior & Internal Logic:**
  - 5 memory layers: Short-Term (`messages` with `add_messages` reducer, `user_message`, `current_agent`, `turn_count`), Long-Term (`insights`, `identity_context`), Working (`questions_asked`, `previous_questions_text`, `agent_transition_log`), Quality Tracking (`gaps`, `quality_score`, `ready_for_jd`, `progress`), Output (`next_question`, `suggested_skills`, `suggested_tools`, `suggested_tasks`).
  - `messages` uses LangGraph's `Annotated[list, add_messages]` — appends rather than replaces.
- **Inbound Connections:** `graph.py` → `create_initial_state()`. All agent nodes → receive/return this dict.
- **Outbound Connections:** `langchain_core.messages`, `langgraph.graph.message`.
- **Critical Failure Points:** Adding new fields without defaults in `create_initial_state()` causes `KeyError` on existing session resume.

---

### 📄 `backend/app/agents/graph.py`

- **Core Purpose & Responsibility:** Compiles the LangGraph `StateGraph` and exposes `run_interview_turn()` (sync) and `run_interview_turn_stream()` (SSE streaming). Central orchestrator coordinating all agents.
- **Behavior & Internal Logic:**
  - `_build_graph()`: registers 9 nodes: `router`, `basic_info`, `workflow_identifier`, `deep_dive`, `tools`, `skills`, `qualification`, `jd_generator`, `gap_detector`. Edges: `START → router → [conditional per agent] → gap_detector → END`.
  - `_compiled_graph = _build_graph()`: compiled once at module load, reused across all sessions.
  - `run_interview_turn()`: builds `AgentState`, calls `_compiled_graph.ainvoke()`, reads result back into `SessionMemory`, calls `_build_frontend_response()`.
  - `run_interview_turn_stream()`: bypasses LangGraph for streaming. Calls `router.compute_current_agent()` directly → `interview_engine.run_turn_stream()` (yields SSE chunks) → `gap_detector_node` → `_build_frontend_response()` → yields final `done` SSE event.
  - `_build_frontend_response()`: constructs exact JSON contract frontend expects: `next_question`, `progress`, `employee_role_insights`, `task_list`, `suggested_skills`, `suggested_tools`, `analytics`, `approval`.
- **Inbound Connections:** `jd_service.py` → `run_interview_turn()`, `run_interview_turn_stream()`.
- **Outbound Connections:** `agents/state.py`, `agents/router.py`, `agents/interview.py`, `agents/gap_detector.py`.
- **Critical Failure Points:**
  - Streaming path checks `insights.get("_engine_current_agent")` sentinel key — missing causes double-routing.
  - LangGraph compilation failure at import crashes entire backend.
  - Rate-limit errors from Gemini propagate as `{"type": "error", "is_rate_limit": "true"}` SSE events.

---

### 📄 `backend/app/agents/router.py`

- **Core Purpose & Responsibility:** Rule-based agent selection engine. `compute_current_agent()` inspects `insights` dict and returns which agent should handle the next turn. Computes monotonic progress percentages.
- **Behavior & Internal Logic:**
  - `AGENT_ORDER`: `[BasicInfoAgent, WorkflowIdentifierAgent, DeepDiveAgent, ToolsAgent, SkillsAgent, QualificationAgent, JDGeneratorAgent]`.
  - `AGENT_CRITERIA`: `{agent_name: lambda ins: bool}` — each lambda defines when that agent is "complete". Includes hard-stop turn counts to prevent infinite loops.
  - `compute_current_agent(insights, current_agent)`: iterates `AGENT_ORDER`, returns first agent whose criteria aren't met.
  - `compute_progress(insights, current_agent)`: computes completion % within each phase's floor/ceiling window (e.g., `DeepDiveAgent` uses 25–85%). Monotonic (never decreases).
  - `_force_advance` mechanism: if `insights._force_advance=True`, skips current agent.
- **Inbound Connections:** `graph.py`, `jd_routes.py` (for `_reconcile_session_memory`), `jd_service.py`.
- **Outbound Connections:** `agents/state.py`.
- **Critical Failure Points:**
  - Lambda returning always-`False` causes infinite loops — hard-stop `agent_turn_counts >= N` prevents this.
  - Malformed `insights` (e.g., `tasks` as dict instead of list) silently returns 0, stalling at `BasicInfoAgent`.

---

### 📄 `backend/app/agents/interview.py`

- **Core Purpose & Responsibility:** Contains the `InterviewEngine` class and all 7 LangGraph agent node functions. Most complex file in the codebase (~61KB). Manages question deduplication, response validation, LLM streaming, and data extraction.
- **Behavior & Internal Logic:**
  - **Question Deduplication**: `_compute_question_hash()` normalizes by stripping fillers, computing 12-char MD5. Two-layer check: hash match + keyword overlap ≥40% with last 10 questions.
  - **Response Validation**: `_ensure_ends_with_question()` appends fallback contextual question if response lacks `?`.
  - **`InterviewEngine.run_turn_stream()`**: builds system messages via `dynamic_prompts.build_system_messages()`, constructs `[SystemMessage, ...recent_messages, HumanMessage]`, calls `llm.astream()` (Gemini Flash), yields `{"type": "chunk", "content": token}` events, extracts structured data from final response, deduplicates, yields `{"type": "done", "insights": ..., "full_text": ...}`.
  - **Agent Nodes**: `basic_info_node`, `workflow_identifier_node`, `deep_dive_node`, `tools_node`, `skills_node`, `qualification_node`, `jd_generator_node` — each calls `interview_engine.run_turn()` with `agent_name` and returns partial `AgentState` updates.
  - **`_strip_tool_code_leaks()`**: regex-strips JSON tool calls that Gemini occasionally leaks into prose.
- **Inbound Connections:** `graph.py` → all 7 node functions + `engine` instance.
- **Outbound Connections:** `app/core/config.py`, `agents/state.py`, `agents/dynamic_prompts.py`, `agents/prompts.py`.
- **Critical Failure Points:**
  - Gemini streaming response format change can break `_extract_text_content()` normalization.
  - 40% keyword overlap threshold for dedup can cause false positives — check `[DEDUP]` log lines if interview feels stuck.
  - High cyclomatic complexity — extraction logic changes frequently cause regressions.

---

### 📄 `backend/app/agents/dynamic_prompts.py`

- **Core Purpose & Responsibility:** Generates agent-specific system message lists for each interview phase, dynamically populated with current `insights` state. Defines the "personality" and instructions of each agent.
- **Behavior & Internal Logic:**
  - `build_system_messages(agent_name, insights, ...)`: dispatches to per-agent builder that constructs `[SystemMessage, ...]`. Injects current data (tasks collected, active deep-dive task, etc.) into prompt templates.
  - `_strip_leading_acknowledgment(text)`: removes "Great!", "Sure!", "Of course!" prefixes.
  - `_get_structured_phase_message()`: returns rendering instruction for agents that emit UI panels (WorkflowIdentifier, Tools, Skills).
- **Inbound Connections:** `interview.py`.
- **Outbound Connections:** None.
- **Critical Failure Points:**
  - Employee input is embedded in system prompts — prompt injection risk. No sanitization applied.
  - Prompt changes (46KB file) are the most common source of regressions.

---

### 📄 `backend/app/agents/gap_detector.py`

- **Core Purpose & Responsibility:** LangGraph terminal node running after every agent turn. (1) Rule-based completeness checking producing `gaps` list and `quality_score`; (2) RAG-augmented tool/skill suggestion via Pinecone + Gemini Flash synthesis.
- **Behavior & Internal Logic:**
  - `gap_detector_node(state)`: runs `validate_insights_completeness()`, maps failures to severity levels, calls `sanitise_skills()` as side effect.
  - **RAG Discovery**: if in `WorkflowIdentifierAgent`/`DeepDiveAgent` phase AND `role_title` known, queries Pinecone for responsibilities/tasks. If in `ToolsAgent`/`SkillsAgent`/`DeepDiveAgent` phase, queries for tools and skills.
  - `synthesize_tools_and_skills_with_llm()`: passes raw Pinecone hits to Gemini Flash, gets back `{"suggested_tools": [], "suggested_skills": []}`. Falls back to rule-based parsing if LLM fails.
  - `clean_rag_items(text, prefix_marker)`: strips metadata prefixes from Pinecone document text.
- **Inbound Connections:** `graph.py` → called as terminal node every turn.
- **Outbound Connections:** `agents/validators.py`, `services/vector_service.py`, `app/core/config.py`.
- **Critical Failure Points:**
  - Pinecone failures silently return empty suggestions — interview continues without RAG.
  - LLM synthesis adds 2–5 seconds per `ToolsAgent`/`SkillsAgent` turn.
  - `clean_rag_items` keyword filtering may exclude legitimate tool names containing filtered words.

---

### 📄 `backend/app/agents/validators.py`

- **Core Purpose & Responsibility:** Data quality validation and skill sanitization. Checks whether `insights` dict has sufficient data to generate a JD. Contains soft-skill blocklist and tool/skill classifier.
- **Behavior & Internal Logic:**
  - `SOFT_SKILL_PATTERNS`: set of 25+ known soft skills to filter out.
  - `sanitise_skills(skills)`: deduplicates and removes soft skills.
  - `validate_insights_completeness(insights)`: returns `{category: {"ok": bool, "reason": str}}` for 7 categories: `purpose`, `tasks`, `priority_tasks`, `workflows`, `tools`, `skills`, `qualifications`.
  - `compute_quality_score(insights)`: 0–100 score based on weighted category completeness.
  - `is_ready_for_jd(insights)`: checks all critical criteria simultaneously.
  - `separate_tools_and_skills(items, role_title)`: keyword heuristics to classify mixed items.
- **Inbound Connections:** `gap_detector.py`, `jd_service.py`, `jd_crud.py`.
- **Outbound Connections:** None.
- **Critical Failure Points:** `separate_tools_and_skills` heuristics are role-agnostic — domain-specific tools may be misclassified.

---

### 📄 `backend/app/agents/prompts.py`

- **Core Purpose & Responsibility:** Contains `JD_GENERATION_PROMPT` — the system prompt for final JD generation. Enforces strict JSON output schema with exact key names (`tools` not `tools_used`, `skills` not `technical_skills`, etc.).
- **Inbound Connections:** `jd_service.py`, `interview.py`.
- **Outbound Connections:** None.
- **Critical Failure Points:** Gemini ignoring schema rules causes wrong key names → empty JD structured data in parser.

---

### 📄 `backend/app/agents/extraction_engine.py`

- **Core Purpose & Responsibility:** Secondary LLM-based extraction engine that parses free-form employee text and extracts structured fields into `insights` dict. Uses Gemini Flash.
- **Inbound Connections:** `interview.py` → used by agent nodes for data extraction.
- **Outbound Connections:** `app/core/config.py` → `settings.GEMINI_API_KEY`.
- **Critical Failure Points:** LLM hallucinations can pollute `insights` with incorrect data.

---

### 📄 `backend/app/agents/critic_engine.py`

- **Core Purpose & Responsibility:** Quality critic that evaluates LLM-generated interview responses for quality issues (missing question, tool code leaks, repetition). Can make a secondary Gemini call to rewrite a response.
- **Inbound Connections:** `interview.py` → response validation pipeline.
- **Outbound Connections:** `app/core/config.py`.
- **Critical Failure Points:** Adds latency. Disabling degrades response quality.

---

### 📄 `backend/app/agents/semantic_cleaner.py`

- **Core Purpose & Responsibility:** Post-processes LLM responses to remove artifacts: JSON fragments, tool call leaks, markdown code fences, `<think>...</think>` reasoning tags. Uses regex, no LLM calls.
- **Inbound Connections:** `interview.py`.
- **Outbound Connections:** None.
- **Critical Failure Points:** Overly aggressive regex can strip valid content.

---

### 📄 `backend/app/agents/tools.py`

- **Core Purpose & Responsibility:** Defines LangChain `@tool` decorated functions (`save_insight`, `update_task`, `confirm_tools`, etc.) that agents call via `bind_tools()`. Structured alternatives to embedding JSON in prose.
- **Inbound Connections:** `interview.py` → `llm.bind_tools(...)`.
- **Outbound Connections:** None.
- **Critical Failure Points:** Tool-use response format differs from text — `_extract_text_content()` in `interview.py` must handle both formats.

---

### 📄 `backend/app/memory/session_memory.py`

- **Core Purpose & Responsibility:** In-process session state container. Hydrated from DB/cache on each request, mutated by agent nodes, serialized back to DB after each turn. Manages 3 memory tiers.
- **Behavior & Internal Logic:**
  - `recent_messages`: rolling window of last 10 turns → sent to Gemini. Prevents token bloat.
  - `full_history`: complete turn-by-turn history → saved to DB `conversation_turns`.
  - `questions_asked`: list of 12-char MD5 hashes for deduplication.
  - `add_turn()` / `update_recent()`: adds to both lists, trims `recent_messages`, invalidates cache.
  - `to_dict()` / `from_dict()`: serializes/deserializes to JSONB for `jd_sessions.conversation_state`.
  - `record_agent_transition()`: logs transitions, resets `current_stage_question_count`.
  - `user_history_text`: cached property — lowercase join of all user messages for duplicate scan.
- **Inbound Connections:** `jd_routes.py`, `graph.py`, `jd_service.py`.
- **Outbound Connections:** None (pure in-process state).
- **Critical Failure Points:**
  - `recent_messages` window of 10 may be too small for complex roles — LLM may repeat questions.
  - `_user_history_text_cache` rebuilt frequently in streaming paths.

---

### 📄 `backend/app/services/jd_service.py`

- **Core Purpose & Responsibility:** Service layer bridging HTTP routers and LangGraph agents. Provides `handle_conversation()`, `handle_conversation_stream()`, `handle_jd_generation()`. Contains multi-strategy JSON parsing with 5 fallback strategies.
- **Behavior & Internal Logic:**
  - `get_jd_llm()`: `@lru_cache` singleton for Gemini Pro (JD generation only).
  - `handle_conversation()`: calls `agents/graph.run_interview_turn()`.
  - `handle_conversation_stream()`: delegates to `agents/graph.run_interview_turn_stream()`.
  - `handle_jd_generation()`: sends `insights` to Gemini Pro via `JD_GENERATION_PROMPT`. Parses JSON with 5 strategies: clean JSON → extract block → remove think tags → balanced bracket scan → plain text wrap. Falls back to `build_markdown_from_structured()`.
  - `deep_merge(base, incoming)`: recursive dict merge; extends lists without duplicates.
  - `parse_llm_response()`: 5-layer JSON extraction.
- **Inbound Connections:** `jd_routes.py`.
- **Outbound Connections:** `agents/graph.py`, `agents/prompts.py`, `agents/router.py`, `agents/validators.py`, `memory/session_memory.py`, `schemas/jd_schema.py`, `utils/text_utils.py`, `app/core/config.py`.
- **Critical Failure Points:**
  - All 5 JSON parsing strategies failing raises `ValueError` → 422 response. Check raw LLM response in logs.
  - `@lru_cache` on `get_jd_llm()` — API key changes require server restart.

---

### 📄 `backend/app/services/vector_service.py`

- **Core Purpose & Responsibility:** Manages all Pinecone vector database operations: initialization, indexing approved/reference JDs as chunked embeddings, and querying for RAG context during interviews.
- **Behavior & Internal Logic:**
  - Lazy initialization: `_pc`, `_index`, `_embeddings` are module-level singletons initialized on first use.
  - Uses `GoogleGenerativeAIEmbeddings` (Gemini embedding model) for vector generation.
  - `index_jd_document()`: chunks JD structured data into multiple vectors per section (responsibilities, skills, tools, etc.) with metadata. Upserts to Pinecone.
  - `query_advanced_context(role_title, category, department, top_k)`: queries Pinecone, post-filters by department synonyms and role token overlap score.
  - `_is_matching_department()`: handles pharmaceutical department name synonyms (R&D, HR/HRD, Finance/Accounts, QA/CQA, etc.).
  - `vector_health()`: pings Pinecone index stats.
- **Inbound Connections:** `gap_detector.py`, `admin_jd_routes.py`, `jd_intelligence.py`, `main.py`, `sync_vectors.py`.
- **Outbound Connections:** `app/core/config.py` → `settings.PINECONE_API_KEY`, `settings.PINECONE_INDEX_NAME`, `settings.GEMINI_API_KEY`.
- **Critical Failure Points:**
  - Pinecone free-tier idle state returns 503 — silently returns `[]`.
  - Blank `PINECONE_API_KEY` causes silent failure — interview works but without RAG suggestions.
  - Embedding model changes invalidate all existing vectors — full re-index required.

---

### 📄 `backend/app/services/jd_intelligence.py`

- **Core Purpose & Responsibility:** Processes uploaded PDF/DOCX reference JD files into structured data using Gemini Flash. Used by admin panel for JD library and Pinecone knowledge base building.
- **Behavior & Internal Logic:**
  - `JDIntelligenceService.__init__()`: Gemini Flash with `temperature=0.2`, `max_output_tokens=4096`.
  - `process_jd(file_path, ...)`: dispatches to `PDFProcessor` or `DOCXProcessor` by file type, extracts raw text, uses Gemini + `ChatPromptTemplate` to parse into `JDStructuredData` Pydantic model. Calls `vector_service.index_jd_document()` after extraction.
- **Inbound Connections:** `admin_jd_routes.py`.
- **Outbound Connections:** `services/docx_extractor.py`, `services/pdf_processor.py`, `services/docx_processor.py`, `services/vector_service.py`, `app/core/config.py`.
- **Critical Failure Points:** Scanned PDFs return empty/garbled text (no OCR). Gemini output structure mismatch causes Pydantic validation errors.

---

### 📄 `backend/app/services/dashboard_service.py`

- **Core Purpose & Responsibility:** Org-tree aware analytics queries for HR and Manager dashboards. Traverses `organogram` table recursively.
- **Behavior & Internal Logic:**
  - `get_recursive_reports(db, manager_code)`: BFS over `organogram.reporting_manager_code` to collect all direct/indirect report employee codes.
  - `is_department_head(db, emp_code)`: checks if employee's manager is in a different department.
  - `get_team_stats(db, emp_codes)`: batch JD completion stats for a list of codes.
- **Inbound Connections:** `hr_routes.py`.
- **Outbound Connections:** None (only `AsyncSession`).
- **Critical Failure Points:** BFS has no cycle protection — circular `reporting_manager_code` entries loop infinitely.

---

### 📄 `backend/app/services/docx_generator.py`

- **Core Purpose & Responsibility:** Generates Pulse Pharma branded DOCX from structured JD dict. Implements exact 4-section table layout with grey (`#BFBFBF`) headers and company logo matching official template.
- **Behavior & Internal Logic:**
  - `generate_jd_docx(jd_data, title, department)`: creates `python-docx` Document, adds header logo (local path or S3 URL fallback), builds 4 tables (Employee Info, Purpose, Responsibilities/Skills/Tools, Qualifications).
  - `_set_cell_properties()`: enforces correct OOXML element order in `tcPr` (wrong order corrupts Word files).
- **Inbound Connections:** `jd_routes.py` → `GET /{jd_id}/download` endpoint.
- **Outbound Connections:** `python-docx` (external).
- **Critical Failure Points:**
  - OOXML element ordering is strict — `shd` before `tcBorders` causes Word "repaired" dialog.
  - `GZipMiddleware` can corrupt DOCX downloads — prevented by `Content-Encoding: identity` response header.
  - Logo URL fetch via `urlopen()` can hang if S3 unreachable (no timeout set).

---

### 📄 `backend/app/services/docx_extractor.py`

- **Core Purpose & Responsibility:** Extracts structured data from table-based DOCX layouts. Handles multi-row merged-cell tables.
- **Inbound Connections:** `jd_intelligence.py`.
- **Outbound Connections:** `python-docx`.

---

### 📄 `backend/app/services/docx_processor.py`

- **Core Purpose & Responsibility:** General paragraph-based DOCX text extraction.
- **Inbound Connections:** `jd_intelligence.py`.
- **Outbound Connections:** `python-docx`.

---

### 📄 `backend/app/services/pdf_processor.py`

- **Core Purpose & Responsibility:** Extracts raw text from digital PDFs for `JDIntelligenceService`.
- **Inbound Connections:** `jd_intelligence.py`, `admin_jd_routes.py`.
- **Outbound Connections:** `pdfminer` or `pypdf` (external).
- **Critical Failure Points:** Scanned (image-only) PDFs return empty/garbled text. No OCR fallback.

---

### 📄 `backend/app/services/token_budget.py`

- **Core Purpose & Responsibility:** Token estimation utilities to prevent LLM context overflow on long interview sessions.
- **Inbound Connections:** `interview.py` (optional).
- **Outbound Connections:** None.

---

### 📄 `backend/app/crud/jd_crud.py`

- **Core Purpose & Responsibility:** All database read/write operations for the JD lifecycle. Every mutation to `jd_sessions`, `conversation_turns`, `jd_versions`, `jd_review_comments` goes through this file.
- **Behavior & Internal Logic:**
  - `sync_session_to_db()`: upserts `JDSession`; bulk-upserts `ConversationTurn` using `INSERT ... ON CONFLICT DO NOTHING` for idempotency; extracts `title` and `department` from `jd_structured` via 6 fallback key names.
  - `save_questionnaire_jd()`: saves final JD text + structured data; creates `JDVersion` snapshot; upserts skills into taxonomy tables.
  - `get_questionnaire()`: fetches `JDSession` with `selectinload` for `conversation_turns` and `review_comments` (avoids N+1).
  - `list_*` functions: all use Redis cache with pattern-based invalidation.
  - `create_review_comment()`: creates `JDReviewComment` and updates `JDSession.status`.
- **Inbound Connections:** `jd_routes.py`.
- **Outbound Connections:** `models/jd_session_model.py`, `models/review_comment_model.py`, `models/taxonomy_model.py`, `app/core/cache.py`.
- **Critical Failure Points:**
  - `INSERT ... ON CONFLICT DO NOTHING` for turns — content changes on retry aren't persisted (intentional idempotency).
  - `_extract_title()` tries 6 key names — new Gemini key names not in this list cause NULL titles.

---

### 📄 `backend/app/models/jd_session_model.py`

- **Core Purpose & Responsibility:** Core SQLAlchemy ORM models. `JDSession` is the primary entity. `ConversationTurn` stores individual messages. `JDVersion` stores historical snapshots.
- **Key Fields:**
  - `JDSession`: `id` (UUID PK), `employee_id` (FK → employees), `insights` (JSONB), `conversation_state` (JSONB), `jd_text` (Text), `jd_structured` (JSONB), `status` (Text, indexed).
  - `ConversationTurn`: `(session_id, turn_index)` unique constraint for idempotent upserts.
  - Composite indexes: `idx_jd_employee_updated`, `idx_jd_status_updated`, `idx_jd_employee_status`.
- **Inbound Connections:** `jd_crud.py`, `jd_routes.py`, `admin_jd_routes.py`, `admin_routes.py`.
- **Outbound Connections:** `app/core/database.py` → `Base`.

---

### 📄 `backend/app/models/user_model.py`

- **Core Purpose & Responsibility:** `Employee` SQLAlchemy model. FK anchor for JD sessions, feedback, and review comments.
- **Key Fields:** `id` (String PK, employee code), `name`, `email`, `department`, `role`, `reporting_manager`, `reporting_manager_code`, `phone_mobile`.
- **Inbound Connections:** `auth.py`, `jd_routes.py`, `admin_jd_routes.py`, `feedback_routes.py`.
- **Outbound Connections:** `app/core/database.py` → `Base`.
- **Critical Failure Points:** `role` is free-text — inconsistent casing breaks role-based auth guards.

---

### 📄 `backend/app/models/feedback_model.py`

- **Core Purpose & Responsibility:** General user feedback model (bug reports, feature requests, ratings). Fields: `category`, `rating` (1–5), `message`, `status` (unread/reviewed/resolved). No ORM relationships.
- **Inbound Connections:** `feedback_routes.py`.
- **Outbound Connections:** `app/core/database.py` → `Base`.

---

### 📄 `backend/app/models/review_comment_model.py`

- **Core Purpose & Responsibility:** Manager/HR review comments on JDs. `is_read` flag drives frontend notification badge.
- **Key Fields:** `action` (rejected/approved/revision_requested), `target_role` (employee/manager), `is_read` (Boolean).
- **Composite Indexes:** `idx_review_unread_target`, `idx_review_reviewer`, `idx_review_jd_target`.
- **Inbound Connections:** `jd_crud.py`, `jd_routes.py`.
- **Outbound Connections:** `app/core/database.py` → `Base`.
- **Critical Failure Points:** `idx_review_unread_target` index is critical for sidebar performance.

---

### 📄 `backend/app/models/reference_jd_model.py`

- **Core Purpose & Responsibility:** Admin-uploaded reference JDs (PDF/DOCX) metadata and structured data. Knowledge base for Pinecone RAG.
- **Key Fields:** `processing_status` (pending → processing → processed → reviewed → published), `structured_data` (JSON), `is_active` (soft delete).
- **Inbound Connections:** `admin_jd_routes.py`.
- **Outbound Connections:** `app/core/database.py` → `Base`.

---

### 📄 `backend/app/models/taxonomy_model.py`

- **Core Purpose & Responsibility:** Normalized taxonomy for skills. `Skill` (unique names), `JDSessionSkill` (session-to-skill links), `EmployeeSkill` (employee-to-skill links with provenance).
- **Inbound Connections:** `jd_crud.py` → `save_questionnaire_jd()`.
- **Outbound Connections:** `app/core/database.py` → `Base`.

---

### 📄 `backend/app/routers/jd_routes.py`

- **Core Purpose & Responsibility:** Primary HTTP router. Entire employee-facing JD lifecycle: session init, interview (sync + SSE streaming), JD generation, saving, status updates, review workflow, DOCX download, feedback endpoints.
- **Behavior & Internal Logic:**
  - `hydrate_session_from_db()`: Redis first → PostgreSQL fallback → `_reconcile_session_memory()` → cache result.
  - `_reconcile_session_memory()`: re-derives `current_agent` and `progress` from `insights` to fix stale state after restart.
  - `POST /jd/init`: creates `Employee` (if needed), queries `organogram` for designation/location, creates `JDSession`, returns UUID.
  - `POST /jd/chat/stream`: SSE streaming — yields chunks, persists to DB after stream completes.
  - `PATCH /{jd_id}/status`: status transitions (submit to manager, approve, reject).
  - `POST /{jd_id}/confirm-skills` / `confirm-tools` / `confirm-priority-tasks`: direct `insights` mutation for UI panel selections.
  - `GET /{jd_id}/download/docx/{filename}`: generates and streams DOCX with `Content-Encoding: identity`.
- **Inbound Connections:** `main.py` → mounted at `/jd`.
- **Outbound Connections:** `services/jd_service.py`, `crud/jd_crud.py`, `memory/session_memory.py`, `core/cache.py`, `services/docx_generator.py`, `agents/router.py`, `schemas/jd_schema.py`.
- **Critical Failure Points:**
  - Route ordering: `/jd/hr/pending`, `/jd/list`, `/jd/employee/{id}` must be declared before `/{jd_id}`.
  - SSE disconnect mid-stream: `sync_session_to_db` still runs in `event_generator`.

---

### 📄 `backend/app/routers/admin_routes.py`

- **Core Purpose & Responsibility:** Admin authentication and high-level statistics. Issues JWT tokens; provides overview stats.
- **Behavior & Internal Logic:**
  - `POST /auth/admin-login`: compares `code`/`password` against env vars. Returns HS256 JWT.
  - `get_current_admin()`: FastAPI dependency that decodes JWT, checks `sub == "ADMIN"`.
  - `GET /admin/stats/overview`: 4 parallel count queries.
- **Inbound Connections:** `main.py`.
- **Outbound Connections:** `core/security.py`, `core/config.py`, `models/jd_session_model.py`, `models/user_model.py`.
- **Critical Failure Points:** Admin credentials in plain-text env vars.

---

### 📄 `backend/app/routers/admin_jd_routes.py`

- **Core Purpose & Responsibility:** Admin management of reference JD library. PDF/DOCX upload, AI processing, Pinecone indexing, publishing to JD sessions.
- **Behavior & Internal Logic:**
  - `POST /admin/jds/upload`: saves file, creates `ReferenceJD` record, spawns `asyncio.create_task()` for background processing.
  - `POST /admin/jds/{jd_id}/publish`: marks as published, creates canonical `JDSession`, calls `index_approved_jd()`.
  - All routes require `Depends(get_current_admin)` JWT auth.
- **Inbound Connections:** `main.py`.
- **Outbound Connections:** `services/jd_intelligence.py`, `services/vector_service.py`, `models/reference_jd_model.py`, `models/jd_session_model.py`, `routers/admin_routes.py`, `core/config.py`.
- **Critical Failure Points:**
  - Background `asyncio.create_task()` crash won't propagate to HTTP response — check `processing_status`.
  - Local disk file storage — not shared across multi-instance deploys.

---

### 📄 `backend/app/routers/hr_routes.py`

- **Core Purpose & Responsibility:** HR and Manager dashboard endpoints. Department-level JD coverage stats, employee lists, team views.
- **Behavior & Internal Logic:**
  - `GET /api/hr/department-stats`: 3 SQL queries → aggregates in Python with shared-role JD coverage logic.
  - `GET /api/hr/departments/{dept}/employees`: paginated employee list with JD status.
  - `GET /api/hr/my-team-stats` / `my-team-employees`: uses `DashboardService.get_recursive_reports()`.
- **Inbound Connections:** `main.py` → mounted at `/api/hr`.
- **Outbound Connections:** `core/auth.py`, `core/cache.py`, `services/dashboard_service.py`.
- **Critical Failure Points:**
  - `department-stats` Python aggregation — slow for large employee counts.
  - 300s cache TTL may show stale stats after JD submission.

---

### 📄 `backend/app/routers/feedback_routes.py`

- **Core Purpose & Responsibility:** General user feedback submission (`POST /feedback`) and admin management (`GET /admin/feedback`, `PATCH /admin/feedback/{id}/status`).
- **Inbound Connections:** `main.py`.
- **Outbound Connections:** `models/feedback_model.py`, `models/user_model.py`.
- **Critical Failure Points:**
  - `POST /feedback` has no auth — anonymous clients can submit.
  - Admin routes lack `Depends(get_current_admin)` — security gap.

---

### 📄 `backend/app/routers/organogram_routes.py`

- **Core Purpose & Responsibility:** SSO-style authentication for employees via employee code lookup in organogram. No password verification.
- **Behavior & Internal Logic:**
  - `POST /auth/sso-sync`: looks up `emp_code` in `organogram`, creates/updates `Employee`, returns `AuthUser` JSON.
  - `GET /auth/me/{emp_code}`: employee profile lookup.
  - `GET /auth/organogram/employees`: all employees for login dropdown.
- **Inbound Connections:** `main.py` → mounted at `/auth`.
- **Outbound Connections:** `models/user_model.py`, `core/database.py`.
- **Critical Failure Points:** No password or token verification — anyone knowing `emp_code` can authenticate as that employee.

---

### 📄 `backend/app/schemas/jd_schema.py`

- **Core Purpose & Responsibility:** Pydantic request/response models for all JD endpoints. Defines the exact API contract between frontend and backend.
- **Key Models:** `ChatRequest`, `InitJDRequest/Response`, `ChatResponse`, `Progress` (Literal status union), `EmployeeRoleInsights`, `ConfirmSkillsRequest`, `ConfirmToolsRequest`, `ConfirmPriorityTasksRequest`.
- **Inbound Connections:** `jd_routes.py`, `jd_service.py`.
- **Critical Failure Points:** `Progress.status` Literal — adding new valid status requires updating here or Pydantic rejects it.

---

### 📄 `backend/app/utils/text_utils.py`

- **Core Purpose & Responsibility:** `strip_reasoning_tags()` — removes `<think>...</think>` reasoning blocks from Gemini/Qwen outputs before JSON parsing. Handles both closed and unclosed tags.
- **Inbound Connections:** `jd_service.py`.
- **Outbound Connections:** None.

---

### 📄 `backend/gunicorn.conf.py`

- **Core Purpose & Responsibility:** Production Gunicorn config tuned for 2GB RAM EC2 + Aiven PostgreSQL.
- **Key Settings:**
  - `workers = 2`, `worker_class = "uvicorn.workers.UvicornWorker"`, `timeout = 300s`.
  - `preload_app = False`: avoids asyncpg connection pool sharing across forked processes.
  - `post_fork`: disposes sync engine for clean pool per worker.
  - `worker_tmp_dir = "/dev/shm"`: RAM-backed tmpfs.
- **Critical Failure Points:** `preload_app = True` → asyncpg `InterfaceError`.

---

### 📄 `backend/sync_vectors.py`

- **Core Purpose & Responsibility:** One-off admin script to batch-index all approved JDs into Pinecone. Run after DB restore or new Pinecone index setup.
- **Outbound Connections:** `app/core/database.py` → `AsyncSessionLocal`. `services/vector_service.py` → `index_approved_jd`.
- **Critical Failure Points:** Partial failures leave Pinecone partially synced.

---

### 📄 `frontend/lib/api.ts`

- **Core Purpose & Responsibility:** Single source of truth for all API communication. Auth utilities, typed fetch wrappers with timeout, all backend endpoint functions, and the SSE streaming client.
- **Behavior & Internal Logic:**
  - `fetchWithTimeout(url, options, timeoutMs=30000)`: wraps `fetch` with `AbortController` timeout. Injects `X-Employee-ID` header.
  - `sendMessageStream(...)`: opens SSE to `/jd/chat/stream`, reads with `ReadableStream`, parses `data: {...}\n\n` events, dispatches to `onChunk`/`onDone`/`onError`/`onStatus` callbacks. 5-minute hard timeout.
  - `getCurrentUser()` / `getOrCreateEmployeeId()` / `devLogin(role)` / `devLogout()`: cookie-based identity management.
- **Inbound Connections:** `hooks/useChat.ts`, `hooks/useJDQueries.ts`, `hooks/useReferenceJDs.ts`, `lib/auth.ts`, page components.
- **Outbound Connections:** `lib/cookies.ts`, `types/*`.
- **Critical Failure Points:**
  - 30s default timeout may be too short for cold DB hydration.
  - `downloadJDDocx()` uses `window.location.assign()` — bypasses fetch timeout and auth headers.

---

### 📄 `frontend/lib/auth.ts`

- **Core Purpose & Responsibility:** Thin re-export of `getOrCreateEmployeeId()` and `getEmployeeId()` from `lib/api.ts`. Stable import path for identity-only consumers.
- **Inbound Connections:** `hooks/useChat.ts`, page components.
- **Outbound Connections:** `lib/api.ts`.

---

### 📄 `frontend/lib/cookies.ts`

- **Core Purpose & Responsibility:** Browser cookie utilities with `Secure` flag on HTTPS and `SameSite=Strict` for CSRF protection. `cookieKeys = {EMPLOYEE_ID, AUTH_USER, ADMIN_TOKEN, USER_ROLE}`.
- **Inbound Connections:** `lib/api.ts`, SSO page, admin login page.
- **Outbound Connections:** Browser API.
- **Critical Failure Points:** `SameSite=Strict` prevents cookies from being sent on cross-origin navigation — external links require re-login.

---

### 📄 `frontend/hooks/useChat.ts`

- **Core Purpose & Responsibility:** Central state machine for the entire interview experience. Manages messages, streaming, session hydration, JD generation, save, skills/tools/priority-task confirmation, and rate-limit handling.
- **Behavior & Internal Logic:**
  - On mount: calls `fetchJD(id)` to hydrate from DB. If history exists, reconstructs `Message[]`. If new session, sends greeting to trigger first agent question.
  - `sendMessage(text)`: adds user message to UI, creates streaming agent bubble, calls `sendMessageStream()`, updates bubble on each chunk, finalizes on `done` event.
  - `historyRef`: `useRef` used to avoid stale closure in streaming callbacks.
  - `processResponse(rawReply, history)`: parses JSON response, updates all state slices (progress, currentAgent, depthScores, insights, messages, jd, structuredData).
  - `confirmPriorityTasksAction(tasks)`: calls API, updates UI, sends follow-up message with 500ms delay.
  - `confirmSkillsAction` / `confirmToolsAction`: similar pattern.
- **Inbound Connections:** `app/(dashboard)/questionnaire/[id]/page.tsx`.
- **Outbound Connections:** `lib/api.ts`, `lib/auth.ts`, `types/jd-agent.ts`, `types/message.ts`, `types/session.ts`.
- **Critical Failure Points:**
  - `historyRef` solves stale closure — must be updated via `updateHistory()` before streaming begins.
  - `window.location.pathname` to extract session ID breaks in SSR context.
  - `processResponse` throwing on JSON parse leaves streaming bubble empty.

---

### 📄 `frontend/hooks/useJDQueries.ts`

- **Core Purpose & Responsibility:** TanStack Query hooks for JD CRUD with automatic cache invalidation.
- **Inbound Connections:** Dashboard pages, JD detail pages.
- **Outbound Connections:** `lib/api.ts`, `@tanstack/react-query`.

---

### 📄 `frontend/hooks/useReferenceJDs.ts`

- **Core Purpose & Responsibility:** TanStack Query hooks for admin reference JD management (list, fetch, publish).
- **Inbound Connections:** Admin JD library pages.
- **Outbound Connections:** `lib/api.ts`.

---

### 📄 `frontend/hooks/useVoiceConversation.ts`

- **Core Purpose & Responsibility:** Web Speech API integration for voice input during interviews. Chrome-only in practice; sends audio to Google servers.
- **Inbound Connections:** `components/chat/message-input.tsx`.
- **Outbound Connections:** Browser Web Speech API.

---

### 📄 `frontend/types/jd-agent.ts`

- **Core Purpose & Responsibility:** TypeScript interfaces for the JD Agent API response contract. `JDAgentResponse` is the primary interface — must stay in sync with `backend/app/agents/graph.py`'s `_build_frontend_response()`.
- **Key Interfaces:** `JDAgentResponse`, `Progress`, `EmployeeRoleInsights`, `JDStructuredData`, `TaskListItem`, `WorkflowStepData`, `Analytics`, `Approval`.
- **Inbound Connections:** `hooks/useChat.ts`, `lib/api.ts`.

---

### 📄 `frontend/types/session.ts`

- **Core Purpose & Responsibility:** Interfaces for session data: `SessionListItem`, `SessionDetail`, `SessionConversationTurn`.
- **Critical Failure Points:** `SessionConversationTurn.content` may be raw JSON or plain text — consumers must handle both.

---

### 📄 `frontend/types/message.ts`

- **Core Purpose & Responsibility:** `Message` interface for local chat UI state. UI-only flags: `isStreaming`, `isSkillSelection`, `isToolSelection`, `isPrioritySelection`, `isRateLimitError`. Not persisted.
- **Inbound Connections:** `hooks/useChat.ts`, `components/chat/message-bubble.tsx`.

---

## 4. Integration & State Flow Breakdown

### Initialization Sequence

```
1. Gunicorn reads gunicorn.conf.py
   └─ workers=2, timeout=300, worker_class=UvicornWorker

2. Each Uvicorn worker imports app.main:
   ├─ app/core/config.py       → loads .env, validates Settings (crashes on missing GEMINI_API_KEY)
   ├─ app/core/database.py     → creates async engine + session factory
   ├─ app/core/cache.py        → attempts Redis connection (1s timeout), sets REDIS_AVAILABLE
   ├─ app/services/vector_service.py → Pinecone singletons NOT initialized yet
   ├─ app/agents/graph.py      → _build_graph() called AT IMPORT TIME
   │   ├─ imports all 7 agent nodes from interview.py, router.py, gap_detector.py
   │   ├─ interview.py instantiates InterviewEngine (Gemini Flash LLM)
   │   └─ _compiled_graph = StateGraph.compile() → reused across all requests
   └─ main.py creates FastAPI app, attaches middleware, includes all routers

3. FastAPI lifespan (startup):
   └─ await init_db():
       ├─ ALTER TABLE jd_sessions ADD COLUMN IF NOT EXISTS sent_to_manager_at ...
       ├─ CREATE OR REPLACE FUNCTION touch_updated_at() (DO $$ block, idempotent)
       ├─ CREATE TRIGGER trg_jd_sessions_updated (idempotent)
       └─ CREATE UNIQUE PARTIAL INDEX uq_jd_sessions_source_reference_jd_id

4. Server ready on 0.0.0.0:8000
```

---

### Data/State Lifecycle: Standard Interview Turn (SSE Streaming)

```
FRONTEND                                 BACKEND
────────                                 ───────
User types message
useChat.sendMessage(text)
│
├─ Adds user Message to UI
├─ Adds empty streaming agent bubble
└─ lib/api.sendMessageStream()
   └─ POST /jd/chat/stream {message, history, id}
      │
      jd_routes.chat_stream()
      ├─ await hydrate_session_from_db(session_id, db)
      │   ├─ get_cache("session:{id}") → Redis HIT? return cached SessionMemory
      │   │                             MISS? → query jd_sessions + conversation_turns from PG
      │   └─ _reconcile_session_memory(): re-derive agent + progress from insights
      │
      ├─ jd_service.handle_conversation_stream(history, message, session_memory)
      │   └─ agents/graph.run_interview_turn_stream(session_memory, message)
      │       │
      │       ├─ 1. router.compute_current_agent(insights, old_agent)
      │       │      → iterates AGENT_CRITERIA, returns e.g. "DeepDiveAgent"
      │       │
      │       ├─ 2. get_transition_message(old_agent, new_agent) if transitioned
      │       │
      │       ├─ 3. interview_engine.run_turn_stream(agent_name, insights, ...)
      │       │      ├─ dynamic_prompts.build_system_messages("DeepDiveAgent", insights)
      │       │      ├─ Constructs [SystemMessage, ...recent_messages, HumanMessage]
      │       │      ├─ llm.astream(messages) → Gemini Flash token stream
      │       │      │   └─ Each token: yield {"type": "chunk", "content": token}
      │       │      │         ──────────────────────────────────────────────────►
      │       │      │         frontend onChunk: updates streaming bubble text
      │       │      │
      │       │      ├─ _is_question_repeated() → dedup check (hash + keyword overlap)
      │       │      ├─ _ensure_ends_with_question() → validate
      │       │      ├─ _strip_tool_code_leaks() → clean artifacts
      │       │      ├─ extraction_engine extracts structured data → updates insights
      │       │      └─ yield {"type": "done", "insights": {...}, "full_text": "..."}
      │       │
      │       ├─ 4. gap_detector_node(gap_state)
      │       │      ├─ validate_insights_completeness(insights)
      │       │      ├─ compute_quality_score(insights)
      │       │      ├─ if ToolsAgent/SkillsAgent phase:
      │       │      │   ├─ vector_service.query_advanced_context() → Pinecone RAG
      │       │      │   └─ synthesize_tools_and_skills_with_llm() → Gemini Flash
      │       │      └─ returns {gaps, quality_score, suggested_skills, suggested_tools}
      │       │
      │       ├─ 5. compute_current_agent() → re-evaluate for next turn
      │       ├─ 6. compute_progress() → new completion_percentage
      │       └─ 7. _build_frontend_response() → final JSON payload
      │           └─ yield data: {"type":"done","parsed":{next_question, progress,
      │                          employee_role_insights, task_list, suggested_skills,
      │                          suggested_tools, analytics, approval}}
      │               ──────────────────────────────────────────────────────────►
      │               frontend onDone: processResponse() → updates all state slices
      │
      └─ After stream completes (inside event_generator):
          ├─ crud.sync_session_to_db() → upsert jd_sessions + conversation_turns
          ├─ invalidate_pattern("cache:jd_detail:*{id}*")
          └─ _cache_session(session_memory) → Redis set with 5min TTL
```

---

### JD Generation Lifecycle

```
User clicks "Generate JD"
useChat.handleGenerateJD()
└─ lib/api.generateJD({id})
   └─ POST /jd/generate {id}
      │
      jd_routes.generate_jd_endpoint()
      ├─ hydrate_session_from_db(session_id, db)
      └─ jd_service.handle_jd_generation(session_memory)
          ├─ jd_llm = get_jd_llm()  [Gemini Pro, @lru_cache singleton]
          ├─ messages = [SystemMessage(JD_GENERATION_PROMPT),
          │              HumanMessage(f"Insights:\n{json.dumps(insights)}")]
          ├─ response = await jd_llm.ainvoke(messages)  [Gemini Pro, non-streaming]
          ├─ raw = strip_reasoning_tags(response.content)
          ├─ parse JSON: 5 fallback strategies
          │   1. clean_json_string() + json.loads()
          │   2. extract JSON block between first { and last }
          │   3. strip <think>...</think> tags and retry
          │   4. balanced bracket scan
          │   5. plain text wrap fallback
          ├─ structured = parsed["jd_structured_data"]
          ├─ jd_text = parsed["jd_text_format"]  [or build_markdown fallback]
          ├─ session_memory.generated_jd = jd_text
          └─ session_memory.progress["status"] = "jd_generated"
      │
      ├─ sync_session_to_db(status="jd_generated")
      └─ return {jd_text, jd_structured, status}
      │
      ──────────────────────────────────────────────────────────────────────────►
      frontend: setJd(jd_text), setStructuredData(jd_structured), setStatus("jd_generated")
      JD Preview Panel: renders formatted markdown JD
```

---

### Approval Workflow Lifecycle

```
JD saved (status: jd_generated)
    │
    ├─ Employee submits → PATCH /jd/{id}/status {status: "sent_to_manager"}
    │   DB: jd_sessions.status = "sent_to_manager", sent_to_manager_at = NOW()
    │
    ├─ Manager inbox → GET /jd/manager/{id}/pending
    │   Manager approves → POST /jd/{id}/review {action: "approved", target_role: "employee"}
    │       DB: jd_review_comments created (is_read=false, target_role="employee")
    │       DB: jd_sessions.status = "sent_to_hr"
    │
    │   Manager rejects → POST /jd/{id}/review {action: "rejected", target_role: "employee"}
    │       DB: jd_sessions.status = "manager_rejected"
    │       Employee sees notification (is_read=false)
    │
    ├─ HR inbox → GET /jd/hr/pending
    │   HR approves → POST /jd/{id}/review {action: "approved", target_role: "manager"}
    │       DB: jd_sessions.status = "approved"
    │       admin_jd_routes._sync_published_reference_jd() → creates canonical JDSession
    │           └─ vector_service.index_approved_jd() → indexes to Pinecone
    │
    └─ Employee notification
        GET /jd/feedback/{employee_id} → jd_review_comments WHERE is_read=false
        PATCH /jd/feedback/{comment_id}/read → is_read=true
```

---

## 5. Critical Cross-Cutting Concerns

| Concern | Implementation | File(s) | Watch Points |
|---|---|---|---|
| **LLM Rate Limits** | SSE error event + frontend 40s countdown | `graph.py`, `lib/api.ts`, `useChat.ts` | `is_rate_limit` flag in SSE error event |
| **Question Deduplication** | MD5 hash + keyword overlap | `interview.py`, `session_memory.py` | `[DEDUP]` log lines; 40% overlap threshold |
| **Session Statefulness** | Redis (~1ms) → PostgreSQL (~50ms) hydration | `jd_routes.py`, `session_memory.py`, `jd_crud.py` | `hydrate_session_from_db()` logs |
| **Agent Phase Transition** | Rule-based criteria lambdas + hard-stop turn counts | `router.py` | `agent_turn_counts` in `AgentState` |
| **Streaming Stale Closure** | `historyRef` useRef in `useChat.ts` | `hooks/useChat.ts`, `lib/api.ts` | Always use `historyRef.current`, never `history` in streaming callbacks |
| **DOCX Corruption** | `Content-Encoding: identity` prevents GZip double-compression | `jd_routes.py` | Removing this header corrupts DOCX downloads |
| **DB Migration Idempotency** | `DO $$ ... $$` blocks in `init_db()` | `database.py` | Race conditions between workers suppressed intentionally |
| **Pinecone Idle** | Silent `try/except` returning `[]` | `vector_service.py` | Interview continues without RAG suggestions |
| **Multi-worker Pool** | `preload_app=False` + `post_fork` disposes sync engine | `gunicorn.conf.py` | `preload_app=True` causes asyncpg `InterfaceError` |
| **Admin Security Gap** | Admin creds in env vars; feedback admin routes unprotected | `admin_routes.py`, `feedback_routes.py` | Add `Depends(get_current_admin)` to feedback admin routes |
| **Prompt Injection** | Employee input embedded in system prompts | `dynamic_prompts.py` | No sanitization applied — production risk |
| **Stale Agent State** | `_reconcile_session_memory()` re-derives from `insights` | `jd_routes.py` | Fixes sessions stuck in wrong phase after restart |
