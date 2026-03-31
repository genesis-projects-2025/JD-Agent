import os
import sys

# Add backend to path
sys.path.append(os.path.join(os.path.dirname(__file__), ".."))

from app.services.jd_service import (
    _compute_current_agent,
    _get_depth_scores,
    _compute_progress_percentage,
    sanitise_skills,
)


def test_agent_transitions():
    """Test that the orchestrator correctly identifies the next agent based on depth criteria."""
    
    # 1. Initially, should be BasicInfoAgent
    insights = {}
    assert _compute_current_agent(insights) == "BasicInfoAgent"
    
    # 2. Add partial basic info — still BasicInfoAgent until purpose is > 30 chars
    insights = {
        "basic_info": {"title": "Engineer"},
        "purpose": "To write code." # Too short
    }
    assert _compute_current_agent(insights) == "BasicInfoAgent"
    
    # 3. Complete basic info -> Should move to TaskAgent
    insights["purpose"] = "To write highly scalable code that powers the main product line and drives revenue generation through efficient algorithms."
    assert _compute_current_agent(insights) == "TaskAgent"
    
    # 4. Add partial tasks -> still TaskAgent
    insights["tasks"] = ["Code", "Review", "Test"] # Needs 4
    assert _compute_current_agent(insights) == "TaskAgent"
    
    # 5. Complete tasks -> Should move to PriorityAgent
    insights["tasks"] = ["Task1", "Task2", "Task3", "Task4"]
    assert _compute_current_agent(insights) == "PriorityAgent"

    # 6. Complete priority -> Should move to WorkflowDeepDiveAgent
    insights["priority_tasks"] = ["Task1", "Task2"]
    assert _compute_current_agent(insights) == "WorkflowDeepDiveAgent"
    
    # 7. Add workflows -> Should move to ToolsTechAgent
    insights["workflows"] = {
        "Task1": {"steps": ["Step 1", "Step 2"]},
        "Task2": {"steps": ["Step A"]}
    }
    assert _compute_current_agent(insights) == "ToolsTechAgent"
    
    # 8. Add tools -> Should move to SkillExtractionAgent
    insights["tools"] = ["VSCode", "Docker"]
    assert _compute_current_agent(insights) == "SkillExtractionAgent"
    
    # 9. Add skills -> Should move to QualificationAgent
    insights["skills"] = ["Python", "FastAPI", "React", "PostgreSQL"]
    assert _compute_current_agent(insights) == "QualificationAgent"

    # 10. Add qualifications -> Should move to JDGeneratorAgent
    insights["qualifications"] = {"education": ["B.S. Computer Science"]}
    assert _compute_current_agent(insights) == "JDGeneratorAgent"
    
    print("✅ Strict Sub-Agent JSON transitions strictly follow depth criteria")


def test_depth_scoring():
    """Test that individual depth scores compute correctly."""
    
    insights = {
        "tasks": ["code", "test"],       # 2/4 = 50%
        "tools": ["vim"],                # 1 item -> 20%
        "skills": ["python", "c++"],      # 2 items -> 50%
    }
    
    scores = _get_depth_scores(insights)
    assert scores["tasks"] == 50
    assert scores["tools"] == 20
    assert scores["skills"] == 50
    
    print("✅ Depth scores calculate accurately based on item counts")


def test_progress_computation():
    """Test total summary progress percentage computation."""
    
    insights = {
        "basic_info": {"title": "Engineer"},
        "purpose": "To write highly scalable code that powers the main product line and drives revenue generation.",
        # Basic complete = 15 points
        
        "tasks": ["Task1", "Task2", "Task3", "Task4"],
        # Tasks complete = 100 * 0.25 = 25 points
        
        "priority_tasks": ["Task1", "Task2"],
        # Priority complete = 15 points
        
        "tools": ["Tool1"],
        # Tools are 20% complete (1 item, each is 20) = 20 * 0.15 = 3 points
        
        "skills": ["Skill1", "Skill2"],
        # Skills 50% complete (2 items, each is 25) = 50 * 0.15 = 7.5 points
        # So 15 + 25 + 15 + 3 + 7 = 65%
    }
    
    # Total expected: 15 + 25 + 15 + 3 + 7.5 = 65.5 
    assert _compute_progress_percentage(insights) == 65.5
    
    print("✅ Overall progress scoring maps to Advanced Multi-Agent architecture")


def test_sanitise_skills():
    """Test that soft skills are removed and duplicates are merged case-insensitively."""
    
    raw_skills = [
        "Python",
        "Communication", # Soft skill
        "Team player",   # Soft skill
        "fastapi",
        "PYTHON",        # Duplicate
        "Machine Learning",
        "Problem-solving" # Soft skill
    ]
    
    clean = sanitise_skills(raw_skills)
    
    assert len(clean) == 3
    assert "Python" in clean
    assert "fastapi" in clean
    assert "Machine Learning" in clean
    
    print("✅ Skill sanitization removes soft skills and duplicates")


if __name__ == "__main__":
    print("Running Advanced Sub-Agent Orchestrator Tests...\n")
    test_agent_transitions()
    test_depth_scoring()
    test_progress_computation()
    test_sanitise_skills()
    print("\n🎉 All advanced orchestrator logic tests passed!")
