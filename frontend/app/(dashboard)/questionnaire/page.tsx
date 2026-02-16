"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function QuestionnairePage() {
  const [employeeId, setEmployeeId] = useState("");
  const router = useRouter();

  const createQuestionnaire = () => {
    // later we call API
    const fakeId = "123";
    router.push(`/questionnaire/${fakeId}`);
  };

  return (
    <div className="p-10 max-w-xl">
      <h1 className="text-2xl font-bold mb-6">
        Create Questionnaire
      </h1>

      <input
        className="border p-2 w-full mb-4"
        placeholder="Employee ID"
        value={employeeId}
        onChange={(e) => setEmployeeId(e.target.value)}
      />

      <button
        onClick={createQuestionnaire}
        className="bg-black text-white px-4 py-2 rounded"
      >
        Start Conversation
      </button>
    </div>
  );
}
