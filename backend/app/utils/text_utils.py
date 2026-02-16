import re

def strip_reasoning_tags(text: str) -> str:
    """
    Strips internal reasoning blocks (e.g., <think>...</think>) from the text.
    Also removes robotic prefixes like 'Q1:', 'Q2:', etc. if present at the start of lines.
    """
    if not text:
        return ""
    
    # Remove <think>...</think> blocks (including across newlines)
    text = re.sub(r'<think>.*?</think>', '', text, flags=re.DOTALL)
    
    # Remove Q1:, Q2:, etc. at the start of lines or start of string
    text = re.sub(r'(^|\n)Q\d+:\s*', r'\1', text)
    
    return text.strip()
