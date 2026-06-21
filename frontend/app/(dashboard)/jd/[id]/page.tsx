// app/(dashboard)/jd/[id]/page.tsx
"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, Suspense } from "react";
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
 Target,
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
 fetchKRAKPIStatus,
} from "@/lib/api";

import FeedbackModal from "@/components/feedback/FeedbackModal";
import { ReviewRejectModal } from "@/components/ui/review-reject-modal";
import { PdfDocumentView } from "@/components/jd/pdf-document-view";
import { KRAKPIPanel } from "@/components/jd/kra-kpi-panel";
import { KRAKPIPrereqModal } from "@/components/ui/kra-kpi-prereq-modal";

function JDPageContent() {
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
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const [activeTab, setActiveTab] = useState<"structured" | "kra-kpi">(
      tabParam === "kra-kpi" ? "kra-kpi" : "structured"
  );
 const [currentUser, setCurrentUser] = useState<any>(null);
 const [isMounted, setIsMounted] = useState(false);
 const [prereqStatus, setPrereqStatus] = useState<any>(null);
 const [isPrereqModalOpen, setIsPrereqModalOpen] = useState(false);
 const [prereqMissing, setPrereqMissing] = useState<string[]>([]);


 useEffect(() => {
 setIsMounted(true);
 }, []);

 useEffect(() => {
   if (tabParam === "kra-kpi") {
     if (jd && !jd.generated_jd) {
       setPrereqMissing(["employee_jd"]);
       setIsPrereqModalOpen(true);
       setActiveTab("structured");
       router.replace(`/jd/${jdId}`);
       return;
     }
      if (prereqStatus && !prereqStatus.ready && prereqStatus.current_step !== "confirmed") {
        setPrereqMissing(prereqStatus.missing || []);
        setIsPrereqModalOpen(true);
        setActiveTab("structured");
        router.replace(`/jd/${jdId}`);
        return;
      }
     setActiveTab("kra-kpi");
   } else {
     setActiveTab("structured");
   }
 }, [tabParam, jd, prereqStatus, router, jdId]);

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

 const rolesMatch = (target: string, current: string) => {
   if (target === current) return true;
   if (target === "manager" && current === "head") return true;
   if (target === "hr" && current === "admin") return true;
   return false;
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
  if (u) { setRole(u.role); setCurrentUser(u); }

  const [data, comments] = await Promise.all([
  fetchJD(jdId),
  fetchReviewComments(jdId).catch(() => []),
  ]);
  setJd(data);
  setReviewComments(comments);

  if (data.generated_jd && u) {
    fetchKRAKPIStatus(jdId, u.employee_id)
      .then(setPrereqStatus)
      .catch(() => setPrereqStatus(null));
  }

 // Initialize edit states
 let pText = data.generated_jd || "";
 try {
 const p = JSON.parse(pText);
 if (p.jd_text_format) pText = p.jd_text_format;
 } catch (e) { }
 setEditedJdText(pText);

 // NOTE: Do NOT re-read raw data here - migrations above are intentional.
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
 if (pStruct.technical_skills && !pStruct.skills) {
 pStruct.skills = pStruct.technical_skills;
 }
 if (pStruct.required_skills && !pStruct.skills) {
 pStruct.skills = pStruct.required_skills;
 }
 if (pStruct.tools_used && !pStruct.tools) {
 pStruct.tools = pStruct.tools_used;
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
 if (pStruct.additional_details && !pStruct.additional) {
 pStruct.additional = pStruct.additional_details;
 }
 // talent_bar -> top-level education/experience (LLM schema fix)
 if (pStruct.talent_bar && typeof pStruct.talent_bar === "object") {
 pStruct.education = pStruct.education || pStruct.talent_bar.education || "";
 pStruct.experience = pStruct.experience || pStruct.talent_bar.experience || "";
 }
 // qualifications nested -> top-level
 if (pStruct.qualifications && typeof pStruct.qualifications === "object") {
 pStruct.education = pStruct.education || pStruct.qualifications.education || "";
 pStruct.experience = pStruct.experience || pStruct.qualifications.experience || "";
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

 // NOTE: Do NOT re-read raw data here - migrations above are intentional.
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
 (c: any) => !c.is_read && rolesMatch(c.target_role, u?.role || ""),
 );

 if (unreadComments.length > 0) {

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
 <div className="p-8 text-center bg-white rounded-md border border-surface-200 shadow-sm max-w-md mx-auto mt-20">
 <AlertTriangle className="w-12 h-12 text-surface-400 mx-auto mb-4" />
 <h2 className="text-xl font-medium text-surface-900 mb-2">
 JD Not Found
 </h2>
 <p className="text-surface-500 mb-6">
 This Job Description may have been moved or deleted.
 </p>
 <button
 onClick={() => {
 const u = getCurrentUser();
 if (u?.employee_id) {
 const encodedId = btoa(u.employee_id);
 router.push(`/dashboard/${encodedId}`);
 } else {
 router.push("/");
 }
 }}
 className="px-6 py-3 bg-surface-100 text-surface-700 rounded-md font-medium hover:bg-surface-200 transition-colors"
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
 
 const encodedId = btoa(user.employee_id);
 router.push(`/dashboard/${encodedId}`);
 router.refresh();
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
  const isHeadReviewingSentToHR = role === "head" && (jd?.status === "sent_to_hr" || jd?.kra_kpi_status === "sent_to_hr");
  if (isHeadReviewingSentToHR) {
  await approveJD(jd.id, jd.employee_id);
  } else {
  await sendToHR(jd.id, jd.employee_id);
  }
  const updated = await fetchJD(jd.id);
  setJd(updated);
  setShowFeedbackPrompt(true);
  } catch (e: any) {
  alert(e.message || "Failed to process approval.");
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
    // If the employee has NO manager, or their manager is "E6679" (HR),
    // route directly to HR instead of manager.
    let targetStatus = "sent_to_manager";
    if (!u.reporting_manager_code || u.reporting_manager_code === "E6679") {
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
 const pTextRaw = jd.generated_jd || "";
 let pText = pTextRaw;
 try {
 const p = JSON.parse(pTextRaw);
 if (p.jd_text_format) pText = p.jd_text_format;
 } catch (e) { }

 let pStruct = safeParseObject(jd.jd_structured);
 if (
 !pStruct ||
 Object.keys(pStruct).length === 0 ||
 (!pStruct.key_responsibilities && !pStruct.responsibilities)
 ) {
 const p = safeParseObject(jd.generated_jd);
 if (p.jd_structured_data) {
 pStruct = p.jd_structured_data;
 } else if (p.role_summary || p.key_responsibilities || p.responsibilities) {
 pStruct = p;
 }
 }

 // Final Failsafe for missing keys
 if (!pStruct || typeof pStruct !== "object") pStruct = {};
 pStruct.key_responsibilities = pStruct.key_responsibilities || [];
 pStruct.required_skills = pStruct.required_skills || [];
 pStruct.tools_and_technologies = pStruct.tools_and_technologies || [];
 pStruct.performance_metrics = pStruct.performance_metrics || [];

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
 <div className="h-full bg-surface-50 overflow-y-auto custom-scrollbar pt-14 md:pt-6 pb-24 px-4 md:px-6">
 <div className="max-w-7xl mx-auto space-y-4 md:space-y-6 animate-in fade-in duration-500">
 <button
 onClick={() => {
 const u = getCurrentUser();
 if (!u?.employee_id) {
 router.push("/");
 return;
 }

  let targetEmployeeId = u.employee_id;
  const isInspector = u.employee_id !== jd?.employee_id;
  let url = `/dashboard/${btoa(targetEmployeeId)}`;
 if (jd) {
 const isManagerRole = u.role === "manager" || u.role === "head";
 if (isManagerRole && (
    jd.status === "sent_to_manager" ||
    jd.status === "sent_to_hr" ||
    jd.kra_kpi_status === "sent_to_manager" ||
    jd.kra_kpi_status === "sent_to_hr"
  )) {
  url += "?view=pending";
  } else if (isManagerRole && jd.status === "approved" && jd.kra_kpi_status !== "sent_to_manager") {
  if (!isInspector) {
  url += "?view=approved";
  }
  } else if ((u.role === "hr" || u.role === "admin") && (jd.status === "sent_to_hr" || jd.kra_kpi_status === "sent_to_hr")) {
  url += "?view=approvals";
  } else if (jd.status.includes("rejected") || (jd.kra_kpi_status && jd.kra_kpi_status.includes("rejected"))) {
  if (!isInspector) {
  url += "?view=feedback";
  }
  }
  }
 router.push(url);

 }}
 className="flex items-center gap-2 text-surface-400 hover:text-primary-600 transition-colors text-[11px] font-medium group px-2"
 >
 <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
 Back to Dashboard
 </button>

 {/* Header card */}
 <div className="bg-white rounded-md md:rounded-[32px] p-5 sm:p-6 md:p-8 border border-surface-200 shadow-md relative">
 <div className="absolute inset-0 overflow-hidden rounded-md md:rounded-[32px] pointer-events-none">
 <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-gradient-to-br from-primary-50 via-white to-transparent opacity-50 rounded-md blur-3xl -translate-y-1/2 translate-x-1/3 overflow-hidden"></div>
 </div>
 <div className="relative z-20 flex flex-col lg:flex-row lg:items-start justify-between gap-6">
 <div>
 <div className="flex flex-wrap items-center gap-3 mb-6">
 <span className="px-4 py-1.5 bg-surface-100 text-surface-600 rounded-md text-[11px] font-medium flex items-center gap-1.5 border border-surface-200/50 shadow-sm">
 <FileText className="w-4 h-4" />
 Version {jd.version || 1}.0
 </span>
 <span className="px-4 py-1.5 bg-primary-50 text-primary-700 rounded-md text-[11px] font-medium border border-primary-100 shadow-sm capitalize">
 {
 ({
 draft: "Interviewer Active",
 jd_generated: "Created",
 sent_to_manager: "Manager Review",
 manager_rejected: "Manager Rejected",
 sent_to_hr: "HR Review",
 hr_rejected: "HR Rejected",
 approved: "Accepted",
 rejected: "Needs Revision",
 } as Record<string, string>)[jd.status] || jd.status.replace(/_/g, " ")
 }
 </span>

 {jd.jd_structured?._last_edited_by && (
 <span className="px-4 py-1.5 bg-amber-50 text-amber-700 rounded-md text-[11px] font-medium border border-amber-200 shadow-sm flex items-center gap-1">
 <Edit className="w-3.5 h-3.5" />
 Edited by {jd.jd_structured._last_edited_by}
 </span>
 )}
 </div>
 <h1 className="text-xl sm:text-2xl md:text-3xl lg:text-4xl font-medium text-surface-900 mb-3">
 {jd.title || "Strategic Role Architecture"}
 </h1>
 {jd.department && (
 <p className="text-[10px] sm:text-sm font-medium text-surface-500 ">
 {jd.department}
 </p>
 )}

 {/* Download Button — visible to all roles when JD exists */}
 {jd.jd_structured && (
 <div
 className="relative mt-4 inline-block"
 >
 <button
 onClick={() => setShowDownloadDropdown(!showDownloadDropdown)}
 className="inline-flex items-center gap-2 px-5 py-3 bg-gradient-to-r from-primary-600 to-primary-700 text-white rounded-md font-medium text-[13px] shadow-md hover:shadow-md hover:-translate-y-0.5 transition-all disabled:opacity-50 disabled:cursor-not-allowed group"
 >
 <Download className="w-4 h-4 group-hover:scale-110 transition-transform" />
 Download JD
 <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${showDownloadDropdown ? 'rotate-180' : ''}`} />
 </button>

 {showDownloadDropdown && (
 <div
 className="absolute left-0 mt-2 w-56 bg-white border border-surface-200 rounded-md shadow-md z-[100] overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200"
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
 className="w-full flex items-center gap-3 px-4 py-3.5 text-[13px] font-medium text-surface-700 hover:bg-primary-50 hover:text-primary-700 transition-colors group/item"
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
 className="w-full flex items-center gap-3 px-4 py-3.5 text-[13px] font-medium text-surface-700 hover:bg-primary-50 hover:text-primary-700 transition-colors group/item"
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

 {(role === "manager" || role === "head" || role === "hr" || role === "admin") && (
 <div className="flex flex-col gap-3 min-w-[240px] w-full lg:w-auto mt-2 lg:mt-0 order-last lg:order-none">
  {(() => {
     const isDirectManager = currentUser?.employee_id === jd?.reporting_manager_code;
     const isHeadReviewingSentToHR = role === "head" && (jd?.status === "sent_to_hr" || jd?.kra_kpi_status === "sent_to_hr");
     const showManagerActionButtons = (role === "manager" || role === "head") && (
       (isDirectManager && (jd?.status === "sent_to_manager" || jd?.kra_kpi_status === "sent_to_manager")) ||
       isHeadReviewingSentToHR
     );
     if (!showManagerActionButtons) return null;

     const approveBtnLabel = isApproving
       ? (isHeadReviewingSentToHR ? "Signing Off..." : "Forwarding...")
       : (isHeadReviewingSentToHR ? "Approve & Sign Off" : "Approve");

     return (
      <div className="flex flex-col sm:flex-row flex-wrap gap-3 w-full">
      <button
      onClick={handleManagerSendToHR}
      disabled={sendingToManager || isEditing || isApproving}
      className="flex-1 px-5 py-3.5 bg-emerald-600 text-white rounded-md font-medium flex flex-center items-center justify-center gap-2 shadow-sm hover:shadow-md hover:-translate-y-0.5 hover:bg-emerald-700 text-[14px] transition-all disabled:opacity-50 whitespace-nowrap"
      >
      {isApproving ? (
      <Loader2 className="w-4 h-4 animate-spin" />
      ) : (
      <CheckCircle2 className="w-4 h-4" />
      )}
      {approveBtnLabel}
      </button>
      <button
      onClick={handleEditToggle}
      disabled={isSavingEdit || sendingToManager}
      className="flex-1 px-5 py-3.5 bg-white text-primary-700 border border-primary-200 rounded-md font-medium hover:bg-primary-50 transition-all shadow-sm active:scale-[0.98] flex items-center justify-center gap-2 text-[14px] disabled:opacity-50 whitespace-nowrap"
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
      className="flex-1 px-5 py-3.5 bg-red-50 text-red-600 border border-red-100 rounded-md font-medium flex flex-center items-center justify-center gap-2 shadow-sm hover:bg-red-100 text-[14px] transition-all disabled:opacity-50 whitespace-nowrap"
      >
      <XCircle className="w-4 h-4" /> Reject
      </button>
      </div>
     );
   })()}

 {/* Manager/Head Owner Actions (for their own drafts) */}
 {(role === "manager" || role === "head") &&
 ["draft", "jd_generated", "hr_rejected"].includes(
 jd.status,
 ) && (

 <div className="flex flex-col sm:flex-row flex-wrap gap-3 w-full">
 <button
 onClick={() => router.push(`/questionnaire/${jdId}`)}
 className="flex-1 px-5 py-3.5 bg-white text-surface-700 border border-surface-200 rounded-md font-medium hover:bg-surface-50 transition-all shadow-sm flex items-center justify-center gap-2 text-[14px]"
 >
 <Edit3 className="w-4 h-4" /> Refine in Chat
 </button>
 <button
 onClick={handleEditToggle}
 disabled={isSavingEdit || sendingToManager}
 className="flex-1 px-5 py-3.5 bg-white text-primary-700 border border-primary-200 rounded-md font-medium hover:bg-primary-50 transition-all shadow-sm flex items-center justify-center gap-2 text-[14px] disabled:opacity-50"
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
 className="flex-1 px-5 py-3.5 bg-primary-600 text-white rounded-md font-medium flex flex-center items-center justify-center gap-2 shadow-sm hover:bg-primary-700 text-[14px] transition-all disabled:opacity-50 whitespace-nowrap"
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
 {(role === "manager" || role === "head") &&
 ["sent_to_hr", "hr_rejected", "approved"].includes(
 jd.status,
 ) && jd.kra_kpi_status !== "sent_to_manager" && (
 <button
 disabled
 className="w-full px-6 py-4 bg-emerald-50 text-emerald-600 border border-emerald-200 rounded-md font-medium flex items-center justify-center gap-2 text-[15px] cursor-not-allowed shadow-sm"
 >
 <CheckCircle2 className="w-5 h-5" /> Approved by Manager
 </button>
 )}

 {(role === "hr" || role === "admin") && (jd.status === "sent_to_hr" || jd.kra_kpi_status === "sent_to_hr") && (
 <div className="flex flex-col sm:flex-row flex-wrap gap-3 w-full">
 <button
 onClick={handleHRApprove}
 disabled={sendingToManager || isEditing}
 className="flex-1 px-5 py-3.5 bg-purple-600 text-white rounded-md font-medium flex flex-center items-center justify-center gap-2 shadow-sm hover:shadow-md hover:-translate-y-0.5 hover:bg-purple-700 text-[14px] transition-all disabled:opacity-50 whitespace-nowrap"
 >
 <ShieldCheck className="w-4 h-4" /> Approve
 </button>
 <button
 onClick={handleEditToggle}
 disabled={isSavingEdit || sendingToManager}
 className="flex-1 px-5 py-3.5 bg-white text-primary-700 border border-primary-200 rounded-md font-medium hover:bg-primary-50 transition-all shadow-sm active:scale-[0.98] flex items-center justify-center gap-2 text-[14px] disabled:opacity-50 whitespace-nowrap"
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
 className="flex-1 px-5 py-3.5 bg-red-50 text-red-600 border border-red-100 rounded-md font-medium flex flex-center items-center justify-center gap-2 shadow-sm hover:bg-red-100 text-[14px] transition-all disabled:opacity-50 whitespace-nowrap"
 >
 <XCircle className="w-4 h-4" /> Reject
 </button>
 </div>
 )}

 {/* HR Owner Actions (for their own drafts) */}
 {(role === "hr" || role === "admin") &&
 ["draft", "jd_generated"].includes(jd.status) && (
 <div className="flex flex-col sm:flex-row gap-3 w-full">
 <button
 onClick={() => router.push(`/questionnaire/${jdId}`)}
 className="px-5 py-3.5 bg-white text-surface-700 border border-surface-200 rounded-md font-medium hover:bg-surface-50 transition-all shadow-sm flex items-center justify-center gap-2 text-[14px]"
 >
 <Edit3 className="w-4 h-4" /> Refine in Chat
 </button>
 <button
 onClick={handleEditToggle}
 disabled={isSavingEdit || sendingToManager}
 className="px-5 py-3.5 bg-white text-primary-700 border border-primary-200 rounded-md font-medium hover:bg-primary-50 transition-all shadow-sm flex items-center justify-center gap-2 text-[14px] disabled:opacity-50"
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
 className="flex-1 px-5 py-3.5 bg-purple-600 text-white rounded-md font-medium flex flex-center items-center justify-center gap-2 shadow-sm hover:bg-purple-700 text-[14px] transition-all disabled:opacity-50 whitespace-nowrap"
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
 {(role === "hr" || role === "admin") && jd.status === "approved" && jd.kra_kpi_status !== "sent_to_hr" && (
 <button
 disabled
 className="w-full px-6 py-4 bg-purple-50 text-purple-600 border border-purple-200 rounded-md font-medium flex items-center justify-center gap-2 text-[15px] cursor-not-allowed shadow-sm"
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
 className="px-6 py-3.5 bg-white text-surface-700 border border-surface-200 rounded-md font-medium hover:bg-surface-50 hover:shadow-md transition-all shadow-sm active:scale-[0.98] flex items-center justify-center gap-2 text-[14px]"
 >
 <Edit3 className="w-4 h-4" /> Refine in Chat
 </button>
 <button
 onClick={handleEditToggle}
 disabled={isSavingEdit}
 className="px-6 py-3.5 bg-white text-primary-700 border border-primary-200 rounded-md font-medium hover:bg-primary-50 transition-all shadow-sm active:scale-[0.98] flex items-center justify-center gap-2 text-[14px] disabled:opacity-50"
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
 className="px-6 py-3.5 bg-primary-600 text-white rounded-md font-medium hover:bg-primary-700 transition-all shadow-md active:scale-[0.98] flex items-center justify-center gap-2 text-[14px] disabled:opacity-50 hover:shadow-md hover:-translate-y-0.5"
 >
 {sendingToManager ? (
 <Loader2 className="w-4 h-4 animate-spin" />
 ) : (
 <Send className="w-4 h-4" />
 )}
 {jd.status === "hr_rejected"
   ? "Resubmit to HR"
   : jd.status === "manager_rejected"
   ? "Resubmit to Manager"
   : "Submit for Approval"}
 </button>
 </>

 )}
 {["sent_to_manager", "sent_to_hr", "approved"].includes(
 jd.status,
 ) && (
 <button
 disabled
 className="px-6 py-3.5 bg-surface-50 text-surface-400 border border-surface-200 rounded-md font-medium flex items-center justify-center gap-2 text-[14px] cursor-not-allowed"
 >
 <CheckCircle2 className="w-5 h-5" />
 {jd.status === "approved" ? "Finalized" : "Asset Submitted"}
 </button>
 )}
 </div>
 )}
 </div>
 </div>

  {/* Feedback Banner: find the most recent rejection targeting the current user's role */}
  {(() => {
    // Search the full comment list (newest first) for a rejection aimed at this user
    const latestRejection = [...reviewComments]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .find((c: any) => c.action === "rejected" && rolesMatch(c.target_role, role));
    if (!latestRejection || !jd.status.includes("rejected")) return null;

    // Determine who rejected based on JD status for clear messaging
    const rejectedByManager = jd.status === "manager_rejected";
    const rejectedByHR = jd.status === "hr_rejected";
    const reviewerLabel = rejectedByHR
      ? "HR"
      : rejectedByManager
      ? "your Manager"
      : latestRejection.reviewer_role === "hr" || latestRejection.reviewer_role === "admin"
      ? "HR"
      : "your Manager";

    const rejectionTag = rejectedByHR
      ? "Rejected by HR"
      : rejectedByManager
      ? "Rejected by Manager"
      : "Rejected";

    const resubmitNote = rejectedByHR
      ? "Please revise and resubmit. It will be sent back to HR for review."
      : "Please revise and resubmit to your Manager for approval.";

    return (
      <div className="bg-red-50 border-2 border-red-200 rounded-[32px] p-6 mb-8 animate-in slide-in-from-top-4 duration-500 shadow-md shadow-red-900/5">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 bg-red-100 rounded-md flex items-center justify-center flex-shrink-0 animate-pulse">
            <AlertTriangle className="w-6 h-6 text-red-600" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-1">
              <h3 className="text-lg font-medium text-red-900">
                Revision Requested
              </h3>
              <span className="text-[10px] font-semibold text-red-600 bg-red-100 border border-red-200 px-2.5 py-1 rounded-full">
                {rejectionTag}
              </span>
            </div>
            <p className="text-red-700 text-sm leading-relaxed mb-4">
              <strong>{latestRejection.reviewer_name || reviewerLabel}</strong> ({reviewerLabel}) requested changes to this document:
            </p>
            <div className="bg-white/60 backdrop-blur-sm rounded-md p-4 border border-red-200/50">
              <p className="text-red-800 text-[15px] font-medium leading-relaxed italic">
                "{latestRejection.comment}"
              </p>
            </div>
            <div className="mt-4 flex items-center gap-2 flex-wrap">
              <span className="text-[10px] font-medium text-red-500 bg-red-100/70 px-2.5 py-1 rounded-md border border-red-200">
                Action Required: Update and resubmit
              </span>
              <span className="text-[10px] font-medium text-surface-500 bg-surface-100 px-2.5 py-1 rounded-md">
                {resubmitNote}
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  })()}


  {/* Review Audit Trail — all review history shown compactly */}
  {reviewComments.length > 0 && (
  <div className="space-y-3 mb-8">
  <h3 className="text-[11px] font-medium text-surface-500 px-1">
  Review Activity
  </h3>
  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
  {reviewComments.map((rc: any) => (
  <div
  key={rc.id}
  className={`rounded-md p-4 border ${rc.action === "rejected"
  ? "bg-red-50/30 border-red-100"
  : "bg-emerald-50/30 border-emerald-100"
  }`}
  >
  <div className="flex items-center justify-between mb-1">
  <span className="text-[10px] font-medium text-surface-500">
  {rc.reviewer_role ? `${rc.reviewer_role} Review` : "Review"}
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

 {/* Main Content Area */}
 <div className="bg-white rounded-md md:rounded-[32px] border border-surface-200 shadow-md overflow-hidden transition-all duration-500">

  {/* Tab bar — shown when not editing */}
  {!isEditing && (
   <div className="flex border-b border-surface-100">
    <button
     onClick={() => setActiveTab("structured")}
     className={`flex items-center gap-1.5 px-5 py-3 text-sm font-medium transition-colors border-b-2 ${
      activeTab === "structured"
       ? "border-primary-500 text-primary-600"
       : "border-transparent text-surface-500 hover:text-surface-700"
     }`}
    >
     <FileText className="w-4 h-4" />
     Job Description
    </button>
    <button
     onClick={async () => {
       if (!jd?.generated_jd) {
         setPrereqMissing(["employee_jd"]);
         setIsPrereqModalOpen(true);
         return;
       }
       let currentStatus = prereqStatus;
       if (!currentStatus && currentUser) {
         try {
           currentStatus = await fetchKRAKPIStatus(jdId, currentUser.employee_id);
           setPrereqStatus(currentStatus);
         } catch (e) {}
       }
        if (currentStatus && !currentStatus.ready && currentStatus.current_step !== "confirmed") {
          setPrereqMissing(currentStatus.missing || []);
          setIsPrereqModalOpen(true);
          return;
        }
       setActiveTab("kra-kpi");
     }}
     className={`flex items-center gap-1.5 px-5 py-3 text-sm font-medium transition-colors border-b-2 ${
      activeTab === "kra-kpi"
       ? "border-primary-500 text-primary-600"
       : "border-transparent text-surface-500 hover:text-surface-700"
     }`}
    >
     <Target className="w-4 h-4" />
     KRA / KPI
    </button>
   </div>
  )}

  {/* KRA/KPI tab content */}
  {activeTab === "kra-kpi" && currentUser && (
   <div className="p-5 sm:p-8">
    <KRAKPIPanel
     jdSessionId={jdId}
     employeeId={currentUser.employee_id || jd?.employee_id || ""}
     isManager={role === "manager" || role === "head" || role === "hr" || role === "admin"}
    />
   </div>
  )}

  {/* JD content (shown when structured tab active) */}
  {(activeTab === "structured" || isEditing) && (
   isEditing ? (
 <div className="overflow-y-auto custom-scrollbar max-h-[70vh]">
 <div className="w-full bg-surface-50 border border-surface-200 rounded-md p-5 sm:p-8 space-y-8 sm:space-y-12 shadow-inner min-h-full">
 {/* Job Title */}
 <div className="space-y-4">
 <label className="text-[11px] font-medium text-surface-500 px-1">
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
 className="w-full bg-white border border-surface-200 rounded-md p-4 sm:p-6 text-[15px] sm:text-[16px] font-medium text-surface-900 leading-relaxed focus:ring-4 focus:ring-primary-500/10 focus:border-primary-500 outline-none shadow-sm transition-all"
 placeholder="e.g. Strategic Role Architect"
 />
 </div>

 {/* Purpose of the Job */}
 <div className="space-y-4">
 <label className="text-[11px] font-medium text-surface-500 px-1">
 Purpose of the Job
 </label>
 <textarea
 value={editedData.purpose || ""}
 onChange={(e) =>
 handleTextChange("purpose", e.target.value)
 }
 className="w-full bg-white border border-surface-200 rounded-md p-4 sm:p-6 text-[14px] sm:text-[15px] font-medium text-surface-800 leading-relaxed focus:ring-4 focus:ring-primary-500/10 focus:border-primary-500 outline-none resize-none min-h-[160px] shadow-sm transition-all"
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
 <label className="text-[11px] font-medium text-surface-500 ">
 {field.label}
 </label>
 <button
 onClick={() => handleAddArrayItem(field.key)}
 className="flex items-center gap-2 text-[11px] font-medium text-primary-600 hover:text-primary-700 bg-primary-50 hover:bg-primary-100 px-4 py-2 rounded-md transition-all active:scale-95"
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
 className="flex-1 bg-white border border-surface-200 rounded-md p-4 text-[14px] font-medium text-surface-800 leading-relaxed focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 outline-none resize-none min-h-[80px] shadow-sm transition-all"
 />
 <button
 onClick={() =>
 handleRemoveArrayItem(field.key, idx)
 }
 className="mt-2 w-10 h-10 bg-surface-100 text-surface-400 rounded-md flex items-center justify-center hover:bg-red-50 hover:text-red-500 transition-all opacity-0 group-hover:opacity-100 focus:opacity-100"
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
 <label className="text-[11px] font-medium text-surface-500 px-1">
 Education Requested
 </label>
 <textarea
 value={editedData.education || ""}
 onChange={(e) =>
 handleTextChange("education", e.target.value)
 }
 className="w-full bg-white border border-surface-200 rounded-md p-4 sm:p-6 text-[14px] font-medium text-surface-800 leading-relaxed focus:ring-4 focus:ring-primary-500/10 focus:border-primary-500 outline-none resize-none min-h-[100px] shadow-sm transition-all"
 />
 </div>
 <div className="space-y-4">
 <label className="text-[11px] font-medium text-surface-500 px-1">
 Experience Requested
 </label>
 <textarea
 value={editedData.experience || ""}
 onChange={(e) =>
 handleTextChange("experience", e.target.value)
 }
 className="w-full bg-white border border-surface-200 rounded-md p-4 sm:p-6 text-[14px] font-medium text-surface-800 leading-relaxed focus:ring-4 focus:ring-primary-500/10 focus:border-primary-500 outline-none resize-none min-h-[100px] shadow-sm transition-all"
 />
 </div>
 </div>
 </div>
 </div>
 ) : (
 <div className="animate-in fade-in zoom-in-[0.98] duration-500 bg-surface-100/50 py-10 rounded-b-md md:rounded-b-[32px]">
 <div className="p-4 sm:p-6 md:p-8 flex justify-center">
 <div className="w-full max-w-[860px]">
 <PdfDocumentView data={editedData} roleTitle={jd.title} dept={jd.department} />
 </div>
 </div>
 </div>
 ))
 }
 </div>

 <FeedbackModal
 isOpen={showFeedbackPrompt}
 onClose={() => setShowFeedbackPrompt(false)}
 jdSessionId={jdId}
 defaultCategory={jd?.status === "approved" ? "KRA/KPI Process" : "JD Process"}
 />

 <ReviewRejectModal
 isOpen={showRejectModal}
 onClose={() => setShowRejectModal(false)}
 onSubmit={handleRejectWithModal}
 reviewerRole={rejectingAs}
 jdTitle={jd?.title || ""}
 />

 <KRAKPIPrereqModal
 isOpen={isPrereqModalOpen}
 onClose={() => setIsPrereqModalOpen(false)}
 missing={prereqMissing}
 managerCode={currentUser?.reporting_manager_code}
 employeeId={currentUser?.employee_id || jd?.employee_id}
 />
 </div>
 </div>
 );
}

export default function JDPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-surface-50 flex flex-col items-center justify-center p-6">
          <Loader2 className="w-10 h-10 text-primary-600 animate-spin mb-4" />
          <p className="text-sm font-medium text-surface-400 animate-pulse">
            Loading Job Description...
          </p>
        </div>
      }
    >
      <JDPageContent />
    </Suspense>
  );
}
