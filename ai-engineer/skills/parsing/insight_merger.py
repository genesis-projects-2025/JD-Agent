"""
Insight Merger.
Combines dynamic list entities while avoiding duplicate lines.
"""
class InsightMerger:
    def merge_lists(self, list_a: list, list_b: list) -> list:
        return list(set(list_a + list_b))\n