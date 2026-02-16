from langchain_groq import ChatGroq
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_core.messages import HumanMessage, AIMessage, SystemMessage
from app.config import GROQ_API_KEY
from app.prompts.jd_prompts import SYSTEM_PROMPT, JD_GENERATION_PROMPT, VALIDATION_PROMPT

# Initialize LangChain Groq
llm = ChatGroq(
    groq_api_key=GROQ_API_KEY,
    model_name="qwen/qwen3-32b",
    temperature=0.2,
    # stop=["<think>", "</think>"],

)

def handle_conversation(history, user_message):
    """Handles the chat flow using LangChain and applies behavior rules."""
    
    # Construct messages for LangChain
    msgs = [SystemMessage(content=SYSTEM_PROMPT)]
    for m in history:
        if m["role"] == "user":
            msgs.append(HumanMessage(content=m["content"]))
        else:
            msgs.append(AIMessage(content=m["content"]))
    
    msgs.append(HumanMessage(content=user_message))
    
    # Get reply from LLM
    response = llm.invoke(msgs)
    from app.utils.text_utils import strip_reasoning_tags
    reply = strip_reasoning_tags(response.content)
    
    # Update history
    history.append({"role": "user", "content": user_message})
    history.append({"role": "assistant", "content": reply})
    
    return reply, history

def generate_jd(history):
    """Generates the final JD based on the conversation history."""
    conversation_text = "\n".join(
        [f"{m['role'].upper()}: {m['content']}" for m in history]
    )
    
    formatted_prompt = JD_GENERATION_PROMPT.format(conversation_history=conversation_text)
    
    response = llm.invoke([HumanMessage(content=formatted_prompt)])
    return response.content
