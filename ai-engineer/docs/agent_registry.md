# Autonomous Agent Registry

This registry records every active AI Agent configured in the `ai-engineer` workspace.

## 1. Orchestrators

### Planner Agent
* **Role**: Breaks down high-level, complex goals into sub-tasks.
* **Output**: `DevelopmentPlan` (list of sub-tasks).

### Supervisor Agent
* **Role**: Monitors sub-agent executions, evaluates quality scores, and schedules recovery steps.

### Meta Agent
* **Role**: The main interface router. Inspects incoming user queries and routes to the correct orchestrator.

## 2. Specialized Worker Subagents

* **Code Writer Agent**: Writes syntactically correct Python/TypeScript code.
* **Code Reviewer Agent**: Evaluates security, complexity, and styling conventions.
* **Code Debugger Agent**: Isolates and fixes script runtime exceptions.
* **RAG Agent**: Fetches database records from Pinecone indices.
* **JD Synthesis Agent**: Compiles JD interview notes using Gemini Pro.\n