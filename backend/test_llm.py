import asyncio
from app.agents.interview import _interview_llm_with_tools, build_interview_messages
from langchain_core.messages import HumanMessage, SystemMessage
from dotenv import load_dotenv
load_dotenv()

async def test_llm():
    insights = {
        "identity_context": {"employee_name": "Test User"}
    }
    user_message = "I manage the HR team. We hire people, do payroll, resolve disputes, and run employee engagement programs."
    
    msgs = build_interview_messages(
        agent_name="TaskAgent",
        insights=insights,
        recent_messages=[],
        user_message=user_message,
        progress={"missing_insight_areas": ["Tasks"]}
    )
    
    response = await _interview_llm_with_tools.ainvoke(msgs)
    print("Content:", response.content)
    print("Tool calls:", response.tool_calls)

if __name__ == "__main__":
    asyncio.run(test_llm())
