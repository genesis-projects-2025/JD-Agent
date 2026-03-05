"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  FileText,
  MessageSquare,
  Clock,
  ArrowRight,
  Briefcase,
  Loader2,
  Plus,
} from "lucide-react";

import {
  fetchEmployeeJDs,
  fetchManagerPendingJDs,
  fetchHRPendingJDs,
  getCurrentUser,
} from "@/lib/api";
import { getOrCreateEmployeeId } from "@/lib/auth";

type JDListItem = {
  id: string;
  title: string | null;
  status: string;
  version: number;
  updated_at: string | null;
  created_at: string | null;
};

const STATUS_CONFIG: Record<
  string,
  { label: string; color: string; bg: string }
> = {
  draft: {
    label: "Draft",
    color: "text-amber-700",
    bg: "bg-amber-50 border-amber-200",
  },
  jd_generated: {
    label: "Draft",
    color: "text-amber-700",
    bg: "bg-amber-50 border-amber-200",
  },
  sent_to_manager: {
    label: "Manager Review",
    color: "text-blue-700",
    bg: "bg-blue-50 border-blue-200",
  },
  manager_rejected: {
    label: "Manager Rejected",
    color: "text-red-700",
    bg: "bg-red-50 border-red-200",
  },
  sent_to_hr: {
    label: "HR Review",
    color: "text-purple-700",
    bg: "bg-purple-50 border-purple-200",
  },
  hr_rejected: {
    label: "HR Rejected",
    color: "text-red-700",
    bg: "bg-red-50 border-red-200",
  },
  approved: {
    label: "Approved",
    color: "text-emerald-700",
    bg: "bg-emerald-50 border-emerald-200",
  },
};

export default function DashboardPage() {
  const [jds, setJds] = useState<JDListItem[]>([]);
  const [pendingJDs, setPendingJDs] = useState<JDListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<
    "my_jds" | "team_approvals" | "hr_approvals"
  >("my_jds");
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const user = isMounted ? getCurrentUser() : null;
  const role = user?.role || "employee";

  useEffect(() => {
    if (!isMounted) return;
    async function load() {
      try {
        setLoading(true);
        const id = getOrCreateEmployeeId();

        // Load personal JDs
        const data = await fetchEmployeeJDs(id);
        setJds(data || []);

        // Load Pending Approval JDs based on role
        if (role === "manager") {
          const pending = await fetchManagerPendingJDs(id);
          setPendingJDs(pending || []);
        } else if (role === "hr") {
          const pending = await fetchHRPendingJDs();
          setPendingJDs(pending || []);
        }
      } catch (err) {
        console.error("Failed to load JDs:", err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [role]);

  // Aggregate counts based on role.
  // Employees only see their own stats. Managers/HR see stats representing their active queue + history.
  const dataSource = role === "employee" ? jds : pendingJDs;

  const draftCount = dataSource.filter(
    (j) =>
      j.status === "draft" ||
      j.status === "jd_generated" ||
      j.status === "manager_rejected" ||
      j.status === "hr_rejected",
  ).length;

  const inReviewCount = dataSource.filter(
    (j) => j.status === "sent_to_manager" || j.status === "sent_to_hr",
  ).length;

  const approvedCount = dataSource.filter(
    (j) => j.status === "approved",
  ).length;

  const displayJDs = activeTab === "my_jds" ? jds : pendingJDs;

  if (!isMounted) return null;

  return (
    <div className="h-[calc(100vh-3rem)] md:h-[calc(100vh)] overflow-y-auto bg-surface-50">
      <div className="max-w-6xl mx-auto pt-20 pb-10 px-4 sm:px-8 md:pt-10 animate-in fade-in slide-in-from-bottom-4 duration-700">
        {/* Welcome Header */}
        <div className="mb-10 flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div>
            <h1 className="text-3xl sm:text-4xl font-black text-surface-900 tracking-tight flex flex-wrap items-center gap-3">
              JD Intelligence
              <span className="text-xs font-bold px-3 py-1 bg-gradient-to-r from-primary-500 to-primary-600 text-white rounded-full uppercase tracking-widest shadow-sm">
                {role}
              </span>
            </h1>
            <p className="mt-3 text-lg font-medium text-surface-500">
              Welcome back,{" "}
              <span className="text-surface-700 font-bold">
                {user?.name || "Team Member"}
              </span>
              . Ready to shape the future of your team?
            </p>
          </div>
        </div>

        {/* Quick Action */}
        <Link
          href="/questionnaire"
          className="group relative overflow-hidden flex items-center justify-between p-8 bg-gradient-to-r from-primary-600 via-primary-700 to-indigo-800 rounded-3xl text-white shadow-xl shadow-primary-900/20 hover:shadow-2xl hover:shadow-primary-900/40 hover:-translate-y-1 transition-all duration-300 mb-10"
        >
          <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20 mix-blend-overlay"></div>
          <div className="relative z-10 flex flex-col sm:flex-row items-start sm:items-center gap-4 sm:gap-6">
            <div className="w-16 h-16 shrink-0 bg-white/10 backdrop-blur-md rounded-2xl flex items-center justify-center border border-white/20 group-hover:scale-110 transition-transform duration-500">
              <Plus className="w-8 h-8 text-white" />
            </div>
            <div>
              <h2 className="text-xl sm:text-2xl font-black tracking-tight">
                Start New JD Interview
              </h2>
              <p className="text-primary-100 text-base font-medium mt-1 opacity-90">
                Answer guided questions to generate a hyper-professional Job
                Description instantly.
              </p>
            </div>
          </div>
          <div className="hidden sm:flex relative z-10 w-12 h-12 shrink-0 rounded-full bg-white/10 items-center justify-center backdrop-blur-md border border-white/20 group-hover:bg-white/20 transition-colors">
            <ArrowRight className="w-6 h-6 text-white group-hover:translate-x-1 transition-transform duration-300" />
          </div>
        </Link>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
          {/* Drafts */}
          <div className="bg-white rounded-3xl p-6 shadow-sm border border-surface-200 hover:shadow-md transition-shadow">
            <div className="flex items-center gap-4 mb-4">
              <div className="w-12 h-12 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center border border-amber-100/50">
                <FileText className="w-5 h-5" />
              </div>
              <div>
                <span className="text-sm font-bold text-surface-500 uppercase tracking-widest">
                  Drafts
                </span>
                <p className="text-4xl font-black text-surface-900 mt-0.5">
                  {draftCount}
                </p>
              </div>
            </div>
          </div>
          {/* In Review */}
          <div className="bg-white rounded-3xl p-6 shadow-sm border border-surface-200 hover:shadow-md transition-shadow">
            <div className="flex items-center gap-4 mb-4">
              <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center border border-blue-100/50">
                <MessageSquare className="w-5 h-5" />
              </div>
              <div>
                <span className="text-sm font-bold text-surface-500 uppercase tracking-widest">
                  In Review
                </span>
                <p className="text-4xl font-black text-surface-900 mt-0.5">
                  {inReviewCount}
                </p>
              </div>
            </div>
          </div>
          {/* Approved */}
          <div className="bg-white rounded-3xl p-6 shadow-sm border border-surface-200 hover:shadow-md transition-shadow">
            <div className="flex items-center gap-4 mb-4">
              <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center border border-emerald-100/50">
                <Briefcase className="w-5 h-5" />
              </div>
              <div>
                <span className="text-sm font-bold text-surface-500 uppercase tracking-widest">
                  Approved
                </span>
                <p className="text-4xl font-black text-surface-900 mt-0.5">
                  {approvedCount}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Multi-Role Tabs */}
        {(role === "manager" || role === "hr") && (
          <div className="flex overflow-x-auto gap-3 mb-8 bg-surface-200/50 p-1.5 rounded-2xl w-full sm:w-fit custom-scrollbar pb-2 sm:pb-1.5">
            <button
              onClick={() => setActiveTab("my_jds")}
              className={`whitespace-nowrap px-5 py-2.5 text-sm font-bold rounded-xl transition-all ${
                activeTab === "my_jds"
                  ? "bg-white text-surface-900 shadow-sm"
                  : "text-surface-500 hover:text-surface-700 hover:bg-surface-200/50"
              }`}
            >
              My JDs
            </button>
            {role === "manager" && (
              <button
                onClick={() => setActiveTab("team_approvals")}
                className={`whitespace-nowrap px-5 py-2.5 text-sm font-bold rounded-xl transition-all flex items-center gap-2 ${
                  activeTab === "team_approvals"
                    ? "bg-white text-surface-900 shadow-sm"
                    : "text-surface-500 hover:text-surface-700 hover:bg-surface-200/50"
                }`}
              >
                Team JDs
                {pendingJDs.length > 0 && (
                  <span className="bg-primary-500 text-white text-[11px] px-2 py-0.5 rounded-full font-black">
                    {pendingJDs.length}
                  </span>
                )}
              </button>
            )}
            {role === "hr" && (
              <button
                onClick={() => setActiveTab("hr_approvals")}
                className={`whitespace-nowrap px-5 py-2.5 text-sm font-bold rounded-xl transition-all flex items-center gap-2 ${
                  activeTab === "hr_approvals"
                    ? "bg-white text-surface-900 shadow-sm"
                    : "text-surface-500 hover:text-surface-700 hover:bg-surface-200/50"
                }`}
              >
                HR Review Queue
                {pendingJDs.length > 0 && (
                  <span className="bg-primary-500 text-white text-[11px] px-2 py-0.5 rounded-full font-black">
                    {pendingJDs.length}
                  </span>
                )}
              </button>
            )}
          </div>
        )}

        {/* JD List Area */}
        <div className="bg-white rounded-3xl border border-surface-200 shadow-premium overflow-hidden">
          <div className="px-4 sm:px-8 py-5 sm:py-6 border-b border-surface-100 flex flex-col sm:flex-row sm:items-center justify-between bg-surface-50/50 gap-4">
            <h2 className="text-lg sm:text-xl font-black text-surface-900 tracking-tight">
              {activeTab === "my_jds"
                ? "Your Job Descriptions"
                : role === "hr"
                  ? "Documents in your HR Queue"
                  : "Your Team's Documents"}
            </h2>
          </div>

          {loading ? (
            <div className="p-16 flex flex-col items-center justify-center gap-4">
              <Loader2 className="w-8 h-8 text-primary-500 animate-spin" />
              <p className="text-surface-500 font-medium">
                Loading documents...
              </p>
            </div>
          ) : displayJDs.length === 0 ? (
            <div className="p-16 text-center">
              <div className="w-20 h-20 bg-surface-50 rounded-3xl flex items-center justify-center mx-auto mb-6 border border-surface-100">
                <FileText className="w-10 h-10 text-surface-300" />
              </div>
              <h3 className="text-lg font-bold text-surface-800 mb-2">
                {activeTab === "my_jds" ? "No Documents Yet" : "All Caught Up!"}
              </h3>
              <p className="text-base text-surface-400 max-w-sm mx-auto">
                {activeTab === "my_jds"
                  ? "Start a new interview by clicking the button above to generate your first document."
                  : "There are no pending documents waiting for your review."}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-surface-100">
              {displayJDs.map((jdItem) => {
                const config =
                  STATUS_CONFIG[jdItem.status] || STATUS_CONFIG.draft;
                return (
                  <Link
                    key={jdItem.id}
                    href={`/jd/${jdItem.id}`}
                    className="group flex flex-col sm:flex-row sm:items-center justify-between p-6 sm:px-8 hover:bg-surface-50/60 transition-colors"
                  >
                    <div className="flex items-center gap-5">
                      <div className="w-12 h-12 bg-surface-100 rounded-2xl flex items-center justify-center group-hover:bg-white group-hover:shadow-sm transition-all border border-transparent group-hover:border-surface-200">
                        <Briefcase className="w-6 h-6 text-surface-400 group-hover:text-primary-600 transition-colors" />
                      </div>
                      <div>
                        <h3 className="text-base font-bold text-surface-900 group-hover:text-primary-700 transition-colors">
                          {jdItem.title || "Untitled JD"}
                        </h3>
                        <div className="flex flex-wrap items-center gap-2 sm:gap-3 mt-1.5">
                          <span
                            className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-black uppercase tracking-widest border ${config.bg} ${config.color}`}
                          >
                            <span className="w-1.5 h-1.5 rounded-full bg-current" />
                            {config.label}
                          </span>
                          <span className="flex items-center gap-1.5 text-[12px] font-bold text-surface-400">
                            <Clock className="w-3.5 h-3.5" />
                            {jdItem.updated_at
                              ? new Date(jdItem.updated_at).toLocaleDateString(
                                  "en-US",
                                  {
                                    month: "short",
                                    day: "numeric",
                                    year: "numeric",
                                  },
                                )
                              : "—"}
                          </span>
                          <span className="text-[12px] font-bold text-surface-400 bg-surface-100 px-2 py-0.5 rounded-md">
                            v{jdItem.version}
                          </span>
                        </div>
                      </div>
                    </div>
                    <ArrowRight className="w-5 h-5 text-surface-300 group-hover:text-primary-500 group-hover:translate-x-1 transition-all mt-4 sm:mt-0" />
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
