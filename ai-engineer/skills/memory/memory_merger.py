"""
Memory Merger.
Merges fresh inputs into existing memories non-destructively, resolving conflicts.
"""
class MemoryMerger:
    def merge(self, old_memory: dict, new_insight: dict) -> dict:
        merged = old_memory.copy()
        merged.update(new_insight)
        return merged\n