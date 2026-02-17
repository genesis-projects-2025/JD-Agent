import { useState, useEffect, useRef } from "react";
import { Message } from "../types/message";
import { sendMessage as apiSendMessage, generateJD } from "../lib/api";
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

  // Rate Limit State
  const [isRateLimited, setIsRateLimited] = useState(false);
  const [retryTimer, setRetryTimer] = useState(0);
  const [lastMessageText, setLastMessageText] = useState<string | null>(null);

  const initialized = useRef(false);

  // Timer Countdown Logic
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isRateLimited && retryTimer > 0) {
      interval = setInterval(() => {
        setRetryTimer((prev) => prev - 1);
      }, 1000);
    } else if (retryTimer === 0 && isRateLimited) {
      // Timer finished, waiting for user action
    }
    return () => clearInterval(interval);
  }, [isRateLimited, retryTimer]);

  const processResponse = (rawReply: string, updatedHistory: any[]) => {
    let parsed: JDAgentResponse;
    try {
      parsed = JSON.parse(rawReply);
    } catch (e) {
      console.error("Failed to parse agent response:", e);
      // Fallback if parsing fails - usually shouldn't happen with strict JSON enforcement
      setMessages((prev) => [
        ...prev,
        {
          sender: "agent",
          text:
            rawReply ||
            "I apologize, but I encountered an error. Please try again.",
        },
      ]);
      setHistory(updatedHistory);
      return;
    }

    // Update States
    setProgress(parsed.progress.completion_percentage);
    setStatus(parsed.progress.status);
    setStructuredData(parsed.jd_structured_data);
    setInsights(parsed.employee_role_insights);

    // Update Messages
    setMessages((prev) => [
      ...prev,
      {
        sender: "agent",
        text: parsed.conversation_response,
        // Optional: We can still pass skills if we want the UI to show chips,
        // but the new JSON has them in structured_data.
        // For backward compatibility with UI if it uses chips:
        skills:
          parsed.jd_structured_data.required_skills?.length > 0
            ? parsed.jd_structured_data.required_skills
            : undefined,
      },
    ]);
    setHistory(updatedHistory);

    // Handle JD Generation / Completion
    if (
      parsed.progress.status === "jd_generated" ||
      parsed.progress.status === "approved"
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
    // Client-side simulation for UI testing
    if (text === "TEST_UI_LIMIT") {
      setMessages((prev) => [...prev, { sender: "employee", text }]);
      setIsRateLimited(true);
      setRetryTimer(40);
      return;
    }

    // If rate limited and timer is active, prevent sending unless it's a retry
    if (isRateLimited && retryTimer > 0) {
      return;
    }

    // Clear rate limit state if we are retrying
    setIsRateLimited(false);
    setLastMessageText(text);

    // Add user message to UI only if it's not a retry (avoid dupes)
    setMessages((prev) => {
      // Avoid duplicate if retrying the exact same message and it was the last one
      const lastMsg = prev[prev.length - 1];
      if (lastMsg && lastMsg.sender === "employee" && lastMsg.text === text) {
        return prev;
      }
      return [...prev, { sender: "employee", text }];
    });

    try {
      const data = await apiSendMessage(text, history);
      processResponse(data.reply, data.history);
      // Success, clear last message tracking
      setLastMessageText(null);
    } catch (error: any) {
      console.error("Error sending message:", error);
      console.error("Error Response:", error.response);

      // Check for Rate Limit (429) - Robust Check
      const status = error.response?.status || error.status;
      const msg = error.message || "";
      const isRateLimit =
        status === 429 ||
        msg.includes("429") ||
        msg.toLowerCase().includes("rate limit");

      if (isRateLimit) {
        setIsRateLimited(true);
        setRetryTimer(40); // 40 seconds timer

        setMessages((prev) => [
          ...prev,
          {
            sender: "agent",
            text: "I'm receiving too many requests right now (Rate Limit Reached). Please wait a moment.",
            isRateLimitError: true,
          },
        ]);
      } else {
        setMessages((prev) => [
          ...prev,
          {
            sender: "agent",
            text: "I'm sorry, I'm having trouble connecting to my brain right now. Please try again.",
          },
        ]);
      }
    }
  };

  const handleGenerateJD = async () => {
    // This function might be deprecated if the agent auto-generates based on conversation.
    // But if there is a "Generate" button, it can send a message to trigger it.
    sendMessage("Yes, please generate the JD now.");
  };

  // New function to handle Approval
  const handleApproveJD = async () => {
    sendMessage("I approve this Job Description.");
  };

  const handleRetry = () => {
    if (lastMessageText) {
      sendMessage(lastMessageText);
    }
  };

  return {
    messages,
    sendMessage,
    jd,
    isGenerating,
    handleGenerateJD,
    progress,
    status,
    handleApproveJD,
    isRateLimited,
    retryTimer,
    handleRetry,
  };
}
