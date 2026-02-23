// app/(dashboard)/questionnaire/[id]/page.tsx
// CHAT PAGE — shows interview on left, JD preview panel slides in on right after generation

"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import ChatWindow from "@/components/chat/chat-window";
import MessageInput from "@/components/chat/message-input";
import JDPreviewPanel from "@/components/jd/jd-preview-panel";
import { useChat } from "@/hooks/useChat";
import { exportJDToPDF } from "@/lib/pdf-export";
import {
  Loader2,
  ArrowLeft,
  FileText,
  Sparkles,
  ChevronRight,
} from "lucide-react";

export default function QuestionnairePage() {
  const params = useParams();
  const router = useRouter();
  const sessionId = params.id as string;

  const [showPanel, setShowPanel] = useState(false);

  const {
    messages,
    sendMessage,
    jd,
    isGenerating,
    isSaving,
    isGeneratingJD,
    handleGenerateJD,
    handleSaveJD,
    progress,
    status,
    structuredData,
    isRateLimited,
    retryTimer,
  } = useChat(() => {
    // On save success — navigate to the full view page
    router.push(`/jd/${sessionId}`);
  }, true);

  // Auto-open panel when JD is generated
  useEffect(() => {
    if (jd && status === "jd_generated") {
      setShowPanel(true);
    }
  }, [jd, status]);

  // Also open panel while generating
  useEffect(() => {
    if (isGeneratingJD) {
      setShowPanel(true);
    }
  }, [isGeneratingJD]);

  const handleSkillSelect = (skills: string[]) => {
    sendMessage(`I confirm these required skills: ${skills.join(", ")}.`);
  };

  const handleContinue = () => {
    sendMessage("Please continue the interview with more questions.");
  };

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-surface-50">
      {/* Top nav bar */}
      <div className="flex-shrink-0 h-14 bg-white border-b border-surface-200 flex items-center px-6 gap-4 z-40 shadow-sm">
        <button
          onClick={() => router.back()}
          className="flex items-center gap-2 text-surface-400 hover:text-primary-600 transition-colors text-[11px] font-black uppercase tracking-widest group"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>

        <div className="h-4 w-px bg-surface-200" />

        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-primary-600" />
          <span className="text-[11px] font-black text-surface-600 uppercase tracking-widest">
            JD Interview
          </span>
        </div>

        <div className="flex-1" />

        {/* JD Ready indicator */}
        {jd && status === "jd_generated" && (
          <button
            onClick={() => setShowPanel((p) => !p)}
            className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-xl text-[11px] font-black uppercase tracking-widest hover:bg-primary-700 transition-all shadow-lg shadow-primary-500/20 active:scale-95"
          >
            <Sparkles className="w-3.5 h-3.5" />
            {showPanel ? "Hide JD" : "View Generated JD"}
            <ChevronRight
              className={`w-3.5 h-3.5 transition-transform ${showPanel ? "rotate-180" : ""}`}
            />
          </button>
        )}

        {/* Generating indicator */}
        {isGeneratingJD && (
          <div className="flex items-center gap-2 px-4 py-2 bg-primary-50 text-primary-700 rounded-xl text-[11px] font-black uppercase tracking-widest border border-primary-100">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Generating JD...
          </div>
        )}
      </div>

      {/* Main content area */}
      <div className="flex-1 flex min-h-0">
        {/* Chat column */}
        <div
          className={`flex flex-col min-h-0 transition-all duration-500 ease-out ${
            showPanel ? "w-1/2 border-r border-surface-200" : "w-full"
          }`}
        >
          <ChatWindow
            messages={messages}
            onSkillSelect={handleSkillSelect}
            onGenerateJD={() => {
              setShowPanel(true);
              handleGenerateJD();
            }}
            onContinue={handleContinue}
          />

          {/* Rate limit banner */}
          {isRateLimited && retryTimer > 0 && (
            <div className="flex-shrink-0 mx-6 mb-3 px-5 py-3 bg-amber-50 border border-amber-200 rounded-xl flex items-center gap-3">
              <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
              <span className="text-[11px] font-bold text-amber-700 uppercase tracking-widest">
                Rate limited — resuming in {retryTimer}s
              </span>
            </div>
          )}

          <MessageInput
            onSend={sendMessage}
            disabled={
              isGenerating ||
              isGeneratingJD ||
              (isRateLimited && retryTimer > 0)
            }
          />
        </div>

        {/* JD Preview Panel — slides in from right */}
        {showPanel && (
          <div className="w-1/2 flex flex-col min-h-0 animate-in slide-in-from-right duration-400">
            <JDPreviewPanel
              jd={jd}
              structuredData={structuredData}
              isGenerating={isGeneratingJD}
              isSaving={isSaving}
              onSave={async () => {
                const success = await handleSaveJD();
                if (success) {
                  router.push(`/jd/${sessionId}`);
                }
              }}
              onEdit={async () => {
                const success = await handleSaveJD();
                if (success) {
                  router.push(`/jd/${sessionId}/edit`);
                }
              }}
              onClose={() => setShowPanel(false)}
              sessionId={sessionId}
            />
          </div>
        )}
      </div>
    </div>
  );
}