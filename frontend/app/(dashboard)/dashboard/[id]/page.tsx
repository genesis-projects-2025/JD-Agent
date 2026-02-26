// app/(dashboard)/dashboard/[id]/page.tsx

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
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
  CheckCircle2,
  AlertTriangle,
  Users,
} from "lucide-react";

import {
  AuthUser,
  fetchEmployeeJDs,
  getCurrentUser,
  getJDs,
  getOrCreateEmployeeId,
  isHR,
  isManager,
  fetchEmployeeProfile,
} from "@/lib/api";

// ── Types ─────────────────────────────────────────────────────────────────────

type JDListItem = {
  id: string;
  title: string | null;
  status: string;
  version: number;
  updated_at: string | null;
  created_at: string | null;
  employee_name?: string;
  department?: string;
};

// ── Status config ─────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<
  string,
  { label: string; color: string; bg: string; icon: any }
> = {
  collecting: {
    label: "In Progress",
    color: "text-amber-700",
    bg: "bg-amber-50 border-amber-100",
    icon: Clock,
  },
  draft: {
    label: "Interviewer Active",
    color: "text-amber-700",
    bg: "bg-amber-50 border-amber-100",
    icon: Clock,
  },
  jd_generated: {
    label: "Architected",
    color: "text-primary-600",
    bg: "bg-primary-50 border-primary-100",
    icon: TrendingUp,
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
  rejected: {
    label: "Needs Revision",
    color: "text-red-700",
    bg: "bg-red-50 border-red-100",
    icon: AlertTriangle,
  },
};

// ── Shared JD card grid ───────────────────────────────────────────────────────

function JDGrid({
  jds,
  showEmployee,
}: {
  jds: JDListItem[];
  showEmployee: boolean;
}) {
  if (jds.length === 0) {
    return (
      <div className="bg-surface-50 rounded-[40px] p-20 text-center border-2 border-dashed border-surface-200">
        <div className="w-20 h-20 bg-white rounded-3xl flex items-center justify-center mx-auto mb-6 shadow-sm border border-surface-100">
          <MessageSquare className="w-10 h-10 text-surface-300" />
        </div>
        <h3 className="text-xl font-bold text-surface-900 mb-2 tracking-tight">
          No records found
        </h3>
        <p className="text-surface-500 max-w-sm mx-auto font-medium">
          No Job Descriptions match the current filter.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {jds.map((jd) => {
        const config = STATUS_CONFIG[jd.status] || STATUS_CONFIG.draft;
        const href = ["jd_generated", "sent_to_manager", "approved"].includes(
          jd.status,
        )
          ? `/jd/${jd.id}`
          : `/questionnaire/${jd.id}`;

        return (
          <Link
            key={jd.id}
            href={href}
            className="group bg-white rounded-3xl p-6 border border-surface-100 shadow-premium hover:shadow-2xl hover:border-primary-200 transition-all duration-500 flex flex-col justify-between"
          >
            <div>
              <div className="flex items-start justify-between mb-6">
                <div
                  className={`px-4 py-1.5 rounded-xl border ${config.bg} ${config.color} flex items-center gap-2 shadow-sm`}
                >
                  <config.icon className="w-3.5 h-3.5" />
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

              {/* Show employee name for manager/HR views */}
              {showEmployee && jd.employee_name && (
                <p className="text-xs text-primary-600 font-bold mb-1 flex items-center gap-1">
                  <Users className="w-3 h-3" />
                  {jd.employee_name}
                  {jd.department && (
                    <span className="text-surface-400 font-medium">
                      {" "}
                      · {jd.department}
                    </span>
                  )}
                </p>
              )}

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
  );
}

// ── Employee view — your original design ─────────────────────────────────────

function EmployeeView({
  employeeId,
  user,
}: {
  employeeId: string;
  user: AuthUser | null;
}) {
  const [jds, setJds] = useState<JDListItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchEmployeeJDs(employeeId)
      .then((d) => setJds(d || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [employeeId]);

  const draftCount = jds.filter((j) =>
    ["draft", "jd_generated", "collecting"].includes(j.status),
  ).length;
  const sentCount = jds.filter((j) => j.status === "sent_to_manager").length;
  const approvedCount = jds.filter((j) => j.status === "approved").length;

  if (loading) return <LoadingScreen />;

  return (
    <div className="max-w-7xl mx-auto space-y-10 animate-in fade-in slide-in-from-bottom-4 duration-700">
      {/* Header */}
      <header className="flex flex-col md:flex-row justify-between gap-6 pb-2">
        <div className="flex-1 max-w-2xl bg-white p-6 rounded-3xl border border-surface-200 shadow-sm flex items-start gap-6">
          <div className="w-16 h-16 bg-blue-100 text-blue-700 rounded-2xl flex items-center justify-center flex-shrink-0 font-extrabold text-2xl">
            {user?.name ? user.name.charAt(0).toUpperCase() : "U"}
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <span className="px-2.5 py-0.5 bg-surface-100 text-surface-600 text-[10px] font-black uppercase tracking-[0.1em] rounded-md">
                {employeeId}
              </span>
              {user?.department && (
                <span className="px-2.5 py-0.5 bg-blue-50 text-blue-700 text-[10px] font-black uppercase tracking-[0.1em] rounded-md">
                  {user.department}
                </span>
              )}
            </div>
            <h1 className="text-2xl font-black text-surface-900 tracking-tight mb-1">
              {user?.name || "Unknown Name"}
            </h1>
            <p className="text-sm font-bold text-blue-600 mb-3">
              {user?.role || "Employee"}
            </p>
            <div className="grid grid-cols-2 gap-y-2 text-xs font-medium text-surface-500">
              {user?.email && <p>📧 {user.email}</p>}
              {user?.phone_mobile && <p>📱 {user.phone_mobile}</p>}
              {user?.reporting_manager && (
                <p className="col-span-2 mt-1 pt-1 border-t border-surface-100">
                  <span className="font-bold text-surface-400 uppercase tracking-wider text-[10px] block mb-0.5">
                    Reporting To:
                  </span>
                  <span className="text-surface-700 font-bold">
                    {user.reporting_manager}
                  </span>{" "}
                  ({user.reporting_manager_code})
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-col justify-end">
          <Link
            href="/questionnaire"
            className="group flex items-center gap-3 px-8 py-4 bg-primary-600 text-white rounded-2xl font-bold hover:bg-primary-700 hover:shadow-2xl hover:shadow-primary-500/20 transition-all duration-300 active:scale-[0.98]"
          >
            <Plus className="w-5 h-5 group-hover:rotate-90 transition-transform" />
            Initialize New JD
          </Link>
        </div>
      </header>

      {/* Stats */}
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

      {/* JD grid */}
      <div className="space-y-6">
        <div className="flex items-center justify-between px-2">
          <h2 className="text-xl font-bold text-surface-900 flex items-center gap-3">
            <span className="w-1.5 h-6 bg-primary-600 rounded-full" />
            Active Role Portfolio
          </h2>
        </div>
        <JDGrid jds={jds} showEmployee={false} />
      </div>
    </div>
  );
}

// ── Manager view ──────────────────────────────────────────────────────────────

function ManagerView({ user }: { user: AuthUser }) {
  const [jds, setJds] = useState<JDListItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Managers see JDs sent to them for review
    getJDs({ status: "sent_to_manager" })
      .then((d) => setJds(d || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingScreen />;

  const pending = jds.filter((j) => j.status === "sent_to_manager").length;
  const approved = jds.filter((j) => j.status === "approved").length;

  return (
    <div className="max-w-7xl mx-auto space-y-10 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-6 pb-2">
        <div>
          <div className="flex items-center gap-2 mb-3">
            <span className="px-2.5 py-1 bg-blue-50 text-blue-700 text-[10px] font-black uppercase tracking-[0.2em] rounded-md border border-blue-100">
              Manager Review Queue
            </span>
            {user.department && (
              <span className="text-[10px] text-surface-400 font-bold">
                {user.department}
              </span>
            )}
          </div>
          <h1 className="text-4xl font-black text-surface-900 tracking-tight">
            Welcome, {user.name.split(" ")[0]}
          </h1>
          <p className="text-surface-500 mt-2 font-medium">
            Review and approve Job Descriptions from your team
          </p>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {[
          {
            label: "Awaiting Review",
            value: pending,
            icon: Clock,
            color: "text-amber-600",
            bg: "bg-amber-50",
            urgent: pending > 0,
          },
          {
            label: "Approved",
            value: approved,
            icon: CheckCircle2,
            color: "text-emerald-600",
            bg: "bg-emerald-50",
            urgent: false,
          },
          {
            label: "Total Received",
            value: jds.length,
            icon: Briefcase,
            color: "text-primary-600",
            bg: "bg-primary-50",
            urgent: false,
          },
        ].map((stat, i) => (
          <div
            key={i}
            className={`bg-white p-6 rounded-3xl border shadow-premium hover:shadow-xl transition-all duration-500 group ${stat.urgent ? "border-amber-300" : "border-surface-100"}`}
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

      <div className="space-y-6">
        <h2 className="text-xl font-bold text-surface-900 flex items-center gap-3 px-2">
          <span className="w-1.5 h-6 bg-blue-500 rounded-full" />
          Pending Approvals
        </h2>
        <JDGrid jds={jds} showEmployee={true} />
      </div>
    </div>
  );
}

// ── HR view ───────────────────────────────────────────────────────────────────

function HRView({ user }: { user: AuthUser }) {
  const [jds, setJds] = useState<JDListItem[]>([]);
  const [allJds, setAllJds] = useState<JDListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    // HR sees ALL JDs
    getJDs({
      status: "",
    })
      .then((d) => {
        const data = d || [];
        setAllJds(data);
        setJds(data);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  // Client-side filter
  useEffect(() => {
    if (filter === "all") {
      setJds(allJds);
    } else {
      setJds(
        allJds.filter((j) =>
          filter === "in_progress"
            ? ["collecting", "draft", "jd_generated"].includes(j.status)
            : j.status === filter,
        ),
      );
    }
  }, [filter, allJds]);

  if (loading) return <LoadingScreen />;

  const counts = {
    all: allJds.length,
    sent_to_manager: allJds.filter((j) => j.status === "sent_to_manager")
      .length,
    approved: allJds.filter((j) => j.status === "approved").length,
    in_progress: allJds.filter((j) =>
      ["collecting", "draft", "jd_generated"].includes(j.status),
    ).length,
  };

  return (
    <div className="max-w-7xl mx-auto space-y-10 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <header className="pb-2">
        <div className="flex items-center gap-2 mb-3">
          <span className="px-2.5 py-1 bg-purple-50 text-purple-700 text-[10px] font-black uppercase tracking-[0.2em] rounded-md border border-purple-100">
            HR Command Center
          </span>
        </div>
        <h1 className="text-4xl font-black text-surface-900 tracking-tight">
          Welcome, {user.name.split(" ")[0]}
        </h1>
        <p className="text-surface-500 mt-2 font-medium">
          Company-wide Job Description overview
        </p>
      </header>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          {
            label: "Total JDs",
            value: counts.all,
            icon: Briefcase,
            color: "text-surface-600",
            bg: "bg-surface-50",
          },
          {
            label: "Pending Review",
            value: counts.sent_to_manager,
            icon: Clock,
            color: "text-amber-600",
            bg: "bg-amber-50",
            urgent: counts.sent_to_manager > 0,
          },
          {
            label: "Approved",
            value: counts.approved,
            icon: CheckCircle2,
            color: "text-emerald-600",
            bg: "bg-emerald-50",
          },
          {
            label: "In Progress",
            value: counts.in_progress,
            icon: TrendingUp,
            color: "text-primary-600",
            bg: "bg-primary-50",
          },
        ].map((stat, i) => (
          <div
            key={i}
            className={`bg-white p-5 rounded-2xl border shadow-sm hover:shadow-md transition-all group ${(stat as any).urgent ? "border-amber-300" : "border-surface-100"}`}
          >
            <div
              className={`w-10 h-10 ${stat.bg} ${stat.color} rounded-xl flex items-center justify-center mb-3 group-hover:scale-110 transition-transform`}
            >
              <stat.icon className="w-5 h-5" />
            </div>
            <p className="text-2xl font-black text-surface-900">{stat.value}</p>
            <p className="text-[10px] font-black text-surface-400 uppercase tracking-widest mt-1">
              {stat.label}
            </p>
          </div>
        ))}
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 flex-wrap">
        {[
          { key: "all", label: "All", count: counts.all },
          {
            key: "sent_to_manager",
            label: "Pending",
            count: counts.sent_to_manager,
          },
          { key: "approved", label: "Approved", count: counts.approved },
          {
            key: "in_progress",
            label: "In Progress",
            count: counts.in_progress,
          },
        ].map(({ key, label, count }) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all
              ${
                filter === key
                  ? "bg-primary-600 text-white shadow-lg shadow-primary-500/20"
                  : "bg-white text-surface-600 border border-surface-200 hover:bg-surface-50"
              }`}
          >
            {label}
            <span
              className={`text-xs px-1.5 py-0.5 rounded-full font-bold
              ${filter === key ? "bg-white/20 text-white" : "bg-surface-100 text-surface-500"}`}
            >
              {count}
            </span>
          </button>
        ))}
      </div>

      <JDGrid jds={jds} showEmployee={true} />
    </div>
  );
}

// ── Loading screen (your original style) ─────────────────────────────────────

function LoadingScreen() {
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

// ── Root: reads role → renders correct view ───────────────────────────────────

export default function DynamicDashboardPage() {
  const params = useParams();
  const router = useRouter();
  const urlId = params.id as string;

  const [user, setUser] = useState<AuthUser | null>(null);
  const [empId, setEmpId] = useState<string>("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // 1. Get raw session from localStorage
    const sessionStr = localStorage.getItem("auth_user");
    if (!sessionStr) {
      router.replace("/login");
      return;
    }

    let sessionUser: AuthUser;
    try {
      sessionUser = JSON.parse(sessionStr);
    } catch {
      router.replace("/login");
      return;
    }

    const currentEmpId = urlId || sessionUser.employee_id;
    setEmpId(currentEmpId);

    fetchEmployeeProfile(currentEmpId)
      .then((freshUser) => {
        setUser(freshUser);
        setReady(true);
      })
      .catch((err) => {
        console.error("Failed to load live profile", err);
        setUser(sessionUser); // Fallback to cached session
        setReady(true);
      });
  }, [urlId, router]);

  if (!ready) return <LoadingScreen />;

  // Render correct dashboard based on role
  // (Assuming HR/Manager logic depends on specific roles later, for now EmployeeView manages all Organogram users)
  if (user && isHR(user)) return <HRView user={user} />;
  if (user && isManager(user)) return <ManagerView user={user} />;

  return <EmployeeView employeeId={empId} user={user} />;
}
