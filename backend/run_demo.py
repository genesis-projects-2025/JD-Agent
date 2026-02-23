import requests
import json
import uuid
import time

BASE_URL = "http://127.0.0.1:8000/jd"
EMPLOYEE_ID = f"test_user_{uuid.uuid4().hex[:6]}"

def run_simulation():
    print("="*60)
    print(f"🚀 STARTING END-TO-END JD GENERATION SIMULATION")
    print(f"   Employee ID: {EMPLOYEE_ID}")
    print("="*60)
    
    # 1. Init
    print("\n[1] Initializing new session...")
    res_init = requests.post(f"{BASE_URL}/init", json={"employee_id": EMPLOYEE_ID})
    session_id = res_init.json()["id"]
    print(f"    ✅ Session Initialized: {session_id}")
    
    # 2. Add full context to trigger early JD generation
    print("\n[2] Simulating employee interview responses...")
    full_history = []
    message = (
        "I am a Senior Software Engineer. I build highly scalable backend microservices using Python, "
        "FastAPI, and PostgreSQL. I deploy to AWS using Docker and Kubernetes. "
        "I report directly to the Director of Engineering and have 3 junior developers reporting to me. "
        "My daily activities include writing code, reviewing PRs, and designing system architecture. "
        "Performance is measured by latency, service uptime, and successful sprint deliveries."
    )
    
    print(f"    🗨️ Sending comprehensive role details to LLM...")
    res_chat = requests.post(f"{BASE_URL}/chat", json={
        "id": session_id,
        "message": message,
        "history": full_history
    })
    print(f"    ✅ Chat response received. Agent replied: {res_chat.json()['reply'][:50]}...")
    
    # 3. Generate JD
    print("\n[3] Triggering JD Generation (this simulates clicking 'Generate Enterprise JD')...")
    res_gen = requests.post(f"{BASE_URL}/generate", json={"id": session_id})
    gen_data = res_gen.json()
    
    jd_text = gen_data.get('jd_text', '')
    jd_structured = gen_data.get('jd_structured', {})
    
    print(f"    ✅ Generation Complete!")
    print(f"    - Structured JSON Keys Extracted: {list(jd_structured.keys())}")
    print(f"    - Markdown Text Length: {len(jd_text)} characters")
    
    print("\n------------------------------------------------------------")
    print("📜 PREVIEW OF THE GENERATED PROFESSIONAL JD (What the UI sees):")
    print("------------------------------------------------------------")
    print(jd_text[:800] + "\n\n... (truncated for brevity) ...")
    print("------------------------------------------------------------")
    
    # 4. Save JD
    print("\n[4] Simulating clicking 'Save JD to Database'...")
    res_save = requests.post(f"{BASE_URL}/save", json={
        "id": session_id,
        "jd_text": jd_text,
        "jd_structured": jd_structured,
        "employee_id": EMPLOYEE_ID
    })
    
    save_data = res_save.json()
    print(f"    ✅ JD Successfully saved to PostgreSQL! DB Status: {save_data['status']}")
    print(f"    - Assigned Record ID: {save_data.get('id')}")
    print(f"    - Title Extracted for DB: {save_data.get('title')}")
    
    # 5. Fetch to Validate
    print("\n[5] Fetching saved record from DB to verify formats...")
    res_get = requests.get(f"{BASE_URL}/{session_id}")
    fetched = res_get.json()
    
    db_jd_text = fetched.get('generated_jd', '')
    
    print(f"    ✅ Retrieved from DB successfully.")
    print(f"    - DB `generated_jd` length: {len(db_jd_text)}")
    if db_jd_text == jd_text:
        print("    🟢 SUCCESS: The Markdown JD Text was saved and retrieved identically.")
    else:
        print("    🔴 ERROR: JD Text mismatch between generation and DB save.")
        
    print("\n🎉 END-TO-END SIMULATION COMPLETE!")

if __name__ == "__main__":
    run_simulation()
