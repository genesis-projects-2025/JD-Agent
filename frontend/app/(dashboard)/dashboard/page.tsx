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
    label: "Sent to Manager",
    color: "text-blue-700",
    bg: "bg-blue-50 border-blue-200",
  },
  approved: {
    label: "Approved",
    color: "text-emerald-700",
    bg: "bg-emerald-50 border-emerald-200",
  },
};

export default function DashboardPage() {
  const [jds, setJds] = useState<JDListItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const { default: axios } = await import("axios");
        const api = axios.create({
          baseURL: process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000",
        });
        const res = await api.get("/jd/list");
        setJds(res.data || []);
      } catch (err) {
        console.error("Failed to load JDs:", err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const draftCount = jds.filter(
    (j) => j.status === "draft" || j.status === "jd_generated",
  ).length;
  const sentCount = jds.filter((j) => j.status === "sent_to_manager").length;
  const approvedCount = jds.filter((j) => j.status === "approved").length;

  return (
    <div className="h-[calc(100vh-3rem)] overflow-y-auto">
      <div className="max-w-5xl mx-auto py-8 px-6">
        {/* Welcome Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-neutral-900 tracking-tight">
            JD Intelligence Agent
          </h1>
          <p className="mt-2 text-neutral-500">
            Create, manage, and track your Job Descriptions
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
                Drafts
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
                Sent to Manager
              </span>
            </div>
            <p className="text-3xl font-bold text-neutral-900">{sentCount}</p>
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

        {/* Recent JDs */}
        <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm">
          <div className="px-6 py-5 border-b border-neutral-100">
            <h2 className="text-lg font-semibold text-neutral-900">
              Recent Job Descriptions
            </h2>
          </div>

          {loading ? (
            <div className="p-12 flex items-center justify-center">
              <Loader2 className="w-6 h-6 text-blue-600 animate-spin" />
            </div>
          ) : jds.length === 0 ? (
            <div className="p-12 text-center">
              <div className="w-16 h-16 bg-neutral-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <FileText className="w-8 h-8 text-neutral-300" />
              </div>
              <h3 className="text-sm font-semibold text-neutral-700 mb-1">
                No JDs Yet
              </h3>
              <p className="text-sm text-neutral-400">
                Start a JD interview to create your first one
              </p>
            </div>
          ) : (
            <div className="divide-y divide-neutral-100">
              {jds.map((jdItem) => {
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
