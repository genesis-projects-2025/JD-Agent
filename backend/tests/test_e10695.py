import asyncio
import sys
import os
import json
from dotenv import load_dotenv
import httpx

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"), override=True)
sys.path.append(os.path.join(os.path.dirname(__file__), ".."))

from app.main import app

employee_id = "E10695"

async def run_test():
    print(f"--- Starting E2E Interview Test for Employee: {employee_id} ---")
    
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        # 1. Init Session
        print("\n[1] Initializing Session...")
        res = await client.post("/jd/init", json={"employee_id": employee_id, "employee_name": "Test Employee E10695"})
        
        if res.status_code != 200:
            print(f"Failed to init session: {res.text}")
            return
            
        data = res.json()
        session_id = data["id"]
        print(f"Session Created: {session_id}")
        
        history = []
        
        async def chat(msg_user):
            nonlocal history
            print(f"\nUser: {msg_user}")
            payload = {
                "id": session_id,
                "message": msg_user,
                "history": history
            }
            resp = await client.post("/jd/chat", json=payload)
            
            if resp.status_code != 200:
                print(f"Chat failed: {resp.text}")
                return {}
                
            result = resp.json()
            raw_reply = result.get("reply", "{}")
            try:
                parsed_reply = json.loads(raw_reply)
            except:
                parsed_reply = {"raw": raw_reply}
                
            print(f"Agent ({parsed_reply.get('current_agent')}): {parsed_reply.get('next_question')}")
            
            history.append({"role": "user", "content": msg_user})
            history.append({"role": "assistant", "content": raw_reply})
            
            print(f"Progress: {parsed_reply.get('progress', {}).get('completion_percentage')}% | Missing: {parsed_reply.get('missing_fields', [])}")
            return parsed_reply

        # 2. Simulate Chat Flow
        reply1 = await chat("Hi, I am the lead machine learning engineer here. My main purpose is to build scalable AI models for our core diagnostic products.")
        reply2 = await chat("Every day I write ML code, review pull requests, deploy models to staging, run A/B tests on the models, and attend daily standup meetings.")
        reply3 = await chat("My most important tasks are writing ML code and deploying the models.")
        reply4 = await chat("For writing ML code, the trigger is a Jira ticket being assigned. The steps are downloading data, training the model, and saving the weights. The output is a .pt file.")
        reply5 = await chat("I use Python, PyTorch, Docker, Jira, and GitHub.")
        reply6 = await chat("I need extremely strong deep learning skills, NLP experience, and MLOps knowledge.")
        reply7 = await chat("A master's degree in computer science is required.")
        
        print("\n\n--- Final Extracted Data Storage ---")
        final_data = reply7.get("employee_role_insights", {})
        print(json.dumps(final_data, indent=2))
        
        print("\n✅ Test Completed Successfully.")

if __name__ == "__main__":
    asyncio.run(run_test())
