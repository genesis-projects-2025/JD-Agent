# scripts/test_advanced_engine.py
"""
Comprehensive JD Interview Engine Simulation.

Tests the complete interview flow:
1. BasicInfoAgent → Collect role, dept, purpose, and ≥6 tasks
2. TaskRefinementAgent → Ensure task quality
3. PriorityAgent → User selects 3-4 priority tasks
4. DeepDiveAgent → 3-turn deep-dive per priority task
5. InfrastructureAgent → Confirm tools & skills
6. QualificationAgent → Education & experience requirements
7. JDGeneratorAgent → Generate final JD

Usage:
    python3 scripts/test_advanced_engine.py
"""

import asyncio
import json
import sys
import os
from typing import List, Tuple
from dotenv import load_dotenv

# Load env from backend/.env
backend_path = os.path.join(os.getcwd(), "backend")
load_dotenv(os.path.join(backend_path, ".env"))

sys.path.append(backend_path)

from app.agents.interview import engine
from app.agents.router import compute_current_agent, compute_progress
from app.agents.state import create_initial_state
from app.agents.gap_detector import gap_detector_node
from app.agents.validators import validate_insights_completeness


class InterviewSimulator:
    """Simulates a complete JD interview with predefined user responses."""

    def __init__(self):
        self.insights = {}
        self.history: List[dict] = []
        self.current_agent = "BasicInfoAgent"
        self.questions_asked: List[str] = []
        self.turn_count = 0
        self.agent_turn_count = 0

    async def run_turn(self, user_message: str) -> Tuple[str, str]:
        """Run a single interview turn and return (agent_name, response)."""
        self.turn_count += 1

        # Run the interview engine
        self.insights, response, self.questions_asked = await engine.run_turn(
            agent_name=self.current_agent,
            insights=self.insights,
            recent_messages=self.history,
            user_message=user_message,
            questions_asked=self.questions_asked,
        )

        # Update history
        self.history.append({"role": "user", "content": user_message})
        self.history.append({"role": "assistant", "content": response})

        # Check for agent transition
        old_agent = self.current_agent
        self.current_agent = compute_current_agent(
            self.insights, self.current_agent, self.agent_turn_count
        )
        if self.current_agent != old_agent:
            self.agent_turn_count = 0
            print(f"\n🔄 AGENT TRANSITION: {old_agent} → {self.current_agent}")
        else:
            self.agent_turn_count += 1

        return self.current_agent, response

    def print_state(self):
        """Print current state summary."""
        print(f"\n📊 STATE SUMMARY (Turn {self.turn_count})")
        print(f"   Agent: {self.current_agent}")
        print(f"   Role: {self.insights.get('role', 'N/A')}")
        print(f"   Department: {self.insights.get('department', 'N/A')}")
        print(
            f"   Purpose: {self.insights.get('purpose', 'N/A')[:50] + '...' if self.insights.get('purpose') else 'N/A'}"
        )
        print(f"   Tasks: {len(self.insights.get('all_tasks', []))}")
        print(f"   Priority Tasks: {len(self.insights.get('priority_tasks', []))}")
        print(f"   Tools: {len(self.insights.get('tools', []))}")
        print(f"   Skills: {len(self.insights.get('skills', []))}")
        print(
            f"   Education: {'✓' if len(self.insights.get('education', '')) > 10 else '✗'}"
        )


async def simulate_complete_interview():
    """Simulate a complete JD interview flow."""
    print("=" * 80)
    print("🚀 JD INTERVIEW ENGINE - COMPLETE FLOW SIMULATION")
    print("=" * 80)

    simulator = InterviewSimulator()

    # ─── PHASE 1: BASIC INFO ──────────────────────────────────────────────────
    print("\n" + "=" * 60)
    print("PHASE 1: BASIC INFORMATION COLLECTION")
    print("=" * 60)

    # Turn 1: Initial role info
    user_msg = "I'm a Senior Software Engineer at TechCorp, working on building and maintaining our microservices architecture."
    print(f"\n[USER]: {user_msg}")
    agent, response = await simulator.run_turn(user_msg)
    print(f"[{agent}]: {response}")
    simulator.print_state()

    # Turn 2: Daily tasks
    user_msg = "My daily tasks include writing Python code for our API services, reviewing pull requests from the team, debugging production issues in Kubernetes, participating in standup meetings, and updating technical documentation."
    print(f"\n[USER]: {user_msg}")
    agent, response = await simulator.run_turn(user_msg)
    print(f"[{agent}]: {response}")
    simulator.print_state()

    # Turn 3: More tasks
    user_msg = "I also handle deploying services to AWS using CI/CD pipelines, mentoring junior developers on best practices, conducting code reviews, and collaborating with product managers on feature requirements. Weekly, I participate in architecture discussions and monthly I do capacity planning."
    print(f"\n[USER]: {user_msg}")
    agent, response = await simulator.run_turn(user_msg)
    print(f"[{agent}]: {response}")
    simulator.print_state()

    # ─── PHASE 2: TASK REFINEMENT ─────────────────────────────────────────────
    print("\n" + "=" * 60)
    print("PHASE 2: TASK REFINEMENT")
    print("=" * 60)

    # Turn 4: Confirm tasks
    user_msg = (
        "Yes, that covers most of my responsibilities. I think we have a good list now."
    )
    print(f"\n[USER]: {user_msg}")
    agent, response = await simulator.run_turn(user_msg)
    print(f"[{agent}]: {response}")
    simulator.print_state()

    # ─── PHASE 3: PRIORITY SELECTION ──────────────────────────────────────────
    print("\n" + "=" * 60)
    print("PHASE 3: PRIORITY SELECTION")
    print("=" * 60)

    # Turn 5: Select priorities
    user_msg = "The most critical tasks are: building Python APIs, debugging Kubernetes issues, and deploying services to AWS. These are the core of my role."
    print(f"\n[USER]: {user_msg}")
    agent, response = await simulator.run_turn(user_msg)
    print(f"[{agent}]: {response}")
    simulator.print_state()

    # ─── PHASE 4: DEEP DIVE ───────────────────────────────────────────────────
    print("\n" + "=" * 60)
    print("PHASE 4: DEEP DIVE INTO PRIORITY TASKS")
    print("=" * 60)

    # Turn 6: Deep dive - Trigger for building APIs
    user_msg = "For building Python APIs, the trigger is usually a new feature request from product or a need to integrate with another service. I start by designing the API contract."
    print(f"\n[USER]: {user_msg}")
    agent, response = await simulator.run_turn(user_msg)
    print(f"[{agent}]: {response}")
    simulator.print_state()

    # Turn 7: Deep dive - Steps for building APIs
    user_msg = "I use FastAPI to create the endpoints, write unit tests with pytest, use SQLAlchemy for database operations, and deploy using Docker containers. The steps are: design the schema, implement the endpoints, write tests, and create the Docker image."
    print(f"\n[USER]: {user_msg}")
    agent, response = await simulator.run_turn(user_msg)
    print(f"[{agent}]: {response}")
    simulator.print_state()

    # Turn 8: Deep dive - Outcome for building APIs
    user_msg = "The outcome is a well-documented, tested API that other services can consume reliably. It reduces integration time and improves system stability."
    print(f"\n[USER]: {user_msg}")
    agent, response = await simulator.run_turn(user_msg)
    print(f"[{agent}]: {response}")
    simulator.print_state()

    # Turn 9: Deep dive - Kubernetes debugging (trigger)
    user_msg = "For Kubernetes issues, I get alerts from Prometheus when pods crash or services become unresponsive. I use kubectl to check logs and describe the pods."
    print(f"\n[USER]: {user_msg}")
    agent, response = await simulator.run_turn(user_msg)
    print(f"[{agent}]: {response}")
    simulator.print_state()

    # Turn 10: Deep dive - Kubernetes debugging (steps)
    user_msg = "I check the pod logs, look at resource usage, verify ConfigMaps and Secrets are correct, and sometimes need to restart pods or scale deployments. I use Grafana dashboards to monitor metrics."
    print(f"\n[USER]: {user_msg}")
    agent, response = await simulator.run_turn(user_msg)
    print(f"[{agent}]: {response}")
    simulator.print_state()

    # Turn 11: Deep dive - Kubernetes debugging (outcome)
    user_msg = "The outcome is restored service availability and minimized downtime. I also document the root cause to prevent future occurrences."
    print(f"\n[USER]: {user_msg}")
    agent, response = await simulator.run_turn(user_msg)
    print(f"[{agent}]: {response}")
    simulator.print_state()

    # Turn 12: Deep dive - AWS deployment (trigger)
    user_msg = "AWS deployments are triggered by completed features that need to go to production, or hotfixes for critical bugs. Our CI/CD pipeline in Jenkins handles the deployment."
    print(f"\n[USER]: {user_msg}")
    agent, response = await simulator.run_turn(user_msg)
    print(f"[{agent}]: {response}")
    simulator.print_state()

    # Turn 13: Deep dive - AWS deployment (steps)
    user_msg = "I push code to Git, Jenkins runs the build pipeline, builds Docker images, pushes to ECR, and deploys to EKS. I monitor the deployment using CloudWatch and verify health checks pass."
    print(f"\n[USER]: {user_msg}")
    agent, response = await simulator.run_turn(user_msg)
    print(f"[{agent}]: {response}")
    simulator.print_state()

    # Turn 14: Deep dive - AWS deployment (outcome)
    user_msg = "The outcome is new features available to users with zero downtime. The deployment is automated and reliable."
    print(f"\n[USER]: {user_msg}")
    agent, response = await simulator.run_turn(user_msg)
    print(f"[{agent}]: {response}")
    simulator.print_state()

    # ─── PHASE 5: INFRASTRUCTURE (TOOLS & SKILLS) ─────────────────────────────
    print("\n" + "=" * 60)
    print("PHASE 5: TOOLS & SKILLS CONFIRMATION")
    print("=" * 60)

    # Turn 15: Confirm tools
    user_msg = "Yes, those are the main tools I use. I also work with Git for version control, Redis for caching, and PostgreSQL for databases. My skills include Python, Kubernetes, AWS, microservices architecture, and REST API design."
    print(f"\n[USER]: {user_msg}")
    agent, response = await simulator.run_turn(user_msg)
    print(f"[{agent}]: {response}")
    simulator.print_state()

    # ─── PHASE 6: QUALIFICATIONS ──────────────────────────────────────────────
    print("\n" + "=" * 60)
    print("PHASE 6: QUALIFICATIONS")
    print("=" * 60)

    # Turn 16: Education
    user_msg = "For this role, we require a Bachelor's degree in Computer Science or related field, with 5+ years of software development experience. AWS certifications are a plus, and experience with cloud-native architectures is essential."
    print(f"\n[USER]: {user_msg}")
    agent, response = await simulator.run_turn(user_msg)
    print(f"[{agent}]: {response}")
    simulator.print_state()

    # ─── PHASE 7: JD GENERATION ───────────────────────────────────────────────
    print("\n" + "=" * 60)
    print("PHASE 7: JD GENERATION")
    print("=" * 60)

    # Turn 17: Generate JD
    user_msg = "I think we have everything. Can you generate the JD now?"
    print(f"\n[USER]: {user_msg}")
    agent, response = await simulator.run_turn(user_msg)
    print(f"[{agent}]: {response}")
    simulator.print_state()

    # ─── FINAL GAP ANALYSIS ───────────────────────────────────────────────────
    print("\n" + "=" * 60)
    print("FINAL GAP ANALYSIS")
    print("=" * 60)

    gap_result = await gap_detector_node(
        {"insights": simulator.insights, "current_agent": simulator.current_agent}
    )
    print(f"\n[GAPS]: {json.dumps(gap_result['gaps'], indent=2)}")
    print(f"[QUALITY SCORE]: {gap_result['quality_score']}/100")
    print(f"[READY FOR JD]: {gap_result['ready_for_jd']}")

    # ─── FINAL STATE ──────────────────────────────────────────────────────────
    print("\n" + "=" * 60)
    print("FINAL STATE")
    print("=" * 60)
    print(f"\n[FINAL INSIGHTS]:")
    print(json.dumps(simulator.insights, indent=2))

    print(f"\n[ROUTER CHECK]:")
    next_agent = compute_current_agent(
        simulator.insights, simulator.current_agent, simulator.agent_turn_count
    )
    print(f"Current Agent: {simulator.current_agent}")
    print(f"Next Agent: {next_agent}")

    progress = compute_progress(simulator.insights, next_agent)
    print(f"Progress: {progress['completion_percentage']}%")

    print("\n" + "=" * 80)
    print("✅ SIMULATION COMPLETE!")
    print("=" * 80)


if __name__ == "__main__":
    asyncio.run(simulate_complete_interview())
