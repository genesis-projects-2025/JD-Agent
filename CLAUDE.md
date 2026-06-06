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
| `backend/app/routers/jd_routes.py` | **Bug fix (June 2026):** (1) `init_jd` fetches `joblevel` from organogram into session. (2) `save_jd` stamps `job_level` into `jd_structured`. (3) `GET /{jd_id}` stamps `job_level` from organogram at read time for old JDs missing the field. |
| `frontend/app/admin/(dashboard)/jd/[id]/page.tsx` | **Bug fix (June 2026):** Added `job_level` preservation through the schema migration block. Added `job_level` to `structuredData` remapping. Ensures Job Level always passes through to `PdfDocumentView`. |
| `frontend/lib/format-date.ts` | **Bug fix (June 2026):** Created shared date utility (`formatDate`, `formatDateTime`, `formatShortDate`) with fixed `en-GB` locale + `timeZone: "UTC"` to prevent React hydration mismatches in admin pages. |
| `frontend/app/admin/(dashboard)/dashboard/page.tsx` | Replaced inline `toLocaleDateString('en-IN')` with `formatDate()` from shared utility. |
| `frontend/app/admin/(dashboard)/jd-library/page.tsx` | Replaced inline `toLocaleDateString('en-US')` with `formatDateTime()` from shared utility. |
| `frontend/app/admin/(dashboard)/feedback/page.tsx` | Replaced `Intl.DateTimeFormat('en-US')` with `formatDateTime()` from shared utility. |
| `frontend/app/admin/jds/[id]/page.tsx` | Replaced inline `toLocaleDateString('en-US')` with `formatDateTime()` from shared utility. |

---

## 📁 Project Structure

```
JD-Agent/
├── backend/
│   ├── app/
│   │   ├── routers/          # FastAPI route handlers
│   │   │   ├── jd_routes.py          # Main JD chat/stream/generate/save
│   │   │   └── admin_jd_routes.py    # Admin JD management & markdown export
│   │   ├── services/
│   │   │   ├── jd_intelligence.py    # JDStructuredData schema + AI extraction
│   │   │   ├── jd_service.py         # JD business logic + markdown rendering
│   │   │   └── docx_generator.py     # Word DOCX export
│   │   ├── schemas/
│   │   │   └── jd_schema.py          # Pydantic schemas
│   │   └── agents/                   # LangGraph agent nodes
├── frontend/
│   ├── components/
│   │   └── jd/
│   │       ├── jd-preview-panel.tsx  # Live JD preview UI
│   │       ├── pdf-document-view.tsx # PDF render component
│   │       └── ...
│   └── lib/
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
