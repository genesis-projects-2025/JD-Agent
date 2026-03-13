// components/chat/message-input.tsx - ENTERPRISE REDESIGN

"use client";

import { useState, useRef, useEffect } from "react";
import { Send, Loader2, Paperclip, Mic } from "lucide-react";

export default function MessageInput({
  onSend,
  disabled = false,
}: {
  onSend: (text: string) => void;
  disabled?: boolean;
}) {
  const [value, setValue] = useState("");
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
    const message = value;
    setValue("");

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
        <div className="flex gap-2 sm:gap-4 items-end bg-surface-50 p-1.5 sm:p-2 rounded-[20px] sm:rounded-[24px] border border-surface-200 shadow-sm focus-within:shadow-premium transition-all duration-300">
          {/* Action Icons (Visual only for now) */}
          <div className="flex gap-1 sm:gap-2 pb-1.5 sm:pb-2 pl-1 sm:pl-2">
            <button className="p-1.5 sm:p-2 text-surface-400 hover:text-primary-600 transition-colors">
              <Paperclip className="w-4 h-4 sm:w-5 sm:h-5" />
            </button>
          </div>

          <div className="flex-1 relative pb-1">
            <textarea
              ref={inputRef}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={disabled || isSending}
              rows={1}
              className="w-full text-surface-900 resize-none px-1 sm:px-2 py-2 sm:py-3 bg-transparent border-none focus:outline-none text-[13px] sm:text-[16px] font-medium placeholder:text-surface-400 disabled:opacity-50 disabled:cursor-not-allowed max-h-24 sm:max-h-32"
              placeholder={
                disabled
                  ? "Agent is processing..."
                  : "Type your detailed response here..."
              }
            />
          </div>

          <div className="flex items-center gap-1 sm:gap-2 pr-1 sm:pr-2 pb-1 sm:pb-2">
            <button className="hidden sm:block p-1.5 sm:p-2 text-surface-400 hover:text-primary-600 transition-colors">
              <Mic className="w-4 h-4 sm:w-5 sm:h-5" />
            </button>
            <button
              onClick={handleSend}
              disabled={!value.trim() || isSending || disabled}
              className="w-10 h-10 sm:w-12 sm:h-12 bg-primary-600 text-white rounded-xl sm:rounded-2xl hover:bg-primary-700 transition-all shadow-lg shadow-primary-500/20 disabled:opacity-30 disabled:shadow-none active:scale-95 flex items-center justify-center group shrink-0"
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
        <div className="mt-3 px-2 sm:px-4 text-[9px] sm:text-[10px] font-bold uppercase tracking-widest text-surface-400 flex flex-col sm:flex-row items-center justify-between gap-1 sm:gap-2">
          <div className="flex items-center gap-2">
            <div className="w-1 h-1 bg-primary-400 rounded-full hidden sm:block" />
            <span className="hidden sm:inline">
              Shift + Enter for multiline
            </span>
            <span className="sm:hidden">Press Enter to send</span>
          </div>
          {value.length > 0 && <span>{value.length} chars</span>}
        </div>
      </div>
    </div>
  );
}
