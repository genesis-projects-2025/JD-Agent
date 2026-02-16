"use client";

import { useRouter } from "next/navigation";

export default function QuestionnaireStart() {
  const router = useRouter();

  const startInterview = () => {
    router.push("/questionnaire/1");
  };

  return (
    <div>
      <h2 className="text-xl font-semibold">JD Interview</h2>
      <p className="mt-2">
        Answer a few questions to generate your Job Description.
      </p>

      <button
        onClick={startInterview}
        className="mt-4 px-4 py-2 bg-blue-600 text-white rounded"
      >
        Begin Interview
      </button>
    </div>
  );
}
