import asyncio
import os
from dotenv import load_dotenv
from app.services.vector_service import index_approved_jd

load_dotenv()

async def main():
    mock_jd = {
        "job_title": "Senior Python Developer",
        "role_summary": "Expert in building scalable backend services and AI integrations.",
        "key_responsibilities": [
            "Designing and maintaining the JD-Agent backend architecture",
            "Implementing RAG systems with Pinecone and Gemini",
            "Optimizing database queries and Redis caching"
        ],
        "tools_and_technologies": ["Python", "FastAPI", "Pinecone", "Gemini", "Redis", "Docker"],
        "required_skills": ["Asynchronous Programming", "Vector Databases", "LLM Orchestration"],
        "additional_details": {
            "education": "B.Tech in Computer Science",
            "experience": "5+ years"
        }
    }
    
    print("🚀 Triggering indexing for mock JD...")
    await index_approved_jd("mock-jd-999", mock_jd, "Engineering")
    print("✅ Indexing complete.")

if __name__ == "__main__":
    asyncio.run(main())
