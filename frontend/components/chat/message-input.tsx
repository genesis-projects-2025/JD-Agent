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
    <div className="p-6 bg-white border-t border-surface-200">
      <div className="max-w-4xl mx-auto">
        <div className="flex gap-4 items-end bg-surface-50 p-2 rounded-[24px] border border-surface-200 shadow-sm focus-within:shadow-premium transition-all duration-300">
          {/* Action Icons (Visual only for now) */}
          <div className="flex gap-2 pb-2 pl-2">
            <button className="p-2 text-surface-400 hover:text-primary-600 transition-colors">
              <Paperclip className="w-5 h-5" />
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
              className="w-full text-surface-900 resize-none px-2 py-3 bg-transparent border-none focus:outline-none text-[16px] font-medium placeholder:text-surface-400 disabled:opacity-50 disabled:cursor-not-allowed max-h-32"
              placeholder={
                disabled
                  ? "Saniya is processing..."
                  : "Type your detailed response here..."
              }
            />
          </div>

          <div className="flex items-center gap-2 pr-2 pb-2">
            <button className="p-2 text-surface-400 hover:text-primary-600 transition-colors">
              <Mic className="w-5 h-5" />
            </button>
            <button
              onClick={handleSend}
              disabled={!value.trim() || isSending || disabled}
              className="w-12 h-12 bg-primary-600 text-white rounded-2xl hover:bg-primary-700 transition-all shadow-lg shadow-primary-500/20 disabled:opacity-30 disabled:shadow-none active:scale-95 flex items-center justify-center group"
            >
              {isSending ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <Send className="w-5 h-5 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
              )}
            </button>
          </div>
        </div>

        {/* Status indicator */}
        <div className="mt-3 px-4 text-[10px] font-bold uppercase tracking-widest text-surface-400 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-1 h-1 bg-primary-400 rounded-full" />
            <span>Shift + Enter for multiline</span>
          </div>
          {value.length > 0 && <span>{value.length} characters recorded</span>}
        </div>
      </div>
    </div>
  );
}
