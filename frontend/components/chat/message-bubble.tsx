// components/chat/message-bubble.tsx - IMPROVED VERSION

import { useState } from "react";
import { Message } from "../../types/message";
import { Bot, User, Check, X, Plus, Sparkles, ArrowRight } from "lucide-react";

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
      className={`flex gap-3 ${isAgent ? "justify-start" : "justify-end"} animate-in fade-in slide-in-from-bottom-2 duration-300`}
    >
      {/* Avatar (Agent only) */}
      {isAgent && (
        <div className="flex-shrink-0">
          <div className="w-10 h-10 bg-gradient-to-br from-primary-500 to-primary-600 rounded-xl flex items-center justify-center shadow-lg ring-2 ring-primary-100">
            <Bot className="w-5 h-5 text-black" />
          </div>
        </div>
      )}

      {/* Message Content */}
      <div className={`max-w-[75%] ${!isAgent && "flex flex-col items-end"}`}>
        {/* Message Bubble */}
        <div
          className={`px-5 py-4 rounded-2xl shadow-lg ${
            isAgent
              ? "bg-white text-black rounded-tl-none border border-neutral-200"
              : "bg-gradient-to-br from-primary-600 to-primary-700 text-black rounded-tr-none shadow-primary-900/20"
          }`}
        >
          <p className="text-[15px] leading-relaxed whitespace-pre-wrap text-black">
            {message.text}
          </p>

          {/* Skill Selection UI */}
          {message.isSkillSelection && (
            <div className="mt-5 space-y-4">
              {/* Skills Grid */}
              <div className="flex flex-wrap gap-2">
                {availableSkills.map((skill) => {
                  const isSelected = selectedSkills.includes(skill);
                  return (
                    <button
                      key={skill}
                      disabled={isConfirmed}
                      onClick={() => toggleSkill(skill)}
                      className={`
                        group relative px-4 py-2.5 rounded-xl text-sm font-medium
                        transition-all duration-200 
                        ${
                          isSelected
                            ? "bg-gradient-to-r from-primary-600 to-primary-700 text-blue-700 shadow-lg shadow-primary-900/20 scale-105"
                            : "bg-neutral-100 text-black hover:bg-neutral-200 border border-neutral-200"
                        }
                        ${isConfirmed ? "opacity-70 cursor-not-allowed" : "active:scale-95"}
                      `}
                    >
                      <span className="flex items-center gap-2">
                        {isSelected && <Check className="w-3.5 h-3.5" />}
                        {skill}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Add Custom Skill */}
              {!isConfirmed && (
                <div className="pt-4 border-t border-neutral-200 space-y-3">
                  <div className="flex gap-2">
                    <div className="flex-1 relative">
                      <input
                        type="text"
                        value={newSkill}
                        onChange={(e) => setNewSkill(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && addCustomSkill()}
                        placeholder="Add a custom skill..."
                        className="w-full px-4 py-3 bg-neutral-50 border border-neutral-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all placeholder:text-neutral-400"
                      />
                    </div>
                    <button
                      onClick={addCustomSkill}
                      className="px-4 py-3 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 rounded-xl text-sm font-medium transition-all active:scale-95 flex items-center gap-2 border border-neutral-200"
                    >
                      <Plus className="w-4 h-4" />
                      Add
                    </button>
                  </div>

                  {/* Confirm Button */}
                  <button
                    onClick={handleConfirm}
                    disabled={selectedSkills.length === 0}
                    className="w-full py-3.5 bg-gradient-to-r from-primary-600 to-primary-700 text-black rounded-xl text-sm font-semibold hover:from-primary-700 hover:to-primary-800 transition-all shadow-lg shadow-primary-900/20 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    <Check className="w-4 h-4" />
                    Confirm Skills ({selectedSkills.length})
                  </button>
                </div>
              )}

              {/* Confirmed State */}
              {isConfirmed && (
                <div className="pt-3 border-t border-neutral-200 flex items-center gap-2 text-green-600">
                  <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                  <span className="text-sm font-medium">Skills confirmed</span>
                </div>
              )}
            </div>
          )}

          {/* Ready to Generate JD UI */}
          {message.isReadySelection && (
            <div className="mt-5 space-y-3 pt-4 border-t border-neutral-200">
              {!isReadyActionTaken ? (
                <>
                  <button
                    onClick={() => {
                      setIsReadyActionTaken(true);
                      onGenerateJD?.();
                    }}
                    className="w-full py-4 bg-gradient-to-r from-primary-600 to-primary-700 text-black rounded-xl text-sm font-semibold hover:from-primary-700 hover:to-primary-800 transition-all shadow-lg shadow-primary-900/20 active:scale-[0.98] flex items-center justify-center gap-2"
                  >
                    <Sparkles className="w-4 h-4" />
                    Generate Job Description
                  </button>
                  <button
                    onClick={() => {
                      setIsReadyActionTaken(true);
                      onContinue?.();
                    }}
                    className="w-full py-3.5 bg-white text-neutral-700 border-2 border-neutral-200 rounded-xl text-sm font-medium hover:bg-neutral-50 hover:border-neutral-300 transition-all active:scale-[0.98] flex items-center justify-center gap-2"
                  >
                    <ArrowRight className="w-4 h-4" />
                    Continue Interview
                  </button>
                </>
              ) : (
                <div className="flex items-center gap-2 text-neutral-500">
                  <div className="w-2 h-2 bg-neutral-400 rounded-full" />
                  <span className="text-sm font-medium">Processing...</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Timestamp */}
        <div
          className={`mt-1.5 px-1 text-xs text-neutral-400 ${!isAgent && "text-right"}`}
        >
          Just now
        </div>
      </div>

      {/* Avatar (User only) */}
      {!isAgent && (
        <div className="flex-shrink-0">
          <div className="w-10 h-10 bg-gradient-to-br from-neutral-600 to-neutral-700 rounded-xl flex items-center justify-center shadow-lg">
            <User className="w-5 h-5 text-white" />
          </div>
        </div>
      )}
    </div>
  );
}
