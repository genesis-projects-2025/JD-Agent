// components/chat/chat-window.tsx - ENTERPRISE REDESIGN

import { useEffect, useRef, useState, useCallback } from "react";
import MessageBubble from "./message-bubble";
import { Message } from "../../types/message";
import { Sparkles, Activity, Bot, Loader2 } from "lucide-react";

export default function ChatWindow({
  messages,
  isGenerating,
  onSkillSelect,
  onGenerateJD,
  onContinue,
}: {
  messages: Message[];
  isGenerating?: boolean;
  onSkillSelect?: (selectedSkills: string[]) => void;
  onGenerateJD?: () => void;
  onContinue?: () => void;
}) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);

  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    isAtBottomRef.current = distanceFromBottom <= 80;
  }, []);

  useEffect(() => {
    if (!isAtBottomRef.current) return;
    const el = scrollContainerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const progressPercent = Math.min(
    Math.round((messages.length / 15) * 100),
    100,
  );

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-white">
      {/* Premium Glass Header */}
      <div className="flex-shrink-0 relative z-20">
        <div className="px-8 py-5 glass border-b border-surface-200 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-primary-600 rounded-2xl flex items-center justify-center shadow-lg shadow-primary-500/20">
                <Sparkles className="w-6 h-6 text-white" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-surface-900 tracking-tight leading-none">
                  Saniya Assistant
                </h3>
                <p className="text-[11px] font-bold text-primary-600 uppercase tracking-widest mt-1.5 flex items-center gap-1.5">
                  <Activity className="w-3 h-3" />
                  Enterprise Intelligence Active
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3 px-4 py-2 bg-surface-50 rounded-xl border border-surface-200">
              <div className="w-2 h-2 bg-accent-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
              <span className="text-xs font-bold text-surface-700 uppercase tracking-wider">
                Session Synced
              </span>
            </div>
          </div>

          {/* Integrated Progress Tracker */}
          <div className="mt-5 relative">
            <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-[0.2em] text-surface-400 mb-2">
              <span>Interview completion depth</span>
              <span className="text-primary-600 font-black">
                {progressPercent}%
              </span>
            </div>
            <div className="h-1.5 bg-surface-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-primary-500 via-primary-600 to-primary-800 rounded-full transition-all duration-1000 ease-out"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Messages Feed */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 min-h-0 overflow-y-auto px-8 py-8 space-y-2 bg-[#fdfdfe]"
        style={{ overscrollBehavior: "contain" }}
      >
        {messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center max-w-sm px-6">
              <div className="w-16 h-16 bg-primary-50 rounded-3xl flex items-center justify-center mx-auto mb-6 border border-primary-100">
                <Bot className="w-8 h-8 text-primary-500" />
              </div>
              <h3 className="text-xl font-bold text-surface-900 mb-3 tracking-tight">
                Welcome to Role Optimization
              </h3>
              <p className="text-sm text-surface-500 leading-relaxed font-medium">
                I'm Saniya. I'll guide you through a precision interview to
                architect a high-impact Job Description.
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
            {isGenerating && (
              <div className="flex gap-4 justify-start mb-6 animate-in fade-in slide-in-from-bottom-3 duration-500 w-full">
                <div className="flex-shrink-0 mt-1">
                  <div className="w-11 h-11 bg-primary-600 rounded-2xl flex items-center justify-center shadow-premium ring-4 ring-primary-50">
                    <Bot className="w-6 h-6 text-white" />
                  </div>
                </div>
                <div className="max-w-[80%]">
                  <div className="relative px-6 py-4 rounded-3xl shadow-sm bg-white text-surface-900 rounded-tl-none border border-surface-200">
                    <div className="flex items-center gap-3">
                      <Loader2 className="w-4 h-4 text-primary-500 animate-spin" />
                      <span className="text-[12px] font-bold text-surface-400 uppercase tracking-widest">
                        Saniya is analyzing...
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}
            <div className="h-8" />
          </>
        )}
      </div>
    </div>
  );
}
