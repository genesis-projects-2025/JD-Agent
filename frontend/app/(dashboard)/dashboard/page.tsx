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
    label: "Needs Revision",
    color: "text-red-700",
    bg: "bg-red-50 border-red-200",
  },
  sent_to_hr: {
    label: "HR Review",
    color: "text-purple-700",
    bg: "bg-purple-50 border-purple-200",
  },
  hr_rejected: {
    label: "Action Required",
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

  const user = getCurrentUser();
  const role = user?.role || "employee";

  useEffect(() => {
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

  const draftCount = jds.filter(
    (j) =>
      j.status === "draft" ||
      j.status === "jd_generated" ||
      j.status.includes("rejected"),
  ).length;
  const inReviewCount = jds.filter(
    (j) => j.status === "sent_to_manager" || j.status === "sent_to_hr",
  ).length;
  const approvedCount = jds.filter((j) => j.status === "approved").length;

  const displayJDs = activeTab === "my_jds" ? jds : pendingJDs;

  return (
    <div className="h-[calc(100vh-3rem)] overflow-y-auto">
      <div className="max-w-5xl mx-auto py-8 px-6">
        {/* Welcome Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-neutral-900 tracking-tight">
            JD Intelligence
            <span className="ml-3 text-sm font-bold px-3 py-1 bg-neutral-100 text-neutral-600 rounded-full align-middle uppercase tracking-widest border border-neutral-200">
              {role}
            </span>
          </h1>
          <p className="mt-2 text-neutral-500">
            Welcome back, {user?.name || "Team Member"}
          </p>
        </div>

        {/* Quick Action */}
        <Link
          href="/questionnaire"
          className="group flex items-center justify-between p-6 bg-gradient-to-r from-blue-600 to-blue-700 rounded-2xl text-white shadow-xl shadow-blue-600/20 hover:shadow-2xl hover:shadow-blue-600/30 transition-all mb-8"
        >
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-white/20 backdrop-blur-sm rounded-xl flex items-center justify-center">
              <Plus className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg font-bold">Start New JD Interview</h2>
              <p className="text-blue-100 text-sm mt-0.5">
                Answer questions to generate a professional Job Description
              </p>
            </div>
          </div>
          <ArrowRight className="w-5 h-5 text-blue-200 group-hover:translate-x-1 transition-transform" />
        </Link>

        {/* Stats Cards */}
        <div className="grid grid-cols-3 gap-4 mb-8">
          <div className="bg-white rounded-xl border border-neutral-200 p-5 shadow-sm">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-9 h-9 bg-amber-50 rounded-lg flex items-center justify-center">
                <FileText className="w-4.5 h-4.5 text-amber-600" />
              </div>
              <span className="text-sm font-medium text-neutral-500">
                Drafts / Revisions
              </span>
            </div>
            <p className="text-3xl font-bold text-neutral-900">{draftCount}</p>
          </div>
          <div className="bg-white rounded-xl border border-neutral-200 p-5 shadow-sm">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-9 h-9 bg-blue-50 rounded-lg flex items-center justify-center">
                <MessageSquare className="w-4.5 h-4.5 text-blue-600" />
              </div>
              <span className="text-sm font-medium text-neutral-500">
                In Review
              </span>
            </div>
            <p className="text-3xl font-bold text-neutral-900">
              {inReviewCount}
            </p>
          </div>
          <div className="bg-white rounded-xl border border-neutral-200 p-5 shadow-sm">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-9 h-9 bg-emerald-50 rounded-lg flex items-center justify-center">
                <Briefcase className="w-4.5 h-4.5 text-emerald-600" />
              </div>
              <span className="text-sm font-medium text-neutral-500">
                Approved
              </span>
            </div>
            <p className="text-3xl font-bold text-neutral-900">
              {approvedCount}
            </p>
          </div>
        </div>

        {/* Multi-Role Tabs */}
        {(role === "manager" || role === "hr") && (
          <div className="flex items-center gap-2 mb-6 border-b border-neutral-200 pb-px">
            <button
              onClick={() => setActiveTab("my_jds")}
              className={`px-4 py-3 text-sm font-bold border-b-2 transition-colors ${
                activeTab === "my_jds"
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-neutral-500 hover:text-neutral-700"
              }`}
            >
              My JDs
            </button>
            {role === "manager" && (
              <button
                onClick={() => setActiveTab("team_approvals")}
                className={`px-4 py-3 text-sm font-bold border-b-2 transition-colors flex items-center gap-2 ${
                  activeTab === "team_approvals"
                    ? "border-blue-600 text-blue-600"
                    : "border-transparent text-neutral-500 hover:text-neutral-700"
                }`}
              >
                Team Approvals
                {pendingJDs.length > 0 && (
                  <span className="bg-red-500 text-white text-[10px] px-2 py-0.5 rounded-full">
                    {pendingJDs.length}
                  </span>
                )}
              </button>
            )}
            {role === "hr" && (
              <button
                onClick={() => setActiveTab("hr_approvals")}
                className={`px-4 py-3 text-sm font-bold border-b-2 transition-colors flex items-center gap-2 ${
                  activeTab === "hr_approvals"
                    ? "border-blue-600 text-blue-600"
                    : "border-transparent text-neutral-500 hover:text-neutral-700"
                }`}
              >
                HR Review Queue
                {pendingJDs.length > 0 && (
                  <span className="bg-red-500 text-white text-[10px] px-2 py-0.5 rounded-full">
                    {pendingJDs.length}
                  </span>
                )}
              </button>
            )}
          </div>
        )}

        {/* JD List Area */}
        <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm">
          <div className="px-6 py-5 border-b border-neutral-100 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-neutral-900">
              {activeTab === "my_jds"
                ? "Your Job Descriptions"
                : "Requires Your Review"}
            </h2>
          </div>

          {loading ? (
            <div className="p-12 flex items-center justify-center">
              <Loader2 className="w-6 h-6 text-blue-600 animate-spin" />
            </div>
          ) : displayJDs.length === 0 ? (
            <div className="p-12 text-center">
              <div className="w-16 h-16 bg-neutral-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <FileText className="w-8 h-8 text-neutral-300" />
              </div>
              <h3 className="text-sm font-semibold text-neutral-700 mb-1">
                {activeTab === "my_jds" ? "No JDs Yet" : "All Caught Up!"}
              </h3>
              <p className="text-sm text-neutral-400">
                {activeTab === "my_jds"
                  ? "Start a JD interview to create your first one."
                  : "There are no JDs waiting for your approval right now."}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-neutral-100">
              {displayJDs.map((jdItem) => {
                const config =
                  STATUS_CONFIG[jdItem.status] || STATUS_CONFIG.draft;
                return (
                  <Link
                    key={jdItem.id}
                    href={`/jd/${jdItem.id}`}
                    className="group flex items-center justify-between px-6 py-4 hover:bg-neutral-50 transition-colors"
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 bg-neutral-50 rounded-lg flex items-center justify-center group-hover:bg-blue-50 transition-colors">
                        <Briefcase className="w-5 h-5 text-neutral-400 group-hover:text-blue-500 transition-colors" />
                      </div>
                      <div>
                        <h3 className="text-sm font-semibold text-neutral-900">
                          {jdItem.title || "Untitled JD"}
                        </h3>
                        <div className="flex items-center gap-3 mt-1">
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${config.bg} ${config.color}`}
                          >
                            <span className="w-1 h-1 rounded-full bg-current" />
                            {config.label}
                          </span>
                          <span className="flex items-center gap-1 text-xs text-neutral-400">
                            <Clock className="w-3 h-3" />
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
                          <span className="text-xs text-neutral-400">
                            v{jdItem.version}
                          </span>
                        </div>
                      </div>
                    </div>
                    <ArrowRight className="w-4 h-4 text-neutral-300 group-hover:text-neutral-500 group-hover:translate-x-0.5 transition-all" />
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
