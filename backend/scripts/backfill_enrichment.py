"""
Backfill script to populate offline enrichment tables for all existing
approved Job Descriptions and confirmed KRA/KPI frameworks.
Runs concurrently with isolated database sessions to maximize speed.
"""

import asyncio
import logging
import sys
import os

# Add backend directory to python path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from sqlalchemy import select
from app.core.database import AsyncSessionLocal
from app.models.jd_session_model import JDSession
from app.services.enrichment_service import (
    run_task_automation_scoring,
    run_dependency_extraction,
    run_employee_summary,
    run_nightly_rollup_and_insights,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)


async def enrich_single_jd(jd_id, employee_id, title, semaphore):
    """Enriches a single JD record in an isolated session."""
    async with semaphore:
        logger.info(f"-> Starting enrichment for employee: {employee_id} (Role: {title})")
        async with AsyncSessionLocal() as db:
            try:
                # Fetch JDSession fresh in this thread's session
                res = await db.execute(select(JDSession).where(JDSession.id == jd_id))
                jd = res.scalars().first()
                if not jd:
                    logger.warning(f"JD {jd_id} not found in this session.")
                    return

                # 1. Run Task Automation Scoring
                await run_task_automation_scoring(db, jd)
                
                # 2. Run Dependency Extraction
                await run_dependency_extraction(db, jd)
                
                # 3. Run Employee Work Summary
                await run_employee_summary(db, employee_id)
                
                logger.info(f"✅ Completed enrichment for employee: {employee_id}")
            except Exception as e:
                logger.error(f"❌ Failed to enrich employee {employee_id} / JD {jd_id}: {e}")


async def backfill():
    # Kill the previously running task-194 first if it was triggered
    logger.info("Initializing concurrent backfill...")
    
    async with AsyncSessionLocal() as db:
        # Get all approved JDs
        jd_res = await db.execute(
            select(JDSession).where(JDSession.status == "approved")
        )
        jds = jd_res.scalars().all()
        logger.info(f"Found {len(jds)} approved JDs to enrich.")
        
        # Capture metadata for concurrent execution before session exits
        jd_metadata = [(jd.id, jd.employee_id, jd.title) for jd in jds]

    # Run concurrently with a semaphore of 5 parallel workers
    semaphore = asyncio.Semaphore(5)
    tasks = [
        enrich_single_jd(jd_id, emp_id, title, semaphore)
        for jd_id, emp_id, title in jd_metadata
    ]
    
    await asyncio.gather(*tasks)

    # Compute rollups and bottleneck insights once everything is populated
    async with AsyncSessionLocal() as db:
        logger.info("Computing final department rollup metrics and bottleneck insights...")
        res = await run_nightly_rollup_and_insights(db)
        logger.info(f"Rollup completed: {res}")

    logger.info("Backfill process finished successfully!")


if __name__ == "__main__":
    asyncio.run(backfill())
