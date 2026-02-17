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

# Initialize LangChain Groq
llm = ChatGroq(
    groq_api_key=GROQ_API_KEY,
    model_name="qwen/qwen3-32b",
    temperature=0.2,
)

def handle_conversation(history, user_message):
    """Handles the chat flow using logic to enforce strict JSON output."""
    
    # Simulation for Testing Rate Limit UI
    if user_message == "TEST_RATE_LIMIT":
        raise HTTPException(status_code=429, detail="Rate limit exceeded (Simulation)")

    # Construct messages for LangChain
    # We prepend the System Prompt which helps enforce JSON output
    msgs = [SystemMessage(content=SYSTEM_PROMPT)]
    for m in history:
        if m["role"] == "user":
            msgs.append(HumanMessage(content=m["content"]))
        else:
            # We need to make sure previous assistant messages are also treated correctly.
            # If they were JSON strings, we pass them as is.
            msgs.append(AIMessage(content=m["content"]))
    
    msgs.append(HumanMessage(content=user_message))
    
    try:
        # Get reply from LLM
        response = llm.invoke(msgs)
        content = strip_reasoning_tags(response.content)
    except Exception as e:
        # Check if it's a rate limit error from Groq
        error_str = str(e).lower()
        if "rate limit" in error_str or "429" in error_str or isinstance(e, groq.RateLimitError):
            raise HTTPException(status_code=429, detail="Rate limit exceeded")
        
        print(f"Error invoking LLM: {e}")
        # For other LLM errors, we might want to return the fallback or raise 500.
        # Let's use the fallback logic below by setting content to None or raising to be caught by the outer/next try?
        # Actually, let's just return a generic error if it fails badly, 
        # BUT we must respect the 429 if it was a rate limit.
        raise HTTPException(status_code=500, detail="Internal LLM Error")

    # Attempt to parse JSON to validation against Schema
    try:
        # cleanup markdown code blocks if present (despite prompt instructions)
        cleaned_content = content.strip()
        if cleaned_content.startswith("```json"):
            cleaned_content = cleaned_content[7:]
        if cleaned_content.endswith("```"):
            cleaned_content = cleaned_content[:-3]
        cleaned_content = cleaned_content.strip()

        parsed_json = json.loads(cleaned_content)
        # Validate with Pydantic
        validated_response = ChatResponse(**parsed_json)
        
        # We store the *raw JSON string* in history to keep context for the LLM
        # The LLM is good at reading its own JSON output in history.
        reply_content = cleaned_content
        
    except (json.JSONDecodeError, Exception) as e:
        print(f"Error parsing JSON from LLM: {e}")
        # Fallback or Error handling. 
        # For now, we will try to construct a valid error response or just pass the raw text if it failed totally.
        # But per requirements we MUST return strict JSON.
        # Let's construct a fallback object.
        fallback = ChatResponse(
            conversation_response="I encountered an error processing your request. Could you please repeat that?",
            progress={"completion_percentage": 0, "missing_insight_areas": [], "status": "collecting"},
            employee_role_insights={},
            jd_structured_data={},
            jd_text_format="",
            analytics={"questions_asked": 0, "questions_answered": 0, "insights_collected": 0, "estimated_completion_time_minutes": 0},
            approval={"approval_required": False, "approval_status": "pending"}
        )
        reply_content = fallback.model_dump_json()

    # Update history
    history.append({"role": "user", "content": user_message})
    history.append({"role": "assistant", "content": reply_content})
    
    return reply_content, history

# Removed generate_jd as it is now integrated into the main flow via the "status" field.

