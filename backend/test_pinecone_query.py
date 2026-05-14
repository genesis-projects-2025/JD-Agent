
import asyncio
import os
from dotenv import load_dotenv
from app.services.vector_service import query_advanced_context, get_index

load_dotenv()

async def test_pinecone():
    print("🔍 Testing Pinecone Connectivity...")
    try:
        index = get_index()
        stats = index.describe_index_stats()
        print(f"✅ Pinecone Connected. Stats: {stats}")
        
        print("\n🔎 Querying for 'Junior Software Developer' tools...")
        tools = await query_advanced_context("Junior Software Developer", "tools")
        print(f"Tools Result: {tools}")
        
        print("\n🔎 Querying for 'Junior Software Developer' skills...")
        skills = await query_advanced_context("Junior Software Developer", "skills")
        print(f"Skills Result: {skills}")
        
    except Exception as e:
        print(f"❌ Pinecone Error: {e}")

if __name__ == "__main__":
    asyncio.run(test_pinecone())
