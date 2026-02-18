"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import MessageBubble from "./message-bubble";
import { Message } from "../../types/message";
import { Sparkles } from "lucide-react";

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
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true); // Use ref instead of state to avoid re-render loops

  // Check if user is near bottom — stored in ref so it doesn't trigger effects
  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    isAtBottomRef.current = distanceFromBottom <= 80;
  }, []);

  // Auto-scroll when messages change — only if user was already at bottom
  useEffect(() => {
    if (!isAtBottomRef.current) return;
    const el = scrollContainerRef.current;
    if (!el) return;
    // Use scrollTop directly (more reliable than scrollIntoView inside flex containers)
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages]);

  return (
    // KEY FIX: min-h-0 on flex children allows them to shrink below their content size,
    // which is what enables overflow-y-auto to actually work inside a flex column.
    <div className="flex-1 flex flex-col min-h-0">
      {/* Chat Header */}
      <div className="flex-shrink-0 px-6 py-4 bg-gradient-to-r from-blue-50 to-blue-100/50 border-b border-blue-200">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl flex items-center justify-center shadow-lg">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="font-semibold text-black">
                AI Interview Assistant
              </h3>
              <p className="text-sm text-black/80">
                Enterprise Employee Role Intelligence
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 px-3 py-1.5 bg-white rounded-lg border border-neutral-200 shadow-sm">
            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
            <span className="text-sm font-medium text-black">
              {messages.length} messages
            </span>
          </div>
        </div>

        <div className="mt-3">
          <div className="flex items-center justify-between text-xs text-black/70 mb-1.5">
            <span>Interview Progress</span>
            <span>
              {Math.min(Math.round((messages.length / 20) * 100), 100)}%
            </span>
          </div>
          <div className="h-1.5 bg-neutral-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-blue-500 to-blue-600 rounded-full transition-all duration-500"
              style={{
                width: `${Math.min((messages.length / 20) * 100, 100)}%`,
              }}
            />
          </div>
        </div>
      </div>

      {/* Messages Area — KEY FIX: min-h-0 + overflow-y-auto + flex-1 */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 min-h-0 overflow-y-auto p-6 space-y-4 bg-white"
        // Ensure the div is the scroll container, not the browser window
        style={{ overscrollBehavior: "contain" }}
      >
        {messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center max-w-md">
              <h3 className="text-lg font-semibold text-black mb-2">
                Ready to start?
              </h3>
              <p className="text-sm text-black/80">
                I'll ask you questions about your role to create the perfect job
                description.
              </p>
            </div>
          </div>
        ) : (
          <>
            {messages.map((msg, index) => (
              <MessageBubble
                key={index}
                message={msg}
                onSkillSelect={onSkillSelect}
                onGenerateJD={onGenerateJD}
                onContinue={onContinue}
              />
            ))}
            {/* Spacer div at the bottom — scroll target */}
            <div className="h-2" />
          </>
        )}
      </div>
    </div>
  );
}
