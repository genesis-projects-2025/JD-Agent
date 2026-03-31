import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Trash2, X, Loader2 } from "lucide-react";

interface DeleteModalProps {
 isOpen: boolean;
 onClose: () => void;
 onConfirm: () => void;
 isDeleting: boolean;
 title?: string;
 description?: string;
}

export function DeleteModal({
 isOpen,
 onClose,
 onConfirm,
 isDeleting,
 title = "Delete Job Description",
 description = "Are you sure you want to completely delete this JD and its conversation history? This action cannot be undone.",
}: DeleteModalProps) {
 const [mounted, setMounted] = useState(false);
 useEffect(() => setMounted(true), []);

 if (!isOpen || !mounted) return null;

 return createPortal(
 <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
 <div
 className="bg-white w-[90%] sm:w-full max-w-md rounded-[20px] sm:rounded-[24px] p-5 sm:p-6 shadow-md animate-in zoom-in-95 duration-300 m-4"
 onClick={(e) => e.stopPropagation()}
 >
 <div className="flex justify-between items-start mb-4">
 <div className="w-12 h-12 bg-red-100 rounded-md flex items-center justify-center">
 <AlertTriangle className="w-6 h-6 text-red-600" />
 </div>
 <button
 onClick={onClose}
 className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-neutral-100 transition-colors text-neutral-500 hover:text-neutral-700"
 >
 <X className="w-5 h-5" />
 </button>
 </div>

 <h3 className="text-xl font-medium text-slate-900 mb-2">{title}</h3>
 <p className="text-sm font-medium text-slate-500 mb-8 leading-relaxed">
 {description}
 </p>

 <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
 <button
 onClick={onClose}
 disabled={isDeleting}
 className="w-full sm:flex-1 px-4 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded-md transition-colors disabled:opacity-50"
 >
 Cancel
 </button>
 <button
 onClick={onConfirm}
 disabled={isDeleting}
 className="w-full sm:flex-1 px-4 py-3 bg-red-600 hover:bg-red-700 text-white font-medium rounded-md shadow-md shadow-red-600/20 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
 >
 {isDeleting ? (
 <Loader2 className="w-5 h-5 animate-spin" />
 ) : (
 <Trash2 className="w-5 h-5" />
 )}
 <span>{isDeleting ? "Deleting..." : "Delete Permanently"}</span>
 </button>
 </div>
 </div>
 </div>,
 document.body
 );
}
