import asyncio
import logging
from sqlalchemy import text
from app.core.database import AsyncSessionLocal
from app.services.db_query_service import execute_safe_select, validate_sql_query, SQLQueryError
from app.services.admin_brain_agent_service import AdminBrainAgentService, search_brain_agent_knowledge

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

async def run_tests():
    print("🧪 --- Starting Integration Tests for Admin Brain Agent --- 🧪\n")
    
    # 1. SQL Injection / Security Verification
    print("🔒 1. Verifying SQL Security Rules...")
    
    safe_queries = [
        "SELECT id, name FROM employees LIMIT 3",
        "SELECT count(1) FROM organogram WHERE department = 'Quality Assurance'",
        "WITH qa_team AS (SELECT code FROM organogram WHERE department = 'Quality Assurance') SELECT * FROM qa_team"
    ]
    
    unsafe_queries = [
        "INSERT INTO employees (id, name) VALUES ('E9999', 'Hacker')",
        "SELECT * FROM employees; DROP TABLE employees;",
        "SELECT * FROM users", # unauthorized table
        "DELETE FROM organogram WHERE code = 'E111'"
    ]
    
    for q in safe_queries:
        try:
            validate_sql_query(q)
            print(f"  ✅ Safe query passed validation: '{q}'")
        except SQLQueryError as e:
            print(f"  ❌ Safe query FAILED validation: '{q}'. Error: {e}")
            
    for q in unsafe_queries:
        try:
            validate_sql_query(q)
            print(f"  ❌ Unsafe query PASSED validation (VULNERABILITY!): '{q}'")
        except SQLQueryError as e:
            print(f"  ✅ Unsafe query correctly BLOCKED: '{q}'. Reason: {e}")

    # 2. Vector Search Test
    print("\n🌲 2. Testing Pinecone Knowledge Search...")
    search_results = await search_brain_agent_knowledge("compliance audit targets", top_k=2)
    print(f"  Matches retrieved: {len(search_results)}")
    for r in search_results:
        print(f"    - {r[:100]}...")

    # 3. Agent Execution Test
    print("\n🧠 3. Testing Conversational Loop with AdminBrainAgentService...")
    async with AsyncSessionLocal() as db:
        test_queries = [
            "How many employees are in Quality Control? Answer with a number.",
            "List 2 employees reporting to Dr. Bhanu Prasad (DIR05) as a markdown table.",
            "What are the skills or tool requirements of a QC Analyst?"
        ]
        
        for idx, q in enumerate(test_queries):
            print(f"\n💬 Query {idx+1}: '{q}'")
            try:
                reply = ""
                async for event in AdminBrainAgentService.chat_stream(db, q, admin_user="admin_test_user"):
                    if event["type"] == "chunk":
                        reply += event["content"]
                    elif event["type"] == "status":
                        print(f"  [Status]: {event['content']}")
                print(f"🤖 Agent Response:\n{reply}\n")
            except Exception as e:
                print(f"❌ Agent execution failed: {e}")

if __name__ == "__main__":
    asyncio.run(run_tests())
