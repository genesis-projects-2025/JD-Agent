#!/usr/bin/env python3
"""
Saniya Brain v2.0 — Detailed Interview Simulation

Runs a full interview for E10695, logging EVERY detail:
  - Messages sent to LLM
  - Tool calls made
  - Data extracted per turn
  - Insights state after each turn
  - Agent transitions
  - Progress changes
"""

import requests
import json
import sys
import time
from datetime import datetime

BASE_URL = "http://localhost:8000/jd"

# ANSI colors for terminal
C_HEADER = "\033[95m"
C_BLUE = "\033[94m"
C_GREEN = "\033[92m"
C_YELLOW = "\033[93m"
C_RED = "\033[91m"
C_CYAN = "\033[96m"
C_BOLD = "\033[1m"
C_END = "\033[0m"

REPORT = []  # Accumulate report lines


def log(msg, color=""):
    line = f"{color}{msg}{C_END}" if color else msg
    print(line)
    # Strip ANSI for report
    clean = msg
    REPORT.append(clean)


def log_section(title):
    log(f"\n{'='*80}", C_BOLD)
    log(f"  {title}", C_BOLD)
    log(f"{'='*80}", C_BOLD)


def log_subsection(title):
    log(f"\n{'─'*60}", C_CYAN)
    log(f"  {title}", C_CYAN)
    log(f"{'─'*60}", C_CYAN)


def pretty_json(obj, indent=2):
    return json.dumps(obj, indent=indent, default=str, ensure_ascii=False)


def run_simulation():
    session_id = None
    history = []

    # ── Employee answers (simulating a Backend Engineer) ──
    answers = [
        # Turn 1: Basic info + purpose
        "I am a Senior Backend Engineer in the Engineering department. My main purpose is to design, develop, and maintain scalable backend services and APIs that power Pulse Pharma's digital platforms, ensuring high availability and data integrity for our pharmaceutical operations.",

        # Turn 2: Daily tasks
        "On a typical day, I start by reviewing overnight alerts from our monitoring dashboards. Then I check Jira for my sprint tasks. I write Python code using FastAPI to build new API endpoints. I also write and run unit tests. After lunch, I usually do code reviews for my team members' pull requests. I spend about an hour on database query optimization for our PostgreSQL databases. Near end of day I update my Jira tickets and attend a standup.",

        # Turn 3: Weekly/monthly tasks
        "Weekly, I lead our backend architecture review meeting where we discuss system design decisions. I also do capacity planning for our AWS infrastructure. Monthly, I handle production deployments using our CI/CD pipeline, write technical documentation for new services, and mentor two junior developers through pair programming sessions.",

        # Turn 4: Priority tasks
        "My top priorities are: 1) API Development - this takes the most time and has highest impact, 2) Database optimization - critical for performance, 3) Code reviews - essential for code quality, 4) Production deployments - high business impact.",

        # Turn 5: Workflow for API Development
        "For API Development: It starts when a product manager creates a Jira ticket with requirements. First I design the API schema and endpoints in a design doc. Then I create a feature branch in Git. I write the FastAPI route handlers with Pydantic models for validation. I write unit tests using pytest. I create a PR and get it reviewed. After approval, I merge to main and it auto-deploys to staging. After QA signs off, I promote to production. The output is a deployed, documented API endpoint.",

        # Turn 6: Workflow for DB optimization
        "For Database optimization: The trigger is usually slow query alerts from our Datadog monitoring or when response times exceed our SLA thresholds. I analyze the slow queries using PostgreSQL EXPLAIN ANALYZE. Then I check index usage and table statistics. I write optimized queries or add indexes. I test on a staging replica. Then I deploy the changes during a maintenance window. The output is improved query performance, typically 50-80% faster.",

        # Turn 7: Tools and technologies
        "I use Python, FastAPI, PostgreSQL, Redis for caching, Docker for containerization, AWS (EC2, RDS, S3, Lambda), Git and GitHub for version control, Jira for project management, Datadog for monitoring, Terraform for infrastructure as code, and Postman for API testing. We also use Confluence for documentation.",

        # Turn 8: Skills
        "My key technical skills are REST API design, Python backend development, SQL and database design, microservices architecture, Docker and containerization, AWS cloud services, CI/CD pipeline management, and system design. I'm also experienced in performance optimization and load testing.",

        # Turn 9: Qualifications
        "For this role you'd need a Bachelor's degree in Computer Science or related field. An AWS Solutions Architect certification is preferred. Minimum 5 years of experience in backend development.",
    ]

    # ═══════════════════════════════════════════════════════════════════════════
    # STEP 1: INIT SESSION
    # ═══════════════════════════════════════════════════════════════════════════
    log_section("STEP 1: INITIALIZE SESSION")

    init_payload = {
        "employee_id": "E10695",
        "employee_name": "Test Backend Engineer"
    }
    log(f"\nPOST {BASE_URL}/init", C_YELLOW)
    log(f"Payload: {pretty_json(init_payload)}")

    try:
        resp = requests.post(f"{BASE_URL}/init", json=init_payload, timeout=15)
    except Exception as e:
        log(f"❌ Connection failed: {e}", C_RED)
        log(f"   Make sure the backend is running: uvicorn app.main:app --reload", C_RED)
        sys.exit(1)

    if resp.status_code != 200:
        log(f"❌ Init failed: {resp.status_code} — {resp.text}", C_RED)
        sys.exit(1)

    init_data = resp.json()
    session_id = init_data["id"]
    log(f"\n✅ Session created", C_GREEN)
    log(f"   Session ID: {session_id}")
    log(f"   Employee:   E10695")
    log(f"   Status:     {init_data.get('status', 'unknown')}")

    # ═══════════════════════════════════════════════════════════════════════════
    # STEP 2: INTERVIEW TURNS
    # ═══════════════════════════════════════════════════════════════════════════

    prev_agent = None
    prev_progress = 0

    for turn_idx, answer in enumerate(answers, 1):
        log_section(f"TURN {turn_idx} / {len(answers)}")

        # ── What we're sending ──
        log_subsection("USER MESSAGE")
        log(f"  \"{answer[:120]}{'...' if len(answer) > 120 else ''}\"")

        chat_payload = {
            "id": session_id,
            "message": answer,
            "history": history,
        }

        log_subsection("REQUEST TO BACKEND")
        log(f"  POST {BASE_URL}/chat")
        log(f"  Session:  {session_id}")
        log(f"  History:  {len(history)} messages")

        start_time = time.time()
        try:
            res = requests.post(f"{BASE_URL}/chat", json=chat_payload, timeout=120)
        except requests.Timeout:
            log(f"  ❌ Request timed out after 120s", C_RED)
            break
        except Exception as e:
            log(f"  ❌ Request failed: {e}", C_RED)
            break

        elapsed = time.time() - start_time

        if res.status_code != 200:
            log(f"  ❌ HTTP {res.status_code}: {res.text[:500]}", C_RED)
            break

        chat_data = res.json()
        log(f"  ✅ Response received in {elapsed:.2f}s", C_GREEN)

        # ── Parse the reply ──
        reply_raw = chat_data.get("reply", "")
        try:
            reply_json = json.loads(reply_raw)
        except json.JSONDecodeError:
            log(f"  ⚠️ Reply is not JSON — raw text response", C_YELLOW)
            reply_json = {"next_question": reply_raw}

        history = chat_data.get("history", history)

        # ── Agent Info ──
        log_subsection("AGENT STATE")
        current_agent = reply_json.get("current_agent", "unknown")
        progress = reply_json.get("progress", {})
        completion = progress.get("completion_percentage", 0)
        depth_scores = progress.get("depth_scores", {})
        status = progress.get("status", "unknown")

        agent_changed = current_agent != prev_agent
        progress_delta = completion - prev_progress

        log(f"  Active Agent:  {current_agent}" + (f"  ← CHANGED from {prev_agent}" if agent_changed and prev_agent else ""), C_GREEN if agent_changed else "")
        log(f"  Progress:      {completion:.0f}% (+{progress_delta:.0f}%)", C_GREEN if progress_delta > 0 else "")
        log(f"  Status:        {status}")
        if depth_scores:
            log(f"  Depth Scores:  {pretty_json(depth_scores)}")

        prev_agent = current_agent
        prev_progress = completion

        # ── Next Question ──
        log_subsection("AGENT RESPONSE (Next Question)")
        next_q = reply_json.get("next_question", "")
        log(f"  \"{next_q[:200]}{'...' if len(next_q) > 200 else ''}\"", C_BLUE)

        # ── Extracted Insights ──
        log_subsection("INSIGHTS STATE (after this turn)")
        insights = reply_json.get("employee_role_insights", {})

        # Show each insight category
        categories = [
            ("purpose", "Purpose"),
            ("basic_info", "Basic Info"),
            ("identity_context", "Identity Context"),
            ("tasks", "Tasks"),
            ("priority_tasks", "Priority Tasks"),
            ("workflows", "Workflows"),
            ("tools", "Tools"),
            ("technologies", "Technologies"),
            ("skills", "Skills"),
            ("qualifications", "Qualifications"),
        ]

        for key, label in categories:
            value = insights.get(key)
            if value is None or value == "" or value == [] or value == {}:
                continue

            if isinstance(value, list):
                log(f"  {label}: ({len(value)} items)")
                for i, item in enumerate(value[:5]):  # Show max 5
                    if isinstance(item, dict):
                        desc = item.get("description", str(item))
                        freq = item.get("frequency", "")
                        log(f"    [{i+1}] {desc[:80]} ({freq})")
                    else:
                        log(f"    [{i+1}] {str(item)[:80]}")
                if len(value) > 5:
                    log(f"    ... and {len(value)-5} more")
            elif isinstance(value, dict):
                log(f"  {label}: {pretty_json(value)}")
            elif isinstance(value, str):
                log(f"  {label}: \"{value[:100]}{'...' if len(value) > 100 else ''}\"")

        # ── Suggested Skills ──
        suggested = reply_json.get("suggested_skills", [])
        if suggested:
            log(f"\n  Suggested Skills Panel: {suggested}")

        # ── Analytics ──
        analytics = reply_json.get("analytics", {})
        if analytics:
            log_subsection("ANALYTICS")
            log(f"  Questions Asked:    {analytics.get('questions_asked', 0)}")
            log(f"  Questions Answered: {analytics.get('questions_answered', 0)}")
            log(f"  Insights Collected: {analytics.get('insights_collected', 0)}")
            log(f"  Est. Time Left:     {analytics.get('estimated_completion_time_minutes', 0)} min")

        # ── Latency ──
        log(f"\n  ⏱ Turn latency: {elapsed:.2f}s")

        # Pause between turns to avoid rate limits
        if turn_idx < len(answers):
            log(f"\n  Waiting 2s before next turn...", C_YELLOW)
            time.sleep(2)

    # ═══════════════════════════════════════════════════════════════════════════
    # STEP 3: GENERATE JD
    # ═══════════════════════════════════════════════════════════════════════════
    log_section("STEP 3: GENERATE JD")

    gen_payload = {"id": session_id}
    log(f"\nPOST {BASE_URL}/generate")

    start_time = time.time()
    try:
        gen_res = requests.post(f"{BASE_URL}/generate", json=gen_payload, timeout=120)
    except Exception as e:
        log(f"❌ JD Generation failed: {e}", C_RED)
        return

    elapsed = time.time() - start_time

    if gen_res.status_code == 200:
        log(f"✅ JD Generated Successfully in {elapsed:.2f}s", C_GREEN)
        gen_data = gen_res.json()
        jd_text = gen_data.get("jd_text", "")
        if jd_text:
            log_subsection("GENERATED JD (first 500 chars)")
            log(jd_text[:500])
    else:
        log(f"❌ JD Generation failed: {gen_res.status_code} — {gen_res.text[:300]}", C_RED)

    # ═══════════════════════════════════════════════════════════════════════════
    # SUMMARY
    # ═══════════════════════════════════════════════════════════════════════════
    log_section("SIMULATION SUMMARY")
    log(f"  Session ID:     {session_id}")
    log(f"  Total Turns:    {len(answers)}")
    log(f"  Final Agent:    {prev_agent}")
    log(f"  Final Progress: {prev_progress:.0f}%")

    # Save report to file
    report_path = "scripts/simulation_report.txt"
    with open(report_path, "w") as f:
        f.write("\n".join(REPORT))
    log(f"\n  📄 Full report saved to: {report_path}", C_GREEN)


if __name__ == "__main__":
    log(f"\n{C_BOLD}Saniya Brain v2.0 — Interview Simulation{C_END}")
    log(f"Started at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    log(f"Target: Employee E10695 (Backend Engineer)")
    run_simulation()
