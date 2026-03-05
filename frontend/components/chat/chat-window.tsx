// components/chat/chat-window.tsx - ENTERPRISE REDESIGN

import { useEffect, useRef, useState, useCallback } from "react";
import MessageBubble from "./message-bubble";
import { Message } from "../../types/message";
import { Sparkles, Activity, Bot, Loader2 } from "lucide-react";

export default function ChatWindow({
  messages,
  isGenerating,
  progress = 0,
  onSkillSelect,
  onGenerateJD,
  onContinue,
}: {
  messages: Message[];
  isGenerating?: boolean;
  progress?: number;
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

  const progressPercent = Math.min(Math.round(progress), 100);

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-white">
      {/* Premium Glass Header */}
      <div className="flex-shrink-0 relative z-20">
        <div className="px-4 sm:px-8 py-3 sm:py-5 glass border-b border-surface-200 shadow-sm">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-3 sm:gap-4">
              <div className="w-10 h-10 sm:w-12 sm:h-12 bg-primary-600 rounded-xl sm:rounded-2xl flex items-center justify-center shadow-lg shadow-primary-500/20 shrink-0">
                <Sparkles className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
              </div>
              <div className="overflow-hidden">
                <h3 className="text-base sm:text-lg font-bold text-surface-900 tracking-tight leading-none truncate w-full">
                  Saniya Assistant
                </h3>
                <p className="text-[9px] sm:text-[11px] font-bold text-primary-600 uppercase tracking-widest mt-1 sm:mt-1.5 flex items-center gap-1 sm:gap-1.5 truncate w-full">
                  <Activity className="w-2.5 h-2.5 sm:w-3 sm:h-3 shrink-0" />
                  <span className="hidden sm:inline">
                    Enterprise Intelligence Active
                  </span>
                  <span className="sm:hidden">Active</span>
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 sm:gap-3 px-2 sm:px-4 py-1.5 sm:py-2 bg-surface-50 rounded-xl border border-surface-200 shrink-0">
              <div className="w-2 h-2 bg-accent-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
              <span className="text-[10px] sm:text-xs font-bold text-surface-700 uppercase tracking-wider hidden sm:block">
                Session Synced
              </span>
              <span className="text-[10px] font-bold text-surface-700 uppercase tracking-wider sm:hidden">
                Synced
              </span>
            </div>
          </div>

          {/* Integrated Progress Tracker */}
          <div className="mt-3 sm:mt-5 relative">
            <div className="flex items-center justify-between text-[8px] sm:text-[10px] font-black uppercase tracking-[0.2em] text-surface-400 mb-1.5 sm:mb-2">
              <span className="hidden sm:inline">
                Interview completion depth
              </span>
              <span className="sm:hidden">Progress</span>
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
        className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-8 py-4 sm:py-8 space-y-2 bg-[#fdfdfe]"
        style={{ overscrollBehavior: "contain" }}
      >
        {messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center max-w-sm px-4 sm:px-6">
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
              <div className="flex gap-2 sm:gap-4 justify-start mb-6 animate-in fade-in slide-in-from-bottom-3 duration-500 w-full pr-8">
                <div className="flex-shrink-0 mt-1">
                  <div className="w-8 h-8 sm:w-11 sm:h-11 bg-primary-600 rounded-xl sm:rounded-2xl flex items-center justify-center shadow-premium ring-2 sm:ring-4 ring-primary-50">
                    <Bot className="w-4 h-4 sm:w-6 sm:h-6 text-white" />
                  </div>
                </div>
                <div className="max-w-[85%] sm:max-w-[80%]">
                  <div className="relative px-4 sm:px-6 py-3 sm:py-4 rounded-2xl sm:rounded-3xl shadow-sm bg-white text-surface-900 rounded-tl-none border border-surface-200">
                    <div className="flex items-center gap-2 sm:gap-3">
                      <Loader2 className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-primary-500 animate-spin" />
                      <span className="text-[10px] sm:text-[12px] font-bold text-surface-400 uppercase tracking-widest leading-none sm:leading-normal">
                        Saniya is analyzing...
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}
            <div className="h-4 sm:h-8" />
          </>
        )}
      </div>
    </div>
  );
}
