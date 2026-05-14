
import asyncio
import os
import json
from dotenv import load_dotenv
from app.services.vector_service import query_advanced_context
from app.agents.semantic_cleaner import deduplicate_and_professionalize

load_dotenv()

async def simulate_auto_populate():
    print("🚀 Simulating Auto-Populate for 'Junior Software Developer'...")
    
    role_title = "Junior Software Developer"
    field = "tools"
    
    # 1. Simulate RAG Context
    rag_context = await query_advanced_context(role_title, field)
    print(f"\n📥 RAG Context found: {len(rag_context)} items")
    
    # 2. Simulate the AI extracting from RAG (simplified)
    # In reality, this goes to the LLM. Here we just take the RAG results.
    raw_items = []
    for ctx in rag_context:
        # Extract items from strings like "Role: ... Tools: Item1, Item2"
        if "Tools:" in ctx:
            tools_part = ctx.split("Tools:")[1].split(",")
            raw_items.extend([t.strip() for t in tools_part])
    
    print(f"\n🛠 Raw items extracted: {raw_items}")
    
    # 3. Clean and Professionalize with role context
    cleaned = await deduplicate_and_professionalize(raw_items, field, role_title=role_title)
    
    print(f"\n✨ Cleaned & Professionalized for '{role_title}':")
    print(json.dumps(cleaned, indent=2))

if __name__ == "__main__":
    asyncio.run(simulate_auto_populate())
