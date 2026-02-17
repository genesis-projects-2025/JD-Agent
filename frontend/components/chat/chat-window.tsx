// frontend/components/chat/chat-window.tsx

import { useEffect, useRef } from "react";
import MessageBubble from "./message-bubble";
import { Message } from "../../types/message";

export default function ChatWindow({
  messages,
  onSkillSelect,
  onGenerateJD,
  onContinue,
}: {
  messages: Message[];
  onSkillSelect?: (selectedSkills: string[]) => void;
  onGenerateJD?: () => void;
  onContinue?: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom whenever messages change
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: "smooth",   // smooth auto-scroll as chat happens
      });
    }
  }, [messages]);  // fires every time a new message is added

  return (
    // flex-1 min-h-0 = fills remaining space without overflowing
    // overflow-y-auto = ONLY this div scrolls
    <div
      ref={scrollRef}
      className="flex-1 min-h-0 overflow-y-auto p-4 space-y-2 scroll-smooth"
    >
      {messages.map((msg, index) => (
        <MessageBubble
          key={index}
          message={msg}
          onSkillSelect={onSkillSelect}
          onGenerateJD={onGenerateJD}
          onContinue={onContinue}
        />
      ))}
    </div>
  );
}
