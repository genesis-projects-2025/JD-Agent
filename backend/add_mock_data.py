import asyncio
import logging
from app.services.vector_service import index_approved_jd

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

async def add_test_jd():
    test_id = "test-jd-888"
    test_data = {
        "job_title": "Senior Solutions Architect",
        "role_summary": "Designing high-scale distributed systems and cloud infrastructure.",
        "key_responsibilities": [
            "Lead architectural reviews",
            "Optimize database performance",
            "Mentor junior engineers"
        ],
        "tools_and_technologies": ["AWS", "Kubernetes", "Terraform", "Python", "FastAPI"],
        "required_skills": ["System Design", "Cloud Strategy", "DevOps"],
        "additional_details": {
            "education": "Master's in CS",
            "experience": "10+ years"
        }
    }
    
    logger.info(f"Adding test JD: {test_id}...")
    await index_approved_jd(
        jd_id=test_id,
        structured_data=test_data,
        department="Engineering"
    )
    logger.info("Done! Run inspect_pinecone.py to see the new vectors.")

if __name__ == "__main__":
    asyncio.run(add_test_jd())
