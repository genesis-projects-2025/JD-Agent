"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  FileText, Clock, CheckCircle2, TrendingUp, TrendingDown,
  Plus, ArrowRight, Loader2, BarChart3, Users, Zap,
  Activity, ChevronRight,
} from "lucide-react";
import { getDashboardStats, getRecentActivity, getJDs } from "@/lib/api";
import { DashboardStats, ActivityEvent, JDRecord } from "@/types/jd";

/* ── Helpers ─────────────────────────────────────────────────────── */

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const activityConfig: Record<
  ActivityEvent["type"],
  { label: string; color: string; dot: string }
> = {
  created: { label: "started interview", color: "text-sky-600", dot: "bg-sky-500" },
  submitted: { label: "submitted JD", color: "text-amber-600", dot: "bg-amber-500" },
  approved: { label: "JD approved", color: "text-emerald-600", dot: "bg-emerald-500" },
  rejected: { label: "JD returned", color: "text-rose-600", dot: "bg-rose-500" },
  edited: { label: "edited JD", color: "text-violet-600", dot: "bg-violet-500" },
};

const statusConfig: Record<
  JDRecord["status"],
  { label: string; bg: string; text: string }
> = {
  pending: { label: "Pending Review", bg: "bg-amber-50", text: "text-amber-700" },
  approved: { label: "Approved", bg: "bg-emerald-50", text: "text-emerald-700" },
  rejected: { label: "Needs Revision", bg: "bg-rose-50", text: "text-rose-700" },
  in_progress: { label: "In Progress", bg: "bg-sky-50", text: "text-sky-700" },
};

/* ── Stat Card ───────────────────────────────────────────────────── */

function StatCard({
  icon: Icon,
  label,
  value,
  trend,
  trendLabel,
  accentClass,
  loading,
}: {
  icon: React.ElementType;
  label: string;
  value: number | string;
  trend?: number;
  trendLabel?: string;
  accentClass: string;
  loading: boolean;
}) {
  const positive = (trend ?? 0) >= 0;
  return (
    <div className="bg-white rounded-2xl border border-neutral-200 p-6 shadow-sm hover:shadow-md transition-shadow flex flex-col gap-4">
      <div className="flex items-start justify-between">
        <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${accentClass}`}>
          <Icon className="w-6 h-6" />
        </div>
        {trend !== undefined && (
          <div className={`flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full ${positive ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>
            {positive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {Math.abs(trend)}%
          </div>
        )}
      </div>
      {loading ? (
        <div className="h-9 w-20 bg-neutral-100 rounded-lg animate-pulse" />
      ) : (
        <div>
          <div className="text-3xl font-bold text-neutral-900 tabular-nums">{value}</div>
          <div className="text-sm text-neutral-500 mt-1">{label}</div>
          {trendLabel && (
            <div className="text-xs text-neutral-400 mt-0.5">{trendLabel}</div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Mini Bar Chart ──────────────────────────────────────────────── */

const weekData = [
  { day: "Mon", count: 2 },
  { day: "Tue", count: 5 },
  { day: "Wed", count: 3 },
  { day: "Thu", count: 7 },
  { day: "Fri", count: 4 },
  { day: "Sat", count: 1 },
  { day: "Sun", count: 3 },
];
const maxCount = Math.max(...weekData.map((d) => d.count));

function WeeklyChart() {
  return (
    <div className="flex items-end gap-2 h-16">
      {weekData.map((d) => (
        <div key={d.day} className="flex-1 flex flex-col items-center gap-1">
          <div
            className="w-full bg-blue-600 rounded-t-sm opacity-80 hover:opacity-100 transition-opacity cursor-default"
            style={{ height: `${(d.count / maxCount) * 56}px` }}
            title={`${d.count} JDs`}
          />
          <span className="text-[10px] text-neutral-400">{d.day}</span>
        </div>
      ))}
    </div>
  );
}

/* ── Completion Ring ─────────────────────────────────────────────── */

function Ring({ pct }: { pct: number }) {
  const r = 28;
  const circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;
  return (
    <svg width="72" height="72" className="-rotate-90">
      <circle cx="36" cy="36" r={r} fill="none" stroke="#e5e7eb" strokeWidth="6" />
      <circle
        cx="36" cy="36" r={r} fill="none"
        stroke="#2563eb" strokeWidth="6" strokeLinecap="round"
        strokeDasharray={`${dash} ${circ - dash}`}
        style={{ transition: "stroke-dasharray 1s ease" }}
      />
    </svg>
  );
}

/* ── Page ────────────────────────────────────────────────────────── */
const getInitials = (name?: string) => {
  if (!name) return "?";
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase();
};

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [recentJDs, setRecentJDs] = useState<JDRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const [s, a, jds] = await Promise.all([
        getDashboardStats(),
        getRecentActivity(),
        getJDs(),
      ]);
      setStats(s);
      setActivity(a);
      setRecentJDs(jds.slice(0, 5));
      setLoading(false);
    }
    load();
  }, []);

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto px-1 py-6 space-y-8">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-neutral-900">Dashboard</h1>
            <p className="text-sm text-neutral-500 mt-0.5">
              {new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
            </p>
          </div>
          <Link
            href="/questionnaire"
            className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-xl font-semibold text-sm hover:bg-blue-700 transition-colors shadow-lg shadow-blue-900/20"
          >
            <Plus className="w-4 h-4" />
            New JD Interview
          </Link>
        </div>

        {/* Stat Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            icon={FileText}
            label="Total JDs Created"
            value={stats?.total_jds ?? 0}
            trend={stats?.trend_total}
            trendLabel="vs last month"
            accentClass="bg-blue-50 text-blue-600"
            loading={loading}
          />
          <StatCard
            icon={Clock}
            label="Pending Approvals"
            value={stats?.pending_approvals ?? 0}
            accentClass="bg-amber-50 text-amber-600"
            loading={loading}
          />
          <StatCard
            icon={CheckCircle2}
            label="Approved This Month"
            value={stats?.approved_this_month ?? 0}
            trend={stats?.trend_approved}
            trendLabel="vs last month"
            accentClass="bg-emerald-50 text-emerald-600"
            loading={loading}
          />
          <StatCard
            icon={Activity}
            label="In Progress"
            value={stats?.in_progress ?? 0}
            accentClass="bg-violet-50 text-violet-600"
            loading={loading}
          />
        </div>

        {/* Middle Row — Chart + Metrics + Activity */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* Weekly Volume */}
          <div className="bg-white rounded-2xl border border-neutral-200 p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-semibold text-neutral-900">Weekly Volume</h3>
                <p className="text-xs text-neutral-400 mt-0.5">JDs created per day</p>
              </div>
              <BarChart3 className="w-5 h-5 text-neutral-300" />
            </div>
            {loading ? (
              <div className="h-20 bg-neutral-100 rounded-lg animate-pulse" />
            ) : (
              <WeeklyChart />
            )}
          </div>

          {/* Key Metrics */}
          <div className="bg-white rounded-2xl border border-neutral-200 p-6 shadow-sm space-y-5">
            <h3 className="font-semibold text-neutral-900">Key Metrics</h3>

            {/* Approval Rate */}
            <div className="flex items-center gap-4">
              {loading ? (
                <div className="w-[72px] h-[72px] bg-neutral-100 rounded-full animate-pulse flex-shrink-0" />
              ) : (
                <div className="relative flex-shrink-0">
                  <Ring pct={stats?.approval_rate ?? 0} />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-sm font-bold text-neutral-900">{stats?.approval_rate}%</span>
                  </div>
                </div>
              )}
              <div>
                <div className="text-sm font-semibold text-neutral-700">Approval Rate</div>
                <div className="text-xs text-neutral-400 mt-0.5">JDs approved on first submission</div>
              </div>
            </div>

            <div className="h-px bg-neutral-100" />

            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-sky-50 rounded-xl flex items-center justify-center flex-shrink-0">
                <Zap className="w-4 h-4 text-sky-600" />
              </div>
              <div>
                <div className="text-sm font-semibold text-neutral-700">
                  {loading ? "—" : `${stats?.avg_completion_minutes} min`}
                </div>
                <div className="text-xs text-neutral-400">Avg. interview completion time</div>
              </div>
            </div>
          </div>

          {/* Activity Feed */}
          <div className="bg-white rounded-2xl border border-neutral-200 p-6 shadow-sm">
            <h3 className="font-semibold text-neutral-900 mb-4">Live Activity</h3>
            {loading ? (
              <div className="space-y-3">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="h-10 bg-neutral-100 rounded-lg animate-pulse" />
                ))}
              </div>
            ) : (
              <div className="space-y-3 overflow-y-auto max-h-48">
                {activity.map((ev) => {
                  const cfg = activityConfig[ev.type];
                  return (
                    <div key={ev.id} className="flex items-start gap-3">
                      <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${cfg.dot}`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-neutral-700 leading-tight">
                          <span className="font-medium">{ev.employee_name}</span>{" "}
                          <span className={cfg.color}>{cfg.label}</span>
                          {ev.type !== "created" && (
                            <span className="text-neutral-500"> — {ev.role_title}</span>
                          )}
                        </p>
                        <p className="text-xs text-neutral-400 mt-0.5">{timeAgo(ev.timestamp)}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Recent JDs Table */}
        <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-100">
            <h3 className="font-semibold text-neutral-900">Recent Job Descriptions</h3>
            <Link
              href="/approvals"
              className="flex items-center gap-1 text-sm text-blue-600 font-medium hover:text-blue-700 transition-colors"
            >
              View all <ChevronRight className="w-4 h-4" />
            </Link>
          </div>

          {loading ? (
            <div className="p-6 space-y-4">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="h-12 bg-neutral-100 rounded-lg animate-pulse" />
              ))}
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="text-xs text-neutral-400 uppercase tracking-wide border-b border-neutral-100">
                  <th className="px-6 py-3 text-left font-medium">Employee</th>
                  <th className="px-6 py-3 text-left font-medium">Role</th>
                  <th className="px-6 py-3 text-left font-medium hidden md:table-cell">Department</th>
                  <th className="px-6 py-3 text-left font-medium hidden lg:table-cell">Updated</th>
                  <th className="px-6 py-3 text-left font-medium">Status</th>
                  <th className="px-6 py-3 text-left font-medium hidden md:table-cell">Progress</th>
                  <th className="px-6 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-50">
                {recentJDs.map((jd) => {
                  const sc = statusConfig[jd.status];
                  return (
                    <tr key={jd.id} className="hover:bg-neutral-50/50 transition-colors group">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-neutral-100 rounded-full flex items-center justify-center text-xs font-bold text-neutral-600 flex-shrink-0">
                            {getInitials(jd.employee_name)}
                          </div>
                          <span className="text-sm font-medium text-neutral-800 truncate max-w-[100px]">
                            {jd.employee_name}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-sm text-neutral-700 font-medium">{jd.role_title}</span>
                      </td>
                      <td className="px-6 py-4 hidden md:table-cell">
                        <span className="text-sm text-neutral-500">{jd.department}</span>
                      </td>
                      <td className="px-6 py-4 hidden lg:table-cell">
                        <span className="text-sm text-neutral-400">{timeAgo(jd.updated_at)}</span>
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={`text-xs font-semibold px-2.5 py-1 rounded-full ${sc?.bg || "bg-gray-100"
                            } ${sc?.text || "text-gray-600"}`}
                        >
                          {sc?.label || "Unknown"}
                        </span>
                      </td>
                      <td className="px-6 py-4 hidden md:table-cell">
                        <div className="flex items-center gap-2 w-24">
                          <div className="flex-1 h-1.5 bg-neutral-100 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-blue-500 rounded-full"
                              style={{ width: `${jd.completion_percentage}%` }}
                            />
                          </div>
                          <span className="text-xs text-neutral-400">{jd.completion_percentage}%</span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <Link
                          href="/approvals"
                          className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 text-xs text-blue-600 font-medium whitespace-nowrap"
                        >
                          View <ArrowRight className="w-3 h-3" />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Quick Actions */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            {
              icon: Plus,
              title: "Start New Interview",
              desc: "Create a Job Description from a guided AI interview",
              href: "/questionnaire",
              accent: "bg-blue-600 text-white",
              hover: "hover:bg-blue-700",
            },
            {
              icon: CheckCircle2,
              title: "Review Pending JDs",
              desc: `${stats?.pending_approvals ?? 0} JDs waiting for your approval`,
              href: "/approvals",
              accent: "bg-amber-500 text-white",
              hover: "hover:bg-amber-600",
            },
            {
              icon: Users,
              title: "All Job Descriptions",
              desc: "Browse and search the complete JD library",
              href: "/approvals",
              accent: "bg-neutral-800 text-white",
              hover: "hover:bg-neutral-900",
            },
          ].map((action) => {
            const Icon = action.icon;
            return (
              <Link
                key={action.href + action.title}
                href={action.href}
                className={`flex items-center gap-4 p-5 rounded-2xl ${action.accent} ${action.hover} transition-colors shadow-sm group`}
              >
                <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center flex-shrink-0">
                  <Icon className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm">{action.title}</div>
                  <div className="text-xs opacity-75 mt-0.5 truncate">{action.desc}</div>
                </div>
                <ArrowRight className="w-4 h-4 opacity-50 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" />
              </Link>
            );
          })}
        </div>

      </div>
    </div>
  );
}
