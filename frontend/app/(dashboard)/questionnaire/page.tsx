// app/(dashboard)/questionnaire/page.tsx
"use client";

import { useRouter } from "next/navigation";
import { initQuestionnaire, getCurrentUser } from "@/lib/api";
import { getOrCreateEmployeeId } from "@/lib/auth";
import { useState } from "react";
import ContinueSessionBanner from "@/components/session/ContinuesessionBanner";

export default function QuestionnaireStart() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const startInterview = async () => {
    setLoading(true);
    try {
      const eid = getOrCreateEmployeeId();
      const user = getCurrentUser();
      const employeeName = user?.name || ("Employee " + eid.substring(0, 8).toUpperCase());
      const data = await initQuestionnaire({
        employee_id: eid,
        employee_name: employeeName,
      });
      router.push(`/questionnaire/${data.id}`);
    } catch (error) {
      console.error("Failed to initialize interview:", error);
      alert("Failed to start interview. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-4">
      <ContinueSessionBanner />

      <div className="max-w-md w-full p-8 bg-white rounded-2xl shadow-xl border border-neutral-100">
        <h2 className="text-2xl font-bold text-neutral-900 mb-4 text-center">
          Ready to Start?
        </h2>
        <p className="text-neutral-600 text-center mb-8">
          We'll guide you through a brief interview to understand your role and
          generate a professional Job Description.
        </p>

        <button
          onClick={startInterview}
          disabled={loading}
          className="w-full py-4 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-all shadow-lg flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {loading ? (
            <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          ) : (
            "Begin My Interview"
          )}
        </button>
      </div>
    </div>
  );
}
