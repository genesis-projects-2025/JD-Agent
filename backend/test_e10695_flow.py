import asyncio
import os
import sys
from dotenv import load_dotenv

# Ensure the backend directory is in the path
sys.path.append(os.path.join(os.getcwd(), 'backend'))

load_dotenv()

from app.memory.session_memory import SessionMemory
from app.services.jd_service import handle_conversation

async def run_simulation():
    print("🚀 Starting Multi-Turn Simulation for Employee E10695")
    session = SessionMemory()
    session.employee_id = "E10695"
    history = []

    turns = [
        "Hi, I'm the Lead Developer. I manage the JD Agent project architecture.",
        "On a daily basis, I review PRs, architect new features in LangGraph, and coordinate with the product team on requirements.",
        "The most critical part is the multi-agent orchestration logic, because if that fails, the whole interview loops."
    ]

    for i, user_msg in enumerate(turns):
        print(f"\n--- 👤 TURN {i+1} USER ---")
        print(f"Message: {user_msg}")
        
        try:
            # handle_conversation(history, user_message, session_memory)
            response = await handle_conversation(history, user_msg, session)
            
            # The response is a tuple (json_string, new_history)
            json_str, new_history = response
            import json
            data = json.loads(json_str)
            
            history = new_history
            
            print(f"\n--- 🤖 TURN {i+1} AGENT ---")
            print(f"Agent: {data.get('current_agent')}")
            print(f"Response: {data.get('next_question')}")
            print(f"Progress: {data.get('progress', {}).get('completion_percentage')}%")
            
            # Verify example presence
            resp_text = data.get('next_question', '')
            if any(word in resp_text.lower() for word in ["example", "instance", "like"]):
                print("✅ Example detected in response.")
            else:
                print("⚠️ No explicit example detected in response text.")
                
        except Exception as e:
            print(f"❌ Error in Turn {i+1}: {e}")
            import traceback
            traceback.print_exc()
            break

    print("\n✅ Simulation Complete.")

if __name__ == "__main__":
    asyncio.run(run_simulation())
