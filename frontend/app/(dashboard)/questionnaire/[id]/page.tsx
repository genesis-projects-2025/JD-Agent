// app/(dashboard)/questionnaire/[id]/page.tsx
// CHAT PAGE — shows interview on left, JD preview panel slides in on right after generation

"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { getCookie, cookieKeys } from "@/lib/cookies";
import ChatWindow from "@/components/chat/chat-window";
import MessageInput from "@/components/chat/message-input";
import JDPreviewPanel from "@/components/jd/jd-preview-panel";
import { useChat } from "@/hooks/useChat";
import { deleteJD, getCurrentUser } from "@/lib/api";
import { DeleteModal } from "@/components/ui/delete-modal";
import {
 Loader2,
 ArrowLeft,
 FileText,
 Sparkles,
 ChevronRight,
 Trash2,
} from "lucide-react";

export default function QuestionnairePage() {
 const params = useParams();
 const router = useRouter();
 const sessionId = params.id as string;

 const [showPanel, setShowPanel] = useState(false);
 const [isDeleting, setIsDeleting] = useState(false);
 const [showDeleteModal, setShowDeleteModal] = useState(false);
 const [saveSuccess, setSaveSuccess] = useState(false);

 const {
 messages,
 sendMessage,
 jd,
 isGenerating,
 isSaving,
 isGeneratingJD,
 handleGenerateJD,
 handleSaveJD,
 progress,
 status,
 structuredData,
 isRateLimited,
 retryTimer,
 updateJd,
 updateStructuredData,
 confirmSkillsAction,
 } = useChat(() => {
 // Component stays on page; the JDPreviewPanel handles UI view
 }, true);

 // Auto-open panel when JD is generated
 useEffect(() => {
 if (jd && status === "jd_generated") {
 setShowPanel(true);
 }
 }, [jd, status]);

 // Also open panel while generating
 useEffect(() => {
 if (isGeneratingJD) {
 setShowPanel(true);
 }
 }, [isGeneratingJD]);

 const handleSkillSelect = (skills: string[]) => {
 confirmSkillsAction(skills);
 };

 const handleContinue = () => {
 sendMessage("Please continue the interview with more questions.");
 };

 const handleConfirmDelete = async () => {
 setIsDeleting(true);
 try {
 const employeeId = getCookie(cookieKeys.EMPLOYEE_ID);
 if (!employeeId) throw new Error("Missing employee identification.");
 await deleteJD(sessionId, employeeId);
 router.push(`/dashboard/${employeeId}`);
 } catch (err: any) {
 alert(err?.message || "Failed to delete JD");
 setIsDeleting(false);
 setShowDeleteModal(false);
 }
 };

 return (
 <div className="fixed inset-0 flex flex-col overflow-hidden bg-surface-50">
 {/* Top nav bar */}
 <div className="flex-shrink-0 h-14 bg-white border-b border-surface-200 flex items-center pl-14 pr-4 sm:px-6 gap-2 sm:gap-4 z-40 shadow-sm overflow-x-auto">
 <button
 onClick={() => {
 const u = getCurrentUser();
 if (u?.employee_id) {
 router.push(`/dashboard/${u.employee_id}`);
 } else {
 router.push("/");
 }
 }}
 className="flex items-center gap-1.5 sm:gap-2 text-surface-400 hover:text-primary-600 transition-colors text-[10px] sm:text-[11px] font-medium group whitespace-nowrap shrink-0"
 >
 <ArrowLeft className="w-4 h-4" />
 <span className="hidden sm:inline">Back</span>
 </button>

 <div className="h-4 w-px bg-surface-200 shrink-0" />

 <div className="flex items-center gap-2 shrink-0">
 <FileText className="w-4 h-4 text-primary-600" />
 <span className="text-[10px] sm:text-[11px] font-medium text-surface-600 whitespace-nowrap">
 JD Interview
 </span>
 </div>

 <div className="flex-1 min-w-4" />

 {/* JD Ready indicator */}
 <div className="flex items-center gap-2 sm:gap-3 shrink-0">
 {jd && status === "jd_generated" && (
 <button
 onClick={() => setShowPanel((p) => !p)}
 className="flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-1.5 sm:py-2 bg-primary-600 text-white rounded-md text-[10px] sm:text-[11px] font-medium hover:bg-primary-700 transition-all shadow-md shadow-primary-500/20 active:scale-95 whitespace-nowrap"
 >
 <Sparkles className="w-3.5 h-3.5 hidden sm:block" />
 {showPanel ? "Hide JD" : "View JD"}
 <ChevronRight
 className={`w-3.5 h-3.5 transition-transform ${showPanel ? "rotate-90 md:rotate-180" : ""}`}
 />
 </button>
 )}

 <button
 onClick={() => setShowDeleteModal(true)}
 disabled={isDeleting}
 title="Delete Interview Draft"
 className="p-1.5 sm:p-2 text-surface-400 hover:text-red-500 bg-surface-50 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
 >
 {isDeleting ? (
 <Loader2 className="w-4 h-4 animate-spin" />
 ) : (
 <Trash2 className="w-4 h-4" />
 )}
 </button>
 </div>

 {/* Generating indicator */}
 {isGeneratingJD && (
 <div className="flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-1.5 sm:py-2 bg-primary-50 text-primary-700 rounded-md text-[10px] sm:text-[11px] font-medium border border-primary-100 whitespace-nowrap shrink-0">
 <Loader2 className="w-3.5 h-3.5 animate-spin" />
 <span className="hidden sm:inline">Generating JD...</span>
 <span className="sm:hidden">Gen JD...</span>
 </div>
 )}
 </div>

 {/* Main content area */}
 <div className="flex-1 flex flex-col md:flex-row min-h-0 relative">
 {/* Chat column — hidden on mobile when JD panel is open */}
 <div
 className={`flex flex-col min-h-0 transition-all duration-500 ease-out bg-surface-50 w-full ${showPanel
 ? "hidden md:flex md:h-auto md:w-1/2 md:border-r border-surface-200"
 : "h-full"
 }`}
 >
 <ChatWindow
 messages={messages}
 isGenerating={isGenerating}
 progress={progress}
 onSkillSelect={handleSkillSelect}
 onGenerateJD={() => {
 setShowPanel(true);
 handleGenerateJD();
 }}
 onContinue={handleContinue}
 />

 {/* Rate limit banner */}
 {isRateLimited && retryTimer > 0 && (
 <div className="flex-shrink-0 mx-6 mb-3 px-5 py-3 bg-amber-50 border border-amber-200 rounded-md flex items-center gap-3">
 <div className="w-2 h-2 rounded-md bg-amber-500 animate-pulse" />
 <span className="text-[11px] font-medium text-amber-700 ">
 Rate limited — resuming in {retryTimer}s
 </span>
 </div>
 )}

 <MessageInput
 onSend={sendMessage}
 disabled={
 isGenerating ||
 isGeneratingJD ||
 (isRateLimited && retryTimer > 0)
 }
 />
 </div>

 {/* JD Preview Panel — full screen on mobile, 50% on desktop */}
 {showPanel && (
 <div className="w-full h-full md:w-1/2 md:h-full flex flex-col min-h-0 animate-in slide-in-from-bottom md:slide-in-from-right duration-400 bg-white">
 <JDPreviewPanel
 jd={jd}
 structuredData={structuredData}
 isGenerating={isGeneratingJD}
 isSaving={isSaving}
 saveSuccess={saveSuccess}
 onSave={async () => {
 const success = await handleSaveJD();
 if (success) {
 setSaveSuccess(true);
 // Stays on page with success feedback showing momentarily, then redirects
 setTimeout(() => {
 router.push(`/jd/${sessionId}`);
 }, 1200);
 }
 }}
 onEdit={async () => {
 // Handled internally by JDPreviewPanel's isEditing state
 }}
 updateJd={updateJd}
 updateStructuredData={updateStructuredData}
 onClose={() => setShowPanel(false)}
 sessionId={sessionId}
 />
 </div>
 )}
 </div>

 <DeleteModal
 isOpen={showDeleteModal}
 onClose={() => setShowDeleteModal(false)}
 onConfirm={handleConfirmDelete}
 isDeleting={isDeleting}
 title="Delete Interview"
 description="Are you sure you want to delete this interview progress? This cannot be undone."
 />
 </div>
 );
}
