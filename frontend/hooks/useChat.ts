import { useState, useEffect, useRef } from "react";
import { Message } from "../types/message";
import { sendMessage as apiSendMessage, generateJD } from "../lib/api";

export function useChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [jd, setJd] = useState<string | null>(null);
  const initialized = useRef(false);

  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true;
      // Fetch initial dynamic greeting from agent
      const initChat = async () => {
        try {
          const data = await apiSendMessage(
            "Hello! I'm ready to start the JD interview.",
            [],
          );
          const reply = data.reply;
          const updatedHistory = data.history;

          setMessages([{ sender: "agent", text: reply }]);
          setHistory(updatedHistory);
        } catch (error) {
          console.error("Failed to initialize chat:", error);
        }
      };
      initChat();
    }
  }, []);

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
        const cleanReadyReply = reply.replace("READY_FOR_JD", "").trim();

        // Update the last message text if it contained ONLY READY_FOR_JD
        if (cleanReadyReply) {
          setMessages((prev) => {
            const newMsgs = [...prev];
            newMsgs[newMsgs.length - 1].text = cleanReadyReply;
            return [
              ...newMsgs,
              {
                sender: "agent",
                text: "I have gathered enough information to create your Job Description. Would you like to generate it now or continue refining it?",
                isReadySelection: true,
              },
            ];
          });
        } else {
          setMessages((prev) => [
            ...prev,
            {
              sender: "agent",
              text: "I have gathered enough information to create your Job Description. Would you like to generate it now or continue refining it?",
              isReadySelection: true,
            },
          ]);
        }
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

  const handleGenerateJD = async () => {
    setIsGenerating(true);
    try {
      const jdData = await generateJD(history);
      setJd(jdData.jd);
    } catch (error) {
      console.error("Error generating JD:", error);
    } finally {
      setIsGenerating(false);
    }
  };

  return { messages, sendMessage, jd, isGenerating, handleGenerateJD };
}
