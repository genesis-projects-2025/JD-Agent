// components/chat/message-bubble.tsx - ENTERPRISE REDESIGN

import { useEffect, useState } from "react";
import { Message } from "../../types/message";
import {
  Bot,
  User,
  Check,
  Plus,
  Sparkles,
  ArrowRight,
  ShieldCheck,
  Loader2,
} from "lucide-react";

export default function MessageBubble({
  message,
  onSkillSelect,
  onGenerateJD,
  onContinue,
}: {
  message: Message;
  onSkillSelect?: (selectedSkills: string[]) => void;
  onGenerateJD?: () => void;
  onContinue?: () => void;
}) {
  const isAgent = message.sender === "agent";
  const [availableSkills, setAvailableSkills] = useState<string[]>(
    message.skills || [],
  );
  const [selectedSkills, setSelectedSkills] = useState<string[]>(
    message.skills || [],
  );
  const [newSkill, setNewSkill] = useState("");
  const [isConfirmed, setIsConfirmed] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [isReadyActionTaken, setIsReadyActionTaken] = useState(false);

  // Typewriter effect state
  const [displayText, setDisplayText] = useState(() =>
    !message.isStreaming ? message.text : ""
  );
  const [isTyping, setIsTyping] = useState(false);
  const fullText = message.text;
  const EFFECT_SPEED = 20; // ms per character

  useEffect(() => {
    if (displayText.length < fullText.length) {
      setIsTyping(true);
      const timeout = setTimeout(() => {
        // Take a slice to catch up faster if the gap is large
        const gap = fullText.length - displayText.length;
        const charsToAdd = gap > 20 ? 5 : 1;
        setDisplayText(fullText.substring(0, displayText.length + charsToAdd));
      }, EFFECT_SPEED);
      return () => clearTimeout(timeout);
    } else {
      setIsTyping(false);
    }
  }, [displayText, fullText]);

  // Handle case where message is NOT streaming but has full text (initial load or manual update)
  useEffect(() => {
    if (!message.isStreaming && displayText.length === 0 && fullText.length > 0) {
      setDisplayText(fullText);
    }
  }, [message.isStreaming, fullText]);

  // ✅ Fix: Sync local skill state when the message.skills prop updates (e.g., after stream ends)
  useEffect(() => {
    if (message.skills && message.skills.length > 0) {
      setAvailableSkills(message.skills);
      setSelectedSkills(message.skills);
    }
  }, [message.skills]);

  const toggleSkill = (skill: string) => {
    if (isConfirmed) return;
    setSelectedSkills((prev) =>
      prev.includes(skill) ? prev.filter((s) => s !== skill) : [...prev, skill],
    );
  };

  const addCustomSkill = () => {
    if (!newSkill.trim() || isConfirmed) return;
    const skill = newSkill.trim();
    if (!availableSkills.includes(skill)) {
      setAvailableSkills((prev) => [...prev, skill]);
      setSelectedSkills((prev) => [...prev, skill]);
    }
    setNewSkill("");
  };

  const handleConfirm = async () => {
    setIsConfirming(true);
    try {
      if (onSkillSelect) {
        await onSkillSelect(selectedSkills);
      }
      setIsConfirmed(true);
    } catch (e) {
      console.error(e);
      // alert is fine for now but could be a toast
    } finally {
      setIsConfirming(false);
    }
  };

  return (
    <div
      className={`flex gap-4 ${isAgent ? "justify-start" : "justify-end"} mb-6 animate-in fade-in slide-in-from-bottom-3 duration-500`}
    >
      {/* Avatar (Agent only) */}
      {isAgent && (
        <div className="flex-shrink-0 mt-1">
          <div className="w-8 h-8 sm:w-11 sm:h-11 bg-primary-600 rounded-xl sm:rounded-2xl flex items-center justify-center shadow-premium ring-2 sm:ring-4 ring-primary-50">
            <Bot className="w-4 h-4 sm:w-6 sm:h-6 text-white" />
          </div>
        </div>
      )}

      {/* Message Content Container */}
      <div
        className={`max-w-[85%] sm:max-w-[80%] ${!isAgent && "flex flex-col items-end"}`}
      >
        {/* Message Bubble Overlay */}
        <div
          className={`relative px-4 sm:px-6 py-3 sm:py-5 rounded-2xl sm:rounded-3xl shadow-sm ${isAgent
              ? "bg-white text-surface-900 rounded-tl-none border border-surface-200"
              : "bg-surface-900 text-white rounded-tr-none shadow-premium font-medium"
            }`}
        >
          {/* Saniya Persona indicator */}
          {isAgent && (
            <div className="flex items-center gap-1 sm:gap-1.5 mb-1.5 sm:mb-2 text-[9px] sm:text-[10px] uppercase tracking-widest font-bold text-primary-600">
              <ShieldCheck className="w-2.5 h-2.5 sm:w-3 sm:h-3" />
              Jd Assistant
            </div>
          )}

          <div className="text-[14px] sm:text-[15px] leading-[1.5] sm:leading-[1.6] whitespace-pre-wrap min-h-[1.5em] flex flex-col">
            {displayText ? (
              displayText.trim().replace(/\n{3,}/g, "\n\n")
            ) : message.isStreaming ? (
              <div className="flex items-center gap-2 text-surface-400 py-1">
                <div className="flex gap-1">
                  <span className="w-1.5 h-1.5 bg-primary-400 rounded-full animate-bounce [animation-delay:-0.3s]" />
                  <span className="w-1.5 h-1.5 bg-primary-400 rounded-full animate-bounce [animation-delay:-0.15s]" />
                  <span className="w-1.5 h-1.5 bg-primary-400 rounded-full animate-bounce" />
                </div>
                <span className="text-[10px] font-bold uppercase tracking-widest ml-1">Thinking...</span>
              </div>
            ) : null}

            {message.isStreaming && displayText.length > 0 && isTyping && (
              <span className="inline-block w-1.5 h-4 bg-primary-500 animate-pulse ml-1 align-middle" />
            )}
          </div>

          {/* Skill Selection UI */}
          {message.isSkillSelection && (
            <div className="mt-6 space-y-5 pt-5 border-t border-surface-100">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold uppercase tracking-wider text-surface-500">
                  Skills Identified
                </h4>
                <span className="text-[10px] text-surface-400">
                  {selectedSkills.length} selected
                </span>
              </div>

              {/* Skills Area */}
              <div className="flex flex-wrap gap-2 sm:gap-2.5">
                {availableSkills.map((skill) => {
                  const isSelected = selectedSkills.includes(skill);
                  return (
                    <button
                      key={skill}
                      disabled={isConfirmed}
                      onClick={() => toggleSkill(skill)}
                      className={`
                        group relative px-3 sm:px-5 py-2 sm:py-3 rounded-xl sm:rounded-2xl text-[13px] sm:text-sm font-semibold
                        transition-all duration-300 
                        ${isSelected
                          ? "bg-primary-600 text-white shadow-lg shadow-primary-500/20 scale-[1.03]"
                          : "bg-surface-50 text-surface-700 hover:bg-surface-100 border border-surface-200"
                        }
                        ${isConfirmed ? "opacity-60 cursor-not-allowed" : "active:scale-95"}
                      `}
                    >
                      <span className="flex items-center gap-1.5 sm:gap-2">
                        {isSelected && (
                          <Check className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                        )}
                        {skill}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Add Custom Skill / Actions */}
              {!isConfirmed && (
                <div className="mt-4 flex flex-col gap-2 sm:gap-3">
                  <div className="flex gap-1.5 sm:gap-2">
                    <input
                      type="text"
                      value={newSkill}
                      onChange={(e) => setNewSkill(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && addCustomSkill()}
                      placeholder="Specify another skill..."
                      className="flex-1 px-3 sm:px-5 py-2.5 sm:py-3.5 bg-surface-50 border border-surface-200 rounded-xl sm:rounded-2xl text-[13px] sm:text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all placeholder:text-surface-400"
                    />
                    <button
                      onClick={addCustomSkill}
                      className="px-4 sm:px-6 py-2.5 sm:py-3.5 bg-surface-100 hover:bg-surface-200 text-surface-700 rounded-xl sm:rounded-2xl text-[13px] sm:text-sm font-bold transition-all border border-surface-200 active:scale-95 flex items-center gap-1 sm:gap-2 shrink-0"
                    >
                      <Plus className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                      Add
                    </button>
                  </div>

                  <button
                    onClick={handleConfirm}
                    disabled={selectedSkills.length === 0 || isConfirming}
                    className="w-full py-3 sm:py-4 bg-primary-600 text-white rounded-xl sm:rounded-2xl text-[14px] sm:text-[15px] font-bold hover:bg-primary-700 transition-all shadow-xl shadow-primary-500/20 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 mt-2 sm:mt-0"
                  >
                    {isConfirming ? (
                      <Loader2 className="w-4 h-4 sm:w-5 sm:h-5 animate-spin" />
                    ) : (
                      <Check className="w-4 h-4 sm:w-5 sm:h-5 font-bold" />
                    )}
                    {isConfirming ? "Updating Skills..." : "Confirm Skills"}
                  </button>
                </div>
              )}

              {isConfirmed && (
                <div className="mt-2 flex items-center gap-2.5 text-accent-500 bg-accent-50/50 p-3 rounded-xl border border-accent-50">
                  <Check className="w-4 h-4" />
                  <span className="text-sm font-bold uppercase tracking-wide">
                    Skills Confirmed
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Ready to Generate JD UI — ONLY if not also showing skills */}
          {message.isReadySelection && !message.isSkillSelection && (
            <div className="mt-6 space-y-3 pt-6 border-t border-surface-100">
              {!isReadyActionTaken ? (
                <>
                  <button
                    onClick={() => {
                      setIsReadyActionTaken(true);
                      onGenerateJD?.();
                    }}
                    className="w-full py-3 sm:py-4.5 bg-gradient-to-br from-primary-600 to-primary-800 text-white rounded-xl sm:rounded-2xl text-[14px] sm:text-[15px] font-bold hover:shadow-2xl transition-all shadow-xl active:scale-[0.98] flex items-center justify-center gap-2 sm:gap-2.5 group"
                  >
                    <Sparkles className="w-4 h-4 sm:w-5 sm:h-5 group-hover:rotate-12 transition-transform" />
                    Generate JD
                  </button>
                  <button
                    onClick={() => {
                      setIsReadyActionTaken(true);
                      onContinue?.();
                    }}
                    className="w-full py-3 sm:py-4 bg-white text-surface-700 border-2 border-surface-200 rounded-xl sm:rounded-2xl text-[13px] sm:text-[14px] font-bold hover:bg-surface-50 hover:border-surface-300 transition-all active:scale-[0.98] flex items-center justify-center gap-1.5 sm:gap-2"
                  >
                    <ArrowRight className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                    Continue
                  </button>
                </>
              ) : (
                <div className="flex items-center justify-center gap-3 p-4 bg-surface-50 rounded-2xl border border-surface-100">
                  <div className="w-2.5 h-2.5 bg-primary-500 rounded-full animate-pulse" />
                  <span className="text-sm font-bold text-surface-500 uppercase tracking-widest">
                    Generating JD...
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Timestamp / Sender Detail */}
        <div
          className={`mt-2 px-2 text-[10px] font-bold uppercase tracking-widest text-surface-400 ${!isAgent && "text-right"}`}
        >
          {isAgent ? "Saniya • Insight Delivered" : "Recorded"}
        </div>
      </div>

      {/* Avatar (User only) */}
      {!isAgent && (
        <div className="flex-shrink-0 mt-1">
          <div className="w-8 h-8 sm:w-11 sm:h-11 bg-surface-100 rounded-xl sm:rounded-2xl flex items-center justify-center shadow-sm border border-surface-200">
            <User className="w-4 h-4 sm:w-6 sm:h-6 text-surface-600" />
          </div>
        </div>
      )}
    </div>
  );
}
