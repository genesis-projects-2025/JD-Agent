import asyncio
from dotenv import load_dotenv
load_dotenv()
from app.memory.session_memory import SessionMemory
from app.services.jd_service import handle_conversation

async def test_interview():
    print("Testing Employee E10695...")
    session = SessionMemory()
    session.employee_id = "E10695"
    
    # Simulate a user message
    print("\n--- Sending Message 1 ---")
    
    try:
        # History must be a list
        history = []
        response = await handle_conversation(history, "I am the Lead Developer for the JD Agent project. I oversee architecture and implementation.", session)
        print("\n--- AGENT RESPONSE ---")
        print(response)
    except Exception as e:
        print(f"Error: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(test_interview())
