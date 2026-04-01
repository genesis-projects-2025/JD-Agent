#!/usr/bin/env python3
"""
test_agents.py — Comprehensive test suite for the JD Multi-Agent Interview System.

Tests:
  1. Import verification — all modules load without errors
  2. State management — initial state creation, state transitions
  3. Router logic — agent selection based on insights depth
  4. Memory system — question deduplication, session memory
  5. Validators — data quality checks
  6. Gap detector — gap identification
  7. Tool merging — data extraction and merge logic
  8. Full flow simulation — end-to-end agent transitions
  9. Prompt integrity — all agents have prompts
  10. Progress calculation — weighted scoring

Run: python test_agents.py
"""

import sys
import json
import traceback

# ── Color output helpers ──────────────────────────────────────────────────────

GREEN = "\033[92m"
RED = "\033[91m"
YELLOW = "\033[93m"
BLUE = "\033[94m"
RESET = "\033[0m"
BOLD = "\033[1m"

passed = 0
failed = 0
errors = []


def test(name: str):
    """Decorator for test functions."""
    def decorator(func):
        def wrapper():
            global passed, failed
            try:
                func()
                print(f"  {GREEN}✓{RESET} {name}")
                passed += 1
            except Exception as e:
                print(f"  {RED}✗{RESET} {name}")
                print(f"    {RED}Error: {e}{RESET}")
                traceback.print_exc()
                failed += 1
                errors.append((name, str(e)))
        return wrapper
    return decorator


# ══════════════════════════════════════════════════════════════════════════════
# TEST SUITE
# ══════════════════════════════════════════════════════════════════════════════


def run_section(title: str):
    print(f"\n{BOLD}{BLUE}── {title} ──{RESET}")


# ── 1. Import Verification ───────────────────────────────────────────────────

@test("Import state module")
def test_import_state():
    from app.agents.state import AgentState, create_initial_state
    assert AgentState is not None
    assert create_initial_state is not None

@test("Import router module")
def test_import_router():
    from app.agents.router import compute_current_agent, compute_progress, AGENT_ORDER, AGENT_CRITERIA, get_transition_message
    assert len(AGENT_ORDER) == 6
    assert len(AGENT_CRITERIA) == 5  # Excludes JDGeneratorAgent

@test("Import prompts module")
def test_import_prompts():
    from app.agents.prompts import BASE_PROMPT, ORCHESTRATOR_PROMPT, AGENT_PROMPTS
    assert BASE_PROMPT is not None
    assert ORCHESTRATOR_PROMPT is not None
    assert len(AGENT_PROMPTS) == 6  # All 6 agents

@test("Import interview module")
def test_import_interview():
    from app.agents.interview import InterviewEngine, build_interview_messages, engine
    assert engine is not None

@test("Import tools module")
def test_import_tools():
    from app.agents.tools import INTERVIEW_TOOLS, merge_tool_call_into_insights
    assert len(INTERVIEW_TOOLS) == 7

@test("Import validators module")
def test_import_validators():
    from app.agents.validators import sanitise_skills, validate_insights_completeness, compute_quality_score, is_ready_for_jd
    assert sanitise_skills is not None

@test("Import gap_detector module")  
def test_import_gap_detector():
    from app.agents.gap_detector import gap_detector_node
    assert gap_detector_node is not None

@test("Import session_memory module")
def test_import_session_memory():
    from app.memory.session_memory import SessionMemory, AGENT_PHASE_MAP
    assert len(AGENT_PHASE_MAP) == 6
    assert "BasicInfoAgent" in AGENT_PHASE_MAP
    assert "JDGeneratorAgent" in AGENT_PHASE_MAP
    # Verify old agent names are NOT present
    assert "WorkflowDeepDiveAgent" not in AGENT_PHASE_MAP
    assert "ToolsTechAgent" not in AGENT_PHASE_MAP
    assert "SkillExtractionAgent" not in AGENT_PHASE_MAP
    assert "QualificationAgent" not in AGENT_PHASE_MAP

@test("Import graph module")
def test_import_graph():
    from app.agents.graph import run_interview_turn, run_interview_turn_stream
    assert run_interview_turn is not None

@test("Import jd_service module (no KeyError)")
def test_import_jd_service():
    """This test catches the Bug #1 — KeyError for WorkflowDeepDiveAgent/QualificationAgent."""
    from app.services.jd_service import handle_conversation, handle_conversation_stream, handle_jd_generation
    assert handle_conversation is not None


# ── 2. State Management ──────────────────────────────────────────────────────

@test("Create initial state with defaults")
def test_initial_state_defaults():
    from app.agents.state import create_initial_state
    state = create_initial_state(user_message="Hello")
    assert state["user_message"] == "Hello"
    assert state["current_agent"] == "BasicInfoAgent"
    assert state["previous_agent"] == ""
    assert state["turn_count"] == 0
    assert state["insights"] == {}
    assert state["questions_asked"] == []
    assert state["agent_transition_log"] == []
    assert state["ready_for_jd"] == False
    assert state["quality_score"] == 0

@test("Create initial state with pre-filled data")
def test_initial_state_prefilled():
    from app.agents.state import create_initial_state
    state = create_initial_state(
        user_message="test",
        insights={"purpose": "Managing the development team"},
        current_agent="TaskAgent",
        previous_agent="BasicInfoAgent",
        turn_count=3,
        questions_asked=["abc123"],
    )
    assert state["current_agent"] == "TaskAgent"
    assert state["previous_agent"] == "BasicInfoAgent"
    assert state["turn_count"] == 3
    assert len(state["questions_asked"]) == 1


# ── 3. Router Logic ──────────────────────────────────────────────────────────

@test("Router: empty insights → BasicInfoAgent")
def test_router_empty():
    from app.agents.router import compute_current_agent
    agent = compute_current_agent({})
    assert agent == "BasicInfoAgent", f"Expected BasicInfoAgent, got {agent}"

@test("Router: purpose filled → TaskAgent")
def test_router_basic_done():
    from app.agents.router import compute_current_agent
    agent = compute_current_agent({"purpose": "I manage the software development lifecycle for enterprise applications"})
    assert agent == "TaskAgent", f"Expected TaskAgent, got {agent}"

@test("Router: 6 tasks → PriorityAgent")
def test_router_tasks_done():
    from app.agents.router import compute_current_agent
    tasks = [{"description": f"Task {i}", "frequency": "daily", "category": "technical"} for i in range(6)]
    agent = compute_current_agent({"purpose": "Long purpose text here", "tasks": tasks})
    assert agent == "PriorityAgent", f"Expected PriorityAgent, got {agent}"

@test("Router: 3 priorities → DeepDiveAgent")
def test_router_priorities_done():
    from app.agents.router import compute_current_agent
    tasks = [{"description": f"Task {i}"} for i in range(6)]
    agent = compute_current_agent({
        "purpose": "Long purpose text here",
        "tasks": tasks,
        "priority_tasks": ["Task 0", "Task 1", "Task 2"],
    })
    assert agent == "DeepDiveAgent", f"Expected DeepDiveAgent, got {agent}"

@test("Router: all workflows → ToolsSkillsAgent")
def test_router_workflows_done():
    from app.agents.router import compute_current_agent
    tasks = [{"description": f"Task {i}"} for i in range(6)]
    priorities = ["Task 0", "Task 1", "Task 2"]
    workflows = {
        p: {"trigger": "x", "steps": ["step1", "step2"], "tools": [], "output": "y"}
        for p in priorities
    }
    agent = compute_current_agent({
        "purpose": "Long purpose text here",
        "tasks": tasks,
        "priority_tasks": priorities,
        "workflows": workflows,
    })
    assert agent == "ToolsSkillsAgent", f"Expected ToolsSkillsAgent, got {agent}"

@test("Router: everything complete → JDGeneratorAgent")
def test_router_all_done():
    from app.agents.router import compute_current_agent
    tasks = [{"description": f"Task {i}"} for i in range(6)]
    priorities = ["Task 0", "Task 1", "Task 2"]
    workflows = {
        p: {"trigger": "x", "steps": ["step1", "step2"], "tools": [], "output": "y"}
        for p in priorities
    }
    agent = compute_current_agent({
        "purpose": "Long purpose text here",
        "tasks": tasks,
        "priority_tasks": priorities,
        "workflows": workflows,
        "tools": ["Jira", "VS Code"],
        "skills": ["Python", "SQL", "Docker"],
    })
    assert agent == "JDGeneratorAgent", f"Expected JDGeneratorAgent, got {agent}"

@test("Router: transition message exists")
def test_router_transition_msg():
    from app.agents.router import get_transition_message
    msg = get_transition_message("BasicInfoAgent", "TaskAgent")
    assert msg != "", "Expected non-empty transition message"
    msg2 = get_transition_message("ToolsSkillsAgent", "JDGeneratorAgent")
    assert msg2 != "", "Expected non-empty transition message"


# ── 4. Memory System ─────────────────────────────────────────────────────────

@test("SessionMemory: question hash deduplication")
def test_question_dedup():
    from app.memory.session_memory import SessionMemory
    mem = SessionMemory()
    q1 = "Could you describe your role's main purpose?"
    q2 = "Can you describe your role's main purpose?"  # Almost identical
    q3 = "What tools do you use daily?"  # Different question

    assert not mem.is_question_repeated(q1)
    mem.record_question(q1)
    assert mem.is_question_repeated(q1)
    assert mem.is_question_repeated(q2)  # Should match due to normalization
    assert not mem.is_question_repeated(q3)  # Different question

@test("SessionMemory: agent transition tracking")
def test_agent_transition():
    from app.memory.session_memory import SessionMemory
    mem = SessionMemory()
    mem.record_agent_transition("BasicInfoAgent", "TaskAgent")
    assert len(mem.agent_transition_log) == 1
    assert mem.agent_transition_log[0]["from"] == "BasicInfoAgent"
    assert mem.agent_transition_log[0]["to"] == "TaskAgent"
    assert mem.current_stage_question_count == 0  # Reset on transition

@test("SessionMemory: per-stage question counting")
def test_stage_question_count():
    from app.memory.session_memory import SessionMemory
    mem = SessionMemory()
    mem.record_question("Question 1?")
    mem.record_question("Question 2?")
    assert mem.current_stage_question_count == 2
    mem.record_agent_transition("BasicInfoAgent", "TaskAgent")
    assert mem.current_stage_question_count == 0  # Reset

@test("SessionMemory: add_turn and sliding window")
def test_session_memory_sliding():
    from app.memory.session_memory import SessionMemory
    mem = SessionMemory()
    for i in range(10):
        mem.add_turn("user", f"Message {i}")
    assert len(mem.full_history) == 10  # All turns preserved
    assert len(mem.recent_messages) == 6  # Only last 6

@test("SessionMemory: AGENT_PHASE_MAP correctness")
def test_phase_map():
    from app.memory.session_memory import AGENT_PHASE_MAP
    expected = {
        "BasicInfoAgent": 1, "TaskAgent": 2, "PriorityAgent": 3,
        "DeepDiveAgent": 4, "ToolsSkillsAgent": 5, "JDGeneratorAgent": 6,
    }
    assert AGENT_PHASE_MAP == expected, f"Phase map mismatch: {AGENT_PHASE_MAP}"


# ── 5. Validators ────────────────────────────────────────────────────────────

@test("Validators: sanitise_skills removes soft skills")
def test_sanitise_skills():
    from app.agents.validators import sanitise_skills
    skills = ["Python", "communication", "SQL", "teamwork", "Docker", "leadership"]
    clean = sanitise_skills(skills)
    assert "Python" in clean
    assert "SQL" in clean
    assert "Docker" in clean
    assert "communication" not in clean
    assert "teamwork" not in clean
    assert "leadership" not in clean

@test("Validators: validate_task_description")
def test_validate_task():
    from app.agents.validators import validate_task_description
    ok, _ = validate_task_description("Managing the monthly payroll processing for all employees")
    assert ok == True
    ok2, msg = validate_task_description("code")
    assert ok2 == False  # Too short

@test("Validators: validate_insights_completeness")
def test_validate_completeness():
    from app.agents.validators import validate_insights_completeness
    checks = validate_insights_completeness({})
    assert not checks["purpose"]["ok"]
    assert not checks["tasks"]["ok"]

@test("Validators: quality score = 0 for empty insights")
def test_quality_empty():
    from app.agents.validators import compute_quality_score
    score = compute_quality_score({})
    assert score == 0

@test("Validators: is_ready_for_jd requires critical fields")
def test_is_ready():
    from app.agents.validators import is_ready_for_jd
    assert is_ready_for_jd({}) == False
    full = {
        "purpose": "A" * 40,
        "tasks": [{"description": f"t{i}"} for i in range(6)],
        "priority_tasks": ["t0", "t1", "t2"],
        "workflows": {
            "t0": {"steps": ["s1"]},
            "t1": {"steps": ["s1"]},
            "t2": {"steps": ["s1"]},
        },
    }
    assert is_ready_for_jd(full) == True


# ── 6. Gap Detector ──────────────────────────────────────────────────────────

@test("GapDetector: identifies all gaps for empty insights")
def test_gap_detector_empty():
    from app.agents.gap_detector import gap_detector_node
    result = gap_detector_node({"insights": {}})
    assert result["quality_score"] == 0
    assert result["ready_for_jd"] == False
    assert len(result["gaps"]) >= 5  # Should find many gaps

@test("GapDetector: ready when all data is complete")
def test_gap_detector_complete():
    from app.agents.gap_detector import gap_detector_node
    full = {
        "purpose": "A" * 40,
        "tasks": [{"description": f"task {i} details here covering everything"} for i in range(6)],
        "priority_tasks": ["task 0", "task 1", "task 2"],
        "workflows": {
            "task 0": {"steps": ["s1", "s2"]},
            "task 1": {"steps": ["s1", "s2"]},
            "task 2": {"steps": ["s1", "s2"]},
        },
        "tools": ["Jira", "VS Code"],
        "technologies": ["Python"],
        "skills": ["SQL", "Python", "Docker", "Kubernetes"],
        "qualifications": {"education": ["B.Tech CS"]},
    }
    result = gap_detector_node({"insights": full})
    assert result["quality_score"] == 100
    assert result["ready_for_jd"] == True
    assert len(result["gaps"]) == 0


# ── 7. Tool Merging ──────────────────────────────────────────────────────────

@test("Tool merge: save_basic_info")
def test_merge_basic_info():
    from app.agents.tools import merge_tool_call_into_insights
    insights = {}
    result = merge_tool_call_into_insights("save_basic_info", {
        "purpose": "Managing cloud infrastructure",
        "title": "DevOps Engineer",
    }, insights)
    assert result["purpose"] == "Managing cloud infrastructure"
    assert result["basic_info"]["title"] == "DevOps Engineer"

@test("Tool merge: save_tasks with deduplication")
def test_merge_tasks_dedup():
    from app.agents.tools import merge_tool_call_into_insights
    insights = {"tasks": [{"description": "Deploy apps", "frequency": "daily", "category": "technical"}]}
    result = merge_tool_call_into_insights("save_tasks", {
        "tasks": [
            {"description": "Deploy apps", "frequency": "daily", "category": "technical"},  # Duplicate
            {"description": "Monitor servers", "frequency": "daily", "category": "technical"},  # New
        ]
    }, insights)
    assert len(result["tasks"]) == 2  # Should not duplicate

@test("Tool merge: save_workflow")
def test_merge_workflow():
    from app.agents.tools import merge_tool_call_into_insights
    insights = {}
    result = merge_tool_call_into_insights("save_workflow", {
        "task_name": "Deployment",
        "trigger": "New release",
        "steps": ["Build", "Test", "Deploy"],
        "tools_used": ["Jenkins", "Docker"],
        "output": "Deployed app",
    }, insights)
    assert "Deployment" in result["workflows"]
    assert len(result["workflows"]["Deployment"]["steps"]) == 3

@test("Tool merge: save_priority_tasks")
def test_merge_priorities():
    from app.agents.tools import merge_tool_call_into_insights
    insights = {}
    result = merge_tool_call_into_insights("save_priority_tasks", {
        "priorities": ["Task A", "Task B", "Task C"],
    }, insights)
    assert len(result["priority_tasks"]) == 3

@test("Tool merge: save_skills filters soft skills")
def test_merge_skills():
    from app.agents.tools import merge_tool_call_into_insights
    insights = {}
    result = merge_tool_call_into_insights("save_skills", {
        "skills": ["Python", "communication", "SQL", "leadership"],
    }, insights)
    # Should filter out soft skills
    assert "Python" in result["skills"]
    assert "SQL" in result["skills"]
    assert "communication" not in result["skills"]

@test("Tool merge: save_tools_tech")
def test_merge_tools():
    from app.agents.tools import merge_tool_call_into_insights
    insights = {}
    result = merge_tool_call_into_insights("save_tools_tech", {
        "tools": ["Jira", "Slack"],
        "technologies": ["Python", "React"],
    }, insights)
    assert "Jira" in result["tools"]
    assert "Python" in result["technologies"]


# ── 8. Progress Calculation ───────────────────────────────────────────────────

@test("Progress: 0% for empty insights")
def test_progress_empty():
    from app.agents.router import compute_progress
    progress = compute_progress({})
    assert progress["completion_percentage"] == 0
    assert progress["status"] == "collecting"

@test("Progress: increases with data")
def test_progress_increases():
    from app.agents.router import compute_progress
    p1 = compute_progress({})
    p2 = compute_progress({"purpose": "Managing the development team and overseeing code quality"})
    p3 = compute_progress({
        "purpose": "Managing the development team",
        "tasks": [{"description": f"t{i}"} for i in range(6)],
    })
    assert p2["completion_percentage"] > p1["completion_percentage"]
    assert p3["completion_percentage"] > p2["completion_percentage"]

@test("Progress: 100% when complete")
def test_progress_complete():
    from app.agents.router import compute_progress
    full = {
        "purpose": "Managing the development team and overseeing all aspects of code quality",
        "tasks": [{"description": f"task {i}"} for i in range(6)],
        "priority_tasks": ["task 0", "task 1", "task 2"],
        "workflows": {
            "task 0": {"steps": ["s1", "s2"]},
            "task 1": {"steps": ["s1", "s2"]},
            "task 2": {"steps": ["s1", "s2"]},
        },
        "tools": ["Jira", "VS Code"],
        "technologies": ["Python"],
        "skills": ["SQL", "Python", "Docker"],
    }
    progress = compute_progress(full)
    assert progress["completion_percentage"] >= 85, f"Expected ≥85%, got {progress['completion_percentage']}%"
    assert progress["status"] == "ready_for_generation"


# ── 9. Prompt Integrity ──────────────────────────────────────────────────────

@test("All 6 agents have prompts")
def test_all_agents_have_prompts():
    from app.agents.prompts import AGENT_PROMPTS
    from app.agents.router import AGENT_ORDER
    for agent in AGENT_ORDER:
        assert agent in AGENT_PROMPTS, f"Missing prompt for {agent}"

@test("JDGeneratorAgent prompt exists and is non-empty")
def test_jd_generator_prompt():
    from app.agents.prompts import AGENT_PROMPTS
    prompt = AGENT_PROMPTS["JDGeneratorAgent"]
    assert len(prompt) > 50, "JDGeneratorAgent prompt is too short"
    assert "interview is complete" in prompt.lower() or "all data" in prompt.lower()

@test("BASE_PROMPT contains anti-repetition rules")
def test_base_prompt_rules():
    from app.agents.prompts import BASE_PROMPT
    assert "ONE QUESTION PER RESPONSE" in BASE_PROMPT
    assert "NEVER ASSUME" in BASE_PROMPT
    assert "NO QUESTION REPETITION" in BASE_PROMPT


# ── 10. Full Flow Simulation ─────────────────────────────────────────────────

@test("Full flow: agent transitions in correct order")
def test_full_flow():
    from app.agents.router import compute_current_agent
    from app.memory.session_memory import SessionMemory

    mem = SessionMemory()
    insights = {}

    # Stage 1: BasicInfoAgent
    agent = compute_current_agent(insights)
    assert agent == "BasicInfoAgent"

    # User provides purpose
    insights["purpose"] = "I am responsible for managing the software development lifecycle for enterprise clients"
    agent = compute_current_agent(insights)
    assert agent == "TaskAgent"
    mem.record_agent_transition("BasicInfoAgent", agent)

    # Stage 2: TaskAgent — collect 6 tasks
    for i in range(6):
        insights.setdefault("tasks", []).append({
            "description": f"Task {i}: Detailed work description number {i}",
            "frequency": "daily",
            "category": "technical",
        })
    agent = compute_current_agent(insights)
    assert agent == "PriorityAgent"
    mem.record_agent_transition("TaskAgent", agent)

    # Stage 3: PriorityAgent
    insights["priority_tasks"] = ["Task 0: Detailed work description number 0",
                                   "Task 1: Detailed work description number 1",
                                   "Task 2: Detailed work description number 2"]
    agent = compute_current_agent(insights)
    assert agent == "DeepDiveAgent"
    mem.record_agent_transition("PriorityAgent", agent)

    # Stage 4: DeepDiveAgent — workflows for each priority
    insights["workflows"] = {}
    for pt in insights["priority_tasks"]:
        insights["workflows"][pt] = {
            "trigger": "When needed",
            "steps": ["Step 1", "Step 2", "Step 3"],
            "tools": ["Tool A"],
            "output": "Completed deliverable",
        }
    agent = compute_current_agent(insights)
    assert agent == "ToolsSkillsAgent"
    mem.record_agent_transition("DeepDiveAgent", agent)

    # Stage 5: ToolsSkillsAgent
    insights["tools"] = ["Jira", "VS Code", "Slack"]
    insights["skills"] = ["Python", "SQL", "Docker", "Kubernetes"]
    agent = compute_current_agent(insights)
    assert agent == "JDGeneratorAgent"
    mem.record_agent_transition("ToolsSkillsAgent", agent)

    # Verify transition log
    assert len(mem.agent_transition_log) == 5
    assert mem.agent_transition_log[0]["from"] == "BasicInfoAgent"
    assert mem.agent_transition_log[-1]["to"] == "JDGeneratorAgent"

@test("No KeyError in jd_service progress computation")
def test_no_keyerror_in_progress():
    """This specifically validates Bug #1 is fixed — _compute_progress_percentage
    used to crash with KeyError on WorkflowDeepDiveAgent and QualificationAgent."""
    from app.agents.router import compute_progress
    # Test with various states — none should throw KeyError
    test_cases = [
        {},
        {"purpose": "test"},
        {"purpose": "test", "tasks": [{"description": "t1"}]},
        {"purpose": "test", "tasks": [{"description": "t1"}] * 6, "priority_tasks": ["t1"]},
        {"purpose": "test", "tasks": [{"description": "t1"}] * 6,
         "priority_tasks": ["t1", "t2", "t3"],
         "workflows": {"t1": {"steps": ["s1"]}}},
    ]
    for case in test_cases:
        try:
            progress = compute_progress(case)
            assert "completion_percentage" in progress
        except KeyError as e:
            raise AssertionError(f"KeyError in compute_progress: {e}")


# ── 11. Interview Message Building ────────────────────────────────────────────

@test("Message building includes all required system prompts")
def test_message_building():
    from app.agents.interview import build_interview_messages
    messages = build_interview_messages(
        agent_name="BasicInfoAgent",
        insights={},
        recent_messages=[],
        user_message="Hello, I'm ready to start",
    )
    # Should have: BASE_PROMPT, ORCHESTRATOR, AGENT PROMPT, COLLECTED DATA, FORMAT REMINDER, SHARED MEMORY, USER MSG
    assert len(messages) >= 6, f"Expected ≥6 messages, got {len(messages)}"
    # First message should be base prompt
    assert "Saniya" in messages[0].content

@test("Message building with transition context")
def test_message_building_transition():
    from app.agents.interview import build_interview_messages
    messages = build_interview_messages(
        agent_name="TaskAgent",
        insights={"purpose": "Managing development operations"},
        recent_messages=[],
        user_message="Sure, let me explain",
        transition_context="That gives me a great picture of your role's purpose.",
    )
    # Find the transition message
    has_transition = any("AGENT TRANSITION" in m.content for m in messages)
    assert has_transition, "Transition context not found in messages"


# ══════════════════════════════════════════════════════════════════════════════
# RUN ALL TESTS
# ══════════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    print(f"\n{BOLD}{'=' * 60}")
    print(f"  JD Multi-Agent System — Test Suite")
    print(f"{'=' * 60}{RESET}")

    run_section("1. Import Verification")
    test_import_state()
    test_import_router()
    test_import_prompts()
    test_import_interview()
    test_import_tools()
    test_import_validators()
    test_import_gap_detector()
    test_import_session_memory()
    test_import_graph()
    test_import_jd_service()

    run_section("2. State Management")
    test_initial_state_defaults()
    test_initial_state_prefilled()

    run_section("3. Router Logic (Agent Selection)")
    test_router_empty()
    test_router_basic_done()
    test_router_tasks_done()
    test_router_priorities_done()
    test_router_workflows_done()
    test_router_all_done()
    test_router_transition_msg()

    run_section("4. Memory System")
    test_question_dedup()
    test_agent_transition()
    test_stage_question_count()
    test_session_memory_sliding()
    test_phase_map()

    run_section("5. Validators")
    test_sanitise_skills()
    test_validate_task()
    test_validate_completeness()
    test_quality_empty()
    test_is_ready()

    run_section("6. Gap Detector")
    test_gap_detector_empty()
    test_gap_detector_complete()

    run_section("7. Tool Merging")
    test_merge_basic_info()
    test_merge_tasks_dedup()
    test_merge_workflow()
    test_merge_priorities()
    test_merge_skills()
    test_merge_tools()

    run_section("8. Progress Calculation")
    test_progress_empty()
    test_progress_increases()
    test_progress_complete()

    run_section("9. Prompt Integrity")
    test_all_agents_have_prompts()
    test_jd_generator_prompt()
    test_base_prompt_rules()

    run_section("10. Full Flow Simulation")
    test_full_flow()
    test_no_keyerror_in_progress()

    run_section("11. Interview Message Building")
    test_message_building()
    test_message_building_transition()

    # ── Summary ───────────────────────────────────────────────────────────
    print(f"\n{BOLD}{'=' * 60}")
    total = passed + failed
    if failed == 0:
        print(f"  {GREEN}ALL {total} TESTS PASSED ✓{RESET}")
    else:
        print(f"  {RED}{failed}/{total} TESTS FAILED ✗{RESET}")
        print(f"\n  Failed tests:")
        for name, err in errors:
            print(f"    {RED}✗{RESET} {name}: {err}")
    print(f"{'=' * 60}{RESET}\n")
    
    sys.exit(0 if failed == 0 else 1)
