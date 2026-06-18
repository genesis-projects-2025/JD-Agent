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
  type KRASuggestion,
  type KPISuggestion,
  type FinalKRA,
  type KRAKPIRecord,
  type PrerequisiteStatus,
  type GenerationStep,
} from "@/lib/api";

// ── Colours ───────────────────────────────────────────────────────────────────

const PALETTE = [
  { bg: "bg-violet-50", border: "border-violet-200", badge: "bg-violet-100 text-violet-700", bar: "bg-violet-500", check: "accent-violet-600" },
  { bg: "bg-blue-50",   border: "border-blue-200",   badge: "bg-blue-100 text-blue-700",     bar: "bg-blue-500",   check: "accent-blue-600" },
  { bg: "bg-emerald-50",border: "border-emerald-200",badge: "bg-emerald-100 text-emerald-700",bar: "bg-emerald-500",check: "accent-emerald-600" },
  { bg: "bg-orange-50", border: "border-orange-200", badge: "bg-orange-100 text-orange-700", bar: "bg-orange-500", check: "accent-orange-600" },
  { bg: "bg-rose-50",   border: "border-rose-200",   badge: "bg-rose-100 text-rose-700",     bar: "bg-rose-500",   check: "accent-rose-600" },
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
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${c.badge}`}>
              ~{kra.suggested_weight}% suggested
            </span>
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
            The AI suggested these from your JD. Manager's KRAs were used only to prioritise weights.
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

function DraggableKRARow({
  kra, index, onWeightChange, onDragStart, onDragOver, onDrop, isDragging,
}: {
  kra: FinalKRA;
  index: number;
  onWeightChange: (id: string, w: number) => void;
  onDragStart: (i: number) => void;
  onDragOver: (i: number) => void;
  onDrop: () => void;
  isDragging: boolean;
}) {
  const c = PALETTE[index % PALETTE.length];
  const [kpiOpen, setKpiOpen] = useState(false);

  return (
    <div
      draggable
      onDragStart={() => onDragStart(index)}
      onDragOver={(e) => { e.preventDefault(); onDragOver(index); }}
      onDrop={onDrop}
      className={`rounded-xl border-2 ${c.border} ${c.bg} transition-all ${isDragging ? "opacity-40 scale-[0.98]" : "opacity-100"}`}
    >
      <div className="flex items-start gap-3 p-4">
        {/* Drag handle */}
        <div className="flex-shrink-0 cursor-grab active:cursor-grabbing pt-1 text-surface-300 hover:text-surface-500">
          <GripVertical className="w-4 h-4" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <span className="font-semibold text-surface-900 text-sm">{kra.title}</span>
            <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${c.badge}`}>{kra.weight}%</span>
          </div>
          <p className="text-xs text-surface-500 mb-3">{kra.description}</p>

          {/* Weight slider */}
          <div className="flex items-center gap-3">
            <span className="text-xs text-surface-400 w-8">0%</span>
            <input
              type="range"
              min={5}
              max={60}
              value={kra.weight}
              onChange={(e) => onWeightChange(kra.kra_id, parseInt(e.target.value))}
              className="flex-1 h-1.5 rounded-full appearance-none bg-surface-200 cursor-pointer"
              style={{ accentColor: PALETTE[index % PALETTE.length].bar.replace("bg-", "").includes("violet") ? "#7c3aed" : undefined }}
            />
            <span className="text-xs text-surface-400 w-8 text-right">60%</span>
          </div>

          {/* KPI toggle */}
          <button
            onClick={() => setKpiOpen(!kpiOpen)}
            className="flex items-center gap-1 mt-2 text-xs text-surface-400 hover:text-surface-600 transition-colors"
          >
            {kpiOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            {kra.kpis.length} KPIs
          </button>

          {kpiOpen && (
            <ul className="mt-2 space-y-1">
              {kra.kpis.map((kpi) => (
                <li key={kpi.kpi_id} className="text-xs flex items-start gap-1.5">
                  <span className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${c.bar}`} />
                  <span className="text-surface-700 font-medium">{kpi.metric}</span>
                  <span className="text-surface-400 ml-1">— {kpi.target}</span>
                </li>
              ))}
            </ul>
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
  const [kras, setKras] = useState<FinalKRA[]>(initialKras);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const total = kras.reduce((s, k) => s + k.weight, 0);

  const handleWeightChange = (id: string, newW: number) => {
    setKras((prev) => {
      const updated = prev.map((k) => (k.kra_id === id ? { ...k, weight: newW } : k));
      // Rebalance: distribute remainder to others proportionally
      const thisTotal = updated.reduce((s, k) => s + k.weight, 0);
      const diff = 100 - thisTotal;
      const others = updated.filter((k) => k.kra_id !== id);
      if (others.length > 0) {
        const othersTotal = others.reduce((s, k) => s + k.weight, 0);
        return updated.map((k) => {
          if (k.kra_id === id) return k;
          const share = othersTotal > 0 ? (k.weight / othersTotal) * diff : diff / others.length;
          return { ...k, weight: Math.max(5, Math.round(k.weight + share)) };
        });
      }
      return updated;
    });
  };

  const handleDrop = () => {
    if (dragFrom === null || dragOver === null || dragFrom === dragOver) return;
    const reordered = [...kras];
    const [moved] = reordered.splice(dragFrom, 1);
    reordered.splice(dragOver, 0, moved);
    setKras(reordered);
    setDragFrom(null);
    setDragOver(null);
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
          Drag KRAs to reorder them, and use the slider to adjust their weight. Weights must sum to 100%.
        </p>
      </div>

      <WeightBar kras={kras} />

      <div className={`flex items-center justify-between text-sm font-semibold px-3 py-2 rounded-lg ${Math.abs(total - 100) <= 1 ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"}`}>
        <span className="flex items-center gap-1.5">
          <BarChart3 className="w-4 h-4" /> Total Weight
        </span>
        <span>{total}%</span>
      </div>

      <div className="space-y-3">
        {kras.map((kra, i) => (
          <DraggableKRARow
            key={kra.kra_id}
            kra={kra}
            index={i}
            onWeightChange={handleWeightChange}
            onDragStart={(idx) => setDragFrom(idx)}
            onDragOver={(idx) => setDragOver(idx)}
            onDrop={handleDrop}
            isDragging={dragFrom === i}
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
          disabled={saving || confirming || Math.abs(total - 100) > 1}
          className="flex-1 py-2.5 text-sm font-medium text-surface-700 border border-surface-200 rounded-xl hover:bg-surface-50 disabled:opacity-40 transition-colors"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : "Save Draft"}
        </button>
        <button
          onClick={() => handleSave(true)}
          disabled={saving || confirming || Math.abs(total - 100) > 1}
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

// ── Confirmed View ────────────────────────────────────────────────────────────

function ConfirmedView({ record, onRegenerate }: { record: KRAKPIRecord; onRegenerate: () => void }) {
  const kras = record.kras?.kras ?? [];
  const [openId, setOpenId] = useState<string | null>(kras[0]?.kra_id ?? null);

  // Compute stats
  const totalKpis = kras.reduce((acc, kra) => acc + (kra.kpis?.length ?? 0), 0);
  const totalWeight = kras.reduce((acc, kra) => acc + (kra.weight ?? 0), 0);

  return (
    <div className="space-y-6">
      {/* Top Hero Card */}
      <div className="bg-gradient-to-br from-emerald-600 via-emerald-600 to-teal-700 rounded-3xl p-6 text-white shadow-lg shadow-emerald-700/10 relative overflow-hidden">
        {/* Glow decoration */}
        <div className="absolute top-0 right-0 p-24 bg-white/10 rounded-full blur-2xl -translate-y-1/3 translate-x-1/3 pointer-events-none" />
        <div className="absolute bottom-0 left-0 p-20 bg-emerald-400/20 rounded-full blur-2xl translate-y-1/2 -translate-x-1/2 pointer-events-none" />

        <div className="relative z-10 space-y-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-white/20 flex items-center justify-center backdrop-blur-md">
              <Lock className="w-4 h-4 text-emerald-100" />
            </div>
            <div>
              <p className="text-[10px] font-semibold tracking-[0.2em] text-emerald-200 uppercase">Status</p>
              <h3 className="text-sm font-semibold text-white">Performance Alignment Active</h3>
            </div>
            {record.confirmed_at && (
              <span className="text-[11px] font-medium text-emerald-100 bg-white/15 px-2.5 py-1 rounded-lg ml-auto backdrop-blur-sm">
                Confirmed {new Date(record.confirmed_at).toLocaleDateString("en-GB")}
              </span>
            )}
          </div>

          <div className="grid grid-cols-3 gap-4 pt-3 border-t border-white/10">
            <div>
              <span className="block text-[10px] font-medium text-emerald-200 uppercase tracking-wider mb-0.5">Accountability Areas</span>
              <span className="text-2xl font-bold leading-none">{kras.length} KRAs</span>
            </div>
            <div>
              <span className="block text-[10px] font-medium text-emerald-200 uppercase tracking-wider mb-0.5">Total KPIs</span>
              <span className="text-2xl font-bold leading-none">{totalKpis} Indicators</span>
            </div>
            <div>
              <span className="block text-[10px] font-medium text-emerald-200 uppercase tracking-wider mb-0.5">Assigned Weight</span>
              <span className="text-2xl font-bold leading-none">{totalWeight}%</span>
            </div>
          </div>
        </div>
      </div>

      {/* Visual Weight Distribution */}
      <div className="bg-white border border-surface-200/60 rounded-2xl p-5 shadow-sm space-y-3">
        <h4 className="text-xs font-semibold text-surface-800 uppercase tracking-wider flex items-center gap-1.5">
          <BarChart3 className="w-4 h-4 text-primary-500" /> Goal Weight Weighting
        </h4>
        <WeightBar kras={kras} />
      </div>

      {/* KRAs Collapsible Accordion List */}
      <div className="space-y-3">
        {kras.map((kra, i) => {
          const c = PALETTE[i % PALETTE.length];
          const isOpen = openId === kra.kra_id;
          return (
            <div
              key={kra.kra_id}
              className={`rounded-2xl border-2 transition-all duration-300 ${
                isOpen 
                  ? `${c.border} ${c.bg} shadow-md shadow-neutral-100` 
                  : "border-surface-100 bg-white hover:border-surface-200 hover:shadow-sm"
              }`}
            >
              <button
                onClick={() => setOpenId(isOpen ? null : kra.kra_id)}
                className="w-full flex items-center gap-3 px-5 py-4 text-left"
              >
                <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${c.bar}`} />
                <div className="flex-1 min-w-0">
                  <span className="font-bold text-surface-900 text-sm sm:text-base tracking-tight leading-tight block">{kra.title}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`text-[11px] font-bold px-3 py-1 rounded-full border ${c.badge} ${c.border.replace("border-", "border-")}`}>
                    {kra.weight}% weight
                  </span>
                  <span className="text-xs font-semibold bg-surface-100 text-surface-600 px-2.5 py-1 rounded-full border border-surface-200/50">
                    {kra.kpis?.length ?? 0} KPIs
                  </span>
                  <div className={`p-1 rounded-md transition-transform ${isOpen ? "rotate-180 bg-current/5" : "bg-neutral-50"}`}>
                    <ChevronDown className="w-4 h-4 text-surface-500" />
                  </div>
                </div>
              </button>

              {isOpen && (
                <div className="px-5 pb-5 border-t border-surface-200/10 pt-4 space-y-4">
                  {/* Left-bordered Description Box */}
                  <div className={`border-l-4 ${c.bar.replace("bg-", "border-")} pl-4 py-1.5`}>
                    <p className="text-xs sm:text-sm text-surface-600 leading-relaxed font-medium">
                      {kra.description}
                    </p>
                  </div>

                  {/* KPI Grid */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h5 className="text-[11px] font-semibold text-surface-500 uppercase tracking-wider">Key Performance Indicators</h5>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                      {kra.kpis.map((kpi) => (
                        <div
                          key={kpi.kpi_id}
                          className="bg-white border border-surface-150/70 rounded-xl p-4 shadow-sm hover:shadow-md transition-all flex flex-col justify-between"
                        >
                          <div className="space-y-3">
                            <div className="flex items-start justify-between gap-2">
                              <h6 className="font-bold text-surface-800 text-xs sm:text-sm leading-snug">{kpi.metric}</h6>
                              <span className="text-[9px] font-bold bg-primary-50 text-primary-700 px-2 py-0.5 rounded-full border border-primary-100 shrink-0 uppercase tracking-wide">
                                {kpi.frequency}
                              </span>
                            </div>
                            <div className="bg-surface-50/50 rounded-lg p-2.5 border border-surface-100/50">
                              <p className="text-[9px] font-semibold text-surface-400 uppercase tracking-wider mb-0.5">Target Metric</p>
                              <p className="text-xs sm:text-sm font-bold text-primary-600">{kpi.target}</p>
                            </div>
                          </div>

                          <div className="mt-3 pt-3 border-t border-surface-100/60 space-y-2">
                            <div className="flex items-start gap-1.5 text-xs text-surface-500 leading-normal">
                              <TrendingUp className="w-3.5 h-3.5 text-surface-400 shrink-0 mt-0.5" />
                              <div>
                                <span className="font-semibold text-surface-600">Measurement Method:</span>{" "}
                                <span className="text-surface-700">{kpi.measurement_method}</span>
                              </div>
                            </div>
                            {kpi.manager_kpi_alignment && 
                             kpi.manager_kpi_alignment !== "N/A" && 
                             kpi.manager_kpi_alignment !== "Not aligned" && (
                              <div className="bg-emerald-50/75 border border-emerald-100/40 rounded-lg p-2.5 text-[10px] text-emerald-800 leading-normal flex items-start gap-1.5">
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                                <div>
                                  <span className="font-bold text-emerald-900">Aligned Manager Goal:</span>{" "}
                                  <span className="text-emerald-700">{kpi.manager_kpi_alignment}</span>
                                </div>
                              </div>
                            )}
                          </div>
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
        className="flex items-center gap-1.5 text-xs text-surface-400 hover:text-surface-600 transition-colors mx-auto mt-4 bg-surface-50 hover:bg-surface-100 border border-surface-200/60 rounded-lg px-3.5 py-1.5"
      >
        <RefreshCw className="w-3.5 h-3.5" /> Regenerate performance goals from scratch
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
            <ConfirmedView record={record} onRegenerate={handleRegenerate} />
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
