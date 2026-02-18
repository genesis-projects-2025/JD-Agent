# app/services/jd_service.py
from fastapi import HTTPException
import json
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

def clean_json_string(raw: str) -> str:
    """Strip <think> blocks, markdown fences, and whitespace."""
    import re
    # Remove <think>...</think> blocks (multiline)
    cleaned = re.sub(r"<think>.*?</think>", "", raw, flags=re.DOTALL)
    # Remove unclosed <think> tags
    cleaned = re.sub(r"<think>.*", "", cleaned, flags=re.DOTALL)
    cleaned = cleaned.strip()
    # Strip markdown fences
    if cleaned.startswith("```json"):
        cleaned = cleaned[7:]
    elif cleaned.startswith("```"):
        cleaned = cleaned[3:]
    if cleaned.endswith("```"):
        cleaned = cleaned[:-3]
    return cleaned.strip()


def extract_json_from_text(text: str) -> str:
    """
    Last-resort extraction: find the first { and last } in the text
    and return everything between them. Handles cases where LLM outputs
    text before or after the JSON block.
    """
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
            merged_list = list(existing_val)
            for item in new_val:
                if item not in merged_list:
                    merged_list.append(item)
            result[key] = merged_list
        elif new_val is not None and new_val != {} and new_val != [] and new_val != "":
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
            conversation_response="I encountered an issue processing that. Could you please repeat your last message?",
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


def parse_llm_response(raw_content: str) -> dict:
    """
    Robust JSON parser — tries multiple strategies in order:
    1. Clean and parse directly
    2. Extract JSON block from surrounding text
    3. Raise exception if all fail
    """
    # Strategy 1: clean and parse directly
    cleaned = clean_json_string(raw_content)
    if cleaned:
        try:
            return json.loads(cleaned), cleaned
        except json.JSONDecodeError:
            pass

    # Strategy 2: extract JSON block from text (handles plain-text responses)
    extracted = extract_json_from_text(cleaned or raw_content)
    if extracted:
        try:
            return json.loads(extracted), extracted
        except json.JSONDecodeError:
            pass

    # Strategy 3: try raw content directly after stripping think tags
    import re
    no_think = re.sub(r"<think>.*?</think>", "", raw_content, flags=re.DOTALL)
    no_think = re.sub(r"<think>.*", "", no_think, flags=re.DOTALL).strip()
    extracted2 = extract_json_from_text(no_think)
    if extracted2:
        try:
            return json.loads(extracted2), extracted2
        except json.JSONDecodeError:
            pass

    raise ValueError(f"Could not extract valid JSON from LLM response. Raw: {raw_content[:200]}")


# ── JD Generator ───────────────────────────────────────────────────────────────

def generate_jd(session_memory: SessionMemory) -> dict:
    print("\n📝 STARTING DEDICATED JD GENERATION...")
    insights_dict = safe_to_dict(session_memory.insights)

    messages = [
        SystemMessage(content=JD_GENERATION_PROMPT),
        HumanMessage(content=(
            "Generate a complete Job Description using these employee role insights.\n"
            "Return ONLY valid JSON with jd_structured_data and jd_text_format fields.\n\n"
            f"{json.dumps(insights_dict, separators=(',', ':'))}"
        ))
    ]

    try:
        response = jd_llm.invoke(messages)
        raw = strip_reasoning_tags(response.content)
        parsed, _ = parse_llm_response(raw)
        print(f"   -> JD Generation Successful ✅ | Length: {len(parsed.get('jd_text_format', ''))}")
        return parsed
    except Exception as e:
        print(f"   -> JD Generation Failed: {e}")
        return {
            "jd_structured_data": {},
            "jd_text_format": "JD generation failed. Please try again."
        }


# ── Main Handler ───────────────────────────────────────────────────────────────

def handle_conversation(history: list, user_message: str, session_memory: SessionMemory):
    print("\n" + "=" * 50)
    print("🚀 STARTING NEW TURN")
    print("=" * 50)

    if user_message == "TEST_RATE_LIMIT":
        raise HTTPException(status_code=429, detail="Rate limit exceeded (Simulation)")

    # 1. Build context
    print("\n📋 BUILDING CONTEXT...")
    current_insights = safe_to_dict(session_memory.insights)
    print(f"   -> Current insights keys: {list(current_insights.keys())}")
    print(f"   -> Current insights data: {json.dumps(current_insights, indent=2)[:300]}")
    msgs = build_context(session_memory, user_message)

    # 2. Invoke LLM
    try:
        print("\n🤖 INVOKING INTERVIEW LLM...")
        response = interview_llm.invoke(msgs)
        raw_content = strip_reasoning_tags(response.content)
        print(f"   -> Raw Response Length: {len(raw_content)}")
        print(f"   -> Raw Preview: {raw_content[:150]}")
    except Exception as e:
        error_str = str(e).lower()
        print(f"❌ LLM ERROR: {e}")
        if "rate limit" in error_str or "429" in error_str or isinstance(e, groq.RateLimitError):
            raise HTTPException(status_code=429, detail="Rate limit exceeded")
        raise HTTPException(status_code=500, detail="Internal LLM Error")

    # 3. Parse response
    print("\n🧩 PARSING & UPDATING MEMORY...")
    reply_content: str

    try:
        parsed_json, cleaned_content = parse_llm_response(raw_content)
        print(f"   -> Cleaned Preview: {cleaned_content[:120]}...")

        validated = ChatResponse(**parsed_json)

        # Deep merge insights
        llm_insights = validated.employee_role_insights.model_dump()
        existing_insights = safe_to_dict(session_memory.insights)
        merged_insights = deep_merge(existing_insights, llm_insights)
        session_memory.insights = merged_insights

        # Update progress
        session_memory.progress = validated.progress.model_dump()
        current_status = validated.progress.status
        print(f"   -> Progress: {validated.progress.completion_percentage}% | Status: {current_status}")

        session_memory.update_recent("user", user_message)
        session_memory.update_recent("assistant", cleaned_content)
        update_summary(session_memory)

        # JD generation trigger
        jd_trigger_phrases = [
            "yes", "yes please", "generate", "generate jd", "generate the jd",
            "please generate", "go ahead", "sure", "proceed", "create jd",
            "create the jd", "make the jd", "yes generate", "do it", "ok", "okay"
        ]
        user_confirmed = any(phrase in user_message.lower() for phrase in jd_trigger_phrases)

        if current_status in ("ready_for_generation", "jd_generated") and user_confirmed:
            print("\n🎯 USER CONFIRMED JD GENERATION...")
            jd_result = generate_jd(session_memory)
            parsed_json["jd_structured_data"] = jd_result.get("jd_structured_data", {})
            parsed_json["jd_text_format"] = jd_result.get("jd_text_format", "")
            parsed_json["progress"]["status"] = "jd_generated"
            parsed_json["approval"]["approval_required"] = True
            parsed_json["approval"]["approval_status"] = "pending"
            parsed_json["conversation_response"] = (
                "Your Job Description has been generated based on our in-depth conversation. "
                "Please review it and let me know if you approve or would like any changes."
            )
            parsed_json["employee_role_insights"] = merged_insights
            session_memory.progress["status"] = "jd_generated"
        else:
            parsed_json["employee_role_insights"] = merged_insights

        reply_content = json.dumps(parsed_json, indent=2)
        print("   -> Turn completed successfully ✅")

    except Exception as e:
        print(f"⚠️ PROCESSING ERROR: {e}")
        import traceback
        traceback.print_exc()
        print(f"   -> RAW CONTENT:\n{raw_content[:500]}")
        reply_content = build_fallback_response(session_memory)

    history.append({"role": "user", "content": user_message})
    history.append({"role": "assistant", "content": reply_content})

    print("\n✅ TURN COMPLETED")
    print("=" * 50 + "\n")

    return reply_content, history