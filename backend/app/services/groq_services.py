from groq import Groq
from app.config import GROQ_API_KEY

client = Groq(api_key=GROQ_API_KEY)


def chat_with_groq(messages):

    response = client.chat.completions.create(
        model="qwen/qwen3-32b",
        messages=messages,
        temperature=0.2,
    )

    from app.utils.text_utils import strip_reasoning_tags
    return strip_reasoning_tags(response.choices[0].message.content)
