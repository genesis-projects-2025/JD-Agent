// app/(dashboard)/jd/[id]/page.tsx
"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { downloadJDPdfClient } from "@/lib/download-jd-pdf";
import {
  FileText,
  ArrowLeft,
  Loader2,
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
  Download,
  ChevronDown,
  FileDown,
} from "lucide-react";
import {
  fetchJD,
  getCurrentUser,
  approveJD,
  sendToHR,
  submitJD,
  saveJD,
  createReviewComment,
  fetchReviewComments,
  downloadJDDocx,
} from "@/lib/api";

import FeedbackModal from "@/components/feedback/FeedbackModal";
import { ReviewRejectModal } from "@/components/ui/review-reject-modal";

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
  const [showFeedbackPrompt, setShowFeedbackPrompt] = useState(false);
  const [showDownloadDropdown, setShowDownloadDropdown] = useState(false);
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectingAs, setRejectingAs] = useState<"manager" | "hr">("manager");
  const [reviewComments, setReviewComments] = useState<any[]>([]);

  // Edit mode
  const [isEditing, setIsEditing] = useState(false);
  const [editedJdText, setEditedJdText] = useState("");
  const [editedData, setEditedData] = useState<any>({});
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [activeTab, setActiveTab] = useState<"structured">("structured");
  const [isMounted, setIsMounted] = useState(false);


  useEffect(() => {
    setIsMounted(true);
  }, []);

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

        const [data, comments] = await Promise.all([
          fetchJD(jdId),
          fetchReviewComments(jdId).catch(() => []),
        ]);
        setJd(data);
        setReviewComments(comments);

        // Initialize edit states
        let pText = data.generated_jd || "";
        try {
          const p = JSON.parse(pText);
          if (p.jd_text_format) pText = p.jd_text_format;
        } catch (e) { }
        setEditedJdText(pText);

        let pStruct = safeParseObject(data.jd_structured);

        // Fallback: If structured data is completely empty, try pulling it from the generated_jd block
        if (
          !pStruct ||
          Object.keys(pStruct).length === 0 ||
          (!pStruct.responsibilities && !pStruct.key_responsibilities)
        ) {
          try {
            const p = safeParseObject(data.generated_jd);
            if (p.jd_structured_data) {
              pStruct = p.jd_structured_data;
            } else if (p.role_summary || p.key_responsibilities || p.responsibilities) {
              pStruct = p;
            }
          } catch (e) { }
        }

        // --- Pulse Pharma Schema Alignment (Inflight Migration) ---
        if (pStruct && typeof pStruct === "object") {
          // Map legacy/LLM keys to new keys if they exist and new keys are empty
          if (pStruct.key_responsibilities && !pStruct.responsibilities) {
            pStruct.responsibilities = pStruct.key_responsibilities;
          }
          if (pStruct.required_skills && !pStruct.skills) {
            pStruct.skills = pStruct.required_skills;
          }
          if (pStruct.tools_and_technologies && !pStruct.tools) {
            pStruct.tools = pStruct.tools_and_technologies;
          }
          if (pStruct.role_summary && !pStruct.purpose) {
            pStruct.purpose = pStruct.role_summary;
          }
          if (pStruct.performance_metrics && !pStruct.metrics) {
            pStruct.metrics = pStruct.performance_metrics;
          }
          if (pStruct.stakeholder_interactions && !pStruct.stakeholders) {
            pStruct.stakeholders = pStruct.stakeholder_interactions;
          }
          if (pStruct.additional_details && !pStruct.additional) {
            pStruct.additional = pStruct.additional_details;
          }
        }

        // Final Failsafe for missing keys
        if (!pStruct || typeof pStruct !== "object") pStruct = {};
        pStruct.responsibilities = pStruct.responsibilities || [];
        pStruct.skills = pStruct.skills || [];
        pStruct.tools = pStruct.tools || [];
        pStruct.purpose = pStruct.purpose || "";
        pStruct.education = pStruct.education || "";
        pStruct.experience = pStruct.experience || "";
        pStruct.metrics = pStruct.metrics || [];
        pStruct.stakeholders = pStruct.stakeholders || {};
        pStruct.additional = pStruct.additional || {};
        pStruct.team_structure = pStruct.team_structure || {};
        pStruct.work_environment = pStruct.work_environment || {};

        console.log("JD Edit Loader -> Final extracted pStruct:", pStruct);
        setEditedData(pStruct);

        if (
          data.insights &&
          Object.keys(data.insights).length > 0 &&
          data.insights.identity_context
        ) {
          setHasInsights(true);
        }

        // --- Multi-Step Feedback sync: Mark relevant unread comments as read ---
        if (comments && comments.length > 0) {
          const { markFeedbackRead } = await import("@/lib/api");
          const unreadComments = comments.filter(
            (c: any) => !c.is_read && c.target_role === u?.role,
          );

          if (unreadComments.length > 0) {
            console.log("Found unread feedback for user. Marking as read...");
            await Promise.all(
              unreadComments.map((c: any) => markFeedbackRead(c.id)),
            );
          }
        }
      } catch (error) {
        console.error("Error loading JD:", error);
      } finally {
        setLoading(false);
      }
    };
    if (isMounted) {
      init();
    }
  }, [jdId, isMounted]);

  if (!isMounted) { // Hydration fix: Only render the main UI once mounted
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
      </div>
    );
  }

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
          onClick={() => {
            const u = getCurrentUser();
            if (u?.employee_id) {
              router.push(`/dashboard/${u.employee_id}`);
            } else {
              router.push("/");
            }
          }}
          className="px-6 py-3 bg-surface-100 text-surface-700 rounded-xl font-bold hover:bg-surface-200 transition-colors"
        >
          Go Back
        </button>
      </div>
    );
  }

  const handleRejectWithModal = async (
    targetRole: "employee" | "manager",
    comment: string,
  ) => {
    const user = getCurrentUser();
    if (!user) return;
    setSendingToManager(true);
    try {
      await createReviewComment(jd.id, {
        action: "rejected",
        target_role: targetRole,
        comment,
        reviewer_id: user.employee_id,
      });
      const [updated, comments] = await Promise.all([
        fetchJD(jd.id),
        fetchReviewComments(jd.id).catch(() => []),
      ]);
      setJd(updated);
      setReviewComments(comments);
    } catch (e: any) {
      alert(e.message || "Failed to reject JD.");
    } finally {
      setSendingToManager(false);
    }
  };

  const handleManagerReject = () => {
    setRejectingAs("manager");
    setShowRejectModal(true);
  };

  const handleManagerSendToHR = async () => {
    setSendingToManager(true);
    setIsApproving(true);
    try {
      await sendToHR(jd.id, jd.employee_id);
      const updated = await fetchJD(jd.id);
      setJd(updated);
      setShowFeedbackPrompt(true);
    } catch (e: any) {
      alert(e.message || "Failed to send to HR.");
    } finally {
      setSendingToManager(false);
      setIsApproving(false);
    }
  };

  const handleHRReject = () => {
    setRejectingAs("hr");
    setShowRejectModal(true);
  };

  const handleHRApprove = async () => {
    setSendingToManager(true);
    setIsApproving(true);
    try {
      await approveJD(jd.id, jd.employee_id);
      const updated = await fetchJD(jd.id);
      setJd(updated);
      setShowFeedbackPrompt(true);
    } catch (e: any) {
      alert(e.message || "Failed to approve JD.");
    } finally {
      setSendingToManager(false);
      setIsApproving(false);
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

      // We no longer manually build MD in the frontend.
      // The backend now has a standardized logic to regenerate jd_text
      // from jd_structured, ensuring the view and edit modes are always in sync.
      await saveJD({
        id: jd.id,
        jd_text: "", // Let backend regenerate
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
      const u = getCurrentUser();
      if (!u) throw new Error("Not logged in");

      // Dynamic Routing Logic:
      // If the employee has NO manager, or their manager is "C0014" (HR),
      // route directly to HR instead of manager.
      let targetStatus = "sent_to_manager";
      if (!u.reporting_manager_code || u.reporting_manager_code === "C0014") {
        targetStatus = "sent_to_hr";
      }

      await submitJD(jd.id, jd.employee_id, targetStatus);
      const updated = await fetchJD(jd.id);
      setJd(updated);
      setShowFeedbackPrompt(true);
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
      } catch (e) { }

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
  } catch (e) { }

  return (
    <div className="min-h-screen bg-surface-50 pt-16 pb-24 px-4 md:pt-6 md:px-6">
      <div className="max-w-7xl mx-auto space-y-4 md:space-y-6 animate-in fade-in duration-500">
        <button
          onClick={() => {
            const u = getCurrentUser();
            if (!u?.employee_id) {
              router.push("/");
              return;
            }

            let url = `/dashboard/${u.employee_id}`;
            if (jd) {
              if (u.role === "manager" && jd.status === "sent_to_manager") {
                url += "?view=pending";
              } else if (u.role === "hr" && jd.status === "sent_to_hr") {
                url += "?view=approvals";
              } else if (jd.status.includes("rejected")) {
                url += "?view=feedback";
              }
            }
            router.push(url);
          }}
          className="flex items-center gap-2 text-surface-400 hover:text-primary-600 transition-colors text-[11px] font-black uppercase tracking-widest group px-2"
        >
          <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
          Back to Dashboard
        </button>

        {/* Header card */}
        <div className="bg-white rounded-2xl md:rounded-[32px] p-5 sm:p-6 md:p-10 border border-surface-200 shadow-premium relative overflow-hidden">
          <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-gradient-to-br from-primary-50 via-white to-transparent opacity-50 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3 pointer-events-none overflow-hidden"></div>
          <div className="relative z-10 flex flex-col lg:flex-row lg:items-start justify-between gap-6 md:gap-8">
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
              <h1 className="text-xl sm:text-2xl md:text-3xl lg:text-4xl font-black text-surface-900 tracking-tight mb-3">
                {jd.title || "Strategic Role Architecture"}
              </h1>
              {jd.department && (
                <p className="text-[10px] sm:text-sm font-bold text-surface-500 uppercase tracking-widest">
                  {jd.department}
                </p>
              )}

              {/* Download Button — visible to all roles when JD exists */}
              {jd.jd_structured && (
                <div
                  className="relative mt-4 inline-block"
                  onMouseEnter={() => setShowDownloadDropdown(true)}
                  onMouseLeave={() => setShowDownloadDropdown(false)}
                >
                  <button
                    onClick={() => setShowDownloadDropdown(!showDownloadDropdown)}
                    className="inline-flex items-center gap-2 px-5 py-3 bg-gradient-to-r from-primary-600 to-primary-700 text-white rounded-xl font-bold text-[13px] shadow-md hover:shadow-lg hover:-translate-y-0.5 transition-all disabled:opacity-50 disabled:cursor-not-allowed group"
                  >
                    <Download className="w-4 h-4 group-hover:scale-110 transition-transform" />
                    Download JD
                    <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${showDownloadDropdown ? 'rotate-180' : ''}`} />
                  </button>

                  {showDownloadDropdown && (
                    <div
                      className="absolute left-0 mt-1 w-56 bg-white border border-surface-200 rounded-2xl shadow-2xl z-[100] overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200"
                    >
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowDownloadDropdown(false);
                          // Use the client-side branded template instead of server PDF
                          downloadJDPdfClient(
                            jd.jd_structured,
                            jd.title || undefined,
                            jd.department || undefined
                          );
                        }}
                        className="w-full flex items-center gap-3 px-4 py-3.5 text-[13px] font-bold text-surface-700 hover:bg-primary-50 hover:text-primary-700 transition-colors group/item"
                      >
                        <div className="w-8 h-8 rounded-lg bg-red-50 flex items-center justify-center group-hover/item:bg-red-100 transition-colors">
                          <FileDown className="w-4 h-4 text-red-600" />
                        </div>
                        <div className="flex flex-col items-start px-1">
                          <span>Professional PDF</span>
                          <span className="text-[10px] text-surface-400 font-medium">Branded Pulse Pharma template</span>
                        </div>
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowDownloadDropdown(false);
                          downloadJDDocx(jdId);
                        }}
                        className="w-full flex items-center gap-3 px-4 py-3.5 text-[13px] font-bold text-surface-700 hover:bg-primary-50 hover:text-primary-700 transition-colors group/item"
                      >
                        <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center group-hover/item:bg-blue-100 transition-colors">
                          <FileText className="w-4 h-4 text-blue-600" />
                        </div>
                        <div className="flex flex-col items-start px-1">
                          <span>Word Document</span>
                          <span className="text-[10px] text-surface-400 font-medium">Editable .docx file</span>
                        </div>
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {(role === "manager" || role === "hr") && (
              <div className="flex flex-col gap-3 min-w-[240px] w-full lg:w-auto mt-2 lg:mt-0 order-last lg:order-none">
                {role === "manager" && jd.status === "sent_to_manager" && (
                  <div className="flex flex-col sm:flex-row flex-wrap gap-3 w-full">
                    <button
                      onClick={handleManagerSendToHR}
                      disabled={sendingToManager || isEditing || isApproving}
                      className="flex-1 px-5 py-3.5 bg-emerald-600 text-white rounded-xl font-bold flex flex-center items-center justify-center gap-2 shadow-sm hover:shadow-md hover:-translate-y-0.5 hover:bg-emerald-700 text-[14px] transition-all disabled:opacity-50 whitespace-nowrap"
                    >
                      {isApproving ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <CheckCircle2 className="w-4 h-4" />
                      )}
                      {isApproving ? "Forwarding..." : "Approve"}
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
                      className="flex-1 px-5 py-3.5 bg-red-50 text-red-600 border border-red-100 rounded-xl font-bold flex flex-center items-center justify-center gap-2 shadow-sm hover:bg-red-100 text-[14px] transition-all disabled:opacity-50 whitespace-nowrap"
                    >
                      <XCircle className="w-4 h-4" /> Reject
                    </button>
                  </div>
                )}

                {/* Manager Owner Actions (for their own drafts) */}
                {role === "manager" &&
                  ["draft", "jd_generated", "hr_rejected"].includes(
                    jd.status,
                  ) && (
                    <div className="flex flex-col sm:flex-row flex-wrap gap-3 w-full">
                      <button
                        onClick={() => router.push(`/questionnaire/${jdId}`)}
                        className="flex-1 px-5 py-3.5 bg-white text-surface-700 border border-surface-200 rounded-xl font-bold hover:bg-surface-50 transition-all shadow-sm flex items-center justify-center gap-2 text-[14px]"
                      >
                        <Edit3 className="w-4 h-4" /> Refine in Chat
                      </button>
                      <button
                        onClick={handleEditToggle}
                        disabled={isSavingEdit || sendingToManager}
                        className="flex-1 px-5 py-3.5 bg-white text-primary-700 border border-primary-200 rounded-xl font-bold hover:bg-primary-50 transition-all shadow-sm flex items-center justify-center gap-2 text-[14px] disabled:opacity-50"
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
                        onClick={handleManagerSendToHR}
                        disabled={sendingToManager || isEditing || isApproving}
                        className="flex-1 px-5 py-3.5 bg-primary-600 text-white rounded-xl font-bold flex flex-center items-center justify-center gap-2 shadow-sm hover:bg-primary-700 text-[14px] transition-all disabled:opacity-50 whitespace-nowrap"
                      >
                        {isApproving ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Send className="w-4 h-4" />
                        )}
                        {isApproving ? "Sending..." : "Send to HR"}
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
                  <div className="flex flex-col sm:flex-row flex-wrap gap-3 w-full">
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
                      className="flex-1 px-5 py-3.5 bg-red-50 text-red-600 border border-red-100 rounded-xl font-bold flex flex-center items-center justify-center gap-2 shadow-sm hover:bg-red-100 text-[14px] transition-all disabled:opacity-50 whitespace-nowrap"
                    >
                      <XCircle className="w-4 h-4" /> Reject
                    </button>
                  </div>
                )}

                {/* HR Owner Actions (for their own drafts) */}
                {role === "hr" &&
                  ["draft", "jd_generated"].includes(jd.status) && (
                    <div className="flex flex-col sm:flex-row gap-3 w-full">
                      <button
                        onClick={() => router.push(`/questionnaire/${jdId}`)}
                        className="px-5 py-3.5 bg-white text-surface-700 border border-surface-200 rounded-xl font-bold hover:bg-surface-50 transition-all shadow-sm flex items-center justify-center gap-2 text-[14px]"
                      >
                        <Edit3 className="w-4 h-4" /> Refine in Chat
                      </button>
                      <button
                        onClick={handleEditToggle}
                        disabled={isSavingEdit || sendingToManager}
                        className="px-5 py-3.5 bg-white text-primary-700 border border-primary-200 rounded-xl font-bold hover:bg-primary-50 transition-all shadow-sm flex items-center justify-center gap-2 text-[14px] disabled:opacity-50"
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
                        onClick={handleHRApprove}
                        disabled={sendingToManager || isEditing || isApproving}
                        className="flex-1 px-5 py-3.5 bg-purple-600 text-white rounded-xl font-bold flex flex-center items-center justify-center gap-2 shadow-sm hover:bg-purple-700 text-[14px] transition-all disabled:opacity-50 whitespace-nowrap"
                      >
                        {isApproving ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <ShieldCheck className="w-4 h-4" />
                        )}
                        {isApproving ? "Processing..." : "Approve & Sign Off"}
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
              <div className="flex flex-col sm:flex-row gap-3 mt-4 md:mt-0 order-last md:order-none">
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

        {/* Feedback Banner (if rejected and targeted at current role) */}
        {reviewComments.length > 0 &&
          jd.status.includes("rejected") &&
          reviewComments[0].action === "rejected" &&
          reviewComments[0].target_role === role && (
            <div className="bg-red-50 border-2 border-red-200 rounded-[32px] p-6 mb-8 animate-in slide-in-from-top-4 duration-500 shadow-lg shadow-red-900/5">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 bg-red-100 rounded-2xl flex items-center justify-center flex-shrink-0 animate-pulse">
                  <AlertTriangle className="w-6 h-6 text-red-600" />
                </div>
                <div className="flex-1">
                  <h3 className="text-lg font-bold text-red-900 mb-1">
                    Revision Requested
                  </h3>
                  <p className="text-red-700 text-sm leading-relaxed mb-4">
                    {reviewComments[0].reviewer_name} requested changes to this
                    document:
                  </p>
                  <div className="bg-white/60 backdrop-blur-sm rounded-xl p-4 border border-red-200/50">
                    <p className="text-red-800 text-[15px] font-medium leading-relaxed italic">
                      "{reviewComments[0].comment}"
                    </p>
                  </div>
                  <div className="mt-4 flex items-center gap-2">
                    <span className="text-[10px] font-black uppercase tracking-widest text-red-400 bg-red-100/50 px-2 py-1 rounded-md">
                      Action Required: Update and resubmit
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

        {/* Review Audit Trail - Hidden if banner is shown to avoid redundancy, or shown compact */}
        {reviewComments.length > 1 && (
          <div className="space-y-3 mb-8">
            <h3 className="text-[11px] font-black text-surface-500 uppercase tracking-widest px-1">
              Previous Review Activity
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {reviewComments.slice(1).map((rc: any) => (
                <div
                  key={rc.id}
                  className={`rounded-2xl p-4 border ${rc.action === "rejected"
                    ? "bg-red-50/30 border-red-100"
                    : "bg-emerald-50/30 border-emerald-100"
                    }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-bold text-surface-500">
                      {rc.reviewer_role} Review
                    </span>
                    <span className="text-[10px] text-surface-400">
                      {new Date(rc.created_at).toLocaleDateString()}
                    </span>
                  </div>
                  <p className="text-xs font-medium text-surface-700 line-clamp-2">
                    {rc.comment}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Document block */}
        <div className="bg-white rounded-2xl md:rounded-[32px] p-5 md:p-10 border border-surface-200 shadow-premium relative min-h-[500px] flex flex-col transition-all duration-500">
          {isEditing ? (
            <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
              <div className="w-full bg-surface-50 border border-surface-200 rounded-2xl p-5 sm:p-8 space-y-8 sm:space-y-12 shadow-inner min-h-full">
                {/* Job Title */}
                <div className="space-y-4">
                  <label className="text-[11px] font-black text-surface-500 uppercase tracking-widest px-1">
                    Job Title
                  </label>
                  <input
                    type="text"
                    value={
                      editedData.job_title ||
                      editedData.role_title ||
                      editedData.title ||
                      ""
                    }
                    onChange={(e) =>
                      handleTextChange("job_title", e.target.value)
                    }
                    className="w-full bg-white border border-surface-200 rounded-2xl p-4 sm:p-6 text-[15px] sm:text-[16px] font-bold text-surface-900 leading-relaxed focus:ring-4 focus:ring-primary-500/10 focus:border-primary-500 outline-none shadow-sm transition-all"
                    placeholder="e.g. Strategic Role Architect"
                  />
                </div>

                {/* Purpose of the Job */}
                <div className="space-y-4">
                  <label className="text-[11px] font-black text-surface-500 uppercase tracking-widest px-1">
                    Purpose of the Job
                  </label>
                  <textarea
                    value={editedData.purpose || ""}
                    onChange={(e) =>
                      handleTextChange("purpose", e.target.value)
                    }
                    className="w-full bg-white border border-surface-200 rounded-2xl p-4 sm:p-6 text-[14px] sm:text-[15px] font-medium text-surface-800 leading-relaxed focus:ring-4 focus:ring-primary-500/10 focus:border-primary-500 outline-none resize-none min-h-[160px] shadow-sm transition-all"
                    placeholder="Brief overview of the role's purpose..."
                  />
                </div>

                {/* Array fields */}
                {[
                  {
                    key: "responsibilities",
                    label: "Job Responsibilities",
                  },
                  { key: "skills", label: "Skills / Competencies" },
                  {
                    key: "tools",
                    label: "Tools & Technologies",
                  },
                ].map((field) => (
                  <div key={field.key} className="space-y-5">
                    <div className="flex items-center justify-between px-1">
                      <label className="text-[11px] font-black text-surface-500 uppercase tracking-widest">
                        {field.label}
                      </label>
                      <button
                        onClick={() => handleAddArrayItem(field.key)}
                        className="flex items-center gap-2 text-[11px] font-black uppercase tracking-widest text-primary-600 hover:text-primary-700 bg-primary-50 hover:bg-primary-100 px-4 py-2 rounded-xl transition-all active:scale-95"
                      >
                        <Plus className="w-3.5 h-3.5" /> Add Item
                      </button>
                    </div>

                    <div className="space-y-3">
                      {(editedData[field.key] || []).map(
                        (item: string, idx: number) => (
                          <div
                            key={idx}
                            className="flex items-start gap-3 group animate-in fade-in slide-in-from-left-2 duration-300"
                          >
                            <textarea
                              value={item}
                              onChange={(e) =>
                                handleArrayChange(
                                  field.key,
                                  idx,
                                  e.target.value,
                                )
                              }
                              className="flex-1 bg-white border border-surface-200 rounded-2xl p-4 text-[14px] font-medium text-surface-800 leading-relaxed focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 outline-none resize-none min-h-[80px] shadow-sm transition-all"
                            />
                            <button
                              onClick={() =>
                                handleRemoveArrayItem(field.key, idx)
                              }
                              className="mt-2 w-10 h-10 bg-surface-100 text-surface-400 rounded-xl flex items-center justify-center hover:bg-red-50 hover:text-red-500 transition-all opacity-0 group-hover:opacity-100 focus:opacity-100"
                            >
                              <Trash className="w-4 h-4" />
                            </button>
                          </div>
                        ),
                      )}
                    </div>
                  </div>
                ))}

                {/* Education and Experience */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="space-y-4">
                    <label className="text-[11px] font-black text-surface-500 uppercase tracking-widest px-1">
                      Education Requested
                    </label>
                    <textarea
                      value={editedData.education || ""}
                      onChange={(e) =>
                        handleTextChange("education", e.target.value)
                      }
                      className="w-full bg-white border border-surface-200 rounded-2xl p-4 sm:p-6 text-[14px] font-medium text-surface-800 leading-relaxed focus:ring-4 focus:ring-primary-500/10 focus:border-primary-500 outline-none resize-none min-h-[100px] shadow-sm transition-all"
                    />
                  </div>
                  <div className="space-y-4">
                    <label className="text-[11px] font-black text-surface-500 uppercase tracking-widest px-1">
                      Experience Requested
                    </label>
                    <textarea
                      value={editedData.experience || ""}
                      onChange={(e) =>
                        handleTextChange("experience", e.target.value)
                      }
                      className="w-full bg-white border border-surface-200 rounded-2xl p-4 sm:p-6 text-[14px] font-medium text-surface-800 leading-relaxed focus:ring-4 focus:ring-primary-500/10 focus:border-primary-500 outline-none resize-none min-h-[100px] shadow-sm transition-all"
                    />
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 animate-in fade-in zoom-in-[0.98] duration-500 h-full">
              <div className="bg-white rounded-2xl md:rounded-[32px] p-6 sm:p-8 md:p-12 border border-surface-200/60 shadow-[0_8px_30px_rgb(0,0,0,0.04)] ring-1 ring-black/[0.02]">
                <div className="border-b border-surface-200/60 pb-6 sm:pb-8 mb-6 sm:mb-10">
                  <div className="flex items-center gap-3 mb-4 sm:mb-6">
                    <div className="h-10 w-10 bg-primary-50 rounded-xl flex items-center justify-center border border-primary-100">
                      <FileText className="w-5 h-5 text-primary-600" />
                    </div>
                    <div>
                      <h4 className="text-[11px] font-black text-primary-600 uppercase tracking-widest">
                        Official Document
                      </h4>
                      <p className="text-sm font-medium text-surface-500">
                        {jd.department || "Organization"} • Ref: JD-
                        {jd.id.split("-")[0].toUpperCase()}
                      </p>
                    </div>
                  </div>
                  <h1 className="text-4xl md:text-5xl font-black text-surface-900 tracking-tight leading-[1.1]">
                    {jd.title || "Job Description"}
                  </h1>
                </div>

                <JDDocumentView data={editedData} />
              </div>
            </div>
          )}
        </div>

        <FeedbackModal
          isOpen={showFeedbackPrompt}
          onClose={() => setShowFeedbackPrompt(false)}
          jdSessionId={jdId}
          defaultCategory="JD Process"
        />

        <ReviewRejectModal
          isOpen={showRejectModal}
          onClose={() => setShowRejectModal(false)}
          onSubmit={handleRejectWithModal}
          reviewerRole={rejectingAs}
          jdTitle={jd?.title || ""}
        />
      </div>
    </div>
  );
}
// ── Structured Document View ──────────────────────────────────────────────────

function JDDocumentView({ data }: { data: any }) {
  const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div className="py-6 sm:py-8 border-b border-surface-100 last:border-0">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-8">
        <div className="lg:col-span-1">
          <h3 className="text-[10px] sm:text-[11px] font-black text-surface-400 uppercase tracking-[0.2em] lg:sticky lg:top-8 mb-2 lg:mb-0">
            {title}
          </h3>
        </div>
        <div className="lg:col-span-2 space-y-4">
          {children}
        </div>
      </div>
    </div>
  );

  const ListItem = ({ children }: { children: React.ReactNode }) => (
    <div className="flex gap-3 group">
      <div className="w-1.5 h-1.5 rounded-full bg-primary-400 mt-2.5 flex-shrink-0 group-hover:scale-125 transition-transform" />
      <p className="text-[15px] leading-relaxed text-surface-700 font-medium">
        {children}
      </p>
    </div>
  );

  return (
    <div className="space-y-2">
      {/* Purpose */}
      <Section title="Role Summary">
        <p className="text-[17px] leading-relaxed text-surface-800 font-medium whitespace-pre-wrap">
          {data.purpose || "Strategic role overview to be confirmed."}
        </p>
      </Section>

      {/* Responsibilities */}
      {data.responsibilities && data.responsibilities.length > 0 && (
        <Section title="Key Responsibilities">
          <div className="space-y-4">
            {data.responsibilities.map((r: string, i: number) => (
              <ListItem key={i}>{r}</ListItem>
            ))}
          </div>
        </Section>
      )}

      {/* Skills */}
      {(data.skills?.length > 0 || data.tools?.length > 0) && (
        <Section title="Expertise & Tools">
          <div className="flex flex-wrap gap-2">
            {[...(data.skills || []), ...(data.tools || [])].map((s: string, i: number) => (
              <span key={i} className="px-3 py-1 bg-surface-50 text-surface-700 border border-surface-200 rounded-lg text-xs font-bold shadow-sm">
                {s}
              </span>
            ))}
          </div>
        </Section>
      )}

      {/* Team & Environment */}
      <Section title="Environment & Team">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
          {data.team_structure && (
            <div className="space-y-4">
              <h4 className="text-[10px] font-bold text-surface-400 uppercase tracking-wider">Team Structure</h4>
              <div className="space-y-2">
                {data.team_structure.team_size && (
                  <p className="text-sm text-surface-700 font-medium">Team Size: <span className="text-surface-900 font-bold">{data.team_structure.team_size}</span></p>
                )}
                {data.team_structure.collaborates_with && (
                  <p className="text-sm text-surface-700 font-medium">Collaborates with: <span className="text-surface-900 font-bold">{Array.isArray(data.team_structure.collaborates_with) ? data.team_structure.collaborates_with.join(", ") : data.team_structure.collaborates_with}</span></p>
                )}
              </div>
            </div>
          )}
          {data.work_environment && (
            <div className="space-y-4">
              <h4 className="text-[10px] font-bold text-surface-400 uppercase tracking-wider">Culture & Style</h4>
              <div className="space-y-2">
                <p className="text-sm text-surface-700 font-medium leading-relaxed italic border-l-2 border-primary-200 pl-4 py-1 bg-primary-50/30 rounded-r-lg">
                  {data.work_environment.culture || "Highly collaborative environment Focused on results."}
                </p>
              </div>
            </div>
          )}
        </div>
      </Section>

      {/* Metrics */}
      {data.metrics && data.metrics.length > 0 && (
        <Section title="Performance Metrics">
          <div className="grid grid-cols-1 gap-4">
            {data.metrics.map((m: string, i: number) => (
              <div key={i} className="p-4 bg-emerald-50/50 border border-emerald-100 rounded-2xl flex items-center gap-4">
                <div className="w-8 h-8 bg-emerald-100 rounded-xl flex items-center justify-center text-emerald-600 font-black text-xs">
                  {i + 1}
                </div>
                <p className="text-sm font-bold text-emerald-900 leading-tight">
                  {m}
                </p>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Additional Details */}
      {data.additional && (data.additional.special_projects?.length > 0 || data.additional.unique_contributions) && (
        <Section title="Special Projects">
          {data.additional.special_projects?.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-4">
              {data.additional.special_projects.map((p: string, i: number) => (
                <span key={i} className="px-3 py-1 bg-amber-50 text-amber-700 border border-amber-200 rounded-lg text-xs font-black shadow-sm uppercase tracking-tighter">
                  {p}
                </span>
              ))}
            </div>
          )}
          {data.additional.unique_contributions && (
            <p className="text-sm text-surface-600 font-medium leading-relaxed italic">
              Contribution Insights: {data.additional.unique_contributions}
            </p>
          )}
        </Section>
      )}
    </div>
  );
}
