# backend/app/services/jd_service.py
#
# Phase-based interview service. Key changes from previous version:
# 1. _compute_phase() — determines correct phase from depth scoring
# 2. _check_depth() — validates field quality (not just non-empty)
# 3. _process_llm_response() — shared handler for both sync and stream
# 4. Phase-gate enforcement — rejects insights outside current phase
# 5. Removed duplicated code between handle_conversation and handle_conversation_stream

import asyncio
import json
import logging
import re
import traceback
import time

from fastapi import HTTPException
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.messages import HumanMessage, SystemMessage

from app.core.config import settings
from app.agents.prompts import JD_GENERATION_PROMPT
from app.schemas.jd_schema import (
    ChatResponse,
    Progress,
    Approval,
    Analytics,
    EmployeeRoleInsights,
)
from app.utils.text_utils import strip_reasoning_tags
from app.memory.session_memory import SessionMemory
from app.agents.router import compute_current_agent as _compute_current_agent
from app.agents.router import compute_progress as _compute_progress
from app.agents.logs.logger import InterviewLogger, calculate_turn_hash

logger = logging.getLogger(__name__)

# ── LLM Instances ──────────────────────────────────────────────────────────────
interview_llm = ChatGoogleGenerativeAI(
    google_api_key=settings.GEMINI_API_KEY,
    model="gemini-2.5-flash",
    temperature=0.4,
    response_mime_type="application/json",
)

jd_llm = ChatGoogleGenerativeAI(
    google_api_key=settings.GEMINI_API_KEY,
    model="gemini-2.5-pro",
    temperature=0.1,
    response_mime_type="application/json",
)


async def _invoke_with_retry(llm, messages, max_retries=2):
    """Invoke LLM with exponential backoff on transient failures (429, 500)."""
    for attempt in range(max_retries + 1):
        try:
            return await llm.ainvoke(messages)
        except Exception as e:
            err = str(e).lower()
            is_retryable = "429" in err or "500" in err or "resource_exhausted" in err
            if is_retryable and attempt < max_retries:
                wait = 2 ** attempt
                logger.warning(f"LLM retry {attempt + 1}/{max_retries} after {wait}s: {e}")
                await asyncio.sleep(wait)
            else:
                raise


# ── Soft skill blocklist ──────────────────────────────────────────────────────
_SOFT_SKILL_PATTERNS = {
    "communication", "teamwork", "collaboration", "leadership", "adaptability",
    "problem solving", "problem-solving", "critical thinking", "attention to detail",
    "time management", "interpersonal", "result-oriented", "results-oriented",
    "self-starter", "proactive", "detail-oriented", "organised", "organized",
    "motivated", "analytical", "analytical thinking", "strategic thinking",
    "creative thinking", "team player", "work ethic", "multitasking",
    "decision making", "decision-making", "emotional intelligence",
    "conflict resolution", "negotiation skills", "presentation skills",
}


def sanitise_skills(skills: list) -> list:
    """Remove soft skills and duplicates from a skills list."""
    if not skills:
        return []
    seen = set()
    clean = []
    for s in skills:
        if not s or not isinstance(s, str):
            continue
        stripped = s.strip()
        lower = stripped.lower()
        if lower in seen:
            continue
        if any(pattern in lower for pattern in _SOFT_SKILL_PATTERNS):
            continue
        clean.append(stripped)
        seen.add(lower)
    return clean


# ── Utilities ──────────────────────────────────────────────────────────────────


def _extract_balanced_json_blocks(text: str) -> list:
    """Find balanced {} JSON blocks using stack-based bracket matching. O(n) scan."""
    blocks = []
    stack = []
    in_string = False
    escape_next = False
    for i, ch in enumerate(text):
        if escape_next:
            escape_next = False
            continue
        if ch == '\\':
            escape_next = True
            continue
        if ch == '"':
            in_string = not in_string
            continue
        if in_string:
            continue
        if ch == '{':
            stack.append(i)
        elif ch == '}' and stack:
            start = stack.pop()
            if not stack:
                blocks.append(text[start:i + 1])
    return blocks


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
    """Extracts the value of next_question from a potentially incomplete JSON string."""
    match = re.search(r'"next_question"\s*:\s*"((?:[^"\\]|\\.)*)', raw_json)
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
    if len(memory.full_history) >= 4:
        memory.summary = (
            f"Interview with active agent: {memory.current_agent}. "
            f"Collected insights for {len(memory.insights)} categories."
        )


def build_fallback_response(session_memory: SessionMemory) -> str:
    progress_dict = safe_to_dict(session_memory.progress)
    insights_dict = safe_to_dict(session_memory.insights)
    try:
        fallback = ChatResponse(
            next_question="I encountered an issue. Could you please repeat your last message?",
            progress=Progress(**progress_dict) if progress_dict else Progress(),
            employee_role_insights=EmployeeRoleInsights(**insights_dict) if insights_dict else EmployeeRoleInsights(),
            jd_structured_data=None,
            jd_text_format="",
            suggested_skills=[],
            approval=Approval(),
            analytics=Analytics(),
        )
        return fallback.model_dump_json()
    except Exception:
        return json.dumps({
            "next_question": "I encountered an issue. Could you please repeat your last message?",
            "progress": progress_dict or {"completion_percentage": 0, "missing_insight_areas": [], "status": "collecting", "current_phase": 1},
            "employee_role_insights": insights_dict or {},
            "jd_structured_data": {},
            "jd_text_format": "",
            "suggested_skills": [],
            "analytics": {"questions_asked": 0, "questions_answered": 0, "insights_collected": 0, "estimated_completion_time_minutes": 0},
            "approval": {"approval_required": False, "approval_status": "pending"},
        })


def wrap_plain_text_into_json(plain_text: str, session_memory: SessionMemory) -> tuple[dict, str]:
    """Wrap a plain-text LLM response into the expected JSON structure."""
    insights_dict = safe_to_dict(session_memory.insights)
    progress_dict = safe_to_dict(session_memory.progress)

    stripped = plain_text.strip()

    # Try to parse if it looks like partial JSON
    if stripped.startswith("{") or "next_question" in stripped:
        try:
            candidate = json.loads(stripped)
            if "next_question" in candidate:
                if "employee_role_insights" in candidate and isinstance(candidate["employee_role_insights"], dict):
                    insights_dict = deep_merge(insights_dict, candidate["employee_role_insights"])
                if "progress" in candidate and isinstance(candidate["progress"], dict):
                    progress_dict = deep_merge(progress_dict, candidate["progress"])
                wrapped = {
                    "next_question": candidate["next_question"],
                    "progress": progress_dict or {"completion_percentage": 0, "missing_insight_areas": [], "status": "collecting", "current_phase": session_memory.current_phase},
                    "employee_role_insights": insights_dict,
                    "jd_structured_data": candidate.get("jd_structured_data", {}),
                    "jd_text_format": candidate.get("jd_text_format", ""),
                    "suggested_skills": candidate.get("suggested_skills", []),
                    "analytics": candidate.get("analytics", {"questions_asked": 0, "questions_answered": 0, "insights_collected": 0, "estimated_completion_time_minutes": 10}),
                    "approval": candidate.get("approval", {"approval_required": False, "approval_status": "pending"}),
                }
                return wrapped, json.dumps(wrapped, separators=(",", ":"))
        except (json.JSONDecodeError, TypeError):
            pass

    # Pure plain text fallback
    sanitized_text = plain_text.strip("{} \n\t\r")
    wrapped = {
        "next_question": sanitized_text.strip(),
        "progress": progress_dict or {"completion_percentage": 0, "missing_insight_areas": [], "status": "collecting", "current_phase": session_memory.current_phase},
        "employee_role_insights": insights_dict or {},
        "jd_structured_data": {},
        "jd_text_format": "",
        "suggested_skills": [],
        "analytics": {"questions_asked": 0, "questions_answered": 0, "insights_collected": len([v for v in insights_dict.values() if v]), "estimated_completion_time_minutes": 10},
        "approval": {"approval_required": False, "approval_status": "pending"},
    }
    return wrapped, json.dumps(wrapped, separators=(",", ":"))


def parse_llm_response(raw_content: str, session_memory: SessionMemory = None) -> tuple[dict, str]:
    """Multi-strategy JSON parser with O(n) bracket matching fallback."""
    cleaned = clean_json_string(raw_content)
    if cleaned:
        try:
            parsed = json.loads(cleaned)
            if "next_question" in parsed:
                return parsed, cleaned
        except json.JSONDecodeError:
            pass

    extracted = extract_json_block(cleaned)
    if extracted:
        try:
            parsed = json.loads(extracted)
            if "next_question" in parsed:
                return parsed, extracted
        except json.JSONDecodeError:
            pass

    no_think = remove_think_tags(raw_content)
    extracted2 = extract_json_block(no_think)
    if extracted2:
        try:
            parsed = json.loads(extracted2)
            if "next_question" in parsed:
                return parsed, extracted2
        except json.JSONDecodeError:
            pass

    no_think_clean = clean_json_string(no_think)
    for attempt in [no_think_clean, no_think, raw_content]:
        for block in _extract_balanced_json_blocks(attempt):
            try:
                candidate = json.loads(block)
                if isinstance(candidate, dict) and "next_question" in candidate:
                    return candidate, json.dumps(candidate, separators=(",", ":"))
            except json.JSONDecodeError:
                continue

    plain_text = remove_think_tags(raw_content).strip()
    if plain_text and session_memory is not None:
        return wrap_plain_text_into_json(plain_text, session_memory)

    raise ValueError(f"All JSON extraction strategies failed. Raw: {raw_content[:200]}")


# ── JD Generation ──────────────────────────────────────────────────────────────


def build_markdown_from_structured(structured: dict) -> str:
    """Standardized markdown generator for Pulse Pharma template."""
    emp = structured.get("employee_information", {})
    title = emp.get("job_title") or emp.get("title") or emp.get("role_title") or "New Role"
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
            lines.append(f"| **Internal Stakeholders** | {wr['internal_stakeholders']} |")
        if wr.get("external_stakeholders"):
            lines.append(f"| **External Stakeholders** | {wr['external_stakeholders']} |")
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


async def handle_jd_generation(session_memory: SessionMemory) -> dict:
    """Dedicated JD generation — called ONLY from POST /jd/generate endpoint."""
    logger.info("[JD Generation] STARTED")

    insights_dict = safe_to_dict(session_memory.insights)
    if not insights_dict:
        raise ValueError("No insights collected yet. Complete the interview first.")

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
            "   IMPORTANT: Escape all newlines as \\n within the JSON string.\n\n"
            "Employee Role Intelligence:\n"
            f"{json.dumps(insights_dict, indent=2)}"
        )),
    ]

    logger.info("Calling JD LLM...")
    try:
        response = await _invoke_with_retry(jd_llm, messages)
    except Exception as e:
        err_msg = str(e)
        if "429" in err_msg or "quota" in err_msg.lower() or "resource_exhausted" in err_msg.lower():
            raise HTTPException(status_code=429, detail="Gemini API Quota Exceeded. Please try again in 30 seconds.")
        raise e

    raw = strip_reasoning_tags(response.content)
    structured = {}
    jd_text = ""

    cleaned = clean_json_string(raw)
    block = extract_json_block(cleaned) or extract_json_block(remove_think_tags(raw))

    if block:
        try:
            parsed = json.loads(block, strict=False)
            structured = parsed.get("jd_structured_data") or {}

            if not structured:
                jd_keys = {"employee_information", "purpose", "responsibilities", "working_relationships", "skills", "tools", "education", "experience", "additional_details"}
                if any(k in parsed for k in jd_keys):
                    structured = {k: parsed[k] for k in jd_keys if k in parsed}

            jd_text = parsed.get("jd_text_format", "")
            if not jd_text:
                for key in ("jd_text", "job_description", "markdown", "content", "text"):
                    if parsed.get(key) and isinstance(parsed[key], str):
                        jd_text = parsed[key]
                        break

            garbage_starts = ("jd_structured_data", "employee_information name")
            if jd_text and any(jd_text.strip().startswith(g) for g in garbage_starts):
                jd_text = ""

        except json.JSONDecodeError as e:
            logger.warning(f"JD Generation JSON parse failed: {e}")

    if not jd_text and not structured:
        clean_raw = remove_think_tags(raw).strip()
        if len(clean_raw) > 100:
            jd_text = clean_raw

    if structured and not jd_text:
        jd_text = build_markdown_from_structured(structured)

    if not jd_text and not structured:
        raise ValueError("JD generation produced no output. Check LLM response in logs above.")

    if jd_text:
        session_memory.generated_jd = jd_text
    if structured:
        session_memory.jd_structured = structured

    session_memory.progress["status"] = "jd_generated"
    logger.info("[JD Generation] Completed")
    
    # Log session summary for improvement analysis
    try:
        from app.agents.logs.logger import InterviewLogger
        total_time_ms = session_memory.progress.get("total_time_ms", 0)
        InterviewLogger.log_session_summary(
            session_id=str(session_memory.id),
            total_turns=session_memory.turn_count,
            final_agent=session_memory.current_agent,
            final_progress=session_memory.progress.get("completion_percentage", 0),
            total_tokens=session_memory.progress.get("total_tokens_used", 0),
            total_time_ms=total_time_ms,
            jd_generated=True,
            jd_quality_score=None,  # Could be added if we implement quality scoring
            user_feedback=None
        )
    except Exception as e:
        logger.warning(f"Failed to log session summary: {e}")

    return {"jd_text": jd_text, "jd_structured": structured, "status": "jd_generated"}


# ── Shared Response Processor ─────────────────────────────────────────────────


def _process_llm_response(
    parsed_json: dict, session_memory: SessionMemory, user_message: str, history: list
) -> str:
    """
    Shared post-processing for both sync and stream handlers.
    - Validates against ChatResponse schema
    - Deep-merges insights with phase-gate enforcement
    - Updates progress (forward-only)
    - Computes and advances phase
    - Sanitises skills
    - Returns the reply content string
    """
    # ── Update Shared Memory (extracted_data) ───────────────────────────
    llm_data = parsed_json.get("extracted_data", {})
    existing_insights = safe_to_dict(session_memory.insights)
    merged_insights = deep_merge(existing_insights, llm_data)

    # ── Sanitise skills ───────────────────────────────────────────────────
    if "skills" in merged_insights and isinstance(merged_insights["skills"], list):
        merged_insights["skills"] = sanitise_skills(merged_insights["skills"])

    session_memory.insights = merged_insights

    # ── Orchestrator: Decide next agent ───────────────────────────────────
    current_agent = _compute_current_agent(merged_insights)
    session_memory.current_agent = current_agent

    # ── Progress — forward-only, using router.py's compute_progress ──────
    computed_progress = _compute_progress(merged_insights, current_agent)
    current_pct = session_memory.progress.get("completion_percentage", 0)
    computed_pct = computed_progress.get("completion_percentage", 0)

    if computed_pct >= current_pct:
        session_memory.progress["completion_percentage"] = computed_pct

    session_memory.progress["current_agent"] = current_agent
    session_memory.progress["depth_scores"] = computed_progress.get("depth_scores", {})
    session_memory.progress["status"] = computed_progress.get("status", "collecting")

    # ── Fix nested JSON in next_question ──────────────────────────
    conv_resp = parsed_json.get("next_question", "")
    if conv_resp and (conv_resp.strip().startswith("{") or "next_question" in conv_resp):
        try:
            inner = json.loads(conv_resp)
            if "next_question" in inner:
                parsed_json["next_question"] = inner["next_question"]
        except (json.JSONDecodeError, TypeError):
            pass

    assistant_text = parsed_json.get("next_question", "").strip()
    assistant_text = re.sub(r"\n{3,}", "\n\n", assistant_text)

    # ── Suggested skills — only in phase 6 (Generator) ──────────────────
    if current_agent == "JDGeneratorAgent" and not parsed_json.get("suggested_skills"):
        mem_skills = merged_insights.get("skills", [])
        mem_tools = merged_insights.get("tools", [])
        if isinstance(mem_skills, list) and isinstance(mem_tools, list):
            parsed_json["suggested_skills"] = sanitise_skills(list(set(mem_skills + mem_tools)))

    # ── Build history entry ───────────────────────────────────────────────
    assistant_history_entry = json.dumps({
        "next_question": assistant_text,
        "progress": session_memory.progress,
        "suggested_skills": parsed_json.get("suggested_skills", []),
    })
    session_memory.update_recent("user", user_message)
    session_memory.update_recent("assistant", assistant_history_entry)
    update_summary(session_memory)

    # ── Populate response with backend-computed values ────────────────────
    parsed_json["employee_role_insights"] = merged_insights
    parsed_json["progress"] = session_memory.progress
    parsed_json["current_agent"] = current_agent
    parsed_json["jd_structured_data"] = {}
    parsed_json["jd_text_format"] = ""

    reply_content = json.dumps(parsed_json, separators=(",", ":"))

    history.append({"role": "user", "content": user_message})
    history.append({"role": "assistant", "content": reply_content})

    return reply_content


async def handle_conversation(
    history: list, user_message: str, session_memory: SessionMemory
):
    """Interview turn handler — delegates to LangGraph multi-agent system."""
    turn_start_time = time.time()
    logger.info(f"[Interview v2] TURN STARTED — Agent: {session_memory.current_agent}")
    
    # Calculate token estimate for request (rough estimate)
    request_tokens = len(user_message) // 4  # Approx chars to tokens
    
    try:
        from app.agents.graph import run_interview_turn
        reply_content, history = await run_interview_turn(
            session_memory=session_memory,
            user_message=user_message,
            history=history,
        )
        
        # Parse response to get token count
        response_tokens = len(reply_content) // 4
        total_tokens = request_tokens + response_tokens
        
        # Calculate response time
        response_time_ms = (time.time() - turn_start_time) * 1000
        
        # Parse the response to extract data for logging
        try:
            parsed = json.loads(reply_content)
            llm_response = parsed.get("next_question", "")
            extracted_data = session_memory.insights if hasattr(session_memory, 'insights') else {}
        except:
            llm_response = reply_content
            extracted_data = {}
        
        # Get validation results
        from app.agents.validators import validate_insights_completeness
        insights_dict = session_memory.insights if hasattr(session_memory, 'insights') else {}
        if isinstance(insights_dict, dict):
            validation_results = validate_insights_completeness(insights_dict)
        else:
            validation_results = {}
        
        # Log the turn
        turn_index = len(session_memory.full_history) // 2 + 1
        InterviewLogger.log_turn(
            session_id=str(session_memory.id),
            turn_index=turn_index,
            agent_name=session_memory.current_agent,
            user_message=user_message,
            extracted_data=extracted_data,
            validation_results=validation_results,
            llm_response=llm_response,
            token_usage={
                "prompt_tokens": request_tokens,
                "completion_tokens": response_tokens,
                "total_tokens": total_tokens
            },
            response_time_ms=response_time_ms,
            success=True
        )
        
    except HTTPException:
        raise
    except Exception as e:
        error_str = str(e).lower()
        logger.error(f"Interview v2 error: {e}")
        traceback.print_exc()
        
        # Log failed turn
        turn_index = len(session_memory.full_history) // 2 + 1
        InterviewLogger.log_turn(
            session_id=str(session_memory.id),
            turn_index=turn_index,
            agent_name=session_memory.current_agent,
            user_message=user_message,
            extracted_data={},
            validation_results={},
            llm_response="",
            token_usage={"prompt_tokens": request_tokens, "completion_tokens": 0, "total_tokens": request_tokens},
            response_time_ms=response_time_ms,
            success=False,
            error=str(e)
        )
        
        if "rate limit" in error_str or "429" in error_str or "exhausted" in error_str:
            raise HTTPException(status_code=429, detail="Rate limit exceeded")
        # Fallback to error response
        reply_content = build_fallback_response(session_memory)
        history.append({"role": "user", "content": user_message})
        history.append({"role": "assistant", "content": reply_content})
    
    logger.info(f"[Interview v2] TURN COMPLETED — Agent now {session_memory.current_agent}")
    return reply_content, history


async def handle_conversation_stream(
    history: list, user_message: str, session_memory: SessionMemory
):
    """Streaming interview handler — delegates to LangGraph multi-agent system."""
    logger.info(f"[Interview v2 Stream] TURN STARTED — Agent: {session_memory.current_agent}")

    try:
        from app.agents.graph import run_interview_turn_stream
        async for chunk in run_interview_turn_stream(
            session_memory=session_memory,
            user_message=user_message,
        ):
            yield chunk

    except Exception as e:
        error_msg = str(e)
        logger.error(f"Stream v2 error: {error_msg}")
        traceback.print_exc()

        is_rate_limit = (
            "429" in error_msg
            or "quota" in error_msg.lower()
            or "resource_exhausted" in error_msg.lower()
        )

        try:
            fallback = json.loads(build_fallback_response(session_memory))
            payload = {"type": "error", "parsed": fallback}
            if is_rate_limit:
                payload["is_rate_limit"] = True
            yield f"data: {json.dumps(payload)}\n\n"
        except Exception:
            payload = {"type": "error", "message": error_msg}
            if is_rate_limit:
                payload["is_rate_limit"] = True
            yield f"data: {json.dumps(payload)}\n\n"

    logger.info(f"[Interview v2 Stream] TURN COMPLETED — Agent now {session_memory.current_agent}")
