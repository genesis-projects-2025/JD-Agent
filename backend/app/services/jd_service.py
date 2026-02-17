from fastapi import HTTPException
import json
from langchain_groq import ChatGroq
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_core.messages import HumanMessage, AIMessage, SystemMessage
from app.config import GROQ_API_KEY
from app.prompts.jd_prompts import SYSTEM_PROMPT
from app.schemas.jd_schema import ChatResponse
from app.utils.text_utils import strip_reasoning_tags
import groq
from app.services.context_builder import build_context
from app.memory.session_memory import SessionMemory

# Initialize LangChain Groq
llm = ChatGroq(
    groq_api_key=GROQ_API_KEY,
    model_name="qwen/qwen3-32b",
    temperature=0.2,
)
session_memory = SessionMemory()
def update_summary(memory):

    if len(memory.recent_messages) >= 4:
        memory.summary = "Conversation collected employee role responsibilities, tools, and workflow insights."


def handle_conversation(history, user_message):
    print("\n" + "="*50)
    print("🚀 STARTING NEW TURN")
    print("="*50)
    
    # Simulation for Testing Rate Limit UI
    if user_message == "TEST_RATE_LIMIT":
        print("⚠️ Simulating Rate Limit 429")
        raise HTTPException(status_code=429, detail="Rate limit exceeded (Simulation)")

    # 1. Build Context
    print("\n🔍 BUILDING CONTEXT...")
    msgs = build_context(session_memory, user_message)
    
    # Debug Log: Configured Context
    print(f"   -> System Prompt Included: Yes")
    print(f"   -> Insights Count: {len(session_memory.insights)}")
    print(f"   -> Recent Messages: {len(session_memory.recent_messages)}")
    print(f"   -> Current User Message: {user_message}")

    try:
        # 2. Invoke LLM
        print("\n🤖 INVOKING LLM...")
        response = llm.invoke(msgs)
        content = strip_reasoning_tags(response.content)
        print("   -> LLM Response Received (Raw Length):", len(content))

    except Exception as e:
        error_str = str(e).lower()
        print(f"❌ LLM INVOCATION ERROR: {e}")

        if "rate limit" in error_str or "429" in error_str or isinstance(e, groq.RateLimitError):
            raise HTTPException(status_code=429, detail="Rate limit exceeded")

        raise HTTPException(status_code=500, detail="Internal LLM Error")

    # 3. Process Response
    try:
        print("\n🧩 PARSING & UPDATING MEMORY...")
        cleaned_content = content.strip()

        if cleaned_content.startswith("```json"):
            cleaned_content = cleaned_content[7:]

        if cleaned_content.endswith("```"):
            cleaned_content = cleaned_content[:-3]

        cleaned_content = cleaned_content.strip()
        
        # Debug: Print first 100 chars of cleaned content
        print(f"   -> Cleaned Content Preview: {cleaned_content[:100]}...")

        parsed_json = json.loads(cleaned_content)
        validated_response = ChatResponse(**parsed_json)

        # Update Memory
        session_memory.insights.update(
            parsed_json.get("employee_role_insights", {})
        )
        print(f"   -> Updated Insights: {list(parsed_json.get('employee_role_insights', {}).keys())}")

        session_memory.progress = parsed_json.get(
            "progress",
            session_memory.progress
        )
        print(f"   -> Updated Progress: {session_memory.progress.get('completion_percentage', 0)}%")

        session_memory.update_recent("user", user_message)
        session_memory.update_recent("assistant", cleaned_content)

        update_summary(session_memory)
        print("   -> Memory Updated Successfully")

        reply_content = cleaned_content

    except Exception as e:
        print(f"⚠️ JSON PARSING ERROR: {e}")
        print("   -> Triggering Fallback Response")
        print(f"   -> FAILED CONTENT DUMP: {content}")

        fallback = ChatResponse(
            conversation_response="I encountered an error generating the response. Retrying...",
            progress=session_memory.progress,
            employee_role_insights=session_memory.insights,
            jd_structured_data={},
            jd_text_format="",
            analytics={"questions_asked": 0, "questions_answered": 0, "insights_collected": 0, "estimated_completion_time_minutes": 0},
            approval={"approval_required": False, "approval_status": "pending"}
        )
        reply_content = fallback.model_dump_json()

    # Update history (For UI consistency)
    history.append({"role": "user", "content": user_message})
    history.append({"role": "assistant", "content": reply_content})
    
    print("\n✅ TURN COMPLETED")
    print("="*50 + "\n")
    
    return reply_content, history

# Removed generate_jd as it is now integrated into the main flow via the "status" field.

