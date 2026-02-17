// app/(dashboard)/questionnaire/[id]/page.tsx - IMPROVED VERSION

"use client";

import ChatWindow from "@/components/chat/chat-window";
import MessageInput from "@/components/chat/message-input";
import { useChat } from "@/hooks/useChat";
import { FileText, Download, Copy, Check } from "lucide-react";
import { useState } from "react";

export default function InterviewPage() {
  const { messages, sendMessage, jd, isGenerating, handleGenerateJD } = useChat();
  const [copied, setCopied] = useState(false);

  const handleSkillSelection = (selectedSkills: string[]) => {
    const formattedMessage = `I have selected the following skills: ${selectedSkills.join(", ")}`;
    sendMessage(formattedMessage);
  };

  const handleContinueInterview = () => {
    sendMessage("I have more information to add to the Job Description. Let's continue.");
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
            <div className="px-8 py-6 bg-gradient-to-r from-primary-600 to-primary-700 text-white">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 bg-white/20 backdrop-blur-sm rounded-2xl flex items-center justify-center">
                    <FileText className="w-7 h-7 text-white" />
                  </div>
                  <div>
                    <h2 className="text-2xl font-bold">Job Description Generated</h2>
                    <p className="text-primary-100 text-sm mt-1">Review and download your JD</p>
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
                  <button className="px-6 py-3 bg-primary-600 text-white rounded-xl font-medium hover:bg-primary-700 transition-all shadow-lg shadow-primary-900/20">
                    Send for Approval
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* Chat View */
          <div className="flex-1 flex flex-col bg-white rounded-2xl shadow-2xl border border-neutral-200 overflow-hidden">
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
                    Analyzing your responses and creating the perfect job description
                  </p>
                  <div className="mt-6 flex items-center justify-center gap-2">
                    <div className="w-2 h-2 bg-primary-600 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <div className="w-2 h-2 bg-primary-600 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <div className="w-2 h-2 bg-primary-600 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
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
            <MessageInput onSend={sendMessage} disabled={isGenerating} />
          </div>
        )}
      </div>
    </div>
  );
}