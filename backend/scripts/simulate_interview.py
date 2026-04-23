#!/usr/bin/env python3
"""
Engine-aware JD-Agent simulation harness.

Default mode is deterministic:
- uses the real InterviewEngine control flow
- patches extraction, RAG, and LLM responses with scripted outputs
- validates state progression, normalization, and structured phases

Optional live mode:
- uses real Gemini-backed extraction/question generation
- still keeps RAG empty to avoid requiring vector infrastructure

Usage:
    python3 backend/scripts/simulate_interview.py
    python3 backend/scripts/simulate_interview.py --live
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from contextlib import ExitStack
from types import SimpleNamespace
from unittest.mock import patch


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

os.environ.setdefault("DATABASE_NAME", "jd_agent_test")
os.environ.setdefault("DATABASE_USER_NAME", "jd_agent")
os.environ.setdefault("DATABASE_PASS", "jd_agent")
os.environ.setdefault("GEMINI_API_KEY", "test-key")

from app.agents.dynamic_prompts import build_already_collected_summary
from app.agents.extraction_engine import serialize_insights_for_agent
from app.agents.interview import engine
from app.agents.router import compute_current_agent, compute_progress


ACK_STARTERS = (
    "great",
    "sure",
    "perfect",
    "absolutely",
    "noted",
    "thanks",
    "thank you",
    "understood",
    "of course",
    "got it",
)

GRAY = "\033[90m"
CYAN = "\033[96m"
GREEN = "\033[92m"
YELLOW = "\033[93m"
MAGENTA = "\033[95m"
BOLD = "\033[1m"
RESET = "\033[0m"


TURN_SCRIPT = [
    {
        "agent": "BasicInfoAgent",
        "user": "I'm a Backend Software Engineer on the Platform team. I mainly build and maintain the core APIs that power our mobile and web products.",
        "extracted": {
            "role": "Backend Software Engineer",
            "department": "Platform",
            "purpose": "Build and maintain core APIs powering mobile and web products for the Platform team.",
        },
        "llm_response": "Hello Maya, as the Backend Software Engineer in Platform, what is the primary engineering outcome your work is accountable for when those APIs support both mobile and web products?",
    },
    {
        "agent": "BasicInfoAgent",
        "user": "Daily I review PRs and fix production bugs. Weekly I sync with product on roadmap changes.",
        "extracted": {
            "tasks": [
                {"description": "Review pull requests from team members", "frequency": "daily"},
                {"description": "Fix production bugs and incidents", "frequency": "daily"},
                {"description": "Sync with product team on roadmap changes", "frequency": "weekly"},
            ],
            "cadence_probed": True,
        },
        "llm_response": "Got it. Beyond those recurring responsibilities, are there any on-call, architecture, or migration duties that take significant effort but do not happen on a fixed weekly rhythm?",
    },
    {
        "agent": "BasicInfoAgent",
        "user": "Yes, I also update service documentation, do monthly capacity planning, review SLA reports, join the on-call rotation, and lead quarterly database migration planning with the infra team.",
        "extracted": {
            "tasks": [
                {"description": "Update service documentation", "frequency": "weekly"},
                {"description": "Capacity planning for infrastructure scaling", "frequency": "monthly"},
                {"description": "Review SLA reports and performance metrics", "frequency": "monthly"},
                {"description": "Participate in on-call incident response rotation", "frequency": "weekly"},
                {"description": "Lead quarterly database migration planning with infrastructure team", "frequency": "quarterly"},
            ],
        },
        "llm_response": "Which of the responsibilities we've captured would create the biggest downstream risk if execution slipped?",
    },
    {
        "agent": "WorkflowIdentifierAgent",
        "user": "The most critical ones are fixing production bugs, capacity planning, and the database migration work.",
        "extracted": {
            "priority_tasks": [
                "Fix production bugs and incidents",
                "Capacity planning for infrastructure scaling",
                "Lead quarterly database migration planning with infrastructure team",
            ],
        },
        "llm_response": "When 'Fix production bugs and incidents' lands on your plate, what is the first signal that starts the work, and what do you look at before you begin troubleshooting?",
    },
    {
        "agent": "DeepDiveAgent",
        "user": "When a production bug comes in, it is usually triggered by a PagerDuty alert or a Slack escalation from customer support. I triage it in Datadog, find the root cause, hotfix in staging, get a PR review, and deploy through the CI pipeline.",
        "extracted": {
            "workflows": {
                "Fix production bugs and incidents": {
                    "trigger": "PagerDuty alert or Slack escalation from customer support",
                    "steps": [
                        "Triage in Datadog",
                        "Find root cause",
                        "Hotfix in staging",
                        "Get pull request review",
                        "Deploy through CI pipeline",
                    ],
                    "tools": ["PagerDuty", "Slack", "Datadog", "GitHub Actions"],
                }
            }
        },
        "llm_response": "For 'Fix production bugs and incidents' (triggered by 'PagerDuty alert or Slack escalation from customer support' and involving 'Triage in Datadog' — when the incident crosses team boundaries, what is your decision process and what does a clean resolution look like?",
    },
    {
        "agent": "DeepDiveAgent",
        "user": "The hardest blocker is when the bug is in a service owned by another team. I escalate through Slack, open an incident ticket, and we jointly debug. A clean resolution means the fix is deployed, the SLA is met, and a post-mortem is written within 24 hours.",
        "extracted": {
            "workflows": {
                "Fix production bugs and incidents": {
                    "output": "Fix deployed, SLA met, post-mortem written within 24 hours",
                    "problem_solving": "Coordinate with the owning team through incident escalation and joint debugging.",
                }
            }
        },
        "llm_response": "When 'Capacity planning for infrastructure scaling' needs to happen, what is the specific trigger or threshold that starts the work, and what inputs do you need before you can begin?",
    },
    {
        "agent": "DeepDiveAgent",
        "user": "Capacity planning starts when we hit 70 percent memory or CPU thresholds in Grafana. I pull 90-day traffic trends from BigQuery, model the growth curve, and propose a scaling plan to infra.",
        "extracted": {
            "workflows": {
                "Capacity planning for infrastructure scaling": {
                    "trigger": "70 percent memory or CPU threshold crossed in Grafana",
                    "steps": [
                        "Pull 90-day traffic trends from BigQuery",
                        "Model growth curve",
                        "Draft scaling proposal for infrastructure team",
                    ],
                    "tools": ["Grafana", "BigQuery"],
                }
            }
        },
        "llm_response": "Sure. For 'Capacity planning for infrastructure scaling' (triggered by '70 percent memory or CPU threshold crossed in Grafana' and involving 'Pull 90-day traffic trends from BigQuery' — what is the most common data quality or forecasting issue you encounter, and what does a strong final output look like?",
    },
    {
        "agent": "DeepDiveAgent",
        "user": "The main issue is stale traffic data after architecture changes. A strong output is a scaling proposal with projections, cost estimates, and an approved infra ticket.",
        "extracted": {
            "workflows": {
                "Capacity planning for infrastructure scaling": {
                    "output": "Scaling proposal with traffic projections, cost estimates, and approved infrastructure ticket",
                    "problem_solving": "Adjust traffic baselines when recent architecture changes distort trend data.",
                }
            }
        },
        "llm_response": "When 'Lead quarterly database migration planning with infrastructure team' needs to happen, what is the trigger or event that starts it, and what information do you need before you can begin?",
    },
    {
        "agent": "DeepDiveAgent",
        "user": "We start migration planning when platform roadmap changes require schema updates or database version upgrades. I review system dependencies, sequence the migration plan with infra, and define rollback checkpoints.",
        "extracted": {
            "workflows": {
                "Lead quarterly database migration planning with infrastructure team": {
                    "trigger": "Platform roadmap changes requiring schema updates or database version upgrades",
                    "steps": [
                        "Review system dependencies",
                        "Sequence migration plan with infrastructure team",
                        "Define rollback checkpoints",
                    ],
                    "tools": ["PostgreSQL", "Jira"],
                }
            }
        },
        "llm_response": "For 'Lead quarterly database migration planning with infrastructure team' (triggered by 'Platform roadmap changes requiring schema updates or database version upgrades' and involving 'Review system dependencies' — where does the process most often become risky, and what does a high-quality migration plan include before execution begins?",
    },
    {
        "agent": "DeepDiveAgent",
        "user": "The riskiest point is hidden downstream dependencies. A high-quality plan includes the dependency map, cutover sequence, rollback plan, and stakeholder approvals.",
        "extracted": {
            "workflows": {
                "Lead quarterly database migration planning with infrastructure team": {
                    "output": "Approved migration plan with dependency map, cutover sequence, rollback plan, and stakeholder sign-off",
                    "problem_solving": "Surface hidden downstream dependencies before the migration window is scheduled.",
                }
            }
        },
        "llm_response": "",
    },
    {
        "agent": "ToolsAgent",
        "user": "The main day-to-day tools are PostgreSQL, Redis, Kafka, Docker, Kubernetes, Datadog, Grafana, GitHub Actions, Jira, Python, and Go.",
        "extracted": {
            "tools": [
                "PostgreSQL",
                "Redis",
                "Kafka",
                "Docker",
                "Kubernetes",
                "Datadog",
                "Grafana",
                "GitHub Actions",
                "Jira",
            ],
            "technologies": ["Python", "Go"],
            "tools_confirmed": True,
        },
        "llm_response": "",
    },
    {
        "agent": "SkillsAgent",
        "user": "The key skills are backend API design, distributed systems, incident response, database performance tuning, and infrastructure as code with Terraform.",
        "extracted": {
            "skills": [
                "Backend API design",
                "Distributed systems",
                "Incident response",
                "Database performance tuning",
                "Infrastructure as code with Terraform",
            ],
            "skills_confirmed": True,
        },
        "llm_response": "For a 'Backend Software Engineer' role, is a Computer Science or Engineering degree a hard requirement, or is equivalent hands-on experience accepted, and what is the baseline years of relevant experience?",
    },
    {
        "agent": "QualificationAgent",
        "user": "A Computer Science degree is preferred but equivalent experience is fine. We expect at least 3 years of backend engineering experience, and AWS certification is a nice-to-have rather than mandatory.",
        "extracted": {
            "qualifications": {
                "education": "Computer Science or Engineering degree preferred; equivalent hands-on experience accepted",
                "experience_years": "3+",
                "certifications": ["AWS certification preferred but not mandatory"],
            }
        },
        "llm_response": "Are there any specialized certifications or training paths that would give a candidate an edge in this Backend Software Engineer role even if they are not mandatory on day one?",
    },
    {
        "agent": "QualificationAgent",
        "user": "No, that covers it from a certification standpoint.",
        "extracted": {},
        "llm_response": "",
    },
    {
        "agent": "JDGeneratorAgent",
        "user": "That's everything.",
        "extracted": {},
        "llm_response": "",
    },
]


SCRIPT_BY_USER = {turn["user"]: turn for turn in TURN_SCRIPT}


def divider(title: str = "", char: str = "─", width: int = 78) -> None:
    if title:
        padding = max(0, (width - len(title) - 2) // 2)
        print(f"{GRAY}{char * padding} {BOLD}{title}{RESET}{GRAY} {char * padding}{RESET}")
    else:
        print(f"{GRAY}{char * width}{RESET}")


def estimate_tokens(text: str) -> int:
    return max(1, len(text) // 4)


def starts_with_acknowledgment(text: str) -> bool:
    lowered = text.strip().lower()
    return any(lowered.startswith(prefix) for prefix in ACK_STARTERS)


def build_identity_context() -> dict:
    return {
        "employee_name": "Maya",
        "title": "Backend Software Engineer",
        "department": "Platform",
        "reports_to": "Engineering Manager",
    }


def extract_user_from_messages(messages) -> str:
    for message in reversed(messages):
        content = str(getattr(message, "content", ""))
        if content.startswith("SYSTEM:"):
            continue
        if content.startswith("[User confirmed."):
            continue
        return content
    return ""


async def fake_extract_information(user_message, current_state, current_agent="", recent_messages=None):
    del current_state, current_agent, recent_messages
    return dict(SCRIPT_BY_USER[user_message]["extracted"])


async def fake_invoke_with_retry(llm, messages, max_retries=2):
    del llm, max_retries
    user_message = extract_user_from_messages(messages)
    scripted = SCRIPT_BY_USER[user_message]["llm_response"]
    return SimpleNamespace(content=scripted)


async def fake_get_rag_context(insights, agent_name):
    del insights, agent_name
    return []


async def fake_auto_populate_inventory(insights, agent_name, rag_context):
    del agent_name, rag_context
    return insights


async def fake_deduplicate_and_professionalize(items, item_type):
    del item_type
    return items


async def run_deterministic_simulation() -> None:
    divider("JD-AGENT DETERMINISTIC SIMULATION", "═")
    print(f"{BOLD}Using the real InterviewEngine with mocked extraction, LLM, and RAG calls.{RESET}\n")

    insights = {"identity_context": build_identity_context()}
    recent_messages: list[dict] = []
    questions_asked: list[str] = []
    previous_questions_text: list[str] = []
    current_agent = "BasicInfoAgent"

    with ExitStack() as stack:
        stack.enter_context(patch("app.agents.extraction_engine.extract_information", side_effect=fake_extract_information))
        stack.enter_context(patch("app.agents.interview._invoke_with_retry", side_effect=fake_invoke_with_retry))
        stack.enter_context(patch.object(engine, "_get_rag_context", side_effect=fake_get_rag_context))
        stack.enter_context(patch.object(engine, "_auto_populate_inventory", side_effect=fake_auto_populate_inventory))
        stack.enter_context(
            patch(
                "app.agents.semantic_cleaner.deduplicate_and_professionalize",
                side_effect=fake_deduplicate_and_professionalize,
            )
        )

        for index, turn in enumerate(TURN_SCRIPT, start=1):
            expected_agent = turn["agent"]
            if current_agent != expected_agent:
                raise AssertionError(
                    f"Turn {index}: expected agent {expected_agent}, got {current_agent}"
                )

            divider(f"TURN {index} · {current_agent}")
            print(f"{CYAN}User{RESET}: {turn['user']}")

            extracted, insights, response_text, questions_asked = await engine.run_turn(
                agent_name=current_agent,
                insights=insights,
                recent_messages=recent_messages,
                user_message=turn["user"],
                questions_asked=questions_asked,
                previous_questions_text=previous_questions_text,
            )

            recent_messages.append({"role": "user", "content": turn["user"]})
            recent_messages.append({"role": "assistant", "content": response_text})

            if index > 1 and current_agent not in {"WorkflowIdentifierAgent", "ToolsAgent", "SkillsAgent", "JDGeneratorAgent"}:
                if starts_with_acknowledgment(response_text):
                    raise AssertionError(
                        f"Turn {index}: acknowledgment leakage survived normalization: {response_text}"
                    )

            scoped = serialize_insights_for_agent(insights, current_agent)
            prompt_summary = build_already_collected_summary(insights, current_agent)
            progress = compute_progress(insights, current_agent)
            next_agent = compute_current_agent(insights, current_agent)

            print(f"{YELLOW}Extracted{RESET}: {json.dumps(extracted, indent=2, default=str)}")
            print(f"{MAGENTA}Agent{RESET}: {response_text}")
            print(
                f"{GRAY}Tokens{RESET}: extraction_state~{estimate_tokens(scoped)} "
                f"prompt_summary~{estimate_tokens(prompt_summary)}"
            )
            print(
                f"{GRAY}Memory{RESET}: tasks={len(insights.get('tasks', []))} "
                f"priority={len(insights.get('priority_tasks', []))} "
                f"visited={len(insights.get('visited_tasks', []))} "
                f"tools={len(insights.get('tools', []))} "
                f"skills={len(insights.get('skills', []))}"
            )
            print(
                f"{GRAY}Progress{RESET}: {progress['completion_percentage']:.0f}% · "
                f"next_agent={next_agent}"
            )

            current_agent = next_agent

    required_fields = [
        "purpose",
        "tasks",
        "priority_tasks",
        "workflows",
        "tools",
        "skills",
        "qualifications",
    ]
    missing = [field for field in required_fields if not insights.get(field)]
    if missing:
        raise AssertionError(f"Simulation ended with missing required fields: {missing}")

    divider("FINAL INSIGHTS", "═")
    print(json.dumps(insights, indent=2, default=str))
    print(f"\n{GREEN}{BOLD}Deterministic simulation completed successfully across all 7 phases.{RESET}")


async def run_live_smoke() -> None:
    if not os.getenv("GEMINI_API_KEY"):
        raise RuntimeError("GEMINI_API_KEY is required for --live mode.")

    divider("JD-AGENT LIVE SMOKE", "═")
    print(f"{BOLD}Running the real engine against Gemini with RAG disabled for portability.{RESET}\n")

    insights = {"identity_context": build_identity_context()}
    recent_messages: list[dict] = []
    questions_asked: list[str] = []
    previous_questions_text: list[str] = []
    current_agent = "BasicInfoAgent"

    with patch.object(engine, "_get_rag_context", side_effect=fake_get_rag_context):
        for index, turn in enumerate(TURN_SCRIPT, start=1):
            divider(f"LIVE TURN {index} · {current_agent}")
            print(f"{CYAN}User{RESET}: {turn['user']}")

            extracted, insights, response_text, questions_asked = await engine.run_turn(
                agent_name=current_agent,
                insights=insights,
                recent_messages=recent_messages,
                user_message=turn["user"],
                questions_asked=questions_asked,
                previous_questions_text=previous_questions_text,
            )

            recent_messages.append({"role": "user", "content": turn["user"]})
            recent_messages.append({"role": "assistant", "content": response_text})

            print(f"{YELLOW}Extracted keys{RESET}: {sorted(extracted.keys())}")
            print(f"{MAGENTA}Agent{RESET}: {response_text}")

            if not response_text.strip():
                raise AssertionError(f"Turn {index}: empty response in live mode")

            current_agent = compute_current_agent(insights, current_agent)

    print(f"\n{GREEN}{BOLD}Live smoke run completed without crashes or empty turns.{RESET}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Simulate the JD-Agent interview flow.")
    parser.add_argument(
        "--live",
        action="store_true",
        help="Run a live Gemini-backed smoke test instead of the deterministic harness.",
    )
    return parser.parse_args()


async def main() -> None:
    args = parse_args()
    if args.live or os.getenv("JD_AGENT_SIM_MODE", "").lower() == "live":
        await run_live_smoke()
    else:
        await run_deterministic_simulation()


if __name__ == "__main__":
    asyncio.run(main())
