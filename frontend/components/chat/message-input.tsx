// components/chat/message-input.tsx - ENTERPRISE REDESIGN

"use client";

import { useState, useRef, useEffect } from "react";
import { Send, Loader2, Paperclip, Mic, Square } from "lucide-react";

export default function MessageInput({
 onValueChange,
 onSend,
 value,
 voiceError,
 voiceInputSupported,
 isListening,
 onToggleListening,
 disabled = false,
}: {
 onValueChange: (value: string) => void;
 onSend: (text: string) => Promise<void> | void;
 value: string;
 voiceError?: string | null;
 voiceInputSupported?: boolean;
 isListening?: boolean;
 onToggleListening?: () => void;
 disabled?: boolean;
}) {
 const [isSending, setIsSending] = useState(false);
 const inputRef = useRef<HTMLTextAreaElement>(null);

 useEffect(() => {
 if (inputRef.current) {
 inputRef.current.style.height = "auto";
 inputRef.current.style.height = inputRef.current.scrollHeight + "px";
 }
 }, [value]);

 const handleSend = async () => {
 if (!value.trim() || isSending || disabled) return;

 setIsSending(true);
 const message = value.trim();

 try {
 await onSend(message);
 } finally {
 setIsSending(false);
 inputRef.current?.focus();
 }
 };

 const handleKeyDown = (e: React.KeyboardEvent) => {
 if (e.key === "Enter" && !e.shiftKey) {
 e.preventDefault();
 handleSend();
 }
 };

 return (
 <div className="p-3 sm:p-6 bg-white border-t border-surface-200 shadow-[0_-4px_20px_-10px_rgba(0,0,0,0.05)]">
 <div className="max-w-4xl mx-auto">
 <div className="flex gap-2 sm:gap-4 items-end bg-surface-50 p-1 sm:p-2 rounded-[16px] sm:rounded-[24px] border border-surface-200 shadow-sm focus-within:shadow-md transition-all duration-300">
 {/* Attachment icon remains visual-only */}
 <div className="flex gap-1 sm:gap-2 pb-1 sm:pb-2 pl-1 sm:pl-2">
 <button
 className="p-1 sm:p-2 text-surface-400 hover:text-primary-600 transition-colors"
 type="button"
 >
 <Paperclip className="w-3.5 h-3.5 sm:w-5 sm:h-5" />
 </button>
 </div>

 <div className="flex-1 relative pb-1">
 <textarea
 ref={inputRef}
 value={value}
 onChange={(e) => onValueChange(e.target.value)}
 onKeyDown={handleKeyDown}
 disabled={disabled || isSending}
 rows={1}
 className="w-full text-surface-900 resize-none px-1 sm:px-2 py-2 sm:py-3 bg-transparent border-none focus:outline-none text-[13px] sm:text-[16px] font-medium placeholder:text-surface-400 disabled:opacity-50 disabled:cursor-not-allowed max-h-24 sm:max-h-32"
 placeholder={
 disabled
 ? "Agent is processing..."
 : isListening
 ? "Listening... edit the transcript before sending."
 : "Type your detailed response here..."
 }
 />
 </div>

 <div className="flex items-center gap-1 sm:gap-2 pr-1 sm:pr-2 pb-1 sm:pb-2">
 <button
 type="button"
 onClick={onToggleListening}
 disabled={disabled || isSending || !voiceInputSupported}
 aria-pressed={isListening}
 title={
 voiceInputSupported
 ? isListening
 ? "Stop voice input"
 : "Start voice input"
 : "Voice input is not supported in this browser"
 }
 className={`p-2 sm:p-2.5 rounded-md transition-all ${
 isListening
 ? "bg-red-50 text-red-600 hover:bg-red-100"
 : "text-surface-400 hover:text-primary-600 hover:bg-white"
 } disabled:opacity-40 disabled:cursor-not-allowed`}
 >
 {isListening ? (
 <Square className="w-4 h-4 sm:w-5 sm:h-5 fill-current" />
 ) : (
 <Mic className="w-4 h-4 sm:w-5 sm:h-5" />
 )}
 </button>
 <button
 type="button"
 onClick={handleSend}
 disabled={!value.trim() || isSending || disabled}
 className="w-10 h-10 sm:w-12 sm:h-12 bg-primary-600 text-white rounded-md sm:rounded-md hover:bg-primary-700 transition-all shadow-md shadow-primary-500/20 disabled:opacity-30 disabled:shadow-none active:scale-95 flex items-center justify-center group shrink-0"
 >
 {isSending ? (
 <Loader2 className="w-4 h-4 sm:w-5 sm:h-5 animate-spin" />
 ) : (
 <Send className="w-4 h-4 sm:w-5 sm:h-5 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
 )}
 </button>
 </div>
 </div>

 {/* Status indicator */}
 <div className="mt-3 px-2 sm:px-4 text-[9px] sm:text-[10px] font-medium text-surface-400 flex flex-col sm:flex-row items-center justify-between gap-1 sm:gap-2">
 <div className="flex items-center gap-2">
 <div className="w-1 h-1 bg-primary-400 rounded-md hidden sm:block" />
 {voiceError ? (
 <span className="text-red-500">{voiceError}</span>
 ) : isListening ? (
 <span className="text-primary-600">
 Listening live. Review the draft before sending.
 </span>
 ) : voiceInputSupported ? (
 <>
 <span className="hidden sm:inline">
 Shift + Enter for multiline. Use the mic for live dictation.
 </span>
 <span className="sm:hidden">Enter sends. Mic fills the draft live.</span>
 </>
 ) : (
 <>
 <span className="hidden sm:inline">
 Shift + Enter for multiline. Voice input is unavailable in this browser.
 </span>
 <span className="sm:hidden">Press Enter to send</span>
 </>
 )}
 </div>
 {value.length > 0 && <span>{value.length} chars</span>}
 </div>
 </div>
 </div>
 );
}
