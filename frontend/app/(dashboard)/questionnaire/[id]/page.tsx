// app/(dashboard)/questionnaire/[id]/page.tsx - IMPROVED VERSION

"use client";

import ChatWindow from "@/components/chat/chat-window";
import MessageInput from "@/components/chat/message-input";
import { useChat } from "@/hooks/useChat";
import {
  FileText,
  Download,
  Copy,
  Check,
  Send,
  Clock,
  RefreshCcw,
} from "lucide-react";
import { useState } from "react";

export default function InterviewPage() {
  const {
    messages,
    sendMessage,
    jd,
    isGenerating,
    handleGenerateJD,
    progress,
    handleApproveJD,
    isRateLimited,
    retryTimer,
    handleRetry,
  } = useChat();
  const [copied, setCopied] = useState(false);

  const handleSkillSelection = (selectedSkills: string[]) => {
    const formattedMessage = `I have selected the following skills: ${selectedSkills.join(", ")}`;
    sendMessage(formattedMessage);
  };

  const handleContinueInterview = () => {
    sendMessage(
      "I have more information to add to the Job Description. Let's continue.",
    );
  };

  const handleCopy = () => {
    if (jd) {
      navigator.clipboard.writeText(jd);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="h-[calc(100vh-3rem)] flex flex-col">
      {/* Main Container */}
      <div className="flex-1 max-w-6xl mx-auto w-full flex flex-col">
        {jd ? (
          /* JD Generated View */
          <div className="flex-1 flex flex-col bg-white rounded-2xl shadow-2xl border border-neutral-200 overflow-hidden">
            {/* Header */}
            <div className="px-8 py-6 bg-gradient-to-r from-primary-600 to-primary-700 text-black">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 bg-white/20 backdrop-blur-sm rounded-2xl flex items-center justify-center">
                    <FileText className="w-7 h-7 text-black" />
                  </div>
                  <div>
                    <h2 className="text-2xl font-bold">
                      Job Description Generated
                    </h2>
                    <p className="text-black text-sm mt-1">
                      Review and download your JD
                    </p>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex gap-3">
                  <button
                    onClick={handleCopy}
                    className="px-5 py-2.5 bg-white/20 hover:bg-white/30 backdrop-blur-sm rounded-xl text-sm font-medium transition-all flex items-center gap-2"
                  >
                    {copied ? (
                      <>
                        <Check className="w-4 h-4" />
                        Copied!
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4" />
                        Copy
                      </>
                    )}
                  </button>
                  <button className="px-5 py-2.5 bg-white text-primary-700 hover:bg-neutral-50 rounded-xl text-sm font-semibold transition-all flex items-center gap-2 shadow-lg">
                    <Download className="w-4 h-4" />
                    Download PDF
                  </button>
                </div>
              </div>
            </div>

            {/* JD Content */}
            <div className="flex-1 overflow-y-auto p-8">
              <div className="max-w-4xl mx-auto">
                <div className="prose prose-lg prose-neutral max-w-none">
                  <div className="bg-neutral-50 rounded-2xl p-8 border border-neutral-200">
                    <pre className="whitespace-pre-wrap font-sans text-neutral-800 leading-relaxed text-[15px]">
                      {jd}
                    </pre>
                  </div>
                </div>

                {/* Actions */}
                <div className="mt-8 flex gap-4">
                  <button
                    onClick={() => window.location.reload()}
                    className="px-6 py-3 bg-neutral-900 text-white rounded-xl font-medium hover:bg-neutral-800 transition-all shadow-lg"
                  >
                    Start New Interview
                  </button>
                  <button className="px-6 py-3 bg-white border-2 border-neutral-300 text-neutral-700 rounded-xl font-medium hover:bg-neutral-50 transition-all">
                    Edit JD
                  </button>
                  <button
                    onClick={handleApproveJD}
                    className="px-6 py-3 bg-primary-600 text-black rounded-xl font-medium hover:bg-primary-700 transition-all shadow-lg shadow-primary-900/20 flex items-center gap-2"
                  >
                    <Send className="w-4 h-4" />
                    Send for Approval
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* Chat View */
          <div className="flex-1 flex flex-col bg-white rounded-2xl shadow-2xl border border-neutral-200 overflow-hidden relative">
            {/* Progress Bar */}
            <div className="absolute top-0 left-0 right-0 h-1 bg-neutral-100 z-10">
              <div
                className="h-full bg-primary-600 transition-all duration-500 ease-out"
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
                      <p className="text-sm font-semibold text-amber-800">
                        Rate Limit Reached
                      </p>
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
                  <div className="w-16 h-16 bg-gradient-to-br from-primary-500 to-primary-600 rounded-2xl flex items-center justify-center mx-auto mb-4 animate-pulse">
                    <FileText className="w-8 h-8 text-white" />
                  </div>
                  <h3 className="text-xl font-semibold text-neutral-900 mb-2">
                    Generating Your JD...
                  </h3>
                  <p className="text-sm text-neutral-600">
                    Analyzing your responses and creating the perfect job
                    description
                  </p>
                  <div className="mt-6 flex items-center justify-center gap-2">
                    <div
                      className="w-2 h-2 bg-primary-600 rounded-full animate-bounce"
                      style={{ animationDelay: "0ms" }}
                    />
                    <div
                      className="w-2 h-2 bg-primary-600 rounded-full animate-bounce"
                      style={{ animationDelay: "150ms" }}
                    />
                    <div
                      className="w-2 h-2 bg-primary-600 rounded-full animate-bounce"
                      style={{ animationDelay: "300ms" }}
                    />
                  </div>
                </div>
              </div>
            )}

            <ChatWindow
              messages={messages}
              onSkillSelect={handleSkillSelection}
              onGenerateJD={handleGenerateJD}
              onContinue={handleContinueInterview}
            />
            <MessageInput
              onSend={sendMessage}
              disabled={isGenerating || (isRateLimited && retryTimer > 0)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
