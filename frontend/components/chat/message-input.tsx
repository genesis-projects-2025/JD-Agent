"use client";

import { useState } from "react";

export default function MessageInput({
  onSend,
}: {
  onSend: (text: string) => void;
}) {
  const [value, setValue] = useState("");

  const handleSend = () => {
    if (!value.trim()) return;
    onSend(value);
    setValue("");
  };

  return (
    <div className="flex gap-2 p-4 bg-zinc-50 border-t border-zinc-200">
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && handleSend()}
        className="flex-1 border border-zinc-300 px-4 py-2.5 rounded-full bg-white focus:outline-none focus:ring-2 focus:ring-zinc-900 transition-all text-zinc-800"
        placeholder="Type your answer..."
      />
      <button
        onClick={handleSend}
        className="px-6 py-2.5 bg-zinc-900 text-white rounded-full font-medium active:scale-95 transition-all hover:bg-zinc-800"
      >
        Send
      </button>
    </div>
  );
}
