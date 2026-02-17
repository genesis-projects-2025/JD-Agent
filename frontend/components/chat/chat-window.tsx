// frontend/components/chat/chat-window.tsx

import { useEffect, useRef } from "react";
import MessageBubble from "./message-bubble";
import { Message } from "../../types/message";

export default function ChatWindow({
  messages,
  onSkillSelect,
  onGenerateJD,
  onContinue,
}: {
  messages: Message[];
  onSkillSelect?: (selectedSkills: string[]) => void;
  onGenerateJD?: () => void;
  onContinue?: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom whenever messages change
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
<<<<<<< HEAD
        behavior: "smooth",   // smooth auto-scroll as chat happens
=======
        behavior: "smooth",
>>>>>>> databaseInclude
      });
    }
  }, [messages]);  // fires every time a new message is added

  return (
<<<<<<< HEAD
    // flex-1 min-h-0 = fills remaining space without overflowing
    // overflow-y-auto = ONLY this div scrolls
    <div
      ref={scrollRef}
      className="flex-1 min-h-0 overflow-y-auto p-4 space-y-2 scroll-smooth"
    >
      {messages.map((msg, index) => (
        <MessageBubble
          key={index}
          message={msg}
          onSkillSelect={onSkillSelect}
          onGenerateJD={onGenerateJD}
          onContinue={onContinue}
        />
      ))}
=======
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Chat Header with Progress */}
      <div className="px-6 py-4 bg-gradient-to-r from-primary-50 to-primary-100/50 border-b border-primary-200">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-primary-500 to-primary-600 rounded-xl flex items-center justify-center shadow-lg">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="font-semibold text-neutral-900">
                AI Interview Assistant
              </h3>
              <p className="text-sm text-neutral-600">
                Powered by Claude Sonnet
              </p>
            </div>
          </div>

          {/* Message Counter */}
          <div className="flex items-center gap-2 px-3 py-1.5 bg-white rounded-lg border border-primary-200 shadow-sm">
            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
            <span className="text-sm font-medium text-neutral-700">
              {messages.length} messages
            </span>
          </div>
        </div>

        {/* Progress Bar (estimate based on message count) */}
        <div className="mt-3">
          <div className="flex items-center justify-between text-xs text-neutral-600 mb-1.5">
            <span>Interview Progress</span>
            <span>
              {Math.min(Math.round((messages.length / 20) * 100), 100)}%
            </span>
          </div>
          <div className="h-1.5 bg-neutral-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-primary-500 to-primary-600 rounded-full transition-all duration-500"
              style={{
                width: `${Math.min((messages.length / 20) * 100, 100)}%`,
              }}
            />
          </div>
        </div>
      </div>

      {/* Messages Area */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-6 space-y-4 bg-gradient-to-b from-neutral-50 to-white"
      >
        {messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center max-w-md">
              <div className="w-16 h-16 bg-gradient-to-br from-primary-100 to-primary-200 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <MessageSquare className="w-8 h-8 text-black" />
              </div>
              <h3 className="text-lg font-semibold text-neutral-900 mb-2">
                Ready to start?
              </h3>
              <p className="text-sm text-neutral-600">
                I'll ask you questions about your role to create the perfect job
                description.
              </p>
            </div>
          </div>
        ) : (
          messages.map((msg, index) => (
            <MessageBubble
              key={index}
              message={msg}
              onSkillSelect={onSkillSelect}
              onGenerateJD={onGenerateJD}
              onContinue={onContinue}
            />
          ))
        )}
      </div>
>>>>>>> databaseInclude
    </div>
  );
}
