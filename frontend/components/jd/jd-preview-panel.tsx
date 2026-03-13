// components/jd/jd-preview-panel.tsx
// Slide-in panel shown on the CHAT page after JD generation

"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  X,
  Download,
  Save,
  CheckCircle2,
  Loader2,
  FileText,
  Briefcase,
  Target,
  Wrench,
  Users,
  BarChart3,
  Clock,
  ChevronRight,
  Sparkles,
  ExternalLink,
  Edit,
} from "lucide-react";
import { useRouter } from "next/navigation";

type Props = {
  jd: string | null;
  structuredData: any;
  isGenerating: boolean;
  isSaving: boolean;
  saveSuccess?: boolean;
  onSave: () => void;
  onEdit: () => void;
  updateJd: (newJd: string) => void;
  onClose: () => void;
  sessionId: string;
};

function SkillTag({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center px-3 py-1.5 rounded-lg text-[11px] font-bold bg-primary-50 text-primary-700 border border-primary-100 tracking-wide">
      {label}
    </span>
  );
}

function SectionBlock({
  icon: Icon,
  title,
  children,
}: {
  icon: any;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-8">
      <div className="flex items-center gap-2.5 mb-4">
        <div className="w-8 h-8 bg-surface-50 rounded-lg flex items-center justify-center border border-surface-100">
          <Icon className="w-4 h-4 text-primary-500" />
        </div>
        <h3 className="text-[10px] font-black text-surface-400 uppercase tracking-[0.25em]">
          {title}
        </h3>
      </div>
      <div className="pl-0">{children}</div>
    </div>
  );
}

function BulletList({ items }: { items: string[] }) {
  if (!items?.length) return null;
  return (
    <ul className="space-y-2.5">
      {items.map((item, i) => (
        <li
          key={i}
          className="flex items-start gap-3 text-[13px] text-surface-700 leading-relaxed"
        >
          <div className="mt-1.5 w-1.5 h-1.5 rounded-full bg-primary-400 flex-shrink-0" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

export default function JDPreviewPanel({
  jd,
  structuredData,
  isGenerating,
  isSaving,
  saveSuccess,
  onSave,
  onEdit,
  updateJd,
  onClose,
  sessionId,
}: Props) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<"structured" | "markdown">(
    "structured",
  );
  const [isEditing, setIsEditing] = useState(false);

  const s = structuredData || {};
  const empInfo = s.employee_information || {};
  const title =
    empInfo.job_title ||
    empInfo.title ||
    empInfo.role_title ||
    "Job Description";
  const dept = empInfo.department || "";
  const location = empInfo.location || "";
  const reportsTo = empInfo.reports_to || "";
  const workType = empInfo.work_type || empInfo.employment_type || "";

  const hasStructured =
    structuredData && Object.keys(structuredData).length > 0;

  return (
    <div className="flex flex-col h-full bg-white border-l border-surface-200 w-full">
      {/* Header */}
      <div className="flex-shrink-0 px-4 sm:px-6 py-3 sm:py-4 border-b border-surface-100 bg-gradient-to-r from-primary-600 to-primary-800">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2 sm:gap-2.5">
            <Sparkles className="w-4 h-4 sm:w-5 sm:h-5 text-white/80 shrink-0" />
            <span className="text-[9px] sm:text-[10px] font-black text-white/70 uppercase tracking-[0.25em] truncate">
              Generated JD
            </span>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors shrink-0 md:hidden"
          >
            <X className="w-4 h-4" />
          </button>
          <button
            onClick={onClose}
            className="hidden md:flex w-8 h-8 items-center justify-center rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <h2 className="text-base sm:text-lg font-black text-white leading-tight tracking-tight line-clamp-2">
          {isGenerating ? "Architecting..." : title}
        </h2>
        {!isGenerating && (dept || location) && (
          <p className="text-[10px] sm:text-[11px] text-white/60 mt-1 font-medium truncate">
            {[dept, location, workType].filter(Boolean).join(" · ")}
          </p>
        )}
      </div>

      {/* Loading state */}
      {isGenerating && (
        <div className="flex-1 flex flex-col items-center justify-center gap-6 p-8">
          <div className="relative">
            <div className="w-16 h-16 rounded-2xl bg-primary-50 flex items-center justify-center border border-primary-100">
              <Loader2 className="w-8 h-8 text-primary-600 animate-spin" />
            </div>
            <div className="absolute -inset-2 bg-primary-100 rounded-3xl animate-ping opacity-20" />
          </div>
          <div className="text-center">
            <p className="text-sm font-black text-surface-700 uppercase tracking-widest">
              Creating Your JD
            </p>
            <p className="text-xs text-surface-400 mt-2 font-medium">
              Generating role intelligence into professional format...
            </p>
          </div>
          <div className="w-full max-w-xs space-y-2">
            {[
              "Analyzing insights",
              "Structuring responsibilities",
              "Formatting document",
            ].map((step, i) => (
              <div key={i} className="flex items-center gap-3">
                <div
                  className="w-1.5 h-1.5 rounded-full bg-primary-400 animate-pulse"
                  style={{ animationDelay: `${i * 300}ms` }}
                />
                <span className="text-[11px] text-surface-500 font-medium">
                  {step}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tabs */}
      {!isGenerating && jd && (
        <>
          {hasStructured && (
            <div className="flex-shrink-0 flex border-b border-surface-100 px-2 sm:px-4 pt-2 sm:pt-3 gap-1 overflow-x-auto">
              {(["structured", "markdown"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-3 sm:px-4 py-1.5 sm:py-2 text-[9px] sm:text-[10px] font-black uppercase tracking-widest rounded-t-lg transition-all whitespace-nowrap ${
                    activeTab === tab
                      ? "bg-primary-600 text-white"
                      : "text-surface-400 hover:text-surface-700"
                  }`}
                >
                  {tab === "structured" ? "Structured View" : "Document View"}
                </button>
              ))}
            </div>
          )}

          {/* Content */}
          <div className="flex-1 overflow-y-auto">
            {/* STRUCTURED VIEW */}
            {activeTab === "structured" && hasStructured ? (
              <div className="p-4 sm:p-6 space-y-1">
                {/* Role meta */}
                {reportsTo && (
                  <div className="mb-4 sm:mb-6 px-3 sm:px-4 py-2 sm:py-3 bg-surface-50 rounded-xl border border-surface-100 flex items-center gap-2 sm:gap-3 text-[11px] sm:text-[12px] text-surface-600">
                    <Users className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-surface-400 shrink-0" />
                    <span className="truncate">
                      <span className="font-bold text-surface-900">
                        Reports to:
                      </span>{" "}
                      {reportsTo}
                    </span>
                  </div>
                )}

                {/* Role Summary */}
                {s.role_summary && (
                  <SectionBlock icon={FileText} title="Role Summary">
                    <p className="text-[13px] text-surface-700 leading-relaxed">
                      {typeof s.role_summary === "string"
                        ? s.role_summary
                        : s.role_summary?.description ||
                          JSON.stringify(s.role_summary)}
                    </p>
                  </SectionBlock>
                )}

                {/* Key Responsibilities */}
                {s.key_responsibilities?.length > 0 && (
                  <SectionBlock icon={Target} title="Key Responsibilities">
                    <BulletList items={s.key_responsibilities} />
                  </SectionBlock>
                )}

                {/* Required Skills */}
                {s.required_skills?.length > 0 && (
                  <SectionBlock icon={Briefcase} title="Required Skills">
                    <div className="flex flex-wrap gap-2">
                      {s.required_skills.map((skill: string, i: number) => (
                        <SkillTag key={i} label={skill} />
                      ))}
                    </div>
                  </SectionBlock>
                )}

                {/* Tools & Technologies */}
                {s.tools_and_technologies?.length > 0 && (
                  <SectionBlock icon={Wrench} title="Tools & Technologies">
                    <div className="flex flex-wrap gap-2">
                      {s.tools_and_technologies.map(
                        (tool: string, i: number) => (
                          <span
                            key={i}
                            className="inline-flex items-center px-3 py-1.5 rounded-lg text-[11px] font-bold bg-surface-50 text-surface-700 border border-surface-200 tracking-wide"
                          >
                            {tool}
                          </span>
                        ),
                      )}
                    </div>
                  </SectionBlock>
                )}

                {/* Performance Metrics */}
                {s.performance_metrics?.length > 0 && (
                  <SectionBlock icon={BarChart3} title="Performance Metrics">
                    <BulletList items={s.performance_metrics} />
                  </SectionBlock>
                )}

                {/* Team Structure */}
                {s.team_structure &&
                  Object.keys(s.team_structure).length > 0 && (
                    <SectionBlock icon={Users} title="Team Structure">
                      <div className="space-y-2">
                        {Object.entries(s.team_structure).map(([k, v]) => (
                          <div
                            key={k}
                            className="flex items-start justify-between gap-4 py-2 border-b border-surface-50 last:border-0"
                          >
                            <span className="text-[11px] font-bold text-surface-400 uppercase tracking-wider">
                              {k.replace(/_/g, " ")}
                            </span>
                            <span className="text-[12px] text-surface-700 font-semibold text-right">
                              {Array.isArray(v) ? v.join(", ") : String(v)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </SectionBlock>
                  )}

                {/* Work Environment */}
                {s.work_environment &&
                  Object.keys(s.work_environment).length > 0 && (
                    <SectionBlock icon={Clock} title="Work Environment">
                      <div className="space-y-2">
                        {Object.entries(s.work_environment).map(([k, v]) => (
                          <div
                            key={k}
                            className="flex items-start justify-between gap-4 py-2 border-b border-surface-50 last:border-0"
                          >
                            <span className="text-[11px] font-bold text-surface-400 uppercase tracking-wider">
                              {k.replace(/_/g, " ")}
                            </span>
                            <span className="text-[12px] text-surface-700 font-semibold text-right">
                              {Array.isArray(v) ? v.join(", ") : String(v)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </SectionBlock>
                  )}
              </div>
            ) : (
              /* MARKDOWN VIEW */
              <div className="p-4 sm:p-6 h-full flex flex-col min-h-[400px]">
                {isEditing ? (
                  <textarea
                    value={jd || ""}
                    onChange={(e) => updateJd(e.target.value)}
                    className="flex-1 w-full bg-surface-50 border border-surface-200 rounded-xl p-3 sm:p-4 text-surface-800 text-[12px] sm:text-[13px] font-mono leading-relaxed focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none resize-none"
                    placeholder="Type markdown job description here..."
                  />
                ) : (
                  <div className="prose prose-sm prose-neutral max-w-none prose-headings:font-bold prose-headings:text-surface-900 prose-h1:text-lg sm:prose-h1:text-xl prose-h2:text-sm sm:prose-h2:text-base prose-h2:mt-4 sm:prose-h2:mt-6 prose-p:text-surface-700 prose-li:text-surface-700 prose-strong:text-primary-700 text-sm">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {jd}
                    </ReactMarkdown>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Actions Footer */}
          <div className="flex-shrink-0 p-4 border-t border-surface-100 bg-surface-50 space-y-2">
            <button
              onClick={onSave}
              disabled={isSaving || saveSuccess}
              className={`w-full py-3.5 text-white rounded-xl font-bold text-[13px] transition-all shadow-lg active:scale-[0.98] flex items-center justify-center gap-2 ${
                saveSuccess
                  ? "bg-emerald-600 hover:bg-emerald-700 shadow-emerald-500/20 disabled:opacity-100"
                  : "bg-primary-600 hover:bg-primary-700 shadow-primary-500/20 disabled:opacity-50"
              }`}
            >
              {isSaving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : saveSuccess ? (
                <CheckCircle2 className="w-4 h-4" />
              ) : (
                <Save className="w-4 h-4" />
              )}
              {isSaving
                ? "Saving to Database..."
                : saveSuccess
                  ? "Saved Successfully!"
                  : "Save JD to Database"}
            </button>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  if (!isEditing) {
                    setActiveTab("markdown");
                  }
                  setIsEditing(!isEditing);
                }}
                disabled={isSaving}
                className={`w-full py-3 hover:bg-surface-50 border border-surface-200 rounded-xl font-bold text-[12px] transition-all active:scale-[0.98] flex items-center justify-center gap-2 shadow-sm ${
                  isEditing
                    ? "bg-primary-50 text-primary-700 border-primary-200"
                    : "bg-white text-surface-700"
                }`}
              >
                {isEditing ? (
                  <CheckCircle2 className="w-3.5 h-3.5" />
                ) : (
                  <Edit className="w-3.5 h-3.5" />
                )}
                {isEditing ? "Done Editing" : "Edit JD"}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
