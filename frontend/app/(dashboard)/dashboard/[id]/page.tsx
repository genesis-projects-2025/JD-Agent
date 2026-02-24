// app/(dashboard)/dashboard/[id]/page.tsx - ENTERPRISE REDESIGN

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  FileText,
  MessageSquare,
  Clock,
  ArrowRight,
  Briefcase,
  Loader2,
  Plus,
  TrendingUp,
  ShieldCheck,
} from "lucide-react";

import { fetchEmployeeJDs } from "@/lib/api";

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
  { label: string; color: string; bg: string; icon: any }
> = {
  draft: {
    label: "Interviewer Active",
    color: "text-amber-700",
    bg: "bg-amber-50 border-amber-100",
    icon: Clock,
  },
  sent_to_manager: {
    label: "Under Review",
    color: "text-blue-700",
    bg: "bg-blue-50 border-blue-100",
    icon: ShieldCheck,
  },
  approved: {
    label: "Verified Asset",
    color: "text-emerald-700",
    bg: "bg-emerald-50 border-emerald-100",
    icon: FileText,
  },
  jd_generated: {
    label: "Architected",
    color: "text-primary-600",
    bg: "bg-primary-50 border-primary-100",
    icon: TrendingUp,
  },
};

export default function DynamicDashboardPage() {
  const params = useParams();
  const employeeId = params.id as string;

  const [jds, setJds] = useState<JDListItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      if (!employeeId) return;
      try {
        const data = await fetchEmployeeJDs(employeeId);
        setJds(data || []);
      } catch (err) {
        console.error("Failed to load JDs:", err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [employeeId]);

  const draftCount = jds.filter(
    (j) => j.status === "draft" || j.status === "jd_generated",
  ).length;
  const sentCount = jds.filter((j) => j.status === "sent_to_manager").length;
  const approvedCount = jds.filter((j) => j.status === "approved").length;

  if (loading) {
    return (
      <div className="h-[calc(100vh-8rem)] flex items-center justify-center">
        <div className="text-center group">
          <div className="relative mb-4">
            <div className="absolute inset-0 bg-primary-100 rounded-full animate-ping opacity-20 scale-150" />
            <Loader2 className="w-10 h-10 text-primary-600 animate-spin mx-auto relative z-10" />
          </div>
          <p className="text-sm font-bold text-surface-400 uppercase tracking-widest">
            Fetching Enterprise Records...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-10 animate-in fade-in slide-in-from-bottom-4 duration-700">
      {/* Dynamic Header Overlay */}
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-6 pb-2">
        <div>
          <div className="flex items-center gap-2 mb-3">
            <span className="px-2.5 py-1 bg-primary-50 text-primary-600 text-[10px] font-black uppercase tracking-[0.2em] rounded-md border border-primary-100">
              Employee Insight Engine
            </span>
            <span className="text-[10px] text-surface-400 font-bold tracking-tight">
              ID: {employeeId}
            </span>
          </div>
          <h1 className="text-4xl font-black text-surface-900 tracking-tight">
            JD Intelligence Agent
          </h1>
          <p className="text-surface-500 mt-2 font-medium">
            Strategic Role Architecture & Document Lifecycle Management
          </p>
        </div>

        <Link
          href="/questionnaire"
          className="group flex items-center gap-3 px-8 py-4 bg-primary-600 text-white rounded-2xl font-bold hover:bg-primary-700 hover:shadow-2xl hover:shadow-primary-500/20 transition-all duration-300 active:scale-[0.98]"
        >
          <Plus className="w-5 h-5 group-hover:rotate-90 transition-transform" />
          Initialize New JD
        </Link>
      </header>

      {/* Metric Cards Portfolio */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {[
          {
            label: "Archived Drafts",
            value: draftCount,
            icon: Clock,
            color: "text-amber-600",
            bg: "bg-amber-50",
          },
          {
            label: "Review Pending",
            value: sentCount,
            icon: ShieldCheck,
            color: "text-primary-600",
            bg: "bg-primary-50",
          },
          {
            label: "Verified Assets",
            value: approvedCount,
            icon: FileText,
            color: "text-emerald-600",
            bg: "bg-emerald-50",
          },
        ].map((stat, i) => (
          <div
            key={i}
            className="bg-white p-6 rounded-3xl border border-surface-100 shadow-premium hover:shadow-xl transition-all duration-500 group"
          >
            <div className="flex items-center gap-4">
              <div
                className={`w-14 h-14 ${stat.bg} ${stat.color} rounded-2xl flex items-center justify-center group-hover:scale-110 transition-transform`}
              >
                <stat.icon className="w-7 h-7" />
              </div>
              <div>
                <p className="text-[11px] font-black text-surface-400 uppercase tracking-widest leading-none mb-2">
                  {stat.label}
                </p>
                <p className="text-3xl font-black text-surface-900 leading-none">
                  {stat.value}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Documents Section */}
      <div className="space-y-6">
        <div className="flex items-center justify-between px-2 text-surface-900">
          <h2 className="text-xl font-bold flex items-center gap-3">
            <span className="w-1.5 h-6 bg-primary-600 rounded-full" />
            Active Role Portfolio
          </h2>
        </div>

        {jds.length === 0 ? (
          <div className="bg-surface-50 rounded-[40px] p-20 text-center border-2 border-dashed border-surface-200">
            <div className="w-20 h-20 bg-white rounded-3xl flex items-center justify-center mx-auto mb-6 shadow-sm border border-surface-100">
              <MessageSquare className="w-10 h-10 text-surface-300" />
            </div>
            <h3 className="text-xl font-bold text-surface-900 mb-2 tracking-tight">
              No intelligence found
            </h3>
            <p className="text-surface-500 max-w-sm mx-auto font-medium">
              Start your first role analysis to begin generating
              enterprise-grade Job Descriptions.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {jds.map((jd) => {
              const config = STATUS_CONFIG[jd.status] || STATUS_CONFIG.draft;
              return (
                <Link
                  key={jd.id}
                  href={
                    ["jd_generated", "sent_to_manager", "approved"].includes(
                      jd.status,
                    )
                      ? `/jd/${jd.id}`
                      : `/questionnaire/${jd.id}`
                  }
                  className="group bg-white rounded-3xl p-6 border border-surface-100 shadow-premium hover:shadow-2xl hover:border-primary-200 transition-all duration-500 flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-start justify-between mb-6">
                      <div
                        className={`px-4 py-1.5 rounded-xl border ${config.bg} ${config.color} flex items-center gap-2 shadow-sm`}
                      >
                        <config.icon className="w-3.5 h-3.5 font-bold" />
                        <span className="text-[10px] font-black uppercase tracking-widest">
                          {config.label}
                        </span>
                      </div>
                      <div className="text-[10px] font-black text-surface-300 uppercase tracking-tighter">
                        v{jd.version}.0
                      </div>
                    </div>

                    <h3 className="text-xl font-bold text-surface-900 mb-2 group-hover:text-primary-600 transition-colors tracking-tight">
                      {jd.title || "Untitled Strategic Role"}
                    </h3>
                    <p className="text-xs text-surface-400 font-medium mb-8 flex items-center gap-2">
                      <Clock className="w-3.5 h-3.5" />
                      Updated{" "}
                      {jd.updated_at
                        ? new Date(jd.updated_at).toLocaleDateString()
                        : "Internal"}
                    </p>
                  </div>

                  <div className="flex items-center justify-between pt-6 border-t border-surface-50">
                    <span className="text-xs font-bold text-primary-600 uppercase tracking-widest group-hover:translate-x-1 transition-transform inline-flex items-center gap-2">
                      View Architecture
                      <ArrowRight className="w-4 h-4" />
                    </span>
                    <div className="w-10 h-10 bg-surface-50 rounded-xl flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                      <FileText className="w-5 h-5 text-surface-400" />
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
