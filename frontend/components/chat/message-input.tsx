// components/chat/message-input.tsx - IMPROVED VERSION

"use client";

import { useState, useRef, useEffect } from "react";
import { Send, Loader2 } from "lucide-react";

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

  // Auto-resize textarea
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
    <div className="p-4 bg-white border-t border-neutral-200">
      <div className="max-w-4xl mx-auto">
        <div className="flex gap-3 items-end">
          {/* Input Container */}
          <div className="flex-1 relative">
            <textarea
              ref={inputRef}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={disabled || isSending}
              rows={1}
              className="w-full text-black resize-none px-5 py-3.5 pr-12 bg-neutral-50 border-2 border-neutral-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all text-[15px] placeholder:text-neutral-400 disabled:opacity-50 disabled:cursor-not-allowed max-h-32"
              placeholder={
                disabled
                  ? "Waiting for response..."
                  : "Type your answer... (Shift + Enter for new line)"
              }
            />

            {/* Character Counter */}
            {value.length > 0 && (
              <div className="absolute bottom-2 right-3 text-xs text-neutral-400">
                {value.length}
              </div>
            )}
          </div>

          {/* Send Button */}
          <button
            onClick={handleSend}
            disabled={!value.trim() || isSending || disabled}
            className="flex-shrink-0 w-12 h-12 bg-gradient-to-r from-primary-600 to-primary-700 text-white rounded-2xl hover:from-primary-700 hover:to-primary-800 transition-all shadow-lg shadow-primary-900/20 disabled:opacity-50 disabled:cursor-not-allowed active:scale-95 flex items-center justify-center"
          >
            {isSending ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <Send className="w-5 h-5" />
            )}
          </button>
        </div>

        {/* Helper Text */}
        <div className="mt-2 px-1 text-xs text-neutral-500 flex items-center justify-between">
          <span>Press Enter to send, Shift + Enter for new line</span>
          {value.trim() && (
            <span className="text-primary-600 font-medium">Ready to send</span>
          )}
        </div>
      </div>
    </div>
  );
}
