"use client";

import ChatWindow from "@/components/chat/chat-window";
import MessageInput from "@/components/chat/message-input";
import { useChat } from "@/hooks/useChat";
import { exportJDToPDF } from "@/lib/pdf-export";
import {
  FileText, Download, Copy, Check, Clock, RefreshCcw, Save,
} from "lucide-react";
import { useState } from "react";

export default function InterviewPage() {
  const {
    messages, sendMessage, jd, isGenerating, isSaving,
    handleSaveJD, progress, status, structuredData,
    handleApproveJD, isRateLimited, retryTimer, handleRetry,
  } = useChat();

  const [copied, setCopied] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const handleCopy = () => {
    if (jd) {
      navigator.clipboard.writeText(jd);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleExportPDF = () => {
    if (!jd) return;
    setIsExporting(true);
    // Derive role title from structured data if available
    const roleTitle =
      structuredData?.role_summary?.title ||
      structuredData?.employee_information?.role_title ||
      "Job Description";
    exportJDToPDF(jd, roleTitle);
    setTimeout(() => setIsExporting(false), 1500);
  };

  const handleContinueInterview = () => {
    sendMessage("I have more information to add to the Job Description. Let's continue.");
  };

  const handleRegenerate = () => {
    sendMessage("Yes, please generate the JD now.");
  };

  return (
    <div className="h-[calc(100vh-3rem)] flex flex-col overflow-hidden">
      <div className="flex-1 min-h-0 max-w-6xl mx-auto w-full flex flex-col p-4">
        {jd ? (
          /* ── JD Generated View ── */
          <div className="flex-1 min-h-0 flex flex-col bg-white rounded-2xl shadow-2xl border border-neutral-200 overflow-hidden">

            {/* Header */}
            <div className="flex-shrink-0 px-8 py-6 bg-gradient-to-r from-neutral-900 to-neutral-800 text-white border-b border-neutral-700">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 bg-white/10 backdrop-blur-sm rounded-2xl flex items-center justify-center border border-white/20">
                    <FileText className="w-7 h-7 text-white" />
                  </div>
                  <div>
                    <h2 className="text-2xl font-bold tracking-tight">Job Description</h2>
                    <p className="text-neutral-400 text-sm mt-1">Review and save your JD</p>
                  </div>
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={handleCopy}
                    className="px-5 py-2.5 bg-white/10 hover:bg-white/20 backdrop-blur-sm rounded-xl text-sm font-medium transition-all flex items-center gap-2 border border-white/10"
                  >
                    {copied ? (
                      <><Check className="w-4 h-4" /> Copied!</>
                    ) : (
                      <><Copy className="w-4 h-4" /> Copy</>
                    )}
                  </button>

                  {/* ✅ Wired-up PDF export */}
                  <button
                    onClick={handleExportPDF}
                    disabled={isExporting}
                    className="px-5 py-2.5 bg-white text-neutral-900 hover:bg-neutral-50 rounded-xl text-sm font-bold transition-all flex items-center gap-2 shadow-lg disabled:opacity-70"
                  >
                    {isExporting ? (
                      <><RefreshCcw className="w-4 h-4 animate-spin" /> Preparing...</>
                    ) : (
                      <><Download className="w-4 h-4" /> Download PDF</>
                    )}
                  </button>
                </div>
              </div>
            </div>

            {/* Content Area */}
            <div className="flex-1 min-h-0 overflow-y-auto p-8 bg-white">
              <div className="max-w-3xl mx-auto">
                <div className="bg-neutral-50 rounded-3xl p-10 border border-neutral-200 shadow-inner">
                  <pre className="whitespace-pre-wrap font-sans text-neutral-800 leading-relaxed text-[16px]">
                    {jd}
                  </pre>
                </div>

                <div className="mt-10 flex flex-wrap gap-4 items-center justify-between border-t border-neutral-100 pt-8">
                  <div className="flex gap-4">
                    <button
                      onClick={handleContinueInterview}
                      className="px-6 py-3 bg-white border-2 border-neutral-300 text-neutral-700 rounded-xl font-semibold hover:bg-neutral-50 transition-all flex items-center gap-2"
                    >
                      <RefreshCcw className="w-4 h-4" />
                      Continue Interview
                    </button>
                    <button
                      onClick={handleRegenerate}
                      className="px-6 py-3 bg-neutral-100 text-neutral-700 rounded-xl font-semibold hover:bg-neutral-200 transition-all"
                    >
                      Regenerate
                    </button>
                  </div>

                  <button
                    onClick={handleSaveJD}
                    disabled={isSaving}
                    className="px-8 py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-all shadow-xl flex items-center gap-2 disabled:opacity-50"
                  >
                    {isSaving ? (
                      <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : (
                      <Save className="w-5 h-5" />
                    )}
                    {isSaving ? "Saving..." : "Save JD to Database"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* ── Chat View ── */
          <div className="flex-1 min-h-0 flex flex-col bg-white rounded-2xl shadow-2xl border border-neutral-200 overflow-hidden relative">

            {/* Progress Bar */}
            <div className="absolute top-0 left-0 right-0 h-1 bg-neutral-100 z-10">
              <div
                className="h-full bg-blue-600 transition-all duration-500 ease-out"
                style={{ width: `${progress}%` }}
              />
            </div>

            {/* Rate Limit Overlay */}
            {isRateLimited && (
              <div className="absolute inset-x-0 top-0 z-40 flex items-center justify-center p-2">
                <div className="bg-amber-50 border border-amber-200 rounded-lg shadow-lg p-4 flex items-center gap-4 animate-in slide-in-from-top-2">
                  <div className="flex items-center gap-3">
                    <Clock className="w-5 h-5 text-amber-600 animate-pulse" />
                    <div>
                      <p className="text-sm font-semibold text-amber-800">Rate Limit Reached</p>
                      <p className="text-xs text-amber-600">
                        {retryTimer > 0
                          ? `Please wait ${retryTimer} seconds...`
                          : "You can continue now."}
                      </p>
                    </div>
                  </div>
                  {retryTimer === 0 && (
                    <button
                      onClick={handleRetry}
                      className="px-4 py-2 bg-amber-100 hover:bg-amber-200 text-amber-900 rounded-md text-xs font-semibold flex items-center gap-2 transition-colors"
                    >
                      <RefreshCcw className="w-3 h-3" />
                      Continue Chatting
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Generating Overlay */}
            {isGenerating && (
              <div className="absolute inset-0 bg-white/95 backdrop-blur-sm z-50 flex items-center justify-center">
                <div className="text-center">
                  <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4 animate-pulse">
                    <FileText className="w-8 h-8 text-white" />
                  </div>
                  <h3 className="text-xl font-semibold text-neutral-900 mb-2">Generating Your JD...</h3>
                  <p className="text-sm text-neutral-600">
                    Analysing your responses and crafting the perfect job description
                  </p>
                  <div className="mt-6 flex items-center justify-center gap-2">
                    {[0, 150, 300].map((delay) => (
                      <div
                        key={delay}
                        className="w-2 h-2 bg-blue-600 rounded-full animate-bounce"
                        style={{ animationDelay: `${delay}ms` }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            )}

            <ChatWindow
              messages={messages}
              onSkillSelect={(skills) =>
                sendMessage(`I have selected these skills: ${skills.join(", ")}`)
              }
              onGenerateJD={handleRegenerate}
              onContinue={handleContinueInterview}
            />
            <div className="flex-shrink-0">
              <MessageInput
                onSend={sendMessage}
                disabled={isGenerating || (isRateLimited && retryTimer > 0)}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}