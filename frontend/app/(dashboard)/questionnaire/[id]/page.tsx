// frontend/app/(dashboard)/questionnaire/[id]/page.tsx

"use client";

import ChatWindow from "@/components/chat/chat-window";
import MessageInput from "@/components/chat/message-input";
import { useChat } from "@/hooks/useChat";
import { useState } from "react";

export default function InterviewPage() {
  const { messages, sendMessage, jd, isGenerating, handleGenerateJD } =
    useChat();

  const handleSkillSelection = (selectedSkills: string[]) => {
    const formattedMessage = `I have selected the following skills: ${selectedSkills.join(", ")}`;
    sendMessage(formattedMessage);
  };

  const handleContinueInterview = () => {
    sendMessage(
      "I have more information to add to the Job Description. Let's continue.",
    );
  };

  return (
    // Full height, no overflow — fills the main area exactly
    <div className="h-full flex flex-col">
      <div className="flex-1 flex flex-col min-h-0 border rounded-xl shadow-sm bg-white overflow-hidden">
        
        {/* Fixed Header */}
        <div className="flex-shrink-0 bg-zinc-900 text-white p-4 flex justify-between items-center">
          <h2 className="font-semibold text-lg">JD Interview</h2>
          {isGenerating && (
            <div className="flex items-center gap-2 text-sm italic text-zinc-400">
              <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
              Generating JD...
            </div>
          )}
        </div>

        {/* Scrollable Content Area — this is the ONLY thing that scrolls */}
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          {jd ? (
            // JD view — scrollable independently
            <div className="flex-1 overflow-y-auto p-6 bg-zinc-50 prose prose-zinc max-w-none">
              <h2 className="text-2xl font-bold mb-6 border-b pb-2">
                Generated Job Description
              </h2>
              <div className="whitespace-pre-wrap font-sans text-zinc-800 leading-relaxed">
                {jd}
              </div>
              <button
                onClick={() => window.location.reload()}
                className="mt-8 px-6 py-2 bg-black text-white rounded-lg hover:bg-zinc-800 transition-colors"
              >
                Start New Interview
              </button>
            </div>
          ) : (
            // Chat view — ChatWindow scrolls, input stays fixed at bottom
            <>
              <ChatWindow
                messages={messages}
                onSkillSelect={handleSkillSelection}
                onGenerateJD={handleGenerateJD}
                onContinue={handleContinueInterview}
              />
              {/* Fixed input at bottom */}
              <div className="flex-shrink-0">
                <MessageInput onSend={sendMessage} />
              </div>
            </>
          )}
        </div>

      </div>
    </div>
  );
}