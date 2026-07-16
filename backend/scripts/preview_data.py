import asyncio
import os
import sys
import json

sys.path.append("/Users/manideekshith/Developer/JD-Agent/backend")

from sqlalchemy import text
from app.core.database import AsyncSessionLocal

async def main():
    async with AsyncSessionLocal() as db:
        print("=== TASK AUTOMATION SCORES PREVIEW ===")
        res_scores = await db.execute(text("SELECT employee_id, department, task_text, automation_score, suggested_tooling FROM task_automation_scores LIMIT 2"))
        for r in res_scores.all():
            print(f"Emp: {r.employee_id} | Dept: {r.department} | Score: {r.automation_score}")
            print(f"Task: {r.task_text}")
            print(f"Tools: {r.suggested_tooling}")
            print("-" * 50)

        print("\n=== EMPLOYEE SUMMARY PREVIEW ===")
        res_summary = await db.execute(text("SELECT employee_id, summary_text, top_tools FROM employee_work_summary LIMIT 2"))
        for r in res_summary.all():
            print(f"Emp: {r.employee_id}")
            print(f"Summary: {r.summary_text}")
            print(f"Tools: {r.top_tools}")
            print("-" * 50)

        print("\n=== DEPARTMENT DEPENDENCIES PREVIEW ===")
        res_deps = await db.execute(text("SELECT from_department, to_department, dependency_type, description, confidence FROM department_dependencies LIMIT 2"))
        for r in res_deps.all():
            print(f"From: {r.from_department} -> To: {r.to_department} ({r.dependency_type})")
            print(f"Desc: {r.description} | Confidence: {r.confidence}")
            print("-" * 50)

if __name__ == "__main__":
    asyncio.run(main())
