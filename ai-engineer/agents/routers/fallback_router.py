"""
Fallback Router.
Gracefully handles API errors, hallucinated prompts, or unclassifiable messages.
"""
class FallbackRouter:
    def handle_error(self, error: Exception) -> str:
        """
        Routes queries to safe fallbacks.
        """
        print(f"[Fallback] Handling error: {error}")
        return "I'm sorry, let's try clarifying your last comment."\n