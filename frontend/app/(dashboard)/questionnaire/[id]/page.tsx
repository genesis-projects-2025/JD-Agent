"use client";

import { useState } from "react";
import { useParams } from "next/navigation";

export default function ChatPage() {
  const params = useParams();
  const id = params.id;

  const [messages, setMessages] = useState<any[]>([]);
  const [input, setInput] = useState("");

  const sendMessage = () => {
    if (!input) return;

    setMessages((prev) => [
      ...prev,
      { role: "user", content: input },
      { role: "assistant", content: "AI response will come here" },
    ]);

    setInput("");
  };

  return (
    <div className="p-10 max-w-2xl">
      <h1 className="text-xl font-bold mb-4">
        Conversation: {id}
      </h1>

      <div className="border h-[400px] overflow-y-auto p-4 mb-4">
        {messages.map((m, i) => (
          <div key={i} className="mb-2">
            <strong>{m.role}:</strong> {m.content}
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <input
          className="border p-2 flex-1"
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />

        <button
          onClick={sendMessage}
          className="bg-black text-white px-4"
        >
          Send
        </button>
      </div>
    </div>
  );
}
