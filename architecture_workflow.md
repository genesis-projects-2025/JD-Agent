# JD-Agent Technical Architecture & Workflow Design

Welcome! This document provides an in-depth, interactive architectural guide and complete end-to-end workflow walkthrough of the **JD-Agent** system. It details the exact relationships, triggers, data flows, and database schemas of the entire application.

---

## 🗺️ High-Level System Architecture

This diagram illustrates the multi-tier topology of **JD-Agent**, depicting how the React/Next.js frontend connects to the FastAPI backend, which orchestrates relational, cache, vector, and LLM services.

```mermaid
graph TD
    %% Styling
    classDef frontend fill:#3b82f6,stroke:#1d4ed8,stroke-width:2px,color:#fff;
    classDef backend fill:#10b981,stroke:#047857,stroke-width:2px,color:#fff;
    classDef storage fill:#f59e0b,stroke:#b45309,stroke-width:2px,color:#fff;
    classDef ai fill:#8b5cf6,stroke:#6d28d9,stroke-width:2px,color:#fff;

    %% Frontend Components
    subgraph Frontend [Next.js Web App]
        UI["Interactive UI Components (React)"]:::frontend
        UC["useChat Hooks & State Management"]:::frontend
    end

    %% Backend Layers
    subgraph Backend [FastAPI Server]
        R["FastAPI Routers (REST Endpoints)"]:::backend
        S["JD Service Layer (Orchestrator)"]:::backend
        LM["LangGraph Multi-Agent Engine"]:::backend
        EX["Extraction & Semantic Engines"]:::backend
        VS["Pinecone Vector Service"]:::backend
    end

    %% Storage Services
    subgraph Storage [Persistent & Cache Storage]
        DB[("PostgreSQL Database (SQLAlchemy)")]:::storage
        Cache[("Redis Session Cache")]:::storage
    end

    %% AI Services
    subgraph AI [Google Gemini Integration]
        Embed["gemini-embedding-001 (Embeddings)"]:::ai
        Flash["gemini-2.5-flash (Conversational Interview)"]:::ai
        Pro["gemini-2.5-pro (Synthesis & JD Generation)"]:::ai
    end

    %% Vector Database
    subgraph Vector [Semantic Retrieval]
        PC[("Pinecone Serverless Index")]:::storage
    end

    %% Connections
    UI <--> |REST & Server-Sent Events (SSE)| R
    UC <--> UI
    R <--> |Get/Set Active Session| Cache
    R <--> |Hydrate / Persist State| DB
    R <--> S
    S <--> LM
    LM <--> |State Graph turns| EX
    LM <--> |Surgical category retrieval| VS
    VS <--> Embed
    VS <--> PC
    EX <--> Flash
    S <--> Pro
```

---

## 🌀 Message Processing & Multi-Agent State Loop

Every turn of a conversational interview (streamed back to the user via Server-Sent Events) follows a highly resilient, two-pass pipeline designed to extract data first and then formulate next-step questions.

```mermaid
sequenceDiagram
    autonumber
    actor User as Employee / User
    participant FE as Next.js (useChat hook)
    participant BE as FastAPI (jd_routes.py)
    participant Redis as Redis Cache
    participant DB as PostgreSQL
    participant Graph as LangGraph Engine (graph.py)
    participant Extractor as Extraction Engine (extraction_engine.py)
    participant Router as Phase Router (router.py)
    participant Gemini as Gemini API

    User->>FE: Type message & click Send
    FE->>BE: POST /jd/chat/stream {message, history, session_id}
    BE->>Redis: Check for hot session cache
    alt Cache Miss
        Redis-->>BE: Null
        BE->>DB: Query JDSession & last 6 turns
        DB-->>BE: Session record & history data
    else Cache Hit
        Redis-->>BE: Serialized session state
    end
    BE->>BE: Reconcile and Hydrate SessionMemory
    
    %% Multi-Agent Execution Start
    BE->>Graph: run_interview_turn_stream(session_memory, user_message)
    
    %% Two-Pass Extraction
    Graph->>Extractor: extract_information(user_message, insights, current_agent)
    Extractor->>Gemini: Call Gemini 2.5 Flash (Extract insights JSON)
    Gemini-->>Extractor: Extracted insights (schedules, tasks, tools)
    Extractor-->>Graph: Return structured extraction
    Graph->>Graph: Merge extraction non-destructively into Insights
    
    %% Router decision
    Graph->>Router: compute_current_agent(insights, current_agent)
    Router->>Router: Evaluate AGENT_CRITERIA checks
    Router-->>Graph: Returns Active Agent (e.g. DeepDiveAgent)
    
    %% Question Formulation
    Graph->>Gemini: stream_turn(build_interview_messages) [Gemini 2.5 Flash]
    loop Streaming SSE Chunks
        Gemini-->>FE: SSE data: {"type": "chunk", "content": "..."}
        FE->>User: Render text progressively
    end
    
    %% Post-processing & Validation
    Graph->>Graph: Run validation checks (ensure ends with question, trim leaks)
    Graph->>BE: Complete stream & return final insights metadata
    BE->>DB: Persist state & new turns
    BE->>Redis: Cache hot session (5m TTL)
    BE-->>FE: SSE data: {"type": "done", "parsed": {...}}
    FE->>User: Unlock inputs & render interactive UI widgets
```

---

## 🧩 Architectural Phases & Routing Criteria

The system ensures a strict, linear flow from start to finish. Below are the sequential phases, along with their gating mechanisms managed by the `Router` (`backend/app/agents/router.py`).

| Phase # | Active Agent | Progress Range | Completion/Gating Criteria | Triggered Actions |
| :--- | :--- | :---: | :--- | :--- |
| **1** | **BasicInfoAgent** | `0% ➔ 15%` | Purpose captured (>= 10 chars) AND (cadence probed over >= 3 turns OR >= 4 tasks identified) or 5 turns hard stop. | Probes roles, reporting lines, and overall purpose of the employee. |
| **2** | **WorkflowIdentifierAgent** | `15% ➔ 25%` | At least 1 priority task selected, or 4 turns guardrail limit. | Renders interactive checkbox UI in the frontend where the employee selects their top 3-5 high-impact tasks. |
| **3** | **DeepDiveAgent** | `25% ➔ 85%` | All chosen priority tasks have been fully visited and analyzed. | Executes a **strict 2+1 turn protocol** for each selected task (Compulsory Turn 1: Triggers/Inputs; Compulsory Turn 2: Challenges/Outputs; Optional Turn 3: Edge cases). |
| **4** | **ToolsAgent** | `85% ➔ 90%` | Tools confirmed via interactive UI, or 3 turns guardrail limit. | Uses surgical RAG retrieval from Pinecone to present standard tools. Renders selectable inventory chips. |
| **5** | **SkillsAgent** | `90% ➔ 95%` | Skills confirmed via interactive UI, or 3 turns guardrail limit. | Uses surgical RAG retrieval from Pinecone to present standard competencies. Renders selectable inventory chips. |
| **6** | **QualificationAgent** | `95% ➔ 99%` | At least 2 turns (capturing education & experience details) or 3 turns guardrail limit. | Probes academic credentials, certifications, and industry background. |
| **7** | **JDGeneratorAgent** | `100%` | Triggers when all prior phases are complete. | Synthesizes the final Job Description. |

---

## 🗄️ Database Schema & Relationships

The PostgreSQL relational structure (`backend/app/models/`) is fully tuned for performance with composite indexes designed for the sidebar queries, manager queues, and HR dashboards.

```mermaid
erDiagram
    employees ||--o{ jd_sessions : "has"
    employees ||--o{ review_comments : "writes"
    jd_sessions ||--o{ conversation_turns : "comprises"
    jd_sessions ||--o{ jd_versions : "versions"
    jd_sessions ||--o{ review_comments : "receives"

    employees {
        string id PK "Employee Code (e.g. C0014)"
        string name "Full Name"
        string email "Contact Email"
        string department "Department"
        string reporting_manager "Manager Name"
        string reporting_manager_code "Manager ID Code"
        string role "System Access Role (employee | manager | hr)"
        string phone_mobile "Mobile Number"
        datetime created_at
    }

    jd_sessions {
        uuid id PK "Session ID"
        string employee_id FK "Owner Employee ID"
        string source_reference_jd_id FK "Linked template reference"
        text title "JD Role Title"
        text department "Department Name"
        string status "Session Status (collecting | ready_for_generation | jd_generated | sent_to_manager | manager_rejected | sent_to_hr | hr_rejected | approved)"
        integer version "Active Version Counter"
        text jd_text "Raw Markdown representation"
        jsonb jd_structured "Full formatted JSON representation"
        jsonb insights "Aggregated Extraction data"
        jsonb conversation_state "LangGraph operational state"
        string reviewed_by "Reviewer ID"
        text reviewer_comment "Reviewer Summary"
        datetime reviewed_at
        datetime created_at
        datetime updated_at
    }

    conversation_turns {
        bigint id PK
        uuid session_id FK "Owner Session ID"
        integer turn_index "Turn Ordering sequence"
        string role "user | assistant"
        text content "Raw JSON payload or user string"
        datetime created_at
    }

    jd_versions {
        bigint id PK
        uuid session_id FK "Owner Session ID"
        integer version "Version Number"
        text jd_text "Markdown string"
        jsonb jd_structured "Structured JD JSON"
        string created_by "Creator User ID"
        datetime created_at
    }

    review_comments {
        uuid id PK
        uuid jd_session_id FK "Target Session ID"
        string reviewer_id FK "Reviewing User ID"
        text content "Review feedback text"
        string role "manager | hr | employee"
        boolean is_read "Unread notification toggle"
        datetime created_at
    }
```

---

## ⚡ File-by-File Operational Directory

Here is a directory of which file contains what code and what operations they trigger:

### 1. Frontend Layer (`frontend/`)

* **[page.tsx](file:///Users/manideekshith/Desktop/JD-Agent/frontend/app/page.tsx)**: The landing panel. Triggers employee SSO login and searches employees from directory.
* **[sso-sync / login_organogram](file:///Users/manideekshith/Desktop/JD-Agent/frontend/app/sso/page.tsx)**: SSO redirection screen. Calls `/auth/sso-sync` on the backend to synchronize profiles.
* **[questionnaire/[id]/page.tsx](file:///Users/manideekshith/Desktop/JD-Agent/frontend/app/(dashboard)/questionnaire/[id]/page.tsx)**: The interview workspace. Integrates the chat log, interactive selection widgets, fallback voice transcription synthesis, and sliding JD preview panel.
* **[useChat.ts](file:///Users/manideekshith/Desktop/JD-Agent/frontend/hooks/useChat.ts)**: Next.js state machine. Handles incoming stream payloads, handles SSE chunks, holds state for tools/skills inventory choices, and triggers explicit calls like `/jd/generate`, `/jd/save`, and `/jd/confirm-skills`.

### 2. Backend Router Layer (`backend/app/routers/`)

* **[main.py](file:///Users/manideekshith/Desktop/JD-Agent/backend/app/main.py)**: The API Gateway. Loads Gzip and CORS middleware, registers lifespan callbacks to trigger database migrations, and exposes readiness checks mapping DB, Redis, and Pinecone status.
* **[organogram_routes.py](file:///Users/manideekshith/Desktop/JD-Agent/backend/app/routers/organogram_routes.py)**: Synchronizes profiles. Resolves hierarchy roles (employee, manager, head, hr) based on the organogram table, syncs entries to PostgreSQL, and builds recursive territory hierarchy trees.
* **[jd_routes.py](file:///Users/manideekshith/Desktop/JD-Agent/backend/app/routers/jd_routes.py)**: Orchestrates active session endpoints. Exposes endpoints to initialize interviews, handle sync and stream chat turns, trigger JD drafts, capture tool confirmations, save final versions, retrieve comments, and download branded documents.

### 3. Service Layer (`backend/app/services/`)

* **[jd_service.py](file:///Users/manideekshith/Desktop/JD-Agent/backend/app/services/jd_service.py)**: The integration controller. Runs LLM retries on transient errors, extracts valid JSON from complex LLM outputs using Stack bracket counters, merges new extractions into insights, and manages the JD synthesis prompt.
* **[vector_service.py](file:///Users/manideekshith/Desktop/JD-Agent/backend/app/services/vector_service.py)**: Coordinates vector search. Generates embeddings, segments and indexes approved JDs into Pinecone with categorical headers (`role_summary`, `responsibilities`, `tools`, `skills`, `qualification`, `workflow`), and conducts advanced RAG searches.
* **[docx_generator.py](file:///Users/manideekshith/Desktop/JD-Agent/backend/app/services/docx_generator.py)**: Document generation engine. Takes structured JSON schemas and generates branded, formatted MS Word documents (.docx) ready for corporate distribution.

### 4. LangGraph Multi-Agent Engine (`backend/app/agents/`)

* **[graph.py](file:///Users/manideekshith/Desktop/JD-Agent/backend/app/agents/graph.py)**: LangGraph builder. Declares the state graph nodes and sets up the linear edges flowing from the Router node through specific agent nodes into the Gap Detector and out to the end.
* **[router.py](file:///Users/manideekshith/Desktop/JD-Agent/backend/app/agents/router.py)**: Orchestration logic. Holds strict `AGENT_ORDER` arrays, checks the status of collected insights against completion criteria, and calculates the overall completion percentage.
* **[extraction_engine.py](file:///Users/manideekshith/Desktop/JD-Agent/backend/app/agents/extraction_engine.py)**: Deep intelligence extractor. Inspects the user's message using targeted prompts to extract job parameters before the conversational node responds.
* **[interview.py](file:///Users/manideekshith/Desktop/JD-Agent/backend/app/agents/interview.py)**: Conversational builder. Formulates questions using dynamic prompts, retrieves context from Pinecone, checks for repeated questions, and enforces strict punctuation and length validations.
* **[gap_detector.py](file:///Users/manideekshith/Desktop/JD-Agent/backend/app/agents/gap_detector.py)**: Compliance manager. Reviews collected insights for quality gaps (missing outputs, frequencies, context anomalies) and reports an overall compliance rating.

---

## 🚀 Step-by-Step System Lifecycle Walkthrough

Here is the exact operational flow when an employee runs an interview:

### Phase A: Synced Identity Login
1. The user logs in with their Employee Code on the **Next.js Frontend**.
2. **FastAPI Backend** processes the login request through `auth/sso-sync` inside `organogram_routes.py`. It looks up hierarchy relations in the `organogram` table, derives their system role, upserts their profile into the `employees` table, and returns their profile.
3. The frontend stores their identifier and department in a local secure cookie.

### Phase B: Session Start & Context Pre-fill
1. The user clicks "Start New Interview", triggering `POST /jd/init` inside `jd_routes.py`.
2. The router pulls employee information (e.g. reporting structure, designation, date of joining) from the database and inserts it as **pre-filled identity context** in the session memory.
3. A UUID is generated for the session, saved in `jd_sessions`, and returned to the frontend.

### Phase C: Conversational Interview Turn
1. The user writes a message and clicks send. The Next.js frontend calls `POST /jd/chat/stream` using the SSE-enabled `useChat` hook.
2. The backend hydrates session data from **Redis** (or PostgreSQL) into a transient `SessionMemory` instance.
3. The server invokes `handle_conversation_stream` in `jd_service.py`, which delegates to the LangGraph runner.
4. **First Pass (Extraction)**: `extraction_engine.py` calls Gemini 2.5 Flash to extract raw structured insights (e.g., specific tasks, operational cadence) from the user's message.
5. **Insights Merging**: These insights are merged into session memory, and the current active agent is evaluated against the gating criteria in `router.py`.
6. **Second Pass (Conversation)**: The active agent builds a dynamic prompt, pulls RAG context from Pinecone, and streams the conversational response.
7. **Validation & Cache**: The response is validated (ensuring it ends with a question, trimming code leaks), saved back to PostgreSQL and Redis, and sent to the user.

### Phase D: Interactive Selection Interludes
1. When transitioning from **Basic Info** to **Deep Dive**, `WorkflowIdentifierAgent` is triggered. Instead of asking a question, it returns a structured task array. The frontend renders checkboxes where the user picks their top 3-5 priority tasks.
2. When transitioning from **Deep Dive** to **Tools/Skills**, the `ToolsAgent`/`SkillsAgent` retrieve standard inventories via vector search and auto-populate them in the UI. The user confirms their selection, which is saved via `confirm-tools` and `confirm-skills` endpoints.

### Phase E: JD Generation & HR Approval
1. Once all phases complete, the frontend unlocks the "View JD" button, calling `POST /jd/generate`.
2. The backend service gathers all structured insights, calls Gemini 2.5 Pro to synthesize them into markdown and JSON schemas, and saves them in the database.
3. The employee reviews the draft and submits it. The session status advances to `sent_to_manager`.
4. The manager and HR review the draft on their dashboards. They can write comments (`review_comment_model.py`) and approve or reject the draft. When a draft is approved, `vector_service.py` chunks and indexes the approved JD into Pinecone, making it a reference template for future interviews.
5. If the draft is rejected, the employee receives an unread feedback notification and can resume the interview to make corrections.
6. Once fully approved, the employee can export their official Job Description as a branded Word document via `GET /jd/{id}/download`.
