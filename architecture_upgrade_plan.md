# Architecture Upgrade Plan: Admin Brain AI Agent as a "Second Brain"

This document outlines the transition of the **Admin Brain Agent (Pulse)** from a runtime-heavy RAG agent into an architecture featuring an **Offline Enrichment Pipeline** and a **Thin Online Query Pipeline**.

---

## 1. Codebase Audit & Gap Analysis

### Current Codebase Structure vs. Target Architecture
*   **Job Description Triggers:** Currently, [jd_crud.py: _trigger_rag_indexing](file:///Users/manideekshith/Developer/JD-Agent/backend/app/crud/jd_crud.py#L104) is the only active background task that triggers on JD approval. It runs `index_approved_jd` asynchronously.
*   **KRA Trigger Gap:** In the current system, there is **no hook or active trigger** in [kra_kpi_service.py](file:///Users/manideekshith/Developer/JD-Agent/backend/app/services/kra_kpi_service.py) that automatically indexes KRA/KPI frameworks on confirmation. Instead, KRA vector indexing is only performed on-demand via the batch script `scripts/sync_krakpis_to_pinecone.py`.
*   **Vector Retrieval Dependency:** The online query pipeline in [admin_brain_agent_service.py](file:///Users/manideekshith/Developer/JD-Agent/backend/app/services/admin_brain_agent_service.py) does not perform any physical query routing. It runs the query through the exact same Pinecone search ([search_brain_agent_knowledge](file:///Users/manideekshith/Developer/JD-Agent/backend/app/services/admin_brain_agent_service.py#L51)) regardless of intent, resulting in truncated context (limited to the top 8 chunks).

### Extensible hooks vs. New components
1.  **Extend:** We will extend the existing `_trigger_rag_indexing` function in [jd_crud.py](file:///Users/manideekshith/Developer/JD-Agent/backend/app/crud/jd_crud.py) to trigger the offline enrichment jobs (Task Automation Scoring, Employee Work Summary, and Cross-Department Dependency Extraction) alongside Pinecone indexing.
2.  **New Hook:** We must create a new hook `_trigger_kra_enrichment` in [kra_kpi_service.py](file:///Users/manideekshith/Developer/JD-Agent/backend/app/services/kra_kpi_service.py) that fires when `record.status = "confirmed"` is committed. This will update the employee summary with KRA/KPI data.
3.  **New Job Engine:** Create a scheduler module (e.g., using `apscheduler` or a simple cron script) to compute the nightly/weekly `department_rollup_metrics` and run the LLM bottleneck synthesis job.
4.  **Rewrite:** The `AdminBrainAgentService.chat_stream` loop needs a rewrite to parse the new `query_type` and route queries to their respective SQL, map-reduce, or recursive CTE engines.

---

## 2. Architectural Risks & Safety Assessment

### Point-Lookup Safety
The current point-lookup path relies on Pinecone embeddings and metadata filters. To keep this path safe:
*   We will isolate it under `query_type == "POINT_LOOKUP"`.
*   The metadata construction and retrieval code in `vector_service.py` must remain unchanged to ensure that direct employee queries still resolve.

### Entity and Pronoun Resolution
*   The current system extracts entities (like `last_employee_id`) and injects them into the system prompt to resolve pronouns. 
*   **Risk:** When routing to SQL-only query types (e.g., `AGGREGATE_RANKING`), the system bypasses Pinecone. If the user asks a follow-up pronoun query (e.g., *"where can we automate his work?"*), the intent detector might misclassify the scoped follow-up.
*   **Mitigation:** The online router must inspect the persisted `entity_context` (from `BrainAgentSession`) *before* classification. If a pronoun is detected, it should inherit the `target_id` of the last referenced employee and override the classification back to a `POINT_LOOKUP` or specific analytical query.

### Transaction Poisoning
*   **Risk:** Adding several new relational writes and rollups on session threads can poison the main connection if a constraint fails (e.g., if a task description contains special characters that violate SQL types).
*   **Mitigation:** All database writes inside background tasks and rollup executors must be wrapped in isolated savepoint blocks using `async with db.begin_nested()` and follow strict `try/except/rollback` structures.

---

## 3. Concrete SQL Schema (PostgreSQL DDL)

The following tables should be created in the PostgreSQL database:

```sql
-- 1. Task Automation Scores
CREATE TABLE task_automation_scores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id VARCHAR(36) NOT NULL,
    department VARCHAR(255) NOT NULL,
    jd_id UUID NOT NULL REFERENCES jd_sessions(id) ON DELETE CASCADE,
    task_text TEXT NOT NULL,
    automation_score NUMERIC(3, 2) NOT NULL CHECK (automation_score BETWEEN 0.00 AND 1.00),
    automation_reasoning TEXT NOT NULL,
    suggested_tooling JSONB NOT NULL, -- List of tools: ["ToolA", "ToolB"]
    category VARCHAR(50) NOT NULL, -- e.g., "technical", "administrative"
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for fast grouping by department and sorting by score
CREATE INDEX idx_task_auto_dept_score ON task_automation_scores (department, automation_score DESC);

-- 2. Employee Work Summary
CREATE TABLE employee_work_summary (
    employee_id VARCHAR(36) PRIMARY KEY,
    department VARCHAR(255) NOT NULL,
    summary_text TEXT NOT NULL,
    top_tools JSONB NOT NULL, -- ["Excel", "Tally"]
    last_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Cross-Department Dependencies
CREATE TABLE department_dependencies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    from_department VARCHAR(255) NOT NULL,
    to_department VARCHAR(255) NOT NULL,
    dependency_type VARCHAR(100) NOT NULL, -- e.g., "data_handoff", "approval"
    description TEXT NOT NULL,
    evidence_task_id UUID REFERENCES task_automation_scores(id) ON DELETE SET NULL,
    confidence NUMERIC(3, 2) NOT NULL CHECK (confidence BETWEEN 0.00 AND 1.00),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. Department Rollup Metrics
CREATE TABLE department_rollup_metrics (
    department VARCHAR(255) PRIMARY KEY,
    avg_automation_score NUMERIC(3, 2) NOT NULL,
    pct_tasks_high_automation_manual NUMERIC(5, 2) NOT NULL, -- percentage of tasks >= 0.70 score
    overdue_kra_pct NUMERIC(5, 2) NOT NULL,
    draft_stuck_count INT NOT NULL,
    headcount INT NOT NULL,
    cross_dept_dependency_count INT NOT NULL,
    computed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 5. Bottleneck Insights
CREATE TABLE bottleneck_insights (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    department VARCHAR(255) NOT NULL REFERENCES department_rollup_metrics(department) ON DELETE CASCADE,
    insight_text TEXT NOT NULL,
    severity VARCHAR(50) NOT NULL, -- "critical", "warning", "insight"
    evidence JSONB NOT NULL, -- {"headcount": 12, "stuck_drafts": 4}
    computed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

### Hierarchy Queries (CTE Example)
We do not need a new `employee_reports_to` table because hierarchy is already captured in the `organogram` table via `code` and `reporting_manager_code`. Here is a recursive CTE query to trace a 3-hop reporting chain from a given employee code:

```sql
WITH RECURSIVE org_hierarchy AS (
    -- Anchor member
    SELECT code, employee_name, reporting_manager_code, designation, 1 AS depth
    FROM organogram
    WHERE code = :target_emp_code
    
    UNION ALL
    
    -- Recursive member
    SELECT o.code, o.employee_name, o.reporting_manager_code, o.designation, h.depth + 1
    FROM organogram o
    JOIN org_hierarchy h ON o.code = h.reporting_manager_code
    WHERE h.depth < 4 -- limit to 3 hops
)
SELECT * FROM org_hierarchy;
```

---

## 4. LLM Prompt Templates (Gemini JSON Conforming)

These prompts are structured to return valid, raw JSON matches.

### (a) Per-Task Automation Scoring Prompt
```
You are a task analysis engine for a pharmaceutical operations system.
Analyze the following list of job responsibilities for a role and evaluate each task's potential for automation.

Role Title: {{role_title}}
Department: {{department}}
Responsibilities:
{{tasks_list}}

Return a raw JSON object containing an array of scored tasks. Do not include markdown backticks or formatting.
Output Schema:
{
  "tasks": [
    {
      "task_text": "string (the exact task text analyzed)",
      "automation_score": float (between 0.00 and 1.00; where 1.00 is highly automatable and 0.00 is strictly manual/human-required),
      "automation_reasoning": "string (explaining why this score was assigned)",
      "suggested_tooling": ["string (software/tools that can automate or assist in this task)"],
      "category": "technical" | "administrative" | "managerial" | "strategic"
    }
  ]
}
```

### (b) Per-Employee Summary Prompt
```
You are an executive summarization engine. Synthesize the Job Description and KRA/KPI framework for this employee into a brief, professional work summary.

Employee Name: {{employee_name}}
Designation: {{designation}}
Department: {{department}}
Job Description:
{{jd_text}}
KRA Goals:
{{kras_text}}

Return a raw JSON object matching the schema below. Do not include markdown formatting or backticks.
Output Schema:
{
  "summary_text": "string (brief summary of their core function and key business impact, max 4 sentences)",
  "top_tools": ["string (list of primary tools, software, or portals they actively operate)"]
}
```

### (c) Dependency Extraction Prompt
```
You are a organizational dependency extraction engine. 
Analyze the job responsibilities and task workflows for this employee. Extract any explicit or implicit operational dependencies they have on other departments, teams, or external roles (e.g. coordinates with, submits reports to, requires approval from, hands off data to).

Employee Role: {{role_title}}
Department: {{department}}
Tasks & Workflows:
{{tasks_and_workflows}}

Return a raw JSON object matching the schema below. Do not include markdown formatting or backticks.
Output Schema:
{
  "dependencies": [
    {
      "to_department": "string (name of the target department they depend on or coordinate with)",
      "dependency_type": "data_handoff" | "approval" | "coordination" | "system_access",
      "description": "string (details of the handoff or coordination)",
      "confidence": float (between 0.00 and 1.00, representing extraction certainty)"
    }
  ]
}
```

### (d) Rollup Synthesis Prompt
```
You are an executive operational auditor for Pulse Pharma.
You are given aggregated metrics for the {{department}} department, along with a list of active dependencies. 
Analyze these metrics and identify operational bottlenecks, systemic delays, or compliance risks.

Department Metrics:
- Headcount: {{headcount}}
- Average Task Automation Score: {{avg_automation_score}}
- Percentage of Manual Tasks suitable for Automation: {{pct_tasks_high_automation_manual}}%
- Overdue KRA Frameworks: {{overdue_kra_pct}}%
- KRA Sessions stuck in draft status: {{draft_stuck_count}}
- Active Cross-Department Dependencies: {{cross_dept_dependency_count}}

Return a raw JSON object containing prioritized bottleneck insights. Do not include markdown formatting or backticks.
Output Schema:
{
  "insights": [
    {
      "insight_text": "string (clear, direct explanation of the bottleneck or risk)",
      "severity": "critical" | "warning" | "insight",
      "evidence": {
        "metric_key": "string",
        "value": float
      }
    }
  ]
}
```

### (e) Extended Query Type Classification Prompt
```
You are the query routing parser for Pulse Pharma's Executive Intelligence System.
Classify the user's incoming message into one of the designated query types based on the target scope.

User Message: "{{user_message}}"

Allowed query_type values:
- "POINT_LOOKUP": Lookup queries about a single specific employee or a single specific role (e.g. "What is Hema's JD?", "Who does E1014 report to?").
- "AGGREGATE_RANKING": High-level rankings, comparisons, or metrics queries across departments or roles (e.g. "which tasks in Accounts have the highest automation potential?", "list top manual roles in Production").
- "QUALITATIVE_SUMMARY": Queries asking for general summaries of what a team or department does (e.g. "what is the QA team doing?", "summarize the work of the HR department").
- "RELATIONSHIP_QUERY": Queries exploring coordination, dependencies, or reporting paths between departments or roles (e.g. "how does IT's work affect accounts?", "who reports to the Director of Production?").
- "BOTTLENECK_ANALYSIS": Audits of operational bottlenecks, delays, stalled workflows, or compliance issues (e.g. "where are the bottlenecks in QA?", "what are the operational risks in Production?").

Return ONLY a raw JSON object matching this schema:
{
  "query_type": "POINT_LOOKUP" | "AGGREGATE_RANKING" | "QUALITATIVE_SUMMARY" | "RELATIONSHIP_QUERY" | "BOTTLENECK_ANALYSIS",
  "target_scope": "EMPLOYEE" | "DEPARTMENT" | "GLOBAL",
  "target_name": "string" | null
}
```

---

## 5. Feedback Loop Logging Schema

```sql
CREATE TABLE query_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    query TEXT NOT NULL,
    query_type VARCHAR(50) NOT NULL,
    answer TEXT NOT NULL,
    admin_feedback VARCHAR(50) CHECK (admin_feedback IN ('positive', 'negative')),
    admin_notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for pulling negative feedback logs for review
CREATE INDEX idx_query_logs_feedback ON query_logs (admin_feedback) WHERE admin_feedback = 'negative';
```

---

## 6. Scalability & Engineering Trade-offs

### What is Over-engineered (Current Scale: ~100-200 Employees)
*   **Nightly Bottleneck Rollup:** Compiling rollup metrics nightly via LLMs is unnecessary when JDs and KRAs only change a few times a month. Run this on-demand or trigger it only when JDs are approved.
*   **Graph Traversals:** The cross-department dependency extraction table is lightweight. Using a graph database is over-engineered; Postgres recursive CTEs can handle 1-3 hop department relationships instantly.

### What is Under-engineered (Future Scale: >500 Employees)
*   **Map-Reduce for Qualitative Summaries:** For a department of 200 employees, performing map-reduce over 200 individual summaries will cause API rate limiting and token exhaustion.
    *   *Threshold:* Once a department size exceeds **30 employees**, the system must switch from fetching individual summaries to querying pre-aggregated role summaries.
*   **SQLite Fallbacks:** In `vector_service.py`, computing cosine similarities in Python memory for SQLite will cause CPU spikes when querying large taxonomies.
    *   *Threshold:* Once the canonical skills/tools list exceeds **5,000 entries**, pgvector on PostgreSQL must be strictly enforced.

---

## 7. Phased Build Order & Verification Strategy

### Phased Build Order
1.  **Phase 1: DB Migration.** Deploy the DDL schemas for the 6 new tables.
2.  **Phase 2: Offline Enrichment Workers.** Write the background celery/asyncio tasks. Create the KRA confirmation hook in `kra_kpi_service.py`.
3.  **Phase 3: Backfill Script.** Write a script to iterate over all existing approved JDs/KRAs and populate `task_automation_scores`, `employee_work_summary`, and `department_dependencies`.
4.  **Phase 4: Online Query Routing.** Integrate the extended intent classification and route to the new database/synthesis views.
5.  **Phase 5: Cache & Rollup Automation.** Automate the nightly metrics rollup and cache invalidation.

### Manual Verification Plan (Before deploying to production)
*   **Automation Scoring Verification:** Select 5 JDs from different departments. Run the enrichment job. Check the `task_automation_scores` output:
    *   Confirm that highly manual tasks (e.g. "operating packaging line") score $< 0.30$.
    *   Confirm that repetitive digital tasks (e.g. "emailing status updates") score $> 0.70$.
*   **Dependency Extraction Verification:** Verify that dependencies extracted from an HR JD explicitly link to "Finance & Accounts" (for payroll) and "IT" (for system onboarding), checking for false positives.
*   **Query-Type Classification Test:** Run a test suite of 50 query variations. Assert that:
    *   *"What is Hema doing?"* classifies as `POINT_LOOKUP`.
    *   *"Which department has the most manual tasks?"* classifies as `AGGREGATE_RANKING`.
    *   *"Give me a summary of the Production team"* classifies as `QUALITATIVE_SUMMARY`.
