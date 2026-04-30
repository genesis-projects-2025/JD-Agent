// app/(dashboard)/questionnaire/[id]/page.tsx
// CHAT PAGE — shows interview on left, JD preview panel slides in on right after generation

"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { getCookie, cookieKeys } from "@/lib/cookies";
import ChatWindow from "@/components/chat/chat-window";
import MessageInput from "@/components/chat/message-input";
import JDPreviewPanel from "@/components/jd/jd-preview-panel";
import { useChat } from "@/hooks/useChat";
import { useVoiceConversation } from "@/hooks/useVoiceConversation";
import { deleteJD, getCurrentUser } from "@/lib/api";
import { DeleteModal } from "@/components/ui/delete-modal";
import {
  Loader2,
  ArrowLeft,
  FileText,
  Sparkles,
  ChevronRight,
  Trash2,
} from "lucide-react";

export default function QuestionnairePage() {
  const params = useParams();
  const router = useRouter();
  const sessionId = params.id as string;

  const [showPanel, setShowPanel] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [composerValue, setComposerValue] = useState("");

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
    depthScores,
    currentAgent,
    status,
    structuredData,
    isRateLimited,
    retryTimer,
    updateJd,
    updateStructuredData,
    confirmSkillsAction,
    confirmToolsAction,
    confirmPriorityTasksAction,
    hydrated,
    statusMessage,
  } = useChat(() => {
    // Component stays on page; the JDPreviewPanel handles UI view
  }, true);

  const {
    isListening,
    isSpeaking,
    playbackEnabled,
    speakText,
    setPlaybackEnabled,
    stopListening,
    supportsSpeechInput,
    supportsSpeechOutput,
    toggleListening,
    voiceError,
  } = useVoiceConversation({
    draftText: composerValue,
    onDraftTextChange: setComposerValue,
  });
  const hasPrimedVoiceRef = useRef(false);
  const lastSpokenAgentTextRef = useRef("");

  const latestReplayableAgentMessage = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (
        message.sender === "agent" &&
        !message.isStreaming &&
        message.text.trim()
      ) {
        return message.text.trim();
      }
    }
    return "";
  }, [messages]);

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
    confirmSkillsAction(skills);
  };

  const handleToolSelect = (tools: string[]) => {
    confirmToolsAction(tools);
  };

  const handlePriorityTasksSelect = (tasks: string[]) => {
    confirmPriorityTasksAction(tasks);
  };

  const handleContinue = () => {
    sendMessage("Please continue the interview with more questions.");
  };

  const handleComposerSend = async (text: string) => {
    stopListening();
    await sendMessage(text);
    setComposerValue("");
  };

  const handleReplayLatestAgentMessage = () => {
    if (!latestReplayableAgentMessage) return;
    speakText(latestReplayableAgentMessage, { force: true });
  };

  useEffect(() => {
    if (!hydrated || messages.length === 0) return;

    const lastMessage = messages[messages.length - 1];
    if (
      lastMessage.sender !== "agent" ||
      lastMessage.isStreaming ||
      !lastMessage.text.trim()
    ) {
      return;
    }

    const speechText = lastMessage.text.trim();

    if (!hasPrimedVoiceRef.current) {
      hasPrimedVoiceRef.current = true;
      lastSpokenAgentTextRef.current = speechText;

      // Fresh sessions begin with a single assistant question; resumed sessions
      // should not unexpectedly read historical chat aloud on page load.
      if (messages.length === 1) {
        speakText(speechText);
      }
      return;
    }

    if (speechText === lastSpokenAgentTextRef.current) return;

    lastSpokenAgentTextRef.current = speechText;
    speakText(speechText);
  }, [hydrated, messages, speakText]);


  const handleConfirmDelete = async () => {
    setIsDeleting(true);
    try {
      const employeeId = getCookie(cookieKeys.EMPLOYEE_ID);
      if (!employeeId) throw new Error("Missing employee identification.");
      await deleteJD(sessionId, employeeId);
      router.push(`/dashboard/${employeeId}`);
    } catch (err: any) {
      alert(err?.message || "Failed to delete JD");
      setIsDeleting(false);
      setShowDeleteModal(false);
    }
  };

  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden bg-surface-50">
      {/* Top nav bar */}
      <div className="flex-shrink-0 h-14 bg-white border-b border-surface-200 flex items-center pl-14 pr-4 sm:px-6 gap-2 sm:gap-4 z-40 shadow-sm overflow-x-auto">
        <button
          onClick={() => {
            const u = getCurrentUser();
            if (u?.employee_id) {
              router.push(`/dashboard/${u.employee_id}`);
            } else {
              router.push("/");
            }
          }}
          className="flex items-center gap-1.5 sm:gap-2 text-surface-400 hover:text-primary-600 transition-colors text-[10px] sm:text-[11px] font-medium group whitespace-nowrap shrink-0"
        >
          <ArrowLeft className="w-4 h-4" />
          <span className="hidden sm:inline">Back</span>
        </button>

        <div className="h-4 w-px bg-surface-200 shrink-0" />

        <div className="flex items-center gap-2 shrink-0">
          <FileText className="w-4 h-4 text-primary-600" />
          <span className="text-[10px] sm:text-[11px] font-medium text-surface-600 whitespace-nowrap">
            JD Interview
          </span>
        </div>

        <div className="flex-1 min-w-4" />

        {/* JD Ready indicator */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          {jd && status === "jd_generated" && (
            <button
              onClick={() => setShowPanel((p) => !p)}
              className="flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-1.5 sm:py-2 bg-primary-600 text-white rounded-md text-[10px] sm:text-[11px] font-medium hover:bg-primary-700 transition-all shadow-md shadow-primary-500/20 active:scale-95 whitespace-nowrap"
            >
              <Sparkles className="w-3.5 h-3.5 hidden sm:block" />
              {showPanel ? "Hide JD" : "View JD"}
              <ChevronRight
                className={`w-3.5 h-3.5 transition-transform ${showPanel ? "rotate-90 md:rotate-180" : ""}`}
              />
            </button>
          )}

          <button
            onClick={() => setShowDeleteModal(true)}
            disabled={isDeleting}
            title="Delete Interview Draft"
            className="p-1.5 sm:p-2 text-surface-400 hover:text-red-500 bg-surface-50 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
          >
            {isDeleting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Trash2 className="w-4 h-4" />
            )}
          </button>
        </div>

        {/* Generating indicator */}
        {isGeneratingJD && (
          <div className="flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-1.5 sm:py-2 bg-primary-50 text-primary-700 rounded-md text-[10px] sm:text-[11px] font-medium border border-primary-100 whitespace-nowrap shrink-0">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            <span className="hidden sm:inline">Generating JD...</span>
            <span className="sm:hidden">Gen JD...</span>
          </div>
        )}
      </div>

      {/* Main content area */}
      <div className="flex-1 flex flex-col md:flex-row min-h-0 relative">
        {/* Chat column — hidden on mobile when JD panel is open */}
        <div
          className={`flex flex-col min-h-0 transition-all duration-500 ease-out bg-surface-50 w-full ${showPanel
            ? "hidden md:flex md:h-auto md:w-1/2 md:border-r border-surface-200"
            : "h-full"
            }`}
        >
          <ChatWindow
            messages={messages}
            hydrated={hydrated}
            progress={progress}
            depthScores={depthScores}
            currentAgent={currentAgent}
            isSpeaking={isSpeaking}
            canReplayVoice={Boolean(latestReplayableAgentMessage)}
            voicePlaybackSupported={supportsSpeechOutput}
            voicePlaybackEnabled={playbackEnabled}
            onSkillSelect={handleSkillSelect}
            onToolSelect={handleToolSelect}
            onPriorityTaskSelect={handlePriorityTasksSelect}
            onReplayLatestAgentMessage={handleReplayLatestAgentMessage}
            onToggleVoicePlayback={() => setPlaybackEnabled(!playbackEnabled)}
            onGenerateJD={() => {
              setShowPanel(true);
              handleGenerateJD();
            }}
            onContinue={handleContinue}
          />

          {/* Rate limit banner */}
          {isRateLimited && retryTimer > 0 && (
            <div className="flex-shrink-0 mx-6 mb-3 px-5 py-3 bg-amber-50 border border-amber-200 rounded-md flex items-center gap-3">
              <div className="w-2 h-2 rounded-md bg-amber-500 animate-pulse" />
              <span className="text-[11px] font-medium text-amber-700 ">
                Rate limited — resuming in {retryTimer}s
              </span>
            </div>
          )}

          {/* Background Status Indicator (Optimistic Persistence) */}
          {statusMessage && (
            <div className="flex-shrink-0 mx-6 mb-3 px-5 py-2 bg-primary-50/50 border border-primary-100 rounded-md flex items-center gap-3 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <Loader2 className="w-3.5 h-3.5 text-primary-500 animate-spin" />
              <span className="text-[10px] sm:text-[11px] font-bold text-primary-700 uppercase tracking-wider">
                {statusMessage}
              </span>
            </div>
          )}

          <MessageInput
            value={composerValue}
            onValueChange={setComposerValue}
            onSend={handleComposerSend}
            voiceError={voiceError}
            voiceInputSupported={supportsSpeechInput}
            isListening={isListening}
            onToggleListening={toggleListening}
            disabled={
              isGenerating ||
              isGeneratingJD ||
              (isRateLimited && retryTimer > 0)
            }
          />
        </div>

        {/* JD Preview Panel — full screen on mobile, 50% on desktop */}
        {showPanel && (
          <div className="w-full h-full md:w-1/2 md:h-full flex flex-col min-h-0 animate-in slide-in-from-bottom md:slide-in-from-right duration-400 bg-white">
            <JDPreviewPanel
              jd={jd}
              structuredData={structuredData}
              isGenerating={isGeneratingJD}
              isSaving={isSaving}
              saveSuccess={saveSuccess}
              onSave={async () => {
                const success = await handleSaveJD();
                if (success) {
                  setSaveSuccess(true);
                  // Stays on page with success feedback showing momentarily, then redirects
                  setTimeout(() => {
                    router.push(`/jd/${sessionId}`);
                  }, 1200);
                }
              }}
              onEdit={async () => {
                // Handled internally by JDPreviewPanel's isEditing state
              }}
              updateJd={updateJd}
              updateStructuredData={updateStructuredData}
              onClose={() => setShowPanel(false)}
              sessionId={sessionId}
            />
          </div>
        )}
      </div>

      <DeleteModal
        isOpen={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        onConfirm={handleConfirmDelete}
        isDeleting={isDeleting}
        title="Delete Interview"
        description="Are you sure you want to delete this interview progress? This cannot be undone."
      />
    </div>
  );
}
