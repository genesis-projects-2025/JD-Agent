"use client";
// frontend/components/jd/kra-kpi-panel.tsx
// 3-Step KRA/KPI Selection Flow with drag-and-drop weight adjustment.
//
// Step 1 — KRA Selection:   6–7 KRA cards → employee picks 3–5
// Step 2 — KPI Selection:   Per each selected KRA, 6–7 KPI cards → employee picks 3–5
// Step 3 — Weight Adjust:   Drag-and-drop reorder + slider weight to redistribute 100%

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Target,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  Loader2,
  RefreshCw,
  CheckCircle2,
  Lock,
  Unlock,
  GripVertical,
  ArrowRight,
  ArrowLeft,
  Sparkles,
  TrendingUp,
  BarChart3,
  Info,
} from "lucide-react";
import {
  fetchKRAKPI,
  fetchKRAKPIStatus,
  generateKRASuggestions,
  selectKRAs,
  selectKPIs,
  saveKRAWeights,
  sendKRAKPIForApproval,
  type KRASuggestion,
  type KPISuggestion,
  type FinalKRA,
  type KRAKPIRecord,
  type PrerequisiteStatus,
  type GenerationStep,
} from "@/lib/api";

export const PALETTE = [
  { bg: "bg-slate-50/50", border: "border-slate-200", badge: "bg-slate-100 text-slate-700", bar: "bg-slate-700", check: "accent-slate-700" },
  { bg: "bg-slate-50/50", border: "border-slate-200", badge: "bg-slate-100/90 text-slate-700", bar: "bg-slate-500", check: "accent-slate-600" },
  { bg: "bg-slate-50/50", border: "border-slate-200", badge: "bg-slate-100/80 text-slate-700", bar: "bg-slate-400", check: "accent-slate-500" },
  { bg: "bg-slate-50/50", border: "border-slate-200", badge: "bg-slate-200 text-slate-800", bar: "bg-slate-800", check: "accent-slate-800" },
  { bg: "bg-slate-50/50", border: "border-slate-200", badge: "bg-slate-100/70 text-slate-600", bar: "bg-slate-600", check: "accent-slate-600" },
];

// ── Progress Stepper ──────────────────────────────────────────────────────────

const STEPS = [
  { id: "kra_selection",    label: "Select KRAs" },
  { id: "kpi_selection",    label: "Select KPIs" },
  { id: "weight_adjustment",label: "Set Weights" },
  { id: "confirmed",        label: "Confirmed" },
];

function StepBar({ current }: { current: GenerationStep }) {
  const idx = STEPS.findIndex((s) => s.id === current);
  return (
    <div className="flex items-center gap-0 mb-6">
      {STEPS.map((step, i) => {
        const done = i < idx;
        const active = i === idx;
        return (
          <div key={step.id} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center gap-1">
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                  done    ? "bg-primary-600 text-white"
                  : active ? "bg-primary-600 text-white ring-4 ring-primary-100"
                  :         "bg-surface-100 text-surface-400"
                }`}
              >
                {done ? <CheckCircle2 className="w-4 h-4" /> : i + 1}
              </div>
              <span className={`text-[10px] font-medium whitespace-nowrap ${active ? "text-primary-600" : done ? "text-surface-400" : "text-surface-300"}`}>
                {step.label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`h-0.5 flex-1 mx-1 mb-4 transition-colors ${done ? "bg-primary-500" : "bg-surface-100"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Missing Prerequisite Banner ───────────────────────────────────────────────

function MissingBanner({ status }: { status: PrerequisiteStatus }) {
  const labelMap: Record<string, string> = {
    employee_jd: "Employee JD (yours)",
    manager_jd: "Manager's JD",
    manager_kra_kpi: "Manager's KRA/KPI",
  };
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-5">
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
        <div>
          <h3 className="font-semibold text-amber-800 mb-2">Prerequisites Missing</h3>
          <ul className="space-y-1.5 mb-3">
            {["employee_jd", "manager_jd", "manager_kra_kpi"].map((key) => {
              const isMissing = status.missing.includes(key);
              return (
                <li key={key} className="flex items-center gap-2 text-sm">
                  <span className={isMissing ? "text-red-500 font-bold" : "text-emerald-500 font-bold"}>
                    {isMissing ? "✕" : "✓"}
                  </span>
                  <span className={isMissing ? "text-red-700 font-medium" : "text-emerald-700"}>
                    {labelMap[key]}
                  </span>
                </li>
              );
            })}
          </ul>
          <div className="bg-amber-100/70 rounded-lg p-3 text-xs text-amber-800 whitespace-pre-line leading-relaxed">
            {status.message}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Step 1: KRA Selection ─────────────────────────────────────────────────────

function KRASuggestionCard({
  kra, index, selected, onToggle,
}: { kra: KRASuggestion; index: number; selected: boolean; onToggle: () => void }) {
  const c = PALETTE[index % PALETTE.length];
  return (
    <button
      onClick={onToggle}
      className={`w-full text-left p-4 rounded-xl border-2 transition-all duration-150 ${
        selected
          ? `${c.border} ${c.bg} shadow-sm scale-[1.01]`
          : "border-surface-100 bg-white hover:border-surface-200 hover:shadow-sm"
      }`}
    >
      <div className="flex items-start gap-3">
        <div
          className={`mt-0.5 w-5 h-5 rounded flex-shrink-0 border-2 flex items-center justify-center transition-all ${
            selected ? `${c.border.replace("border-", "bg-").replace("-200", "-500")} border-transparent` : "border-surface-200 bg-white"
          }`}
        >
          {selected && <CheckCircle2 className="w-3 h-3 text-white" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="font-semibold text-surface-900 text-sm">{kra.title}</span>
          </div>
          <p className="text-xs text-surface-500 leading-relaxed">{kra.description}</p>
          {kra.source_tasks && kra.source_tasks.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {kra.source_tasks.map((t, i) => (
                <span key={i} className="text-[10px] bg-surface-100 text-surface-500 px-2 py-0.5 rounded-full">
                  {t}
                </span>
              ))}
            </div>
          )}
          {kra.manager_impact && (
            <p className="text-[10px] text-surface-400 mt-1.5 italic flex items-center gap-1">
              <Info className="w-3 h-3" /> {kra.manager_impact}
            </p>
          )}
        </div>
      </div>
    </button>
  );
}

function Step1KRASelection({
  suggestions, onContinue,
}: {
  suggestions: KRASuggestion[];
  onContinue: (ids: string[]) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else if (next.size < 5) {
        next.add(id);
      }
      return next;
    });
  };

  const handleContinue = async () => {
    setLoading(true);
    await onContinue([...selected]);
    setLoading(false);
  };

  const count = selected.size;
  const canContinue = count >= 3 && count <= 5;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-surface-600">
            Select <strong>3 to 5 KRAs</strong> that best represent your role's accountability areas.
          </p>
          <p className="text-xs text-surface-400 mt-0.5">
            After selecting KPIs, you will assign weights to each KRA yourself in Step 3.
          </p>
        </div>
        <span className={`text-sm font-semibold px-3 py-1 rounded-full ${
          canContinue ? "bg-emerald-100 text-emerald-700" : "bg-surface-100 text-surface-500"
        }`}>
          {count} / 5
        </span>
      </div>

      <div className="grid gap-2.5">
        {suggestions.map((kra, i) => (
          <KRASuggestionCard
            key={kra.kra_id}
            kra={kra}
            index={i}
            selected={selected.has(kra.kra_id)}
            onToggle={() => toggle(kra.kra_id)}
          />
        ))}
      </div>

      {count > 5 && (
        <p className="text-xs text-red-600 text-center">Maximum 5 KRAs allowed.</p>
      )}

      <button
        onClick={handleContinue}
        disabled={!canContinue || loading}
        className="w-full flex items-center justify-center gap-2 py-3 bg-primary-600 text-white rounded-xl font-medium text-sm hover:bg-primary-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        {loading ? (
          <><Loader2 className="w-4 h-4 animate-spin" /> Generating KPI suggestions…</>
        ) : (
          <><ArrowRight className="w-4 h-4" /> Continue to KPI Selection</>
        )}
      </button>
    </div>
  );
}

// ── Step 2: KPI Selection per KRA ─────────────────────────────────────────────

function KPISuggestionCard({
  kpi, selected, onToggle, colorIndex,
}: { kpi: KPISuggestion; selected: boolean; onToggle: () => void; colorIndex: number }) {
  const [open, setOpen] = useState(false);
  const c = PALETTE[colorIndex % PALETTE.length];
  return (
    <div className={`rounded-lg border-2 transition-all ${selected ? `${c.border} ${c.bg}` : "border-surface-100 bg-white"}`}>
      <div className="flex items-start gap-3 p-3">
        <button
          onClick={onToggle}
          className={`mt-0.5 w-5 h-5 rounded flex-shrink-0 border-2 flex items-center justify-center transition-all ${
            selected ? `${c.border.replace("border-", "bg-").replace("-200", "-500")} border-transparent` : "border-surface-200 bg-white"
          }`}
        >
          {selected && <CheckCircle2 className="w-3 h-3 text-white" />}
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-surface-900">{kpi.metric}</span>
            <span className="text-[10px] bg-surface-100 text-surface-500 px-1.5 py-0.5 rounded">{kpi.frequency}</span>
          </div>
          <p className="text-xs text-primary-600 font-medium mt-0.5">{kpi.target}</p>
          <p className="text-xs text-surface-400 mt-0.5">{kpi.measurement_method}</p>
        </div>
        <button
          onClick={() => setOpen(!open)}
          className="text-surface-300 hover:text-surface-500 flex-shrink-0 p-1"
        >
          {open ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>
      </div>
      {open && kpi.threshold && (
        <div className="px-3 pb-3 pt-0 ml-8 text-xs space-y-0.5">
          <div className="flex gap-2">
            <span className="text-emerald-600 font-medium w-24">Excellent:</span>
            <span className="text-surface-600">{kpi.threshold.excellent}</span>
          </div>
          <div className="flex gap-2">
            <span className="text-blue-600 font-medium w-24">Meets:</span>
            <span className="text-surface-600">{kpi.threshold.meets_expectation}</span>
          </div>
          <div className="flex gap-2">
            <span className="text-red-500 font-medium w-24">Below:</span>
            <span className="text-surface-600">{kpi.threshold.below_expectation}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function Step2KPISelection({
  selectedKras, kpiSuggestions, krasSuggestions, onContinue, onBack,
}: {
  selectedKras: string[];
  kpiSuggestions: Record<string, { kra_title: string; kpi_suggestions: KPISuggestion[] }>;
  krasSuggestions: KRASuggestion[];
  onContinue: (selected: Record<string, string[]>) => void;
  onBack: () => void;
}) {
  const [selectedKpis, setSelectedKpis] = useState<Record<string, Set<string>>>({});
  const [loading, setLoading] = useState(false);
  const [activeKra, setActiveKra] = useState<string>(selectedKras[0] || "");

  const toggleKpi = (kraId: string, kpiId: string) => {
    setSelectedKpis((prev) => {
      const kraSet = new Set(prev[kraId] || []);
      if (kraSet.has(kpiId)) {
        kraSet.delete(kpiId);
      } else if (kraSet.size < 5) {
        kraSet.add(kpiId);
      }
      return { ...prev, [kraId]: kraSet };
    });
  };

  const kraCount = (id: string) => selectedKpis[id]?.size ?? 0;
  const allValid = selectedKras.every((id) => {
    const c = kraCount(id);
    return c >= 3 && c <= 5;
  });

  const handleContinue = async () => {
    setLoading(true);
    const out: Record<string, string[]> = {};
    for (const id of selectedKras) {
      out[id] = [...(selectedKpis[id] || [])];
    }
    await onContinue(out);
    setLoading(false);
  };

  const kraTitle = (id: string) =>
    kpiSuggestions[id]?.kra_title ||
    krasSuggestions.find((k) => k.kra_id === id)?.title ||
    id;

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-surface-600">
          For each selected KRA, choose <strong>3 to 5 KPIs</strong> that best measure performance.
        </p>
        <p className="text-xs text-surface-400 mt-0.5">Expand any KPI to see measurement thresholds.</p>
      </div>

      {/* KRA tab pills */}
      <div className="flex flex-wrap gap-2">
        {selectedKras.map((id, i) => {
          const count = kraCount(id);
          const valid = count >= 3;
          return (
            <button
              key={id}
              onClick={() => setActiveKra(id)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium flex items-center gap-1.5 transition-colors border ${
                activeKra === id
                  ? `${PALETTE[i % PALETTE.length].border} ${PALETTE[i % PALETTE.length].bg} ${PALETTE[i % PALETTE.length].badge.split(" ")[1]}`
                  : "border-surface-100 text-surface-500 hover:bg-surface-50"
              }`}
            >
              {valid ? <CheckCircle2 className="w-3 h-3 text-emerald-500" /> : null}
              {kraTitle(id)}
              <span className={`font-bold ${count >= 3 ? "text-emerald-600" : "text-surface-400"}`}>
                {count}/5
              </span>
            </button>
          );
        })}
      </div>

      {/* KPI list for active KRA */}
      {activeKra && kpiSuggestions[activeKra] && (
        <div className="space-y-2">
          {kpiSuggestions[activeKra].kpi_suggestions.map((kpi) => (
            <KPISuggestionCard
              key={kpi.kpi_id}
              kpi={kpi}
              selected={(selectedKpis[activeKra] || new Set()).has(kpi.kpi_id)}
              onToggle={() => toggleKpi(activeKra, kpi.kpi_id)}
              colorIndex={selectedKras.indexOf(activeKra)}
            />
          ))}
        </div>
      )}

      <div className="flex gap-3">
        <button
          onClick={onBack}
          className="px-4 py-2.5 text-sm font-medium text-surface-600 border border-surface-200 rounded-xl hover:bg-surface-50 flex items-center gap-1.5 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <button
          onClick={handleContinue}
          disabled={!allValid || loading}
          className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-primary-600 text-white rounded-xl font-medium text-sm hover:bg-primary-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? (
            <><Loader2 className="w-4 h-4 animate-spin" /> Building framework…</>
          ) : (
            <><ArrowRight className="w-4 h-4" /> Continue to Weight Setup</>
          )}
        </button>
      </div>
    </div>
  );
}

// ── Step 3: Drag-and-Drop Weight Adjustment ───────────────────────────────────

function WeightBar({ kras }: { kras: FinalKRA[] }) {
  return (
    <div className="mb-1">
      <div className="flex h-3 rounded-full overflow-hidden gap-0.5">
        {kras.map((kra, i) => (
          <div
            key={kra.kra_id}
            className={`${PALETTE[i % PALETTE.length].bar} transition-all duration-300`}
            style={{ width: `${kra.weight}%` }}
            title={`${kra.title}: ${kra.weight}%`}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
        {kras.map((kra, i) => (
          <div key={kra.kra_id} className="flex items-center gap-1">
            <div className={`w-2 h-2 rounded-full ${PALETTE[i % PALETTE.length].bar}`} />
            <span className="text-[10px] text-surface-500">{kra.title.split(" ").slice(0, 3).join(" ")}: <strong>{kra.weight}%</strong></span>
          </div>
        ))}
      </div>
    </div>
  );
}

function WeightInput({
  value,
  onChange,
  disabled = false,
  className = "",
}: {
  value: number;
  onChange: (val: number) => void;
  disabled?: boolean;
  className?: string;
}) {
  const [localVal, setLocalVal] = useState<string>(value === 0 ? "" : value.toString());

  // Sync state if external changes occur (like rebalancing)
  useEffect(() => {
    const parsed = parseInt(localVal) || 0;
    if (parsed !== value) {
      setLocalVal(value === 0 ? "" : value.toString());
    }
  }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let raw = e.target.value;
    // Allow digits only
    raw = raw.replace(/[^0-9]/g, "");

    // Strip leading zeros if more than 1 character (e.g. "021" -> "21", "00" -> "0")
    if (raw.length > 1 && raw.startsWith("0")) {
      raw = raw.replace(/^0+/, "");
      if (raw === "") raw = "0";
    }

    let num = parseInt(raw) || 0;
    if (num > 100) {
      num = 100;
      raw = "100";
    }

    setLocalVal(raw);
    onChange(num);
  };

  const handleBlur = () => {
    const parsed = parseInt(localVal) || 0;
    setLocalVal(parsed === 0 ? "" : parsed.toString());
    onChange(parsed);
  };

  return (
    <input
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      disabled={disabled}
      value={localVal}
      onChange={handleChange}
      onBlur={handleBlur}
      className={className}
    />
  );
}

function DraggableKRARow({
  kra, index, onWeightChange, onDragStart, onDragOver, onDragEnd, isDragging,
  isLocked, onLockToggle, onKpisReorder, onKpiWeightChange,
  lockedKpiIds, onKpiLockToggle,
}: {
  kra: FinalKRA;
  index: number;
  onWeightChange: (id: string, w: number) => void;
  onDragStart: (i: number) => void;
  onDragOver: (i: number) => void;
  onDragEnd: () => void;
  isDragging: boolean;
  isLocked: boolean;
  onLockToggle: (id: string) => void;
  onKpisReorder: (id: string, reorderedKpis: any[]) => void;
  onKpiWeightChange: (kraId: string, kpiId: string, newW: number) => void;
  lockedKpiIds: Set<string>;
  onKpiLockToggle: (id: string) => void;
}) {
  const [kpiOpen, setKpiOpen] = useState(false);
  const [kpiDragFrom, setKpiDragFrom] = useState<number | null>(null);

  const handleKpiDragOver = (idx: number) => {
    if (kpiDragFrom === null || kpiDragFrom === idx) return;
    const reordered = [...kra.kpis];
    const [moved] = reordered.splice(kpiDragFrom, 1);
    reordered.splice(idx, 0, moved);
    onKpisReorder(kra.kra_id, reordered);
    setKpiDragFrom(idx);
  };

  return (
    <div
      draggable
      onDragStart={() => onDragStart(index)}
      onDragOver={(e) => { e.preventDefault(); onDragOver(index); }}
      onDragEnd={onDragEnd}
      className={`bg-white rounded-xl border transition-all duration-200 ${
        isDragging 
          ? "border-primary-500 ring-2 ring-primary-100 bg-slate-50 shadow-md scale-[1.01]" 
          : "border-slate-200 hover:border-slate-300 shadow-sm"
      }`}
    >
      <div className="flex items-start gap-3 p-4">
        {/* Drag handle */}
        <div className="flex-shrink-0 cursor-grab active:cursor-grabbing pt-1.5 text-slate-300 hover:text-slate-500">
          <GripVertical className="w-4 h-4" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-4 mb-2">
            <div>
              <span className="font-semibold text-slate-800 text-sm block sm:inline">{kra.title}</span>
              <span className="text-[11px] text-slate-400 font-medium sm:ml-2">KRA #{index + 1}</span>
            </div>
            
            {/* Weight adjustments & Lock */}
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                onClick={() => onLockToggle(kra.kra_id)}
                type="button"
                className={`p-1.5 rounded-lg border transition-all ${
                  isLocked
                    ? "bg-slate-800 text-white border-slate-800 shadow-sm"
                    : "bg-white text-slate-400 border-slate-200 hover:text-slate-600 hover:bg-slate-50"
                }`}
                title={isLocked ? "Unlock KRA weight" : "Lock KRA weight"}
              >
                {isLocked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
              </button>

              <div className="flex items-center bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 w-20 focus-within:border-slate-400 focus-within:bg-white transition-colors">
                <WeightInput
                  value={kra.weight ?? 0}
                  disabled={isLocked}
                  onChange={(val) => onWeightChange(kra.kra_id, val)}
                  className="w-full bg-transparent text-sm font-semibold text-slate-700 text-center outline-none border-none disabled:opacity-60"
                />
                <span className="text-sm font-semibold text-slate-400 select-none">%</span>
              </div>
            </div>
          </div>
          <p className="text-xs text-slate-500 leading-relaxed mb-3 pr-2">{kra.description}</p>

          {/* KPI toggle */}
          <button
            onClick={() => setKpiOpen(!kpiOpen)}
            className="flex items-center gap-1 mt-1 text-xs font-semibold text-slate-500 hover:text-slate-700 transition-colors"
          >
            {kpiOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            <span>{kra.kpis.length} KPIs</span>
          </button>

          {kpiOpen && (
            <div className="mt-3 pl-6 border-l border-slate-200 space-y-2">
              <ul className="space-y-1.5">
                {kra.kpis.map((kpi, kpiIdx) => {
                  const isKpiLocked = lockedKpiIds.has(kpi.kpi_id);
                  return (
                    <li
                      key={kpi.kpi_id}
                      draggable
                      onDragStart={() => setKpiDragFrom(kpiIdx)}
                      onDragOver={(e) => { e.preventDefault(); handleKpiDragOver(kpiIdx); }}
                      onDragEnd={() => setKpiDragFrom(null)}
                      className={`text-xs flex items-center gap-2 p-2 border rounded-lg transition-all ${
                        kpiDragFrom === kpiIdx 
                          ? "border-primary-500 bg-indigo-50/50 shadow-sm animate-pulse" 
                          : "bg-slate-50 border-slate-100 hover:border-slate-300"
                      }`}
                    >
                      <div className="cursor-grab active:cursor-grabbing text-slate-300 hover:text-slate-500 flex-shrink-0">
                        <GripVertical className="w-3.5 h-3.5" />
                      </div>
                      <div className="flex-1 min-w-0 flex items-baseline gap-1 mr-2 flex-wrap">
                        <span className="text-slate-700 font-medium">{kpi.metric}</span>
                        <span className="text-slate-400 font-normal text-[11px]">— {kpi.target}</span>
                        <span className="text-[10px] text-slate-400 font-semibold whitespace-nowrap ml-1 bg-slate-100 px-1.5 py-0.5 rounded">
                          ({(((kpi.weight ?? 0) * (kra.weight ?? 0)) / 100).toFixed(1)}% overall)
                        </span>
                      </div>
                      
                      {/* KPI lock button & weight input */}
                      <div className="flex items-center gap-1.5 ml-auto flex-shrink-0">
                        <button
                          onClick={() => onKpiLockToggle(kpi.kpi_id)}
                          type="button"
                          className={`p-1 rounded border transition-all ${
                            isKpiLocked
                              ? "bg-slate-800 text-white border-slate-800 shadow-sm"
                              : "bg-white text-slate-400 border-slate-200 hover:text-slate-600 hover:bg-slate-50"
                          }`}
                          title={isKpiLocked ? "Unlock KPI weight" : "Lock KPI weight"}
                        >
                          {isKpiLocked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
                        </button>
                        
                        <div className="flex items-center bg-slate-50 border border-slate-200 rounded-lg px-1.5 py-0.5 w-16 focus-within:border-slate-400 focus-within:bg-white transition-colors">
                          <WeightInput
                            value={kpi.weight ?? 0}
                            disabled={isKpiLocked}
                            onChange={(val) => onKpiWeightChange(kra.kra_id, kpi.kpi_id, val)}
                            className="w-full bg-transparent text-xs font-semibold text-slate-700 text-center outline-none border-none disabled:opacity-60"
                          />
                          <span className="text-xs font-semibold text-slate-400 select-none">%</span>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
              
              {/* KPI total weight warning/success status */}
              <div className="flex items-center justify-between text-[11px] font-semibold pt-1">
                <span className="text-slate-500">KPI Weights Sum (must be 100%):</span>
                <span className={`px-2 py-0.5 rounded ${
                  Math.abs(kra.kpis.reduce((s, kp) => s + (kp.weight ?? 0), 0) - 100) <= 1
                    ? "bg-emerald-50 text-emerald-700" 
                    : "bg-amber-50 text-amber-700"
                }`}>
                  {kra.kpis.reduce((s, kp) => s + (kp.weight ?? 0), 0)}% 
                  {Math.abs(kra.kpis.reduce((s, kp) => s + (kp.weight ?? 0), 0) - 100) > 1 && " ✕"}
                  {Math.abs(kra.kpis.reduce((s, kp) => s + (kp.weight ?? 0), 0) - 100) <= 1 && " ✓"}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Step3WeightAdjustment({
  initialKras, onSave, onBack,
}: {
  initialKras: FinalKRA[];
  onSave: (kras: FinalKRA[], confirm: boolean) => void;
  onBack: () => void;
}) {
  // Initialize: if weights are null, distribute equally
  const initializeWeights = (kras: FinalKRA[]): FinalKRA[] => {
    const hasNulls = kras.some((k) => k.weight === null || k.weight === undefined);
    let updatedKras = kras;
    if (hasNulls) {
      const base = Math.floor(100 / kras.length);
      const remainder = 100 - base * kras.length;
      updatedKras = kras.map((k, i) => ({ ...k, weight: base + (i === 0 ? remainder : 0) }));
    }
    
    // Auto-initialize KPI weights to add up to 100% within each KRA
    return updatedKras.map((k) => {
      const kpis = k.kpis || [];
      if (kpis.length === 0) return k;
      const hasKpiNulls = kpis.some((kp: any) => kp.weight === null || kp.weight === undefined || kp.weight === 0);
      if (!hasKpiNulls) return k;
      const baseKpi = Math.floor(100 / kpis.length);
      const remainderKpi = 100 - baseKpi * kpis.length;
      const updatedKpis = kpis.map((kp: any, idx: number) => ({
        ...kp,
        weight: baseKpi + (idx === 0 ? remainderKpi : 0)
      }));
      return { ...k, kpis: updatedKpis };
    });
  };

  const [kras, setKras] = useState<FinalKRA[]>(initializeWeights(initialKras));
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [lockedIds, setLockedIds] = useState<Set<string>>(new Set());
  const [lockedKpiIds, setLockedKpiIds] = useState<Set<string>>(new Set());

  const total = kras.reduce((s, k) => s + (k.weight ?? 0), 0);
  const isKraTotalValid = Math.abs(total - 100) <= 1;

  const isKpisTotalValid = kras.every((kra) => {
    const kpiSum = kra.kpis?.reduce((sum, kp) => sum + (kp.weight ?? 0), 0) ?? 0;
    return kra.kpis?.length === 0 || Math.abs(kpiSum - 100) <= 1;
  });

  const isValidToSave = isKraTotalValid && isKpisTotalValid;

  const handleLockToggle = (id: string) => {
    setLockedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleKpiLockToggle = (id: string) => {
    setLockedKpiIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleKpisReorder = (kraId: string, reorderedKpis: any[]) => {
    setKras((prev) =>
      prev.map((k) => (k.kra_id === kraId ? { ...k, kpis: reorderedKpis } : k))
    );
  };

  const handleKpiWeightChange = (kraId: string, kpiId: string, newW: number) => {
    if (lockedKpiIds.has(kpiId)) return;
    const val = Math.max(0, Math.min(100, isNaN(newW) ? 0 : newW));

    setKras((prev) =>
      prev.map((k) => {
        if (k.kra_id !== kraId) return k;
        
        const updatedKpis = k.kpis.map((kp) =>
          kp.kpi_id === kpiId ? { ...kp, weight: val } : kp
        );
        
        const othersUnlocked = updatedKpis.filter(
          (kp) => kp.kpi_id !== kpiId && !lockedKpiIds.has(kp.kpi_id)
        );
        
        if (othersUnlocked.length > 0) {
          const lockedTotal = updatedKpis
            .filter((kp) => kp.kpi_id !== kpiId && lockedKpiIds.has(kp.kpi_id))
            .reduce((s, kp) => s + (kp.weight ?? 0), 0);
            
          const targetUnlockedTotal = Math.max(0, 100 - (lockedTotal + val));
          const othersUnlockedTotal = othersUnlocked.reduce((s, kp) => s + (kp.weight ?? 0), 0);
          
          let currentSum = val + lockedTotal;
          const nextKpis = updatedKpis.map((kp) => {
            if (kp.kpi_id === kpiId || lockedKpiIds.has(kp.kpi_id)) {
              return kp;
            }
            const newWeight = othersUnlockedTotal > 0
              ? Math.round(((kp.weight ?? 0) / othersUnlockedTotal) * targetUnlockedTotal)
              : Math.round(targetUnlockedTotal / othersUnlocked.length);
            currentSum += newWeight;
            return { ...kp, weight: newWeight };
          });
          
          const roundingDiff = 100 - currentSum;
          if (roundingDiff !== 0) {
            const target = nextKpis.find(
              (kp) => kp.kpi_id !== kpiId && !lockedKpiIds.has(kp.kpi_id)
            );
            if (target) {
              target.weight = Math.max(0, (target.weight ?? 0) + roundingDiff);
            }
          }
          return { ...k, kpis: nextKpis };
        }
        return { ...k, kpis: updatedKpis };
      })
    );
  };

  const handleWeightChange = (id: string, newW: number) => {
    if (lockedIds.has(id)) return;
    const val = Math.max(0, Math.min(100, isNaN(newW) ? 0 : newW));

    setKras((prev) => {
      const updated = prev.map((k) => (k.kra_id === id ? { ...k, weight: val } : k));
      
      const othersUnlocked = updated.filter((k) => k.kra_id !== id && !lockedIds.has(k.kra_id));
      
      if (othersUnlocked.length > 0) {
        const lockedTotal = updated
          .filter((k) => k.kra_id !== id && lockedIds.has(k.kra_id))
          .reduce((s, k) => s + (k.weight ?? 0), 0);
          
        const targetUnlockedTotal = Math.max(0, 100 - (lockedTotal + val));
        const othersUnlockedTotal = othersUnlocked.reduce((s, k) => s + (k.weight ?? 0), 0);
        
        let currentSum = val + lockedTotal;
        const nextKras = updated.map((k) => {
          if (k.kra_id === id || lockedIds.has(k.kra_id)) {
            return k;
          }
          const newWeight = othersUnlockedTotal > 0
            ? Math.round(((k.weight ?? 0) / othersUnlockedTotal) * targetUnlockedTotal)
            : Math.round(targetUnlockedTotal / othersUnlocked.length);
          currentSum += newWeight;
          return { ...k, weight: newWeight };
        });
        
        const roundingDiff = 100 - currentSum;
        if (roundingDiff !== 0) {
          const target = nextKras.find((k) => k.kra_id !== id && !lockedIds.has(k.kra_id));
          if (target) {
            target.weight = Math.max(0, (target.weight ?? 0) + roundingDiff);
          }
        }
        return nextKras;
      } else {
        return updated;
      }
    });
  };

  const handleDragOverKRA = (index: number) => {
    if (dragFrom === null || dragFrom === index) return;
    setKras((prev) => {
      const reordered = [...prev];
      const [moved] = reordered.splice(dragFrom, 1);
      reordered.splice(index, 0, moved);
      return reordered;
    });
    setDragFrom(index);
  };

  const handleSave = async (confirm: boolean) => {
    if (confirm) setConfirming(true);
    else setSaving(true);
    await onSave(kras, confirm);
    setConfirming(false);
    setSaving(false);
  };

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-surface-600">
          Assign weights to each KRA — they must add up to <strong>100%</strong>. Drag to reorder.
        </p>
        <p className="text-xs text-surface-400 mt-0.5">
          Once you confirm, you can send the framework for manager approval.
        </p>
      </div>

      <WeightBar kras={kras} />

      <div className={`flex items-center justify-between text-sm font-semibold px-3 py-2 rounded-lg ${isKraTotalValid ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
        <span className="flex items-center gap-1.5">
          <BarChart3 className="w-4 h-4" /> Total Weight
        </span>
        <span>{total}% {Math.abs(total - 100) > 1 ? `(need ${100 - total > 0 ? "+" : ""}${100 - total}% more)` : "✓"}</span>
      </div>

      {!isKpisTotalValid && (
        <div className="flex items-center gap-2 text-xs font-semibold px-3 py-2 bg-amber-50 text-amber-700 rounded-lg border border-amber-200">
          <AlertTriangle className="w-4.5 h-4.5 text-amber-500 shrink-0 mt-0.5" />
          <span>KPI weights inside each KRA must sum to exactly 100%. Please expand each KRA to set them correctly.</span>
        </div>
      )}

      <div className="space-y-3">
        {kras.map((kra, i) => (
          <DraggableKRARow
            key={kra.kra_id}
            kra={kra}
            index={i}
            onWeightChange={handleWeightChange}
            onDragStart={(idx) => setDragFrom(idx)}
            onDragOver={handleDragOverKRA}
            onDragEnd={() => setDragFrom(null)}
            isDragging={dragFrom === i}
            isLocked={lockedIds.has(kra.kra_id)}
            onLockToggle={handleLockToggle}
            onKpisReorder={handleKpisReorder}
            onKpiWeightChange={handleKpiWeightChange}
            lockedKpiIds={lockedKpiIds}
            onKpiLockToggle={handleKpiLockToggle}
          />
        ))}
      </div>

      <div className="flex gap-3">
        <button
          onClick={onBack}
          className="px-4 py-2.5 text-sm font-medium text-surface-600 border border-surface-200 rounded-xl hover:bg-surface-50 flex items-center gap-1.5 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <button
          onClick={() => handleSave(false)}
          disabled={saving || confirming || !isValidToSave}
          className="flex-1 py-2.5 text-sm font-medium text-surface-700 border border-surface-200 rounded-xl hover:bg-surface-50 disabled:opacity-40 transition-colors"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : "Save Draft"}
        </button>
        <button
          onClick={() => handleSave(true)}
          disabled={saving || confirming || !isValidToSave}
          className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-primary-600 text-white rounded-xl font-medium text-sm hover:bg-primary-700 disabled:opacity-40 transition-colors"
        >
          {confirming ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <><CheckCircle2 className="w-4 h-4" /> Confirm KRA/KPI</>
          )}
        </button>
      </div>
    </div>
  );
}

// ── Uploaded View (Admin Uploaded) ──────────────────────────────────────────

function UploadedView({ record }: { record: KRAKPIRecord }) {
  const kras = record.kras?.kras ?? [];
  const [openId, setOpenId] = useState<string | null>(kras[0]?.title ?? null);

  const totalKpis = kras.reduce((acc, kra) => acc + (kra.kpis?.length ?? 0), 0);
  const totalWeight = kras.reduce((acc, kra) => acc + (typeof kra.weight === "number" ? kra.weight : 0), 0);

  const ACCENT_COLORS = [
    { border: "border-l-indigo-500", badge: "bg-indigo-50 text-indigo-700 border-indigo-200", ring: "ring-indigo-100", bar: "bg-indigo-500" },
    { border: "border-l-violet-500", badge: "bg-violet-50 text-violet-700 border-violet-200", ring: "ring-violet-100", bar: "bg-violet-500" },
    { border: "border-l-emerald-500",badge: "bg-emerald-50 text-emerald-700 border-emerald-200",ring: "ring-emerald-100",bar: "bg-emerald-500" },
    { border: "border-l-amber-500",  badge: "bg-amber-50 text-amber-700 border-amber-200", ring: "ring-amber-100", bar: "bg-amber-500" },
    { border: "border-l-rose-500",   badge: "bg-rose-50 text-rose-700 border-rose-200",   ring: "ring-rose-100",  bar: "bg-rose-500" },
  ];

  return (
    <div className="space-y-5">
      {/* Stats Row */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "KRAs", value: kras.length, icon: "🎯" },
          { label: "KPIs", value: totalKpis, icon: "📊" },
          { label: "Weight", value: `${totalWeight}%`, icon: "⚖️" },
        ].map((stat) => (
          <div key={stat.label} className="bg-white rounded-2xl border border-surface-150 p-4 text-center shadow-sm">
            <div className="text-xl mb-1">{stat.icon}</div>
            <div className="text-2xl font-black text-surface-900 leading-none">{stat.value}</div>
            <div className="text-[10px] text-surface-400 font-semibold uppercase tracking-wider mt-0.5">{stat.label}</div>
          </div>
        ))}
      </div>

      {/* Admin Upload Notice */}
      <div className="flex items-center gap-2.5 px-4 py-2.5 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-700">
        <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
        <span>Your performance framework was set by HR/Admin. Contact your manager to discuss these goals.</span>
      </div>

      {/* KRA Accordion */}
      <div className="space-y-2.5">
        {kras.map((kra, i) => {
          const accent = ACCENT_COLORS[i % ACCENT_COLORS.length];
          const isOpen = openId === kra.title;
          const kpis = kra.kpis ?? [];
          const weight = typeof kra.weight === "number" ? kra.weight : null;

          return (
            <div
              key={i}
              className={`bg-white rounded-xl border border-surface-100 border-l-4 ${accent.border} overflow-hidden shadow-sm transition-shadow ${isOpen ? "shadow-md" : "hover:shadow-md"}`}
            >
              {/* Header */}
              <button
                onClick={() => setOpenId(isOpen ? null : kra.title)}
                className="w-full flex items-center gap-3 p-4 text-left"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-surface-400">
                      KRA {i + 1}
                    </span>
                    {weight !== null && (
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${accent.badge}`}>
                        {weight}%
                      </span>
                    )}
                  </div>
                  <h4 className="text-sm font-bold text-surface-900 mt-0.5 leading-snug pr-4">{kra.title}</h4>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[10px] text-surface-400 font-medium">{kpis.length} KPI{kpis.length !== 1 ? "s" : ""}</span>
                  {isOpen ? <ChevronUp className="w-4 h-4 text-surface-400" /> : <ChevronDown className="w-4 h-4 text-surface-400" />}
                </div>
              </button>

              {/* Weight progress bar */}
              {weight !== null && isOpen && (
                <div className="px-4 pb-1">
                  <div className="h-1 bg-surface-100 rounded-full overflow-hidden">
                    <div className={`h-full ${accent.bar} rounded-full transition-all duration-500`} style={{ width: `${Math.min(weight, 100)}%` }} />
                  </div>
                </div>
              )}

              {/* KPI List */}
              {isOpen && (
                <div className="px-4 pb-4 pt-2 border-t border-surface-50 animate-in slide-in-from-top-1 duration-150">
                  {kra.description && (
                    <p className="text-xs text-surface-500 leading-relaxed mb-3 italic">{kra.description}</p>
                  )}
                  <div className="space-y-2">
                    {kpis.map((kpi: any, kIdx: number) => (
                      <div
                        key={kIdx}
                        className={`flex gap-3 p-3 rounded-xl bg-surface-50/80 border border-surface-100 hover:border-surface-200 transition-colors`}
                      >
                        <span className={`flex-shrink-0 w-6 h-6 rounded-lg ${accent.badge} flex items-center justify-center text-[10px] font-black border`}>
                          {kIdx + 1}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-surface-800 leading-snug">{kpi.title}</p>
                          {kpi.description && (
                            <p className="text-[11px] text-surface-500 mt-0.5 leading-relaxed">{kpi.description}</p>
                          )}
                          {kpi.target_date && (
                            <div className="flex items-center gap-1 mt-1.5">
                              <span className="text-[10px] text-surface-400 font-medium">🗓 Target:</span>
                              <span className="text-[10px] font-bold text-surface-600 bg-surface-100 px-1.5 py-0.5 rounded-md">{kpi.target_date}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}


// ── Confirmed View ────────────────────────────────────────────────────────────

function ConfirmedView({
  record,
  onRegenerate,
  onSendForApproval,
}: {
  record: KRAKPIRecord;
  onRegenerate: () => void;
  onSendForApproval: () => Promise<void>;
}) {
  const kras = record.kras?.kras ?? [];
  const [openId, setOpenId] = useState<string | null>(kras[0]?.kra_id ?? null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  // Compute stats
  const totalKpis = kras.reduce((acc, kra) => acc + (kra.kpis?.length ?? 0), 0);
  const totalWeight = kras.reduce((acc, kra) => acc + (kra.weight ?? 0), 0);

  const status = record.status || "confirmed";

  const statusConfig: Record<string, { gradient: string; title: string; badge: string; badgeColor: string }> = {
    confirmed: {
      gradient: "from-slate-900 via-slate-800 to-blue-950",
      title: "KRA/KPI Framework Ready",
      badge: "Confirmed",
      badgeColor: "bg-blue-500/20 text-blue-300 border-blue-500/30",
    },
    sent_to_manager: {
      gradient: "from-slate-900 via-slate-800 to-blue-950",
      title: "Awaiting Manager Review",
      badge: "Under Review",
      badgeColor: "bg-amber-500/20 text-amber-300 border-amber-500/30",
    },
    manager_rejected: {
      gradient: "from-slate-900 via-slate-800 to-blue-950",
      title: "Manager Requested Revisions",
      badge: "Needs Revision",
      badgeColor: "bg-rose-500/20 text-rose-300 border-rose-500/30",
    },
    sent_to_hr: {
      gradient: "from-slate-900 via-slate-800 to-blue-950",
      title: "Awaiting HR Review",
      badge: "HR Review",
      badgeColor: "bg-purple-500/20 text-purple-300 border-purple-500/30",
    },
    hr_rejected: {
      gradient: "from-slate-900 via-slate-800 to-blue-950",
      title: "HR Requested Revisions",
      badge: "Needs Revision",
      badgeColor: "bg-rose-500/20 text-rose-300 border-rose-500/30",
    },
    approved: {
      gradient: "from-slate-900 via-slate-800 to-blue-950",
      title: "Performance Framework Approved",
      badge: "Approved & Active",
      badgeColor: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
    },
    draft: {
      gradient: "from-slate-900 via-slate-800 to-blue-950",
      title: "KRA/KPI Draft",
      badge: "Draft",
      badgeColor: "bg-slate-500/20 text-slate-300 border-slate-500/30",
    },
  };

  const cfg = statusConfig[status] ?? statusConfig["confirmed"];
  const canSendForApproval = status === "confirmed" && Math.abs(totalWeight - 100) <= 1;
  const isUnderReview = ["sent_to_manager", "sent_to_hr"].includes(status);
  const isRejected = ["manager_rejected", "hr_rejected"].includes(status);

  const handleSend = async () => {
    setSending(true);
    setSendError(null);
    try {
      await onSendForApproval();
    } catch (e: any) {
      setSendError(e.message || "Failed to send for approval");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Hero Status Banner */}
      <div className={`bg-gradient-to-br ${cfg.gradient} rounded-2xl p-5 text-white shadow-lg relative overflow-hidden`}>
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-0 right-0 w-48 h-48 bg-white rounded-full blur-3xl -translate-y-1/2 translate-x-1/4" />
          <div className="absolute bottom-0 left-0 w-40 h-40 bg-white rounded-full blur-3xl translate-y-1/2 -translate-x-1/4" />
        </div>
        <div className="relative z-10">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-white/15 backdrop-blur flex items-center justify-center">
                {status === "approved" ? (
                  <CheckCircle2 className="w-5 h-5 text-white" />
                ) : isRejected ? (
                  <AlertTriangle className="w-5 h-5 text-white" />
                ) : (
                  <Target className="w-5 h-5 text-white" />
                )}
              </div>
              <div>
                <p className="text-[10px] font-bold tracking-[0.15em] text-white/70 uppercase">KRA/KPI Status</p>
                <h3 className="text-sm font-bold text-white leading-tight">{cfg.title}</h3>
              </div>
            </div>
            <span className={`text-[11px] font-semibold px-3 py-1.5 rounded-lg ${cfg.badgeColor} backdrop-blur-sm border`}>
              {cfg.badge}
            </span>
          </div>

          <div className="grid grid-cols-3 gap-3 pt-3 border-t border-white/10">
            <div className="text-center">
              <span className="text-xl font-black leading-none">{kras.length}</span>
              <p className="text-[10px] text-white/70 mt-0.5 font-medium">KRAs</p>
            </div>
            <div className="text-center border-x border-white/10">
              <span className="text-xl font-black leading-none">{totalKpis}</span>
              <p className="text-[10px] text-white/70 mt-0.5 font-medium">KPIs</p>
            </div>
            <div className="text-center">
              <span className="text-xl font-black leading-none">{totalWeight}%</span>
              <p className="text-[10px] text-white/70 mt-0.5 font-medium">Weight</p>
            </div>
          </div>
        </div>
      </div>

      {/* Rejection Comment */}
      {isRejected && record.reviewer_comment && (
        <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 flex gap-3">
          <AlertTriangle className="w-4 h-4 text-rose-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-bold text-rose-800 mb-1">
              {status === "hr_rejected" ? "HR" : "Manager"} Revision Request
            </p>
            <p className="text-xs text-rose-700 leading-relaxed">{record.reviewer_comment}</p>
          </div>
        </div>
      )}

      {/* Send for Approval CTA — only shown when confirmed & weights = 100 */}
      {canSendForApproval && (
        <div className="bg-gradient-to-r from-primary-50 to-indigo-50 border border-primary-200 rounded-xl p-4 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <div className="w-8 h-8 bg-primary-100 rounded-lg flex items-center justify-center shrink-0">
              <Sparkles className="w-4 h-4 text-primary-600" />
            </div>
            <div>
              <p className="text-sm font-semibold text-primary-900">Ready for Manager Review</p>
              <p className="text-xs text-primary-600 mt-0.5">Your KRA/KPI framework is confirmed. Send it to your manager for approval.</p>
            </div>
          </div>
          <button
            onClick={handleSend}
            disabled={sending}
            className="w-full sm:w-auto flex items-center justify-center gap-2 px-5 py-2.5 bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold rounded-xl transition-all shadow-md shadow-primary-600/25 active:scale-[0.98] disabled:opacity-50 whitespace-nowrap"
          >
            {sending ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Sending…</>
            ) : (
              <><ArrowRight className="w-4 h-4" /> Send for Approval</>
            )}
          </button>
        </div>
      )}

      {sendError && (
        <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{sendError}</div>
      )}

      {/* Under Review Status */}
      {isUnderReview && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-center gap-3">
          <Loader2 className="w-4 h-4 text-blue-500 animate-spin shrink-0" />
          <div>
            <p className="text-xs font-bold text-blue-800">Awaiting {status === "sent_to_hr" ? "HR" : "Manager"} Review</p>
            <p className="text-xs text-blue-600 mt-0.5">Your framework has been submitted and is under review.</p>
          </div>
        </div>
      )}

      {/* Weight Distribution */}
      <div className="bg-white border border-surface-200/70 rounded-xl p-4 shadow-sm space-y-2.5">
        <h4 className="text-xs font-bold text-surface-700 uppercase tracking-wider flex items-center gap-1.5">
          <BarChart3 className="w-3.5 h-3.5 text-primary-500" /> Weight Distribution
        </h4>
        <WeightBar kras={kras} />
      </div>

      {/* KRAs Accordion */}
      <div className="space-y-2.5">
        {kras.map((kra, i) => {
          const c = PALETTE[i % PALETTE.length];
          const isOpen = openId === kra.kra_id;
          return (
            <div
              key={kra.kra_id}
              className={`rounded-xl border-2 transition-all duration-200 ${
                isOpen
                  ? `${c.border} ${c.bg} shadow-md`
                  : "border-surface-100 bg-white hover:border-surface-200 hover:shadow-sm"
              }`}
            >
              <button
                onClick={() => setOpenId(isOpen ? null : kra.kra_id)}
                className="w-full flex items-center gap-3 px-4 py-3.5 text-left"
              >
                <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${c.bar}`} />
                <div className="flex-1 min-w-0">
                  <span className="font-bold text-surface-900 text-sm leading-tight block truncate">{kra.title}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full border ${c.badge} ${c.border}`}>
                    {kra.weight ?? "—"}% weight
                  </span>
                  <span className="text-xs font-semibold bg-surface-100 text-surface-600 px-2 py-1 rounded-full">
                    {kra.kpis?.length ?? 0} KPIs
                  </span>
                  <div className={`p-1 rounded transition-transform ${isOpen ? "rotate-180" : ""}`}>
                    <ChevronDown className="w-4 h-4 text-surface-400" />
                  </div>
                </div>
              </button>

              {isOpen && (
                <div className="px-4 pb-4 pt-0 border-t border-surface-200/20 space-y-3">
                  <div className={`border-l-4 ${c.bar.replace("bg-", "border-")} pl-3 py-1 mt-3`}>
                    <p className="text-xs text-surface-600 leading-relaxed">{kra.description}</p>
                  </div>

                  <div className="space-y-2">
                    <p className="text-[10px] font-bold text-surface-400 uppercase tracking-wider">Key Performance Indicators</p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                      {kra.kpis.map((kpi) => (
                        <div
                          key={kpi.kpi_id}
                          className="bg-white border border-surface-150 rounded-xl p-3.5 shadow-sm hover:shadow-md transition-shadow"
                        >
                          <div className="flex items-start justify-between gap-2 mb-2">
                            <h6 className="font-bold text-surface-800 text-xs leading-snug">{kpi.metric}</h6>
                            <div className="flex flex-col items-end gap-1 shrink-0">
                              <span className="text-[9px] font-bold bg-primary-50 text-primary-700 px-2 py-0.5 rounded-full border border-primary-100 uppercase tracking-wide">
                                {kpi.frequency}
                              </span>
                              <span className="text-[9px] font-bold bg-slate-100 text-slate-700 px-2 py-0.5 rounded-full border border-slate-250">
                                {kpi.weight ?? 0}% weight ({(((kpi.weight ?? 0) * (kra.weight ?? 0)) / 100).toFixed(1)}% overall)
                              </span>
                            </div>
                          </div>
                          <div className="bg-surface-50 rounded-lg p-2 border border-surface-100 mb-2">
                            <p className="text-[10px] font-semibold text-surface-400 uppercase tracking-wide mb-0.5">Target</p>
                            <p className="text-xs font-bold text-primary-600">{kpi.target}</p>
                          </div>
                          <div className="flex items-start gap-1.5 text-[10px] text-surface-500">
                            <TrendingUp className="w-3 h-3 text-surface-400 shrink-0 mt-0.5" />
                            <span><span className="font-semibold text-surface-600">Via: </span>{kpi.measurement_method}</span>
                          </div>
                          {kpi.threshold && (
                            <div className="mt-2 pt-2 border-t border-surface-100 grid grid-cols-3 gap-1 text-[9px]">
                              <div className="text-center">
                                <div className="font-bold text-emerald-600 mb-0.5">Excellent</div>
                                <div className="text-surface-600 leading-tight">{kpi.threshold.excellent}</div>
                              </div>
                              <div className="text-center border-x border-surface-100">
                                <div className="font-bold text-blue-600 mb-0.5">Meets</div>
                                <div className="text-surface-600 leading-tight">{kpi.threshold.meets_expectation}</div>
                              </div>
                              <div className="text-center">
                                <div className="font-bold text-rose-500 mb-0.5">Below</div>
                                <div className="text-surface-600 leading-tight">{kpi.threshold.below_expectation}</div>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <button
        onClick={onRegenerate}
        className="flex items-center gap-1.5 text-xs text-surface-400 hover:text-surface-600 transition-colors mx-auto bg-surface-50 hover:bg-surface-100 border border-surface-200 rounded-lg px-3.5 py-2"
      >
        <RefreshCw className="w-3.5 h-3.5" /> Regenerate from scratch
      </button>
    </div>
  );
}

// ── Main Panel ────────────────────────────────────────────────────────────────

interface KRAKPIPanelProps {
  jdSessionId: string;
  employeeId: string;
  isManager?: boolean;
}

export function KRAKPIPanel({ jdSessionId, employeeId, isManager = false }: KRAKPIPanelProps) {
  const [record, setRecord] = useState<KRAKPIRecord | null>(null);
  const [prereqStatus, setPrereqStatus] = useState<PrerequisiteStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showBypassModal, setShowBypassModal] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [existing, status] = await Promise.all([
        fetchKRAKPI(jdSessionId).catch(() => null),
        fetchKRAKPIStatus(jdSessionId, employeeId).catch(() => null),
      ]);
      setRecord(existing);
      setPrereqStatus(status);
    } catch (e: any) {
      setError(e.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [jdSessionId, employeeId]);

  useEffect(() => { reload(); }, [reload]);

  const hasOnlyManagerMissing =
    prereqStatus &&
    !prereqStatus.ready &&
    prereqStatus.missing.length > 0 &&
    !prereqStatus.missing.includes("employee_jd");

  const handleGenerate = async (bypassManager: boolean = false) => {
    setGenerating(true);
    setError(null);
    setShowBypassModal(false);
    try {
      // Auto-bypass if manager is missing
      const actualBypass = bypassManager || (hasOnlyManagerMissing ? true : false);
      await generateKRASuggestions(jdSessionId, employeeId, actualBypass);
      await reload();
    } catch (e: any) {
      setError(e.message || "Generation failed");
    } finally {
      setGenerating(false);
    }
  };

  const handleSelectKRAs = async (ids: string[]) => {
    setError(null);
    try {
      await selectKRAs(jdSessionId, ids);
      await reload();
    } catch (e: any) {
      setError(e.message || "KRA selection failed");
    }
  };

  const handleSelectKPIs = async (selected: Record<string, string[]>) => {
    setError(null);
    try {
      await selectKPIs(jdSessionId, selected);
      await reload();
    } catch (e: any) {
      setError(e.message || "KPI selection failed");
    }
  };

  const handleSaveWeights = async (kras: FinalKRA[], confirm: boolean) => {
    setError(null);
    try {
      await saveKRAWeights(jdSessionId, kras, confirm);
      await reload();
    } catch (e: any) {
      setError(e.message || "Failed to save weights");
    }
  };

  const handleRegenerate = () => {
    if (hasOnlyManagerMissing) {
      handleGenerate(true);
    } else {
      handleGenerate(false);
    }
  };

  const handleSendForApproval = async () => {
    await sendKRAKPIForApproval(jdSessionId);
    await reload();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-5 h-5 animate-spin text-primary-500 mr-2" />
        <span className="text-sm text-surface-500">Loading…</span>
      </div>
    );
  }

  const step = record?.generation_step ?? "kra_selection";
  const canGenerate = prereqStatus?.ready === true;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Target className="w-5 h-5 text-primary-600" />
          <h2 className="text-lg font-semibold text-surface-900">KRA / KPI Framework</h2>
        </div>
        {record && step !== "confirmed" && (
          <button
            onClick={() => handleGenerate(false)}
            disabled={generating}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-surface-500 border border-surface-200 rounded-lg hover:bg-surface-50 disabled:opacity-50 transition-colors"
          >
            {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Restart
          </button>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {/* No record: prerequisite check */}
      {!record && !generating && prereqStatus && (
        <>
          {canGenerate ? (
            <div className="text-center py-14 bg-gradient-to-br from-primary-50/30 to-violet-50/20 border border-primary-100 rounded-[2rem] shadow-sm">
              <Sparkles className="w-12 h-12 text-primary-400 mx-auto mb-3 animate-pulse" />
              <h3 className="text-base font-semibold text-surface-900 mb-1">Framework Ready</h3>
              <p className="text-surface-500 text-xs mb-5 max-w-sm mx-auto">
                Ready to generate your personal performance alignment KRA and KPI suggestions.
              </p>
              <button
                onClick={() => handleGenerate(false)}
                className="px-6 py-3 bg-primary-600 text-white text-sm font-semibold rounded-xl hover:bg-primary-700 transition-all shadow-md shadow-primary-600/20 active:scale-[0.98] flex items-center gap-2 mx-auto"
              >
                <Sparkles className="w-4 h-4" /> Generate KRA Suggestions
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <MissingBanner status={prereqStatus} />
              {hasOnlyManagerMissing && (
                <div className="p-4 bg-primary-50/60 border border-primary-200/50 rounded-xl flex flex-col sm:flex-row items-center justify-between gap-4">
                  <div className="flex items-start gap-2.5">
                    <Info className="w-4.5 h-4.5 text-primary-600 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-xs text-primary-800 font-semibold mb-0.5">Generate from your JD only</p>
                      <p className="text-[11px] text-primary-600">
                        You can continue generating your performance framework based solely on your own approved JD context, bypassing manager alignment references.
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => setShowBypassModal(true)}
                    className="w-full sm:w-auto px-4 py-2.5 bg-primary-600 hover:bg-primary-700 text-white text-xs font-semibold rounded-lg transition-colors shadow-sm whitespace-nowrap active:scale-[0.98]"
                  >
                    Continue Anyway
                  </button>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Generating spinner */}
      {generating && (
        <div className="rounded-xl border border-primary-200 bg-primary-50 p-8 text-center">
          <Loader2 className="w-8 h-8 animate-spin text-primary-500 mx-auto mb-3" />
          <p className="text-sm font-medium text-primary-700">Analysing your JD and generating KRA suggestions…</p>
          <p className="text-xs text-primary-400 mt-1">This may take 10–20 seconds</p>
        </div>
      )}

      {/* Step flow */}
      {record && !generating && (
        <>
          {step !== "confirmed" && <StepBar current={step} />}

          {step === "kra_selection" && record.kra_suggestions && (
            <Step1KRASelection
              suggestions={record.kra_suggestions.kra_suggestions}
              onContinue={handleSelectKRAs}
            />
          )}

          {step === "kpi_selection" && record.kpi_suggestions && record.selected_kra_ids && (
            <Step2KPISelection
              selectedKras={record.selected_kra_ids}
              kpiSuggestions={record.kpi_suggestions}
              krasSuggestions={record.kra_suggestions?.kra_suggestions ?? []}
              onContinue={handleSelectKPIs}
              onBack={handleGenerate}
            />
          )}

          {step === "weight_adjustment" && record.kras && (
            <Step3WeightAdjustment
              initialKras={record.kras.kras}
              onSave={handleSaveWeights}
              onBack={() => {
                /* allow going back to KPI selection */
                setRecord((prev) => prev ? { ...prev, generation_step: "kpi_selection" } : prev);
              }}
            />
          )}

          {step === "confirmed" && (
            <ConfirmedView
              record={record}
              onRegenerate={handleRegenerate}
              onSendForApproval={handleSendForApproval}
            />
          )}

          {step === "uploaded" && (
            <UploadedView record={record} />
          )}
        </>
      )}

      {/* Bypass confirmation modal */}
      {showBypassModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="bg-white rounded-3xl p-6 sm:p-8 max-w-md w-full border border-surface-200 shadow-2xl relative animate-in zoom-in-95 duration-300">
            <div className="flex items-center justify-center w-12 h-12 bg-amber-50 rounded-2xl mb-6">
              <AlertTriangle className="w-6 h-6 text-amber-500" />
            </div>
            <h3 className="text-xl font-bold text-surface-900 mb-3">
              Generate without Manager Alignment?
            </h3>
            <p className="text-surface-600 text-sm leading-relaxed mb-6">
              Your reporting manager's Job Description or KRA/KPI framework is currently missing.
              <br /><br />
              If you continue, the AI will generate your KRAs and KPIs using <strong>only your approved JD</strong> as reference. You won't have parent alignment metrics, but you can complete your dashboard setup.
            </p>
            <div className="flex flex-col sm:flex-row gap-3">
              <button
                onClick={() => setShowBypassModal(false)}
                className="flex-1 px-4 py-2.5 bg-surface-100 hover:bg-surface-200 text-surface-700 rounded-xl text-sm font-semibold transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleGenerate(true)}
                className="flex-1 px-4 py-2.5 bg-primary-600 hover:bg-primary-700 text-white rounded-xl text-sm font-semibold transition-colors shadow-md shadow-primary-600/20 text-center"
              >
                Yes, Generate Anyway
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
