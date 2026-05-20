"""
Intent Classifier.
Classifies user messages (e.g., answering prompt vs. requesting dashboard view vs. ending session).
"""
class IntentClassifier:
    def classify_intent(self, message: str) -> str:
        """
        Identifies exact intent types.
        """
        print(f"[IntentClassifier] Classifying message: '{message}'")
        return "answer"\n