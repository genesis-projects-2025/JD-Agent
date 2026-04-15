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
  Wrench,
  Cpu,
  ListChecks,
} from "lucide-react";

export default function MessageBubble({
  message,
  onSkillSelect,
  onToolSelect,
  onPriorityTaskSelect,
  onGenerateJD,
  onContinue,
  isLast,
}: {
  message: Message;
  onSkillSelect?: (selectedSkills: string[]) => void;
  onToolSelect?: (selectedTools: string[]) => void;
  onPriorityTaskSelect?: (selectedTasks: string[]) => void;
  onGenerateJD?: () => void;
  onContinue?: () => void;
  isLast?: boolean;
}) {
  const isAgent = message.sender === "agent";

  // ── Skills State ──────────────────────────────────────────────────────────
  const [availableSkills, setAvailableSkills] = useState<string[]>(message.skills || []);
  const [selectedSkills, setSelectedSkills] = useState<string[]>(message.skills || []);
  const [newSkill, setNewSkill] = useState("");
  const [isSkillsConfirmed, setIsSkillsConfirmed] = useState(false);
  const [isSkillsConfirming, setIsSkillsConfirming] = useState(false);

  // ── Tools State ───────────────────────────────────────────────────────────
  const [availableTools, setAvailableTools] = useState<string[]>(message.tools || []);
  const [selectedTools, setSelectedTools] = useState<string[]>(message.tools || []);
  const [newTool, setNewTool] = useState("");
  const [isToolsConfirmed, setIsToolsConfirmed] = useState(false);
  const [isToolsConfirming, setIsToolsConfirming] = useState(false);

  // ── Priority Tasks State ──────────────────────────────────────────────────
  const normaliseTasks = (
    raw: Array<{ description: string; frequency?: string; category?: string } | string> | undefined
  ): string[] => {
    if (!raw) return [];
    return raw
      .map((t) => (typeof t === "string" ? t.trim() : t.description?.trim() ?? ""))
      .filter(Boolean);
  };

  const [availableTasks, setAvailableTasks] = useState<string[]>(() =>
    normaliseTasks(message.tasks)
  );
  const [selectedTasks, setSelectedTasks] = useState<string[]>(() =>
    normaliseTasks(message.tasks)
  );
  const [newTask, setNewTask] = useState("");
  const [isTasksConfirmed, setIsTasksConfirmed] = useState(false);
  const [isTasksConfirming, setIsTasksConfirming] = useState(false);

  const [isReadyActionTaken, setIsReadyActionTaken] = useState(false);

  // ── Typewriter effect state ───────────────────────────────────────────────
  const [displayText, setDisplayText] = useState(() =>
    !message.isStreaming ? message.text : ""
  );
  const [isTyping, setIsTyping] = useState(false);
  const fullText = message.text;
  const EFFECT_SPEED = 20;

  useEffect(() => {
    if (displayText.length < fullText.length) {
      setIsTyping(true);
      const timeout = setTimeout(() => {
        const gap = fullText.length - displayText.length;
        const charsToAdd = gap > 20 ? 5 : 1;
        setDisplayText(fullText.substring(0, displayText.length + charsToAdd));
      }, EFFECT_SPEED);
      return () => clearTimeout(timeout);
    } else {
      setIsTyping(false);
    }
  }, [displayText, fullText]);

  useEffect(() => {
    if (!message.isStreaming && displayText.length === 0 && fullText.length > 0) {
      setDisplayText(fullText);
    }
  }, [message.isStreaming, fullText]);

  // ── Sync props to state ───────────────────────────────────────────────────
  useEffect(() => {
    if (message.skills && message.skills.length > 0) {
      setAvailableSkills(message.skills);
      setSelectedSkills(message.skills);
    }
    if (message.tools && message.tools.length > 0) {
      setAvailableTools(message.tools);
      setSelectedTools(message.tools);
    }
    if (message.tasks && message.tasks.length > 0) {
      const normalised = normaliseTasks(message.tasks);
      setAvailableTasks(normalised);
      setSelectedTasks(normalised);
    }
  }, [message.skills, message.tools, message.tasks]);

  // ── Skills Handlers ───────────────────────────────────────────────────────
  const toggleSkill = (skill: string) => {
    if (isSkillsConfirmed) return;
    setSelectedSkills((prev) =>
      prev.includes(skill) ? prev.filter((s) => s !== skill) : [...prev, skill]
    );
  };

  const addCustomSkill = () => {
    if (!newSkill.trim() || isSkillsConfirmed) return;
    const skill = newSkill.trim();
    if (!availableSkills.includes(skill)) {
      setAvailableSkills((prev) => [...prev, skill]);
      setSelectedSkills((prev) => [...prev, skill]);
    }
    setNewSkill("");
  };

  const handleSkillsConfirm = async () => {
    setIsSkillsConfirming(true);
    try {
      if (onSkillSelect) await onSkillSelect(selectedSkills);
      setIsSkillsConfirmed(true);
    } finally {
      setIsSkillsConfirming(false);
    }
  };

  // ── Tools Handlers ────────────────────────────────────────────────────────
  const toggleTool = (tool: string) => {
    if (isToolsConfirmed) return;
    setSelectedTools((prev) =>
      prev.includes(tool) ? prev.filter((t) => t !== tool) : [...prev, tool]
    );
  };

  const addCustomTool = () => {
    if (!newTool.trim() || isToolsConfirmed) return;
    const tool = newTool.trim();
    if (!availableTools.includes(tool)) {
      setAvailableTools((prev) => [...prev, tool]);
      setSelectedTools((prev) => [...prev, tool]);
    }
    setNewTool("");
  };

  const handleToolsConfirm = async () => {
    setIsToolsConfirming(true);
    try {
      if (onToolSelect) await onToolSelect(selectedTools);
      setIsToolsConfirmed(true);
    } finally {
      setIsToolsConfirming(false);
    }
  };

  // ── Priority Tasks Handlers ───────────────────────────────────────────────
  const toggleTask = (task: string) => {
    if (isTasksConfirmed) return;
    setSelectedTasks((prev) =>
      prev.includes(task) ? prev.filter((t) => t !== task) : [...prev, task]
    );
  };

  const addCustomTask = () => {
    if (!newTask.trim() || isTasksConfirmed) return;
    const task = newTask.trim();
    if (!availableTasks.includes(task)) {
      setAvailableTasks((prev) => [...prev, task]);
      setSelectedTasks((prev) => [...prev, task]);
    }
    setNewTask("");
  };

  const handleTasksConfirm = async () => {
    if (selectedTasks.length < 1 || isTasksConfirming) return;
    setIsTasksConfirming(true);
    try {
      if (onPriorityTaskSelect) await onPriorityTaskSelect(selectedTasks);
      setIsTasksConfirmed(true);
    } finally {
      setIsTasksConfirming(false);
    }
  };

  return (
    <div
      className={`flex gap-4 ${isAgent ? "justify-start" : "justify-end"} mb-6 animate-in fade-in slide-in-from-bottom-3 duration-500`}
    >
      {isAgent && (
        <div className="flex-shrink-0 mt-1">
          <div className="w-8 h-8 sm:w-11 sm:h-11 bg-primary-600 rounded-lg sm:rounded-md flex items-center justify-center shadow-md ring-2 sm:ring-4 ring-primary-50">
            <Bot className="w-4 h-4 sm:w-6 sm:h-6 text-white" />
          </div>
        </div>
      )}

      <div className={`max-w-[85%] sm:max-w-[80%] ${!isAgent && "flex flex-col items-end"}`}>
        <div
          className={`relative px-4 sm:px-6 py-2.5 sm:py-5 rounded-md sm:rounded-md shadow-sm ${
            isAgent
              ? "bg-white text-surface-900 rounded-tl-none border border-surface-200"
              : "bg-surface-900 text-white rounded-tr-none shadow-md font-medium"
          }`}
        >
          {isAgent && (
            <div className="flex items-center gap-1.5 sm:gap-1.5 mb-1.5 sm:mb-2 text-[9px] sm:text-[10px] font-medium text-primary-600">
              <ShieldCheck className="w-2.5 h-2.5 sm:w-3 sm:h-3" />
              Saniya {message.currentAgent ? `• ${message.currentAgent.replace("Agent", "")}` : ""}
            </div>
          )}

          <div className="text-[14px] sm:text-[15px] leading-[1.5] sm:leading-[1.6] whitespace-pre-wrap min-h-[1.5em] flex flex-col">
            {displayText ? (
              displayText.trim().replace(/\n{3,}/g, "\n\n")
            ) : message.isStreaming ? (
              <div className="flex items-center gap-2 text-surface-400 py-1">
                <div className="flex gap-1">
                  <span className="w-1.5 h-1.5 bg-primary-400 rounded-md animate-bounce [animation-delay:-0.3s]" />
                  <span className="w-1.5 h-1.5 bg-primary-400 rounded-md animate-bounce [animation-delay:-0.15s]" />
                  <span className="w-1.5 h-1.5 bg-primary-400 rounded-md animate-bounce" />
                </div>
                <span className="text-[10px] font-medium ml-1">Thinking...</span>
              </div>
            ) : null}
            {message.isStreaming && displayText.length > 0 && isTyping && (
              <span className="inline-block w-1.5 h-4 bg-primary-500 animate-pulse ml-1 align-middle" />
            )}
          </div>

          {/* ── PRIORITY TASK SELECTION UI ──────────────────────────────── */}
          {message.isPrioritySelection && availableTasks.length > 0 && (
            <div className="mt-6 space-y-5 pt-5 border-t border-surface-100">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ListChecks className="w-4 h-4 text-primary-500" />
                  <h4 className="text-xs font-semibold tracking-wider text-surface-600 uppercase">
                    Priority Tasks
                  </h4>
                </div>
                <span className="text-[10px] font-medium text-surface-400">
                  {selectedTasks.length} selected
                </span>
              </div>

              <p className="text-[11px] text-surface-500 leading-relaxed">
                Select the 3–5 most critical, high-impact tasks from your role. These will be deep-dived for the Job Description.
              </p>

              <div className="flex flex-col gap-2">
                {availableTasks.map((task, idx) => {
                  const isSelected = selectedTasks.includes(task);
                  return (
                    <button
                      key={task + idx}
                      disabled={isTasksConfirmed}
                      onClick={() => toggleTask(task)}
                      className={`flex items-start gap-3 px-3 py-3 rounded-md text-[12px] font-medium text-left transition-all duration-200 border ${
                        isSelected
                          ? "bg-primary-50 text-primary-900 border-primary-300 shadow-sm"
                          : "bg-surface-50 text-surface-700 border-surface-200 hover:bg-surface-100"
                      } ${isTasksConfirmed ? "opacity-60 cursor-not-allowed" : "active:scale-[0.99]"}`}
                    >
                      <div
                        className={`flex-shrink-0 w-4 h-4 mt-0.5 rounded border transition-all ${
                          isSelected
                            ? "bg-primary-600 border-primary-600 flex items-center justify-center"
                            : "border-surface-300 bg-white"
                        }`}
                      >
                        {isSelected && <Check className="w-2.5 h-2.5 text-white" />}
                      </div>
                      <span className="leading-relaxed">{task}</span>
                    </button>
                  );
                })}
              </div>

              {!isTasksConfirmed && (
                <div className="mt-4 space-y-3">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newTask}
                      onChange={(e) => setNewTask(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && addCustomTask()}
                      placeholder="Add a missing task..."
                      className="flex-1 px-4 py-2.5 bg-surface-50 border border-surface-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 placeholder:text-surface-400"
                    />
                    <button
                      onClick={addCustomTask}
                      className="px-4 py-2.5 bg-surface-100 hover:bg-surface-200 text-surface-700 rounded-md text-sm font-medium border border-surface-200 transition-all flex items-center gap-1.5"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Add
                    </button>
                  </div>
                  <button
                    onClick={handleTasksConfirm}
                    disabled={selectedTasks.length < 1 || isTasksConfirming}
                    className="w-full py-3 bg-primary-600 text-white rounded-md text-sm font-semibold hover:bg-primary-700 transition-all shadow-md shadow-primary-500/10 disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {isTasksConfirming ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Check className="w-4 h-4" />
                    )}
                    {isTasksConfirming
                      ? "Confirming Tasks..."
                      : `Confirm ${selectedTasks.length} Priority Task${selectedTasks.length !== 1 ? "s" : ""}`}
                  </button>
                </div>
              )}

              {isTasksConfirmed && (
                <div className="mt-2 flex items-center gap-2.5 text-accent-600 bg-accent-50 p-3 rounded-md border border-accent-100">
                  <Check className="w-4 h-4" />
                  <span className="text-xs font-semibold uppercase tracking-wide">
                    Priority Tasks Confirmed — Starting Deep Dive
                  </span>
                </div>
              )}
            </div>
          )}

          {/* ── TOOL SELECTION UI ────────────────────────────────────────── */}
          {message.isToolSelection && (
            <div className="mt-6 space-y-5 pt-5 border-t border-surface-100">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Wrench className="w-4 h-4 text-primary-500" />
                  <h4 className="text-xs font-semibold tracking-wider text-surface-600 uppercase">
                    Tools & Technologies
                  </h4>
                </div>
                <span className="text-[10px] font-medium text-surface-400">
                  {selectedTools.length} selected
                </span>
              </div>

              <div className="flex flex-wrap gap-2">
                {availableTools.map((tool) => {
                  const isSelected = selectedTools.includes(tool);
                  return (
                    <button
                      key={tool}
                      disabled={isToolsConfirmed}
                      onClick={() => toggleTool(tool)}
                      className={`px-3 py-2 rounded-md text-[12px] font-semibold transition-all duration-200 border ${
                        isSelected
                          ? "bg-primary-600 text-white border-primary-600 shadow-sm"
                          : "bg-surface-50 text-surface-700 border-surface-200 hover:bg-surface-100"
                      } ${isToolsConfirmed ? "opacity-60 cursor-not-allowed" : "active:scale-95"}`}
                    >
                      <span className="flex items-center gap-1.5">
                        {isSelected && <Check className="w-3 h-3" />}
                        {tool}
                      </span>
                    </button>
                  );
                })}
              </div>

              {!isToolsConfirmed && (
                <div className="mt-4 space-y-3">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newTool}
                      onChange={(e) => setNewTool(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && addCustomTool()}
                      placeholder="Add another tool..."
                      className="flex-1 px-4 py-2.5 bg-surface-50 border border-surface-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 placeholder:text-surface-400"
                    />
                    <button
                      onClick={addCustomTool}
                      className="px-4 py-2.5 bg-surface-100 hover:bg-surface-200 text-surface-700 rounded-md text-sm font-medium border border-surface-200 transition-all flex items-center gap-1.5"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Add
                    </button>
                  </div>
                  <button
                    onClick={handleToolsConfirm}
                    disabled={selectedTools.length === 0 || isToolsConfirming}
                    className="w-full py-3 bg-primary-600 text-white rounded-md text-sm font-semibold hover:bg-primary-700 transition-all shadow-md shadow-primary-500/10 disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {isToolsConfirming ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Check className="w-4 h-4" />
                    )}
                    {isToolsConfirming ? "Confirming Tools..." : "Confirm Tool List"}
                  </button>
                </div>
              )}

              {isToolsConfirmed && (
                <div className="mt-2 flex items-center gap-2.5 text-accent-600 bg-accent-50 p-3 rounded-md border border-accent-100">
                  <Check className="w-4 h-4" />
                  <span className="text-xs font-semibold uppercase tracking-wide">Tools Confirmed</span>
                </div>
              )}
            </div>
          )}

          {/* ── SKILL SELECTION UI ───────────────────────────────────────── */}
          {message.isSkillSelection && (
            <div className="mt-6 space-y-5 pt-5 border-t border-surface-100">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Cpu className="w-4 h-4 text-primary-500" />
                  <h4 className="text-xs font-semibold tracking-wider text-surface-600 uppercase">
                    Technical Expertise
                  </h4>
                </div>
                <span className="text-[10px] font-medium text-surface-400">
                  {selectedSkills.length} selected
                </span>
              </div>

              <div className="flex flex-wrap gap-2">
                {availableSkills.map((skill) => {
                  const isSelected = selectedSkills.includes(skill);
                  return (
                    <button
                      key={skill}
                      disabled={isSkillsConfirmed}
                      onClick={() => toggleSkill(skill)}
                      className={`px-3 py-2 rounded-md text-[12px] font-semibold transition-all duration-200 border ${
                        isSelected
                          ? "bg-primary-600 text-white border-primary-600 shadow-sm"
                          : "bg-surface-50 text-surface-700 border-surface-200 hover:bg-surface-100"
                      } ${isSkillsConfirmed ? "opacity-60 cursor-not-allowed" : "active:scale-95"}`}
                    >
                      <span className="flex items-center gap-1.5">
                        {isSelected && <Check className="w-3 h-3" />}
                        {skill}
                      </span>
                    </button>
                  );
                })}
              </div>

              {!isSkillsConfirmed && (
                <div className="mt-4 space-y-3">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newSkill}
                      onChange={(e) => setNewSkill(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && addCustomSkill()}
                      placeholder="Add another skill..."
                      className="flex-1 px-4 py-2.5 bg-surface-50 border border-surface-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 placeholder:text-surface-400"
                    />
                    <button
                      onClick={addCustomSkill}
                      className="px-4 py-2.5 bg-surface-100 hover:bg-surface-200 text-surface-700 rounded-md text-sm font-medium border border-surface-200 transition-all flex items-center gap-1.5"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Add
                    </button>
                  </div>
                  <button
                    onClick={handleSkillsConfirm}
                    disabled={selectedSkills.length === 0 || isSkillsConfirming}
                    className="w-full py-3 bg-primary-600 text-white rounded-md text-sm font-semibold hover:bg-primary-700 transition-all shadow-md shadow-primary-500/10 disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {isSkillsConfirming ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Check className="w-4 h-4" />
                    )}
                    {isSkillsConfirming ? "Confirming Skills..." : "Confirm Skill List"}
                  </button>
                </div>
              )}

              {isSkillsConfirmed && (
                <div className="mt-2 flex items-center gap-2.5 text-accent-600 bg-accent-50 p-3 rounded-md border border-accent-100">
                  <Check className="w-4 h-4" />
                  <span className="text-xs font-semibold uppercase tracking-wide">Skills Confirmed</span>
                </div>
              )}
            </div>
          )}

          {/* ── Ready to Generate JD UI ───────────────────────────────────── */}
          {message.isReadySelection && !message.isSkillSelection && !message.isToolSelection && !message.isPrioritySelection && (
            <div className="mt-6 space-y-3 pt-6 border-t border-surface-100">
              {!isReadyActionTaken ? (
                <button
                  onClick={() => {
                    setIsReadyActionTaken(true);
                    onGenerateJD?.();
                  }}
                  className="w-full py-4 bg-gradient-to-br from-primary-600 to-primary-800 text-white rounded-md text-[15px] font-semibold hover:shadow-lg transition-all shadow-md active:scale-[0.98] flex items-center justify-center gap-2.5 group"
                >
                  <Sparkles className="w-5 h-5 group-hover:rotate-12 transition-transform" />
                  Generate Job Description
                </button>
              ) : (
                <div className="flex items-center justify-center gap-3 p-4 bg-surface-50 rounded-md border border-surface-100">
                  <div className="w-2.5 h-2.5 bg-primary-500 rounded-md animate-pulse" />
                  <span className="text-sm font-medium text-surface-500">Processing request...</span>
                </div>
              )}
            </div>
          )}
        </div>

        <div className={`mt-2 px-2 text-[10px] font-medium text-surface-400 ${!isAgent && "text-right"}`}>
          {isAgent ? "Insight Delivered" : "Recorded"}
        </div>
      </div>

      {!isAgent && (
        <div className="flex-shrink-0 mt-1">
          <div className="w-8 h-8 sm:w-11 sm:h-11 bg-surface-100 rounded-lg sm:rounded-md flex items-center justify-center shadow-sm border border-surface-200">
            <User className="w-4 h-4 sm:w-6 sm:h-6 text-surface-600" />
          </div>
        </div>
      )}
    </div>
  );
}
