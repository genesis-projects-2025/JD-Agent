"use client";

import { useParams, useRouter } from "next/navigation";
import { useKraKpiChat } from "@/hooks/useKraKpiChat";
import { useState, useEffect, useRef, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Target,
  ArrowLeft,
  Loader2,
  Send,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  Info,
  ChevronDown,
  ChevronUp,
  BarChart3,
  TrendingUp,
  RotateCcw,
  Lock,
} from "lucide-react";
import { PALETTE } from "@/components/jd/kra-kpi-panel";
import type { KRASuggestion, KPISuggestion, FinalKRA } from "@/lib/api";

export default function KRAKPIInterviewPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const {
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
  } = useKraKpiChat(id);

  const [inputVal, setInputVal] = useState("");
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);

  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    isAtBottomRef.current = distanceFromBottom <= 80;
  }, []);

  useEffect(() => {
    if (!isAtBottomRef.current) return;
    const el = scrollContainerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const handleSend = () => {
    if (!inputVal.trim() || isGenerating) return;
    sendTextMessage(inputVal.trim());
    setInputVal("");
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      handleSend();
    }
  };

  if (!hydrated) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[70vh]">
        <Loader2 className="w-8 h-8 animate-spin text-primary-500 mb-3" />
        <span className="text-sm font-medium text-surface-600">Initializing KRA/KPI Alignment Agent...</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-64px)] max-w-7xl mx-auto w-full bg-[#fdfdfe] overflow-hidden">
      {/* Premium Glass Header */}
      <div className="flex-shrink-0 relative z-20 px-6 py-4 glass border-b border-surface-200 shadow-sm">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push(`/jd/${id}?tab=kra-kpi`)}
              className="p-2 hover:bg-surface-100 rounded-lg text-surface-500 transition-colors mr-1"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <h1 className="text-base sm:text-lg font-semibold text-surface-900 leading-none">
                KRA / KPI Generation Agent
              </h1>
              <p className="text-[10px] sm:text-xs font-semibold text-primary-600 mt-1 flex items-center gap-1">
                <Sparkles className="w-3.5 h-3.5" />
                <span>{currentStep === "confirmed" ? "Completed Alignment" : `Active Phase: ${activeKraTitle}`}</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {record?.status === "confirmed" && (
              <span className="text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-3 py-1 rounded-full">
                Locked & Confirmed
              </span>
            )}
          </div>
        </div>

        {/* Progress bar */}
        <div className="mt-3 relative">
          <div className="flex items-center justify-between text-[10px] font-semibold tracking-wider text-surface-400 mb-1">
            <span>Interview Completion Depth</span>
            <span className="text-primary-600">{progress}%</span>
          </div>
          <div className="h-1.5 bg-surface-100 rounded-md overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-primary-500 to-primary-700 transition-all duration-500 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      </div>

      {/* Main Chat Workspace */}
      <div className="flex-1 flex flex-col min-h-0 bg-[#fdfdfe]">
        {/* Messages feed */}
        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto px-6 py-6 space-y-6 scroll-smooth"
        >
          {error && (
            <div className="p-4 rounded-xl border border-red-200 bg-red-50 text-red-700 text-sm flex items-start gap-2 max-w-4xl mx-auto">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="max-w-4xl mx-auto space-y-6">
            {messages.map((msg, index) => {
              const isLast = index === messages.length - 1;
              return (
                <div key={index} className={`flex gap-4 ${msg.sender === "employee" ? "justify-end" : "justify-start"}`}>
                  {msg.sender === "agent" && (
                    <div className="w-8 h-8 rounded-lg bg-primary-600 flex items-center justify-center shadow-md ring-4 ring-primary-50 shrink-0">
                      <Target className="w-4 h-4 text-white" />
                    </div>
                  )}

                  <div className={`max-w-[85%] ${msg.sender === "employee" ? "bg-surface-900 text-white rounded-2xl rounded-tr-none px-5 py-3.5 shadow-sm font-medium text-sm leading-relaxed" : "bg-white text-surface-900 border border-surface-200 rounded-2xl rounded-tl-none px-5 py-4 shadow-sm"}`}>
                    {msg.sender === "agent" && (
                      <div className="text-[10px] font-bold text-primary-600 mb-1.5 tracking-wider uppercase">
                        KPI Alignment Specialist
                      </div>
                    )}

                    {/* Agent markdown response */}
                    <div className="prose prose-sm max-w-none text-sm text-surface-800 leading-relaxed font-normal">
                      {msg.text ? (
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.text}</ReactMarkdown>
                      ) : msg.isStreaming ? (
                        <div className="flex items-center gap-2 text-surface-400 py-1">
                          <span className="w-1.5 h-1.5 bg-primary-400 rounded-full animate-bounce [animation-delay:-0.3s]" />
                          <span className="w-1.5 h-1.5 bg-primary-400 rounded-full animate-bounce [animation-delay:-0.15s]" />
                          <span className="w-1.5 h-1.5 bg-primary-400 rounded-full animate-bounce" />
                          <span className="text-xs font-medium ml-1">
                            {statusMessage || "Formulating performance metrics..."}
                          </span>
                        </div>
                      ) : null}
                    </div>

                    {/* KRA SELECTION PANEL */}
                    {msg.isKraSelection && msg.suggestedKras && (
                      <InlineKRASelection
                        suggestions={msg.suggestedKras}
                        onConfirm={selectKRAsInline}
                        isInteractable={isLast && !isGenerating}
                      />
                    )}

                    {/* KPI SELECTION PANEL */}
                    {msg.isKpiSelection && msg.suggestedKpis && (
                      <InlineKPISelection
                        activeKraTitle={msg.activeKraTitle || activeKraTitle}
                        suggestions={msg.suggestedKpis}
                        record={record}
                        onConfirm={selectKPIsInline}
                        isInteractable={isLast && !isGenerating}
                      />
                    )}

                    {/* WEIGHTS ADJUSTMENT PANEL */}
                    {msg.isWeightAdjustment && (msg.kras || record?.kras?.kras) && (
                      <InlineWeightAdjustment
                        initialKras={msg.kras || record?.kras?.kras || []}
                        onConfirm={confirmWeightsInline}
                        isInteractable={isLast && !isGenerating}
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Text Input Panel - Locked if confirmed */}
        {currentStep !== "confirmed" ? (
          <div className="flex-shrink-0 border-t border-surface-200 bg-white p-4">
            <div className="max-w-4xl mx-auto flex gap-3">
              <input
                type="text"
                value={inputVal}
                onChange={(e) => setInputVal(e.target.value)}
                onKeyDown={handleKeyPress}
                disabled={isGenerating}
                placeholder="Ask the alignment agent a question or request modifications..."
                className="flex-1 border border-surface-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500 disabled:bg-surface-50"
              />
              <button
                onClick={handleSend}
                disabled={isGenerating || !inputVal.trim()}
                className="bg-primary-600 hover:bg-primary-700 text-white rounded-xl px-5 py-3 transition-colors disabled:opacity-40 disabled:hover:bg-primary-600 flex items-center justify-center"
              >
                {isGenerating ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex-shrink-0 border-t border-surface-200 bg-emerald-50/50 p-6 text-center animate-in fade-in duration-700">
            <div className="max-w-md mx-auto space-y-3">
              <CheckCircle2 className="w-8 h-8 text-emerald-600 mx-auto" />
              <h3 className="font-bold text-surface-900 text-sm">Performance Alignment Confirmed</h3>
              <p className="text-xs text-surface-500">
                Your performance KRA/KPI framework weights and indicators are locked and confirmed. You can now view and print it.
              </p>
              <button
                onClick={() => router.push(`/jd/${id}?tab=kra-kpi`)}
                className="inline-flex items-center gap-2 px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg transition-colors"
              >
                <Target className="w-3.5 h-3.5" /> Return to KRA/KPI Panel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Inline KRA Selection ───────────────────────────────────────────────────────

function InlineKRASelection({
  suggestions,
  onConfirm,
  isInteractable,
}: {
  suggestions: KRASuggestion[];
  onConfirm: (ids: string[], titles: string[]) => void;
  isInteractable: boolean;
}) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const toggle = (id: string) => {
    if (!isInteractable) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const count = selectedIds.size;
  const isValid = count >= 1;

  const handleSubmit = () => {
    if (!isValid || !isInteractable) return;
    const ids = Array.from(selectedIds);
    const titles = suggestions
      .filter((s) => selectedIds.has(s.kra_id))
      .map((s) => s.title);
    onConfirm(ids, titles);
  };

  return (
    <div className="mt-4 space-y-3 border-t border-surface-100 pt-4">
      <div className="flex justify-between items-center text-xs font-semibold text-surface-500">
        <span>Select core accountability KRAs:</span>
        <span className={isValid ? "text-emerald-600 font-bold" : "text-surface-400"}>
          {count} Selected
        </span>
      </div>

      <div className="space-y-2.5 max-h-[300px] overflow-y-auto pr-1">
        {suggestions.map((kra, i) => {
          const isSelected = selectedIds.has(kra.kra_id);
          const paletteColor = PALETTE[i % PALETTE.length];
          return (
            <button
              key={kra.kra_id}
              disabled={!isInteractable}
              onClick={() => toggle(kra.kra_id)}
              className={`w-full text-left p-3.5 rounded-xl border-2 transition-all ${
                isSelected
                  ? `${paletteColor.border} ${paletteColor.bg} scale-[1.01]`
                  : "border-surface-150 bg-surface-50 hover:bg-white hover:border-surface-300"
              } disabled:opacity-80 disabled:cursor-not-allowed`}
            >
              <div className="flex gap-2.5 items-start">
                <div
                  className={`w-4.5 h-4.5 shrink-0 rounded border flex items-center justify-center mt-0.5 transition-all ${
                    isSelected
                      ? `${paletteColor.border.replace("border-", "bg-").replace("-200", "-500")} border-transparent text-white`
                      : "border-surface-300 bg-white"
                  }`}
                >
                  {isSelected && <CheckCircle2 className="w-3 h-3 text-white" />}
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="font-semibold text-xs text-surface-900">{kra.title}</span>
                  </div>
                  <p className="text-[11px] text-surface-500 leading-normal">{kra.description}</p>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {isInteractable && (
        <button
          onClick={handleSubmit}
          disabled={!isValid}
          className="w-full py-2.5 bg-primary-600 text-white text-xs font-semibold rounded-xl hover:bg-primary-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed mt-2"
        >
          Confirm & Save KRA Selections
        </button>
      )}
    </div>
  );
}

// ── Inline KPI Selection ───────────────────────────────────────────────────────

function InlineKPISelection({
  activeKraTitle,
  suggestions,
  record,
  onConfirm,
  isInteractable,
}: {
  activeKraTitle: string;
  suggestions: KPISuggestion[];
  record: any;
  onConfirm: (selectedKpis: Record<string, string[]>, summaryText: string) => void;
  isInteractable: boolean;
}) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const toggle = (id: string) => {
    if (!isInteractable) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const count = selectedIds.size;
  const isValid = count >= 1;

  const handleSubmit = () => {
    if (!isValid || !isInteractable || !record) return;

    // Find the active KRA ID matching the suggestions
    const activeKraId = record.selected_kra_ids?.find(
      (id: string) => !record.selected_kpi_ids?.[id]
    );

    if (!activeKraId) return;

    const updatedMapping = {
      ...(record.selected_kpi_ids || {}),
      [activeKraId]: Array.from(selectedIds),
    };

    const metricsText = suggestions
      .filter((s) => selectedIds.has(s.kpi_id))
      .map((s) => s.metric);

    const summaryText = `I have selected the following KPIs for ${activeKraTitle}:\n${metricsText
      .map((m) => `- ${m}`)
      .join("\n")}`;

    onConfirm(updatedMapping, summaryText);
  };

  return (
    <div className="mt-4 space-y-3 border-t border-surface-100 pt-4">
      <div className="flex justify-between items-center text-xs font-semibold text-surface-500">
        <span>Select KPIs for <strong>{activeKraTitle}</strong>:</span>
        <span className={isValid ? "text-emerald-600 font-bold" : "text-surface-400"}>
          {count} Selected
        </span>
      </div>

      <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
        {suggestions.map((kpi, idx) => {
          const isSelected = selectedIds.has(kpi.kpi_id);
          const isExpanded = expandedId === kpi.kpi_id;
          return (
            <div
              key={kpi.kpi_id}
              className={`rounded-xl border-2 transition-all ${
                isSelected ? "border-primary-200 bg-primary-50/50" : "border-surface-150 bg-surface-50"
              }`}
            >
              <div className="flex gap-2.5 items-start p-3">
                <button
                  disabled={!isInteractable}
                  onClick={() => toggle(kpi.kpi_id)}
                  className={`w-4.5 h-4.5 shrink-0 rounded border flex items-center justify-center mt-0.5 transition-all ${
                    isSelected ? "bg-primary-600 border-primary-600 text-white" : "border-surface-300 bg-white"
                  }`}
                >
                  {isSelected && <CheckCircle2 className="w-3 h-3 text-white" />}
                </button>
                <div className="flex-1 min-w-0" onClick={() => toggle(kpi.kpi_id)}>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-xs text-surface-900 leading-tight block truncate">
                      {kpi.metric}
                    </span>
                    <span className="text-[9px] bg-surface-100 text-surface-500 px-1.5 py-0.5 rounded uppercase font-bold shrink-0">
                      {kpi.frequency}
                    </span>
                  </div>
                  <p className="text-[11px] font-semibold text-primary-600 mt-1">{kpi.target}</p>
                  <p className="text-[10px] text-surface-400 mt-0.5 leading-normal">{kpi.measurement_method}</p>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setExpandedId(isExpanded ? null : kpi.kpi_id);
                  }}
                  className="text-surface-300 hover:text-surface-500 p-0.5"
                >
                  {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                </button>
              </div>

              {isExpanded && kpi.threshold && (
                <div className="px-3 pb-3 pt-0 ml-7 border-t border-surface-200/50 pt-2 text-[10px] space-y-1">
                  <div className="flex gap-2">
                    <span className="text-emerald-600 font-bold w-20">Excellent:</span>
                    <span className="text-surface-600">{kpi.threshold.excellent}</span>
                  </div>
                  <div className="flex gap-2">
                    <span className="text-blue-600 font-bold w-20">Meets:</span>
                    <span className="text-surface-600">{kpi.threshold.meets_expectation}</span>
                  </div>
                  <div className="flex gap-2">
                    <span className="text-red-500 font-bold w-20">Below:</span>
                    <span className="text-surface-600">{kpi.threshold.below_expectation}</span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {isInteractable && (
        <button
          onClick={handleSubmit}
          disabled={!isValid}
          className="w-full py-2.5 bg-primary-600 text-white text-xs font-semibold rounded-xl hover:bg-primary-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed mt-2"
        >
          Confirm KPIs for this KRA
        </button>
      )}
    </div>
  );
}

// ── Inline Weight Adjustment ──────────────────────────────────────────────────

function InlineWeightAdjustment({
  initialKras,
  onConfirm,
  isInteractable,
}: {
  initialKras: FinalKRA[];
  onConfirm: (kras: FinalKRA[]) => void;
  isInteractable: boolean;
}) {
  // Initialize: distribute equally if weights are null
  const initWeights = (kras: FinalKRA[]): FinalKRA[] => {
    const hasNulls = kras.some((k) => k.weight === null || k.weight === undefined);
    if (!hasNulls) return kras;
    const base = Math.floor(100 / kras.length);
    const rem = 100 - base * kras.length;
    return kras.map((k, i) => ({ ...k, weight: base + (i === 0 ? rem : 0) }));
  };

  const [kras, setKras] = useState<FinalKRA[]>(initWeights(initialKras));

  const total = kras.reduce((s, k) => s + (k.weight ?? 0), 0);
  const isValid = Math.abs(total - 100) <= 0.1;

  const handleSlider = (id: string, val: number) => {
    if (!isInteractable) return;
    setKras((prev) => {
      const updated = prev.map((k) => (k.kra_id === id ? { ...k, weight: val } : k));
      const thisTotal = updated.reduce((s, k) => s + (k.weight ?? 0), 0);
      const diff = 100 - thisTotal;
      const others = updated.filter((k) => k.kra_id !== id);
      if (others.length > 0) {
        const othersTotal = others.reduce((s, k) => s + (k.weight ?? 0), 0);
        return updated.map((k) => {
          if (k.kra_id === id) return k;
          const share = othersTotal > 0 ? ((k.weight ?? 0) / othersTotal) * diff : diff / others.length;
          return { ...k, weight: Math.max(5, Math.round((k.weight ?? 0) + share)) };
        });
      }
      return updated;
    });
  };

  const handleSubmit = () => {
    if (!isValid || !isInteractable) return;
    onConfirm(kras);
  };

  return (
    <div className="mt-4 space-y-4 border-t border-surface-100 pt-4">
      <div className="text-xs font-semibold text-surface-500">
        Adjust suggested KRA weights (must equal 100%):
      </div>

      {/* Visual Bar chart */}
      <div className="h-3 rounded-full overflow-hidden flex gap-0.5 bg-surface-100">
        {kras.map((k, i) => (
          <div
            key={k.kra_id}
            className={`${PALETTE[i % PALETTE.length].bar} h-full transition-all`}
            style={{ width: `${k.weight}%` }}
          />
        ))}
      </div>

      <div className={`flex items-center justify-between text-xs font-bold px-3 py-2 rounded-lg ${isValid ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"}`}>
        <span className="flex items-center gap-1.5">
          <BarChart3 className="w-4 h-4" /> Goal Weight Total
        </span>
        <span>{total}%</span>
      </div>

      <div className="space-y-3">
        {kras.map((k, i) => {
          const color = PALETTE[i % PALETTE.length];
          return (
            <div key={k.kra_id} className={`p-3 border rounded-xl bg-surface-50/50 ${color.border}`}>
              <div className="flex justify-between items-center mb-2">
                <span className="font-semibold text-xs text-surface-800 leading-tight">{k.title}</span>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${color.badge}`}>
                  {k.weight}%
                </span>
              </div>

              {isInteractable && (
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-surface-400">10%</span>
                  <input
                    type="range"
                    min={5}
                    max={60}
                    value={k.weight}
                    onChange={(e) => handleSlider(k.kra_id, parseInt(e.target.value))}
                    className="flex-1 h-1 bg-surface-200 rounded-lg appearance-none cursor-pointer"
                    style={{ accentColor: "currentColor" }}
                  />
                  <span className="text-[10px] text-surface-400">60%</span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {isInteractable && (
        <button
          onClick={handleSubmit}
          disabled={!isValid}
          className="w-full py-2.5 bg-primary-600 text-white text-xs font-semibold rounded-xl hover:bg-primary-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed mt-2"
        >
          Confirm and Save weights
        </button>
      )}
    </div>
  );
}
