"use client";

import { useState } from "react";
import { Plus, X, Check } from "lucide-react";

interface SkillSelectorProps {
  initialSkills: string[];
  onChange: (skills: string[]) => void;
}

export default function SkillSelector({
  initialSkills,
  onChange,
}: SkillSelectorProps) {
  const [skills, setSkills] = useState<string[]>(initialSkills);
  const [newSkill, setNewSkill] = useState("");

  const handleAddSkill = () => {
    if (newSkill.trim() && !skills.includes(newSkill.trim())) {
      const updated = [...skills, newSkill.trim()];
      setSkills(updated);
      onChange(updated);
      setNewSkill("");
    }
  };

  const handleRemoveSkill = (skillToRemove: string) => {
    const updated = skills.filter((s) => s !== skillToRemove);
    setSkills(updated);
    onChange(updated);
  };

  return (
    <div className="bg-white rounded-2xl border border-neutral-200 p-6 shadow-sm">
      <h3 className="text-lg font-semibold text-neutral-900 mb-4">
        Select & Add Skills
      </h3>

      <div className="flex flex-wrap gap-2 mb-6">
        {skills.map((skill) => (
          <div
            key={skill}
            className="flex items-center gap-2 px-4 py-2 bg-primary-50 text-primary-900 border border-primary-100 rounded-full group transition-all hover:border-primary-300"
          >
            <span className="text-sm font-medium">{skill}</span>
            <button
              onClick={() => handleRemoveSkill(skill)}
              className="text-primary-400 group-hover:text-primary-600 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ))}
        {skills.length === 0 && (
          <p className="text-sm text-neutral-500 italic">
            No skills selected. Add some below!
          </p>
        )}
      </div>

      <div className="flex gap-2">
        <div className="relative flex-1">
          <input
            type="text"
            value={newSkill}
            onChange={(e) => setNewSkill(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAddSkill()}
            placeholder="Add extra skill (e.g. AWS, Teamwork)..."
            className="w-full px-4 py-2.5 bg-neutral-50 border border-neutral-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all"
          />
        </div>
        <button
          onClick={handleAddSkill}
          disabled={!newSkill.trim()}
          className="px-4 py-2.5 bg-neutral-900 text-white rounded-xl text-sm font-medium hover:bg-neutral-800 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Add
        </button>
      </div>
    </div>
  );
}
