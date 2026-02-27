// components/chat/message-bubble.tsx - ENTERPRISE REDESIGN

import { useState } from "react";
import { Message } from "../../types/message";
import {
  Bot,
  User,
  Check,
  Plus,
  Sparkles,
  ArrowRight,
  ShieldCheck,
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
  const [isReadyActionTaken, setIsReadyActionTaken] = useState(false);

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

  const handleConfirm = () => {
    setIsConfirmed(true);
    if (onSkillSelect) {
      onSkillSelect(selectedSkills);
    }
  };

  return (
    <div
      className={`flex gap-4 ${isAgent ? "justify-start" : "justify-end"} mb-6 animate-in fade-in slide-in-from-bottom-3 duration-500`}
    >
      {/* Avatar (Agent only) */}
      {isAgent && (
        <div className="flex-shrink-0 mt-1">
          <div className="w-11 h-11 bg-primary-600 rounded-2xl flex items-center justify-center shadow-premium ring-4 ring-primary-50">
            <Bot className="w-6 h-6 text-white" />
          </div>
        </div>
      )}

      {/* Message Content Container */}
      <div className={`max-w-[80%] ${!isAgent && "flex flex-col items-end"}`}>
        {/* Message Bubble Overlay */}
        <div
          className={`relative px-6 py-5 rounded-3xl shadow-sm ${
            isAgent
              ? "bg-white text-surface-900 rounded-tl-none border border-surface-200"
              : "bg-surface-900 text-white rounded-tr-none shadow-premium font-medium"
          }`}
        >
          {/* Saniya Persona indicator */}
          {isAgent && (
            <div className="flex items-center gap-1.5 mb-2 text-[10px] uppercase tracking-widest font-bold text-primary-600">
              <ShieldCheck className="w-3 h-3" />
              Saniya • AI HR Specialist
            </div>
          )}

          <p className="text-[16px] leading-[1.6] whitespace-pre-wrap">
            {message.text.trim().replace(/\n{3,}/g, "\n\n")}
          </p>

          {/* Skill Selection UI */}
          {message.isSkillSelection && (
            <div className="mt-6 space-y-5 pt-5 border-t border-surface-100">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold uppercase tracking-wider text-surface-500">
                  Core Competencies Identified
                </h4>
                <span className="text-[10px] text-surface-400">
                  {selectedSkills.length} selected
                </span>
              </div>

              {/* Skills Area */}
              <div className="flex flex-wrap gap-2.5">
                {availableSkills.map((skill) => {
                  const isSelected = selectedSkills.includes(skill);
                  return (
                    <button
                      key={skill}
                      disabled={isConfirmed}
                      onClick={() => toggleSkill(skill)}
                      className={`
                        group relative px-5 py-3 rounded-2xl text-sm font-semibold
                        transition-all duration-300 
                        ${
                          isSelected
                            ? "bg-primary-600 text-white shadow-lg shadow-primary-500/20 scale-[1.03]"
                            : "bg-surface-50 text-surface-700 hover:bg-surface-100 border border-surface-200"
                        }
                        ${isConfirmed ? "opacity-60 cursor-not-allowed" : "active:scale-95"}
                      `}
                    >
                      <span className="flex items-center gap-2">
                        {isSelected && <Check className="w-4 h-4" />}
                        {skill}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Add Custom Skill / Actions */}
              {!isConfirmed && (
                <div className="mt-4 flex flex-col gap-3">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newSkill}
                      onChange={(e) => setNewSkill(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && addCustomSkill()}
                      placeholder="Specify another skill..."
                      className="flex-1 px-5 py-3.5 bg-surface-50 border border-surface-200 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all placeholder:text-surface-400"
                    />
                    <button
                      onClick={addCustomSkill}
                      className="px-6 py-3.5 bg-surface-100 hover:bg-surface-200 text-surface-700 rounded-2xl text-sm font-bold transition-all border border-surface-200 active:scale-95 flex items-center gap-2"
                    >
                      <Plus className="w-4 h-4" />
                      Add
                    </button>
                  </div>

                  <button
                    onClick={handleConfirm}
                    disabled={selectedSkills.length === 0}
                    className="w-full py-4 bg-primary-600 text-white rounded-2xl text-[15px] font-bold hover:bg-primary-700 transition-all shadow-xl shadow-primary-500/20 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    <Check className="w-5 h-5 font-bold" />
                    Confirm Competencies
                  </button>
                </div>
              )}

              {isConfirmed && (
                <div className="mt-2 flex items-center gap-2.5 text-accent-500 bg-accent-50/50 p-3 rounded-xl border border-accent-50">
                  <Check className="w-4 h-4" />
                  <span className="text-sm font-bold uppercase tracking-wide">
                    Selection Optimized
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Ready to Generate JD UI */}
          {message.isReadySelection &&
            (!message.isSkillSelection || isConfirmed) && (
              <div className="mt-6 space-y-3 pt-6 border-t border-surface-100">
                {!isReadyActionTaken ? (
                  <>
                    <button
                      onClick={() => {
                        setIsReadyActionTaken(true);
                        onGenerateJD?.();
                      }}
                      className="w-full py-4.5 bg-gradient-to-br from-primary-600 to-primary-800 text-white rounded-2xl text-[15px] font-bold hover:shadow-2xl transition-all shadow-xl active:scale-[0.98] flex items-center justify-center gap-2.5 group"
                    >
                      <Sparkles className="w-5 h-5 group-hover:rotate-12 transition-transform" />
                      Generate Enterprise JD
                    </button>
                    <button
                      onClick={() => {
                        setIsReadyActionTaken(true);
                        onContinue?.();
                      }}
                      className="w-full py-4 bg-white text-surface-700 border-2 border-surface-200 rounded-2xl text-[14px] font-bold hover:bg-surface-50 hover:border-surface-300 transition-all active:scale-[0.98] flex items-center justify-center gap-2"
                    >
                      <ArrowRight className="w-4 h-4" />
                      Continue Interview
                    </button>
                  </>
                ) : (
                  <div className="flex items-center justify-center gap-3 p-4 bg-surface-50 rounded-2xl border border-surface-100">
                    <div className="w-2.5 h-2.5 bg-primary-500 rounded-full animate-pulse" />
                    <span className="text-sm font-bold text-surface-500 uppercase tracking-widest">
                      Architecting Document...
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
          <div className="w-11 h-11 bg-surface-100 rounded-2xl flex items-center justify-center shadow-sm border border-surface-200">
            <User className="w-6 h-6 text-surface-600" />
          </div>
        </div>
      )}
    </div>
  );
}
