import { useState } from "react";
import { Message } from "../types/message";
import { sendMessage as apiSendMessage, generateJD } from "../lib/api";

export function useChat() {
  const [messages, setMessages] = useState<Message[]>([
    {
      sender: "agent",
      text: "Hello! I am your JD Interview Assistant. To get started, what is your current job title and department?",
    },
  ]);
  const [history, setHistory] = useState<any[]>([
    {
      role: "assistant",
      content:
        "Hello! I am your JD Interview Assistant. To get started, what is your current job title and department?",
    },
  ]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [jd, setJd] = useState<string | null>(null);

  const sendMessage = async (text: string) => {
    // Add user message to UI
    setMessages((prev) => [...prev, { sender: "employee", text }]);

    try {
      const data = await apiSendMessage(text, history);
      const reply = data.reply;
      const updatedHistory = data.history;

      // Check for skill selection pattern
      const skillRegex = /\[SKILLS_TO_SELECT:\s*(.*?)\]/;
      const match = reply.match(skillRegex);

      let cleanReply = reply;
      let skills: string[] = [];
      if (match) {
        cleanReply = reply.replace(skillRegex, "").trim();
        skills = match[1]
          .split(",")
          .map((s: string) => s.trim())
          .filter((s: string) => s !== "");
      }

      setMessages((prev) => [
        ...prev,
        {
          sender: "agent",
          text: cleanReply,
          skills: skills.length > 0 ? skills : undefined,
          isSkillSelection: skills.length > 0,
        },
      ]);
      setHistory(updatedHistory);

      // Check if the agent says READY_FOR_JD
      if (reply.includes("READY_FOR_JD")) {
        setIsGenerating(true);
        const jdData = await generateJD(updatedHistory);
        setJd(jdData.jd);
        setIsGenerating(false);
      }
    } catch (error) {
      console.error("Error sending message:", error);
      setMessages((prev) => [
        ...prev,
        {
          sender: "agent",
          text: "I'm sorry, I'm having trouble connecting to my brain right now. Please try again.",
        },
      ]);
    }
  };

  return { messages, sendMessage, jd, isGenerating };
}
