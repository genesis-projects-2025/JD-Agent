"""
Long Term Memory.
Stores persistent context and profiles across employee workspaces.
"""
class LongTermMemory:
    async def persist_fact(self, user_id: str, fact: str):
        print(f"[LongTermMemory] Storing fact for {user_id}: {fact}")\n