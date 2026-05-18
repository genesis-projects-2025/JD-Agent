// app/(dashboard)/questionnaire/page.tsx
"use client";

import { useRouter } from "next/navigation";
import { initQuestionnaire, getCurrentUser, fetchEmployeeRoleTemplate } from "@/lib/api";
import { getOrCreateEmployeeId } from "@/lib/auth";
import { useState, useEffect } from "react";
import ContinueSessionBanner from "@/components/session/ContinuesessionBanner";

export default function QuestionnaireStart() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [roleTemplate, setRoleTemplate] = useState<any>(null);

  useEffect(() => {
    const eid = getOrCreateEmployeeId();
    fetchEmployeeRoleTemplate(eid)
      .then((data) => {
        if (data && data.exists) {
          setRoleTemplate(data);
        }
      })
      .catch(console.error);
  }, []);

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

  if (roleTemplate && roleTemplate.exists) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[65vh] px-4 py-8 animate-in fade-in duration-500">
        <div className="max-w-xl w-full p-6 sm:p-8 bg-white rounded-3xl border border-neutral-200 shadow-xl relative overflow-hidden">
          <div className="absolute top-0 right-0 p-24 bg-emerald-500/5 rounded-md blur-3xl pointer-events-none" />

          <div className="flex items-center gap-3 mb-6">
            <span className="w-2.5 h-2.5 bg-emerald-50 rounded-full animate-ping" />
            <span className="px-2.5 py-1 bg-emerald-50 text-emerald-700 text-[10px] font-semibold tracking-wider uppercase rounded-md border border-emerald-200">
              📄 Standard Role JD Prepared
            </span>
          </div>

          <h2 className="text-2xl sm:text-3xl font-bold text-neutral-900 mb-2">
            Standardized JD Ready!
          </h2>
          <p className="text-neutral-500 text-sm mb-6">
            A standardized Job Description for your role <span className="font-semibold text-neutral-900">{roleTemplate.title}</span> ({roleTemplate.department}) has been approved by HR and is ready.
          </p>

          <div className="space-y-6">
            {/* Option 1 */}
            <div className="p-5 bg-emerald-50/50 border border-emerald-200/60 rounded-2xl">
              <p className="text-emerald-800 text-xs font-semibold uppercase tracking-wider mb-2">
                Option 1 (Recommended)
              </p>
              <p className="text-neutral-600 text-sm mb-4 leading-relaxed">
                Click below to instantly view this pre-approved standard copy and complete your profile.
              </p>
              <button
                onClick={() => router.push(`/jd/${roleTemplate.id}`)}
                className="flex items-center gap-2 px-5 py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-md text-sm font-semibold transition-all active:scale-[0.98] shadow-md shadow-emerald-600/10"
              >
                📥 View Standard JD
              </button>
            </div>

            {/* Option 2 */}
            <div className="p-5 bg-neutral-50 border border-neutral-200 rounded-2xl">
              <p className="text-neutral-500 text-xs font-semibold uppercase tracking-wider mb-2">
                Option 2 (Custom)
              </p>
              <p className="text-neutral-600 text-sm mb-4 leading-relaxed">
                If your specific daily tasks are uniquely different from other team members in your role, you can choose to take a personal interview:
              </p>
              <button
                onClick={startInterview}
                disabled={loading}
                className="flex items-center gap-2 px-5 py-3 bg-neutral-900 hover:bg-neutral-800 text-white rounded-md text-sm font-semibold transition-all active:scale-[0.98] disabled:opacity-50"
              >
                {loading ? (
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-md animate-spin" />
                ) : (
                  "💬 Start Custom AI Interview"
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-4">
      <ContinueSessionBanner />

      <div className="max-w-md w-full p-8 bg-white rounded-md shadow-md border border-neutral-100">
        <h2 className="text-2xl font-medium text-neutral-900 mb-4 text-center">
          Ready to Start?
        </h2>
        <p className="text-neutral-600 text-center mb-8">
          We'll guide you through a brief interview to understand your role and
          generate a professional Job Description.
        </p>

        <button
          onClick={startInterview}
          disabled={loading}
          className="w-full py-4 bg-blue-600 text-white rounded-md font-medium hover:bg-blue-700 transition-all shadow-md flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {loading ? (
            <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-md animate-spin" />
          ) : (
            "Begin My Interview"
          )}
        </button>
      </div>
    </div>
  );
}
