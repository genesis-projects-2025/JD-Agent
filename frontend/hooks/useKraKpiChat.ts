import { useState, useEffect, useRef, useCallback } from "react";
import {
  sendKraKpiMessageStream,
  fetchKRAKPI,
  generateKRASuggestions,
  selectKRAs,
  selectKPIs,
  saveKRAWeights,
  type KRAKPIRecord,
  type KRASuggestion,
  type KPISuggestion,
  type FinalKRA,
  type RequestHistoryItem,
  type KRAKPIChatResponse,
  type GenerationStep,
} from "../lib/api";
import { getOrCreateEmployeeId } from "@/lib/auth";

export type KRAKPIMessage = {
  sender: "agent" | "employee";
  text: string;
  isStreaming?: boolean;
  
  // Custom interactive panels
  isKraSelection?: boolean;
  suggestedKras?: KRASuggestion[];
  
  isKpiSelection?: boolean;
  activeKraId?: string;
  activeKraTitle?: string;
  suggestedKpis?: KPISuggestion[];
  
  isWeightAdjustment?: boolean;
  kras?: FinalKRA[];
};

export function useKraKpiChat(jdSessionId: string) {
  const [messages, setMessages] = useState<KRAKPIMessage[]>([]);
  const [history, setHistory] = useState<RequestHistoryItem[]>([]);
  const historyRef = useRef<RequestHistoryItem[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState<number>(0);
  const [currentStep, setCurrentStep] = useState<GenerationStep>("kra_selection");
  const [activeKraTitle, setActiveKraTitle] = useState<string>("KRA Extraction Phase");
  const [hydrated, setHydrated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [record, setRecord] = useState<KRAKPIRecord | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const initialized = useRef(false);

  const updateHistory = useCallback((newHistory: RequestHistoryItem[]) => {
    historyRef.current = newHistory;
    setHistory(newHistory);
  }, []);

  const processResponse = useCallback((
    parsed: KRAKPIChatResponse,
    updatedHistory: RequestHistoryItem[],
    append: boolean = true
  ) => {
    const nextStep = parsed.progress?.current_step ?? "kra_selection";
    const nextProgress = parsed.progress?.completion_percentage ?? 0;
    const kraTitle = parsed.progress?.active_kra_title ?? "Active KRA";

    setProgress(nextProgress);
    setCurrentStep(nextStep);
    setActiveKraTitle(kraTitle);

    // Map response options
    const isKraSelection = nextStep === "kra_selection" && !!parsed.suggested_kras;
    const isKpiSelection = nextStep === "kpi_selection" && !!parsed.suggested_kpis;
    const isWeightAdjustment = nextStep === "weight_adjustment" && !!parsed.final_framework;

    const agentMsg: KRAKPIMessage = {
      sender: "agent",
      text: parsed.next_question,
      isKraSelection,
      suggestedKras: parsed.suggested_kras?.kra_suggestions || undefined,
      isKpiSelection,
      activeKraTitle: parsed.suggested_kpis?.kra_title || undefined,
      suggestedKpis: parsed.suggested_kpis?.kpi_suggestions || undefined,
      isWeightAdjustment,
      kras: parsed.final_framework?.kras || undefined,
    };

    if (append) {
      setMessages((prev) => [...prev, agentMsg]);
    } else {
      setMessages((prev) => {
        const copy = [...prev];
        const lastIdx = copy.length - 1;
        if (lastIdx >= 0 && copy[lastIdx].sender === "agent") {
          copy[lastIdx] = {
            ...copy[lastIdx],
            text: parsed.next_question,
            isStreaming: false,
            isKraSelection,
            suggestedKras: parsed.suggested_kras?.kra_suggestions || undefined,
            isKpiSelection,
            activeKraTitle: parsed.suggested_kpis?.kra_title || undefined,
            suggestedKpis: parsed.suggested_kpis?.kpi_suggestions || undefined,
            isWeightAdjustment,
            kras: parsed.final_framework?.kras || undefined,
          };
        }
        return copy;
      });
    }

    if (updatedHistory.length > 0) {
      updateHistory(updatedHistory);
    }
  }, [updateHistory]);

  const sendTextMessage = useCallback(async (text: string) => {
    if (isGenerating) return;
    setIsGenerating(true);
    setError(null);

    const userMsg: KRAKPIMessage = { sender: "employee", text };
    setMessages((prev) => [...prev, userMsg]);

    const userHistoryItem: RequestHistoryItem = { role: "user", content: text };
    const updatedHistory = [...historyRef.current, userHistoryItem];
    updateHistory(updatedHistory);

    // Append a placeholder agent message for streaming
    setMessages((prev) => [...prev, { sender: "agent", text: "", isStreaming: true }]);

    try {
      let fullText = "";
      await sendKraKpiMessageStream(
        text,
        historyRef.current.slice(0, -1), // send history BEFORE this message
        jdSessionId,
        (chunk) => {
          fullText += chunk;
          setMessages((prev) => {
            const copy = [...prev];
            const last = copy[copy.length - 1];
            if (last && last.sender === "agent") {
              last.text = fullText;
            }
            return copy;
          });
        },
        (doneData) => {
          setIsGenerating(false);
          const assistantHistoryItem: RequestHistoryItem = {
            role: "assistant",
            content: JSON.stringify(doneData),
          };
          processResponse(doneData, [...updatedHistory, assistantHistoryItem], false);
          const empId = getOrCreateEmployeeId();
          // Reload record to reflect latest changes
          fetchKRAKPI(jdSessionId, empId).then(setRecord).catch(() => null);
        },
        (err) => {
          setIsGenerating(false);
          setError(err.message || "Failed to generate response");
          setMessages((prev) => prev.slice(0, -1)); // remove streaming placeholder
        },
        (status) => setStatusMessage(status)
      );
    } catch (e: any) {
      setIsGenerating(false);
      setError(e.message || "Something went wrong");
      setMessages((prev) => prev.slice(0, -1));
    }
  }, [jdSessionId, isGenerating, processResponse, updateHistory]);

  const selectKRAsInline = useCallback(async (ids: string[], titles: string[]) => {
    setIsGenerating(true);
    setError(null);
    try {
      const empId = getOrCreateEmployeeId();
      await selectKRAs(jdSessionId, ids, empId);
      setIsGenerating(false);
      await sendTextMessage(`I select the following KRAs:\n${titles.map(t => `- ${t}`).join("\n")}`);
    } catch (e: any) {
      setIsGenerating(false);
      setError(e.message || "Failed to select KRAs");
    }
  }, [jdSessionId, sendTextMessage]);

  const selectKPIsInline = useCallback(async (selectedKpis: Record<string, string[]>, summaryText: string) => {
    setIsGenerating(true);
    setError(null);
    try {
      const empId = getOrCreateEmployeeId();
      await selectKPIs(jdSessionId, selectedKpis, empId);
      setIsGenerating(false);
      await sendTextMessage(summaryText);
    } catch (e: any) {
      setIsGenerating(false);
      setError(e.message || "Failed to select KPIs");
    }
  }, [jdSessionId, sendTextMessage]);

  const confirmWeightsInline = useCallback(async (kras: FinalKRA[]) => {
    setIsGenerating(true);
    setError(null);
    try {
      const empId = getOrCreateEmployeeId();
      await saveKRAWeights(jdSessionId, kras, true, empId);
      setIsGenerating(false);
      await sendTextMessage("I have adjusted and confirmed the weights for my KRAs and KPIs.");
    } catch (e: any) {
      setIsGenerating(false);
      setError(e.message || "Failed to save weights");
    }
  }, [jdSessionId, sendTextMessage]);

  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true;

      const init = async () => {
        setHydrated(false);
        setError(null);
        try {
          const empId = getOrCreateEmployeeId();
          let existing = await fetchKRAKPI(jdSessionId, empId).catch(() => null);

          // Auto-generate session with bypass manager = true if not exists
          if (!existing) {
            existing = await generateKRASuggestions(jdSessionId, empId, true) as unknown as KRAKPIRecord;
          }

          setRecord(existing);

          if (existing && existing.conversation_history && existing.conversation_history.length > 0) {
            // Reconstruct history
            const reconstructed: KRAKPIMessage[] = existing.conversation_history.map((h: any) => {
              if (h.role === "user") {
                return { sender: "employee", text: h.content };
              }

              let text = h.content;
              let isKraSelection = false;
              let isKpiSelection = false;
              let isWeightAdjustment = false;
              let suggestedKras: KRASuggestion[] | undefined;
              let suggestedKpis: KPISuggestion[] | undefined;
              let activeKraTitle: string | undefined;
              let kras: FinalKRA[] | undefined;

              try {
                const parsed = JSON.parse(h.content) as KRAKPIChatResponse;
                text = parsed.next_question ?? h.content;
                const step = parsed.progress?.current_step;

                isKraSelection = step === "kra_selection" && !!parsed.suggested_kras;
                isKpiSelection = step === "kpi_selection" && !!parsed.suggested_kpis;
                isWeightAdjustment = step === "weight_adjustment" && !!parsed.final_framework;

                suggestedKras = parsed.suggested_kras?.kra_suggestions;
                activeKraTitle = parsed.suggested_kpis?.kra_title;
                suggestedKpis = parsed.suggested_kpis?.kpi_suggestions;
                kras = parsed.final_framework?.kras;
              } catch {}

              return {
                sender: "agent",
                text,
                isKraSelection,
                isKpiSelection,
                isWeightAdjustment,
                suggestedKras,
                suggestedKpis,
                activeKraTitle,
                kras,
              };
            });

            // Set state from last agent question's state if available
            const state = (existing.conversation_state || {}) as any;
            setProgress(state.completion_percentage ?? 0);
            setCurrentStep(state.current_step ?? existing.generation_step ?? "kra_selection");
            setActiveKraTitle(state.active_kra_title ?? "KRA Extraction Phase");

            setMessages(reconstructed);

            const requestHistory = existing.conversation_history.map((h: any) => ({
              role: h.role as "user" | "assistant",
              content: h.content,
            }));
            updateHistory(requestHistory);
          } else {
            // Send initial prompt to welcome user and display options
            setIsGenerating(true);
            setMessages([{ sender: "agent", text: "", isStreaming: true }]);

            let fullText = "";
            await sendKraKpiMessageStream(
              "Hello! Let's start the KRA/KPI alignment process.",
              [],
              jdSessionId,
              (chunk) => {
                fullText += chunk;
                setMessages((prev) => {
                  const copy = [...prev];
                  const last = copy[copy.length - 1];
                  if (last && last.sender === "agent") {
                    last.text = fullText;
                  }
                  return copy;
                });
              },
              (doneData) => {
                setIsGenerating(false);
                const assistantHistoryItem: RequestHistoryItem = {
                  role: "assistant",
                  content: JSON.stringify(doneData),
                };
                processResponse(doneData, [assistantHistoryItem], false);
              },
              (err) => {
                setIsGenerating(false);
                setError(err.message || "Failed to start conversation");
                setMessages([]);
              },
              (status) => setStatusMessage(status)
            );
          }
        } catch (e: any) {
          setError(e.message || "Failed to load session context");
        } finally {
          setHydrated(true);
        }
      };

      init();
    }
  }, [jdSessionId, processResponse, updateHistory]);

  return {
    messages,
    isGenerating,
    progress,
    currentStep,
    activeKraTitle,
    hydrated,
    error,
    record,
    statusMessage,
    sendTextMessage,
    selectKRAsInline,
    selectKPIsInline,
    confirmWeightsInline,
  };
}
