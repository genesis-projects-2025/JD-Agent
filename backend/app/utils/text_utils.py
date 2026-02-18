# app/utils/text_utils.py
import re


def strip_reasoning_tags(content: str) -> str:
    """
    Remove <think>...</think> reasoning blocks that qwen3 models output
    before the actual JSON response. Handles multiline blocks.
    """
    if not content:
        return content

    # Remove <think>...</think> blocks (including multiline)
    cleaned = re.sub(r"<think>.*?</think>", "", content, flags=re.DOTALL)

    # Also handle unclosed <think> tags — remove everything from <think> to end
    cleaned = re.sub(r"<think>.*", "", cleaned, flags=re.DOTALL)

    return cleaned.strip()