// components/ui/review-reject-modal.tsx
"use client";

import { useState } from "react";
import {
 X,
 MessageCircle,
 UserRound,
 Users,
 Loader2,
 AlertTriangle,
} from "lucide-react";

interface ReviewRejectModalProps {
 isOpen: boolean;
 onClose: () => void;
 onSubmit: (
 targetRole: "employee" | "manager",
 comment: string,
 ) => Promise<void>;
 reviewerRole: "manager" | "hr"; // Who is rejecting
 jdTitle: string;
}

export function ReviewRejectModal({
 isOpen,
 onClose,
 onSubmit,
 reviewerRole,
 jdTitle,
}: ReviewRejectModalProps) {
 const [targetRole, setTargetRole] = useState<"employee" | "manager">(
 reviewerRole === "manager" ? "employee" : "employee",
 );
 const [comment, setComment] = useState("");
 const [isSubmitting, setIsSubmitting] = useState(false);

 if (!isOpen) return null;

 const handleSubmit = async () => {
 if (!comment.trim()) return;
 setIsSubmitting(true);
 try {
 await onSubmit(targetRole, comment.trim());
 setComment("");
 setTargetRole("employee");
 onClose();
 } catch (e) {
 console.error(e);
 } finally {
 setIsSubmitting(false);
 }
 };

 return (
 <div className="fixed inset-0 z-50 flex items-center justify-center">
 {/* Backdrop */}
 <div
 className="absolute inset-0 bg-black/40 backdrop-blur-sm animate-in fade-in duration-200"
 onClick={onClose}
 />

 {/* Modal */}
 <div className="relative bg-white rounded-md shadow-md w-full max-w-lg mx-4 animate-in zoom-in-95 fade-in duration-300 overflow-hidden">
 {/* Header gradient */}
 <div className="bg-gradient-to-br from-red-500 via-red-600 to-orange-500 px-8 py-6">
 <div className="flex items-center justify-between">
 <div className="flex items-center gap-3">
 <div className="w-10 h-10 bg-white/20 rounded-md flex items-center justify-center backdrop-blur-sm">
 <AlertTriangle className="w-5 h-5 text-white" />
 </div>
 <div>
 <h2 className="text-white font-medium text-lg">Reject JD</h2>
 <p className="text-white/70 text-xs font-medium truncate max-w-[280px]">
 {jdTitle || "Untitled JD"}
 </p>
 </div>
 </div>
 <button
 onClick={onClose}
 className="w-8 h-8 bg-white/10 hover:bg-white/20 rounded-md flex items-center justify-center transition-colors"
 >
 <X className="w-4 h-4 text-white" />
 </button>
 </div>
 </div>

 <div className="p-8 space-y-6">
 {/* Target selector — only shown for HR since managers always reject to employee */}
 {reviewerRole === "hr" && (
 <div className="space-y-3">
 <label className="text-[11px] font-medium text-surface-500 ">
 Send Feedback To
 </label>
 <div className="grid grid-cols-2 gap-3">
 <button
 onClick={() => setTargetRole("employee")}
 className={`p-4 rounded-md border-2 transition-all text-left ${
 targetRole === "employee"
 ? "border-red-500 bg-red-50 shadow-md"
 : "border-surface-200 bg-surface-50 hover:border-surface-300"
 }`}
 >
 <UserRound
 className={`w-6 h-6 mb-2 ${
 targetRole === "employee"
 ? "text-red-600"
 : "text-surface-400"
 }`}
 />
 <p
 className={`font-medium text-sm ${
 targetRole === "employee"
 ? "text-red-700"
 : "text-surface-700"
 }`}
 >
 Employee
 </p>
 <p className="text-[11px] text-surface-500 mt-0.5">
 Employee needs to revise the JD draft
 </p>
 </button>
 <button
 onClick={() => setTargetRole("manager")}
 className={`p-4 rounded-md border-2 transition-all text-left ${
 targetRole === "manager"
 ? "border-red-500 bg-red-50 shadow-md"
 : "border-surface-200 bg-surface-50 hover:border-surface-300"
 }`}
 >
 <Users
 className={`w-6 h-6 mb-2 ${
 targetRole === "manager"
 ? "text-red-600"
 : "text-surface-400"
 }`}
 />
 <p
 className={`font-medium text-sm ${
 targetRole === "manager"
 ? "text-red-700"
 : "text-surface-700"
 }`}
 >
 Manager
 </p>
 <p className="text-[11px] text-surface-500 mt-0.5">
 Manager should review and re-approve
 </p>
 </button>
 </div>
 </div>
 )}

 {reviewerRole === "manager" && (
 <div className="bg-amber-50 border border-amber-200 rounded-md p-4 flex items-start gap-3">
 <MessageCircle className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />
 <div>
 <p className="text-sm font-medium text-amber-800">
 Feedback will be sent to the Employee
 </p>
 <p className="text-xs text-amber-600 mt-0.5">
 The employee who created this JD will see your feedback and
 can revise accordingly.
 </p>
 </div>
 </div>
 )}

 {/* Comment */}
 <div className="space-y-3">
 <label className="text-[11px] font-medium text-surface-500 ">
 Feedback Comment <span className="text-red-400">*</span>
 </label>
 <textarea
 value={comment}
 onChange={(e) => setComment(e.target.value)}
 placeholder="Describe what needs to be changed. Be specific about which sections need revision..."
 className="w-full border border-surface-200 rounded-md p-4 text-sm text-surface-800 leading-relaxed focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none resize-none min-h-[120px] bg-surface-50 transition-shadow focus:shadow-md placeholder:text-surface-400"
 autoFocus
 />
 </div>

 {/* Actions */}
 <div className="flex gap-3 pt-2">
 <button
 onClick={onClose}
 disabled={isSubmitting}
 className="flex-1 px-5 py-3.5 bg-surface-100 text-surface-600 rounded-md font-medium text-sm hover:bg-surface-200 transition-colors disabled:opacity-50"
 >
 Cancel
 </button>
 <button
 onClick={handleSubmit}
 disabled={isSubmitting || !comment.trim()}
 className="flex-1 px-5 py-3.5 bg-red-600 text-white rounded-md font-medium text-sm hover:bg-red-700 transition-all shadow-md hover:shadow-md hover:-translate-y-0.5 disabled:opacity-50 disabled:hover:translate-y-0 flex items-center justify-center gap-2"
 >
 {isSubmitting ? (
 <Loader2 className="w-4 h-4 animate-spin" />
 ) : (
 <AlertTriangle className="w-4 h-4" />
 )}
 {isSubmitting ? "Submitting..." : "Submit Rejection"}
 </button>
 </div>
 </div>
 </div>
 </div>
 );
}
