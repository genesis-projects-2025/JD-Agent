import { useState, useEffect, useRef } from "react";
import { Message } from "../types/message";
import {
  sendMessage as apiSendMessage,
  sendMessageStream as apiSendMessageStream,
  saveJD as apiSaveJD,
  fetchJD,
  generateJD as apiGenerateJD,
  confirmSkills as apiConfirmSkills,
  confirmTools as apiConfirmTools,
  confirmPriorityTasks as apiConfirmPriorityTasks,
} from "../lib/api";
import { JDAgentResponse } from "../types/jd-agent";
import { getOrCreateEmployeeId } from "@/lib/auth";

export function useChat(onSaveSuccess?: () => void, autoInit: boolean = true) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const historyRef = useRef<any[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [jd, setJd] = useState<string | null>(null);
  const [progress, setProgress] = useState<number>(0);
  const [status, setStatus] = useState<string>("collecting");
  const [structuredData, setStructuredData] = useState<any>(null);
  const [insights, setInsights] = useState<any>(null);
  const [currentAgent, setCurrentAgent] = useState<string>("BasicInfoAgent");
  const [depthScores, setDepthScores] = useState<Record<string, number>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [isGeneratingJD, setIsGeneratingJD] = useState(false);
  const [isRateLimited, setIsRateLimited] = useState(false);
  const [retryTimer, setRetryTimer] = useState(0);
  const [lastMessageText, setLastMessageText] = useState<string | null>(null);
  // ✅ NEW: true once DB hydration is complete — page uses this to show skeleton
  const [hydrated, setHydrated] = useState(false);

  const initialized = useRef(false);
  const updateHistory = (newHistory: any[]) => {
     historyRef.current = newHistory;
     setHistory(newHistory);
  };
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

    const suggestedTools =
      parsed.suggested_tools && Array.isArray(parsed.suggested_tools)
        ? parsed.suggested_tools
        : undefined;

    const taskList =
      parsed.task_list && Array.isArray(parsed.task_list) && parsed.task_list.length > 0
        ? parsed.task_list
        : undefined;

    const newStatus = parsed.progress?.status ?? "collecting";
    const agent = parsed.current_agent || parsed.progress?.current_agent || "BasicInfoAgent";
    const scores = parsed.progress?.depth_scores || {};

    const newProgress = parsed.progress?.completion_percentage ?? 0;
    setProgress((prev) => Math.max(prev, newProgress));
    setStatus(newStatus);
    setCurrentAgent(agent);
    setDepthScores(scores);
    
    if (jdStructured && Object.keys(jdStructured).length > 0) {
      setStructuredData(jdStructured);
    }
    setInsights(parsed.employee_role_insights ?? null);

    if (append) {
      setMessages((prev) => [
        ...prev,
        {
          sender: "agent",
          text: parsed.next_question,
          skills: suggestedSkills,
          tools: suggestedTools,
          tasks: taskList,
          isSkillSelection:
            agent === "SkillsAgent" &&
            !!suggestedSkills &&
            suggestedSkills.length > 0,
          isToolSelection:
            agent === "ToolsAgent" &&
            !!suggestedTools &&
            suggestedTools.length > 0,
          isPrioritySelection:
            (agent === "WorkflowIdentifierAgent" || (agent === "DeepDiveAgent" && !!taskList && taskList.length > 0)) &&
            !!taskList &&
            taskList.length > 0,
          isReadySelection: newStatus === "ready_for_generation",
          currentAgent: agent,
        },
      ]);
    } else {
      setMessages((prev) => {
        const newMessages = [...prev];
        const lastIdx = newMessages.length - 1;
        if (lastIdx >= 0 && newMessages[lastIdx].sender === "agent") {
          newMessages[lastIdx] = {
            ...newMessages[lastIdx],
            text: parsed.next_question,
            skills: suggestedSkills,
            tools: suggestedTools,
            tasks: taskList,
            isStreaming: false,
            isSkillSelection:
              agent === "SkillsAgent" &&
              !!suggestedSkills &&
              suggestedSkills.length > 0,
            isToolSelection:
              agent === "ToolsAgent" &&
              !!suggestedTools &&
              suggestedTools.length > 0,
            isPrioritySelection:
              (agent === "WorkflowIdentifierAgent" || (agent === "DeepDiveAgent" && !!taskList && taskList.length > 0)) &&
              !!taskList &&
              taskList.length > 0,
            isReadySelection: newStatus === "ready_for_generation",
            currentAgent: agent,
          };
        }
        return newMessages;
      });
    }

    // Only update history if caller passed a real array (non-streaming path)
    // Streaming path passes [] and handles history itself via updateHistory
    if (updatedHistory.length > 0) {
      updateHistory(updatedHistory);  // ← use helper, updates both ref and state
    }

    if (newStatus === "jd_generated" || newStatus === "approved") {
      const finalJD = parsed.jd_text_format || parsed.next_question;
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
            const dbAgent: string = convState.current_agent || existingData.current_agent || "BasicInfoAgent";
            const dbScores: Record<string, number> = convState.depth_scores || {};

            // Reconstruct chat messages from stored history
            const reconstructedMessages: Message[] = dbHistory.map((h: any) => {
              if (h.role === "user") {
                return { sender: "employee" as const, text: h.content };
              }

              // Agent turns may be raw JSON strings or plain text
              let text = h.content;
              let skills: string[] | undefined;
              let tools: string[] | undefined;
              let isSkillSelection = false;
              let isToolSelection = false;
              let isPrioritySelection = false;
              let isReadySelection = false;
              let msgAgent = "BasicInfoAgent";
              let taskList: any[] | undefined = undefined;

              try {
                const parsed = JSON.parse(h.content);
                // Never extract data dumps as conversation text
                text = parsed.next_question ?? h.content;
                skills = parsed.suggested_skills;
                tools = parsed.suggested_tools;
                taskList = parsed.task_list;

                const dbAgent = parsed.current_agent || parsed.progress?.current_agent || "BasicInfoAgent";
                const dbStatus = parsed.progress?.status ?? "collecting";

                isSkillSelection =
                  dbAgent === "SkillsAgent" &&
                  !!skills &&
                  skills.length > 0;
                isToolSelection =
                  dbAgent === "ToolsAgent" &&
                  !!tools &&
                  tools.length > 0;
                isPrioritySelection = 
                  dbAgent === "WorkflowIdentifierAgent" && 
                  !!taskList && 
                  taskList.length > 0;
                isReadySelection =
                  dbStatus === "ready_for_generation";
                msgAgent = dbAgent;
              } catch {
                // Plain text — use as-is
              }

              return {
                sender: "agent" as const,
                text,
                skills,
                tools,
                tasks: taskList,
                isSkillSelection,
                isToolSelection,
                isPrioritySelection,
                isReadySelection,
                currentAgent: msgAgent,
              };
            });

            setMessages(reconstructedMessages);
            updateHistory(dbHistory);
            setProgress(dbProgress);
            setStatus(dbStatus);
            setCurrentAgent(dbAgent);
            setDepthScores(dbScores);
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

    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last?.sender === "employee" && last.text === text) return prev;
      return [...prev, { sender: "employee", text }];
    });

    try {
      const id = window.location.pathname.split("/").pop();

      setMessages((prev) => [
        ...prev,
        { sender: "agent", text: "", isStreaming: true, currentAgent: currentAgent },
      ]);

      await apiSendMessageStream(
        text,
        historyRef.current,   // ← use ref, always the latest value at call time
        id,
        (chunk) => {
          setMessages((prev) => {
            const newMessages = [...prev];
            const lastIdx = newMessages.length - 1;
            if (lastIdx >= 0 && newMessages[lastIdx].sender === "agent") {
              newMessages[lastIdx] = {
                ...newMessages[lastIdx],
                text: chunk,
                isStreaming: true,
                currentAgent: currentAgent,
              };
            }
            return newMessages;
          });
        },
        (parsedData) => {
          const rawReply = JSON.stringify(parsedData);

          // Build history from the REF — always fresh even after a 30s stream
          const newHistory = [
            ...historyRef.current,   // ← ref, not stale closure
            { role: "user", content: text },
            { role: "assistant", content: rawReply },
          ];

          // Update ref + state together before processResponse reads it
          updateHistory(newHistory);

          // Pass empty array so processResponse doesn't call updateHistory again
          processResponse(rawReply, [], false);
          setLastMessageText(null);
        },
        (error: any) => {
          setMessages((prev) => {
            const newMessages = [...prev];
            const lastIdx = newMessages.length - 1;
            if (
              lastIdx >= 0 &&
              newMessages[lastIdx].sender === "agent" &&
              !newMessages[lastIdx].text
            ) {
              return prev.slice(0, -1); // remove empty streaming bubble on error
            }
            return newMessages;
          });
          throw error;
        }
      );
    } catch (error: any) {
      console.error("Error sending message:", error);

      const statusCode = error.status || error.response?.status;
      const isRateLimit =
        statusCode === 429 ||
        error.isRateLimit ||
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
            currentAgent: currentAgent,
          },
        ]);
      } else {
        setMessages((prev) => [
          ...prev,
          {
            sender: "agent",
            text: "I'm having trouble connecting. Please try again.",
            currentAgent: currentAgent,
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
          currentAgent: "JDGeneratorAgent", // Explicitly set as generator here
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
          currentAgent: currentAgent,
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

  const confirmPriorityTasksAction = async (priorityTasks: string[]) => {
    const id = window.location.pathname.split("/").pop();
    if (!id) return;

    await apiConfirmPriorityTasks(id, priorityTasks);

    // Clear priority selection visually
    setMessages((prev) => {
      const newMessages = [...prev];
      for (let i = newMessages.length - 1; i >= 0; i--) {
        if (newMessages[i].sender === "agent" && newMessages[i].isPrioritySelection) {
          newMessages[i] = {
            ...newMessages[i],
            isPrioritySelection: false,
            text: newMessages[i].text + "\n\n✅ Priority tasks confirmed.",
          };
          break;
        }
      }
      return newMessages;
    });

    // Advance interview to DeepDive phase
    // Small timeout ensures setMessages above is processed and API state is synced
    setTimeout(() => {
      sendMessage("The priority tasks are confirmed. Let's start the deep dive.");
    }, 500);
  };

  const confirmSkillsAction = async (skills: string[]) => {
    const id = window.location.pathname.split("/").pop();
    if (!id) return;
    
    await apiConfirmSkills(id, skills);
    
    setMessages((prev) => {
      const newMessages = [...prev];
      // Find the last assistant message with skill selection
      for (let i = newMessages.length - 1; i >= 0; i--) {
        if (newMessages[i].sender === "agent" && newMessages[i].isSkillSelection) {
          newMessages[i] = {
            ...newMessages[i],
            isSkillSelection: false,
            text: newMessages[i].text + "\n\n✅ Skills confirmed.",
            skills: skills // Update with finalized selection
          };
          break;
        }
      }
      return newMessages;
    });
    
    // Explicitly notify the agent to move to the next phase (Qualifications)
    await sendMessage("I have confirmed the skills. Please proceed.");
  };

  const confirmToolsAction = async (tools: string[]) => {
    const id = window.location.pathname.split("/").pop();
    if (!id) return;
    
    await apiConfirmTools(id, tools);
    
    setMessages((prev) => {
      const newMessages = [...prev];
      // Find the last assistant message with tool selection
      for (let i = newMessages.length - 1; i >= 0; i--) {
        if (newMessages[i].sender === "agent" && newMessages[i].isToolSelection) {
          newMessages[i] = {
            ...newMessages[i],
            isToolSelection: false,
            text: newMessages[i].text + "\n\n✅ Tools confirmed.",
            tools: tools
          };
          break;
        }
      }
      return newMessages;
    });

    // Explicitly notify the agent to move to the next phase (Skills)
    await sendMessage("I have confirmed the technical infrastructure. Please proceed.");
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
    isGeneratingJD,
    handleGenerateJD,
    handleSaveJD,
    handleApproveJD,
    handleRetry,
    progress,
    status,
    structuredData,
    insights,
    currentAgent,
    depthScores,
    isRateLimited,
    retryTimer,
    hydrated,
    updateJd: setJd,
    updateStructuredData: setStructuredData,
    confirmSkillsAction,
    confirmToolsAction,
    confirmPriorityTasksAction,
  };
}
