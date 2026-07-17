// app/(dashboard)/dashboard/[id]/page.tsx

"use client";

import { useEffect, useState, useLayoutEffect, useMemo, Suspense, type ElementType } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
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
  ChevronLeft,
  Trash2,
  Target,
  Sparkles,
  Award,
  Search,
} from "lucide-react";

import { DeleteModal } from "@/components/ui/delete-modal";
import { KRAKPIPanel } from "@/components/jd/kra-kpi-panel";
import { safeAtob, safeBtoa } from "@/lib/base64";

import {
  AuthUser,
  fetchEmployeeJDs,
  fetchEmployeeRoleTemplate,
  RoleTemplateResponse,
  fetchManagerPendingJDs,
  fetchHRPendingJDs,
  getJDs,
  getOrCreateEmployeeId,
  isHR,
  isManager,
  fetchEmployeeProfile,
  fetchHRDepartmentStats,
  fetchDepartmentEmployees,
  fetchMyTeamStats,
  fetchMyTeamEmployees,
  deleteJD,
  fetchMyImprovements,
  initQuestionnaire,
  searchEmployees,
} from "@/lib/api";



// ── Types ─────────────────────────────────────────────────────────────────────

type JDListItem = {
  id: string;
  employee_id?: string;
  title: string | null;
  status: string;
  version: number;
  updated_at: string | null;
  created_at: string | null;
  employee_name?: string;
  department?: string;
  reporting_manager?: string; // Added
  jd_status?: string; // Added
  jd_id?: string; // Added
  last_updated?: string | null; // Added
  kra_kpi_status?: string | null;
};

// ── Status config ─────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<
  string,
  { label: string; color: string; bg: string; icon: ElementType }
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
    label: "Created",
    color: "text-primary-600",
    bg: "bg-primary-50 border-primary-100",
    icon: TrendingUp,
  },
  sent_to_manager: {
    label: "Manager Review",
    color: "text-blue-700",
    bg: "bg-blue-50 border-blue-100",
    icon: ShieldCheck,
  },
  manager_rejected: {
    label: "Manager Rejected",
    color: "text-red-700",
    bg: "bg-red-50 border-red-100",
    icon: AlertTriangle,
  },
  sent_to_hr: {
    label: "HR Review",
    color: "text-purple-700",
    bg: "bg-purple-50 border-purple-100",
    icon: ShieldCheck,
  },
  hr_rejected: {
    label: "HR Rejected",
    color: "text-red-700",
    bg: "bg-red-50 border-red-100",
    icon: AlertTriangle,
  },
  approved: {
    label: "Accepted",
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
  "Not Submitted": {
    label: "Not Submitted",
    color: "text-surface-500",
    bg: "bg-surface-100 border-surface-200",
    icon: Clock,
  },
};

// ── Shared JD card grid ───────────────────────────────────────────────────────

function JDGrid({
  jds,
  showEmployee,
  onViewKraKpi,
  roleTemplate,
  handleJdClick,
}: {
  jds: JDListItem[];
  showEmployee: boolean;
  onViewKraKpi?: (jdId: string, employeeId: string, employeeName: string, kraKpiStatus?: string | null) => void;
  roleTemplate?: RoleTemplateResponse | null;
  handleJdClick?: (jdId: string, tab?: string) => Promise<void> | void;
}) {
  // Hooks must be called at the top level, before any conditional returns
  const router = useRouter();
  const [isDeleting, setIsDeleting] = useState<string | null>(null);
  const [jdToDelete, setJdToDelete] = useState<JDListItem | null>(null);

  if (jds.length === 0) {
    return (
      <div className="bg-surface-50 rounded-[40px] p-20 text-center border-2 border-dashed border-surface-200">
        <div className="w-20 h-20 bg-white rounded-md flex items-center justify-center mx-auto mb-6 shadow-sm border border-surface-100">
          <MessageSquare className="w-10 h-10 text-surface-300" />
        </div>
        <h3 className="text-xl font-medium text-surface-900 mb-2 ">
          No records found
        </h3>
        <p className="text-surface-500 max-w-sm mx-auto font-medium">
          No Job Descriptions match the current filter.
        </p>
      </div>
    );
  }

  const handleDelete = async (jd: JDListItem, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setJdToDelete(jd);
  };

  const confirmDelete = async () => {
    if (!jdToDelete) return;
    setIsDeleting(jdToDelete.id);
    try {
      const employeeId = getOrCreateEmployeeId();
      await deleteJD(jdToDelete.id, employeeId);
      // Fast refresh by just reloading the page or we could pass a callback
      window.location.reload();
    } catch (err: unknown) {
      const error = err as Error | undefined;
      alert(error?.message || "Failed to delete JD");
      setIsDeleting(null);
      setJdToDelete(null);
    }
  };

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {jds.map((jd) => {
          let config = STATUS_CONFIG[jd.status] || STATUS_CONFIG.draft;
          if (jd.status === "approved" && jd.kra_kpi_status === "sent_to_manager") {
            config = {
              label: "KRA/KPI Review",
              color: "text-blue-700",
              bg: "bg-blue-50 border-blue-100",
              icon: STATUS_CONFIG.sent_to_manager.icon,
            };
          } else if (jd.status === "approved" && jd.kra_kpi_status === "sent_to_hr") {
            config = {
              label: "KRA/KPI HR Review",
              color: "text-purple-700",
              bg: "bg-purple-50 border-purple-100",
              icon: STATUS_CONFIG.sent_to_hr.icon,
            };
          } else if (jd.status === "approved" && jd.kra_kpi_status === "manager_rejected") {
            config = {
              label: "KRA/KPI Rejected",
              color: "text-red-700",
              bg: "bg-red-50 border-red-100",
              icon: STATUS_CONFIG.manager_rejected.icon,
            };
          } else if (jd.status === "approved" && jd.kra_kpi_status === "hr_rejected") {
            config = {
              label: "KRA/KPI HR Rejected",
              color: "text-red-700",
              bg: "bg-red-50 border-red-100",
              icon: STATUS_CONFIG.hr_rejected.icon,
            };
          } else if (jd.status === "approved" && (jd.kra_kpi_status === "draft" || jd.kra_kpi_status === "confirmed")) {
            config = {
              label: "KRA/KPI Under Process",
              color: "text-amber-700",
              bg: "bg-amber-50 border-amber-100",
              icon: Clock,
            };
          }
          const isOwnJD = !showEmployee;
          const href = (isOwnJD && [
            "collecting",
            "jd_session_init",
          ].includes(jd.status))
            ? `/questionnaire/${jd.id}`
            : `/jd/${jd.id}`;

          return (
            <Link
              key={jd.id}
              href={href}
              onClick={(e) => {
                if (roleTemplate && roleTemplate.exists && jd.id === roleTemplate.id) {
                  e.preventDefault();
                  handleJdClick?.(jd.id);
                }
              }}
              className="group bg-white rounded-md p-6 border border-surface-100 shadow-md hover:shadow-md hover:border-primary-200 transition-all duration-500 flex flex-col justify-between"
            >
              <div>
                <div className="flex items-start justify-between mb-6">
                  <div
                    className={`px-4 py-1.5 rounded-md border ${config.bg} ${config.color} flex items-center gap-2 shadow-sm`}
                  >
                    <config.icon className="w-3.5 h-3.5" />
                    <span className="text-[10px] font-medium ">
                      {config.label}
                    </span>
                  </div>
                  <div className="text-[10px] font-medium text-surface-300 ">
                    v{jd.version}.0
                  </div>
                </div>

                <h3 className="text-xl font-medium text-surface-900 mb-2 group-hover:text-primary-600 transition-colors ">
                  {jd.title || "Untitled Strategic Role"}
                </h3>

                {/* Show employee name and ID for manager/HR views */}
                {showEmployee && (jd.employee_name || jd.employee_id) && (
                  <p className="text-xs text-primary-600 font-medium mb-1 flex items-center gap-1.5">
                    <Users className="w-3 h-3 text-primary-500" />
                    <span>
                      {jd.employee_name || "Unknown"} ({jd.employee_id})
                    </span>
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
                <div className="flex items-center gap-4">
                  <span className="text-xs font-medium text-primary-600 group-hover:translate-x-1 transition-transform inline-flex items-center gap-2">
                    View JD
                    <ArrowRight className="w-4 h-4" />
                  </span>
                  {["jd_generated", "sent_to_manager", "manager_rejected", "sent_to_hr", "hr_rejected", "approved"].includes(jd.status) && (
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (onViewKraKpi && jd.employee_id) {
                          onViewKraKpi(jd.id, jd.employee_id, jd.employee_name || "Unknown", jd.kra_kpi_status);
                        } else {
                          if (roleTemplate && roleTemplate.exists && jd.id === roleTemplate.id) {
                            handleJdClick?.(jd.id, "kra-kpi");
                          } else {
                            router.push(`/jd/${jd.id}?tab=kra-kpi`);
                          }
                        }
                      }}
                      className="text-xs font-medium text-indigo-600 hover:text-indigo-800 inline-flex items-center gap-1.5 transition-colors border-l border-surface-200 pl-4"
                    >
                      <Target className="w-3.5 h-3.5 text-indigo-500" />
                      View KRA / KPI
                    </button>
                  )}
                </div>
                <div className="flex gap-2">
                  {/* Delete button only shown if the current user is the owner (in employee view) and status is a deletable one */}
                  {!showEmployee && ["collecting", "draft", "manager_rejected", "hr_rejected", "jd_generated"].includes(jd.status) && (
                    <button
                      onClick={(e) => handleDelete(jd, e)}
                      disabled={isDeleting === jd.id}
                      className="w-10 h-10 bg-red-50 text-red-500 hover:bg-red-100 hover:text-red-600 rounded-md flex flex-shrink-0 items-center justify-center transition-colors disabled:opacity-50"
                    >
                      {isDeleting === jd.id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Trash2 className="w-4 h-4" />
                      )}
                    </button>
                  )}
                  <div className="w-10 h-10 bg-surface-50 rounded-md flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                    <FileText className="w-5 h-5 text-surface-400" />
                  </div>
                </div>
              </div>
            </Link>
          );
        })}
      </div>

      <DeleteModal
        isOpen={!!jdToDelete}
        onClose={() => !isDeleting && setJdToDelete(null)}
        onConfirm={confirmDelete}
        isDeleting={!!isDeleting}
        title="Delete Job Description"
        description={`Are you sure you want to delete "${jdToDelete?.title || 'Untitled Strategic Role'}"? This action cannot be undone.`}
      />
    </>
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
  const [allJds, setAllJds] = useState<JDListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [roleTemplate, setRoleTemplate] = useState<RoleTemplateResponse | null>(null);
  const router = useRouter();
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [improvementPlan, setImprovementPlan] = useState<any>(null);

  const handleStartInterview = (e: React.MouseEvent) => {
    if (roleTemplate && roleTemplate.exists && allJds.length === 0) {
      e.preventDefault();
      setShowConfirmModal(true);
    }
  };

  const searchParams = useSearchParams();
  const currentView = searchParams.get("view");

  const [filter, setFilter] = useState<
    "all" | "draft" | "pending" | "approved" | "feedback"
  >(
    currentView === "feedback"
      ? "feedback"
      : currentView === "approvals"
        ? "pending"
        : "all",
  );

  const [templateLoading, setTemplateLoading] = useState(false);

  const handleJdClick = async (jdId: string, tab?: string) => {
    if (roleTemplate && roleTemplate.exists && jdId === roleTemplate.id) {
      setTemplateLoading(true);
      try {
        const data = await initQuestionnaire({
          employee_id: employeeId,
          employee_name: user?.name || "Employee",
          template_session_id: jdId,
        });
        router.push(`/jd/${data.id}${tab ? `?tab=${tab}` : ""}`);
      } catch (error) {
        console.error("Failed to copy template JD:", error);
        alert("Failed to access standard JD copy. Please try again.");
      } finally {
        setTemplateLoading(false);
      }
    } else {
      router.push(`/jd/${jdId}${tab ? `?tab=${tab}` : ""}`);
    }
  };


  useEffect(() => {
    Promise.all([
      fetchEmployeeJDs(employeeId),
      fetchEmployeeRoleTemplate(employeeId).catch(() => ({ exists: false })),
      fetchMyImprovements(employeeId).catch(() => null),
    ])
      .then(([jdsData, templateData, improvementsData]) => {
        setAllJds(jdsData || []);
        if (templateData && templateData.exists) {
          setRoleTemplate(templateData);
        }
        if (improvementsData && improvementsData.has_improvement_plan) {
          setImprovementPlan(improvementsData);
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [employeeId]);

  // Combine allJds and roleTemplate mock if applicable
  const combinedJds = useMemo(() => {
    const list = [...allJds];
    // If there are no personal JDs, and a role template exists, show it in the list!
    if (roleTemplate && roleTemplate.exists && allJds.length === 0) {
      list.push({
        id: roleTemplate.id!,
        title: roleTemplate.title || "Standard Role JD",
        status: "approved",
        version: roleTemplate.version || 1,
        updated_at: roleTemplate.updated_at || null,
        created_at: roleTemplate.updated_at || null,
        employee_name: user?.name || "Standard Role",
      });
    }
    return list;
  }, [allJds, roleTemplate, employeeId, user?.name]);

  // Derived list based on filter - no separate state needed
  const jds = useMemo(() => {
    if (filter === "all") return combinedJds;
    if (filter === "draft") {
      return combinedJds.filter((j) =>
        ["draft", "jd_generated", "collecting", "manager_rejected", "hr_rejected"].includes(j.status),
      );
    }
    if (filter === "pending") {
      return combinedJds.filter((j) => ["sent_to_manager", "sent_to_hr"].includes(j.status));
    }
    if (filter === "approved") {
      return combinedJds.filter((j) => j.status === "approved");
    }
    return combinedJds;
  }, [filter, combinedJds]);

  const draftCount = combinedJds.filter((j) =>
    [
      "draft",
      "jd_generated",
      "collecting",
      "manager_rejected",
      "hr_rejected",
    ].includes(j.status),
  ).length;
  const sentCount = combinedJds.filter((j) =>
    ["sent_to_manager", "sent_to_hr"].includes(j.status),
  ).length;
  const approvedCount = combinedJds.filter((j) => j.status === "approved").length;

  if (loading) return <LoadingScreen />;

  return (
    <div className="absolute inset-0 overflow-y-auto p-4 sm:p-6 pb-24">
      <div className="max-w-7xl mx-auto space-y-8 sm:space-y-10 pt-14 pb-10 sm:pt-0 animate-in fade-in slide-in-from-bottom-4 duration-700">
        {/* Vibrant Blue Gradient Header (Employee Identity) */}
        <header className="bg-gradient-to-r from-blue-900 via-blue-800 to-indigo-900 rounded-[2rem] p-6 sm:p-8 shadow-md shadow-blue-900/20 text-white relative overflow-hidden">
          {/* Abstract shapes */}
          <div className="absolute top-0 right-0 p-32 bg-cyan-400/20 rounded-md blur-3xl -translate-y-1/2 translate-x-1/2 pointer-events-none" />
          <div className="absolute bottom-0 left-0 p-32 bg-indigo-500/20 rounded-md blur-3xl translate-y-1/2 -translate-x-1/2 pointer-events-none" />

          <div className="relative z-10 flex flex-col md:flex-row md:items-end justify-between gap-6">
            <div>
              <div className="flex flex-wrap items-center gap-2 mb-4">
                <span className="px-3 py-1.5 bg-white/10 backdrop-blur-md text-blue-100 text-[10px] font-medium tracking-[0.2em] rounded-lg border border-white/20">
                  {user?.role || "Employee"} Portfolio
                </span>
                <span className="px-3 py-1.5 bg-cyan-500/20 text-cyan-200 text-[10px] font-medium tracking-[0.2em] rounded-lg border border-cyan-500/30 font-mono">
                  ID: {employeeId}
                </span>
                {user?.department && (
                  <span className="text-[11px] text-blue-200 font-medium pl-2 border-l border-white/20">
                    {user.department}
                  </span>
                )}
              </div>
              <h1 className="text-3xl sm:text-4xl font-medium mb-2">
                {user?.name || "Unknown Name"}
              </h1>

              <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-blue-200 font-medium">
                {user?.email && (
                  <p className="flex items-center gap-1.5">📧 {user.email}</p>
                )}
                {user?.phone_mobile && (
                  <p className="flex items-center gap-1.5">
                    📱 {user.phone_mobile}
                  </p>
                )}
                {user?.reporting_manager && (
                  <p className="flex items-center gap-1.5">
                    <span className="text-blue-300">Reports to:</span>
                    <span className="text-white font-medium">
                      {user.reporting_manager}
                    </span>
                  </p>
                )}
              </div>
            </div>

            <div className="flex flex-col md:items-end gap-4 mt-4 md:mt-0">
              <Link
                href="/questionnaire"
                onClick={handleStartInterview}
                className="group flex flex-1 sm:flex-none w-full sm:w-auto items-center justify-center gap-3 px-8 py-4 bg-white text-blue-900 rounded-md font-medium hover:bg-cyan-50 hover:shadow-md hover:shadow-cyan-500/20 transition-all duration-300 active:scale-[0.98]"
              >
                <Plus className="w-5 h-5 group-hover:rotate-90 transition-transform text-blue-600" />
                Initialize New JD
              </Link>
            </div>
          </div>
        </header>

        {/* Glassmorphic approved template alert banner */}
        {roleTemplate && roleTemplate.exists && allJds.length === 0 && (
          <div className="bg-gradient-to-r from-emerald-950 via-teal-900 to-emerald-900 rounded-[2rem] p-6 sm:p-8 border border-emerald-500/30 text-white relative overflow-hidden shadow-lg shadow-emerald-950/20 mb-8 sm:mb-10 animate-in fade-in duration-500">
            <div className="absolute top-0 right-0 p-32 bg-emerald-400/10 rounded-md blur-3xl -translate-y-1/2 translate-x-1/2 pointer-events-none" />
            <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <span className="px-2.5 py-1 bg-emerald-500/20 text-emerald-200 text-[10px] font-semibold tracking-wider uppercase rounded-md border border-emerald-500/30">
                    🟢 Role JD Finalized
                  </span>
                  <span className="text-[11px] text-emerald-300 font-medium">
                    No Action Needed
                  </span>
                </div>
                <h3 className="text-xl sm:text-2xl font-semibold mb-2">
                  Your Job Description is Ready!
                </h3>
                <p className="text-emerald-100 text-sm max-w-2xl leading-relaxed">
                  A standardized Job Description for your role <span className="font-semibold text-white">{roleTemplate.title}</span> in <span className="font-semibold text-white">{roleTemplate.department}</span> has been pre-approved by Human Resources. You are fully covered and do not need to take any action!
                </p>
              </div>

              <div className="flex flex-col sm:flex-row gap-3 shrink-0 w-full sm:w-auto">
                <button
                  onClick={() => handleJdClick(roleTemplate.id || "")}
                  disabled={templateLoading}
                  className="px-6 py-3.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-md text-sm font-medium transition-all shadow-md shadow-emerald-900/30 text-center active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {templateLoading ? (
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    "📄 View Standard JD"
                  )}
                </button>
                <Link
                  href="/questionnaire"
                  onClick={handleStartInterview}
                  className="px-6 py-3.5 bg-white/10 hover:bg-white/20 text-emerald-100 rounded-md text-sm font-medium transition-all border border-white/10 text-center active:scale-[0.98]"
                >
                  💬 Start Custom Interview
                </Link>
              </div>
            </div>
          </div>
        )}
        {/* Performance & Skill Development Plan widget */}
        {improvementPlan && (
          <div className="bg-gradient-to-br from-indigo-950 via-slate-900 to-blue-950 rounded-[2rem] p-6 sm:p-8 border border-indigo-500/20 text-white relative overflow-hidden shadow-lg shadow-slate-950/20 mb-8 sm:mb-10 animate-in fade-in duration-500">
            <div className="absolute top-0 right-0 p-32 bg-indigo-500/10 rounded-md blur-3xl -translate-y-1/2 translate-x-1/2 pointer-events-none" />
            
            <div className="relative z-10 space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/10 pb-4">
                <div>
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="px-2.5 py-1 bg-indigo-500/20 text-indigo-200 text-[10px] font-semibold tracking-wider uppercase rounded-md border border-indigo-500/30">
                      📊 Skill Gap Profile
                    </span>
                    <span className="text-[11px] text-indigo-300 font-medium">
                      Skill Assessment
                    </span>
                  </div>
                  <h3 className="text-xl font-bold">Your Skill Gap & Assessment Profile</h3>
                </div>
                {improvementPlan.updated_at && (
                  <div className="text-[10px] text-slate-400 font-semibold self-start sm:self-center bg-white/5 border border-white/10 px-3 py-1.5 rounded-lg">
                    Last Evaluated: {new Date(improvementPlan.updated_at).toLocaleDateString()}
                  </div>
                )}
              </div>

              {/* Skill Ratings Progress Grid */}
              {improvementPlan.skill_ratings && improvementPlan.skill_ratings.length > 0 && (
                <div className="space-y-4">
                  <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider">Key Capabilities & Ratings</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {improvementPlan.skill_ratings.map((skill: any) => {
                      const isNa = skill.rating === "N/A";
                      const rating = isNa ? 0 : (skill.rating || 0);
                      let barColor = "bg-rose-500 shadow-rose-500/20";
                      let textColor = "text-rose-300";
                      if (isNa) {
                        barColor = "bg-slate-600 shadow-slate-650/10";
                        textColor = "text-slate-400";
                      } else if (rating > 3 && rating <= 7) {
                        barColor = "bg-amber-500 shadow-amber-500/20";
                        textColor = "text-amber-300";
                      } else if (rating > 7) {
                        barColor = "bg-emerald-500 shadow-emerald-500/20";
                        textColor = "text-emerald-300";
                      }

                      return (
                        <div key={skill.name} className="p-4 bg-white/5 border border-white/10 rounded-xl space-y-2 backdrop-blur-sm">
                          <div className="flex justify-between items-start gap-2">
                            <div>
                              <span className="text-xs font-bold text-white block">{skill.name}</span>
                              <span className="text-[10px] text-slate-400 block mt-0.5 leading-normal">{skill.description}</span>
                            </div>
                            <span className={`text-sm font-extrabold ${textColor} shrink-0`}>
                              {isNa ? "N/A" : `${rating}/10`}
                            </span>
                          </div>
                          <div className="w-full bg-white/10 h-1.5 rounded-full overflow-hidden">
                            <div 
                              className={`h-full rounded-full transition-all duration-500 ${barColor}`} 
                              style={{ width: isNa ? "100%" : `${rating * 10}%`, opacity: isNa ? 0.35 : 1 }} 
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Horizontal Pill Filters */}
        <div className="bg-white p-2 rounded-md border border-surface-200 shadow-sm flex flex-wrap gap-2">
          {[
            {
              key: "all",
              label: "All Output",
              count: combinedJds.length,
              color: "blue",
              icon: Briefcase,
            },
            {
              key: "draft",
              label: "My Drafts",
              count: draftCount,
              color: "amber",
              icon: Clock,
            },
            {
              key: "pending",
              label: "Sent for Review",
              count: sentCount,
              color: "purple",
              icon: ShieldCheck,
            },
            {
              key: "approved",
              label: "Approved JDs",
              count: approvedCount,
              color: "emerald",
              icon: FileText,
            },
          ].map((tab) => {
            const isActive = filter === tab.key;
            const colorClasses =
              {
                blue: "bg-blue-100 text-blue-700",
                amber: "bg-amber-100 text-amber-700",
                purple: "bg-purple-100 text-purple-700",
                emerald: "bg-emerald-100 text-emerald-700",
              }[tab.color as string] || "bg-surface-100 text-surface-700";

            return (
              <button
                key={tab.key}
                onClick={() => setFilter(tab.key as "all" | "draft" | "pending" | "approved")}
                className={`flex-1 min-w-[140px] flex items-center gap-3 p-3 rounded-md transition-all duration-200 ${isActive
                  ? "bg-surface-900 text-white shadow-md shadow-surface-900/20 ring-1 ring-surface-900"
                  : "hover:bg-surface-50 text-surface-600 hover:text-surface-900"
                  }`}
              >
                <div
                  className={`w-10 h-10 rounded-lg flex items-center justify-center ${isActive ? "bg-white/10" : colorClasses}`}
                >
                  <tab.icon
                    className={`w-5 h-5 ${isActive ? "text-white" : ""}`}
                  />
                </div>
                <div className="text-left">
                  <p
                    className={`text-[10px] font-medium mb-0.5 ${isActive ? "text-surface-300" : "text-surface-400"}`}
                  >
                    {tab.label}
                  </p>
                  <p
                    className={`text-xl font-medium leading-none ${isActive ? "text-white" : "text-surface-900"}`}
                  >
                    {tab.count}
                  </p>
                </div>
              </button>
            );
          })}
        </div>

        {/* JD grid */}
        <div className="space-y-6">
          <div className="flex items-center justify-between px-2">
            <h2 className="text-xl font-medium text-surface-900 flex items-center gap-3">
              <span className="w-1.5 h-6 bg-blue-600 rounded-md" />
              {filter === "all"
                ? "Active Role Portfolio"
                : `Filtered: ${filter.charAt(0).toUpperCase() + filter.slice(1)}`}
            </h2>
          </div>
          <JDGrid jds={jds} showEmployee={false} roleTemplate={roleTemplate} handleJdClick={handleJdClick} />
        </div>

        {showConfirmModal && roleTemplate && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
            <div className="bg-white rounded-3xl p-6 sm:p-8 max-w-lg w-full border border-surface-200 shadow-2xl relative animate-in zoom-in-95 duration-300">
              <div className="flex items-center justify-center w-12 h-12 bg-amber-50 rounded-2xl mb-6">
                <AlertTriangle className="w-6 h-6 text-amber-500" />
              </div>

              <h3 className="text-xl sm:text-2xl font-bold text-surface-900 mb-3">
                Standard JD Already Prepared!
              </h3>

              <p className="text-surface-600 text-sm leading-relaxed mb-6">
                A standardized, HR pre-approved Job Description is already prepared for your role <span className="font-semibold text-surface-900">{roleTemplate.title}</span>.
                <br /><br />
                To save time, we highly recommend viewing the approved standard copy instead. You only need to start a custom AI interview if your specific daily tasks are uniquely different from other employees sharing your role.
              </p>

              <div className="flex flex-col sm:flex-row gap-3">
                <button
                  onClick={() => {
                    setShowConfirmModal(false);
                    handleJdClick(roleTemplate.id || "");
                  }}
                  disabled={templateLoading}
                  className="flex-1 px-5 py-3.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-md text-sm font-semibold transition-all active:scale-[0.98] text-center disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {templateLoading ? (
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    "📄 View Standard Copy"
                  )}
                </button>
                <button
                  onClick={() => {
                    setShowConfirmModal(false);
                    router.push("/questionnaire");
                  }}
                  className="flex-1 px-5 py-3.5 bg-surface-100 hover:bg-surface-200 text-surface-700 rounded-md text-sm font-semibold transition-all active:scale-[0.98] text-center"
                >
                  💬 Continue to Custom Interview
                </button>
              </div>

              <button
                onClick={() => setShowConfirmModal(false)}
                className="absolute top-4 right-4 text-surface-400 hover:text-surface-600 p-2 font-mono text-lg"
              >
                ✕
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Manager view ──────────────────────────────────────────────────────────────

function ManagerView({ user }: { user: AuthUser }) {
  const [allJds, setAllJds] = useState<JDListItem[]>([]);
  const [myJds, setMyJds] = useState<JDListItem[]>([]);
  const [viewingKraKpi, setViewingKraKpi] = useState<{
    jdId: string;
    employeeId: string;
    employeeName: string;
  } | null>(null);
  const [blockedEmployeeName, setBlockedEmployeeName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // My Team State
  type TeamStats = {
    total_employees?: number;
    submitted?: number;
    under_review?: number;
    approved?: number;
    completion_percentage?: number;
    [key: string]: unknown;
  };
  type TeamEmployee = {
    employee_id: string;
    name: string;
    designation?: string;
    department?: string;
    reporting_manager?: string;
    jd_id?: string;
    jd_status?: string;
    last_updated?: string | null;
    kra_kpi_status?: string | null;
  };

  const [teamStats, setTeamStats] = useState<TeamStats | null>(null);
  const [myTeamEmployees, setMyTeamEmployees] = useState<TeamEmployee[]>([]);
  const [loadingTeam, setLoadingTeam] = useState(false);


  const searchParams = useSearchParams();
  const currentView = searchParams.get("view");

  const [filter, setFilter] = useState<
    "all" | "pending" | "approved" | "my_jds" | "my_team" | "feedback" | "skill_assessment"
  >(
    currentView === "feedback"
      ? "feedback"
      : currentView === "my_team"
        ? "my_team"
        : currentView === "my_jds"
          ? "my_jds"
          : currentView === "pending"
            ? "pending"
            : currentView === "approved"
              ? "approved"
              : currentView === "skill_assessment"
                ? "skill_assessment"
                : "pending", // Default to "pending" (Action Required) as the primary view
  );

  // Derived JDs based on filter
  const jds = useMemo(() => {
    if (filter === "my_jds") return myJds;
    if (filter === "all") return allJds;
    if (filter === "pending") {
      return allJds.filter(
        (j) =>
          j.status === "sent_to_manager" ||
          j.status === "hr_rejected" ||
          j.kra_kpi_status === "sent_to_manager",
      );
    }
    if (filter === "approved") {
      return allJds.filter(
        (j) =>
          (j.status === "approved" || j.status === "sent_to_hr") &&
          j.kra_kpi_status !== "sent_to_manager",
      );
    }
    // "feedback" or "my_team" or other: return empty or allJds as fallback
    return [];
  }, [filter, allJds, myJds]);

  // Group team employees by department
  const groupedEmployees = useMemo(() => {
    const groups: Record<string, TeamEmployee[]> = {};
    myTeamEmployees.forEach((emp) => {
      const dept = emp.department || "Other";
      if (!groups[dept]) groups[dept] = [];
      groups[dept].push(emp);
    });
    // Sort departments so 'Cell Therapeutics' or alphabetical comes first
    return Object.keys(groups)
      .sort((a, b) => {
        if (a.toLowerCase() === 'cell therapeutics') return -1;
        if (b.toLowerCase() === 'cell therapeutics') return 1;
        return a.localeCompare(b);
      })
      .reduce((acc, key) => {
        acc[key] = groups[key];
        return acc;
      }, {} as Record<string, TeamEmployee[]>);
  }, [myTeamEmployees]);

  useEffect(() => {
    async function load() {
      try {
        const [teamData, personalData, statsData, employeesData] = await Promise.all([
          fetchManagerPendingJDs(user.employee_id),
          fetchEmployeeJDs(user.employee_id),
          fetchMyTeamStats(user.employee_id).catch(() => null),
          fetchMyTeamEmployees(user.employee_id).catch(() => []),
        ]);
        setAllJds(teamData || []);
        setMyJds(personalData || []);
        setTeamStats(statsData);
        setMyTeamEmployees(employeesData || []);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [user.employee_id]);

  useEffect(() => {
    if (currentView === "feedback") {
      setFilter("feedback");
    } else if (currentView === "my_team") {
      setFilter("my_team");
    } else if (currentView === "my_jds") {
      setFilter("my_jds");
    } else if (currentView === "pending") {
      setFilter("pending");
    } else if (currentView === "approved") {
      setFilter("approved");
    } else if (currentView === "skill_assessment") {
      setFilter("skill_assessment");
    }
  }, [currentView]);

  if (loading) return <LoadingScreen />;

  if (viewingKraKpi) {
    return (
      <div className="absolute inset-0 overflow-y-auto p-4 sm:p-6 pb-24 bg-surface-50">
        <div className="max-w-7xl mx-auto space-y-8 sm:space-y-10 pt-14 pb-10 sm:pt-0 animate-in fade-in slide-in-from-bottom-4 duration-500">
          {/* Header with back button */}
          <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-blue-950 rounded-[2rem] p-6 sm:p-8 relative overflow-hidden shadow-md shadow-slate-900/20 text-white">
            <div className="relative z-10 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex flex-col gap-3">
                <button
                  onClick={() => setViewingKraKpi(null)}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 border border-white/20 transition-all text-xs font-semibold w-fit text-slate-100"
                >
                  <ChevronLeft className="w-4 h-4" />
                  Back to Dashboard
                </button>
                <div>
                  <h1 className="text-2xl font-bold tracking-tight text-white mb-1">
                    KRA & KPI Performance Goals
                  </h1>
                  <p className="text-sm font-medium text-slate-300">
                    Reviewing framework for <strong className="text-white font-semibold">{viewingKraKpi.employeeName}</strong> ({viewingKraKpi.employeeId})
                  </p>
                </div>
              </div>
              <div className="bg-white/5 px-4 py-3 rounded-lg border border-white/10 backdrop-blur-sm self-start sm:self-center">
                <span className="text-[10px] font-medium tracking-[0.2em] text-blue-300 block mb-0.5">JD Session ID</span>
                <span className="text-xs font-mono font-bold text-slate-200">{viewingKraKpi.jdId}</span>
              </div>
            </div>
          </div>

          {/* KRA/KPI Panel container */}
          <div className="bg-white rounded-[2.5rem] border border-surface-200 shadow-xl overflow-hidden">
            <KRAKPIPanel
              jdSessionId={viewingKraKpi.jdId}
              employeeId={viewingKraKpi.employeeId}
              isManager={true}
            />
          </div>
        </div>
      </div>
    );
  }

  const pending = allJds.filter(
    (j) =>
      j.status === "sent_to_manager" ||
      j.status === "hr_rejected" ||
      j.kra_kpi_status === "sent_to_manager",
  ).length;
  const approved = allJds.filter(
    (j) =>
      (j.status === "approved" || j.status === "sent_to_hr") &&
      j.kra_kpi_status !== "sent_to_manager",
  ).length;

  return (
    <div className="absolute inset-0 overflow-y-auto p-4 sm:p-6 pb-24">
      <div className="max-w-7xl mx-auto space-y-8 sm:space-y-10 pt-14 pb-10 sm:pt-0 animate-in fade-in slide-in-in-from-bottom-4 duration-700">
        {/* Executive Dark Header */}
        <header className="bg-gradient-to-r from-slate-900 via-slate-800 to-blue-950 rounded-[2rem] p-6 sm:p-10 relative overflow-hidden shadow-md shadow-slate-900/20">
          {/* Subtle background glow */}
          <div className="absolute top-0 right-0 p-32 bg-blue-500/10 rounded-md blur-3xl -translate-y-1/2 translate-x-1/2 pointer-events-none" />

          <div className="relative z-10 flex flex-col md:flex-row md:items-end justify-between gap-6">
            <div>
              <div className="flex items-center gap-3 mb-4">
                <span className="px-3 py-1.5 bg-blue-500/20 text-blue-300 text-[10px] font-medium tracking-[0.2em] rounded-lg border border-blue-500/30 backdrop-blur-sm shadow-inner shadow-white/5">
                  Executive Review
                </span>
                {user.department && (
                  <span className="text-[11px] text-slate-400 font-medium pl-3 border-l border-slate-700/50">
                    {user.department}
                  </span>
                )}
              </div>
              <h1 className="text-4xl font-medium text-white leading-none mb-3">
                Welcome, {user.name}
              </h1>
              <p className="text-slate-400 font-medium text-sm">
                Review and approve strategic Job Descriptions from your reports.
              </p>
            </div>

            <div className="flex bg-white/5 p-4 rounded-md border border-white/10 backdrop-blur-md w-full sm:w-auto overflow-hidden divide-x divide-slate-700">
              <div className="text-center px-4 flex-1">
                <p className="text-3xl sm:text-4xl font-medium text-white">
                  {allJds.length}
                </p>
                <p className="text-[10px] font-medium text-slate-400 mt-1 line-clamp-1">
                  Total Submissions
                </p>
              </div>
              <div className="text-center px-4 flex-1">
                <p className="text-3xl sm:text-4xl font-medium text-emerald-400">
                  {approved}
                </p>
                <p className="text-[10px] font-medium text-slate-400 mt-1 line-clamp-1">
                  Approved
                </p>
              </div>
            </div>
          </div>
        </header>

        {/* Horizontal Pill Filters */}
        <div className="bg-white p-2 rounded-md border border-surface-200 shadow-sm flex flex-wrap gap-2">
          {[
            {
              key: "pending",
              label: "Action Required",
              count: pending,
              color: pending > 0 ? "amber" : "slate",
              icon: AlertTriangle,
            },
            {
              key: "my_team",
              label: "Team Overview",
              count: teamStats?.total_employees || 0,
              color: "blue",
              icon: Users,
            },
            {
              key: "approved",

              label: "Your Approvals",
              count: approved,
              color: "emerald",
              icon: CheckCircle2,
            },
            {
              key: "all",
              label: "All JDs",
              count: allJds.length,
              color: "blue",
              icon: Briefcase,
            },
            {
              key: "my_jds",
              label: "My JDs",
              count: myJds.length,
              color: "slate",
              icon: FileText,
            },
          ].map((tab) => {
            const isActive = filter === tab.key;
            const colorClasses =
              {
                blue: "bg-blue-100 text-blue-700",
                amber: "bg-amber-100 text-amber-700",
                emerald: "bg-emerald-100 text-emerald-700",
                slate: "bg-slate-100 text-slate-700",
              }[tab.color as string] || "bg-surface-100 text-surface-700";

            return (
              <button
                key={tab.key}
                onClick={() => setFilter(tab.key as "all" | "pending" | "approved" | "my_jds" | "my_team")}
                className={`flex-1 min-w-[140px] flex items-center gap-3 p-3 rounded-md transition-all duration-200 ${isActive
                  ? "bg-slate-900 text-white shadow-md shadow-slate-900/20 ring-1 ring-slate-900"
                  : "hover:bg-slate-50 text-slate-600 hover:text-surface-900"
                  }`}
              >
                <div
                  className={`w-10 h-10 rounded-lg flex items-center justify-center ${isActive ? "bg-white/10" : colorClasses}`}
                >
                  <tab.icon
                    className={`w-5 h-5 ${isActive ? "text-white" : ""}`}
                  />
                </div>
                <div className="text-left">
                  <p
                    className={`text-[10px] font-medium mb-0.5 ${isActive ? "text-slate-300" : "text-slate-400"}`}
                  >
                    {tab.label}
                  </p>
                  <p
                    className={`text-xl font-medium leading-none ${isActive ? "text-white" : "text-slate-900"}`}
                  >
                    {tab.count}
                  </p>
                </div>
              </button>
            );
          })}
        </div>

        {/* JD Grid area / Team Overview */}
        <div className="space-y-6">
          <h2 className="text-lg sm:text-xl font-medium text-slate-900 flex items-center gap-3 px-2">
            <span className="w-1.5 h-6 bg-slate-800 rounded-md" />
            {filter === "all"
              ? "All Team Roles"
              : filter === "pending"
                ? "Awaiting Your Approval"
                : filter === "my_jds"
                  ? "Your Personal Documents"
                  : filter === "my_team"
                    ? "Team Progress Overview"
                    : "Successfully Processed"}
          </h2>

          {filter === "my_team" ? (
            <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
              {/* Stats Summary */}
              {teamStats && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                  <div className="bg-white p-6 rounded-md border border-surface-200 shadow-md hover:shadow-md transition-all duration-300 relative overflow-hidden group">
                    <div className="absolute top-0 right-0 w-24 h-24 bg-primary-500/5 rounded-md blur-2xl -translate-y-1/2 translate-x-1/2 group-hover:scale-150 transition-transform duration-700" />
                    <p className="text-[10px] font-medium tracking-[0.2em] text-surface-400 mb-2">Total Team</p>
                    <p className="text-4xl font-medium text-surface-900 ">{teamStats?.total_employees || 0}</p>
                  </div>
                  <div className="bg-white p-6 rounded-md border border-surface-200 shadow-md hover:shadow-md transition-all duration-300 relative overflow-hidden group">
                    <div className="absolute top-0 right-0 w-24 h-24 bg-blue-500/5 rounded-md blur-2xl -translate-y-1/2 translate-x-1/2 group-hover:scale-150 transition-transform duration-700" />
                    <p className="text-[10px] font-medium tracking-[0.2em] text-blue-500 mb-2">In Progress</p>
                    <p className="text-4xl font-medium text-surface-900 ">{(teamStats?.submitted || 0) + (teamStats?.under_review || 0)}</p>
                  </div>
                  <div className="bg-white p-6 rounded-md border border-surface-200 shadow-md hover:shadow-md transition-all duration-300 relative overflow-hidden group">
                    <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-500/5 rounded-md blur-2xl -translate-y-1/2 translate-x-1/2 group-hover:scale-150 transition-transform duration-700" />
                    <p className="text-[10px] font-medium tracking-[0.2em] text-emerald-500 mb-2">Approved</p>
                    <p className="text-4xl font-medium text-surface-900 ">{teamStats?.approved || 0}</p>
                  </div>
                  <div className="bg-white p-6 rounded-md border border-surface-200 shadow-md hover:shadow-md transition-all duration-300 relative overflow-hidden group">
                    <div className="absolute top-0 right-0 w-24 h-24 bg-primary-500/10 rounded-md blur-2xl -translate-y-1/2 translate-x-1/2 group-hover:scale-150 transition-transform duration-700" />
                    <p className="text-[10px] font-medium tracking-[0.2em] text-primary-500 mb-2">Completion</p>
                    <p className="text-4xl font-medium text-surface-900 ">{teamStats?.completion_percentage || 0}%</p>
                  </div>
                </div>
              )}


              {/* Employee Directory Grouped by Department */}
              {myTeamEmployees.length === 0 ? (
                <div className="bg-white rounded-[2.5rem] border border-surface-200 shadow-md p-20 text-center">
                  <Users className="w-12 h-12 text-surface-200 mx-auto mb-4" />
                  <p className="text-surface-500 font-medium">No team members identified in your scope.</p>
                </div>
              ) : (
                <div className="space-y-8">
                  {Object.entries(groupedEmployees).map(([deptName, emps]) => (
                    <div key={deptName} className="space-y-4">
                      <div className="flex items-center gap-2.5 px-2">
                        <span className="w-1.5 h-4 rounded-full bg-primary-500 shadow-sm" />
                        <h3 className="text-sm font-semibold text-surface-800 tracking-wide">{deptName}</h3>
                        <span className="text-[10px] font-bold bg-primary-50 text-primary-600 px-2 py-0.5 rounded-full ring-1 ring-primary-100/30">
                          {emps.length} {emps.length === 1 ? 'member' : 'members'}
                        </span>
                      </div>
                      
                      <div className="bg-white rounded-[2.5rem] border border-surface-200 shadow-md overflow-hidden">
                        <div className="overflow-x-auto">
                          <table className="w-full text-left border-collapse">
                            <thead>
                              <tr className="bg-surface-50/50">
                                <th className="px-6 py-5 text-[10px] font-medium text-surface-400 border-b border-surface-100 w-1/4">Team Member</th>
                                <th className="px-6 py-5 text-[10px] font-medium text-surface-400 border-b border-surface-100 w-1/4">Designation</th>
                                <th className="px-6 py-5 text-[10px] font-medium text-surface-400 border-b border-surface-100">JD Status</th>
                                <th className="px-6 py-5 text-[10px] font-medium text-surface-400 border-b border-surface-100">KRA / KPI</th>
                                <th className="px-6 py-5 text-[10px] font-medium text-surface-400 border-b border-surface-100">Action</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-surface-50">
                              {emps.map((emp) => (
                                <tr key={emp.employee_id} className="hover:bg-surface-50/50 transition-colors group">
                                  <td className="px-6 py-5">
                                    <div className="flex items-center gap-3">
                                      <div className="w-10 h-10 rounded-md bg-primary-50 text-primary-600 flex items-center justify-center font-medium text-xs ring-1 ring-primary-100">
                                        {emp.name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}
                                      </div>
                                      <div>
                                        <p className="font-medium text-surface-900 text-sm">{emp.name}</p>
                                        <p className="text-[10px] font-medium text-surface-400 font-mono ">{emp.employee_id}</p>
                                      </div>
                                    </div>
                                  </td>
                                  <td className="px-6 py-5">
                                    <p className="text-xs font-medium text-surface-600 leading-snug">{emp.designation}</p>
                                    <p className="text-[10px] text-surface-400 mt-0.5">Manager: {emp.reporting_manager || 'None'}</p>
                                  </td>
                                  <td className="px-6 py-5">
                                    {(() => {
                                      const status = emp.jd_status;
                                      let label = STATUS_CONFIG[status as keyof typeof STATUS_CONFIG]?.label || status;
                                      let bg = STATUS_CONFIG[status as keyof typeof STATUS_CONFIG]?.bg || 'bg-surface-100 border-surface-200 text-surface-500';
                                      let color = STATUS_CONFIG[status as keyof typeof STATUS_CONFIG]?.color || '';
                                      
                                      if (status === "approved" && emp.kra_kpi_status === "sent_to_manager") {
                                        label = "KRA/KPI Review";
                                        bg = "bg-blue-50 border-blue-200 text-blue-700";
                                        color = "text-blue-700";
                                      } else if (status === "approved" && emp.kra_kpi_status === "sent_to_hr") {
                                        label = "KRA/KPI HR Review";
                                        bg = "bg-purple-50 border-purple-200 text-purple-700";
                                        color = "text-purple-700";
                                      } else if (status === "approved" && emp.kra_kpi_status === "manager_rejected") {
                                        label = "KRA/KPI Rejected";
                                        bg = "bg-red-50 border-red-200 text-red-700";
                                        color = "text-red-700";
                                      } else if (status === "approved" && emp.kra_kpi_status === "hr_rejected") {
                                        label = "KRA/KPI HR Rejected";
                                        bg = "bg-red-50 border-red-200 text-red-700";
                                        color = "text-red-700";
                                      } else if (status === "approved" && (emp.kra_kpi_status === "draft" || emp.kra_kpi_status === "confirmed")) {
                                        label = "KRA/KPI Under Process";
                                        bg = "bg-amber-50 border-amber-200 text-amber-700";
                                        color = "text-amber-700";
                                      }
                                      
                                      return (
                                        <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-lg border text-[10px] font-medium ${bg} ${color}`}>
                                          <span className={`w-1.5 h-1.5 rounded-md bg-current opacity-40`} />
                                          {label}
                                        </div>
                                      );
                                    })()}
                                  </td>
                                  <td className="px-6 py-5">
                                    {emp.jd_id ? (
                                      <button
                                        onClick={() => {
                                          if (!emp.kra_kpi_status || emp.kra_kpi_status === "draft") {
                                            setBlockedEmployeeName(emp.name);
                                          } else {
                                            setViewingKraKpi({
                                              jdId: emp.jd_id!,
                                              employeeId: emp.employee_id,
                                              employeeName: emp.name
                                            });
                                          }
                                        }}
                                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 transition-all text-[10px] font-semibold tracking-wider group/btn shadow-sm"
                                      >
                                        <Target className="w-3.5 h-3.5 text-blue-600 group-hover/btn:scale-110 transition-transform" />
                                        View Goals
                                      </button>
                                    ) : (
                                      <span className="text-[10px] font-medium text-surface-300">—</span>
                                    )}
                                  </td>
                                  <td className="px-6 py-5">
                                    {emp.jd_id ? (
                                      <Link
                                        href={`/jd/${emp.jd_id}`}
                                        className="inline-flex items-center gap-2 text-[10px] font-medium text-emerald-600 hover:text-emerald-700 transition-colors"
                                      >
                                        View JD
                                        <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
                                      </Link>
                                    ) : (
                                      <Link
                                        href={`/dashboard/${safeBtoa(emp.employee_id)}`}
                                        className="inline-flex items-center gap-2 text-[10px] font-medium text-primary-600 hover:text-primary-700 transition-colors"
                                      >
                                        NO JD
                                        <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
                                      </Link>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : filter === "skill_assessment" ? (
            <SkillAssessmentDirectory
              employees={myTeamEmployees}
              onAssessEmployee={(jdId, employeeId, employeeName, kraKpiStatus) => {
                if (!kraKpiStatus || kraKpiStatus === "draft") {
                  setBlockedEmployeeName(employeeName);
                } else {
                  setViewingKraKpi({ jdId, employeeId, employeeName });
                }
              }}
            />
          ) : (
            <JDGrid 
              jds={jds} 
              showEmployee={filter !== "my_jds"} 
              onViewKraKpi={(jdId, employeeId, employeeName, kraKpiStatus) => {
                if (!kraKpiStatus || kraKpiStatus === "draft") {
                  setBlockedEmployeeName(employeeName);
                } else {
                  setViewingKraKpi({ jdId, employeeId, employeeName });
                }
              }}
            />
          )}
        </div>

        {blockedEmployeeName && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white rounded-[2rem] p-8 max-w-md w-full mx-4 shadow-xl border border-surface-200 animate-in zoom-in-95 duration-200 text-center relative overflow-hidden">
              <div className="absolute top-0 left-1/2 -translate-x-1/2 w-48 h-48 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />
              <div className="w-14 h-14 bg-amber-50 rounded-2xl flex items-center justify-center mx-auto mb-6 border border-amber-100/60 shadow-inner relative z-10">
                <Clock className="w-7 h-7 text-amber-600 animate-pulse" />
              </div>
              <h3 className="text-xl font-semibold text-slate-900 mb-3 relative z-10">
                KRA & KPI Under Review
              </h3>
              <p className="text-sm text-slate-500 mb-8 leading-relaxed relative z-10">
                The KRA & KPI performance goals for <strong className="text-slate-800 font-semibold">{blockedEmployeeName}</strong> are currently under review or have not been finalized yet. You cannot view or modify their goals at this stage.
              </p>
              <button
                onClick={() => setBlockedEmployeeName(null)}
                className="w-full py-3.5 bg-slate-900 text-white font-semibold text-xs rounded-xl hover:bg-slate-800 active:bg-slate-950 transition-colors shadow-lg shadow-slate-950/10 relative z-10"
              >
                Understood, Close
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Pending Actions Table Component ──────────────────────────────────────────

function PendingActionsTable({
  items,
  type, // "manager" | "hr"
  onViewKraKpi,
  router,
}: {
  items: JDListItem[];
  type: "manager" | "hr";
  onViewKraKpi: (jdId: string, employeeId: string, employeeName: string) => void;
  router: any;
}) {
  if (items.length === 0) {
    return (
      <div className="bg-white rounded-[2.5rem] p-16 text-center border border-surface-200 shadow-md">
        <div className="w-16 h-16 bg-surface-50 rounded-2xl flex items-center justify-center mx-auto mb-4 border border-surface-100">
          <Clock className="w-8 h-8 text-surface-300 animate-pulse" />
        </div>
        <h3 className="text-base font-bold text-surface-900 mb-1">
          All caught up!
        </h3>
        <p className="text-xs text-surface-500 max-w-xs mx-auto">
          There are no pending approvals required from you as {type === "manager" ? "a reporting manager" : "HR"}.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-[2.5rem] border border-surface-200 shadow-md overflow-hidden animate-in fade-in duration-300">
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-surface-50/50">
              <th className="px-6 py-5 text-[10px] font-medium text-surface-400 border-b border-surface-100 w-1/4">Employee</th>
              <th className="px-6 py-5 text-[10px] font-medium text-surface-400 border-b border-surface-100 w-1/4">Role Title</th>
              <th className="px-6 py-5 text-[10px] font-medium text-surface-400 border-b border-surface-100">Pending Actions</th>
              <th className="px-6 py-5 text-[10px] font-medium text-surface-400 border-b border-surface-100 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-50">
            {items.map((jd) => {
              const showJdAction = type === "manager" ? jd.status === "sent_to_manager" : jd.status === "sent_to_hr";
              const showKraAction = type === "manager" ? jd.kra_kpi_status === "sent_to_manager" : jd.kra_kpi_status === "sent_to_hr";

              return (
                <tr key={jd.id} className="hover:bg-surface-50/50 transition-colors group">
                  <td className="px-6 py-5">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-md bg-purple-50 text-purple-650 flex items-center justify-center font-bold text-xs ring-1 ring-purple-100">
                        {(jd.employee_name || "Unknown").split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <p className="font-semibold text-surface-900 text-sm">{jd.employee_name || "Unknown"}</p>
                        <p className="text-[10px] font-medium text-surface-400 font-mono">{jd.employee_id || "—"}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-5">
                    <p className="text-xs font-semibold text-surface-700 leading-snug">{jd.title || "Untitled Strategic Role"}</p>
                    <p className="text-[10px] text-surface-400 mt-0.5">{jd.department || "—"}</p>
                  </td>
                  <td className="px-6 py-5">
                    <div className="flex flex-col gap-1.5">
                      {showJdAction && (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-100 w-fit">
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                          JD Approval Pending
                        </span>
                      )}
                      {showKraAction && (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-100 w-fit">
                          <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                          KRA/KPI Approval Pending
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-5 text-right">
                    <div className="flex justify-end gap-2">
                      {showJdAction && (
                        <button
                          onClick={() => router.push(`/jd/${jd.id}`)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-150 transition-all text-[10px] font-bold shadow-sm"
                        >
                          <FileText className="w-3.5 h-3.5" />
                          View JD
                        </button>
                      )}
                      {showKraAction && (
                        <button
                          onClick={() => onViewKraKpi(jd.id, jd.employee_id || "", jd.employee_name || "")}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-150 transition-all text-[10px] font-bold shadow-sm"
                        >
                          <Target className="w-3.5 h-3.5" />
                          View Goals
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── HR view ───────────────────────────────────────────────────────────────────

function HRView({ user }: { user: AuthUser }) {
  const router = useRouter();
  const [allJds, setAllJds] = useState<JDListItem[]>([]);
  const [myJds, setMyJds] = useState<JDListItem[]>([]);

  // Types for HR data
  interface DepartmentStat {
    department: string;
    completed_jds: number;
    total_employees: number;
    completion_percentage: number;
    submitted?: number;
    under_review?: number;
    approved?: number;
    [key: string]: unknown;
  }

  interface DeptEmployee {
    employee_id: string;
    name: string;
    designation?: string;
    reporting_manager?: string;
    jd_id?: string;
    jd_status?: string;
    last_updated?: string | null;
  }

  // Manager types
  type TeamStats = {
    total_employees?: number;
    submitted?: number;
    under_review?: number;
    approved?: number;
    completion_percentage?: number;
    [key: string]: unknown;
  };
  type TeamEmployee = {
    employee_id: string;
    name: string;
    designation?: string;
    department?: string;
    reporting_manager?: string;
    jd_id?: string | null;
    jd_status?: string | null;
    kra_kpi_status?: string | null;
    kra_kpi_session_id?: string | null;
    last_updated?: string | null;
  };

  const [departmentStats, setDepartmentStats] = useState<DepartmentStat[]>([]);
  const [selectedDepartment, setSelectedDepartment] = useState<string | null>(null);
  const [deptEmployees, setDeptEmployees] = useState<DeptEmployee[]>([]);
  const [loadingDept, setLoadingDept] = useState(false);
  const [onlySubmitted, setOnlySubmitted] = useState(true);

  // HR Global Search States
  const [pulseSearchQuery, setPulseSearchQuery] = useState("");
  const [pulseSearchResults, setPulseSearchResults] = useState<any[]>([]);
  const [loadingPulseSearch, setLoadingPulseSearch] = useState(false);

  const handlePulseSearch = async (val: string) => {
    setPulseSearchQuery(val);
    if (!val.trim()) {
      setPulseSearchResults([]);
      return;
    }
    setLoadingPulseSearch(true);
    try {
      const data = await searchEmployees(val);
      setPulseSearchResults(data || []);
    } catch (error) {
      console.error("Failed to search employees:", error);
    } finally {
      setLoadingPulseSearch(false);
    }
  };


  // My Team state for HR users who are also managers
  const [myTeamEmployees, setMyTeamEmployees] = useState<TeamEmployee[]>([]);
  const [teamStats, setTeamStats] = useState<TeamStats | null>(null);
  const [rawManagerJds, setRawManagerJds] = useState<JDListItem[]>([]);
  const [viewingKraKpi, setViewingKraKpi] = useState<{
    jdId: string;
    employeeId: string;
    employeeName: string;
  } | null>(null);
  const [blockedEmployeeName, setBlockedEmployeeName] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);

  const searchParams = useSearchParams();
  const currentView = searchParams.get("view");

  const [filter, setFilter] = useState(
    currentView === "pending" ? "pending" : "sent_to_hr"
  );

  useEffect(() => {
    setPulseSearchQuery("");
    setPulseSearchResults([]);
    setSelectedDepartment(null);
  }, [filter]);

  const managerPendingJds = useMemo(() => {
    return rawManagerJds.filter(
      (j) =>
        j.status === "sent_to_manager" ||
        j.status === "hr_rejected" ||
        j.kra_kpi_status === "sent_to_manager"
    );
  }, [rawManagerJds]);

  // Derived JDs based on filter
  const jds = useMemo(() => {
    if (filter === "my_jds") return myJds;
    if (filter === "all") return allJds;
    if (filter === "sent_to_hr") {
      return allJds.filter((j) => j.status === "sent_to_hr" || j.kra_kpi_status === "sent_to_hr");
    }
    if (filter === "approved") {
      return allJds.filter((j) => j.status === "approved" && j.kra_kpi_status !== "sent_to_hr");
    }
    if (filter === "pending") {
      return managerPendingJds;
    }
    return allJds;
  }, [filter, allJds, myJds, managerPendingJds]);

  // Group team employees by department
  const groupedEmployees = useMemo(() => {
    const groups: Record<string, TeamEmployee[]> = {};
    myTeamEmployees.forEach((emp) => {
      const dept = emp.department || "Other";
      if (!groups[dept]) groups[dept] = [];
      groups[dept].push(emp);
    });
    return Object.keys(groups)
      .sort((a, b) => {
        if (a.toLowerCase() === 'cell therapeutics') return -1;
        if (b.toLowerCase() === 'cell therapeutics') return 1;
        return a.localeCompare(b);
      })
      .reduce((acc, key) => {
        acc[key] = groups[key];
        return acc;
      }, {} as Record<string, TeamEmployee[]>);
  }, [myTeamEmployees]);

  useEffect(() => {
    async function load() {
      try {
        const [allData, personalData, statsData, teamEmps, tStats, mJds] = await Promise.all([
          getJDs({ submitted_only: true }),
          fetchEmployeeJDs(user.employee_id),
          fetchHRDepartmentStats().catch(() => []),
          fetchMyTeamEmployees(user.employee_id).catch(() => []),
          fetchMyTeamStats(user.employee_id).catch(() => null),
          fetchManagerPendingJDs(user.employee_id).catch(() => []),
        ]);
        const data = allData || [];
        setAllJds(data);
        setMyJds(personalData || []);
        setDepartmentStats(statsData || []);
        setMyTeamEmployees(teamEmps || []);
        setTeamStats(tStats);
        setRawManagerJds(mJds || []);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [user.employee_id]);

  const handleDepartmentClick = async (deptName: string, submittedOnly: boolean = onlySubmitted) => {
    setSelectedDepartment(deptName);
    setLoadingDept(true);
    try {
      const data = await fetchDepartmentEmployees(deptName, 1, 100, submittedOnly);
      setDeptEmployees(data || []);
    } catch (error) {
      console.error("Error fetching department employees:", error);
    } finally {
      setLoadingDept(false);
    }
  };

  const handleToggleSubmitted = async (val: boolean) => {
    setOnlySubmitted(val);
    if (selectedDepartment) {
      await handleDepartmentClick(selectedDepartment, val);
    }
  };

  const closeDepartmentDetail = () => {
    setSelectedDepartment(null);
    setDeptEmployees([]);
  };



  if (loading) return <LoadingScreen />;

  if (viewingKraKpi) {
    return (
      <div className="absolute inset-0 overflow-y-auto p-4 sm:p-6 pb-24 animate-in fade-in duration-300">
        <div className="max-w-7xl mx-auto space-y-8 pt-14 pb-10 sm:pt-0">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-gradient-to-r from-slate-900 to-indigo-950 rounded-[2rem] p-6 text-white border border-white/10 shadow-lg">
            <div className="flex items-center gap-4">
              <button
                onClick={() => setViewingKraKpi(null)}
                className="w-10 h-10 bg-white/15 hover:bg-white/20 border border-white/10 rounded-xl flex items-center justify-center transition-colors"
              >
                <ChevronLeft className="w-5 h-5 text-white" />
              </button>
              <div>
                <h1 className="text-xl font-bold text-white">Manager Assessment Workspace</h1>
                <p className="text-xs text-indigo-300">Evaluating performance goals for {viewingKraKpi.employeeName}</p>
              </div>
            </div>
            <div className="bg-white/5 px-4 py-3 rounded-lg border border-white/10 backdrop-blur-sm self-start sm:self-center">
              <span className="text-[10px] font-medium tracking-[0.2em] text-blue-300 block mb-0.5">JD Session ID</span>
              <span className="text-xs font-mono font-bold text-slate-200">{viewingKraKpi.jdId}</span>
            </div>
          </div>
          <div className="bg-white rounded-[2.5rem] border border-surface-200 shadow-xl overflow-hidden">
            <KRAKPIPanel
              jdSessionId={viewingKraKpi.jdId}
              employeeId={viewingKraKpi.employeeId}
              isManager={true}
            />
          </div>
        </div>
      </div>
    );
  }

  const counts = {
    all: allJds.length,
    sent_to_hr: allJds.filter((j) => j.status === "sent_to_hr" || j.kra_kpi_status === "sent_to_hr").length,
    approved: allJds.filter((j) => j.status === "approved" && j.kra_kpi_status !== "sent_to_hr").length,
    my_jds: myJds.length,
    pending: managerPendingJds.length,
  };

  const filterTabs = [
    {
      key: "sent_to_hr",
      label: "Action Required by HR",
      count: counts.sent_to_hr,
      icon: Clock,
      color: "text-amber-600",
      alert: counts.sent_to_hr > 0,
    },
    {
      key: "approved",
      label: "Approved JDs",
      count: counts.approved,
      icon: FileText,
      color: "text-emerald-600",
    },
    {
      key: "my_jds",
      label: "My JDs",
      count: counts.my_jds,
      icon: FileText,
      color: "text-blue-600",
    },
  ];

  if (myTeamEmployees.length > 0) {
    filterTabs.push({
      key: "pending",
      label: "Action Required (Manager)",
      count: counts.pending,
      icon: Clock,
      color: "text-amber-600",
      alert: counts.pending > 0,
    });
    filterTabs.push({
      key: "my_team",
      label: "My Team",
      count: myTeamEmployees.length,
      icon: Users,
      color: "text-indigo-600",
    });
  }

  filterTabs.push({
    key: "departments",
    label: "Department Pulse",
    count: departmentStats.length,
    icon: Users,
    color: "text-purple-600",
  });

  return (
    <div className="absolute inset-0 overflow-y-auto p-4 sm:p-6 pb-24">
      <div className="max-w-7xl mx-auto space-y-8 sm:space-y-10 pt-14 pb-10 sm:pt-0 animate-in fade-in slide-in-from-bottom-4 duration-700">
        {/* Admin Purple Gradient Header */}
        <header className="bg-gradient-to-r from-purple-900 via-indigo-900 to-indigo-800 rounded-md p-6 sm:p-8 shadow-md shadow-indigo-900/20 text-white relative overflow-hidden">
          {/* Abstract shapes */}
          <div className="absolute top-0 right-0 p-32 bg-purple-500/20 rounded-md blur-3xl -translate-y-1/2 translate-x-1/2" />
          <div className="absolute bottom-0 left-0 p-32 bg-blue-500/20 rounded-md blur-3xl translate-y-1/2 -translate-x-1/2" />

          <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div>
              <div className="inline-flex items-center gap-2 mb-4 px-3 py-1.5 bg-white/10 backdrop-blur-md rounded-lg border border-white/20">
                <ShieldCheck className="w-4 h-4 text-purple-200" />
                <span className="text-[10px] font-medium tracking-[0.2em] text-purple-100">
                  HR Center
                </span>
              </div>
              <h1 className="text-2xl sm:text-3xl md:text-4xl font-medium mb-2">
                Welcome, {user?.name}
              </h1>
              <p className="text-indigo-200 font-medium">
                Enterprise Job Description Interview Platform
              </p>
            </div>

            {/* Quick Metrics right in the header */}
            <div className="flex bg-black/20 p-4 rounded-md border border-white/10 backdrop-blur-md w-full sm:w-auto divide-x divide-white/10">
              <div className="text-center px-2 sm:px-4 flex-1">
                <p className="text-2xl sm:text-3xl font-medium text-white">
                  {counts.all}
                </p>
                <p className="text-[10px] font-medium text-indigo-300 line-clamp-1">
                  Total JD's
                </p>
              </div>
              <div className="text-center px-2 sm:px-4 flex-1">
                <p className="text-2xl sm:text-3xl font-medium text-emerald-400">
                  {counts.approved}
                </p>
                <p className="text-[10px] font-medium text-indigo-300 line-clamp-1">
                  Total Approved
                </p>
              </div>
            </div>
          </div>
        </header>

        {/* Administrative Filters - Horizontal Scrollable Row style */}
        <div className="bg-white p-2 rounded-md border border-surface-200 shadow-sm flex flex-wrap gap-2">
          {filterTabs.map(({ key, label, count, icon: Icon, color, alert }) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={`flex-1 min-w-[140px] sm:min-w-[200px] flex items-center justify-between p-3 sm:p-4 rounded-md transition-all duration-300 ${filter === key
                ? "bg-purple-50 ring-2 ring-purple-500 shadow-sm"
                : "hover:bg-surface-50"
                }`}
            >
              <div className="flex items-center gap-3">
                <div
                  className={`w-8 h-8 rounded-lg flex items-center justify-center ${filter === key ? "bg-purple-100/50" : "bg-surface-100"}`}
                >
                  <Icon
                    className={`w-4 h-4 ${filter === key ? "text-purple-700" : color}`}
                  />
                </div>
                <span
                  className={`text-[11px] sm:text-[13px] font-medium ${filter === key ? "text-purple-900" : "text-surface-700"}`}
                >
                  {label}
                </span>
              </div>
              <div className="relative">
                <span
                  className={`text-[11px] px-2 py-1 rounded-md font-medium ${filter === key
                    ? "bg-purple-600 text-white"
                    : alert
                      ? "bg-amber-100 text-amber-700"
                      : "bg-surface-100 text-surface-500"
                    }`}
                >
                  {count}
                </span>
                {alert && filter !== key && (
                  <span className="absolute -top-1 -right-1 w-2 h-2 bg-amber-500 rounded-md animate-pulse" />
                )}
              </div>
            </button>
          ))}
        </div>

        {filter === "departments" && !selectedDepartment && (
          <div className="space-y-6">
            {/* Sleek Global Search Input */}
            <div className="bg-white rounded-md border border-surface-200 shadow-sm p-4 sm:p-6">
              <div className="relative max-w-xl">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search any employee by name or employee ID to view JD, KRA and KPI..."
                  value={pulseSearchQuery}
                  onChange={(e) => handlePulseSearch(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500/40 focus:border-purple-400 text-sm text-slate-800 placeholder:text-slate-400 transition-all"
                />
                {pulseSearchQuery && (
                  <button
                    onClick={() => handlePulseSearch("")}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-slate-600 font-semibold"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>

            {pulseSearchQuery ? (
              /* Global Search Results List */
              <div className="bg-white rounded-md border border-surface-200 shadow-md overflow-hidden mb-8">
                <div className="px-4 sm:px-8 py-5 border-b border-surface-100 flex items-center justify-between bg-surface-50/50">
                  <h2 className="text-sm font-semibold text-slate-800 tracking-wide">
                    Search Results ({pulseSearchResults.length})
                  </h2>
                </div>
                {loadingPulseSearch ? (
                  <div className="p-16 flex flex-col items-center justify-center gap-4">
                    <Loader2 className="w-8 h-8 text-purple-600 animate-spin" />
                    <p className="text-surface-500 font-medium">Searching employees...</p>
                  </div>
                ) : pulseSearchResults.length === 0 ? (
                  <div className="p-16 text-center">
                    <p className="text-surface-500">No employees found matching "{pulseSearchQuery}"</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-surface-50/50">
                          <th className="px-6 py-4 text-[10px] font-medium text-surface-400 border-b border-surface-100 w-1/4">Employee</th>
                          <th className="px-6 py-4 text-[10px] font-medium text-surface-400 border-b border-surface-100 w-1/4">Designation & Dept</th>
                          <th className="px-6 py-4 text-[10px] font-medium text-surface-400 border-b border-surface-100">JD Status</th>
                          <th className="px-6 py-4 text-[10px] font-medium text-surface-400 border-b border-surface-100">KRA / KPI</th>
                          <th className="px-6 py-4 text-[10px] font-medium text-surface-400 border-b border-surface-100">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-surface-50">
                        {pulseSearchResults.map((emp) => (
                          <tr key={emp.employee_id} className="hover:bg-surface-50/50 transition-colors group">
                            <td className="px-6 py-4">
                              <div className="flex items-center gap-3">
                                <div className="w-9 h-9 rounded-md bg-purple-50 text-purple-600 flex items-center justify-center font-medium text-xs ring-1 ring-purple-100">
                                  {emp.name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}
                                </div>
                                <div>
                                  <p className="font-semibold text-surface-900 text-sm">{emp.name}</p>
                                  <p className="text-[10px] font-medium text-surface-400 font-mono ">{emp.employee_id}</p>
                                </div>
                              </div>
                            </td>
                            <td className="px-6 py-4">
                              <p className="text-xs font-semibold text-surface-600 leading-snug">{emp.designation}</p>
                              <p className="text-[10px] text-surface-400 mt-0.5">{emp.department}</p>
                            </td>
                            <td className="px-6 py-4">
                              {(() => {
                                const status = emp.jd_status;
                                let label = STATUS_CONFIG[status as keyof typeof STATUS_CONFIG]?.label || status;
                                let bg = STATUS_CONFIG[status as keyof typeof STATUS_CONFIG]?.bg || 'bg-surface-100 border-surface-200 text-surface-500';
                                let color = STATUS_CONFIG[status as keyof typeof STATUS_CONFIG]?.color || '';
                                
                                if (status === "approved" && emp.kra_kpi_status === "sent_to_manager") {
                                  label = "KRA/KPI Review";
                                  bg = "bg-blue-50 border-blue-200 text-blue-700";
                                  color = "text-blue-700";
                                } else if (status === "approved" && emp.kra_kpi_status === "sent_to_hr") {
                                  label = "KRA/KPI HR Review";
                                  bg = "bg-purple-50 border-purple-200 text-purple-700";
                                  color = "text-purple-700";
                                } else if (status === "approved" && emp.kra_kpi_status === "manager_rejected") {
                                  label = "KRA/KPI Rejected";
                                  bg = "bg-red-50 border-red-200 text-red-700";
                                  color = "text-red-700";
                                } else if (status === "approved" && emp.kra_kpi_status === "hr_rejected") {
                                  label = "KRA/KPI HR Rejected";
                                  bg = "bg-red-50 border-red-200 text-red-700";
                                  color = "text-red-700";
                                } else if (status === "approved" && (emp.kra_kpi_status === "draft" || emp.kra_kpi_status === "confirmed")) {
                                  label = "KRA/KPI Under Process";
                                  bg = "bg-amber-50 border-amber-200 text-amber-700";
                                  color = "text-amber-700";
                                }
                                
                                return (
                                  <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-lg border text-[10px] font-medium ${bg} ${color}`}>
                                    <span className={`w-1.5 h-1.5 rounded-md bg-current opacity-40`} />
                                    {label}
                                  </div>
                                );
                              })()}
                            </td>
                            <td className="px-6 py-4">
                              {emp.jd_id ? (
                                <button
                                  onClick={() => {
                                    if (!emp.kra_kpi_status || emp.kra_kpi_status === "draft") {
                                      setBlockedEmployeeName(emp.name);
                                    } else {
                                      setViewingKraKpi({
                                        jdId: emp.jd_id!,
                                        employeeId: emp.employee_id,
                                        employeeName: emp.name
                                      });
                                    }
                                  }}
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 transition-all text-[10px] font-semibold tracking-wider group/btn shadow-sm"
                                >
                                  <Target className="w-3.5 h-3.5 text-blue-600 group-hover/btn:scale-110 transition-transform" />
                                  View Goals
                                </button>
                              ) : (
                                <span className="text-[10px] font-medium text-surface-300">—</span>
                              )}
                            </td>
                            <td className="px-6 py-4">
                              {emp.jd_id ? (
                                <Link
                                  href={`/jd/${emp.jd_id}`}
                                  className="inline-flex items-center gap-2 text-[10px] font-medium text-emerald-600 hover:text-emerald-700 transition-colors"
                                >
                                  View JD
                                  <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
                                </Link>
                              ) : (
                                <Link
                                  href={`/dashboard/${safeBtoa(emp.employee_id)}`}
                                  className="inline-flex items-center gap-2 text-[10px] font-medium text-primary-600 hover:text-primary-700 transition-colors"
                                >
                                  NO JD
                                  <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
                                </Link>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ) : (
              /* Original Department Overview Grid */
              <div className="bg-white rounded-md border border-surface-200 shadow-md overflow-hidden mb-8">
                <div className="px-4 sm:px-8 py-5 sm:py-6 border-b border-surface-100 flex flex-col sm:flex-row sm:items-center justify-between bg-surface-50/50 gap-4">
                  <h2 className="text-lg sm:text-xl font-medium text-surface-900 flex items-center gap-3">
                    <span className="w-1.5 h-6 bg-purple-600 rounded-md" />
                    Department Overview
                  </h2>
                </div>

                {loading ? (
                  <div className="p-16 flex flex-col items-center justify-center gap-4">
                    <Loader2 className="w-8 h-8 text-primary-500 animate-spin" />
                    <p className="text-surface-500 font-medium">Loading stats...</p>
                  </div>
                ) : departmentStats.length === 0 ? (
                  <div className="p-16 text-center">
                    <p className="text-surface-500">
                      No department statistics found.
                    </p>
                  </div>
                ) : (
                  <div className="p-6 sm:p-8 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {departmentStats.map((stat) => (
                      <div
                        key={stat.department}
                        onClick={() => handleDepartmentClick(stat.department)}
                        className="border border-surface-200 rounded-md p-5 bg-surface-50/30 hover:shadow-md hover:border-purple-300 transition-all cursor-pointer group"
                      >
                        <div className="flex justify-between items-start mb-4">
                          <h3 className="text-lg font-medium text-surface-900 group-hover:text-purple-700 transition-colors">
                            {stat.department}
                          </h3>
                          <div className="bg-white p-1.5 rounded-lg shadow-sm border border-surface-100">
                            <Users className="w-4 h-4 text-surface-400" />
                          </div>
                        </div>

                        <div className="flex justify-between items-center mb-2">
                          <span className="text-sm font-medium text-surface-500">
                            Completion ({stat.completed_jds}/{stat.total_employees})
                          </span>
                          <span className="text-sm font-medium text-purple-600">
                            {stat.completion_percentage}%
                          </span>
                        </div>
                        <div className="w-full h-3 bg-surface-200 rounded-md overflow-hidden mb-6">
                          <div
                            className="h-full bg-purple-500 rounded-md transition-all duration-1000 ease-out"
                            style={{ width: `${stat.completion_percentage}%` }}
                          />
                        </div>

                        <div className="grid grid-cols-3 gap-3">
                          <div className="bg-white p-2.5 rounded-md border border-surface-100 text-center">
                            <span className="block text-[10px] font-medium text-surface-400 tracking-wider mb-1">
                              Submitted
                            </span>
                            <span className="text-lg font-medium text-surface-800">
                              {stat.submitted}
                            </span>
                          </div>
                          <div className="bg-white p-2.5 rounded-md border border-surface-100 text-center">
                            <span className="block text-[10px] font-medium text-surface-400 tracking-wider mb-1">
                              Reviewing
                            </span>
                            <span className="text-lg font-medium text-purple-600">
                              {stat.under_review}
                            </span>
                          </div>
                          <div className="bg-white p-2.5 rounded-md border border-surface-100 text-center">
                            <span className="block text-[10px] font-medium text-surface-400 tracking-wider mb-1">
                              Approved
                            </span>
                            <span className="text-lg font-medium text-emerald-600">
                              {stat.approved}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {filter === "departments" && selectedDepartment && (
          <div className="bg-white rounded-md border border-surface-200 shadow-md overflow-hidden mb-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="px-4 sm:px-8 py-5 sm:py-6 border-b border-surface-100 flex flex-col sm:flex-row sm:items-center justify-between bg-surface-50/50 gap-4">
              <div className="flex items-center gap-3">
                <button
                  onClick={closeDepartmentDetail}
                  className="p-2 -ml-2 text-surface-400 hover:text-surface-700 hover:bg-surface-200 rounded-md transition-colors shrink-0"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <h2 className="text-lg sm:text-xl font-medium text-surface-900 flex items-center gap-2">
                  <Users className="w-5 h-5 text-purple-500" />
                  {selectedDepartment} Directory
                </h2>
              </div>
              <div className="flex items-center gap-2 bg-surface-200/50 p-1.5 rounded-md">
                <button
                  onClick={() => handleToggleSubmitted(true)}
                  className={`px-4 py-2 text-[11px] font-medium rounded-md transition-all ${onlySubmitted
                    ? "bg-white text-primary-600 shadow-sm"
                    : "text-surface-500 hover:text-surface-700"
                    }`}
                >
                  Submitted
                </button>
                <button
                  onClick={() => handleToggleSubmitted(false)}
                  className={`px-4 py-2 text-[11px] font-medium rounded-md transition-all ${!onlySubmitted
                    ? "bg-white text-surface-900 shadow-sm"
                    : "text-surface-500 hover:text-surface-700"
                    }`}
                >
                  Show All
                </button>
              </div>
            </div>

            {loadingDept ? (
              <div className="p-16 flex flex-col items-center justify-center gap-4">
                <Loader2 className="w-8 h-8 text-purple-500 animate-spin" />
                <p className="text-surface-500 font-medium">
                  Loading employees...
                </p>
              </div>
            ) : deptEmployees.length === 0 ? (
              <div className="p-16 text-center">
                <div className="w-20 h-20 bg-surface-50 rounded-md flex items-center justify-center mx-auto mb-6 border border-surface-100">
                  <Users className="w-10 h-10 text-surface-300" />
                </div>
                <h3 className="text-lg font-medium text-surface-800 mb-2">
                  No Employees Found
                </h3>
                <p className="text-base text-surface-400 max-w-sm mx-auto">
                  There are currently no employees assigned to this department
                  in the Global Directory.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-surface-50/80 border-b border-surface-200 text-[10px] sm:text-xs font-medium text-surface-500 tracking-wider">
                      <th className="px-3 sm:px-6 py-4 font-medium">Employee</th>
                      <th className="px-3 sm:px-6 py-4 font-medium">Designation</th>
                      <th className="px-3 sm:px-6 py-4 font-medium">Reporting Manager</th>
                      <th className="px-3 sm:px-6 py-4 font-medium">JD Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-100">
                    {deptEmployees.map((emp) => {
                      const config =
                        STATUS_CONFIG[emp.jd_status as keyof typeof STATUS_CONFIG] ||
                        STATUS_CONFIG["Not Submitted"];
                      return (
                        <tr
                          key={emp.employee_id}
                          onClick={() => emp.jd_id && router.push(`/jd/${emp.jd_id}`)}
                          className={`group/row transition-all duration-300 ${emp.jd_id
                            ? "cursor-pointer hover:bg-primary-50/50"
                            : "hover:bg-surface-50/60"
                            }`}
                        >
                          <td className="px-3 sm:px-6 py-4">
                            <div className="flex flex-col">
                              <span className={`font-medium transition-colors ${emp.jd_id ? "group-hover/row:text-primary-600 text-surface-900" : "text-surface-900"}`}>
                                {emp.name}
                              </span>
                              <span className="text-[11px] font-medium text-surface-400">
                                {emp.employee_id}
                              </span>
                            </div>
                          </td>
                          <td className="px-3 sm:px-6 py-4 text-sm font-medium text-surface-700">
                            {emp.designation || "—"}
                          </td>
                          <td className="px-3 sm:px-6 py-4 text-sm font-medium text-surface-700">
                            {emp.reporting_manager || "—"}
                          </td>
                          <td className="px-3 sm:px-6 py-4">
                            <div className="flex items-center justify-between">
                              <div>
                                <span
                                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium border ${config.bg} ${config.color}`}
                                >
                                  <span className="w-1.5 h-1.5 rounded-md bg-current" />
                                  {config.label}
                                </span>
                                {emp.last_updated &&
                                  emp.jd_status !== "Not Submitted" && (
                                    <div className="mt-1 text-[10px] font-medium text-surface-400 flex items-center gap-1">
                                      <Clock className="w-3 h-3" />
                                      {new Date(
                                        emp.last_updated,
                                      ).toLocaleDateString()}
                                    </div>
                                  )}
                              </div>
                              {emp.jd_id && (
                                <ArrowRight className="w-4 h-4 text-primary-400 opacity-0 group-hover/row:opacity-100 group-hover/row:translate-x-1 transition-all" />
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {filter !== "departments" && filter !== "my_team" && filter !== "pending" && filter !== "sent_to_hr" && (
          <div className="space-y-6">
            <h2 className="text-xl font-medium text-surface-900 flex items-center gap-3 px-2">
              <span className="w-1.5 h-6 bg-purple-600 rounded-md" />
              {filter === "my_jds"
                ? "Your Personal Documents"
                : "Workflow Results"}
            </h2>
            <JDGrid 
              jds={jds} 
              showEmployee={filter !== "my_jds"} 
              onViewKraKpi={(jdId, employeeId, employeeName, kraKpiStatus) => {
                if (!kraKpiStatus || kraKpiStatus === "draft") {
                  setBlockedEmployeeName(employeeName);
                } else {
                  setViewingKraKpi({ jdId, employeeId, employeeName });
                }
              }}
            />
          </div>
        )}

        {(filter === "pending" || filter === "sent_to_hr") && (
          <div className="space-y-6">
            <h2 className="text-xl font-medium text-surface-900 flex items-center gap-3 px-2">
              <span className="w-1.5 h-6 bg-purple-600 rounded-md" />
              {filter === "pending" ? "Awaiting Your Approval (Manager)" : "Action Required by HR"}
            </h2>
            <PendingActionsTable
              items={jds}
              type={filter === "pending" ? "manager" : "hr"}
              onViewKraKpi={(jdId, employeeId, employeeName) => {
                setViewingKraKpi({ jdId, employeeId, employeeName });
              }}
              router={router}
            />
          </div>
        )}

        {filter === "my_team" && (
          <div className="space-y-6">
            <h2 className="text-xl font-medium text-surface-900 flex items-center gap-3 px-2">
              <span className="w-1.5 h-6 bg-purple-600 rounded-md" />
              Team Progress Overview
            </h2>
            {myTeamEmployees.length === 0 ? (
              <div className="bg-white rounded-[2.5rem] border border-surface-200 shadow-md p-20 text-center">
                <Users className="w-12 h-12 text-surface-200 mx-auto mb-4" />
                <p className="text-surface-500 font-medium">No team members identified in your scope.</p>
              </div>
            ) : (
              <div className="space-y-8 animate-in fade-in duration-500">
                {/* Stats Summary */}
                {teamStats && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                    <div className="bg-white p-6 rounded-md border border-surface-200 shadow-md hover:shadow-md transition-all duration-300 relative overflow-hidden group">
                      <div className="absolute top-0 right-0 w-24 h-24 bg-primary-500/5 rounded-md blur-2xl -translate-y-1/2 translate-x-1/2 group-hover:scale-150 transition-transform duration-700" />
                      <p className="text-[10px] font-medium tracking-[0.2em] text-surface-400 mb-2">Total Team</p>
                      <p className="text-4xl font-medium text-surface-900 ">{teamStats?.total_employees || 0}</p>
                    </div>
                    <div className="bg-white p-6 rounded-md border border-surface-200 shadow-md hover:shadow-md transition-all duration-300 relative overflow-hidden group">
                      <div className="absolute top-0 right-0 w-24 h-24 bg-blue-500/5 rounded-md blur-2xl -translate-y-1/2 translate-x-1/2 group-hover:scale-150 transition-transform duration-700" />
                      <p className="text-[10px] font-medium tracking-[0.2em] text-blue-500 mb-2">In Progress</p>
                      <p className="text-4xl font-medium text-surface-900 ">{(teamStats?.submitted || 0) + (teamStats?.under_review || 0)}</p>
                    </div>
                    <div className="bg-white p-6 rounded-md border border-surface-200 shadow-md hover:shadow-md transition-all duration-300 relative overflow-hidden group">
                      <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-500/5 rounded-md blur-2xl -translate-y-1/2 translate-x-1/2 group-hover:scale-150 transition-transform duration-700" />
                      <p className="text-[10px] font-medium tracking-[0.2em] text-emerald-500 mb-2">Approved</p>
                      <p className="text-4xl font-medium text-surface-900 ">{teamStats?.approved || 0}</p>
                    </div>
                    <div className="bg-white p-6 rounded-md border border-surface-200 shadow-md hover:shadow-md transition-all duration-300 relative overflow-hidden group">
                      <div className="absolute top-0 right-0 w-24 h-24 bg-primary-500/10 rounded-md blur-2xl -translate-y-1/2 translate-x-1/2 group-hover:scale-150 transition-transform duration-700" />
                      <p className="text-[10px] font-medium tracking-[0.2em] text-primary-500 mb-2">Completion</p>
                      <p className="text-4xl font-medium text-surface-900 ">{teamStats?.completion_percentage || 0}%</p>
                    </div>
                  </div>
                )}
                
                {/* Employee Directory Grouped by Department */}
                <div className="space-y-8">
                  {Object.entries(groupedEmployees).map(([deptName, emps]) => (
                    <div key={deptName} className="space-y-4">
                      <div className="flex items-center gap-2.5 px-2">
                        <span className="w-1.5 h-4 rounded-full bg-primary-500 shadow-sm" />
                        <h3 className="text-sm font-semibold text-surface-800 tracking-wide">{deptName}</h3>
                        <span className="text-[10px] font-bold bg-primary-50 text-primary-600 px-2 py-0.5 rounded-full ring-1 ring-primary-100/30">
                          {emps.length} {emps.length === 1 ? 'member' : 'members'}
                        </span>
                      </div>
                      
                      <div className="bg-white rounded-[2.5rem] border border-surface-200 shadow-md overflow-hidden">
                        <div className="overflow-x-auto">
                          <table className="w-full text-left border-collapse">
                            <thead>
                              <tr className="bg-surface-50/50">
                                <th className="px-6 py-5 text-[10px] font-medium text-surface-400 border-b border-surface-100 w-1/4">Team Member</th>
                                <th className="px-6 py-5 text-[10px] font-medium text-surface-400 border-b border-surface-100 w-1/4">Designation</th>
                                <th className="px-6 py-5 text-[10px] font-medium text-surface-400 border-b border-surface-100">JD Status</th>
                                <th className="px-6 py-5 text-[10px] font-medium text-surface-400 border-b border-surface-100">KRA / KPI</th>
                                <th className="px-6 py-5 text-[10px] font-medium text-surface-400 border-b border-surface-100">Action</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-surface-50">
                              {emps.map((emp) => (
                                <tr key={emp.employee_id} className="hover:bg-surface-50/50 transition-colors group">
                                  <td className="px-6 py-5">
                                    <div className="flex items-center gap-3">
                                      <div className="w-10 h-10 rounded-md bg-primary-50 text-primary-600 flex items-center justify-center font-medium text-xs ring-1 ring-primary-100">
                                        {emp.name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}
                                      </div>
                                      <div>
                                        <p className="font-medium text-surface-900 text-sm">{emp.name}</p>
                                        <p className="text-[10px] font-medium text-surface-400 font-mono ">{emp.employee_id}</p>
                                      </div>
                                    </div>
                                  </td>
                                  <td className="px-6 py-5">
                                    <p className="text-xs font-medium text-surface-600 leading-snug">{emp.designation}</p>
                                    <p className="text-[10px] text-surface-400 mt-0.5">Manager: {emp.reporting_manager || 'None'}</p>
                                  </td>
                                  <td className="px-6 py-5">
                                    {(() => {
                                      const status = emp.jd_status;
                                      let label = STATUS_CONFIG[status as keyof typeof STATUS_CONFIG]?.label || status;
                                      let bg = STATUS_CONFIG[status as keyof typeof STATUS_CONFIG]?.bg || 'bg-surface-100 border-surface-200 text-surface-500';
                                      let color = STATUS_CONFIG[status as keyof typeof STATUS_CONFIG]?.color || '';
                                      
                                      if (status === "approved" && emp.kra_kpi_status === "sent_to_manager") {
                                        label = "KRA/KPI Review";
                                        bg = "bg-blue-50 border-blue-200 text-blue-700";
                                        color = "text-blue-700";
                                      } else if (status === "approved" && emp.kra_kpi_status === "sent_to_hr") {
                                        label = "KRA/KPI HR Review";
                                        bg = "bg-purple-50 border-purple-200 text-purple-700";
                                        color = "text-purple-700";
                                      } else if (status === "approved" && emp.kra_kpi_status === "manager_rejected") {
                                        label = "KRA/KPI Rejected";
                                        bg = "bg-red-50 border-red-200 text-red-700";
                                        color = "text-red-700";
                                      } else if (status === "approved" && emp.kra_kpi_status === "hr_rejected") {
                                        label = "KRA/KPI HR Rejected";
                                        bg = "bg-red-50 border-red-200 text-red-700";
                                        color = "text-red-700";
                                      } else if (status === "approved" && (emp.kra_kpi_status === "draft" || emp.kra_kpi_status === "confirmed")) {
                                        label = "KRA/KPI Under Process";
                                        bg = "bg-amber-50 border-amber-200 text-amber-700";
                                        color = "text-amber-700";
                                      }
                                      
                                      return (
                                        <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-lg border text-[10px] font-medium ${bg} ${color}`}>
                                          <span className={`w-1.5 h-1.5 rounded-md bg-current opacity-40`} />
                                          {label}
                                        </div>
                                      );
                                    })()}
                                  </td>
                                  <td className="px-6 py-5">
                                    {emp.jd_id ? (
                                      <button
                                        onClick={() => {
                                          if (!emp.kra_kpi_status || emp.kra_kpi_status === "draft") {
                                            setBlockedEmployeeName(emp.name);
                                          } else {
                                            setViewingKraKpi({
                                              jdId: emp.jd_id!,
                                              employeeId: emp.employee_id,
                                              employeeName: emp.name
                                            });
                                          }
                                        }}
                                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 transition-all text-[10px] font-semibold tracking-wider group/btn shadow-sm"
                                      >
                                        <Target className="w-3.5 h-3.5 text-blue-600 group-hover/btn:scale-110 transition-transform" />
                                        View Goals
                                      </button>
                                    ) : (
                                      <span className="text-[10px] font-medium text-surface-300">—</span>
                                    )}
                                  </td>
                                  <td className="px-6 py-5">
                                    {emp.jd_id ? (
                                      <Link
                                        href={`/jd/${emp.jd_id}`}
                                        className="inline-flex items-center gap-2 text-[10px] font-medium text-emerald-600 hover:text-emerald-700 transition-colors"
                                      >
                                        View JD
                                        <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
                                      </Link>
                                    ) : (
                                      <Link
                                        href={`/dashboard/${safeBtoa(emp.employee_id)}`}
                                        className="inline-flex items-center gap-2 text-[10px] font-medium text-primary-600 hover:text-primary-700 transition-colors"
                                      >
                                        NO JD
                                        <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
                                      </Link>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {blockedEmployeeName && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white rounded-[2rem] p-8 max-w-md w-full mx-4 shadow-xl border border-surface-200 animate-in zoom-in-95 duration-200 text-center relative overflow-hidden">
              <div className="absolute top-0 left-1/2 -translate-x-1/2 w-48 h-48 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />
              <div className="w-16 h-16 bg-amber-50 rounded-2xl flex items-center justify-center mx-auto mb-6 border border-amber-100 relative z-10 animate-bounce">
                <Clock className="w-8 h-8 text-amber-500" />
              </div>
              <h3 className="text-xl font-bold text-surface-900 mb-3 relative z-10">
                KRA & KPI Under Review
              </h3>
              <p className="text-sm text-surface-500 max-w-xs mx-auto leading-relaxed mb-8 relative z-10">
                The KRA & KPI performance goals for <strong className="text-slate-800 font-semibold">{blockedEmployeeName}</strong> are currently under review or have not been finalized yet.
              </p>
              <button
                onClick={() => setBlockedEmployeeName(null)}
                className="w-full py-3 bg-surface-900 hover:bg-surface-800 text-white rounded-xl text-xs font-bold transition-colors shadow-lg shadow-surface-900/20 active:scale-[0.98]"
              >
                Understood, Go Back
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SkillAssessmentDirectory({
  employees,
  onAssessEmployee,
}: {
  employees: any[];
  onAssessEmployee: (jdId: string, employeeId: string, employeeName: string, kraKpiStatus?: string | null) => void;
}) {
  const [subFilter, setSubFilter] = useState<"all" | "completed" | "pending">("all");

  const ratedEmployees = employees.filter((emp) => {
    return emp.kra_kpi_status === "approved";
  });

  const pendingEmployees = employees.filter((emp) => {
    return emp.kra_kpi_status !== "approved" && emp.jd_id && emp.kra_kpi_status && emp.kra_kpi_status !== "draft" && emp.kra_kpi_status !== "confirmed";
  });

  const filtered = useMemo(() => {
    if (subFilter === "completed") return ratedEmployees;
    if (subFilter === "pending") return pendingEmployees;
    return employees.filter(emp => emp.jd_id);
  }, [subFilter, employees, ratedEmployees, pendingEmployees]);

  // Group by department
  const grouped = useMemo(() => {
    const groups: Record<string, any[]> = {};
    filtered.forEach((emp) => {
      const dept = emp.department || "Other";
      if (!groups[dept]) groups[dept] = [];
      groups[dept].push(emp);
    });
    // Sort departments alphabetically
    return Object.keys(groups)
      .sort((a, b) => a.localeCompare(b))
      .reduce((acc, key) => {
        acc[key] = groups[key];
        return acc;
      }, {} as Record<string, any[]>);
  }, [filtered]);

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Sub tabs filter */}
      <div className="flex gap-2 border-b border-surface-200 pb-px">
        {[
          { key: "all", label: `All Team Members (${employees.filter(e => e.jd_id).length})` },
          { key: "completed", label: `Completed Assessments (${ratedEmployees.length})` },
          { key: "pending", label: `Pending Assessments (${pendingEmployees.length})` },
        ].map((tab) => {
          const isActive = subFilter === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setSubFilter(tab.key as any)}
              className={`px-4 py-2 text-xs font-semibold border-b-2 -mb-px transition-all ${
                isActive
                  ? "border-primary-600 text-primary-600 font-bold"
                  : "border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300"
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {Object.keys(grouped).length === 0 ? (
        <div className="bg-white rounded-[2.5rem] border border-surface-200 shadow-md p-20 text-center">
          <Award className="w-12 h-12 text-surface-200 mx-auto mb-4" />
          <p className="text-surface-500 font-medium">No skill assessments match the selected filter.</p>
        </div>
      ) : (
        <div className="space-y-8">
          {Object.entries(grouped).map(([deptName, emps]) => (
            <div key={deptName} className="space-y-4">
              <div className="flex items-center gap-2.5 px-2">
                <span className="w-1.5 h-4 rounded-full bg-primary-500 shadow-sm" />
                <h3 className="text-sm font-semibold text-surface-800 tracking-wide">{deptName}</h3>
                <span className="text-[10px] font-bold bg-primary-50 text-primary-600 px-2 py-0.5 rounded-full">
                  {emps.length} {emps.length === 1 ? 'member' : 'members'}
                </span>
              </div>

              <div className="bg-white rounded-[2.5rem] border border-surface-200 shadow-md overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-surface-50/50">
                        <th className="px-6 py-5 text-[10px] font-medium text-surface-400 border-b border-surface-100 w-1/3">Team Member</th>
                        <th className="px-6 py-5 text-[10px] font-medium text-surface-400 border-b border-surface-100 w-1/3">Designation</th>
                        <th className="px-6 py-5 text-[10px] font-medium text-surface-400 border-b border-surface-100">Assessment Status</th>
                        <th className="px-6 py-5 text-[10px] font-medium text-surface-400 border-b border-surface-100 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-surface-50">
                      {emps.map((emp) => {
                        const isRated = emp.kra_kpi_status === "approved";
                        return (
                          <tr key={emp.employee_id} className="hover:bg-surface-50/50 transition-colors group">
                            <td className="px-6 py-5">
                              <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-md bg-primary-50 text-primary-600 flex items-center justify-center font-medium text-xs ring-1 ring-primary-100">
                                  {emp.name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}
                                </div>
                                <div>
                                  <p className="font-medium text-surface-900 text-sm">{emp.name}</p>
                                  <p className="text-[10px] font-medium text-surface-400 font-mono ">{emp.employee_id}</p>
                                </div>
                              </div>
                            </td>
                            <td className="px-6 py-5">
                              <p className="text-xs font-medium text-surface-600 leading-snug">{emp.designation}</p>
                            </td>
                            <td className="px-6 py-5">
                              <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-lg border text-[10px] font-medium ${
                                isRated 
                                  ? "bg-emerald-50 border-emerald-200 text-emerald-700" 
                                  : "bg-amber-50 border-amber-200 text-amber-700"
                              }`}>
                                <span className={`w-1.5 h-1.5 rounded-md bg-current opacity-40`} />
                                {isRated ? "Completed & Sent" : "Awaiting Assessment"}
                              </div>
                            </td>
                            <td className="px-6 py-5 text-right">
                              <button
                                onClick={() => onAssessEmployee(emp.jd_id, emp.employee_id, emp.name, emp.kra_kpi_status)}
                                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-semibold tracking-wider shadow-sm transition-all border ${
                                  isRated
                                    ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                                    : "border-primary-200 bg-primary-50 text-primary-700 hover:bg-primary-100"
                                }`}
                              >
                                <Award className="w-3.5 h-3.5 animate-pulse" />
                                {isRated ? "View Skill Profile" : "Rate Capabilities"}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Loading screen (your original style) ─────────────────────────────────────

function LoadingScreen() {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface-50">
      <div className="text-center">
        <div className="relative mb-4">
          <div className="absolute inset-0 bg-primary-100 rounded-md animate-ping opacity-20 scale-150" />
          <Loader2 className="w-10 h-10 text-primary-600 animate-spin mx-auto relative z-10" />
        </div>
        <p className="text-sm font-semibold text-surface-400">
          Loading your dashboard...
        </p>
      </div>
    </div>
  );
}

// ── Root: reads role → renders correct view ───────────────────────────────────

function DashboardContent() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  let urlId = params.id as string;
  
  // Decode the URL ID recursively if it's base64 encoded
  if (urlId) {
    let current = urlId;
    let depth = 0;
    while (depth < 5) {
      try {
        const decoded = safeAtob(decodeURIComponent(current));
        if (decoded && decoded !== current && /^[a-zA-Z0-9_=\-\+\/%]+$/.test(decoded)) {
          current = decoded;
          depth++;
        } else {
          break;
        }
      } catch (e) {
        break;
      }
    }
    urlId = current;
  }

  const currentView = searchParams.get("view");

  const [user, setUser] = useState<AuthUser | null>(null);
  const [empId, setEmpId] = useState<string>("");
  const [ready, setReady] = useState(false);

  useLayoutEffect(() => {
    // Get raw session from cookies (client-side only)
    const cookieStr = document.cookie || '';
    const sessionMatch = cookieStr.match(/(?:^|; )jd_auth_user=([^;]*)/);
    if (!sessionMatch) {
      router.replace("/");
      return;
    }

    const sessionStr = decodeURIComponent(sessionMatch[1]);
    let sessionUser: AuthUser;
    try {
      sessionUser = JSON.parse(sessionStr);
    } catch {
      router.replace("/");
      return;
    }

    const currentEmpId = urlId || sessionUser.employee_id;

    // Security check: standard employees can ONLY view their own dashboard
    const isOwner = currentEmpId === sessionUser.employee_id;
    const canViewOthers = ["manager", "head", "hr", "admin"].includes(sessionUser.role);
    if (!isOwner && !canViewOthers) {
      router.replace(`/dashboard/${safeBtoa(sessionUser.employee_id)}`);
      return;
    }

    // Defer state updates to avoid cascading renders
    const timer = setTimeout(() => {
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
    }, 0);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlId]);

  if (!ready) return <LoadingScreen />;

  // Render correct dashboard based on role regardless of URL parameter.
  // The internal components use that URL parameter to set their active filter.
  if (user && isHR(user)) return <HRView user={user} />;
  if (user && isManager(user)) return <ManagerView user={user} />;

  // Default to EmployeeView
  return <EmployeeView employeeId={empId} user={user} />;
}

export default function DynamicDashboardPage() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <DashboardContent />
    </Suspense>
  );
}
