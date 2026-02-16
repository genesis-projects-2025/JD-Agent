import { useEffect, useRef } from "react";
import MessageBubble from "./message-bubble";
import { Message } from "../../types/message";

export default function ChatWindow({
  messages,
  onSkillSelect,
}: {
  messages: Message[];
  onSkillSelect?: (selectedSkills: string[]) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  return (
    <div
      ref={scrollRef}
      className="flex-1 overflow-y-auto p-4 space-y-2 scroll-smooth"
    >
      {messages.map((msg, index) => (
        <MessageBubble
          key={index}
          message={msg}
          onSkillSelect={onSkillSelect}
        />
      ))}
    </div>
  );
}
