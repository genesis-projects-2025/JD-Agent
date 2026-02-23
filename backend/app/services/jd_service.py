# app/services/jd_service.py
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
import json
import re
from langchain_groq import ChatGroq
from langchain_core.messages import HumanMessage, SystemMessage
from app.core.config import settings
from app.prompts.jd_prompts import SYSTEM_PROMPT, JD_GENERATION_PROMPT
from app.schemas.jd_schema import ChatResponse, Progress, Approval, Analytics, EmployeeRoleInsights
from app.utils.text_utils import strip_reasoning_tags
import groq
from app.services.context_builder import build_context
from app.memory.session_memory import SessionMemory

# ── LLM Instances ──────────────────────────────────────────────────────────────
interview_llm = ChatGroq(
    groq_api_key=settings.GROQ_API_KEY,
    model_name="qwen/qwen3-32b",
    temperature=0.2,
)

jd_llm = ChatGroq(
    groq_api_key=settings.GROQ_API_KEY,
    model_name="qwen/qwen3-32b",
    temperature=0.1,
)

# ── Utilities ──────────────────────────────────────────────────────────────────

def remove_think_tags(text: str) -> str:
    cleaned = re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL)
    cleaned = re.sub(r"<think>.*", "", cleaned, flags=re.DOTALL)
    return cleaned.strip()


def clean_json_string(raw: str) -> str:
    cleaned = remove_think_tags(raw)
    if cleaned.startswith("```json"):
        cleaned = cleaned[7:]
    elif cleaned.startswith("```"):
        cleaned = cleaned[3:]
    if cleaned.endswith("```"):
        cleaned = cleaned[:-3]
    return cleaned.strip()


def extract_json_block(text: str) -> str:
    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end != -1 and end > start:
        return text[start:end + 1]
    return ""


def safe_to_dict(obj) -> dict:
    if obj is None:
        return {}
    if isinstance(obj, dict):
        return obj
    if hasattr(obj, "model_dump"):
        return obj.model_dump()
    return {}


def deep_merge(base: dict, incoming: dict) -> dict:
    result = dict(base)
    for key, new_val in incoming.items():
        existing_val = result.get(key)
        if existing_val is None or existing_val == {} or existing_val == [] or existing_val == "":
            result[key] = new_val
        elif isinstance(new_val, dict) and isinstance(existing_val, dict):
            result[key] = deep_merge(existing_val, new_val)
        elif isinstance(new_val, list) and isinstance(existing_val, list):
            merged = list(existing_val)
            for item in new_val:
                if item not in merged:
                    merged.append(item)
            result[key] = merged
        elif new_val not in (None, {}, [], ""):
            result[key] = new_val
    return result


def update_summary(memory: SessionMemory):
    if len(memory.recent_messages) >= 4:
        memory.summary = "Conversation collected employee role responsibilities, tools, and workflow insights."


def build_fallback_response(session_memory: SessionMemory) -> str:
    progress_dict = safe_to_dict(session_memory.progress)
    insights_dict = safe_to_dict(session_memory.insights)
    try:
        fallback = ChatResponse(
            conversation_response="I encountered an issue. Could you please repeat your last message?",
            progress=Progress(**progress_dict) if progress_dict else Progress(),
            employee_role_insights=EmployeeRoleInsights(**insights_dict) if insights_dict else EmployeeRoleInsights(),
            jd_structured_data=None,
            jd_text_format="",
            approval=Approval(),
            analytics=Analytics(),
        )
        return fallback.model_dump_json()
    except Exception:
        return json.dumps({
            "conversation_response": "I encountered an issue. Could you please repeat your last message?",
            "progress": progress_dict or {"completion_percentage": 0, "missing_insight_areas": [], "status": "collecting"},
            "employee_role_insights": insights_dict or {},
            "jd_structured_data": {},
            "jd_text_format": "",
            "analytics": {"questions_asked": 0, "questions_answered": 0, "insights_collected": 0, "estimated_completion_time_minutes": 0},
            "approval": {"approval_required": False, "approval_status": "pending"}
        })


def wrap_plain_text_into_json(plain_text: str, session_memory: SessionMemory) -> tuple[dict, str]:
    insights_dict = safe_to_dict(session_memory.insights)
    progress_dict = safe_to_dict(session_memory.progress)

    # ── CRITICAL FIX: If plain_text is actually a JSON blob (parsing failed upstream),
    # try one more time to extract conversation_response from it before wrapping as text.
    # This prevents the raw JSON from leaking into the conversation_response field.
    stripped = plain_text.strip()
    
    # FIX: Check if LLM output JSON properties but omitted the outer braces {}
    if not stripped.startswith("{") and '"conversation_response"' in stripped:
        stripped = stripped.rstrip(", \r\n\t")
        stripped = "{\n" + stripped + "\n}"

    if stripped.startswith("{") or "conversation_response" in stripped:
        try:
            candidate = json.loads(stripped)
            if "conversation_response" in candidate:
                print("   ✅ wrap_plain_text_into_json: rescued conversation_response from raw JSON blob")
                conversation_text = candidate["conversation_response"]
                # Merge insights if present
                if "employee_role_insights" in candidate and isinstance(candidate["employee_role_insights"], dict):
                    insights_dict = deep_merge(insights_dict, candidate["employee_role_insights"])
                if "progress" in candidate and isinstance(candidate["progress"], dict):
                    progress_dict = deep_merge(progress_dict, candidate["progress"])
                # Rebuild properly
                wrapped = {
                    "conversation_response": conversation_text,
                    "progress": progress_dict or {"completion_percentage": 0, "missing_insight_areas": [], "status": "collecting"},
                    "employee_role_insights": insights_dict,
                    "jd_structured_data": candidate.get("jd_structured_data", {}),
                    "jd_text_format": candidate.get("jd_text_format", ""),
                    "analytics": candidate.get("analytics", {"questions_asked": 0, "questions_answered": 0, "insights_collected": 0, "estimated_completion_time_minutes": 10}),
                    "approval": candidate.get("approval", {"approval_required": False, "approval_status": "pending"})
                }
                wrapped_str = json.dumps(wrapped, indent=2)
                return wrapped, wrapped_str
        except (json.JSONDecodeError, TypeError):
            # Try extracting the JSON block from within the text
            block = extract_json_block(stripped)
            if block:
                try:
                    candidate = json.loads(block)
                    if "conversation_response" in candidate:
                        print("   ✅ wrap_plain_text_into_json: rescued conversation_response from embedded JSON block")
                        conversation_text = candidate["conversation_response"]
                        wrapped = {
                            "conversation_response": conversation_text,
                            "progress": candidate.get("progress", progress_dict or {"completion_percentage": 0, "missing_insight_areas": [], "status": "collecting"}),
                            "employee_role_insights": candidate.get("employee_role_insights", insights_dict),
                            "jd_structured_data": candidate.get("jd_structured_data", {}),
                            "jd_text_format": candidate.get("jd_text_format", ""),
                            "analytics": candidate.get("analytics", {"questions_asked": 0, "questions_answered": 0, "insights_collected": 0, "estimated_completion_time_minutes": 10}),
                            "approval": candidate.get("approval", {"approval_required": False, "approval_status": "pending"})
                        }
                        wrapped_str = json.dumps(wrapped, indent=2)
                        return wrapped, wrapped_str
                except (json.JSONDecodeError, TypeError):
                    pass

    sanitized_text = plain_text.strip("{} \n\t\r")
    wrapped = {
        "conversation_response": sanitized_text.strip(),
        "progress": progress_dict if progress_dict else {
            "completion_percentage": 0,
            "missing_insight_areas": [],
            "status": "collecting"
        },
        "employee_role_insights": insights_dict if insights_dict else {
            "identity_context": {}, "daily_activities": [], "execution_processes": [],
            "tools_and_platforms": [], "team_collaboration": {}, "stakeholder_interactions": {},
            "decision_authority": {}, "performance_metrics": [], "work_environment": {},
            "special_contributions": []
        },
        "jd_structured_data": {},
        "jd_text_format": "",
        "analytics": {
            "questions_asked": 0, "questions_answered": 0,
            "insights_collected": len([v for v in insights_dict.values() if v]),
            "estimated_completion_time_minutes": 10
        },
        "approval": {"approval_required": False, "approval_status": "pending"}
    }
    wrapped_str = json.dumps(wrapped, indent=2)
    return wrapped, wrapped_str


def parse_llm_response(raw_content: str, session_memory: SessionMemory = None) -> tuple[dict, str]:
    # Strategy 1: clean markdown fences + think tags, parse directly
    cleaned = clean_json_string(raw_content)
    if cleaned:
        try:
            parsed = json.loads(cleaned)
            if "conversation_response" in parsed:
                return parsed, cleaned
        except json.JSONDecodeError:
            pass

    # Strategy 2: extract JSON block from cleaned string
    extracted = extract_json_block(cleaned)
    if extracted:
        try:
            parsed = json.loads(extracted)
            if "conversation_response" in parsed:
                return parsed, extracted
        except json.JSONDecodeError:
            pass

    # Strategy 3: remove think tags first, then extract JSON block
    no_think = remove_think_tags(raw_content)
    extracted2 = extract_json_block(no_think)
    if extracted2:
        try:
            parsed = json.loads(extracted2)
            if "conversation_response" in parsed:
                return parsed, extracted2
        except json.JSONDecodeError:
            pass

    # Strategy 4: aggressively scan for any valid JSON object in the text
    no_think_clean = clean_json_string(no_think)
    for attempt in [no_think_clean, no_think, raw_content]:
        start = 0
        while True:
            idx = attempt.find("{", start)
            if idx == -1:
                break
            # Try parsing from each { to find a complete valid JSON
            for end_idx in range(len(attempt), idx, -1):
                try:
                    candidate = json.loads(attempt[idx:end_idx])
                    if isinstance(candidate, dict) and "conversation_response" in candidate:
                        candidate_str = json.dumps(candidate)
                        return candidate, candidate_str
                except json.JSONDecodeError:
                    continue
            start = idx + 1

    # Strategy 5: fallback — wrap whatever text we have
    plain_text = remove_think_tags(raw_content).strip()
    if plain_text and session_memory is not None:
        print(f"   ⚠️ parse_llm_response falling back to wrap_plain_text — first 100 chars: {plain_text[:100]}")
        return wrap_plain_text_into_json(plain_text, session_memory)

    raise ValueError(f"All JSON extraction strategies failed. Raw: {raw_content[:200]}")


# ── JD Generation ──────────────────────────────────────────────────────────────

def _build_markdown_from_structured(s: dict, insights: dict) -> str:
    """Safety net — reconstruct markdown when jd_text_format is missing."""
    emp = s.get("employee_information", {})
    title = (
        emp.get("job_title") or emp.get("title") or emp.get("role_title")
        or insights.get("identity_context", {}).get("job_title", "Role")
    )
    lines = [f"# Job Description: {title}\n"]
    dept = emp.get("department", "")
    location = emp.get("location", "")
    work_type = emp.get("work_type", "")
    reports_to = emp.get("reports_to", "")
    if dept or location:
        lines.append(f"**Department:** {dept} | **Location:** {location} | **Work Type:** {work_type}")
    if reports_to:
        lines.append(f"**Reports To:** {reports_to}")
    lines.append("\n---\n")

    for section, key in [
        ("## About the Role", "role_summary"),
    ]:
        val = s.get(key, "")
        if val:
            lines.append(section)
            lines.append(val if isinstance(val, str) else json.dumps(val))
            lines.append("\n---\n")

    for section, key in [
        ("## Key Responsibilities", "key_responsibilities"),
        ("## Required Skills", "required_skills"),
        ("## Tools & Technologies", "tools_and_technologies"),
        ("## Performance Metrics", "performance_metrics"),
    ]:
        items = s.get(key, [])
        if items:
            lines.append(section)
            for item in items:
                lines.append(f"- {item}")
            lines.append("\n---\n")

    for section, key in [
        ("## Team Structure", "team_structure"),
        ("## Work Environment", "work_environment"),
    ]:
        data = s.get(key, {})
        if data:
            lines.append(section)
            for k, v in data.items():
                val = ", ".join(str(i) for i in v) if isinstance(v, list) else str(v)
                lines.append(f"**{k.replace('_', ' ').title()}:** {val}")
            lines.append("\n---\n")

    lines.append("*Generated from structured employee role intelligence interview.*")
    return "\n".join(lines)


async def handle_jd_generation(session_memory: SessionMemory) -> dict:
    """
    Dedicated JD generation — called ONLY from POST /jd/generate endpoint.
    Never triggered from chat turns.
    Returns: { jd_text, jd_structured, status }
    """
    print("\n" + "=" * 60)
    print("🎯 HANDLE_JD_GENERATION STARTED")
    print("=" * 60)

    insights_dict = safe_to_dict(session_memory.insights)

    print(f"📊 INSIGHTS AVAILABLE:")
    print(f"   Keys: {list(insights_dict.keys())}")
    for k, v in insights_dict.items():
        print(f"   {k}: {str(v)[:80]}")

    if not insights_dict:
        raise ValueError("No insights collected yet. Complete the interview first.")

    # ── Call JD LLM ────────────────────────────────────────────────────────────
    messages = [
        SystemMessage(content=JD_GENERATION_PROMPT),
        HumanMessage(content=(
            "Generate a complete Job Description using the employee role insights below.\n\n"
            "STRICT OUTPUT RULES:\n"
            "1. Return ONLY a single valid JSON object — no text or markdown fences before/after.\n"
            "2. The JSON must have EXACTLY two top-level keys:\n"
            "   'jd_structured_data' — fully populated object with ALL schema fields\n"
            "   'jd_text_format'     — complete JD as a clean markdown string\n"
            "3. jd_structured_data must NOT be empty {} — populate every field.\n"
            "4. jd_text_format must be clean markdown starting with '# Job Description:'\n"
            "   IMPORTANT: You must escape all newlines as \\n within the JSON string. Do NOT use literal (raw) newlines inside the JSON values!\n"
            "   It must NOT be a JSON dump or contain raw field names.\n\n"
            "Employee Role Intelligence:\n"
            f"{json.dumps(insights_dict, indent=2)}"
        ))
    ]

    print("\n🤖 CALLING JD LLM...")
    response = jd_llm.invoke(messages)
    raw = strip_reasoning_tags(response.content)

    print("\n🔍 RAW JD LLM OUTPUT:")
    print("-" * 60)
    print(raw[:1500])
    print("-" * 60)

    # ── Parse response ─────────────────────────────────────────────────────────
    structured = {}
    jd_text = ""

    # Strategy 1: extract JSON block and parse
    cleaned = clean_json_string(raw)
    block = extract_json_block(cleaned) or extract_json_block(remove_think_tags(raw))

    print(f"\n🔧 PARSING STRATEGY 1 — JSON block extraction:")
    print(f"   block found: {bool(block)} | block length: {len(block)}")

    if block:
        try:
            parsed = json.loads(block, strict=False)
            print(f"   ✅ JSON parsed | top-level keys: {list(parsed.keys())}")

            # Extract jd_structured_data
            structured = parsed.get("jd_structured_data") or {}
            print(f"   jd_structured_data type: {type(structured)} | empty: {not structured}")

            # If LLM returned structured fields at top level (no nesting)
            if not structured:
                jd_keys = {
                    "employee_information", "role_summary", "key_responsibilities",
                    "required_skills", "tools_and_technologies", "team_structure",
                    "stakeholder_interactions", "performance_metrics",
                    "work_environment", "additional_details"
                }
                if any(k in parsed for k in jd_keys):
                    structured = {k: parsed[k] for k in jd_keys if k in parsed}
                    print(f"   ⚠️  Collected top-level structured fields: {list(structured.keys())}")

            # Extract jd_text_format
            jd_text = parsed.get("jd_text_format", "")
            print(f"   jd_text_format length: {len(jd_text)}")

            # Try fallback keys
            if not jd_text:
                for key in ("jd_text", "job_description", "markdown", "content", "text"):
                    if parsed.get(key) and isinstance(parsed[key], str):
                        jd_text = parsed[key]
                        print(f"   ⚠️  Found jd_text_format under key '{key}'")
                        break

            # Discard if jd_text is a data dump
            garbage_starts = ("jd_structured_data", "employee_information name")
            if jd_text and any(jd_text.strip().startswith(g) for g in garbage_starts):
                print(f"   ⚠️  jd_text_format looks like a data dump — discarding")
                jd_text = ""

        except json.JSONDecodeError as e:
            print(f"   ❌ JSON parse failed: {e}")
            print(f"   First 200 chars of block: {block[:200]}")

    # Strategy 2: raw output is pure markdown or unstructured text
    if not jd_text and not structured:
        clean_raw = remove_think_tags(raw).strip()
        if len(clean_raw) > 100:
            print("\n🔧 PARSING STRATEGY 2 — Fallback to raw text as markdown")
            jd_text = clean_raw

    # Strategy 3: reconstruct markdown from structured
    if structured and not jd_text:
        print("\n🔧 PARSING STRATEGY 3 — Reconstructing markdown from structured data")
        jd_text = _build_markdown_from_structured(structured, insights_dict)

    print(f"\n📋 FINAL RESULT:")
    print(f"   structured keys: {list(structured.keys())}")
    print(f"   jd_text length: {len(jd_text)}")
    print(f"   jd_text preview: {jd_text[:200]}")

    if not jd_text and not structured:
        raise ValueError("JD generation produced no output. Check LLM response in logs above.")

    # ── Store in session memory ────────────────────────────────────────────────
    if jd_text:
        session_memory.generated_jd = jd_text
        print(f"\n✅ session_memory.generated_jd set — length: {len(jd_text)}")
    if structured:
        session_memory.jd_structured = structured
        print(f"✅ session_memory.jd_structured set — keys: {list(structured.keys())}")

    session_memory.progress["status"] = "jd_generated"
    print(f"✅ session_memory.progress status set to: jd_generated")
    print("=" * 60 + "\n")

    return {
        "jd_text": jd_text,
        "jd_structured": structured,
        "status": "jd_generated",
    }


# ── Main Interview Handler ─────────────────────────────────────────────────────

async def handle_conversation(
    history: list,
    user_message: str,
    session_memory: SessionMemory
):
    print("\n" + "=" * 50)
    print(f"🚀 INTERVIEW TURN")
    print("=" * 50)

    if user_message == "TEST_RATE_LIMIT":
        raise HTTPException(status_code=429, detail="Rate limit exceeded (Simulation)")

    print("\n📋 BUILDING CONTEXT...")
    msgs = build_context(session_memory, user_message)

    try:
        print("\n🤖 INVOKING INTERVIEW LLM...")
        response = interview_llm.invoke(msgs)
        raw_content = strip_reasoning_tags(response.content)
    except Exception as e:
        error_str = str(e).lower()
        print(f"❌ LLM ERROR: {e}")
        if "rate limit" in error_str or "429" in error_str or isinstance(e, groq.RateLimitError):
            raise HTTPException(status_code=429, detail="Rate limit exceeded")
        raise HTTPException(status_code=500, detail="Internal LLM Error")

    print("\n🧩 PARSING & UPDATING MEMORY...")
    reply_content: str

    try:
        parsed_json, cleaned_content = parse_llm_response(raw_content, session_memory)
        validated = ChatResponse(**parsed_json)

        # Deep merge insights
        llm_insights = validated.employee_role_insights.model_dump()
        existing_insights = safe_to_dict(session_memory.insights)
        merged_insights = deep_merge(existing_insights, llm_insights)
        session_memory.insights = merged_insights

        # Update progress
        session_memory.progress = validated.progress.model_dump()
        current_status = validated.progress.status

        print(f"   status={current_status} | completion={validated.progress.completion_percentage}%")

        # ── SAFETY GUARD: Ensure conversation_response is clean human-readable text
        # If it somehow contains JSON structure, extract the inner text
        conv_resp = parsed_json.get("conversation_response", "")
        if conv_resp and (conv_resp.strip().startswith("{") or "conversation_response" in conv_resp):
            try:
                inner = json.loads(conv_resp)
                if "conversation_response" in inner:
                    parsed_json["conversation_response"] = inner["conversation_response"]
                    print(f"   ⚠️ SAFETY GUARD: stripped nested JSON from conversation_response")
            except (json.JSONDecodeError, TypeError):
                pass

        # Store plain conversation text in history only
        assistant_text = validated.conversation_response
        assistant_history_entry = json.dumps({"conversation_response": assistant_text})
        session_memory.update_recent("user", user_message)
        session_memory.update_recent("assistant", assistant_history_entry)
        update_summary(session_memory)

        # Interview only — JD generation is via POST /jd/generate endpoint
        parsed_json["employee_role_insights"] = merged_insights
        parsed_json["jd_structured_data"] = {}
        parsed_json["jd_text_format"] = ""

        reply_content = json.dumps(parsed_json, indent=2)

        history.append({"role": "user", "content": user_message})
        history.append({"role": "assistant", "content": reply_content})

    except Exception as e:
        print(f"⚠️ PROCESSING ERROR: {e}")
        import traceback
        traceback.print_exc()
        reply_content = build_fallback_response(session_memory)
        history.append({"role": "user", "content": user_message})
        history.append({"role": "assistant", "content": reply_content})

    print("\n✅ INTERVIEW TURN COMPLETED")
    print("=" * 50 + "\n")

    return reply_content, history