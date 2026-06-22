# Ruflo — Claude Code Configuration

---

## 🧠 AI Memory Rule (CRITICAL — Always Follow)

> **After EVERY conversation or code change on this project, update this file (`CLAUDE.md`) immediately.**
>
> - If a new column/table is added → update the DB schema section
> - If a file is edited → update the HR Modifications or relevant section
> - If a new feature is built → add a summary entry
> - If files are added or removed → update the Project Structure section
>
> This file is the **single source of truth** for project context across sessions. Keeping it current means no time is wasted re-scanning the codebase next time.

---

## 📌 Project Context (Read This First)

### What is this project?
**JD-Agent** is an AI-powered Job Description (JD) creation platform for **Ruflo** (internal HR tool). It uses a multi-agent LangGraph pipeline backed by FastAPI, with a Next.js 14 frontend. Employees interact with an AI chat to generate structured JDs, which then go through a Manager → HR approval workflow.

### Tech Stack
- **Backend**: FastAPI · LangGraph · Google Gemini · Pinecone (vector store) · Redis (session cache)
- **Frontend**: Next.js 14 · TypeScript
- **Database**: **Aiven PostgreSQL** (production) — NOT SQLite. The `ruvector.db` file does NOT exist and is intentionally removed.
- **Deployment**: Backend on Render, Frontend on Vercel (or similar)

### Key Environment Variables (in `.env`)
- `DATABASE_URL` — Aiven PostgreSQL connection string
- `REDIS_URL` — Redis connection
- `GEMINI_API_KEY` — Google Gemini
- `PINECONE_API_KEY` / `PINECONE_INDEX` — Pinecone vector store

---

## 🗄️ Database Schema (Aiven PostgreSQL)

### `organogram` table
Stores the full employee hierarchy imported from Darwinbox.

| Column | Type | Notes |
|--------|------|-------|
| `id` | serial PK | |
| `employee_id` | varchar | e.g. `E1234` |
| `employee_name` | varchar | |
| `designation` | varchar | Job title |
| `department` | varchar | |
| `date_of_joining` | date | |
| `location` | varchar | |
| `reporting_manager_id` | varchar | |
| `reporting_manager_name` | varchar | |
| `joblevel` | varchar | **Added June 2026** — e.g. `Level 1` to `Level 5` |

### `employees` table

| Column | Type | Notes |
|--------|------|-------|
| `id` | serial PK | |
| `employee_id` | varchar | |
| `name` | varchar | |
| `email` | varchar | |
| `department` | varchar | |
| `designation` | varchar | |
| `job_level` | varchar | **Added June 2026** — mirrors `organogram.joblevel` |
| `role` | varchar | `employee` / `manager` / `hr` |

### `kra_kpi_sessions` table
Stores generated KRAs/KPIs linked to a JD session, tracking generation steps, suggestions, selection IDs, final payload, status, and conversational states.

### `kra_kpi_conversation_turns` table
Stores the chat turn history for KRA/KPI conversational sessions.

| Column | Type | Notes |
|--------|------|-------|
| `id` | BigInteger PK | Auto-incrementing turn ID |
| `session_id` | UUID FK | References `kra_kpi_sessions.id` |
| `turn_index` | Integer | Turn index for sorting |
| `role` | Text | `user` or `assistant` |
| `content` | Text | Raw user message or JSON string from assistant |
| `created_at` | DateTime | Timestamp |

### `uploaded_kra_kpis` table
Stores admin-uploaded KRAs/KPIs parsed directly from Excel without LLM modifications.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | Unique identifier |
| `employee_id` | varchar | Employee code (indexed, unique) |
| `employee_name` | varchar | Employee name |
| `kras` | JSONB | Core KRAs & KPIs list (`{"kras": [{"title", "description", "kpis": [{"title", "description"}]}]}`) |
| `created_at` | DateTime | Timestamp |
| `updated_at` | DateTime | Timestamp |

### Job Level Mapping (Darwinbox standard)
| Level | Designations |
|-------|--------------|
| Level 1 | Director, CEO, MD |
| Level 2 | Head, Senior General Manager, General Manager |
| Level 3 | Manager, Deputy Manager, Assistant Manager |
| Level 4 | Executive, Senior Executive, Junior Executive |
| Level 5 | Trainee Executive, Intern |

---

## 🛠️ HR Modifications Made (June 2026)

Based on HR instructions, the JD template was updated across the codebase:

1. **Removed `Band` and `Band Name` fields** from the JD template
2. **Renamed `Grade` → `Job Level`** everywhere
3. **Removed `Team` and `Internal Stakeholders` fields** from Working Relationships section

### Files changed for HR modifications:
| File | Change |
|------|--------|
| `backend/app/services/docx_generator.py` | Removed Band rows, renamed Grade → Job Level in DOCX export |
| `backend/app/services/jd_service.py` | Stripped Team/Internal Stakeholders from markdown |
| `backend/app/routers/admin_jd_routes.py` | Removed team size/stakeholder logic in markdown generation |
| `frontend/components/jd/jd-preview-panel.tsx` | Added filter to exclude Band, Team, Internal Stakeholders keys in UI |
| `frontend/components/jd/pdf-document-view.tsx` | Refactored labels; Grade → Job Level in PDF export |
| `frontend/lib/download-jd-pdf.ts` | Updated PDF export HTML to match field removals and renaming |
| `backend/app/routers/jd_routes.py` | **Bug fix (June 2026):** (1) `init_jd` fetches `joblevel` from organogram into session. (2) `save_jd` stamps `job_level` and `location` into `jd_structured`. (3) `GET /{jd_id}` stamps `job_level` and `location` from organogram at read time for old JDs missing these fields. |
| `frontend/app/admin/(dashboard)/jd/[id]/page.tsx` | **Bug fix (June 2026):** Added `job_level` preservation through the schema migration block. Added `job_level` to `structuredData` remapping. Ensures Job Level always passes through to `PdfDocumentView`. |
| `frontend/lib/format-date.ts` | **Bug fix (June 2026):** Created shared date utility (`formatDate`, `formatDateTime`, `formatShortDate`) with fixed `en-GB` locale + `timeZone: "UTC"` to prevent React hydration mismatches in admin pages. |
| `frontend/app/admin/(dashboard)/dashboard/page.tsx` | Replaced inline `toLocaleDateString('en-IN')` with `formatDate()` from shared utility. |
| `frontend/app/admin/(dashboard)/jd-library/page.tsx` | Replaced inline `toLocaleDateString('en-US')` with `formatDateTime()` from shared utility. |
| `frontend/app/admin/(dashboard)/feedback/page.tsx` | Replaced `Intl.DateTimeFormat('en-US')` with `formatDateTime()` from shared utility. |
| `frontend/app/admin/jds/[id]/page.tsx` | Replaced inline `toLocaleDateString('en-US')` with `formatDateTime()` from shared utility. |
| `frontend/components/jd/pdf-document-view.tsx` | **Format fix (June 2026):** Removed `Working Relationships` table. Added `Reporting Manager` row inside Job/Role Information. Renamed `Function` → `Department`. |
| `frontend/lib/download-jd-pdf.ts` | **Format fix (June 2026):** Same as above — removed Working Relationships table, added Reporting Manager inside Job/Role Info, renamed Function → Department in downloadable PDF. |
| `frontend/app/(dashboard)/jd/[id]/page.tsx` | **Feedback fix (June 2026):** Rewritten feedback banner to search the full `reviewComments` list (sorted by `created_at` descending) for the most recent rejection targeting the current user's role. Now employees reliably see manager/HR rejection comments. Also shows full review audit trail (all comments, not just slice(1)). |
| `backend/app/core/database.py` | **DB Timeout Fix (June 2026):** Restructured engine config to apply PostgreSQL-specific options (pool_size=3, max_overflow=2, pool_recycle=300, SSL connection args) conditionally only when the DATABASE_URL is PostgreSQL, preventing startup timeouts and respecting Aiven free tier connection limits. |
| `backend/app/routers/admin_jd_routes.py` | **Admin Preview Fix (June 2026):** Updated `transform_reference_to_jd_session_schema` to map `location` and `job_level` from ReferenceJD structured data so they render correctly in admin previews. |
| `frontend/app/layout.tsx` | **Hydration Fix (June 2026):** Added `suppressHydrationWarning` to the `<html>` tag to silence Next.js development hydration mismatches caused by client-side browser extensions injecting custom attributes (like `data-eazyreach`). |
| `backend/app/crud/jd_crud.py` | **Feedback Notification Fix (June 2026):** Fixed query bug where `not JDReviewComment.is_read` compiled incorrectly in SQLAlchemy as `AND false`, completely blocking unread feedback notifications. Replaced it with `.is_(False)` to restore active sidebar notification counts. |
| `frontend/components/jd/pdf-document-view.tsx` | **Skills & Tools Separation (June 2026):** Separated Skills and Tools/Platforms into distinct rows in Table 3 of the PDF preview panel. |
| `frontend/lib/download-jd-pdf.ts` | **Skills & Tools Separation (June 2026):** Separated Skills and Tools/Platforms into distinct rows in client-side PDF download template. |
| `backend/app/services/docx_generator.py` | **Skills & Tools Separation (June 2026):** Separated Skills and Tools/Platforms into distinct rows in the generated Word (.docx) document. |
| `backend/app/models/kra_kpi_model.py` | **KRA/KPI Feature (June 2026):** New `kra_kpi_sessions` DB table. Stores generated KRAs/KPIs linked to a JD session. Requires employee JD + manager JD + manager KRAs before generation is allowed. |
| `backend/app/agents/kra_kpi_agent.py` | **KRA/KPI Feature (June 2026):** LLM-based KRA/KPI generator with domain-aware prompting (engineering/sales/HR/finance/data), cascade alignment to manager KRAs, weight normalization, and threshold generation. |
| `backend/app/services/kra_kpi_service.py` | **KRA/KPI Feature (June 2026):** Service layer with `check_prerequisites()` (validates all 3 sources), `generate_kra_kpi_for_employee()` (full pipeline), `sync_kra_kpi_session_to_db` (conversational history synchronization) and `MissingPrerequisiteError` for structured missing-info responses. |
| `backend/app/routers/kra_kpi_routes.py` | **KRA/KPI Feature (June 2026):** REST routes: GET status, POST generate, GET fetch, PUT update/confirm. **Bug Fix:** Updated status check endpoint to return `ready=True` for any session active in the workflow (confirmed, sent to manager, sent to HR, approved, rejected) to prevent blocking employee view. |
| `backend/app/main.py` | **KRA/KPI Feature (June 2026):** Registered `kra_kpi_router`. |
| `backend/app/models/__init__.py` | **KRA/KPI Feature (June 2026):** Registered `KRAKPISession` model. |
| `backend/app/agents/kra_kpi_interview_agent.py` | **KRA/KPI Feature (June 2026):** Conversational AI Interview Engine (`KRAKPIInterviewEngine`) for step-by-step metric formulation and cascade alignment (6-step KPI design & SMARTER framework). |
| `frontend/components/jd/kra-kpi-panel.tsx` | **KRA/KPI Feature (June 2026):** React panel with prerequisite banner, weight distribution bar, expandable KRA cards, KPI tables, thresholds, and generate/confirm buttons. |
| `frontend/lib/api.ts` | **KRA/KPI Feature (June 2026):** Added TypeScript interfaces and client API functions (status checks, suggestions, confirmation, `sendKraKpiMessageStream` for conversational SSE chat). |
| `frontend/hooks/useKraKpiChat.ts` | **KRA/KPI Feature (June 2026):** React hook to manage chat thread, progress metrics, status changes, and trigger interactive checklists or weight balancing sliders. |
| `frontend/app/(dashboard)/kra-kpi-interview/[id]/page.tsx` | **KRA/KPI Feature (June 2026):** New dashboard page workspace for conversational AI-guided KRA/KPI alignment, featuring chat message feeds and selection overlays. |
| `frontend/app/(dashboard)/jd/[id]/page.tsx` | **KRA/KPI Feature (June 2026):** Added KRA/KPI tab alongside JD tab. Fixed JSX tab nesting syntax error, correctly matching tab conditionals for both edit and preview. **Bug Fix:** Prevented "Back to Dashboard" button from incorrectly redirecting managers to subordinate employee dashboards instead of their own. |
| `backend/app/core/database.py` | **KRA/KPI Feature (June 2026):** Added automatic table generation (`Base.metadata.create_all`) inside `init_db` to auto-provision the `kra_kpi_sessions` table on startup. |
| `backend/app/services/docx_generator.py` | **KRA/KPI Feature (June 2026):** Appended KRA/KPI framework export support. Formats KRAs, weights, KPI metrics, description, and three-tiered thresholds matching company styles. |
| `backend/app/routers/jd_routes.py` | **KRA/KPI Feature (June 2026):** Fetches active confirmed KRA/KPI sessions in `download_jd_docx` and sends to docx generator. |
| `backend/app/routers/organogram_routes.py` | **Freeze Fix (June 2026):** Added visited sets/cycle detection to `get_all_descendants` and `build_node` to prevent infinite loops and process blocking on circular organogram data. |
| `frontend/app/home/[id]/page.tsx` | **Freeze Fix (June 2026):** Bounded recursive base64 decoding of URL ID parameters to 5 levels max and verified decoded output change to prevent infinite loops. |
| `frontend/app/sso/page.tsx` | **Freeze Fix (June 2026):** Bounded recursive base64 URL ID parameter decoding to 5 levels max with decoded change verification. |
| `frontend/app/(dashboard)/dashboard/[id]/page.tsx` | **Freeze Fix (June 2026):** Bounded recursive base64 URL ID parameter decoding to 5 levels max with decoded change verification. |
| `frontend/components/providers/auth-provider.tsx` | **Freeze Fix (June 2026):** Bounded recursive base64 `emp_cd` parameter decoding to 5 levels max with decoded change verification. |
| `frontend/package.json` | **Freeze Fix (June 2026):** Removed `--turbopack` flag from `dev` script to ensure custom webpack alias configs for `victory-vendor` are loaded. |
| `frontend/app/layout.tsx` | **Freeze Fix (June 2026):** Replaced `Inter` Google Fonts loader with system font fallbacks to prevent Next.js compilation from hanging on font downloads. |
| `frontend/.env.local` / `frontend/.env.example` | **Freeze Fix (June 2026):** Recreated `.env` files to clear iCloud dataless placeholder freezes (`SF_DATALESS` flag). |
| `backend/venv`, `frontend/node_modules`, `frontend/.next` | **Freeze Fix (June 2026):** Symlinked heavy directories to `.nosync` folders to bypass iCloud Drive file locks and high CPU usage. |
| `backend/app/routers/admin_routes.py` | **KRA/KPI Paste Feature (June 2026):** Added `/admin/kra-kpi/analyze-paste` and `/admin/kra-kpi/confirm-paste` endpoints. Defined module-level logger. |
| `backend/app/services/kra_kpi_service.py` | **KRA/KPI Paste & Direct Excel Feature (June 2026):** Added `analyze_kra_kpi_text`, `save_kra_kpi_from_paste`, `parse_kra_kpi_excel` (deterministic Excel parser) and `infer_jd_from_kras`. Intercepted Excel uploads in `process_kra_kpi_document` to bypass LLM extraction. |
| `frontend/app/admin/(dashboard)/jd-library/page.tsx` | **Direct Excel Feature (June 2026):** Integrated Excel upload directly to parse and render preview of KRAs/KPIs deterministically without LLM, hiding weight visualization. |
| `backend/app/models/kra_kpi_model.py` | **Direct Excel Feature (June 2026):** Added `UploadedKRAKPI` database model to store direct admin Excel uploads. |
| `backend/app/routers/kra_kpi_routes.py` | **Direct Excel Feature (June 2026):** Served active admin Excel uploads from `UploadedKRAKPI` table first in status check and session retrieval, returning custom `"uploaded"` step. |
| `frontend/components/jd/kra-kpi-panel.tsx` | **Direct Excel Feature (June 2026):** Added `UploadedView` to render official active admin-uploaded KRA/KPI framework directly on the employee's dashboard. |
| `backend/app/services/dashboard_service.py` | **Multi-Dept Head Fix (June 2026):** Added `get_headed_departments` to locate all departments managed by a head (self + reports). Updated `get_department_employees` to fetch employee codes across all managed departments. |
| `backend/app/routers/hr_routes.py` | **Multi-Dept Head Fix (June 2026):** Updated `get_department_employees` helper to accept single/multiple departments via SQL `ANY`. Updated `get_my_team_employees` to retrieve employees from all departments headed by the user. |
| `backend/app/crud/jd_crud.py` | **Manager Action Required Fix (June 2026):** Loaded `employee` relation in `list_manager_pending_jds` and `list_hr_pending_jds` using `selectinload` to avoid N+1 and lazy-loading errors. |
| `backend/app/routers/jd_routes.py` | **Manager Action Required Fix (June 2026):** Added `employee_name` and `department` to `_serialize_list_item` using async-safe `__dict__` relationship access. |
| `frontend/types/session.ts` | **Manager Action Required Fix (June 2026):** Added `employee_name` and `department` fields to `SessionListItem` type. |
| `frontend/app/(dashboard)/dashboard/[id]/page.tsx` | **Manager Action Required Fix (June 2026):** Added `employee_id` to `JDListItem`. Refactored `JDGrid` cards to display `employee_name (employee_id)` in manager/HR views. |
| `backend/app/routers/hr_routes.py` | **Reload & Startup Fix (June 2026):** Changed `department_name` parameter type in `get_department_employees` to `str` to pass FastAPI startup path validation and prevent infinite reboot crash loops. |
| `backend/watchfiles.toml` | **Reload & Startup Fix (June 2026):** Ignored `.nosync` folders and the `storage/` directory to prevent file change monitoring loops. |
| `frontend/tsconfig.json` | **Typecheck Memory Fix (June 2026):** Added `.nosync` and `.next` directories to `exclude` to prevent Node process OOM during typescript compile checks. |
| `frontend/components/jd/kra-kpi-panel.tsx` | **PALETTE Export Fix (June 2026):** Exported `PALETTE` constant so that it is properly resolved by files importing it, resolving build warnings and potential runtime client crashes. |
| `frontend/build.nosync` | **Webpack Cache Fix (June 2026):** Terminated stale duplicate `next dev` and `next-server` processes and deleted the `build.nosync` cache directory to resolve webpack chunk conflict (`Cannot find module './531.js'`). |
| `frontend/components/jd/kra-kpi-panel.tsx` | **Weight Entry & KPI Lock Feature (June 2026):** Replaced default number input with `WeightInput` to resolve the `021` leading-zero/backspace bug. Added lock button for KPIs to lock custom weights during rebalancing. Added relative weight and computed overall weight (`% overall`) indicators next to KPI rows. Appended KPI weights validation warnings and save/confirm validations. |
| `backend/app/services/kra_kpi_service.py` | **KPI Weights Validation (June 2026):** Modified `save_weights_and_confirm` to validate KPI weights sum to exactly 100% within each KRA, and auto-normalize any ±1 minor rounding offsets. |
| `frontend/components/layout/sidebar.tsx` | **Sidebar Session Binding & Route Highlighting (June 2026):** Decoupled the sidebar queries and navigation links from subordinate path parameter targets (atob decoding), binding navigation to the logged-in user's active session. Refactored isActive highlight function to match tabs by route-section prefixes, resolving highlight bugs and navigation loops. |
| `frontend/app/(dashboard)/dashboard/[id]/page.tsx` | **In-Place KRA/KPI Review Column & Viewer (June 2026):** Added KRA/KPI column to reportees directory table on manager dashboard. Created in-place overlay view of KRAKPIPanel with header/back button when viewing reportee performance targets, eliminating need to navigate away from the dashboard. |
| `frontend/lib/cookies.ts` | **Incognito Storage Fallback (June 2026):** Added `localStorage` and `sessionStorage` fallback support for cookies to prevent auth state loss in privacy/incognito browsing mode. |
| `frontend/components/providers/auth-provider.tsx` | **AuthProvider Incognito Fix (June 2026):** Restored active fallback session keys during one-time cleanup to prevent state clearing loops in incognito mode. |
| `backend/app/routers/admin_routes.py` | **Bulk KRA/KPI Removal (June 2026):** Removed bulk upload endpoints and bulk template download route in favor of structured individual employee uploads. |
| `backend/app/services/kra_kpi_service.py` | **Deterministic Excel KPI Splitter (June 2026):** Introduced `split_kpi_text` helper to split multi-line and bulleted lists in a single Excel cell, perfecting direct parsing of consolidated KPI sheets. |
| `frontend/app/admin/(dashboard)/jd-library/page.tsx` | **Bulk KRA/KPI Tab Removal (June 2026):** Deleted obsolete bulk upload tab/switcher button, functions, states, and JSX rendering blocks to clean up dead UI. |
| `frontend/components/jd/kra-kpi-panel.tsx` | **Uploaded Performance View & Syntax Fix (June 2026):** Rewrote the static `UploadedView` to render accent borders, weights, target dates, and stats header cleanly. Resolved local markup compile error. |
| `frontend/components/layout/sidebar.tsx` | **Hydration Placeholder Sidebar (June 2026):** Rendered an empty width-matched placeholder container when `!isMounted` to prevent flashing layouts and content layout shifts. |
| `backend/app/agents/kra_kpi_agent.py` | **10 Outcome-Oriented KRAs (June 2026):** Prompts LLM for exactly 10 suggestions, phrases titles as achievable outcomes rather than category headings, and removes descriptions/source tasks/manager impact details. |
| `frontend/app/(dashboard)/dashboard/[id]/page.tsx` | **KRA/KPI Under Process Status (June 2026):** Renders "KRA/KPI Under Process" status badge for draft/confirmed statuses, blocks managers from viewing goals under formulation, showing a warning modal overlay instead. |
| `frontend/app/(dashboard)/dashboard/page.tsx` | **KRA/KPI Under Process Status (June 2026):** Renders "KRA/KPI Under Process" status badge for draft/confirmed statuses on main dashboard employee table and own JDs lists. |
| `frontend/app/(dashboard)/jd/[id]/page.tsx` | **Block Manager Goals Tab (June 2026):** Blocks managers/HR/admins from opening or completing the KRA/KPI panel inside JD tabs if goal formulation is still in progress, displaying a styled alert box. |


---

## 📁 Project Structure

```
JD-Agent/
├── backend/
│   ├── app/
│   │   ├── routers/          # FastAPI route handlers
│   │   │   ├── jd_routes.py          # Main JD chat/stream/generate/save
│   │   │   ├── admin_jd_routes.py    # Admin JD management & markdown export
│   │   │   └── kra_kpi_routes.py     # KRA/KPI generation & management (NEW)
│   │   ├── services/
│   │   │   ├── jd_intelligence.py    # JDStructuredData schema + AI extraction
│   │   │   ├── jd_service.py         # JD business logic + markdown rendering
│   │   │   ├── docx_generator.py     # Word DOCX export
│   │   │   └── kra_kpi_service.py    # KRA/KPI orchestration + prerequisite checks (NEW)
│   │   ├── agents/
│   │   │   └── kra_kpi_agent.py      # LLM-based KRA/KPI generator (NEW)
│   │   ├── models/
│   │   │   └── kra_kpi_model.py      # KRAKPISession DB table (NEW)
│   │   ├── schemas/
│   │   │   └── jd_schema.py          # Pydantic schemas
│   │   └── agents/                   # LangGraph agent nodes
├── frontend/
│   ├── components/
│   │   └── jd/
│   │       ├── jd-preview-panel.tsx  # Live JD preview UI
│   │       ├── pdf-document-view.tsx # PDF render component
│   │       ├── kra-kpi-panel.tsx     # KRA/KPI display panel (NEW)
│   │       └── ...
│   └── lib/
│       ├── api.ts                    # + KRA/KPI API functions (UPDATED)
│       └── download-jd-pdf.ts        # PDF download logic
└── scripts/
    └── optimize_server.sh
```

---

## ⚠️ Important Notes
- **No `ruvector.db`** — was a local SQLite dev artifact, intentionally deleted. All data is in Aiven PostgreSQL.
- **No raw Excel files** — `JD's - Employee ID's.xlsx` and `Job level_Grade.xlsx` have been fully migrated into the DB and deleted.
- **JD Template Reuse**: The system matches JD templates by `(department, title)`. If two employees share the same dept + title, the second person sees the existing JD and doesn't need to redo it. To avoid cross-team conflicts, department names should be specific (e.g. `Marketing - Brand A` not just `Marketing`).
- **`JDStructuredData`** in `jd_intelligence.py` is the **source of truth** schema for all JD content fields.

---


## Rules

- Do what has been asked; nothing more, nothing less
- NEVER create files unless absolutely necessary — prefer editing existing files
- NEVER create documentation files unless explicitly requested
- NEVER save working files or tests to root — use `/src`, `/tests`, `/docs`, `/config`, `/scripts`
- ALWAYS read a file before editing it
- NEVER commit secrets, credentials, or .env files
- NEVER add a `Co-Authored-By` trailer to user commits unless this project's `.claude/settings.json` has `attribution.commit` set (#2078). The Claude Code Bash tool may suggest one in its default commit-message template — ignore it. `Co-Authored-By` is semantic authorship attribution under git/GitHub convention; the tool is the facilitator, not a co-author.
- Keep files under 500 lines
- Validate input at system boundaries

## Agent Comms (SendMessage-First Coordination)

Named agents coordinate via `SendMessage`, not polling or shared state.

```
Lead (you) ←→ architect ←→ developer ←→ tester ←→ reviewer
              (named agents message each other directly)
```

### Spawning a Coordinated Team

```javascript
// ALL agents in ONE message, each knows WHO to message next
Agent({ prompt: "Research the codebase. SendMessage findings to 'architect'.",
  subagent_type: "researcher", name: "researcher", run_in_background: true })
Agent({ prompt: "Wait for 'researcher'. Design solution. SendMessage to 'coder'.",
  subagent_type: "system-architect", name: "architect", run_in_background: true })
Agent({ prompt: "Wait for 'architect'. Implement it. SendMessage to 'tester'.",
  subagent_type: "coder", name: "coder", run_in_background: true })
Agent({ prompt: "Wait for 'coder'. Write tests. SendMessage results to 'reviewer'.",
  subagent_type: "tester", name: "tester", run_in_background: true })
Agent({ prompt: "Wait for 'tester'. Review code quality and security.",
  subagent_type: "reviewer", name: "reviewer", run_in_background: true })

// Kick off the pipeline
SendMessage({ to: "researcher", summary: "Start", message: "[task context]" })
```

### Patterns

| Pattern | Flow | Use When |
|---------|------|----------|
| **Pipeline** | A → B → C → D | Sequential dependencies (feature dev) |
| **Fan-out** | Lead → A, B, C → Lead | Independent parallel work (research) |
| **Supervisor** | Lead ↔ workers | Ongoing coordination (complex refactor) |

### Rules

- ALWAYS name agents — `name: "role"` makes them addressable
- ALWAYS include comms instructions in prompts — who to message, what to send
- Spawn ALL agents in ONE message with `run_in_background: true`
- After spawning: STOP, tell user what's running, wait for results
- NEVER poll status — agents message back or complete automatically

## Swarm & Routing

### Config
- **Topology**: hierarchical-mesh (anti-drift)
- **Max Agents**: 15
- **Memory**: hybrid
- **HNSW**: Enabled
- **Neural**: Enabled

```bash
npx @claude-flow/cli@latest swarm init --topology hierarchical --max-agents 8 --strategy specialized
```

### Agent Routing

| Task | Agents | Topology |
|------|--------|----------|
| Bug Fix | researcher, coder, tester | hierarchical |
| Feature | architect, coder, tester, reviewer | hierarchical |
| Refactor | architect, coder, reviewer | hierarchical |
| Performance | perf-engineer, coder | hierarchical |
| Security | security-architect, auditor | hierarchical |

### When to Swarm
- **YES**: 3+ files, new features, cross-module refactoring, API changes, security, performance
- **NO**: single file edits, 1-2 line fixes, docs updates, config changes, questions

### 3-Tier Model Routing

| Tier | Handler | Use Cases |
|------|---------|-----------|
| 1 | Agent Booster (WASM) | Simple transforms — skip LLM, use Edit directly |
| 2 | Haiku | Simple tasks, low complexity |
| 3 | Sonnet/Opus | Architecture, security, complex reasoning |

## Memory & Learning

### Before Any Task
```bash
npx @claude-flow/cli@latest memory search --query "[task keywords]" --namespace patterns
npx @claude-flow/cli@latest hooks route --task "[task description]"
```

### After Success
```bash
npx @claude-flow/cli@latest memory store --namespace patterns --key "[name]" --value "[what worked]"
npx @claude-flow/cli@latest hooks post-task --task-id "[id]" --success true --store-results true
```

### MCP Tools (use `ToolSearch("keyword")` to discover)

| Category | Key Tools |
|----------|-----------|
| **Memory** | `memory_store`, `memory_search`, `memory_search_unified` |
| **Bridge** | `memory_import_claude`, `memory_bridge_status` |
| **Swarm** | `swarm_init`, `swarm_status`, `swarm_health` |
| **Agents** | `agent_spawn`, `agent_list`, `agent_status` |
| **Hooks** | `hooks_route`, `hooks_post-task`, `hooks_worker-dispatch` |
| **Security** | `aidefence_scan`, `aidefence_is_safe`, `aidefence_has_pii` |
| **Hive-Mind** | `hive-mind_init`, `hive-mind_consensus`, `hive-mind_spawn` |

### Background Workers

| Worker | When |
|--------|------|
| `audit` | After security changes |
| `optimize` | After performance work |
| `testgaps` | After adding features |
| `map` | Every 5+ file changes |
| `document` | After API changes |

```bash
npx @claude-flow/cli@latest hooks worker dispatch --trigger audit
```

## Agents

**Core**: `coder`, `reviewer`, `tester`, `planner`, `researcher`
**Architecture**: `system-architect`, `backend-dev`, `mobile-dev`
**Security**: `security-architect`, `security-auditor`
**Performance**: `performance-engineer`, `perf-analyzer`
**Coordination**: `hierarchical-coordinator`, `mesh-coordinator`, `adaptive-coordinator`
**GitHub**: `pr-manager`, `code-review-swarm`, `issue-tracker`, `release-manager`

Any string works as a custom agent type.

## Build & Test

- ALWAYS run tests after code changes
- ALWAYS verify build succeeds before committing

```bash
npm run build && npm test
```

## CLI Quick Reference

```bash
npx @claude-flow/cli@latest init --wizard           # Setup
npx @claude-flow/cli@latest swarm init --v3-mode     # Start swarm
npx @claude-flow/cli@latest memory search --query "" # Vector search
npx @claude-flow/cli@latest hooks route --task ""    # Route to agent
npx @claude-flow/cli@latest doctor --fix             # Diagnostics
npx @claude-flow/cli@latest security scan            # Security scan
npx @claude-flow/cli@latest performance benchmark    # Benchmarks
```

26 commands, 140+ subcommands. Use `--help` on any command for details.

## Setup

```bash
claude mcp add claude-flow -- npx -y @claude-flow/cli@latest
npx @claude-flow/cli@latest daemon start
npx @claude-flow/cli@latest doctor --fix
```

**Agent tool** handles execution (agents, files, code, git). **MCP tools** handle coordination (swarm, memory, hooks). **CLI** is the same via Bash.
