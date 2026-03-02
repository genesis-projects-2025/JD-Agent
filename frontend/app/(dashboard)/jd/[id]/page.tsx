// app/(dashboard)/jd/[id]/page.tsx
"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  FileText,
  Clock,
  ArrowLeft,
  Loader2,
  Building2,
  TrendingUp,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Send,
  Edit3,
  Edit,
  Save,
  Plus,
  Trash,
} from "lucide-react";
import {
  fetchJD,
  getCurrentUser,
  isManager,
  isEmployee,
  approveJD,
  rejectJDHR,
  rejectJDManager,
  sendToHR,
  submitToManager,
  saveJD,
} from "@/lib/api";
import { DeleteModal } from "@/components/ui/delete-modal";

export default function JDPage() {
  const params = useParams();
  const router = useRouter();
  const jdId = params.id as string;

  const [jd, setJd] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<string>("employee");
  const [hasInsights, setHasInsights] = useState(false);

  const [sendingToManager, setSendingToManager] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Edit mode
  const [isEditing, setIsEditing] = useState(false);
  const [editedJdText, setEditedJdText] = useState("");
  const [editedData, setEditedData] = useState<any>({});
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [activeTab, setActiveTab] = useState<"markdown" | "structured">(
    "markdown",
  );

  // Helper to deep unwrap double-stringified JSON objects from the LLM core
  const safeParseObject = (obj: any): any => {
    if (!obj) return {};
    if (typeof obj !== "string") return obj;
    try {
      const parsed = JSON.parse(obj);
      return typeof parsed === "string" ? safeParseObject(parsed) : parsed;
    } catch (e) {
      return {};
    }
  };

  const handleTextChange = (field: string, val: string) => {
    setEditedData((prev: any) => ({ ...prev, [field]: val }));
  };

  const handleArrayChange = (field: string, idx: number, val: string) => {
    setEditedData((prev: any) => {
      const arr = [...(prev[field] || [])];
      arr[idx] = val;
      return { ...prev, [field]: arr };
    });
  };

  const handleAddArrayItem = (field: string) => {
    setEditedData((prev: any) => ({
      ...prev,
      [field]: [...(prev[field] || []), ""],
    }));
  };

  const handleRemoveArrayItem = (field: string, idx: number) => {
    setEditedData((prev: any) => {
      const arr = [...(prev[field] || [])];
      arr.splice(idx, 1);
      return { ...prev, [field]: arr };
    });
  };

  useEffect(() => {
    const init = async () => {
      try {
        const u = getCurrentUser();
        if (u) setRole(u.role);

        const data = await fetchJD(jdId);
        setJd(data);

        // Initialize edit states
        let pText = data.generated_jd || "";
        try {
          const p = JSON.parse(pText);
          if (p.jd_text_format) pText = p.jd_text_format;
        } catch (e) {}
        setEditedJdText(pText);

        let pStruct = safeParseObject(data.jd_structured);

        // Fallback: If structured data is completely empty, try pulling it from the generated_jd block
        if (
          !pStruct ||
          Object.keys(pStruct).length === 0 ||
          !pStruct.key_responsibilities
        ) {
          try {
            const p = safeParseObject(data.generated_jd);
            if (p.jd_structured_data) {
              pStruct = p.jd_structured_data;
            } else if (p.role_summary || p.key_responsibilities) {
              pStruct = p;
            }
          } catch (e) {}
        }

        // Final Failsafe for missing keys
        if (!pStruct || typeof pStruct !== "object") pStruct = {};
        pStruct.key_responsibilities = pStruct.key_responsibilities || [];
        pStruct.required_skills = pStruct.required_skills || [];
        pStruct.tools_and_technologies = pStruct.tools_and_technologies || [];
        pStruct.performance_metrics = pStruct.performance_metrics || [];

        console.log("JD Edit Loader -> Final extracted pStruct:", pStruct);
        setEditedData(pStruct);

        if (
          data.insights &&
          Object.keys(data.insights).length > 0 &&
          data.insights.identity_context
        ) {
          setHasInsights(true);
        }
      } catch (error) {
        console.error("Error loading JD:", error);
      } finally {
        setLoading(false);
      }
    };
    init();
  }, [jdId]);

  if (loading) {
    return (
      <div className="h-[calc(100vh-8rem)] flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-primary-600 animate-spin" />
      </div>
    );
  }

  if (!jd) {
    return (
      <div className="p-8 text-center bg-white rounded-3xl border border-surface-200 shadow-sm max-w-md mx-auto mt-20">
        <AlertTriangle className="w-12 h-12 text-surface-400 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-surface-900 mb-2">
          JD Not Found
        </h2>
        <p className="text-surface-500 mb-6">
          This Job Description may have been moved or deleted.
        </p>
        <button
          onClick={() => router.back()}
          className="px-6 py-3 bg-surface-100 text-surface-700 rounded-xl font-bold hover:bg-surface-200 transition-colors"
        >
          Go Back
        </button>
      </div>
    );
  }

  const handleManagerReject = async () => {
    const reason = prompt(
      "Enter reasoning for rejection (sent back to employee):",
    );
    if (!reason) return;
    setSendingToManager(true);
    try {
      await rejectJDManager(jd.id, reason, jd.employee_id);
      const updated = await fetchJD(jd.id);
      setJd(updated);
    } catch (e: any) {
      alert(e.message || "Failed to reject JD.");
    } finally {
      setSendingToManager(false);
    }
  };

  const handleManagerSendToHR = async () => {
    setSendingToManager(true);
    try {
      await sendToHR(jd.id, jd.employee_id);
      const updated = await fetchJD(jd.id);
      setJd(updated);
    } catch (e: any) {
      alert(e.message || "Failed to send to HR.");
    } finally {
      setSendingToManager(false);
    }
  };

  const handleHRReject = async () => {
    const reason = prompt(
      "Enter reasoning for rejection (sent back to manager/employee):",
    );
    if (!reason) return;
    setSendingToManager(true);
    try {
      await rejectJDHR(jd.id, reason, jd.employee_id);
      const updated = await fetchJD(jd.id);
      setJd(updated);
    } catch (e: any) {
      alert(e.message || "Failed to reject JD.");
    } finally {
      setSendingToManager(false);
    }
  };

  const handleHRApprove = async () => {
    setSendingToManager(true);
    try {
      await approveJD(jd.id, jd.employee_id);
      const updated = await fetchJD(jd.id);
      setJd(updated);
    } catch (e: any) {
      alert(e.message || "Failed to approve JD.");
    } finally {
      setSendingToManager(false);
    }
  };

  const handleSaveEdits = async () => {
    if (!jd) return;
    setIsSavingEdit(true);
    try {
      // Attach the role context to show who edited this last
      const enrichedData = {
        ...editedData,
        _last_edited_by: role,
      };

      // Create a wrapper payload simulating the AI's internal response framework
      const payload = JSON.stringify({
        jd_text_format: editedJdText,
        jd_structured_data: enrichedData,
      });

      await saveJD({
        id: jd.id,
        jd_text: payload,
        jd_structured: enrichedData,
        employee_id: jd.employee_id,
      });

      // Fetch fresh instance
      const updated = await fetchJD(jd.id);
      setJd(updated);
      setIsEditing(false);
    } catch (e: any) {
      alert("Failed to save your edits: " + e.message);
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleSendToManager = async () => {
    setSendingToManager(true);
    try {
      await submitToManager(jd.id, jd.employee_id);
      const updated = await fetchJD(jd.id);
      setJd(updated);
    } catch (e: any) {
      alert(e.message || "Failed to submit JD.");
    } finally {
      setSendingToManager(false);
    }
  };

  const handleEditToggle = () => {
    if (isEditing) handleSaveEdits();
    else {
      let pTextRaw = jd.generated_jd || "";
      let pText = pTextRaw;
      try {
        const p = JSON.parse(pTextRaw);
        if (p.jd_text_format) pText = p.jd_text_format;
      } catch (e) {}

      let pStruct = safeParseObject(jd.jd_structured);
      if (
        !pStruct ||
        Object.keys(pStruct).length === 0 ||
        !pStruct.key_responsibilities
      ) {
        const p = safeParseObject(jd.generated_jd);
        if (p.jd_structured_data) {
          pStruct = p.jd_structured_data;
        } else if (p.role_summary || p.key_responsibilities) {
          pStruct = p;
        }
      }

      // Final Failsafe for missing keys
      if (!pStruct || typeof pStruct !== "object") pStruct = {};
      pStruct.key_responsibilities = pStruct.key_responsibilities || [];
      pStruct.required_skills = pStruct.required_skills || [];
      pStruct.tools_and_technologies = pStruct.tools_and_technologies || [];
      pStruct.performance_metrics = pStruct.performance_metrics || [];

      console.log("JD Edit Button -> Extracted pStruct:", pStruct);
      setEditedJdText(pText);
      setEditedData(pStruct);
      setIsEditing(true);
    }
  };

  let displayJDContent =
    jd.generated_jd || "No formatted Job Description text available.";
  try {
    const parsedJD = JSON.parse(displayJDContent);
    if (parsedJD.jd_text_format) {
      displayJDContent = parsedJD.jd_text_format;
    }
  } catch (e) {}

  return (
    <div className="max-w-7xl mx-auto space-y-6 pb-24 animate-in fade-in duration-500">
      <button
        onClick={() => router.back()}
        className="flex items-center gap-2 text-surface-400 hover:text-primary-600 transition-colors text-[11px] font-black uppercase tracking-widest group px-2"
      >
        <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
        Back to Dashboard
      </button>

      {/* Header card */}
      <div className="bg-white rounded-[40px] p-10 md:p-12 border border-surface-200 shadow-premium relative overflow-hidden">
        <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-gradient-to-br from-primary-50 via-white to-transparent opacity-50 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3 pointer-events-none"></div>
        <div className="relative z-10 flex flex-col md:flex-row md:items-start justify-between gap-8">
          <div>
            <div className="flex flex-wrap items-center gap-3 mb-6">
              <span className="px-4 py-1.5 bg-surface-100 text-surface-600 rounded-xl text-[11px] font-black uppercase tracking-widest flex items-center gap-1.5 border border-surface-200/50 shadow-sm">
                <FileText className="w-4 h-4" />
                Version {jd.version || 1}.0
              </span>
              <span className="px-4 py-1.5 bg-primary-50 text-primary-700 rounded-xl text-[11px] font-black uppercase tracking-widest border border-primary-100 shadow-sm">
                {jd.status.replace(/_/g, " ")}
              </span>

              {jd.jd_structured?._last_edited_by && (
                <span className="px-4 py-1.5 bg-amber-50 text-amber-700 rounded-xl text-[11px] font-black uppercase tracking-widest border border-amber-200 shadow-sm flex items-center gap-1">
                  <Edit className="w-3.5 h-3.5" />
                  Edited by {jd.jd_structured._last_edited_by}
                </span>
              )}
            </div>
            <h1 className="text-4xl md:text-5xl font-black text-surface-900 tracking-tight mb-3">
              {jd.title || "Strategic Role Architecture"}
            </h1>
            {jd.department && (
              <p className="text-sm font-bold text-surface-500 uppercase tracking-widest">
                {jd.department}
              </p>
            )}
          </div>

          {(role === "manager" || role === "hr") && (
            <div className="flex flex-col gap-3 min-w-[240px]">
              {role === "manager" && jd.status === "sent_to_manager" && (
                <div className="flex flex-col sm:flex-row gap-3 w-full">
                  <button
                    onClick={handleManagerSendToHR}
                    disabled={sendingToManager || isEditing}
                    className="flex-1 px-5 py-3.5 bg-emerald-600 text-white rounded-xl font-bold flex flex-center items-center justify-center gap-2 shadow-sm hover:shadow-md hover:-translate-y-0.5 hover:bg-emerald-700 text-[14px] transition-all disabled:opacity-50 whitespace-nowrap"
                  >
                    <CheckCircle2 className="w-4 h-4" /> Approve
                  </button>
                  <button
                    onClick={handleEditToggle}
                    disabled={isSavingEdit || sendingToManager}
                    className="flex-1 px-5 py-3.5 bg-white text-primary-700 border border-primary-200 rounded-xl font-bold hover:bg-primary-50 transition-all shadow-sm active:scale-[0.98] flex items-center justify-center gap-2 text-[14px] disabled:opacity-50 whitespace-nowrap"
                  >
                    {isSavingEdit ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : isEditing ? (
                      <Save className="w-4 h-4" />
                    ) : (
                      <Edit className="w-4 h-4" />
                    )}
                    {isEditing ? "Save" : "Edit"}
                  </button>
                  <button
                    onClick={handleManagerReject}
                    disabled={sendingToManager || isEditing}
                    className="px-5 py-3.5 bg-red-50 text-red-600 border border-red-100 rounded-xl font-bold flex flex-center items-center justify-center gap-2 shadow-sm hover:bg-red-100 text-[14px] transition-all disabled:opacity-50 whitespace-nowrap"
                  >
                    <XCircle className="w-4 h-4" /> Reject
                  </button>
                </div>
              )}
              {role === "manager" &&
                ["sent_to_hr", "hr_rejected", "approved"].includes(
                  jd.status,
                ) && (
                  <button
                    disabled
                    className="w-full px-6 py-4 bg-emerald-50 text-emerald-600 border border-emerald-200 rounded-2xl font-bold flex items-center justify-center gap-2 text-[15px] cursor-not-allowed shadow-sm"
                  >
                    <CheckCircle2 className="w-5 h-5" /> Approved by Manager
                  </button>
                )}
              {role === "hr" && jd.status === "sent_to_hr" && (
                <div className="flex flex-col sm:flex-row gap-3 w-full">
                  <button
                    onClick={handleHRApprove}
                    disabled={sendingToManager || isEditing}
                    className="flex-1 px-5 py-3.5 bg-purple-600 text-white rounded-xl font-bold flex flex-center items-center justify-center gap-2 shadow-sm hover:shadow-md hover:-translate-y-0.5 hover:bg-purple-700 text-[14px] transition-all disabled:opacity-50 whitespace-nowrap"
                  >
                    <ShieldCheck className="w-4 h-4" /> Approve
                  </button>
                  <button
                    onClick={handleEditToggle}
                    disabled={isSavingEdit || sendingToManager}
                    className="flex-1 px-5 py-3.5 bg-white text-primary-700 border border-primary-200 rounded-xl font-bold hover:bg-primary-50 transition-all shadow-sm active:scale-[0.98] flex items-center justify-center gap-2 text-[14px] disabled:opacity-50 whitespace-nowrap"
                  >
                    {isSavingEdit ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : isEditing ? (
                      <Save className="w-4 h-4" />
                    ) : (
                      <Edit className="w-4 h-4" />
                    )}
                    {isEditing ? "Save" : "Edit"}
                  </button>
                  <button
                    onClick={handleHRReject}
                    disabled={sendingToManager || isEditing}
                    className="px-5 py-3.5 bg-red-50 text-red-600 border border-red-100 rounded-xl font-bold flex flex-center items-center justify-center gap-2 shadow-sm hover:bg-red-100 text-[14px] transition-all disabled:opacity-50 whitespace-nowrap"
                  >
                    <XCircle className="w-4 h-4" /> Reject
                  </button>
                </div>
              )}
              {role === "hr" && jd.status === "approved" && (
                <button
                  disabled
                  className="w-full px-6 py-4 bg-purple-50 text-purple-600 border border-purple-200 rounded-2xl font-bold flex items-center justify-center gap-2 text-[15px] cursor-not-allowed shadow-sm"
                >
                  <ShieldCheck className="w-5 h-5" /> Finalized by HR
                </button>
              )}
            </div>
          )}

          {role === "employee" && (
            <div className="flex flex-col sm:flex-row gap-3 mt-4 md:mt-0">
              {[
                "draft",
                "jd_generated",
                "manager_rejected",
                "hr_rejected",
              ].includes(jd.status) && (
                <>
                  <button
                    onClick={() => router.push(`/questionnaire/${jdId}`)}
                    className="px-6 py-3.5 bg-white text-surface-700 border border-surface-200 rounded-2xl font-bold hover:bg-surface-50 hover:shadow-md transition-all shadow-sm active:scale-[0.98] flex items-center justify-center gap-2 text-[14px]"
                  >
                    <Edit3 className="w-4 h-4" /> Refine in Chat
                  </button>
                  <button
                    onClick={handleEditToggle}
                    disabled={isSavingEdit}
                    className="px-6 py-3.5 bg-white text-primary-700 border border-primary-200 rounded-2xl font-bold hover:bg-primary-50 transition-all shadow-sm active:scale-[0.98] flex items-center justify-center gap-2 text-[14px] disabled:opacity-50"
                  >
                    {isSavingEdit ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : isEditing ? (
                      <Save className="w-4 h-4" />
                    ) : (
                      <Edit className="w-4 h-4" />
                    )}
                    {isEditing ? "Save Edits" : "Edit Document"}
                  </button>
                  <button
                    onClick={handleSendToManager}
                    disabled={sendingToManager || isEditing}
                    className="px-6 py-3.5 bg-primary-600 text-white rounded-2xl font-bold hover:bg-primary-700 transition-all shadow-md active:scale-[0.98] flex items-center justify-center gap-2 text-[14px] disabled:opacity-50 hover:shadow-lg hover:-translate-y-0.5"
                  >
                    {sendingToManager ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Send className="w-4 h-4" />
                    )}
                    Submit for Approval
                  </button>
                </>
              )}
              {["sent_to_manager", "sent_to_hr", "approved"].includes(
                jd.status,
              ) && (
                <button
                  disabled
                  className="px-6 py-3.5 bg-surface-50 text-surface-400 border border-surface-200 rounded-2xl font-bold flex items-center justify-center gap-2 text-[14px] cursor-not-allowed"
                >
                  <CheckCircle2 className="w-5 h-5" />
                  {jd.status === "approved" ? "Finalized" : "Asset Submitted"}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {jd.reviewer_comment && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-6 shadow-sm">
          <div className="flex items-center gap-2 text-red-700 mb-2 font-bold text-sm">
            <AlertTriangle className="w-5 h-5" />
            Rejection Feedback ({jd.reviewed_by})
          </div>
          <p className="text-red-600 text-[13px] leading-relaxed">
            {jd.reviewer_comment}
          </p>
        </div>
      )}

      {/* Document block */}
      <div className="bg-white rounded-[40px] p-10 md:p-16 border border-surface-200 shadow-premium relative min-h-[500px] flex flex-col">
        {isEditing ? (
          <div className="flex flex-col flex-1">
            <div className="flex gap-2 mb-4">
              <button
                onClick={() => setActiveTab("markdown")}
                className={`px-4 py-2 font-bold text-[12px] uppercase tracking-widest rounded-xl transition-all ${
                  activeTab === "markdown"
                    ? "bg-primary-600 text-white shadow-sm"
                    : "bg-surface-50 text-surface-500 hover:bg-surface-100"
                }`}
              >
                Markdown Document
              </button>
              <button
                onClick={() => {
                  console.log(
                    "Switching to structured tab. editedData state:",
                    editedData,
                  );
                  setActiveTab("structured");
                }}
                className={`px-4 py-2 font-bold text-[12px] uppercase tracking-widest rounded-xl transition-all ${
                  activeTab === "structured"
                    ? "bg-primary-600 text-white shadow-sm"
                    : "bg-surface-50 text-surface-500 hover:bg-surface-100"
                }`}
              >
                Structured Core Model (JSON)
              </button>
            </div>

            {activeTab === "markdown" ? (
              <textarea
                value={editedJdText}
                onChange={(e) => setEditedJdText(e.target.value)}
                className="flex-1 w-full bg-surface-50 border border-surface-200 rounded-xl p-6 text-surface-800 text-[14px] font-mono leading-relaxed focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none resize-none min-h-[500px] h-[600px] shadow-inner"
                placeholder="Edit Job Description Markdown..."
              />
            ) : (
              <div className="flex-1 w-full bg-surface-50 border border-surface-200 rounded-xl p-8 overflow-y-auto h-[600px] flex flex-col gap-10 shadow-inner">
                {/* Job Title */}
                <div className="space-y-3">
                  <label className="text-[13px] font-black text-surface-500 uppercase tracking-widest">
                    Job Title
                  </label>
                  <input
                    type="text"
                    value={
                      editedData.job_title ||
                      editedData.role_title ||
                      editedData.title ||
                      editedData.employee_information?.job_title ||
                      ""
                    }
                    onChange={(e) =>
                      handleTextChange("job_title", e.target.value)
                    }
                    className="w-full bg-white border border-surface-200 rounded-xl p-5 text-[15px] font-medium text-surface-900 leading-relaxed focus:ring-2 focus:ring-primary-500 outline-none shadow-sm transition-shadow focus:shadow-md"
                    placeholder="e.g. Senior AI Architect"
                  />
                </div>

                {/* Role Summary */}
                <div className="space-y-3">
                  <label className="text-[13px] font-black text-surface-500 uppercase tracking-widest">
                    Role Summary
                  </label>
                  <textarea
                    value={editedData.role_summary || ""}
                    onChange={(e) =>
                      handleTextChange("role_summary", e.target.value)
                    }
                    className="w-full bg-white border border-surface-200 rounded-xl p-5 text-[15px] font-medium text-surface-900 leading-relaxed focus:ring-2 focus:ring-primary-500 outline-none resize-none min-h-[160px] shadow-sm transition-shadow focus:shadow-md"
                    placeholder="Brief overview of the role..."
                  />
                </div>

                {/* Array fields */}
                {[
                  {
                    key: "key_responsibilities",
                    label: "Key Responsibilities",
                  },
                  { key: "required_skills", label: "Required Skills" },
                  {
                    key: "tools_and_technologies",
                    label: "Tools & Technologies",
                  },
                  { key: "performance_metrics", label: "Performance Metrics" },
                ].map((field) => (
                  <div key={field.key} className="space-y-4">
                    <div className="flex items-center justify-between">
                      <label className="text-[13px] font-black text-surface-500 uppercase tracking-widest">
                        {field.label}
                      </label>
                      <button
                        onClick={() => handleAddArrayItem(field.key)}
                        className="flex items-center gap-2 text-[13px] font-bold text-primary-600 hover:text-primary-700 hover:bg-primary-50 px-4 py-2 rounded-xl border border-primary-100 transition-colors shadow-sm active:scale-[0.98]"
                      >
                        <Plus className="w-4 h-4" /> Add Item
                      </button>
                    </div>

                    <div className="space-y-3">
                      {(editedData[field.key] || []).map(
                        (item: string, idx: number) => (
                          <div
                            key={idx}
                            className="flex gap-3 group items-center"
                          >
                            <input
                              type="text"
                              value={item}
                              onChange={(e) =>
                                handleArrayChange(
                                  field.key,
                                  idx,
                                  e.target.value,
                                )
                              }
                              className="flex-1 bg-white border border-surface-200 rounded-xl p-4 text-[15px] font-medium text-surface-900 focus:ring-2 focus:ring-primary-500 outline-none shadow-sm transition-shadow focus:shadow-md"
                              placeholder={`Enter ${field.label.toLowerCase()}...`}
                            />
                            <button
                              onClick={() =>
                                handleRemoveArrayItem(field.key, idx)
                              }
                              className="p-4 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-xl transition-all border border-transparent hover:border-red-200 shadow-sm opacity-60 group-hover:opacity-100 flex-shrink-0"
                              title="Delete Item"
                            >
                              <Trash className="w-5 h-5" />
                            </button>
                          </div>
                        ),
                      )}

                      {(!editedData[field.key] ||
                        editedData[field.key].length === 0) && (
                        <div className="text-center p-8 border-2 border-dashed border-surface-200 rounded-xl bg-surface-50/50">
                          <p className="text-[14px] text-surface-500 font-medium">
                            No {field.label.toLowerCase()} added yet.
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="prose prose-neutral max-w-none prose-headings:font-bold prose-headings:text-surface-900 prose-p:text-surface-800 prose-li:text-surface-800 prose-strong:text-primary-700">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {displayJDContent}
            </ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}
