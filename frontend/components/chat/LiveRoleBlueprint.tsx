"use client";

import { useState } from "react";
import { ListChecks, Wrench, Cpu, ChevronRight, ChevronLeft, Sparkles, CheckCircle2 } from "lucide-react";
import { EmployeeRoleInsights } from "@/types/jd-agent";

export default function LiveRoleBlueprint({
  insights,
  currentAgent,
}: {
  insights: EmployeeRoleInsights | null;
  currentAgent?: string;
}) {
  const [isCollapsed, setIsCollapsed] = useState(false);

  if (!insights) return null;

  const tasks = (insights.tasks || []).map((t) =>
    typeof t === "string" ? t : t.description
  );
  const priorityTasks = insights.priority_tasks || [];
  const tools = insights.tools || [];
  const skills = insights.skills || [];

  const totalCount = tasks.length + tools.length + skills.length;

  if (isCollapsed) {
    return (
      <button
        onClick={() => setIsCollapsed(false)}
        className="fixed right-0 top-24 z-30 bg-white border-l border-y border-surface-200 rounded-l-lg shadow-lg p-2.5 hover:bg-surface-50 transition-all flex items-center gap-2 group"
        title="Open Live Role Blueprint"
      >
        <ChevronLeft className="w-4 h-4 text-surface-500 group-hover:text-primary-600" />
        <div className="flex items-center gap-1.5 text-xs font-semibold text-primary-600">
          <Sparkles className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Blueprint ({totalCount})</span>
        </div>
      </button>
    );
  }

  return (
    <div className="w-72 sm:w-80 bg-white border-l border-surface-200 flex flex-col h-full shrink-0 shadow-sm animate-in slide-in-from-right duration-300">
      {/* Header */}
      <div className="p-4 border-b border-surface-100 flex items-center justify-between bg-surface-50">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-primary-600 rounded-md flex items-center justify-center shadow-sm">
            <Sparkles className="w-3.5 h-3.5 text-white" />
          </div>
          <div>
            <h4 className="text-xs font-bold text-surface-900 uppercase tracking-wider">
              Live Role Blueprint
            </h4>
            <p className="text-[10px] text-surface-500 font-medium">
              Extracted real-time insights
            </p>
          </div>
        </div>
        <button
          onClick={() => setIsCollapsed(true)}
          className="p-1 text-surface-400 hover:text-surface-600 rounded hover:bg-surface-200/50"
          title="Collapse Blueprint"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* Extracted Sections */}
      <div className="flex-1 overflow-y-auto p-4 space-y-5 text-xs">
        {/* 📋 Tasks Section */}
        <div>
          <div className="flex items-center justify-between text-surface-600 font-semibold mb-2">
            <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-surface-500">
              <ListChecks className="w-3.5 h-3.5 text-primary-500" />
              Responsibilities ({tasks.length})
            </span>
          </div>

          {tasks.length > 0 ? (
            <div className="space-y-1.5">
              {tasks.slice(0, 5).map((t, i) => {
                const isPriority = priorityTasks.includes(t);
                return (
                  <div
                    key={i}
                    className={`p-2 rounded border leading-tight ${
                      isPriority
                        ? "bg-primary-50 border-primary-200 text-primary-900 font-medium"
                        : "bg-surface-50 border-surface-200 text-surface-700"
                    }`}
                  >
                    {isPriority && (
                      <span className="text-[9px] font-bold text-primary-600 block uppercase tracking-wider mb-0.5">
                        ★ Priority Task
                      </span>
                    )}
                    {t}
                  </div>
                );
              })}
              {tasks.length > 5 && (
                <p className="text-[10px] text-surface-400 font-medium text-center pt-1">
                  + {tasks.length - 5} more tasks captured
                </p>
              )}
            </div>
          ) : (
            <p className="text-[11px] text-surface-400 italic bg-surface-50 p-2.5 rounded border border-dashed border-surface-200">
              Tasks will appear as you answer...
            </p>
          )}
        </div>

        {/* 🛠️ Tools Section */}
        <div>
          <div className="flex items-center justify-between text-surface-600 font-semibold mb-2">
            <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-surface-500">
              <Wrench className="w-3.5 h-3.5 text-primary-500" />
              Tools & Software ({tools.length})
            </span>
          </div>

          {tools.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {tools.map((tool, i) => (
                <span
                  key={i}
                  className="px-2.5 py-1 bg-surface-100 border border-surface-200 text-surface-800 rounded text-[11px] font-medium"
                >
                  {tool}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-[11px] text-surface-400 italic bg-surface-50 p-2.5 rounded border border-dashed border-surface-200">
              Technical tools captured during Tools phase...
            </p>
          )}
        </div>

        {/* 🧠 Skills Section */}
        <div>
          <div className="flex items-center justify-between text-surface-600 font-semibold mb-2">
            <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-surface-500">
              <Cpu className="w-3.5 h-3.5 text-primary-500" />
              Technical Skills ({skills.length})
            </span>
          </div>

          {skills.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {skills.map((skill, i) => (
                <span
                  key={i}
                  className="px-2.5 py-1 bg-violet-50 border border-violet-200 text-violet-800 rounded text-[11px] font-medium"
                >
                  {skill}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-[11px] text-surface-400 italic bg-surface-50 p-2.5 rounded border border-dashed border-surface-200">
              Skills captured during Technical phase...
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
