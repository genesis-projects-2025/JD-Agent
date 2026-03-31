import time
import subprocess
import requests
import sys
import json

BASE_URL = "http://localhost:8000/jd"

def start_server():
    print("Starting server...")
    proc = subprocess.Popen(["uvicorn", "app.main:app", "--port", "8000"], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    for _ in range(30):
        try:
            resp = requests.get(BASE_URL + "/")
            if resp.status_code == 200:
                print("Server is up!")
                return proc
        except:
            time.sleep(1)
    proc.terminate()
    print(proc.stderr.read().decode())
    sys.exit(1)

def run_simulation():
    print("\n--- 1. INIT INTERVIEW ---")
    payload = {
        "employee_id": "E10695",
        "employee_name": "Test Employee"
    }
    resp = requests.post(BASE_URL + "/init", json=payload)
    if resp.status_code != 200:
        return
    session_id = resp.json()["id"]

    history = []
    
    answers = [
        "My purpose is to develop backend software, giving value by creating stable APIs. I am a Backend Engineer in the Engineering department located in New York. I report to John Doe.", 
        # Explicit daily/weekly/monthly breakdown to satisfy TaskAgent
        "My tasks are: Daily I write python code and build APIs. Weekly I am optimizing database queries and reviewing PRs. Monthly I am managing server deployments and patching servers.", 
        "My top 2 priority tasks are writing python code and building APIs.", 
        "For writing python code, trigger is Jira ticket. Steps: write code, test it, push. output is merged PR. For building APIs, trigger is feature request. Steps: design, code, deploy. output is endpoint.", 
        "I use Python, FastAPI, PostgreSQL, AWS, Docker.", 
        # Add the "Full Stack Development" keyword clearly to trigger skill expansion
        "My main area of expertise is Full Stack Development.", 
        "I have a Bachelor's in Computer Science and AWS Certified Developer certification." 
    ]

    for i, answer in enumerate(answers):
        print(f"\n--- 2.{i+1} CHAT ---")
        chat_payload = {
            "id": session_id,
            "message": answer,
            "history": history
        }
        res = requests.post(BASE_URL + "/chat", json=chat_payload)
        chat_data = res.json()
        
        reply_json = json.loads(chat_data["reply"])
        print("\nAgent Question:", reply_json.get("next_question"))
        print("\nCurrent Agent:", reply_json.get("current_agent"))
        print("\n--- Extracted Skills Array ---")
        print(reply_json.get("employee_role_insights", {}).get("skills", []))
        print("\nProgress Score:", reply_json.get("progress", {}).get("completion_percentage"), "%")
        
        history = chat_data["history"]

    print("\n--- 3. GENERATE JD ---")
    gen_payload = {"id": session_id}
    gen_res = requests.post(BASE_URL + "/generate", json=gen_payload)
    if gen_res.status_code == 200:
        print("JD Generated Successfully!")
    else:
        print(gen_res.text)

if __name__ == "__main__":
    proc = start_server()
    try:
        run_simulation()
    finally:
        proc.terminate()
