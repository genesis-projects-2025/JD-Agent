import { useState, useEffect, useRef } from "react";
import { Message } from "../types/message";
import { sendMessage as apiSendMessage, saveJD as apiSaveJD } from "../lib/api";
import { JDAgentResponse } from "../types/jd-agent";

export function useChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [jd, setJd] = useState<string | null>(null);
  const [progress, setProgress] = useState<number>(0);
  const [status, setStatus] = useState<string>("collecting");
  const [structuredData, setStructuredData] = useState<any>(null);
  const [insights, setInsights] = useState<any>(null);
  const [isSaving, setIsSaving] = useState(false);

  const [isRateLimited, setIsRateLimited] = useState(false);
  const [retryTimer, setRetryTimer] = useState(0);
  const [lastMessageText, setLastMessageText] = useState<string | null>(null);

  const initialized = useRef(false);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isRateLimited && retryTimer > 0) {
      interval = setInterval(() => {
        setRetryTimer((prev) => prev - 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isRateLimited, retryTimer]);

  const processResponse = (rawReply: string, updatedHistory: any[]) => {
    let parsed: JDAgentResponse;

    try {
      parsed = JSON.parse(rawReply);
    } catch (e) {
      console.error("Failed to parse agent response:", e);
      setMessages((prev) => [
        ...prev,
        {
          sender: "agent",
          text: "I encountered an issue. Please try again.",
        },
      ]);
      setHistory(updatedHistory);
      return;
    }

    // ✅ Safely read jd_structured_data — it may be {} during collection phase
    const jdStructured = parsed.jd_structured_data;
    const requiredSkills =
      jdStructured &&
      typeof jdStructured === "object" &&
      Array.isArray(jdStructured.required_skills) &&
      jdStructured.required_skills.length > 0
        ? jdStructured.required_skills
        : undefined;

    setProgress(parsed.progress?.completion_percentage ?? 0);
    setStatus(parsed.progress?.status ?? "collecting");
    setStructuredData(jdStructured ?? null);
    setInsights(parsed.employee_role_insights ?? null);

    setMessages((prev) => [
      ...prev,
      {
        sender: "agent",
        text: parsed.conversation_response,
        skills: requiredSkills,
      },
    ]);

    setHistory(updatedHistory);

    // Trigger JD view when generated
    if (
      parsed.progress?.status === "jd_generated" ||
      parsed.progress?.status === "approved"
    ) {
      if (parsed.jd_text_format) {
        setJd(parsed.jd_text_format);
      }
    }
  };

  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true;
      const initChat = async () => {
        try {
          const data = await apiSendMessage(
            "Hello! I'm ready to start the JD interview.",
            [],
          );
          processResponse(data.reply, data.history);
        } catch (error) {
          console.error("Failed to initialize chat:", error);
        }
      };
      initChat();
    }
  }, []);

  const sendMessage = async (text: string) => {
    if (text === "TEST_UI_LIMIT") {
      setMessages((prev) => [...prev, { sender: "employee", text }]);
      setIsRateLimited(true);
      setRetryTimer(40);
      return;
    }

    if (isRateLimited && retryTimer > 0) return;

    setIsRateLimited(false);
    setLastMessageText(text);

    setMessages((prev) => {
      const lastMsg = prev[prev.length - 1];
      if (lastMsg && lastMsg.sender === "employee" && lastMsg.text === text) {
        return prev;
      }
      return [...prev, { sender: "employee", text }];
    });

    try {
      const id = window.location.pathname.split("/").pop();
      const data = await apiSendMessage(text, history, id);
      processResponse(data.reply, data.history);
      setLastMessageText(null);
    } catch (error: any) {
      console.error("Error sending message:", error);

      const statusCode = error.response?.status || error.status;
      const msg = error.message || "";
      const isRateLimit =
        statusCode === 429 ||
        msg.includes("429") ||
        msg.toLowerCase().includes("rate limit");

      if (isRateLimit) {
        setIsRateLimited(true);
        setRetryTimer(40);
        setMessages((prev) => [
          ...prev,
          {
            sender: "agent",
            text: "Rate limit reached. Please wait a moment before continuing.",
            isRateLimitError: true,
          },
        ]);
      } else {
        setMessages((prev) => [
          ...prev,
          {
            sender: "agent",
            text: "I'm having trouble connecting. Please try again.",
          },
        ]);
      }
    }
  };

  const handleSaveJD = async () => {
    if (!jd || !structuredData) return;
    setIsSaving(true);
    try {
      const id = window.location.pathname.split("/").pop();
      if (!id) throw new Error("No session ID found");
      await apiSaveJD({ id, jd_text: jd, jd_structured: structuredData });
      alert("JD saved successfully!");
    } catch (error) {
      console.error("Failed to save JD:", error);
      alert("Failed to save JD. Please try again.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleApproveJD = async () => {
    sendMessage("I approve this Job Description.");
  };

  const handleRetry = () => {
    if (lastMessageText) sendMessage(lastMessageText);
  };

  return {
    messages,
    sendMessage,
    jd,
    isGenerating,
    isSaving,
    handleSaveJD,
    progress,
    status,
    structuredData,
    handleApproveJD,
    isRateLimited,
    retryTimer,
    handleRetry,
  };
}
