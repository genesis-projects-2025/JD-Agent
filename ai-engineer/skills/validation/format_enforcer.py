"""
Format Enforcer.
Ensures outputs comply with text rules (e.g. lists, capitalization, word counts).
"""
class FormatEnforcer:
    def truncate_text(self, text: str, max_words: int) -> str:
        words = text.split()
        return " ".join(words[:max_words])\n