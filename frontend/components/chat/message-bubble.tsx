import { useState } from "react";
import { Message } from "../../types/message";

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
      className={`mb-6 flex ${isAgent ? "justify-start" : "justify-end"} animate-in fade-in slide-in-from-bottom-3 duration-500`}
    >
      <div
        className={`max-w-[85%] px-5 py-4 rounded-3xl shadow-xl transition-all ${
          isAgent
            ? "bg-white text-zinc-800 rounded-tl-none border border-zinc-100 ring-1 ring-black/5"
            : "bg-zinc-900 text-white rounded-tr-none shadow-zinc-200"
        }`}
      >
        <p className="text-sm md:text-base font-medium leading-relaxed whitespace-pre-wrap">
          {message.text}
        </p>

        {message.isSkillSelection && (
          <div className="mt-6 space-y-5">
            <div className="flex flex-wrap gap-2.5">
              {availableSkills.map((skill) => {
                const isSelected = selectedSkills.includes(skill);
                return (
                  <button
                    key={skill}
                    disabled={isConfirmed}
                    onClick={() => toggleSkill(skill)}
                    className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all duration-300 ${
                      isSelected
                        ? "bg-zinc-900 text-white shadow-lg ring-1 ring-zinc-900"
                        : "bg-zinc-50 text-zinc-500 border border-zinc-200 hover:border-zinc-400 hover:text-zinc-800"
                    } ${isConfirmed ? "opacity-70 cursor-block" : "active:scale-95 hover:shadow-md"}`}
                  >
                    {skill}
                    {isSelected && !isConfirmed && (
                      <span className="ml-2 opacity-60 hover:opacity-100 text-[10px]">
                        ✕
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {!isConfirmed && (
              <div className="space-y-4 pt-4 border-t border-zinc-100">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newSkill}
                    onChange={(e) => setNewSkill(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && addCustomSkill()}
                    placeholder="Type a skill..."
                    className="flex-1 px-4 py-2.5 bg-zinc-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:bg-white transition-all shadow-inner"
                  />
                  <button
                    onClick={addCustomSkill}
                    className="px-4 py-2.5 bg-zinc-100 text-zinc-700 rounded-xl text-sm font-bold hover:bg-zinc-200 active:scale-95 transition-all border border-zinc-200"
                  >
                    + Add
                  </button>
                </div>

                <button
                  onClick={handleConfirm}
                  className="w-full py-3.5 bg-zinc-900 text-white rounded-xl text-sm font-black hover:bg-black transition-all shadow-2xl shadow-zinc-300 active:scale-[0.97] uppercase tracking-wider"
                >
                  Confirm & Continue Interview
                </button>
              </div>
            )}

            {isConfirmed && (
              <div className="pt-4 border-t border-zinc-50 flex items-center gap-2 text-zinc-400 text-xs font-bold uppercase tracking-widest">
                <div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
                Skills Locked
              </div>
            )}
          </div>
        )}

        {message.isReadySelection && (
          <div className="mt-6 space-y-4 pt-4 border-t border-zinc-100">
            {!isReadyActionTaken ? (
              <div className="flex flex-col gap-3">
                <button
                  onClick={() => {
                    setIsReadyActionTaken(true);
                    onGenerateJD?.();
                  }}
                  className="w-full py-4 bg-zinc-900 text-white rounded-2xl text-sm font-black hover:bg-black transition-all shadow-xl shadow-zinc-200 active:scale-[0.98] flex items-center justify-center gap-2"
                >
                  <span>✨</span> Finish & Generate JD
                </button>
                <button
                  onClick={() => {
                    setIsReadyActionTaken(true);
                    onContinue?.();
                  }}
                  className="w-full py-3 bg-white text-zinc-600 border border-zinc-200 rounded-2xl text-sm font-bold hover:bg-zinc-50 hover:border-zinc-300 transition-all active:scale-[0.98] flex items-center justify-center gap-2"
                >
                  <span>💬</span> I have more to add
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-zinc-400 text-xs font-bold uppercase tracking-widest">
                <div className="w-1.5 h-1.5 bg-zinc-300 rounded-full" />
                Action Processed
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
