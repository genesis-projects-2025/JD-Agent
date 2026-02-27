import { useState, useEffect, useRef } from "react";
import { Message } from "../types/message";
import {
  sendMessage as apiSendMessage,
  saveJD as apiSaveJD,
  fetchJD,
  generateJD as apiGenerateJD,
} from "../lib/api";
import { JDAgentResponse } from "../types/jd-agent";
import { getOrCreateEmployeeId } from "@/lib/auth";

export function useChat(onSaveSuccess?: () => void, autoInit: boolean = true) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [jd, setJd] = useState<string | null>(null);
  const [progress, setProgress] = useState<number>(0);
  const [status, setStatus] = useState<string>("collecting");
  const [structuredData, setStructuredData] = useState<any>(null);
  const [insights, setInsights] = useState<any>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isGeneratingJD, setIsGeneratingJD] = useState(false);
  const [isRateLimited, setIsRateLimited] = useState(false);
  const [retryTimer, setRetryTimer] = useState(0);
  const [lastMessageText, setLastMessageText] = useState<string | null>(null);
  // ✅ NEW: true once DB hydration is complete — page uses this to show skeleton
  const [hydrated, setHydrated] = useState(false);

  const initialized = useRef(false);

  // ── Rate limit countdown ────────────────────────────────────────────────────
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isRateLimited && retryTimer > 0) {
      interval = setInterval(() => setRetryTimer((prev) => prev - 1), 1000);
    }
    return () => clearInterval(interval);
  }, [isRateLimited, retryTimer]);

  // ── Parse + apply agent response ────────────────────────────────────────────
  const processResponse = (
    rawReply: string,
    updatedHistory: any[],
    append: boolean = true,
  ) => {
    let parsed: JDAgentResponse;
    try {
      parsed = JSON.parse(rawReply);
    } catch (e) {
      console.error("Failed to parse agent response:", e);
      return;
    }

    const jdStructured = parsed.jd_structured_data ?? null;
    const suggestedSkills =
      parsed.suggested_skills && Array.isArray(parsed.suggested_skills)
        ? parsed.suggested_skills
        : undefined;

    const newStatus = parsed.progress?.status ?? "collecting";

    setProgress(parsed.progress?.completion_percentage ?? 0);
    setStatus(newStatus);
    // Only update structuredData if we actually received something non-empty
    if (jdStructured && Object.keys(jdStructured).length > 0) {
      setStructuredData(jdStructured);
    }
    setInsights(parsed.employee_role_insights ?? null);

    if (append) {
      setMessages((prev) => [
        ...prev,
        {
          sender: "agent",
          text: parsed.conversation_response,
          skills: suggestedSkills,
          isSkillSelection: !!suggestedSkills && suggestedSkills.length > 0,
          isReadySelection: newStatus === "ready_for_generation",
        },
      ]);
    }

    setHistory(updatedHistory);

    // Only set JD from chat response if actually generated
    // (generation now happens via handleGenerateJD, not chat turns)
    if (newStatus === "jd_generated" || newStatus === "approved") {
      const finalJD = parsed.jd_text_format || parsed.conversation_response;
      if (finalJD) setJd(finalJD);
    }
  };

  // ── Init — resume existing session or start fresh ───────────────────────────
  useEffect(() => {
    if (!initialized.current && autoInit) {
      initialized.current = true;

      const initChat = async () => {
        try {
          const id = window.location.pathname.split("/").pop();
          if (!id) return;

          const existingData = await fetchJD(id).catch(() => null);

          if (existingData && existingData.conversation_history?.length > 0) {
            // ── Resume existing session ───────────────────────────────────────

            const dbHistory = existingData.conversation_history ?? [];

            // FIX: conversation_state can be null on fresh/stub sessions
            const convState = existingData.conversation_state ?? {};
            const dbProgress: number = convState.completion_percentage ?? 0;
            const dbStatus: string = convState.status ?? "collecting";

            // Reconstruct chat messages from stored history
            const reconstructedMessages: Message[] = dbHistory.map((h: any) => {
              if (h.role === "user") {
                return { sender: "employee" as const, text: h.content };
              }

              // Agent turns may be raw JSON strings or plain text
              let text = h.content;
              let skills: string[] | undefined;
              let isSkillSelection = false;
              let isReadySelection = false;

              try {
                const parsed = JSON.parse(h.content);
                // Never extract data dumps as conversation text
                text = parsed.conversation_response ?? h.content;
                skills = parsed.suggested_skills;
                isSkillSelection = !!skills && skills.length > 0;
                isReadySelection =
                  parsed.progress?.status === "ready_for_generation";
              } catch {
                // Plain text — use as-is
              }

              return {
                sender: "agent" as const,
                text,
                skills,
                isSkillSelection,
                isReadySelection,
              };
            });

            setMessages(reconstructedMessages);
            setHistory(dbHistory);
            setProgress(dbProgress);
            setStatus(dbStatus);
            let initialJd = existingData.generated_jd ?? null;
            if (initialJd) {
              try {
                const pj = JSON.parse(initialJd);
                if (pj.jd_text_format) initialJd = pj.jd_text_format;
              } catch (e) {}
            }
            setJd(initialJd);
            setStructuredData(existingData.jd_structured ?? null);

            // ✅ Mark hydration done — page can now render chat
            setHydrated(true);
          } else {
            // ── New session — send greeting to trigger first question ─────────
            const data = await apiSendMessage(
              "Hello! I'm ready to start the JD interview.",
              [],
              id,
            );
            processResponse(data.reply, data.history);

            // ✅ Mark hydration done for new sessions too
            setHydrated(true);
          }
        } catch (error) {
          console.error("Failed to initialize chat:", error);
          setHydrated(true); // ✅ unblock UI even on error
        }
      };

      initChat();
    }
  }, [autoInit]);

  // ── Send chat message ────────────────────────────────────────────────────────
  const sendMessage = async (text: string) => {
    if (isRateLimited && retryTimer > 0) return;

    setIsRateLimited(false);
    setLastMessageText(text);
    setIsGenerating(true);

    // Optimistic message — avoid duplicate if already added
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last?.sender === "employee" && last.text === text) return prev;
      return [...prev, { sender: "employee", text }];
    });

    try {
      const id = window.location.pathname.split("/").pop();
      const data = await apiSendMessage(text, history, id);
      processResponse(data.reply, data.history);
      setLastMessageText(null);
    } catch (error: any) {
      console.error("Error sending message:", error);

      const statusCode = error.status || error.response?.status;
      const isRateLimit =
        statusCode === 429 ||
        error.message?.toLowerCase().includes("rate limit");

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
    } finally {
      setIsGenerating(false);
    }
  };

  // ── Generate JD — explicit button, not keyword detection ────────────────────
  const handleGenerateJD = async () => {
    setIsGeneratingJD(true);
    try {
      const id = window.location.pathname.split("/").pop();
      if (!id) throw new Error("No session ID found");

      const data = await apiGenerateJD({ id });

      let finalJd = data.jd_text;
      if (finalJd) {
        try {
          const pj = JSON.parse(finalJd);
          if (pj.jd_text_format) finalJd = pj.jd_text_format;
        } catch (e) {}
      }

      // Fallback: If jd_text is empty, but we have structured data, construct a simple view
      // This guarantees the 'jd' element is truthy, and the "Save JD" view is unlocked.
      if (
        !finalJd &&
        data.jd_structured &&
        Object.keys(data.jd_structured).length > 0
      ) {
        finalJd = `# Job Description (Generated via Data)\n\n*Please edit using the 'Save JD' button for professional formatting.*\n\n${JSON.stringify(data.jd_structured, null, 2)}`;
      }

      setJd(finalJd || "Job Description Generation Failed. Please try again.");
      if (data.jd_structured && Object.keys(data.jd_structured).length > 0) {
        setStructuredData(data.jd_structured);
      }
      setStatus("jd_generated");


      setMessages((prev) => [
        ...prev,
        {
          sender: "agent",
          text: "Your Job Description has been generated! Review it below and click 'Save JD' when you're ready.",
          isReadySelection: false,
        },
      ]);
    } catch (error: any) {
      console.error("Failed to generate JD:", error);
      const detail = error.detail || error.message || "Please try again.";
      setMessages((prev) => [
        ...prev,
        {
          sender: "agent",
          text: `Failed to generate JD: ${detail}`,
        },
      ]);
    } finally {
      setIsGeneratingJD(false);
    }
  };

  // ── Save JD to database ──────────────────────────────────────────────────────
  const handleSaveJD = async (): Promise<boolean> => {
    if (!jd) return false;
    setIsSaving(true);
    try {
      const id = window.location.pathname.split("/").pop();
      if (!id) throw new Error("No session ID found");


      const eid = getOrCreateEmployeeId();
      await apiSaveJD({
        id,
        jd_text: jd,
        jd_structured: structuredData ?? {},
        employee_id: eid,
      });

      return true;
    } catch (error: any) {
      console.error("Failed to save JD:", error);
      const detail = error.detail || error.message || "Please try again.";
      alert(`Failed to save JD: ${detail}`);
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  const handleApproveJD = () => sendMessage("I approve this Job Description.");

  const handleRetry = () => {
    if (lastMessageText) sendMessage(lastMessageText);
  };

  return {
    messages,
    sendMessage,
    jd,
    isGenerating,
    isSaving,
    isGeneratingJD,
    handleGenerateJD,
    handleSaveJD,
    handleApproveJD,
    handleRetry,
    progress,
    status,
    structuredData,
    insights,
    isRateLimited,
    retryTimer,
    hydrated, // ✅ NEW — use this in the chat page to show a loading skeleton
  };
}
