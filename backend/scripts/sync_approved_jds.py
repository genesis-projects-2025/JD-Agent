import asyncio
import logging
from sqlalchemy.future import select
from app.core.database import AsyncSessionLocal
from app.models.jd_session_model import JDSession
from app.services.vector_service import index_approved_jd

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

async def sync_all_approved_jds():
    """Fetch all approved JDs from DB and index them into Pinecone with the new metadata schema."""
    print("\n🔄 Starting RAG Sync for all Approved JDs...")
    
    async with AsyncSessionLocal() as db:
        # Fetch only approved records
        stmt = select(JDSession).where(JDSession.status == "approved")
        result = await db.execute(stmt)
        approved_jds = result.scalars().all()
        
        if not approved_jds:
            print("ℹ️ No approved JDs found in the database to sync.")
            return

        print(f"📈 Found {len(approved_jds)} records to index.")
        
        for jd in approved_jds:
            try:
                print(f"🚀 Indexing: {jd.title} (ID: {jd.id})...")
                # Extract experience level for metadata filtering
                exp_text = str(jd.jd_structured.get("experience", "")).lower() if jd.jd_structured else ""
                exp_level = "Mid"
                if any(k in exp_text for k in ["junior", "0-2", "entry"]):
                    exp_level = "Junior"
                elif any(k in exp_text for k in ["senior", "lead", "sr.", "5+"]):
                    exp_level = "Senior"
                elif any(k in exp_text for k in ["principal", "architect", "staff", "10+"]):
                    exp_level = "Expert"

                await index_approved_jd(
                    jd_id=str(jd.id),
                    structured_data=jd.jd_structured or {},
                    department=jd.department or "General",
                    title_override=jd.title,
                    experience_level=exp_level
                )
            except Exception as e:
                logger.error(f"Failed to sync JD {jd.id}: {e}")

    print("\n✨ Sync Complete! All existing approved knowledge is now in Pinecone.")

if __name__ == "__main__":
    asyncio.run(sync_all_approved_jds())
