from __future__ import annotations

import os
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

os.environ.setdefault("DATABASE_NAME", "jd_agent_test")
os.environ.setdefault("DATABASE_USER_NAME", "jd_agent")
os.environ.setdefault("DATABASE_PASS", "jd_agent")
os.environ.setdefault("GEMINI_API_KEY", "test-key")

from app.agents import interview as interview_module
from app.agents.dynamic_prompts import (
    _strip_leading_acknowledgment,
    build_system_messages,
    build_already_collected_summary,
)
from app.agents.extraction_engine import serialize_insights_for_agent


def sample_insights() -> dict:
    return {
        "identity_context": {
            "employee_name": "Maya",
            "title": "Backend Software Engineer",
            "department": "Platform",
            "reports_to": "Engineering Manager",
        },
        "role": "Backend Software Engineer",
        "department": "Platform",
        "purpose": "Build and maintain the backend APIs and platform services that power the product.",
        "tasks": [
            {"description": "Review pull requests from teammates", "frequency": "daily"},
            {"description": "Fix production bugs and incidents", "frequency": "daily"},
            {"description": "Sync with product on roadmap changes", "frequency": "weekly"},
            {"description": "Update service documentation", "frequency": "weekly"},
            {"description": "Capacity planning for infrastructure scaling", "frequency": "monthly"},
            {"description": "Lead database migration planning", "frequency": "quarterly"},
        ],
        "priority_tasks": [
            "Fix production bugs and incidents",
            "Capacity planning for infrastructure scaling",
        ],
        "visited_tasks": ["Fix production bugs and incidents"],
        "active_deep_dive_task": "Capacity planning for infrastructure scaling",
        "workflows": {
            "Fix production bugs and incidents": {
                "trigger": "PagerDuty alert",
                "steps": ["Triage in Datadog", "Find root cause"],
                "output": "Fix deployed",
                "tools": ["PagerDuty", "Datadog"],
            },
            "Capacity planning for infrastructure scaling": {
                "trigger": "Capacity threshold crossed",
                "steps": ["Review 90-day traffic data", "Draft scaling proposal"],
                "tools": ["Grafana", "BigQuery"],
            },
        },
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
        "skills": [
            "Backend API design",
            "Distributed systems",
            "Incident response",
            "Database performance tuning",
            "Infrastructure as code with Terraform",
        ],
        "qualifications": {
            "education": "Computer Science degree preferred",
            "experience_years": "3+",
            "certifications": ["AWS certification preferred"],
        },
        "conversation_summary": "Role: Backend Software Engineer. Last question: What threshold starts capacity planning?",
        "agent_turn_counts": {},
    }


async def passthrough_auto_populate(insights, agent_name, rag_context):
    del agent_name, rag_context
    return insights


class AcknowledgmentStripperTests(unittest.TestCase):
    def test_preserves_opening_turn_greeting(self):
        text = "Hello Maya, welcome back. What is the primary outcome your role owns?"
        self.assertEqual(
            _strip_leading_acknowledgment(text, preserve_first_turn_greeting=True),
            text,
        )

    def test_strips_later_turn_acknowledgment(self):
        self.assertEqual(
            _strip_leading_acknowledgment("Got it. What triggers this task?"),
            "What triggers this task?",
        )

    def test_leaves_question_opening_untouched(self):
        text = "What does a strong final output look like?"
        self.assertEqual(_strip_leading_acknowledgment(text), text)


class SummaryAndSerializationTests(unittest.TestCase):
    def test_basic_info_summary_caps_tasks_at_four(self):
        summary = build_already_collected_summary(sample_insights(), "BasicInfoAgent")
        self.assertIn("1. Review pull requests", summary)
        self.assertIn("4. Update service documentation", summary)
        self.assertNotIn("5. Capacity planning for infrastructure scaling", summary)

    def test_scoped_serializer_keeps_only_active_workflow_and_summary(self):
        serialized = serialize_insights_for_agent(sample_insights(), "DeepDiveAgent")
        self.assertIn("conversation_summary", serialized)
        self.assertIn("Capacity planning for infrastructure scaling", serialized)
        self.assertNotIn("PagerDuty alert", serialized)
        self.assertNotIn("previous_questions_text", serialized)


class SpokenPromptTests(unittest.TestCase):
    def test_first_turn_prompt_requires_warm_spoken_tone(self):
        prompt = build_system_messages(
            phase="BasicInfoAgent",
            insights=sample_insights(),
            is_first_turn=True,
        )
        self.assertIn("warm, calm, clear, and precise when read aloud", prompt)
        self.assertIn("warm, confident HR tone", prompt)
        self.assertIn("text-to-speech", prompt)


class InterviewFlowHardeningTests(unittest.IsolatedAsyncioTestCase):
    async def test_deep_dive_progresses_even_without_extraction_delta(self):
        insights = sample_insights()
        insights["priority_tasks"] = ["Capacity planning for infrastructure scaling"]
        insights["visited_tasks"] = []
        insights["active_deep_dive_task"] = None
        insights["deep_dive_turn_count"] = 0

        recent_messages = [
            {"role": "user", "content": "We should go deeper on capacity planning."},
            {"role": "assistant", "content": "What task should we cover next?"},
        ]

        with patch("app.agents.extraction_engine.extract_information", new=AsyncMock(return_value={})), \
             patch.object(interview_module.engine, "_get_rag_context", new=AsyncMock(return_value=[])), \
             patch.object(interview_module.engine, "_auto_populate_inventory", new=AsyncMock(side_effect=passthrough_auto_populate)), \
             patch("app.agents.interview._invoke_with_retry", new=AsyncMock(return_value=SimpleNamespace(content="Got it. What triggers this task?"))):
            extracted, updated_insights, response_text, _ = await interview_module.engine.run_turn(
                agent_name="DeepDiveAgent",
                insights=insights,
                recent_messages=recent_messages,
                user_message="It usually starts when our traffic forecast changes.",
                questions_asked=[],
                previous_questions_text=[],
            )

        self.assertEqual(extracted, {})
        self.assertEqual(updated_insights["active_deep_dive_task"], "Capacity planning for infrastructure scaling")
        self.assertEqual(updated_insights["deep_dive_turn_count"], 1)
        self.assertEqual(response_text, "What triggers this task?")
        self.assertIn("Last question:", updated_insights["conversation_summary"])

    async def test_run_turn_and_stream_normalize_the_same_way(self):
        identity = sample_insights()["identity_context"]
        insights_sync = {
            "identity_context": identity,
            "role": "Backend Software Engineer",
            "department": "Platform",
            "purpose": "Build and maintain backend APIs for the platform.",
            "tasks": [],
            "cadence_probed": False,
            "agent_turn_counts": {"BasicInfoAgent": 1},
        }
        insights_stream = {
            "identity_context": identity,
            "role": "Backend Software Engineer",
            "department": "Platform",
            "purpose": "Build and maintain backend APIs for the platform.",
            "tasks": [],
            "cadence_probed": False,
            "agent_turn_counts": {"BasicInfoAgent": 1},
        }
        recent_messages = [
            {"role": "user", "content": "I already shared the role purpose."},
            {"role": "assistant", "content": "What does a typical week look like for you?"},
        ]
        user_message = "Daily I review PRs and weekly I handle roadmap syncs."
        extracted_delta = {
            "tasks": [
                {"description": "Review pull requests from teammates", "frequency": "daily"},
                {"description": "Sync with product on roadmap changes", "frequency": "weekly"},
            ],
            "cadence_probed": True,
        }
        llm_text = "Thanks. Beyond those recurring responsibilities, what else fills your week?"

        async def fake_astream(self, messages):
            del self, messages
            yield SimpleNamespace(content=llm_text)

        with patch("app.agents.extraction_engine.extract_information", new=AsyncMock(return_value=extracted_delta)), \
             patch.object(interview_module.engine, "_get_rag_context", new=AsyncMock(return_value=[])), \
             patch.object(interview_module.engine, "_auto_populate_inventory", new=AsyncMock(side_effect=passthrough_auto_populate)), \
             patch("app.agents.interview._invoke_with_retry", new=AsyncMock(return_value=SimpleNamespace(content=llm_text))), \
             patch.object(type(interview_module._interview_llm), "astream", new=fake_astream):
            _, updated_sync, sync_text, _ = await interview_module.engine.run_turn(
                agent_name="BasicInfoAgent",
                insights=insights_sync,
                recent_messages=list(recent_messages),
                user_message=user_message,
                questions_asked=[],
                previous_questions_text=[],
            )

            stream_events = []
            async for event in interview_module.engine.run_turn_stream(
                agent_name="BasicInfoAgent",
                insights=insights_stream,
                recent_messages=list(recent_messages),
                user_message=user_message,
                questions_asked=[],
                previous_questions_text=[],
            ):
                stream_events.append(event)

        done_event = next(event for event in stream_events if event["type"] == "done")
        self.assertEqual(sync_text, "Beyond those recurring responsibilities, what else fills your week?")
        self.assertEqual(done_event["full_text"], sync_text)
        self.assertEqual(updated_sync["last_question_asked"], sync_text)
        self.assertEqual(done_event["insights"]["last_question_asked"], sync_text)
        self.assertIn("Last question:", updated_sync["conversation_summary"])
        self.assertIn("Last question:", done_event["insights"]["conversation_summary"])


if __name__ == "__main__":
    unittest.main()
