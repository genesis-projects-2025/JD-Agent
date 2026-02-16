import { useState } from "react";
import { Message } from "../../types/message";

export default function MessageBubble({
  message,
  onSkillSelect,
}: {
  message: Message;
  onSkillSelect?: (selectedSkills: string[]) => void;
}) {
  const isAgent = message.sender === "agent";
  const [selectedSkills, setSelectedSkills] = useState<string[]>(
    message.skills || [],
  );
  const [isConfirmed, setIsConfirmed] = useState(false);

  const toggleSkill = (skill: string) => {
    if (isConfirmed) return;
    setSelectedSkills((prev) =>
      prev.includes(skill) ? prev.filter((s) => s !== skill) : [...prev, skill],
    );
  };

  const handleConfirm = () => {
    setIsConfirmed(true);
    if (onSkillSelect) {
      onSkillSelect(selectedSkills);
    }
  };

  return (
    <div className={`mb-4 flex ${isAgent ? "justify-start" : "justify-end"}`}>
      <div
        className={`max-w-[85%] px-4 py-3 rounded-2xl shadow-sm ${
          isAgent
            ? "bg-zinc-100 text-zinc-800 rounded-tl-none border border-zinc-200"
            : "bg-zinc-900 text-white rounded-tr-none"
        }`}
      >
        <p className="text-sm md:text-base leading-relaxed whitespace-pre-wrap">
          {message.text}
        </p>

        {message.isSkillSelection && message.skills && (
          <div className="mt-4 space-y-3">
            <div className="flex flex-wrap gap-2">
              {message.skills.map((skill) => (
                <button
                  key={skill}
                  disabled={isConfirmed}
                  onClick={() => toggleSkill(skill)}
                  className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all ${
                    selectedSkills.includes(skill)
                      ? "bg-zinc-900 text-white"
                      : "bg-white text-zinc-600 border border-zinc-200 hover:border-zinc-400"
                  } ${isConfirmed ? "opacity-70 cursor-not-allowed" : "active:scale-95"}`}
                >
                  {skill}
                </button>
              ))}
            </div>
            {!isConfirmed && (
              <button
                onClick={handleConfirm}
                className="w-full py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 transition-colors shadow-sm"
              >
                Confirm Selected Skills
              </button>
            )}
            {isConfirmed && (
              <p className="text-xs text-zinc-500 italic">Skills confirmed</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
