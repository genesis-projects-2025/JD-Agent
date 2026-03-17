# app/services/jd_service.py
from fastapi import HTTPException
import json
import asyncio
import re
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.messages import HumanMessage, SystemMessage
from app.core.config import settings
from app.prompts.jd_prompts import JD_GENERATION_PROMPT
from app.schemas.jd_schema import (
    ChatResponse,
    Progress,
    Approval,
    Analytics,
    EmployeeRoleInsights,
)
from app.utils.text_utils import strip_reasoning_tags
from app.services.context_builder import build_context
from app.memory.session_memory import SessionMemory

# ── LLM Instances ──────────────────────────────────────────────────────────────
interview_llm = ChatGoogleGenerativeAI(
    google_api_key=settings.GEMINI_API_KEY,
    model="gemini-2.5-flash",  # Using stable version
    temperature=0.2,
    response_mime_type="application/json",
)

jd_llm = ChatGoogleGenerativeAI(
    google_api_key=settings.GEMINI_API_KEY,
    model="gemini-2.5-pro",
    temperature=0.1,
    response_mime_type="application/json",
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
        return text[start : end + 1]
    return ""


def extract_streaming_text(raw_json: str) -> str:
    """Extracts the value of conversation_response from a potentially incomplete JSON string."""
    match = re.search(r'"conversation_response"\s*:\s*"((?:[^"\\]|\\.)*)', raw_json)
    if match:
        extracted = match.group(1)
        try:
            return json.loads(f'"{extracted}"')
        except json.JSONDecodeError:
            return extracted.replace('\\"', '"').replace("\\n", "\n")
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
        if (
            existing_val is None
            or existing_val == {}
            or existing_val == []
            or existing_val == ""
        ):
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
    # Use full_history length — recent_messages is always capped so this was always True
    if len(memory.full_history) >= 4:
        memory.summary = "Conversation collected employee role responsibilities, tools, and workflow insights."


def build_fallback_response(session_memory: SessionMemory) -> str:
    progress_dict = safe_to_dict(session_memory.progress)
    insights_dict = safe_to_dict(session_memory.insights)
    try:
        fallback = ChatResponse(
            conversation_response="I encountered an issue. Could you please repeat your last message?",
            progress=Progress(**progress_dict) if progress_dict else Progress(),
            employee_role_insights=EmployeeRoleInsights(**insights_dict)
            if insights_dict
            else EmployeeRoleInsights(),
            jd_structured_data=None,
            jd_text_format="",
            suggested_skills=[],
            approval=Approval(),
            analytics=Analytics(),
        )
        return fallback.model_dump_json()
    except Exception:
        return json.dumps(
            {
                "conversation_response": "I encountered an issue. Could you please repeat your last message?",
                "progress": progress_dict
                or {
                    "completion_percentage": 0,
                    "missing_insight_areas": [],
                    "status": "collecting",
                },
                "employee_role_insights": insights_dict or {},
                "jd_structured_data": {},
                "jd_text_format": "",
                "suggested_skills": [],
                "analytics": {
                    "questions_asked": 0,
                    "questions_answered": 0,
                    "insights_collected": 0,
                    "estimated_completion_time_minutes": 0,
                },
                "approval": {"approval_required": False, "approval_status": "pending"},
            }
        )


def wrap_plain_text_into_json(
    plain_text: str, session_memory: SessionMemory
) -> tuple[dict, str]:
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
                print(
                    "   ✅ wrap_plain_text_into_json: rescued conversation_response from raw JSON blob"
                )
                conversation_text = candidate["conversation_response"]
                # Merge insights if present
                if "employee_role_insights" in candidate and isinstance(
                    candidate["employee_role_insights"], dict
                ):
                    insights_dict = deep_merge(
                        insights_dict, candidate["employee_role_insights"]
                    )
                if "progress" in candidate and isinstance(candidate["progress"], dict):
                    progress_dict = deep_merge(progress_dict, candidate["progress"])
                # Rebuild properly
                wrapped = {
                    "conversation_response": conversation_text,
                    "progress": progress_dict
                    or {
                        "completion_percentage": 0,
                        "missing_insight_areas": [],
                        "status": "collecting",
                    },
                    "employee_role_insights": insights_dict,
                    "jd_structured_data": candidate.get("jd_structured_data", {}),
                    "jd_text_format": candidate.get("jd_text_format", ""),
                    "suggested_skills": candidate.get("suggested_skills", []),
                    "analytics": candidate.get(
                        "analytics",
                        {
                            "questions_asked": 0,
                            "questions_answered": 0,
                            "insights_collected": 0,
                            "estimated_completion_time_minutes": 10,
                        },
                    ),
                    "approval": candidate.get(
                        "approval",
                        {"approval_required": False, "approval_status": "pending"},
                    ),
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
                        print(
                            "   ✅ wrap_plain_text_into_json: rescued conversation_response from embedded JSON block"
                        )
                        conversation_text = candidate["conversation_response"]
                        # Preserve progress if not in block
                        p_block = candidate.get("progress")
                        if not p_block or not p_block.get("completion_percentage"):
                            p_block = progress_dict or {
                                "completion_percentage": 0,
                                "missing_insight_areas": [],
                                "status": "collecting",
                            }

                        wrapped = {
                            "conversation_response": conversation_text,
                            "progress": p_block,
                            "employee_role_insights": candidate.get(
                                "employee_role_insights", insights_dict
                            ),
                            "jd_structured_data": candidate.get(
                                "jd_structured_data", {}
                            ),
                            "jd_text_format": candidate.get("jd_text_format", ""),
                            "suggested_skills": candidate.get("suggested_skills", []),
                            "analytics": candidate.get(
                                "analytics",
                                {
                                    "questions_asked": 0,
                                    "questions_answered": 0,
                                    "insights_collected": 0,
                                    "estimated_completion_time_minutes": 10,
                                },
                            ),
                            "approval": candidate.get(
                                "approval",
                                {
                                    "approval_required": False,
                                    "approval_status": "pending",
                                },
                            ),
                        }
                        wrapped_str = json.dumps(wrapped, indent=2)
                        return wrapped, wrapped_str
                except (json.JSONDecodeError, TypeError):
                    pass

    sanitized_text = plain_text.strip("{} \n\t\r")
    wrapped = {
        "conversation_response": sanitized_text.strip(),
        "progress": progress_dict
        if progress_dict
        else {
            "completion_percentage": 0,
            "missing_insight_areas": [],
            "status": "collecting",
        },
        "employee_role_insights": insights_dict
        or {
            "identity_context": {},
            "purpose": "",
            "responsibilities": [],
            "working_relationships": {},
            "skills": [],
            "tools": [],
            "education": "",
            "experience": "",
        },
        "jd_structured_data": {},
        "jd_text_format": "",
        "suggested_skills": [],
        "analytics": {
            "questions_asked": 0,
            "questions_answered": 0,
            "insights_collected": len([v for v in insights_dict.values() if v]),
            "estimated_completion_time_minutes": 10,
        },
        "approval": {"approval_required": False, "approval_status": "pending"},
    }
    wrapped_str = json.dumps(wrapped, indent=2)
    return wrapped, wrapped_str


def parse_llm_response(
    raw_content: str, session_memory: SessionMemory = None
) -> tuple[dict, str]:
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
                    if (
                        isinstance(candidate, dict)
                        and "conversation_response" in candidate
                    ):
                        candidate_str = json.dumps(candidate)
                        return candidate, candidate_str
                except json.JSONDecodeError:
                    continue
            start = idx + 1

    # Strategy 5: fallback — wrap whatever text we have
    plain_text = remove_think_tags(raw_content).strip()
    if plain_text and session_memory is not None:
        print(
            f"   ⚠️ parse_llm_response falling back to wrap_plain_text — first 100 chars: {plain_text[:100]}"
        )
        return wrap_plain_text_into_json(plain_text, session_memory)

    raise ValueError(f"All JSON extraction strategies failed. Raw: {raw_content[:200]}")


# ── JD Generation ──────────────────────────────────────────────────────────────
# getting the structed data of the employee whole conversation
def build_markdown_from_structured(structured: dict) -> str:
    """Standardized markdown generator for Pulse Pharma template."""
    emp = structured.get("employee_information", {})
    title = (
        emp.get("job_title") or emp.get("title") or emp.get("role_title") or "New Role"
    )
    lines = [f"# Job Description: {title}\n"]
    dept = emp.get("department", "")
    location = emp.get("location", "")
    work_type = emp.get("work_type", "")
    reports_to = emp.get("reports_to", "")
    if dept or location:
        lines.append(
            f"**Department:** {dept} | **Location:** {location} | **Work Type:** {work_type}"
        )
    if reports_to:
        lines.append(f"**Reports To:** {reports_to}")
    lines.append("\n---\n")

    for section, key in [
        ("## Purpose of the Job / Role", "purpose"),
        ("## Job Responsibilities", "responsibilities"),
    ]:
        val = structured.get(key)
        if val:
            lines.append(section)
            if isinstance(val, list):
                for item in val:
                    lines.append(f"- {item}")
            else:
                lines.append(str(val))
            lines.append("\n---\n")

    wr = structured.get("working_relationships", {})
    if wr:
        lines.append("## Working Relationships\n")
        lines.append("| | |")
        lines.append("|---|---|")
        if wr.get("reporting_to"):
            lines.append(f"| **Reporting to** | {wr['reporting_to']} |")
        if wr.get("team_size"):
            lines.append(f"| **Team** | {wr['team_size']} |")
        if wr.get("internal_stakeholders"):
            lines.append(
                f"| **Internal Stakeholders** | {wr['internal_stakeholders']} |"
            )
        if wr.get("external_stakeholders"):
            lines.append(
                f"| **External Stakeholders** | {wr['external_stakeholders']} |"
            )
        lines.append("\n---\n")

    for section, key in [
        ("## Skills / Competencies Required", "skills"),
        ("## Tools & Technologies", "tools"),
    ]:
        items = structured.get(key, [])
        if items:
            lines.append(section)
            for item in items:
                lines.append(f"- {item}")
            lines.append("\n---\n")

    if structured.get("education") or structured.get("experience"):
        lines.append("## Academic Qualifications & Experience Required")
        if structured.get("education"):
            lines.append(str(structured["education"]))
        if structured.get("experience"):
            lines.append(str(structured["experience"]))
        lines.append("\n---\n")

    lines.append("*Generated from structured employee role intelligence interview.*")
    return "\n".join(lines)


# This is where the jd is generated to save in the database
async def handle_jd_generation(session_memory: SessionMemory) -> dict:
    """
    Dedicated JD generation — called ONLY from POST /jd/generate endpoint.
    Never triggered from chat turns.
    Returns: { jd_text, jd_structured, status }
    """
    print("\n[JD Generation] 🎯 STARTED")

    insights_dict = safe_to_dict(session_memory.insights)

    # for k, v in insights_dict.items():

    if not insights_dict:
        raise ValueError("No insights collected yet. Complete the interview first.")

    # ── Call JD LLM ────────────────────────────────────────────────────────────
    messages = [
        SystemMessage(content=JD_GENERATION_PROMPT),
        HumanMessage(
            content=(
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
            )
        ),
    ]

    print("\n🤖 CALLING JD LLM...")
    response = await jd_llm.ainvoke(messages)
    raw = strip_reasoning_tags(response.content)

    # ── Parse response ─────────────────────────────────────────────────────────
    structured = {}
    jd_text = ""

    # Strategy 1: extract JSON block and parse
    cleaned = clean_json_string(raw)
    block = extract_json_block(cleaned) or extract_json_block(remove_think_tags(raw))

    print(f"[JD Generation] Strategy 1 — JSON block extraction (found: {bool(block)})")

    if block:
        try:
            parsed = json.loads(block, strict=False)
            # Extract jd_structured_data
            structured = parsed.get("jd_structured_data") or {}

            # If LLM returned structured fields at top level (no nesting)
            if not structured:
                jd_keys = {
                    "employee_information",
                    "purpose",
                    "responsibilities",
                    "working_relationships",
                    "skills",
                    "tools",
                    "education",
                    "experience",
                    "additional_details",
                }
                if any(k in parsed for k in jd_keys):
                    structured = {k: parsed[k] for k in jd_keys if k in parsed}
                    print(
                        f"   ⚠️  Collected top-level structured fields: {list(structured.keys())}"
                    )

            # Extract jd_text_format
            jd_text = parsed.get("jd_text_format", "")

            # Try fallback keys
            if not jd_text:
                for key in (
                    "jd_text",
                    "job_description",
                    "markdown",
                    "content",
                    "text",
                ):
                    if parsed.get(key) and isinstance(parsed[key], str):
                        jd_text = parsed[key]
                        print(f"   ⚠️  Found jd_text_format under key '{key}'")
                        break

            # Discard if jd_text is a data dump
            garbage_starts = ("jd_structured_data", "employee_information name")
            if jd_text and any(jd_text.strip().startswith(g) for g in garbage_starts):
                print("   ⚠️  jd_text_format looks like a data dump — discarding")
                jd_text = ""

        except json.JSONDecodeError as e:
            print(f"[JD Generation] ❌ JSON parse failed: {e}")

    # Strategy 2: raw output is pure markdown or unstructured text
    if not jd_text and not structured:
        clean_raw = remove_think_tags(raw).strip()
        if len(clean_raw) > 100:
            print("\n🔧 PARSING STRATEGY 2 — Fallback to raw text as markdown")
            jd_text = clean_raw

    # Strategy 3: reconstruct markdown from structured
    if structured and not jd_text:
        print(
            "\n🔧 PARSING STRATEGY 3 — Reconstructing markdown"
        )  # Build markdown for UI
        md = build_markdown_from_structured(structured)
        jd_text = md

    print(
        f"[JD Generation] 📋 FINAL RESULT | structured keys: {len(list(structured.keys()))} | text length: {len(jd_text)}"
    )

    if not jd_text and not structured:
        raise ValueError(
            "JD generation produced no output. Check LLM response in logs above."
        )

    # ── Store in session memory ────────────────────────────────────────────────
    if jd_text:
        session_memory.generated_jd = jd_text
    if structured:
        session_memory.jd_structured = structured

    session_memory.progress["status"] = "jd_generated"
    print("[JD Generation] ✅ Completed")

    return {
        "jd_text": jd_text,
        "jd_structured": structured,
        "status": "jd_generated",
    }


# ── Main Interview Handler ─────────────────────────────────────────────────────


async def handle_conversation(
    history: list, user_message: str, session_memory: SessionMemory
):
    print("\n[Interview] 🚀 TURN STARTED")

    msgs = build_context(session_memory, user_message)

    try:
        # Use ainvoke for true asynchrony and simultaneous user support
        response = await interview_llm.ainvoke(msgs)
        raw_content = strip_reasoning_tags(response.content)
    except Exception as e:
        error_str = str(e).lower()
        print(f"❌ LLM ERROR: {e}")
        if "rate limit" in error_str or "429" in error_str or "exhausted" in error_str:
            raise HTTPException(status_code=429, detail="Rate limit exceeded")
        raise HTTPException(status_code=500, detail="Internal LLM Error")

    reply_content: str

    try:
        parsed_json, cleaned_content = parse_llm_response(raw_content, session_memory)
        validated = ChatResponse(**parsed_json)

        # Deep merge insights
        llm_insights = validated.employee_role_insights.model_dump()
        existing_insights = safe_to_dict(session_memory.insights)
        merged_insights = deep_merge(existing_insights, llm_insights)
        session_memory.insights = merged_insights

        # Update progress carefully — don't overwrite with 0 if LLM failed to return progress
        current_percentage = session_memory.progress.get("completion_percentage", 0)
        new_percentage = validated.progress.completion_percentage
        current_status = session_memory.progress.get("status", "collecting")

        # Never let status go backwards (ready_for_generation → collecting)
        # Never let percentage drop more than 10 points (LLM miscalculation)
        status_priority = {
            "collecting": 0,
            "ready_for_generation": 1,
            "jd_generated": 2,
            "approved": 3,
        }
        current_priority = status_priority.get(current_status, 0)
        new_priority = status_priority.get(validated.progress.status, 0)

        if new_percentage > current_percentage or not session_memory.progress:
            session_memory.progress = validated.progress.model_dump()
        elif new_priority > current_priority:
            # Status advanced (e.g. collecting → ready_for_generation) — always accept
            session_memory.progress = validated.progress.model_dump()
        else:
            # Keep the higher percentage but update missing areas only if
            # status hasn't reached ready_for_generation yet
            session_memory.progress["status"] = max(
                current_status,
                validated.progress.status,
                key=lambda s: status_priority.get(s, 0),
            )
            if current_status != "ready_for_generation":
                # Only update missing areas before ready state
                # After ready, clearing missing_insight_areas stops re-asking
                session_memory.progress["missing_insight_areas"] = (
                    validated.progress.missing_insight_areas
                )
            else:
                # Already ready — wipe missing areas so LLM stops re-asking
                session_memory.progress["missing_insight_areas"] = []
            parsed_json["progress"] = session_memory.progress

        session_memory.progress.get("status", "collecting")

        # ── SAFETY GUARD: Ensure conversation_response is clean human-readable text
        # If it somehow contains JSON structure, extract the inner text
        conv_resp = parsed_json.get("conversation_response", "")
        if conv_resp and (
            conv_resp.strip().startswith("{") or "conversation_response" in conv_resp
        ):
            try:
                inner = json.loads(conv_resp)
                if "conversation_response" in inner:
                    parsed_json["conversation_response"] = inner[
                        "conversation_response"
                    ]
            except (json.JSONDecodeError, TypeError):
                pass

        # Store plain conversation text in history only
        assistant_text = validated.conversation_response.strip()
        import re

        assistant_text = re.sub(r"\n{3,}", "\n\n", assistant_text)

        assistant_history_entry = json.dumps({"conversation_response": assistant_text})
        session_memory.update_recent("user", user_message)
        session_memory.update_recent("assistant", assistant_history_entry)
        update_summary(session_memory)

        # Interview only — JD generation is via POST /jd/generate endpoint
        # Interview only — JD generation is via POST /jd/generate endpoint
        parsed_json["employee_role_insights"] = merged_insights
        parsed_json["jd_structured_data"] = {}
        parsed_json["jd_text_format"] = ""
        # DO NOT wipe suggested_skills here — frontend needs it to show skill chips
        # It is already correctly set by the LLM only when status=ready_for_generation

        reply_content = json.dumps(parsed_json, indent=2)

        # Store assistant turn with status metadata so context_builder
        # can remind the LLM what it already collected
        assistant_history_entry = json.dumps(
            {
                "conversation_response": validated.conversation_response.strip(),
                "progress": parsed_json.get("progress", {}),
                "suggested_skills": parsed_json.get("suggested_skills", []),
            }
        )
        session_memory.update_recent("user", user_message)
        session_memory.update_recent("assistant", assistant_history_entry)
        update_summary(session_memory)

        history.append({"role": "user", "content": user_message})
        history.append({"role": "assistant", "content": reply_content})

    except Exception as e:
        print(f"⚠️ PROCESSING ERROR: {e}")
        import traceback

        traceback.print_exc()
        reply_content = build_fallback_response(session_memory)
        history.append({"role": "user", "content": user_message})
        history.append({"role": "assistant", "content": reply_content})

    print("[Interview] ✅ TURN COMPLETED\n")

    return reply_content, history


async def handle_conversation_stream(
    history: list, user_message: str, session_memory: SessionMemory
):
    print("\n[Interview Stream] 🚀 TURN STARTED")

    msgs = build_context(session_memory, user_message)

    try:
        raw_content = ""
        last_extracted_text = ""

        async for chunk in interview_llm.astream(msgs):
            if chunk.content:
                raw_content += chunk.content
                # Strip think tags before trying to extract to ensure we get actual response
                no_think_raw = remove_think_tags(raw_content)
                current_text = extract_streaming_text(no_think_raw)

                # Yield text delta
                if current_text and current_text != last_extracted_text:
                    yield f"data: {json.dumps({'type': 'chunk', 'content': current_text})}\n\n"
                    last_extracted_text = current_text
                    # Small sleep to provide a steady stream for the frontend typewriter to catch up to
                    await asyncio.sleep(0.03)

        # ── Parsing the fully accumulated string ──────────────────────────────────
        raw_content = strip_reasoning_tags(raw_content)
        parsed_json, _ = parse_llm_response(raw_content, session_memory)
        validated = ChatResponse(**parsed_json)

        llm_insights = validated.employee_role_insights.model_dump()
        existing_insights = safe_to_dict(session_memory.insights)
        merged_insights = deep_merge(existing_insights, llm_insights)
        session_memory.insights = merged_insights

        current_percentage = session_memory.progress.get("completion_percentage", 0)
        new_percentage = validated.progress.completion_percentage
        current_status = session_memory.progress.get("status", "collecting")

        # Never let status go backwards (ready_for_generation → collecting)
        # Never let percentage drop more than 10 points (LLM miscalculation)
        status_priority = {
            "collecting": 0,
            "ready_for_generation": 1,
            "jd_generated": 2,
            "approved": 3,
        }
        current_priority = status_priority.get(current_status, 0)
        new_priority = status_priority.get(validated.progress.status, 0)

        if new_percentage > current_percentage or not session_memory.progress:
            session_memory.progress = validated.progress.model_dump()
        elif new_priority > current_priority:
            # Status advanced (e.g. collecting → ready_for_generation) — always accept
            session_memory.progress = validated.progress.model_dump()
        else:
            # Keep the higher percentage but update missing areas only if
            # status hasn't reached ready_for_generation yet
            session_memory.progress["status"] = max(
                current_status,
                validated.progress.status,
                key=lambda s: status_priority.get(s, 0),
            )
            if current_status != "ready_for_generation":
                # Only update missing areas before ready state
                # After ready, clearing missing_insight_areas stops re-asking
                session_memory.progress["missing_insight_areas"] = (
                    validated.progress.missing_insight_areas
                )
            else:
                # Already ready — wipe missing areas so LLM stops re-asking
                session_memory.progress["missing_insight_areas"] = []
            parsed_json["progress"] = session_memory.progress

        conv_resp = parsed_json.get("conversation_response", "")
        if conv_resp and (
            conv_resp.strip().startswith("{") or "conversation_response" in conv_resp
        ):
            try:
                inner = json.loads(conv_resp)
                if "conversation_response" in inner:
                    parsed_json["conversation_response"] = inner[
                        "conversation_response"
                    ]
            except (json.JSONDecodeError, TypeError):
                pass

        assistant_text = validated.conversation_response.strip()
        assistant_text = re.sub(r"\n{3,}", "\n\n", assistant_text)

        # Store progress + skills in history so context_builder can remind the LLM
        assistant_history_entry = json.dumps(
            {
                "conversation_response": assistant_text,
                "progress": parsed_json.get("progress", {}),
                "suggested_skills": parsed_json.get("suggested_skills", []),
            }
        )
        session_memory.update_recent("user", user_message)
        session_memory.update_recent("assistant", assistant_history_entry)
        update_summary(session_memory)

        parsed_json["employee_role_insights"] = merged_insights
        parsed_json["jd_structured_data"] = {}
        parsed_json["jd_text_format"] = ""
        # DO NOT wipe suggested_skills — frontend needs it for skill chips

        # Yield final completed JSON for frontend to finalize state
        yield f"data: {json.dumps({'type': 'done', 'parsed': parsed_json})}\n\n"

        history.append({"role": "user", "content": user_message})
        history.append(
            {"role": "assistant", "content": json.dumps(parsed_json, indent=2)}
        )

    except Exception as e:
        print(f"⚠️ STREAM PROCESSING ERROR: {e}")
        import traceback

        traceback.print_exc()
        try:
            fallback = json.loads(build_fallback_response(session_memory))
            yield f"data: {json.dumps({'type': 'error', 'parsed': fallback})}\n\n"
        except Exception:
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"

    print("[Interview Stream] ✅ TURN COMPLETED\n")
