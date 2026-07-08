"use client";
import { downloadKRAPdfClient, downloadKRACSVClient } from "@/lib/download-kra-export";
// frontend/components/jd/kra-kpi-panel.tsx
// 3-Step KRA/KPI Selection Flow with drag-and-drop weight adjustment.
//
// Step 1 — KRA Selection:   6–7 KRA cards → employee picks 3–5
// Step 2 — KPI Selection:   Per each selected KRA, 6–7 KPI cards → employee picks 3–5
// Step 3 — Weight Adjust:   Drag-and-drop reorder + slider weight to redistribute 100%

import { useState, useEffect, useCallback, useRef, forwardRef, useImperativeHandle } from "react";
import { useSearchParams } from "next/navigation";
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
  Download,
  FileText,
} from "lucide-react";
import {
  fetchKRAKPI,
  fetchKRAKPIStatus,
  generateKRASuggestions,
  selectKRAs,
  selectKPIs,
  saveKRAWeights,
  sendKRAKPIForApproval,
  fetchJD,
  fetchKRAKPIReviewSkills,
  submitKRAKPIReview,
  getCurrentUser,
  addCustomKRA,
  addCustomKPI,
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
    employee_jd_approved: "Employee JD approved by manager",
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
            {["employee_jd", "employee_jd_approved", "manager_jd", "manager_kra_kpi"].map((key) => {
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
  suggestions, onContinue, onAddCustomKra, initialSelected = [],
}: {
  suggestions: KRASuggestion[];
  onContinue: (ids: string[]) => void;
  onAddCustomKra: (title: string, description: string, selectedIds?: string[]) => Promise<KRASuggestion>;
  initialSelected?: string[];
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set(initialSelected));
  const [loading, setLoading] = useState(false);

  // Form states for adding custom KRA
  const [showAddForm, setShowAddForm] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [adding, setAdding] = useState(false);

  // Sync initialSelected if it changes
  useEffect(() => {
    if (initialSelected && initialSelected.length > 0) {
      setSelected(new Set(initialSelected));
    }
  }, [initialSelected]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleAddKRA = async () => {
    if (!newTitle.trim() || !newDesc.trim()) {
      alert("Please provide both a Title and Description for the custom KRA.");
      return;
    }
    setAdding(true);
    try {
      const newKra = await onAddCustomKra(newTitle.trim(), newDesc.trim(), [...selected]);
      setSelected((prev) => {
        const next = new Set(prev);
        next.add(newKra.kra_id);
        return next;
      });
      setNewTitle("");
      setNewDesc("");
      setShowAddForm(false);
    } catch (e: any) {
      alert(e.message || "Failed to add KRA");
    } finally {
      setAdding(false);
    }
  };

  const handleContinue = async () => {
    setLoading(true);
    await onContinue([...selected]);
    setLoading(false);
  };

  const count = selected.size;
  const canContinue = count >= 1;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-surface-600">
            Select the KRAs that best represent your role's accountability areas.
          </p>
          <p className="text-xs text-surface-400 mt-0.5">
            After selecting KPIs, you will assign weights to each KRA yourself in Step 3.
          </p>
        </div>
        <span className={`text-sm font-semibold px-3 py-1 rounded-full ${
          canContinue ? "bg-emerald-100 text-emerald-700" : "bg-surface-100 text-surface-500"
        }`}>
          {count} Selected
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

      {/* Add Custom KRA Option */}
      <div className="mt-4 pt-4 border-t border-slate-100">
        {!showAddForm ? (
          <button
            type="button"
            onClick={() => setShowAddForm(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-slate-50 border border-slate-200 hover:bg-slate-100 text-slate-700 rounded-xl text-xs font-semibold transition-all"
          >
            ➕ Add Custom KRA
          </button>
        ) : (
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
            <h4 className="text-xs font-bold text-slate-800">Add Custom KRA</h4>
            <div className="space-y-2">
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">KRA Title</label>
                <input
                  type="text"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="e.g. Stakeholder Communication"
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">KRA Description</label>
                <textarea
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  placeholder="Describe the key result area and what accountability it entails..."
                  className="w-full min-h-[60px] bg-white border border-slate-200 rounded-lg p-3 text-xs outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
                />
              </div>
            </div>
            <div className="flex gap-2 justify-end pt-1">
              <button
                type="button"
                onClick={() => setShowAddForm(false)}
                className="px-3.5 py-2 border border-slate-200 text-slate-650 rounded-lg text-xs font-semibold hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAddKRA}
                disabled={adding}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow"
              >
                {adding && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Add & Select
              </button>
            </div>
          </div>
        )}
      </div>

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
  selectedKras, kpiSuggestions, krasSuggestions, onContinue, onBack, onAddCustomKpi, initialSelected = {},
}: {
  selectedKras: string[];
  kpiSuggestions: Record<string, { kra_title: string; kpi_suggestions: KPISuggestion[] }>;
  krasSuggestions: KRASuggestion[];
  onContinue: (selected: Record<string, string[]>) => void;
  onBack: () => void;
  onAddCustomKpi: (kraId: string, metric: string, target: string, measurementMethod: string, frequency: string, selectedIds?: Record<string, string[]>) => Promise<KPISuggestion>;
  initialSelected?: Record<string, string[]>;
}) {
  const [selectedKpis, setSelectedKpis] = useState<Record<string, Set<string>>>(() => {
    const init: Record<string, Set<string>> = {};
    for (const [kraId, kpiIds] of Object.entries(initialSelected)) {
      init[kraId] = new Set(kpiIds);
    }
    return init;
  });
  const [loading, setLoading] = useState(false);
  const [activeKra, setActiveKra] = useState<string>(selectedKras[0] || "");

  // Form states for adding custom KPI
  const [showAddForm, setShowAddForm] = useState(false);
  const [newMetric, setNewMetric] = useState("");
  const [newTarget, setNewTarget] = useState("");
  const [newMethod, setNewMethod] = useState("");
  const [newFrequency, setNewFrequency] = useState("Monthly");
  const [adding, setAdding] = useState(false);

  // Sync initialSelected if it changes
  useEffect(() => {
    if (initialSelected && Object.keys(initialSelected).length > 0) {
      const updated: Record<string, Set<string>> = {};
      for (const [kraId, kpiIds] of Object.entries(initialSelected)) {
        updated[kraId] = new Set(kpiIds);
      }
      setSelectedKpis(updated);
    }
  }, [initialSelected]);

  const toggleKpi = (kraId: string, kpiId: string) => {
    setSelectedKpis((prev) => {
      const kraSet = new Set(prev[kraId] || []);
      if (kraSet.has(kpiId)) {
        kraSet.delete(kpiId);
      } else {
        kraSet.add(kpiId);
      }
      return { ...prev, [kraId]: kraSet };
    });
  };

  const handleAddKPI = async () => {
    if (!newMetric.trim() || !newTarget.trim() || !newMethod.trim()) {
      alert("Please provide Metric, Target, and Measurement Method for the custom KPI.");
      return;
    }
    setAdding(true);
    try {
      const currentSelections: Record<string, string[]> = {};
      for (const [kId, setVal] of Object.entries(selectedKpis)) {
        currentSelections[kId] = [...setVal];
      }

      const newKpi = await onAddCustomKpi(
        activeKra,
        newMetric.trim(),
        newTarget.trim(),
        newMethod.trim(),
        newFrequency,
        currentSelections
      );
      setSelectedKpis((prev) => {
        const kraSet = new Set(prev[activeKra] || []);
        kraSet.add(newKpi.kpi_id);
        return { ...prev, [activeKra]: kraSet };
      });
      setNewMetric("");
      setNewTarget("");
      setNewMethod("");
      setNewFrequency("Monthly");
      setShowAddForm(false);
    } catch (e: any) {
      alert(e.message || "Failed to add KPI");
    } finally {
      setAdding(false);
    }
  };

  const kraCount = (id: string) => selectedKpis[id]?.size ?? 0;
  const allValid = selectedKras.every((id) => {
    const c = kraCount(id);
    return c >= 1;
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
          For each selected KRA, choose the KPIs that best measure performance.
        </p>
        <p className="text-xs text-surface-400 mt-0.5">Expand any KPI to see measurement thresholds.</p>
      </div>

      {/* KRA tab pills */}
      <div className="flex flex-wrap gap-2">
        {selectedKras.map((id, i) => {
          const count = kraCount(id);
          const valid = count >= 1;
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
              <span className={`font-bold ${count >= 1 ? "text-emerald-600" : "text-surface-400"}`}>
                {count} Selected
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

      {/* Add Custom KPI Option */}
      {activeKra && (
        <div className="mt-4 pt-4 border-t border-slate-100">
          {!showAddForm ? (
            <button
              type="button"
              onClick={() => setShowAddForm(true)}
              className="flex items-center gap-2 px-4 py-2.5 bg-slate-50 border border-slate-200 hover:bg-slate-100 text-slate-700 rounded-xl text-xs font-semibold transition-all"
            >
              ➕ Add Custom KPI
            </button>
          ) : (
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
              <h4 className="text-xs font-bold text-slate-800">Add Custom KPI</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">KPI Metric</label>
                  <input
                    type="text"
                    value={newMetric}
                    onChange={(e) => setNewMetric(e.target.value)}
                    placeholder="e.g. Stakeholder satisfaction score"
                    className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Target</label>
                  <input
                    type="text"
                    value={newTarget}
                    onChange={(e) => setNewTarget(e.target.value)}
                    placeholder="e.g. Maintain >= 90% positive feedback"
                    className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Measurement Method</label>
                  <input
                    type="text"
                    value={newMethod}
                    onChange={(e) => setNewMethod(e.target.value)}
                    placeholder="e.g. Bi-annual stakeholder survey"
                    className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Frequency</label>
                  <select
                    value={newFrequency}
                    onChange={(e) => setNewFrequency(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
                  >
                    <option value="Weekly">Weekly</option>
                    <option value="Monthly">Monthly</option>
                    <option value="Quarterly">Quarterly</option>
                    <option value="Half-Yearly">Half-Yearly</option>
                    <option value="Annually">Annually</option>
                    <option value="On-Going">On-Going</option>
                  </select>
                </div>
              </div>
              <div className="flex gap-2 justify-end pt-1">
                <button
                  type="button"
                  onClick={() => setShowAddForm(false)}
                  className="px-3.5 py-2 border border-slate-200 text-slate-650 rounded-lg text-xs font-semibold hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleAddKPI}
                  disabled={adding}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow"
                >
                  {adding && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Add & Select
                </button>
              </div>
            </div>
          )}
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
  onKraEdit, onKpiEdit,
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
  onKraEdit: (kraId: string, title: string, desc: string) => void;
  onKpiEdit: (kraId: string, kpiId: string, updatedFields: any) => void;
}) {
  const [kpiOpen, setKpiOpen] = useState(false);
  const [kpiDragFrom, setKpiDragFrom] = useState<number | null>(null);

  // Edit states for KRA
  const [isEditingKra, setIsEditingKra] = useState(false);
  const [editTitle, setEditTitle] = useState(kra.title);
  const [editDesc, setEditDesc] = useState(kra.description);

  // Edit states for KPI
  const [editingKpiId, setEditingKpiId] = useState<string | null>(null);
  const [editKpiMetric, setEditKpiMetric] = useState("");
  const [editKpiTarget, setEditKpiTarget] = useState("");
  const [editKpiMethod, setEditKpiMethod] = useState("");
  const [editKpiFreq, setEditKpiFreq] = useState("");

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
      draggable={!isEditingKra && !editingKpiId}
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
            {!isEditingKra ? (
              <div className="flex items-center flex-wrap gap-1">
                <span className="font-semibold text-slate-800 text-sm block sm:inline">{kra.title}</span>
                <span className="text-[11px] text-slate-400 font-medium sm:ml-2">KRA #{index + 1}</span>
                <button
                  onClick={() => {
                    setEditTitle(kra.title);
                    setEditDesc(kra.description);
                    setIsEditingKra(true);
                  }}
                  type="button"
                  className="ml-2 text-[10px] text-primary-600 hover:text-primary-800 hover:underline border border-primary-200 hover:bg-primary-50 px-1.5 py-0.5 rounded transition-colors"
                >
                  Edit
                </button>
              </div>
            ) : (
              <div className="space-y-2 w-full pr-2">
                <div>
                  <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">KRA Title</label>
                  <input
                    type="text"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    className="w-full text-xs font-semibold text-slate-800 border border-slate-200 rounded-lg p-2 focus:outline-none focus:border-primary-500"
                  />
                </div>
                <div>
                  <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">KRA Description</label>
                  <textarea
                    value={editDesc}
                    onChange={(e) => setEditDesc(e.target.value)}
                    className="w-full text-xs text-slate-600 border border-slate-200 rounded-lg p-2 focus:outline-none focus:border-primary-500"
                    rows={2}
                  />
                </div>
                <div className="flex gap-2 justify-end">
                  <button
                    onClick={() => setIsEditingKra(false)}
                    className="px-2 py-0.5 text-[10px] font-medium border border-slate-200 text-slate-500 rounded hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      onKraEdit(kra.kra_id, editTitle, editDesc);
                      setIsEditingKra(false);
                    }}
                    className="px-2.5 py-0.5 text-[10px] font-medium bg-primary-600 hover:bg-primary-700 text-white rounded"
                  >
                    Save
                  </button>
                </div>
              </div>
            )}
            
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
          
          {!isEditingKra && (
            <p className="text-xs text-slate-500 leading-relaxed mb-3 pr-2">{kra.description}</p>
          )}

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
                  const isKpiLocked = isLocked || lockedKpiIds.has(`${kra.kra_id}_${kpi.kpi_id}`);
                  return (
                    <li
                      key={kpi.kpi_id}
                      draggable={editingKpiId !== kpi.kpi_id}
                      onDragStart={() => setKpiDragFrom(kpiIdx)}
                      onDragOver={(e) => { e.preventDefault(); handleKpiDragOver(kpiIdx); }}
                      onDragEnd={() => setKpiDragFrom(null)}
                      className={`text-xs flex flex-col gap-2 p-2 border rounded-lg transition-all ${
                        kpiDragFrom === kpiIdx 
                          ? "border-primary-500 bg-indigo-50/50 shadow-sm animate-pulse" 
                          : "bg-slate-50 border-slate-100 hover:border-slate-300"
                      }`}
                    >
                      {editingKpiId !== kpi.kpi_id ? (
                        <div className="flex items-center w-full gap-2">
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
                          
                          {/* KPI edit, lock & weight */}
                          <div className="flex items-center gap-1.5 ml-auto flex-shrink-0">
                            <button
                              onClick={() => {
                                setEditKpiMetric(kpi.metric);
                                setEditKpiTarget(kpi.target);
                                setEditKpiMethod(kpi.measurement_method || "");
                                setEditKpiFreq(kpi.frequency || "Monthly");
                                setEditingKpiId(kpi.kpi_id);
                              }}
                              type="button"
                              className="text-[10px] text-primary-600 hover:text-primary-800 border border-primary-200 hover:bg-primary-50 px-1.5 py-0.5 rounded transition-colors"
                            >
                              Edit
                            </button>

                            <button
                              onClick={() => onKpiLockToggle(`${kra.kra_id}_${kpi.kpi_id}`)}
                              type="button"
                              disabled={isLocked}
                              className={`p-1 rounded border transition-all ${
                                isKpiLocked
                                  ? "bg-slate-800 text-white border-slate-800 shadow-sm opacity-60"
                                  : "bg-white text-slate-400 border-slate-200 hover:text-slate-600 hover:bg-slate-50 disabled:opacity-50"
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
                        </div>
                      ) : (
                        <div className="w-full space-y-2 p-2 bg-white rounded-lg border border-primary-100">
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <div>
                              <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">Metric</label>
                              <input
                                type="text"
                                value={editKpiMetric}
                                onChange={(e) => setEditKpiMetric(e.target.value)}
                                className="w-full text-xs font-medium text-slate-700 border border-slate-200 rounded p-1 focus:outline-none focus:border-primary-500"
                              />
                            </div>
                            <div>
                              <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">Target</label>
                              <input
                                type="text"
                                value={editKpiTarget}
                                onChange={(e) => setEditKpiTarget(e.target.value)}
                                className="w-full text-xs text-slate-600 border border-slate-200 rounded p-1 focus:outline-none focus:border-primary-500"
                              />
                            </div>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <div>
                              <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">Measurement Method</label>
                              <input
                                type="text"
                                value={editKpiMethod}
                                onChange={(e) => setEditKpiMethod(e.target.value)}
                                className="w-full text-xs text-slate-600 border border-slate-200 rounded p-1 focus:outline-none focus:border-primary-500"
                              />
                            </div>
                            <div>
                              <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">Frequency</label>
                              <select
                                value={editKpiFreq}
                                onChange={(e) => setEditKpiFreq(e.target.value)}
                                className="w-full text-xs text-slate-600 border border-slate-200 rounded p-1.5 focus:outline-none focus:border-primary-500 bg-white"
                              >
                                <option value="Daily">Daily</option>
                                <option value="Weekly">Weekly</option>
                                <option value="Monthly">Monthly</option>
                                <option value="Quarterly">Quarterly</option>
                                <option value="Annually">Annually</option>
                              </select>
                            </div>
                          </div>
                          <div className="flex gap-2 justify-end">
                            <button
                              onClick={() => setEditingKpiId(null)}
                              className="px-2 py-0.5 text-[10px] font-medium border border-slate-200 text-slate-500 rounded hover:bg-slate-50"
                            >
                              Cancel
                            </button>
                            <button
                              onClick={() => {
                                onKpiEdit(kra.kra_id, kpi.kpi_id, {
                                  metric: editKpiMetric,
                                  target: editKpiTarget,
                                  measurement_method: editKpiMethod,
                                  frequency: editKpiFreq,
                                });
                                setEditingKpiId(null);
                              }}
                              className="px-2.5 py-0.5 text-[10px] font-medium bg-primary-600 hover:bg-primary-700 text-white rounded"
                            >
                              Save
                            </button>
                          </div>
                        </div>
                      )}
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
  const [showLockErrorModal, setShowLockErrorModal] = useState(false);

  const total = kras.reduce((s, k) => s + (k.weight ?? 0), 0);
  const isKraTotalValid = Math.abs(total - 100) <= 1;

  const isKpisTotalValid = kras.every((kra) => {
    const kpiSum = kra.kpis?.reduce((sum, kp) => sum + (kp.weight ?? 0), 0) ?? 0;
    return kra.kpis?.length === 0 || Math.abs(kpiSum - 100) <= 1;
  });

  const isValidToSave = isKraTotalValid && isKpisTotalValid;

  const handleLockToggle = (id: string) => {
    const kra = kras.find(k => k.kra_id === id);
    if (!kra) return;

    setLockedIds((prev) => {
      const next = new Set(prev);
      const isLocking = !next.has(id);
      
      if (isLocking) {
        next.add(id);
      } else {
        next.delete(id);
      }

      // Sync child KPIs
      setLockedKpiIds(prevKpis => {
        const nextKpis = new Set(prevKpis);
        const kpisOfKra = kra.kpis || [];
        for (const kp of kpisOfKra) {
          const compoundId = `${id}_${kp.kpi_id}`;
          if (isLocking) {
            nextKpis.add(compoundId);
          } else {
            nextKpis.delete(compoundId);
          }
        }
        return nextKpis;
      });

      return next;
    });
  };

  const handleKpiLockToggle = (id: string) => {
    let foundKra: FinalKRA | undefined = undefined;
    let foundKpiId = "";
    for (const kra of kras) {
      const kpi = kra.kpis.find(kp => `${kra.kra_id}_${kp.kpi_id}` === id);
      if (kpi) {
        foundKra = kra;
        foundKpiId = kpi.kpi_id;
        break;
      }
    }

    if (!foundKra) return;
    const kraId = foundKra.kra_id;

    setLockedKpiIds((prev) => {
      const next = new Set(prev);
      const isLocking = !next.has(id);
      if (isLocking) {
        next.add(id);
      } else {
        next.delete(id);
      }

      // Check if ALL KPIs of this KRA are locked
      const allKpisOfKra = foundKra!.kpis || [];
      const allKpisLocked = allKpisOfKra.every(kp => next.has(`${kraId}_${kp.kpi_id}`));

      if (allKpisLocked && allKpisOfKra.length > 0) {
        setLockedIds(prevIds => {
          const nextIds = new Set(prevIds);
          nextIds.add(kraId);
          return nextIds;
        });
      } else {
        setLockedIds(prevIds => {
          const nextIds = new Set(prevIds);
          nextIds.delete(kraId);
          return nextIds;
        });
      }

      return next;
    });
  };

  const handleKpisReorder = (kraId: string, reorderedKpis: any[]) => {
    setKras((prev) =>
      prev.map((k) => (k.kra_id === kraId ? { ...k, kpis: reorderedKpis } : k))
    );
  };

  const handleKraEdit = (kraId: string, updatedTitle: string, updatedDescription: string) => {
    setKras((prev) =>
      prev.map((k) =>
        k.kra_id === kraId ? { ...k, title: updatedTitle, description: updatedDescription } : k
      )
    );
  };

  const handleKpiEdit = (kraId: string, kpiId: string, updatedFields: any) => {
    setKras((prev) =>
      prev.map((k) => {
        if (k.kra_id !== kraId) return k;
        return {
          ...k,
          kpis: k.kpis.map((kp) => (kp.kpi_id === kpiId ? { ...kp, ...updatedFields } : kp)),
        };
      })
    );
  };

  const handleKpiWeightChange = (kraId: string, kpiId: string, newW: number) => {
    if (lockedKpiIds.has(`${kraId}_${kpiId}`)) return;
    const val = Math.max(0, Math.min(100, isNaN(newW) ? 0 : newW));

    setKras((prev) =>
      prev.map((k) => {
        if (k.kra_id !== kraId) return k;
        
        const updatedKpis = k.kpis.map((kp) =>
          kp.kpi_id === kpiId ? { ...kp, weight: val } : kp
        );
        
        const othersUnlocked = updatedKpis.filter(
          (kp) => kp.kpi_id !== kpiId && !lockedKpiIds.has(`${kraId}_${kp.kpi_id}`)
        );
        
        if (othersUnlocked.length > 0) {
          const lockedTotal = updatedKpis
            .filter((kp) => kp.kpi_id !== kpiId && lockedKpiIds.has(`${kraId}_${kp.kpi_id}`))
            .reduce((s, kp) => s + (kp.weight ?? 0), 0);
            
          const targetUnlockedTotal = Math.max(0, 100 - (lockedTotal + val));
          const othersUnlockedTotal = othersUnlocked.reduce((s, kp) => s + (kp.weight ?? 0), 0);
          
          let currentSum = val + lockedTotal;
          const nextKpis = updatedKpis.map((kp) => {
            if (kp.kpi_id === kpiId || lockedKpiIds.has(`${kraId}_${kp.kpi_id}`)) {
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
              (kp) => kp.kpi_id !== kpiId && !lockedKpiIds.has(`${kraId}_${kp.kpi_id}`)
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
    if (confirm) {
      if (lockedIds.size < kras.length) {
        setShowLockErrorModal(true);
        return;
      }
      setConfirming(true);
    } else {
      setSaving(true);
    }
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
            onKraEdit={handleKraEdit}
            onKpiEdit={handleKpiEdit}
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

      {showLockErrorModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/65 backdrop-blur-[2px] p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-2xl border border-slate-100 flex flex-col items-center text-center space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="w-12 h-12 bg-amber-50 rounded-full flex items-center justify-center border border-amber-100">
              <Lock className="w-5 h-5 text-amber-600" />
            </div>
            <div className="space-y-1.5">
              <h3 className="text-sm font-bold text-slate-900">Lock All KRAs to Confirm</h3>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                To submit your performance framework, please lock each Key Result Area (KRA) and its KPIs. Locking ensures your weight distribution is finalized.
              </p>
            </div>
            <button
              onClick={() => setShowLockErrorModal(false)}
              className="w-full py-2 bg-primary-600 hover:bg-primary-700 text-white text-xs font-bold rounded-xl transition-all shadow-md active:scale-[0.98]"
            >
              Understood, Go to Lock Options
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Uploaded View (Admin Uploaded) ──────────────────────────────────────────

function UploadedView({ record, jdData = null }: { record: KRAKPIRecord; jdData?: any }) {
  const [showDownloadDropdown, setShowDownloadDropdown] = useState(false);
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
      {/* Download controls for Uploaded View */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white border border-surface-200/70 rounded-2xl p-5 shadow-sm">
        <div>
          <h3 className="text-sm font-bold text-surface-900 flex items-center gap-2">
            <Target className="w-4 h-4 text-primary-500" />
            Uploaded Performance Framework
          </h3>
          <p className="text-xs text-surface-500 mt-0.5">Export this HR/Admin uploaded framework as a goal sheet PDF or CSV table.</p>
        </div>

        <div className="relative inline-block text-left">
          <button
            onClick={() => setShowDownloadDropdown(!showDownloadDropdown)}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-gradient-to-r from-primary-600 to-primary-700 text-white rounded-xl text-xs font-bold shadow-md hover:shadow-lg hover:-translate-y-0.5 transition-all group"
          >
            <Download className="w-3.5 h-3.5 group-hover:scale-110 transition-transform" />
            Download Framework
            <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${showDownloadDropdown ? 'rotate-180' : ''}`} />
          </button>

          {showDownloadDropdown && (
            <>
              <div 
                className="fixed inset-0 z-40" 
                onClick={() => setShowDownloadDropdown(false)}
              />
              <div className="absolute right-0 mt-2 w-64 bg-white border border-surface-200 rounded-2xl shadow-xl z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowDownloadDropdown(false);
                    const formattedKras = kras.map((k: any) => ({
                      kra_id: k.kra_id || k.title,
                      title: k.title,
                      weight: k.weight || 0,
                      kpis: (k.kpis || []).map((kp: any) => ({
                        kpi_id: kp.kpi_id || kp.title,
                        title: kp.title,
                        description: kp.description,
                        weight: kp.weight || 0,
                        target: kp.target || kp.target_date || "",
                        threshold: kp.threshold
                      }))
                    }));
                    downloadKRAPdfClient(formattedKras, jdData, jdData?.title, jdData?.department);
                  }}
                  className="w-full flex items-center gap-3.5 px-4 py-3.5 text-xs font-semibold text-surface-700 hover:bg-primary-50 hover:text-primary-700 transition-colors text-left"
                >
                  <div className="w-8 h-8 rounded-lg bg-red-50 flex items-center justify-center shrink-0">
                    <FileText className="w-4 h-4 text-red-600" />
                  </div>
                  <div>
                    <span className="block font-bold">Printable Goal Sheet PDF</span>
                    <span className="text-[10px] text-surface-400 font-normal">Branded Pulse Pharma template</span>
                  </div>
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowDownloadDropdown(false);
                    const formattedKras = kras.map((k: any) => ({
                      kra_id: k.kra_id || k.title,
                      title: k.title,
                      weight: k.weight || 0,
                      kpis: (k.kpis || []).map((kp: any) => ({
                        kpi_id: kp.kpi_id || kp.title,
                        title: kp.title,
                        description: kp.description,
                        weight: kp.weight || 0,
                        target: kp.target || kp.target_date || "",
                        threshold: kp.threshold
                      }))
                    }));
                    downloadKRACSVClient(formattedKras, jdData);
                  }}
                  className="w-full flex items-center gap-3.5 px-4 py-3.5 text-xs font-semibold text-surface-700 hover:bg-primary-50 hover:text-primary-700 transition-colors text-left border-t border-surface-100"
                >
                  <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center shrink-0">
                    <FileText className="w-4 h-4 text-emerald-600" />
                  </div>
                  <div>
                    <span className="block font-bold">Spreadsheet (Excel/CSV)</span>
                    <span className="text-[10px] text-surface-400 font-normal font-sans">HRMS-ready table format</span>
                  </div>
                </button>
              </div>
            </>
          )}
        </div>
      </div>
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

const ConfirmedView = forwardRef<any, {
  record: KRAKPIRecord;
  onRegenerate: () => void;
  onSendForApproval: () => Promise<void>;
  isManager?: boolean;
  onSave?: (kras: FinalKRA[], confirm: boolean) => Promise<void>;
  jdData?: any;
}>(function ConfirmedView({
  record,
  onRegenerate,
  onSendForApproval,
  isManager = false,
  onSave,
  jdData = null,
}, ref) {
  const kras = record.kras?.kras ?? [];
  const status = record.status || "confirmed";
  const [openId, setOpenId] = useState<string | null>(kras[0]?.kra_id ?? null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  // Manager editing states
  const [isEditing, setIsEditing] = useState(false);
  const [showDownloadDropdown, setShowDownloadDropdown] = useState(false);
  const [editableKras, setEditableKras] = useState<FinalKRA[]>(kras);
  const [lockedIds, setLockedIds] = useState<Set<string>>(new Set());
  const [lockedKpiIds, setLockedKpiIds] = useState<Set<string>>(new Set());
  const [showLockErrorModal, setShowLockErrorModal] = useState(false);

  useImperativeHandle(ref, () => ({
    save: async () => {
      await handleSaveEditedFramework();
      return true;
    },
    cancel: () => {
      setIsEditing(false);
      setEditableKras(kras);
    }
  }));

  // Skills & improvement states
  const [skills, setSkills] = useState<Array<{ name: string; description: string; rating: number | "N/A" | null }>>([]);
  const [loadingSkills, setLoadingSkills] = useState(false);
  const [submittingReview, setSubmittingReview] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);

  // Prefill improvements if they are already present on the record
  useEffect(() => {
    if (record.skill_ratings) {
      setSkills(record.skill_ratings);
    }
  }, [record]);

  // Fetch unique skills for manager review
  useEffect(() => {
    const loadReviewSkills = async () => {
      if (isManager && status === "sent_to_manager" && (!record.skill_ratings || record.skill_ratings.length === 0)) {
        setLoadingSkills(true);
        try {
          const data = await fetchKRAKPIReviewSkills(record.jd_session_id);
          setSkills(data.skills || []);
        } catch (err: any) {
          console.error("Failed to load review skills:", err);
          setReviewError("Failed to generate/fetch unique skills for review.");
        } finally {
          setLoadingSkills(false);
        }
      }
    };
    loadReviewSkills();
  }, [isManager, status, record.jd_session_id, record.skill_ratings]);

  const handleManagerReviewSubmit = async (action: "approved" | "rejected") => {
    const reviewer = getCurrentUser();
    const reviewerId = reviewer?.employee_id || "admin";

    if (action === "approved") {
      const unrated = skills.some(s => s.rating === null || s.rating === undefined);
      if (unrated) {
        alert("Please rate all consolidated unique skills (1-10 or N/A) before sending to the employee.");
        return;
      }
    } else {
      // Rejection needs a comment/reason
      const comment = prompt("Please provide a reason or revision instructions for the employee:");
      if (comment === null) return; // cancel clicked
      if (!comment.trim()) {
        alert("A reason is required to request revision.");
        return;
      }
      setSubmittingReview(true);
      setReviewError(null);
      try {
        await submitKRAKPIReview(record.jd_session_id, {
          action: "rejected",
          comment: comment,
          reviewer_id: reviewerId,
        });
        window.location.reload();
      } catch (err: any) {
        setReviewError(err.message || "Failed to submit revision request.");
      } finally {
        setSubmittingReview(false);
      }
      return;
    }

    setSubmittingReview(true);
    setReviewError(null);
    try {
      await submitKRAKPIReview(record.jd_session_id, {
        action: "approved",
        skill_ratings: skills,
        reviewer_id: reviewerId,
      });
      window.location.reload();
    } catch (err: any) {
      setReviewError(err.message || "Failed to submit review.");
    } finally {
      setSubmittingReview(false);
    }
  };

  // Deep copy when editing starts
  useEffect(() => {
    if (!isEditing) {
      setEditableKras(kras);
    }
  }, [kras, isEditing]);

  const currentKras = isEditing ? editableKras : kras;

  // Compute stats
  const totalKpis = currentKras.reduce((acc, kra) => acc + (kra.kpis?.length ?? 0), 0);
  const totalWeight = currentKras.reduce((acc, kra) => acc + (kra.weight ?? 0), 0);

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

  // Lock toggles
  const handleLockToggle = (id: string) => {
    const kra = editableKras.find(k => k.kra_id === id);
    if (!kra) return;

    setLockedIds((prev) => {
      const next = new Set(prev);
      const isLocking = !next.has(id);
      
      if (isLocking) {
        next.add(id);
      } else {
        next.delete(id);
      }

      // Sync child KPIs
      setLockedKpiIds(prevKpis => {
        const nextKpis = new Set(prevKpis);
        const kpisOfKra = kra.kpis || [];
        for (const kp of kpisOfKra) {
          const compoundId = `${id}_${kp.kpi_id}`;
          if (isLocking) {
            nextKpis.add(compoundId);
          } else {
            nextKpis.delete(compoundId);
          }
        }
        return nextKpis;
      });

      return next;
    });
  };

  const handleKpiLockToggle = (id: string) => {
    let foundKra: FinalKRA | undefined = undefined;
    let foundKpiId = "";
    for (const kra of editableKras) {
      const kpi = kra.kpis.find(kp => `${kra.kra_id}_${kp.kpi_id}` === id);
      if (kpi) {
        foundKra = kra;
        foundKpiId = kpi.kpi_id;
        break;
      }
    }

    if (!foundKra) return;
    const kraId = foundKra.kra_id;

    setLockedKpiIds((prev) => {
      const next = new Set(prev);
      const isLocking = !next.has(id);
      if (isLocking) {
        next.add(id);
      } else {
        next.delete(id);
      }

      // Check if ALL KPIs of this KRA are locked
      const allKpisOfKra = foundKra!.kpis || [];
      const allKpisLocked = allKpisOfKra.every(kp => next.has(`${kraId}_${kp.kpi_id}`));

      if (allKpisLocked && allKpisOfKra.length > 0) {
        setLockedIds(prevIds => {
          const nextIds = new Set(prevIds);
          nextIds.add(kraId);
          return nextIds;
        });
      } else {
        setLockedIds(prevIds => {
          const nextIds = new Set(prevIds);
          nextIds.delete(kraId);
          return nextIds;
        });
      }

      return next;
    });
  };

  // Weight rebalancing algorithms
  const handleWeightChange = (id: string, newW: number) => {
    if (lockedIds.has(id)) return;
    const val = Math.max(0, Math.min(100, isNaN(newW) ? 0 : newW));

    setEditableKras((prev) => {
      const targetIdx = prev.findIndex((k) => k.kra_id === id);
      if (targetIdx === -1) return prev;

      const currentTargetW = prev[targetIdx].weight ?? 0;
      const diff = val - currentTargetW;
      if (diff === 0) return prev;

      const otherKras = prev.map((k, i) => ({ k, i })).filter((x) => x.i !== targetIdx);
      const eligible = otherKras.filter((x) => !lockedIds.has(x.k.kra_id));

      if (eligible.length === 0) {
        return prev.map((k) => (k.kra_id === id ? { ...k, weight: val } : k));
      }

      const sumEligible = eligible.reduce((sum, x) => sum + (x.k.weight ?? 0), 0);
      const next = [...prev];
      next[targetIdx] = { ...next[targetIdx], weight: val };

      if (sumEligible === 0) {
        const share = diff / eligible.length;
        eligible.forEach((x) => {
          const w = Math.max(0, (x.k.weight ?? 0) - share);
          next[x.i] = { ...next[x.i], weight: Math.round(w) };
        });
      } else {
        eligible.forEach((x) => {
          const ratio = (x.k.weight ?? 0) / sumEligible;
          const w = Math.max(0, (x.k.weight ?? 0) - diff * ratio);
          next[x.i] = { ...next[x.i], weight: Math.round(w) };
        });
      }

      const newSum = next.reduce((s, k) => s + (k.weight ?? 0), 0);
      if (newSum !== 100) {
        const errorDiff = 100 - newSum;
        const firstEligible = eligible[0];
        if (firstEligible) {
          next[firstEligible.i].weight = Math.max(0, (next[firstEligible.i].weight ?? 0) + errorDiff);
        }
      }

      return next;
    });
  };

  const handleKpiWeightChange = (kraId: string, kpiId: string, newW: number) => {
    if (lockedKpiIds.has(`${kraId}_${kpiId}`)) return;
    const val = Math.max(0, Math.min(100, isNaN(newW) ? 0 : newW));

    setEditableKras((prev) =>
      prev.map((k) => {
        if (k.kra_id !== kraId) return k;

        const kpis = k.kpis || [];
        const targetIdx = kpis.findIndex((kp) => kp.kpi_id === kpiId);
        if (targetIdx === -1) return k;

        const currentTargetW = kpis[targetIdx].weight ?? 0;
        const diff = val - currentTargetW;
        if (diff === 0) return k;

        const otherKpis = kpis.map((kp, i) => ({ kp, i })).filter((x) => x.i !== targetIdx);
        const eligible = otherKpis.filter((x) => !lockedKpiIds.has(`${kraId}_${x.kp.kpi_id}`));

        if (eligible.length === 0) {
          return {
            ...k,
            kpis: kpis.map((kp) => (kp.kpi_id === kpiId ? { ...kp, weight: val } : kp)),
          };
        }

        const sumEligible = eligible.reduce((sum, x) => sum + (x.kp.weight ?? 0), 0);
        const nextKpis = [...kpis];
        nextKpis[targetIdx] = { ...nextKpis[targetIdx], weight: val };

        if (sumEligible === 0) {
          const share = diff / eligible.length;
          eligible.forEach((x) => {
            const w = Math.max(0, (x.kp.weight ?? 0) - share);
            nextKpis[x.i] = { ...nextKpis[x.i], weight: Math.round(w) };
          });
        } else {
          eligible.forEach((x) => {
            const ratio = (x.kp.weight ?? 0) / sumEligible;
            const w = Math.max(0, (x.kp.weight ?? 0) - diff * ratio);
            nextKpis[x.i] = { ...nextKpis[x.i], weight: Math.round(w) };
          });
        }

        const newSum = nextKpis.reduce((s, kp) => s + (kp.weight ?? 0), 0);
        if (newSum !== 100) {
          const errorDiff = 100 - newSum;
          const firstEligible = eligible[0];
          if (firstEligible) {
            nextKpis[firstEligible.i].weight = Math.max(
              0,
              (nextKpis[firstEligible.i].weight ?? 0) + errorDiff
            );
          }
        }

        return { ...k, kpis: nextKpis };
      })
    );
  };

  const handleKraFieldChange = (kraId: string, field: string, val: any) => {
    setEditableKras((prev) =>
      prev.map((k) => (k.kra_id === kraId ? { ...k, [field]: val } : k))
    );
  };

  const handleKpiFieldChange = (kraId: string, kpiId: string, field: string, val: any) => {
    setEditableKras((prev) =>
      prev.map((k) => {
        if (k.kra_id !== kraId) return k;
        return {
          ...k,
          kpis: k.kpis.map((kp) => (kp.kpi_id === kpiId ? { ...kp, ...{ [field]: val } } : kp)),
        };
      })
    );
  };

  const handleKpiThresholdChange = (kraId: string, kpiId: string, tier: string, val: any) => {
    setEditableKras((prev) =>
      prev.map((k) => {
        if (k.kra_id !== kraId) return k;
        return {
          ...k,
          kpis: k.kpis.map((kp) => {
            if (kp.kpi_id !== kpiId) return kp;
            const prevThreshold = kp.threshold || { excellent: "", meets_expectation: "", below_expectation: "" };
            return {
              ...kp,
              threshold: {
                ...prevThreshold,
                [tier]: val,
              },
            };
          }),
        };
      })
    );
  };

  const handleSaveEditedFramework = async () => {
    if (!onSave) return;
    if (lockedIds.size < editableKras.length) {
      setShowLockErrorModal(true);
      return;
    }
    // Validate weights sum to 100
    const totalW = editableKras.reduce((s, k) => s + (k.weight ?? 0), 0);
    if (Math.abs(totalW - 100) > 1) {
      alert(`KRA weights must sum to exactly 100%. Current total: ${totalW}%`);
      return;
    }
    for (const kra of editableKras) {
      const kpiSum = kra.kpis?.reduce((s, kp) => s + (kp.weight ?? 0), 0) ?? 0;
      if (kra.kpis && kra.kpis.length > 0 && Math.abs(kpiSum - 100) > 1) {
        alert(`KPI weights for KRA "${kra.title}" must sum to exactly 100%. Current total: ${kpiSum}%`);
        return;
      }
    }
    setSending(true);
    setSendError(null);
    try {
      await onSave(editableKras, false);
      setIsEditing(false);
    } catch (e: any) {
      setSendError(e.message || "Failed to save framework changes.");
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
              <span className="text-xl font-black leading-none">{currentKras.length}</span>
              <p className="text-[10px] text-white/70 mt-0.5 font-medium">KRAs</p>
            </div>
            <div className="text-center border-x border-white/10">
              <span className="text-xl font-black leading-none">{totalKpis}</span>
              <p className="text-[10px] text-white/70 mt-0.5 font-medium">KPIs</p>
            </div>
            <div className="text-center">
              <span className={`text-xl font-black leading-none ${Math.abs(totalWeight - 100) > 1 ? "text-rose-350" : ""}`}>{totalWeight}%</span>
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

      {/* Manager Action Panel — rendered at the top for easy access */}
      {isManager && (status === "sent_to_manager" || status === "sent_to_hr") && (
        <div className="bg-white border border-primary-100 rounded-2xl p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">Manager Actions</h4>
              <p className="text-[11px] text-slate-500 mt-0.5">Evaluate, edit, or approve the performance framework and skill ratings below.</p>
            </div>
            {reviewError && (
              <span className="text-[10px] bg-red-50 text-red-650 px-2.5 py-1 rounded-md border border-red-200 font-medium">
                Error occurred
              </span>
            )}
          </div>

          {!isEditing ? (
            <div className="flex flex-col sm:flex-row gap-3">
              <button
                onClick={() => {
                  setEditableKras(JSON.parse(JSON.stringify(kras)));
                  setIsEditing(true);
                }}
                className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-all"
              >
                <Edit className="w-3.5 h-3.5" />
                Tweak JDs & Weights
              </button>
              <button
                onClick={() => handleManagerReviewSubmit("rejected")}
                disabled={submittingReview}
                className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2.5 bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-100 text-xs font-bold rounded-xl transition-all disabled:opacity-50"
              >
                <AlertTriangle className="w-3.5 h-3.5" />
                Request Revision
              </button>
              <button
                onClick={() => handleManagerReviewSubmit("approved")}
                disabled={submittingReview}
                className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-md transition-all disabled:opacity-50"
              >
                {submittingReview ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <ArrowRight className="w-3.5 h-3.5" />
                )}
                Approve Goals
              </button>
            </div>
          ) : (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-1">
              <div>
                <p className="text-xs font-bold text-slate-800">Review & Override Mode</p>
                <p className="text-[11px] text-slate-500 mt-0.5">Edit KRAs, KPIs, weights, and thresholds directly. Unsaved changes are lost upon canceling.</p>
              </div>
              <div className="flex gap-2 w-full sm:w-auto">
                <button
                  onClick={() => setIsEditing(false)}
                  disabled={sending}
                  className="flex-1 sm:flex-none px-3.5 py-1.5 text-xs font-semibold text-slate-650 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveEditedFramework}
                  disabled={sending}
                  className="flex-1 sm:flex-none px-4 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg shadow-sm transition-colors flex items-center justify-center gap-1"
                >
                  {sending ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                  Save Framework
                </button>
              </div>
            </div>
          )}

          {reviewError && (
            <p className="text-[11px] text-rose-655 leading-normal">{reviewError}</p>
          )}
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
      {isUnderReview && !isEditing && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-center gap-3">
          <Loader2 className="w-4 h-4 text-blue-500 animate-spin shrink-0" />
          <div>
            <p className="text-xs font-bold text-blue-800">Awaiting {status === "sent_to_hr" ? "HR" : "Manager"} Review</p>
            <p className="text-xs text-blue-600 mt-0.5">Your framework has been submitted and is under review.</p>
          </div>
        </div>
      )}

      {/* Download Goal Sheet Controls */}
      {!isEditing && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white border border-surface-200/70 rounded-2xl p-5 shadow-sm">
          <div>
            <h3 className="text-sm font-bold text-surface-900 flex items-center gap-2">
              <Target className="w-4 h-4 text-primary-500" />
              Goal Sheet &amp; Framework Alignment
            </h3>
            <p className="text-xs text-surface-500 mt-0.5">Export this finalized performance framework as a branded goal sheet PDF or Excel spreadsheet.</p>
          </div>

          <div className="relative inline-block text-left">
            <button
              onClick={() => setShowDownloadDropdown(!showDownloadDropdown)}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-gradient-to-r from-primary-600 to-primary-700 text-white rounded-xl text-xs font-bold shadow-md hover:shadow-lg hover:-translate-y-0.5 transition-all group"
            >
              <Download className="w-3.5 h-3.5 group-hover:scale-110 transition-transform" />
              Download Framework
              <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${showDownloadDropdown ? 'rotate-180' : ''}`} />
            </button>

            {showDownloadDropdown && (
              <>
                <div 
                  className="fixed inset-0 z-40" 
                  onClick={() => setShowDownloadDropdown(false)}
                />
                <div className="absolute right-0 mt-2 w-64 bg-white border border-surface-200 rounded-2xl shadow-xl z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowDownloadDropdown(false);
                      downloadKRAPdfClient(currentKras as any, jdData, jdData?.title, jdData?.department);
                    }}
                    className="w-full flex items-center gap-3.5 px-4 py-3.5 text-xs font-semibold text-surface-700 hover:bg-primary-50 hover:text-primary-700 transition-colors text-left"
                  >
                    <div className="w-8 h-8 rounded-lg bg-red-50 flex items-center justify-center shrink-0">
                      <FileText className="w-4 h-4 text-red-600" />
                    </div>
                    <div>
                      <span className="block font-bold">Printable Goal Sheet PDF</span>
                      <span className="text-[10px] text-surface-400 font-normal">Branded Pulse Pharma template</span>
                    </div>
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowDownloadDropdown(false);
                      downloadKRACSVClient(currentKras as any, jdData);
                    }}
                    className="w-full flex items-center gap-3.5 px-4 py-3.5 text-xs font-semibold text-surface-700 hover:bg-primary-50 hover:text-primary-700 transition-colors text-left border-t border-surface-100"
                  >
                    <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center shrink-0">
                      <FileText className="w-4 h-4 text-emerald-600" />
                    </div>
                    <div>
                      <span className="block font-bold">Spreadsheet (Excel/CSV)</span>
                      <span className="text-[10px] text-surface-400 font-normal font-sans">HRMS-ready table format</span>
                    </div>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Weight Distribution */}
      <div className="bg-white border border-surface-200/70 rounded-xl p-4 shadow-sm space-y-2.5">
        <h4 className="text-xs font-bold text-surface-700 uppercase tracking-wider flex items-center gap-1.5">
          <BarChart3 className="w-3.5 h-3.5 text-primary-500" /> Weight Distribution
        </h4>
        <WeightBar kras={currentKras} />
      </div>

      {/* KRAs Accordion */}
      <div className="space-y-2.5">
        {currentKras.map((kra, i) => {
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
              <div
                onClick={() => setOpenId(isOpen ? null : kra.kra_id)}
                className="w-full flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-3.5 text-left cursor-pointer"
              >
                <div className="flex-1 min-w-0 flex items-center gap-2.5">
                  <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${c.bar}`} />
                  {isEditing ? (
                    <input
                      type="text"
                      value={kra.title}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => handleKraFieldChange(kra.kra_id, "title", e.target.value)}
                      className="w-full bg-white border border-slate-200 rounded px-2 py-0.5 text-sm font-semibold text-slate-800 focus:outline-none focus:border-primary-500"
                    />
                  ) : (
                    <span className="font-bold text-surface-900 text-sm leading-tight block truncate">{kra.title}</span>
                  )}
                </div>

                <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto" onClick={(e) => e.stopPropagation()}>
                  {isEditing ? (
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => handleLockToggle(kra.kra_id)}
                        className={`p-1 rounded border transition-all ${
                          lockedIds.has(kra.kra_id)
                            ? "bg-slate-800 text-white border-slate-850"
                            : "bg-white text-slate-400 border-slate-200 hover:text-slate-650 hover:bg-slate-50"
                        }`}
                        title={lockedIds.has(kra.kra_id) ? "Unlock KRA weight" : "Lock KRA weight"}
                      >
                        {lockedIds.has(kra.kra_id) ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
                      </button>
                      <div className="flex items-center bg-white border border-slate-200 rounded-lg px-1.5 py-0.5 w-16">
                        <input
                          type="number"
                          value={kra.weight ?? 0}
                          disabled={lockedIds.has(kra.kra_id)}
                          onChange={(e) => handleWeightChange(kra.kra_id, parseInt(e.target.value) || 0)}
                          className="w-full bg-transparent text-xs font-semibold text-slate-700 text-center outline-none border-none disabled:opacity-50"
                        />
                        <span className="text-xs font-semibold text-slate-400 select-none">%</span>
                      </div>
                    </div>
                  ) : (
                    <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full border ${c.badge} ${c.border}`}>
                      {kra.weight ?? "—"}% weight
                    </span>
                  )}

                  <span className="text-xs font-semibold bg-surface-100 text-surface-600 px-2 py-1 rounded-full">
                    {kra.kpis?.length ?? 0} KPIs
                  </span>
                  
                  <div className={`p-1 rounded transition-transform ${isOpen ? "rotate-180" : ""}`} onClick={() => setOpenId(isOpen ? null : kra.kra_id)}>
                    <ChevronDown className="w-4 h-4 text-surface-400 cursor-pointer" />
                  </div>
                </div>
              </div>

              {isOpen && (
                <div className="px-4 pb-4 pt-0 border-t border-surface-200/20 space-y-3">
                  <div className={`border-l-4 ${c.bar.replace("bg-", "border-")} pl-3 py-1 mt-3`}>
                    {isEditing ? (
                      <textarea
                        value={kra.description}
                        onChange={(e) => handleKraFieldChange(kra.kra_id, "description", e.target.value)}
                        className="w-full bg-white border border-slate-200 rounded-lg p-2 text-xs text-slate-650 focus:outline-none focus:border-primary-500 h-16 resize-none"
                        placeholder="KRA Description"
                      />
                    ) : (
                      <p className="text-xs text-surface-600 leading-relaxed">{kra.description}</p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <p className="text-[10px] font-bold text-surface-400 uppercase tracking-wider">Key Performance Indicators</p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {kra.kpis.map((kpi) => (
                        <div
                          key={kpi.kpi_id}
                          className="bg-white border border-surface-150 rounded-xl p-3.5 shadow-sm hover:shadow-md transition-shadow space-y-2"
                        >
                          <div className="flex flex-col gap-2">
                            <div className="flex items-start justify-between gap-2">
                              {isEditing ? (
                                <div className="w-full">
                                  <label className="text-[9px] font-bold text-slate-400 uppercase block mb-0.5">KPI Metric</label>
                                  <input
                                    type="text"
                                    value={kpi.metric}
                                    onChange={(e) => handleKpiFieldChange(kra.kra_id, kpi.kpi_id, "metric", e.target.value)}
                                    className="w-full bg-white border border-slate-200 rounded px-2 py-1 text-xs font-semibold text-slate-705 focus:outline-none focus:border-primary-500"
                                  />
                                </div>
                              ) : (
                                <h6 className="font-bold text-surface-800 text-xs leading-snug">{kpi.metric}</h6>
                              )}
                              
                              {!isEditing && (
                                <div className="flex flex-col items-end gap-1 shrink-0">
                                  <span className="text-[9px] font-bold bg-primary-50 text-primary-700 px-2 py-0.5 rounded-full border border-primary-100 uppercase tracking-wide">
                                    {kpi.frequency}
                                  </span>
                                  <span className="text-[9px] font-bold bg-slate-100 text-slate-700 px-2 py-0.5 rounded-full border border-slate-250">
                                    {kpi.weight ?? 0}% weight ({(((kpi.weight ?? 0) * (kra.weight ?? 0)) / 100).toFixed(1)}% overall)
                                  </span>
                                </div>
                              )}
                            </div>

                            {isEditing && (
                              <div className="grid grid-cols-2 gap-2 mt-1">
                                <div>
                                  <label className="text-[9px] font-bold text-slate-400 uppercase block mb-0.5">Frequency</label>
                                  <select
                                    value={kpi.frequency || "Monthly"}
                                    onChange={(e) => handleKpiFieldChange(kra.kra_id, kpi.kpi_id, "frequency", e.target.value)}
                                    className="w-full bg-white border border-slate-200 rounded px-1.5 py-1 text-xs text-slate-600 focus:outline-none focus:border-primary-500"
                                  >
                                    <option value="Daily">Daily</option>
                                    <option value="Weekly">Weekly</option>
                                    <option value="Monthly">Monthly</option>
                                    <option value="Quarterly">Quarterly</option>
                                    <option value="Annually">Annually</option>
                                  </select>
                                </div>
                                <div>
                                  <label className="text-[9px] font-bold text-slate-400 uppercase block mb-0.5">Weight (%)</label>
                                  <div className="flex gap-1 items-center">
                                    {(() => {
                                      const isKpiLocked = lockedIds.has(kra.kra_id) || lockedKpiIds.has(`${kra.kra_id}_${kpi.kpi_id}`);
                                      return (
                                        <>
                                          <button
                                            type="button"
                                            onClick={() => handleKpiLockToggle(`${kra.kra_id}_${kpi.kpi_id}`)}
                                            disabled={lockedIds.has(kra.kra_id)}
                                            className={`p-1 rounded border transition-all ${
                                              isKpiLocked
                                                ? "bg-slate-800 text-white border-slate-850 opacity-60"
                                                : "bg-white text-slate-400 border-slate-200 hover:bg-slate-50 hover:text-slate-600 disabled:opacity-50"
                                            }`}
                                          >
                                            {isKpiLocked ? <Lock className="w-2.5 h-2.5" /> : <Unlock className="w-2.5 h-2.5" />}
                                          </button>
                                          <div className="flex-1 flex items-center bg-white border border-slate-200 rounded px-1.5 py-0.5">
                                            <input
                                              type="number"
                                              value={kpi.weight ?? 0}
                                              disabled={isKpiLocked}
                                              onChange={(e) => handleKpiWeightChange(kra.kra_id, kpi.kpi_id, parseInt(e.target.value) || 0)}
                                              className="w-full bg-transparent text-xs font-semibold text-slate-700 text-center outline-none border-none disabled:opacity-50"
                                            />
                                            <span className="text-xs font-semibold text-slate-400 select-none">%</span>
                                          </div>
                                        </>
                                      );
                                    })()}
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>

                          <div className="bg-surface-50 rounded-lg p-2 border border-surface-100">
                            {isEditing ? (
                              <div>
                                <label className="text-[9px] font-bold text-slate-400 uppercase block mb-0.5">KPI Target</label>
                                <input
                                  type="text"
                                  value={kpi.target}
                                  onChange={(e) => handleKpiFieldChange(kra.kra_id, kpi.kpi_id, "target", e.target.value)}
                                  className="w-full bg-white border border-slate-200 rounded px-2 py-1 text-xs font-bold text-primary-600 focus:outline-none focus:border-primary-500"
                                  />
                              </div>
                            ) : (
                              <>
                                <p className="text-[10px] font-semibold text-surface-400 uppercase tracking-wide mb-0.5">Target</p>
                                <p className="text-xs font-bold text-primary-600">{kpi.target}</p>
                              </>
                            )}
                          </div>

                          <div className="flex flex-col gap-1 text-[10px] text-surface-500">
                            {isEditing ? (
                              <div className="mt-1">
                                <label className="text-[9px] font-bold text-slate-400 uppercase block mb-0.5">Measured Via</label>
                                <input
                                  type="text"
                                  value={kpi.measurement_method || ""}
                                  onChange={(e) => handleKpiFieldChange(kra.kra_id, kpi.kpi_id, "measurement_method", e.target.value)}
                                  className="w-full bg-white border border-slate-200 rounded px-2 py-1 text-xs text-slate-650 focus:outline-none focus:border-primary-500"
                                />
                              </div>
                            ) : (
                              <div className="flex items-start gap-1.5">
                                <TrendingUp className="w-3 h-3 text-surface-400 shrink-0 mt-0.5" />
                                <span><span className="font-semibold text-surface-600">Via: </span>{kpi.measurement_method}</span>
                              </div>
                            )}
                          </div>

                          {/* Expectation Thresholds */}
                          {(kpi.threshold || isEditing) && (
                            <div className="mt-2.5 pt-2.5 border-t border-surface-100">
                              {isEditing ? (
                                <div className="space-y-2">
                                  <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Expectation Thresholds</p>
                                  <div className="grid grid-cols-3 gap-2 text-[10px]">
                                    <div>
                                      <label className="text-[9px] font-bold text-emerald-600 uppercase block mb-0.5">Excellent</label>
                                      <input
                                        type="text"
                                        value={kpi.threshold?.excellent || ""}
                                        onChange={(e) => handleKpiThresholdChange(kra.kra_id, kpi.kpi_id, "excellent", e.target.value)}
                                        className="w-full bg-white border border-slate-200 rounded px-1.5 py-1 text-xs focus:outline-none focus:border-primary-500"
                                      />
                                    </div>
                                    <div>
                                      <label className="text-[9px] font-bold text-blue-600 uppercase block mb-0.5">Meets</label>
                                      <input
                                        type="text"
                                        value={kpi.threshold?.meets_expectation || ""}
                                        onChange={(e) => handleKpiThresholdChange(kra.kra_id, kpi.kpi_id, "meets_expectation", e.target.value)}
                                        className="w-full bg-white border border-slate-200 rounded px-1.5 py-1 text-xs focus:outline-none focus:border-primary-500"
                                      />
                                    </div>
                                    <div>
                                      <label className="text-[9px] font-bold text-rose-600 uppercase block mb-0.5">Below</label>
                                      <input
                                        type="text"
                                        value={kpi.threshold?.below_expectation || ""}
                                        onChange={(e) => handleKpiThresholdChange(kra.kra_id, kpi.kpi_id, "below_expectation", e.target.value)}
                                        className="w-full bg-white border border-slate-200 rounded px-1.5 py-1 text-xs focus:outline-none focus:border-primary-500"
                                      />
                                    </div>
                                  </div>
                                </div>
                              ) : (
                                <div className="grid grid-cols-3 gap-2 text-[10px]">
                                  <div className="bg-emerald-50/40 rounded-lg p-2 border border-emerald-100/50 text-center flex flex-col justify-between">
                                    <div className="font-bold text-emerald-700 mb-1">Excellent</div>
                                    <div className="text-slate-600 font-medium leading-tight">{kpi.threshold?.excellent}</div>
                                  </div>
                                  <div className="bg-blue-50/40 rounded-lg p-2 border border-blue-100/50 text-center flex flex-col justify-between">
                                    <div className="font-bold text-blue-700 mb-1">Meets</div>
                                    <div className="text-slate-650 font-medium leading-tight">{kpi.threshold?.meets_expectation}</div>
                                  </div>
                                  <div className="bg-rose-50/40 rounded-lg p-2 border border-rose-100/50 text-center flex flex-col justify-between">
                                    <div className="font-bold text-rose-700 mb-1">Below</div>
                                    <div className="text-slate-650 font-medium leading-tight">{kpi.threshold?.below_expectation}</div>
                                  </div>
                                </div>
                              )}
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

      {record.skill_ratings && record.skill_ratings.length > 0 && (
        <div id="skill-assessment" className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-6 mt-8 animate-in fade-in duration-300">
          <div>
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-primary-500" />
              Employee Performance & Skill Assessment
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              Manager's assessment of key capabilities and skill gap profile.
            </p>
          </div>

          <div className="space-y-4">
            {record.skill_ratings.map((skill: any) => {
              const rating = skill.rating;
              let ratingColor = "bg-slate-105 text-slate-600 border-slate-200";
              if (rating !== null && rating !== undefined) {
                if (rating === "N/A") {
                  ratingColor = "bg-slate-500 border-slate-500 text-white shadow-sm shadow-slate-500/10";
                } else if (typeof rating === "number") {
                  if (rating <= 3) ratingColor = "bg-rose-500 border-rose-500 text-white shadow-sm shadow-rose-500/20";
                  else if (rating <= 7) ratingColor = "bg-amber-500 border-amber-500 text-white shadow-sm shadow-amber-500/20";
                  else ratingColor = "bg-emerald-500 border-emerald-500 text-white shadow-sm shadow-emerald-500/20";
                }
              }

              return (
                <div key={skill.name} className="flex items-start justify-between p-4 bg-slate-50 border border-slate-100 rounded-xl gap-4">
                  <div className="space-y-1">
                    <h4 className="text-xs font-bold text-slate-800">{skill.name}</h4>
                    <p className="text-[11px] text-slate-500 leading-normal">{skill.description}</p>
                  </div>
                  <div className={`px-2 h-8 min-w-[32px] rounded-lg flex items-center justify-center text-xs font-bold border shrink-0 ${ratingColor}`}>
                    {rating !== null && rating !== undefined ? rating : "-"}
                  </div>
                </div>
              );
            })}
          </div>

          {record.reviewed_at && (
            <div className="text-[10px] text-slate-400 font-semibold text-right pt-2">
              Evaluated on {new Date(record.reviewed_at).toLocaleDateString()}
              {record.reviewed_by && ` by ${record.reviewed_by}`}
            </div>
          )}
        </div>
      )}

      {isManager && status === "sent_to_manager" && !isEditing && (
        <div className="bg-white border-2 border-primary-200 rounded-2xl p-6 shadow-md space-y-6 mt-8 animate-in fade-in duration-300">
          <div>
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-primary-500" />
              Employee Performance & Skill Assessment
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              Rate the employee's unique capabilities (inferred from their role description and KRA goals). Choose N/A if a skill is not applicable or cannot be evaluated.
            </p>
          </div>

          {loadingSkills ? (
            <div className="flex flex-col items-center justify-center py-10 gap-3">
              <Loader2 className="w-8 h-8 text-primary-600 animate-spin" />
              <p className="text-xs text-slate-500 font-medium">Consolidating skills list using AI...</p>
            </div>
          ) : (
            <div className="space-y-5">
              {skills.map((skill, sIdx) => {
                const currentRating = skill.rating;
                return (
                  <div key={skill.name} className="p-4 bg-slate-50 border border-slate-100 rounded-xl space-y-3">
                    <div>
                      <h4 className="text-xs font-bold text-slate-800">{skill.name}</h4>
                      <p className="text-[11px] text-slate-500 mt-0.5">{skill.description}</p>
                    </div>
                    
                    {/* Rating buttons (1 to 10) + N/A */}
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((num) => {
                        const isSelected = currentRating === num;
                        let btnStyle = "bg-white border-slate-200 text-slate-600 hover:bg-slate-50";
                        if (isSelected) {
                          if (num <= 3) btnStyle = "bg-rose-500 border-rose-500 text-white shadow-sm shadow-rose-500/20";
                          else if (num <= 7) btnStyle = "bg-amber-500 border-amber-500 text-white shadow-sm shadow-amber-500/20";
                          else btnStyle = "bg-emerald-500 border-emerald-500 text-white shadow-sm shadow-emerald-500/20";
                        }
                        return (
                          <button
                            type="button"
                            key={num}
                            onClick={() => {
                              const updated = [...skills];
                              updated[sIdx].rating = num;
                              setSkills(updated);
                            }}
                            className={`w-8 h-8 rounded-lg text-xs font-bold border transition-all active:scale-95 ${btnStyle}`}
                          >
                            {num}
                          </button>
                        );
                      })}
                      {(() => {
                        const isSelected = currentRating === "N/A";
                        let btnStyle = isSelected 
                          ? "bg-slate-650 border-slate-650 text-white shadow-sm shadow-slate-650/20" 
                          : "bg-white border-slate-200 text-slate-650 hover:bg-slate-50";
                        return (
                          <button
                            type="button"
                            onClick={() => {
                              const updated = [...skills];
                              updated[sIdx].rating = "N/A";
                              setSkills(updated);
                            }}
                            className={`px-3.5 h-8 rounded-lg text-xs font-bold border transition-all active:scale-95 ${btnStyle}`}
                          >
                            N/A
                          </button>
                        );
                      })()}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {showLockErrorModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/65 backdrop-blur-[2px] p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-2xl border border-slate-100 flex flex-col items-center text-center space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="w-12 h-12 bg-amber-50 rounded-full flex items-center justify-center border border-amber-100">
              <Lock className="w-5 h-5 text-amber-600" />
            </div>
            <div className="space-y-1.5">
              <h3 className="text-sm font-bold text-slate-900">Lock All KRAs to Confirm</h3>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                To submit your performance framework, please lock each Key Result Area (KRA) and its KPIs. Locking ensures your weight distribution is finalized.
              </p>
            </div>
            <button
              onClick={() => setShowLockErrorModal(false)}
              className="w-full py-2 bg-primary-600 hover:bg-primary-700 text-white text-xs font-bold rounded-xl transition-all shadow-md active:scale-[0.98]"
            >
              Understood, Go to Lock Options
            </button>
          </div>
        </div>
      )}
    </div>
  );
});

// ── Main Panel ────────────────────────────────────────────────────────────────

interface KRAKPIPanelProps {
  jdSessionId: string;
  employeeId: string;
  isManager?: boolean;
  externalEditActive?: boolean;
  jdData?: any;
}

export const KRAKPIPanel = forwardRef<any, KRAKPIPanelProps>(
  function KRAKPIPanel({ jdSessionId, employeeId, isManager = false, externalEditActive = false, jdData = null }, ref) {
  const [record, setRecord] = useState<KRAKPIRecord | null>(null);
  const [prereqStatus, setPrereqStatus] = useState<PrerequisiteStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showBypassModal, setShowBypassModal] = useState(false);

  const [localJd, setLocalJd] = useState<any>(null);
  const searchParams = useSearchParams();

  const confirmedViewRef = useRef<any>(null);

  useImperativeHandle(ref, () => ({
    save: async () => {
      if (confirmedViewRef.current?.save) {
        return await confirmedViewRef.current.save();
      }
      return false;
    },
    cancel: () => {
      if (confirmedViewRef.current?.cancel) {
        confirmedViewRef.current.cancel();
      }
    }
  }));

  // Scroll to skill-assessment section if query param is set
  useEffect(() => {
    if (!loading && record) {
      const section = searchParams.get("section");
      if (section === "skill-assessment") {
        const timer = setTimeout(() => {
          const el = document.getElementById("skill-assessment");
          if (el) {
            el.scrollIntoView({ behavior: "smooth", block: "start" });
          }
        }, 500);
        return () => clearTimeout(timer);
      }
    }
  }, [loading, record, searchParams]);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [existing, status, jdDetail] = await Promise.all([
        fetchKRAKPI(jdSessionId).catch(() => null),
        fetchKRAKPIStatus(jdSessionId, employeeId).catch(() => null),
        fetchJD(jdSessionId).catch(() => null),
      ]);
      setRecord(existing);
      setPrereqStatus(status);
      if (jdDetail) {
        setLocalJd(jdDetail);
      }
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
    setLoading(true);
    try {
      await selectKRAs(jdSessionId, ids);
      await reload();
    } catch (e: any) {
      setError(e.message || "KRA selection failed");
      setLoading(false);
    }
  };

  const handleAddCustomKra = async (title: string, description: string, selectedIds?: string[]) => {
    setError(null);
    try {
      const res = await addCustomKRA(jdSessionId, title, description, selectedIds);
      setRecord((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          kra_suggestions: res.kra_suggestions,
          selected_kra_ids: res.selected_kra_ids,
        };
      });
      return res.kra;
    } catch (e: any) {
      setError(e.message || "Failed to add custom KRA");
      throw e;
    }
  };

  const handleAddCustomKpi = async (
    kraId: string,
    metric: string,
    target: string,
    measurementMethod: string,
    frequency: string,
    selectedIds?: Record<string, string[]>
  ) => {
    setError(null);
    try {
      const res = await addCustomKPI(
        jdSessionId,
        kraId,
        metric,
        target,
        measurementMethod,
        frequency,
        selectedIds
      );
      setRecord((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          kpi_suggestions: res.kpi_suggestions,
          selected_kpi_ids: res.selected_kpi_ids,
        };
      });
      return res.kpi;
    } catch (e: any) {
      setError(e.message || "Failed to add custom KPI");
      throw e;
    }
  };

  const handleSelectKPIs = async (selected: Record<string, string[]>) => {
    setError(null);
    setLoading(true);
    try {
      await selectKPIs(jdSessionId, selected);
      await reload();
    } catch (e: any) {
      setError(e.message || "KPI selection failed");
      setLoading(false);
    }
  };

  const handleSaveWeights = async (kras: FinalKRA[], confirm: boolean) => {
    setError(null);
    setLoading(true);
    try {
      await saveKRAWeights(jdSessionId, kras, confirm);
      await reload();
    } catch (e: any) {
      setError(e.message || "Failed to save weights");
      setLoading(false);
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
    setError(null);
    setLoading(true);
    try {
      await sendKRAKPIForApproval(jdSessionId);
      await reload();
    } catch (e: any) {
      setError(e.message || "Failed to send for approval");
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 px-6 text-center animate-pulse">
        <div className="relative mb-6">
          <div className="absolute inset-0 bg-primary-400/20 blur-xl rounded-full scale-150 animate-pulse duration-1000" />
          <div className="relative flex items-center justify-center w-16 h-16 bg-white border-2 border-primary-500/20 rounded-2xl shadow-lg shadow-primary-500/5">
            <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
          </div>
        </div>
        <h3 className="text-base font-semibold text-surface-900 mb-1">
          Setting up your workspace
        </h3>
        <p className="text-xs text-surface-500 max-w-xs leading-relaxed">
          We are preparing your framework and configuring alignment settings. Please wait a moment.
        </p>
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
              initialSelected={record.selected_kra_ids || []}
              onContinue={handleSelectKRAs}
              onAddCustomKra={handleAddCustomKra}
            />
          )}

          {step === "kpi_selection" && record.kpi_suggestions && record.selected_kra_ids && (
            <Step2KPISelection
              selectedKras={record.selected_kra_ids}
              kpiSuggestions={record.kpi_suggestions}
              krasSuggestions={record.kra_suggestions?.kra_suggestions ?? []}
              initialSelected={record.selected_kpi_ids || {}}
              onContinue={handleSelectKPIs}
              onBack={handleGenerate}
              onAddCustomKpi={handleAddCustomKpi}
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
              ref={confirmedViewRef}
              record={record}
              onRegenerate={handleRegenerate}
              onSendForApproval={handleSendForApproval}
              jdData={localJd}
              isManager={isManager}
            />
          )}

          {step === "uploaded" && (
            <UploadedView record={record} jdData={localJd} />
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
});
