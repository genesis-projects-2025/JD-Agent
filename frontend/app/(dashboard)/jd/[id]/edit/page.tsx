"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { fetchJD, updateJD } from "@/lib/api";
import {
  Save,
  X,
  ArrowLeft,
  Loader2,
  FileText,
  CheckCircle2,
  Hash,
  AlertCircle,
} from "lucide-react";

type JDData = {
  id: string;
  employee_id: string;
  title: string | null;
  status: string;
  version: number;
  generated_jd: string | null;
  jd_structured: Record<string, any> | null;
  updated_at: string;
};

const EDITABLE_SECTIONS = [
  { key: "role_summary", label: "Role Summary", type: "text" },
  { key: "key_responsibilities", label: "Key Responsibilities", type: "list" },
  { key: "required_skills", label: "Required Skills", type: "list" },
  {
    key: "tools_and_technologies",
    label: "Tools & Technologies",
    type: "list",
  },
  { key: "performance_metrics", label: "Performance Metrics", type: "list" },
] as const;

export default function JDEditPage() {
  const params = useParams();
  const router = useRouter();
  const jdId = params.id as string;

  const [original, setOriginal] = useState<JDData | null>(null);
  const [structured, setStructured] = useState<Record<string, any>>({});
  const [jdText, setJdText] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  const originalStructuredRef = useRef<string>("");

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        const data = await fetchJD(jdId);
        setOriginal(data);
        const s = data.jd_structured || {};
        setStructured(JSON.parse(JSON.stringify(s)));
        setJdText(data.generated_jd || "");
        originalStructuredRef.current = JSON.stringify(s);
      } catch (err: any) {
        setError(err?.response?.data?.detail || "Failed to load JD");
      } finally {
        setLoading(false);
      }
    }
    if (jdId) load();
  }, [jdId]);

  // Track changes
  useEffect(() => {
    if (!original) return;
    const currentStr = JSON.stringify(structured);
    const changed =
      currentStr !== originalStructuredRef.current ||
      jdText !== (original.generated_jd || "");
    setHasChanges(changed);
  }, [structured, jdText, original]);

  const updateSection = useCallback((key: string, value: any) => {
    setStructured((prev) => ({ ...prev, [key]: value }));
  }, []);

  const updateListItem = useCallback(
    (sectionKey: string, index: number, value: string) => {
      setStructured((prev) => {
        const list = [...(prev[sectionKey] || [])];
        list[index] = value;
        return { ...prev, [sectionKey]: list };
      });
    },
    [],
  );

  const addListItem = useCallback((sectionKey: string) => {
    setStructured((prev) => {
      const list = [...(prev[sectionKey] || []), ""];
      return { ...prev, [sectionKey]: list };
    });
  }, []);

  const removeListItem = useCallback((sectionKey: string, index: number) => {
    setStructured((prev) => {
      const list = [...(prev[sectionKey] || [])];
      list.splice(index, 1);
      return { ...prev, [sectionKey]: list };
    });
  }, []);

  // Build jd_text from structured data
  const buildJDText = useCallback((s: Record<string, any>): string => {
    const parts: string[] = [];

    const empInfo = s.employee_information;
    if (empInfo && typeof empInfo === "object") {
      const title =
        empInfo.job_title || empInfo.title || empInfo.role_title || "";
      if (title) parts.push(`Job Title: ${title}`);
      Object.entries(empInfo).forEach(([k, v]) => {
        if (!["job_title", "title", "role_title"].includes(k) && v) {
          parts.push(
            `${k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}: ${v}`,
          );
        }
      });
      parts.push("");
    }

    if (s.role_summary) {
      parts.push("ROLE SUMMARY");
      parts.push("─".repeat(40));
      if (typeof s.role_summary === "string") {
        parts.push(s.role_summary);
      } else {
        Object.entries(s.role_summary).forEach(([k, v]) => {
          parts.push(
            `${k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}: ${v}`,
          );
        });
      }
      parts.push("");
    }

    if (s.key_responsibilities?.length) {
      parts.push("KEY RESPONSIBILITIES");
      parts.push("─".repeat(40));
      s.key_responsibilities.forEach((r: string) => parts.push(`• ${r}`));
      parts.push("");
    }

    if (s.required_skills?.length) {
      parts.push("REQUIRED SKILLS");
      parts.push("─".repeat(40));
      s.required_skills.forEach((r: string) => parts.push(`• ${r}`));
      parts.push("");
    }

    if (s.tools_and_technologies?.length) {
      parts.push("TOOLS & TECHNOLOGIES");
      parts.push("─".repeat(40));
      s.tools_and_technologies.forEach((r: string) => parts.push(`• ${r}`));
      parts.push("");
    }

    if (s.performance_metrics?.length) {
      parts.push("PERFORMANCE METRICS");
      parts.push("─".repeat(40));
      s.performance_metrics.forEach((r: string) => parts.push(`• ${r}`));
      parts.push("");
    }

    return parts.join("\n");
  }, []);

  const handleSave = async () => {
    if (!original) return;
    setSaving(true);
    setSaveSuccess(false);
    try {
      // Rebuild jd_text from structured data
      const updatedText = buildJDText(structured);

      await updateJD(jdId, {
        jd_text: updatedText,
        jd_structured: structured,
        employee_id: original.employee_id,
      });

      setSaveSuccess(true);
      setTimeout(() => {
        router.push(`/jd/${jdId}`);
      }, 800);
    } catch (err: any) {
      alert(err?.response?.data?.detail || "Failed to save changes");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <Loader2 className="w-8 h-8 text-blue-600 animate-spin mx-auto mb-3" />
          <p className="text-sm text-neutral-500">Loading editor...</p>
        </div>
      </div>
    );
  }

  if (error || !original) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center max-w-md">
          <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
          <h2 className="text-lg font-semibold text-neutral-900 mb-2">
            Error Loading JD
          </h2>
          <p className="text-sm text-neutral-500 mb-6">{error}</p>
          <button
            onClick={() => router.back()}
            className="px-6 py-2.5 bg-neutral-900 text-white rounded-lg text-sm font-medium"
          >
            Go Back
          </button>
        </div>
      </div>
    );
  }

  const displayTitle =
    original.title ||
    structured?.employee_information?.job_title ||
    "Untitled JD";

  return (
    <div className="h-[calc(100vh-3rem)] flex flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex-shrink-0 bg-white border-b border-neutral-200 shadow-sm">
        <div className="max-w-5xl mx-auto px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.push(`/jd/${jdId}`)}
              className="flex items-center gap-1.5 text-neutral-500 hover:text-neutral-900 transition-colors text-sm"
            >
              <ArrowLeft className="w-4 h-4" />
              Back
            </button>
            <div className="w-px h-6 bg-neutral-200" />
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-blue-50 rounded-lg flex items-center justify-center">
                <FileText className="w-4.5 h-4.5 text-blue-600" />
              </div>
              <div>
                <h1 className="text-sm font-bold text-neutral-900">
                  Editing: {displayTitle}
                </h1>
                <p className="text-xs text-neutral-500 flex items-center gap-2">
                  <Hash className="w-3 h-3" />
                  Version {original.version} → {original.version + 1}
                  {hasChanges && (
                    <span className="text-amber-600 font-medium">
                      • Unsaved changes
                    </span>
                  )}
                </p>
              </div>
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => router.push(`/jd/${jdId}`)}
              className="px-5 py-2.5 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 rounded-xl text-sm font-medium transition-all flex items-center gap-2"
            >
              <X className="w-4 h-4" />
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !hasChanges}
              className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-bold transition-all flex items-center gap-2 shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : saveSuccess ? (
                <CheckCircle2 className="w-4 h-4" />
              ) : (
                <Save className="w-4 h-4" />
              )}
              {saving ? "Saving..." : saveSuccess ? "Saved!" : "Save Changes"}
            </button>
          </div>
        </div>
      </div>

      {/* Editor Content */}
      <div className="flex-1 min-h-0 overflow-y-auto bg-neutral-50">
        <div className="max-w-5xl mx-auto px-8 py-8 space-y-6">
          {/* Employee Information (read-only display) */}
          {structured.employee_information &&
            typeof structured.employee_information === "object" && (
              <div className="bg-white rounded-xl border border-neutral-200 shadow-sm">
                <div className="flex items-center gap-3 px-6 py-4 border-b border-neutral-100">
                  <h3 className="text-sm font-semibold text-neutral-900 uppercase tracking-wide">
                    Employee Information
                  </h3>
                  <span className="text-xs text-neutral-400">
                    (auto-filled)
                  </span>
                </div>
                <div className="px-6 py-5 grid grid-cols-2 gap-4">
                  {Object.entries(structured.employee_information).map(
                    ([key, val]) => (
                      <div key={key}>
                        <label className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">
                          {key.replace(/_/g, " ")}
                        </label>
                        <p className="text-sm text-neutral-800 mt-1">
                          {String(val)}
                        </p>
                      </div>
                    ),
                  )}
                </div>
              </div>
            )}

          {/* Editable Sections */}
          {EDITABLE_SECTIONS.map((section) => {
            const value = structured[section.key];

            if (section.type === "text") {
              const textVal =
                typeof value === "string"
                  ? value
                  : typeof value === "object"
                    ? JSON.stringify(value, null, 2)
                    : "";
              return (
                <div
                  key={section.key}
                  className="bg-white rounded-xl border border-neutral-200 shadow-sm"
                >
                  <div className="flex items-center gap-3 px-6 py-4 border-b border-neutral-100">
                    <h3 className="text-sm font-semibold text-neutral-900 uppercase tracking-wide">
                      {section.label}
                    </h3>
                  </div>
                  <div className="px-6 py-5">
                    <textarea
                      value={textVal}
                      onChange={(e) =>
                        updateSection(section.key, e.target.value)
                      }
                      rows={4}
                      className="w-full p-4 bg-neutral-50 border border-neutral-200 rounded-xl text-sm text-neutral-800 leading-relaxed resize-y focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                      placeholder={`Enter ${section.label.toLowerCase()}...`}
                    />
                  </div>
                </div>
              );
            }

            // List type
            const listVal: string[] = Array.isArray(value) ? value : [];
            return (
              <div
                key={section.key}
                className="bg-white rounded-xl border border-neutral-200 shadow-sm"
              >
                <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-100">
                  <h3 className="text-sm font-semibold text-neutral-900 uppercase tracking-wide">
                    {section.label}
                  </h3>
                  <button
                    onClick={() => addListItem(section.key)}
                    className="px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg text-xs font-semibold transition-colors"
                  >
                    + Add Item
                  </button>
                </div>
                <div className="px-6 py-5 space-y-3">
                  {listVal.length === 0 && (
                    <p className="text-neutral-400 text-sm italic">
                      No items. Click &quot;+ Add Item&quot; to add.
                    </p>
                  )}
                  {listVal.map((item, i) => (
                    <div key={i} className="flex items-start gap-3 group">
                      <span className="mt-3 w-2 h-2 rounded-full bg-blue-400 flex-shrink-0" />
                      <input
                        type="text"
                        value={item}
                        onChange={(e) =>
                          updateListItem(section.key, i, e.target.value)
                        }
                        className="flex-1 px-4 py-2.5 bg-neutral-50 border border-neutral-200 rounded-lg text-sm text-neutral-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                        placeholder="Enter item..."
                      />
                      <button
                        onClick={() => removeListItem(section.key, i)}
                        className="mt-1.5 p-1.5 text-neutral-300 hover:text-red-500 hover:bg-red-50 rounded-lg opacity-0 group-hover:opacity-100 transition-all"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}

          {/* Team Structure */}
          {structured.team_structure &&
            Object.keys(structured.team_structure).length > 0 && (
              <div className="bg-white rounded-xl border border-neutral-200 shadow-sm">
                <div className="px-6 py-4 border-b border-neutral-100">
                  <h3 className="text-sm font-semibold text-neutral-900 uppercase tracking-wide">
                    Team Structure
                  </h3>
                </div>
                <div className="px-6 py-5">
                  <textarea
                    value={JSON.stringify(structured.team_structure, null, 2)}
                    onChange={(e) => {
                      try {
                        updateSection(
                          "team_structure",
                          JSON.parse(e.target.value),
                        );
                      } catch {
                        /* ignore parse errors while typing */
                      }
                    }}
                    rows={6}
                    className="w-full p-4 bg-neutral-50 border border-neutral-200 rounded-xl text-sm text-neutral-800 font-mono leading-relaxed resize-y focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                  />
                </div>
              </div>
            )}

          {/* Work Environment */}
          {structured.work_environment &&
            Object.keys(structured.work_environment).length > 0 && (
              <div className="bg-white rounded-xl border border-neutral-200 shadow-sm">
                <div className="px-6 py-4 border-b border-neutral-100">
                  <h3 className="text-sm font-semibold text-neutral-900 uppercase tracking-wide">
                    Work Environment
                  </h3>
                </div>
                <div className="px-6 py-5">
                  <textarea
                    value={JSON.stringify(structured.work_environment, null, 2)}
                    onChange={(e) => {
                      try {
                        updateSection(
                          "work_environment",
                          JSON.parse(e.target.value),
                        );
                      } catch {
                        /* ignore parse errors while typing */
                      }
                    }}
                    rows={6}
                    className="w-full p-4 bg-neutral-50 border border-neutral-200 rounded-xl text-sm text-neutral-800 font-mono leading-relaxed resize-y focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                  />
                </div>
              </div>
            )}

          <div className="h-8" />
        </div>
      </div>
    </div>
  );
}
