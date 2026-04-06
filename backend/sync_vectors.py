import asyncio
import logging
from sqlalchemy import text
from app.core.database import AsyncSessionLocal
from app.services.vector_service import index_approved_jd

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

async def sync_approved_jds():
    async with AsyncSessionLocal() as db:
        query = text("""
            SELECT id, title, department, jd_structured 
            FROM jd_sessions 
            WHERE status = 'approved'
        """)
        res = await db.execute(query)
        rows = res.mappings().all()
        
        if not rows:
            logger.info("No approved JDs found to sync.")
            return
            
        logger.info(f"Found {len(rows)} approved JDs. Starting sync to Pinecone...")
        
        for row in rows:
            logger.info(f"Indexing JD: {row.id} ({row.title})")
            try:
                # We call this directly (await) for the sync script
                await index_approved_jd(
                    jd_id=str(row.id),
                    structured_data=row.jd_structured or {},
                    department=row.department or "General",
                    title_override=row.title
                )
                logger.info(f"Successfully indexed {row.id}")
            except Exception as e:
                logger.error(f"Failed to index {row.id}: {e}")

if __name__ == "__main__":
    asyncio.run(sync_approved_jds())
