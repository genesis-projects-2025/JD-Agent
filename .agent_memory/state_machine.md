# JD-Agent State Machine Spec

This brain file documents the LangGraph state machine topology, active agent phases, transition rules, and validation logic.

---

## State Machine Topology

The interview phase is modeled as a state machine:
```
START → router → interview_node → gap_detector → END
```
* **`router`**: Inspects user message and redirects the session to the designated agent phase.
* **`interview_node`**: Dispatches the session context to the current active agent.
* **`gap_detector`**: Evaluates collected insights, identifies information gaps, and computes quality scores.

---

## Agent Phases & Transition Rules

Transitions between phases are determined in `backend/app/agents/router.py` via `compute_current_agent()`.

### 1. `BasicInfoAgent` (Starting Phase)
* **Goal**: Collect the basics: role title, department, key mission, and general scope.
* **Triggers next phase when**: The agent has successfully obtained the core basic info (title, department).

### 2. `WorkflowIdentifierAgent` (Tasks & Workflows)
* **Goal**: Collect core day-to-day and week-to-week tasks.
* **Selection Interlocking**: 
  * Generates a candidate list of tasks.
  * Triggers the frontend selection panel where users must confirm or add to the list.
* **Triggers next phase when**: `priority_tasks` is populated in the database.

### 3. `DeepDiveAgent` (Deep Dive)
* **Goal**: Expand on the top selected priority tasks to map out step-by-step workflows, relationships, and context.
* **Triggers next phase when**: The active deep dive task turn count reaches its limit or all priority tasks are fully evaluated.

### 4. `ToolsAgent` (Tools panel)
* **Goal**: Suggest and confirm the list of tools and technologies used.
* **Selection Interlocking**: Triggers the tools selection panel.
* **Triggers next phase when**: Tools are confirmed (`tools_confirmed` in insights).

### 5. `SkillsAgent` (Skills panel)
* **Goal**: Suggest and confirm required core competencies and soft skills.
* **Selection Interlocking**: Triggers the skills selection panel.
* **Triggers next phase when**: Skills are confirmed (`skills_confirmed` in insights).

### 6. `QualificationAgent` (Qualifications)
* **Goal**: Collect target education, years of experience, and credentials.
* **Triggers next phase when**: Target parameters are specified or confirmed.

### 7. `JDGeneratorAgent` (Final generation)
* **Goal**: Synthesize all collected insights into a premium professional markdown Job Description.
* **Triggers next phase when**: The generation is completed and ready for final approval.

---

## Safe Selection and Transition Safeguards

1. **Gate Guarded Interlocking**: Frontend selection components (like `shouldShowPrioritySelection`) check both the presence of items and make sure the active agent phase matches (`WorkflowIdentifierAgent`) to avoid rendering stuck or orphan cards.
2. **Session Memory Sync**: Confirmation endpoints always save the complete state via `session_memory.to_dict()` instead of slicing metadata, preserving active turn counters, deep-dive pointers, and preventing infinite cycles.
