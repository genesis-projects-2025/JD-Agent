from langchain_core.messages import SystemMessage, HumanMessage, AIMessage
from app.prompts.jd_prompts import SYSTEM_PROMPT
import json


def build_context(history, user_message):

    messages = []

    # 🔹 Base System Prompt
    messages.append(SystemMessage(content=SYSTEM_PROMPT))

    # 🔹 Structured Role Insights
    if history.insights:
        messages.append(
            SystemMessage(
                content=f"EMPLOYEE ROLE INSIGHTS:\n{json.dumps(history.insights, indent=2)}"
            )
        )

    # 🔹 Progress Memory
    messages.append(
        SystemMessage(
            content=f"PROGRESS MEMORY:\n{json.dumps(history.progress, indent=2)}"
        )
    )

    # 🔹 Conversation Summary
    if history.summary:
        messages.append(
            SystemMessage(
                content=f"CONVERSATION SUMMARY:\n{history.summary}"
            )
        )

    # 🔹 Only Recent Messages
    for msg in history.recent_messages:
        if msg["role"] == "user":
            messages.append(HumanMessage(content=msg["content"]))
        else:
            messages.append(AIMessage(content=msg["content"]))

    # 🔹 Current User Message
    messages.append(HumanMessage(content=user_message))

    return messages
