"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  FileText,
  MessageSquare,
  Clock,
  ArrowRight,
  Briefcase,
  Loader2,
  Plus,
  Trash2,
  Play,
  Eye,
  ChevronLeft,
  Users,
} from "lucide-react";

import {
  fetchEmployeeJDs,
  fetchManagerPendingJDs,
  fetchHRPendingJDs,
  getCurrentUser,
  fetchDepartmentEmployees,
} from "@/lib/api";
import { getOrCreateEmployeeId } from "@/lib/auth";
import { DeleteModal } from "@/components/ui/delete-modal";

type JDListItem = {
  id: string;
  title: string | null;
  status: string;
  version: number;
  updated_at: string | null;
  created_at: string | null;
};

type DepartmentEmployee = {
  employee_id: string;
  name: string;
  designation: string;
  reporting_manager: string;
  jd_status: string;
  last_updated: string | null;
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
  "Not Submitted": {
    label: "Not Submitted",
    color: "text-surface-500",
    bg: "bg-surface-100 border-surface-200",
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
  const router = useRouter();
  const [jds, setJds] = useState<JDListItem[]>([]);
  const [pendingJDs, setPendingJDs] = useState<JDListItem[]>([]);
  const [departmentStats, setDepartmentStats] = useState<any[]>([]);
  // Detailed Dept State
  const [selectedDepartment, setSelectedDepartment] = useState<string | null>(
    null,
  );
  const [deptEmployees, setDeptEmployees] = useState<DepartmentEmployee[]>([]);
  const [loadingDept, setLoadingDept] = useState(false);
  const [onlySubmitted, setOnlySubmitted] = useState(true);

  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<
    "my_jds" | "team_approvals" | "hr_approvals" | "departments"
  >("my_jds");
  const [isMounted, setIsMounted] = useState(false);

  // Delete Modal State
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [jdToDelete, setJdToDelete] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const user = isMounted ? getCurrentUser() : null;
  const role = user?.role || "employee";

  // Auto-redirect to dynamic dashboard if we have a user
  useEffect(() => {
    if (isMounted && user?.employee_id) {
       router.replace(`/dashboard/${user.employee_id}`);
    }
  }, [isMounted, user, router]);

  async function loadData() {
    try {
      setLoading(true);
      const id = getOrCreateEmployeeId();

      // Parallelize data fetching to avoid "waterfall" latency
      const promises: Promise<any>[] = [fetchEmployeeJDs(id)];

      if (role === "manager") {
        promises.push(fetchManagerPendingJDs(id));
      } else if (role === "hr") {
        promises.push(fetchHRPendingJDs());
        // For HR, also fetch department stats
        const api = await import("@/lib/api");
        promises.push(api.fetchHRDepartmentStats());
      }

      const results = await Promise.all(promises);

      // Map results back to state
      setJds(results[0] || []);

      if (role === "manager") {
        setPendingJDs(results[1] || []);
      } else if (role === "hr") {
        setPendingJDs(results[1] || []);
        setDepartmentStats(results[2] || []);
      }
    } catch (err) {
      console.error("Failed to load dashboard data:", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!isMounted) return;
    loadData();
  }, [role, isMounted]);

  const handleDeleteClick = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    setJdToDelete(id);
    setIsDeleteModalOpen(true);
  };

  const confirmDelete = async () => {
    if (!jdToDelete) return;

    try {
      setIsDeleting(true);
      const response = await fetch(
        `http://localhost:8000/api/jds/${jdToDelete}`,
        {
          method: "DELETE",
        },
      );

      if (!response.ok) {
        console.log("Failed to delete JD");
      }

      // Reload Data
      await loadData();
    } catch (error) {
      console.error("Error deleting JD:", error);
      alert("Failed to delete the document. Please try again.");
    } finally {
      setIsDeleting(false);
      setIsDeleteModalOpen(false);
      setJdToDelete(null);
    }
  };

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
              . Ready to prepare your JDs?
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
                Answer guided questions to generate a professional Job
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
              <>
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
                <button
                  onClick={() => setActiveTab("departments")}
                  className={`whitespace-nowrap px-5 py-2.5 text-sm font-bold rounded-xl transition-all flex items-center gap-2 ${
                    activeTab === "departments"
                      ? "bg-white text-surface-900 shadow-sm"
                      : "text-surface-500 hover:text-surface-700 hover:bg-surface-200/50"
                  }`}
                >
                  Department Overview
                </button>
              </>
            )}
          </div>
        )}

        {/* Department Stats View */}
        {activeTab === "departments" &&
          role === "hr" &&
          !selectedDepartment && (
            <div className="bg-white rounded-3xl border border-surface-200 shadow-premium overflow-hidden mb-8">
              <div className="px-4 sm:px-8 py-5 sm:py-6 border-b border-surface-100 flex flex-col sm:flex-row sm:items-center justify-between bg-surface-50/50 gap-4">
                <h2 className="text-lg sm:text-xl font-black text-surface-900 tracking-tight">
                  Department Overview
                </h2>
              </div>

              {loading ? (
                <div className="p-16 flex flex-col items-center justify-center gap-4">
                  <Loader2 className="w-8 h-8 text-primary-500 animate-spin" />
                  <p className="text-surface-500 font-medium">Loading...</p>
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
                      className="border border-surface-200 rounded-2xl p-5 bg-surface-50/30 hover:shadow-md hover:border-primary-300 transition-all cursor-pointer group"
                    >
                      <div className="flex justify-between items-start mb-4">
                        <h3 className="text-lg font-bold text-surface-900 group-hover:text-primary-700 transition-colors">
                          {stat.department}
                        </h3>
                        <div className="bg-white p-1.5 rounded-lg shadow-sm border border-surface-100">
                          <Users className="w-4 h-4 text-surface-400" />
                        </div>
                      </div>

                      <div className="flex justify-between items-center mb-2">
                        <span className="text-sm font-medium text-surface-500">
                          Completion ({stat.completed_jds}/
                          {stat.total_employees})
                        </span>
                        <span className="text-sm font-black text-primary-600">
                          {stat.completion_percentage}%
                        </span>
                      </div>
                      {/* Progress Bar */}
                      <div className="w-full h-3 bg-surface-200 rounded-full overflow-hidden mb-6">
                        <div
                          className="h-full bg-primary-500 rounded-full transition-all duration-1000 ease-out"
                          style={{ width: `${stat.completion_percentage}%` }}
                        />
                      </div>

                      <div className="grid grid-cols-3 gap-3">
                        <div className="bg-white p-2.5 rounded-xl border border-surface-100 text-center">
                          <span className="block text-[10px] font-bold text-surface-400 uppercase tracking-wider mb-1">
                            Submitted
                          </span>
                          <span className="text-lg font-black text-surface-800">
                            {stat.submitted}
                          </span>
                        </div>
                        <div className="bg-white p-2.5 rounded-xl border border-surface-100 text-center">
                          <span className="block text-[10px] font-bold text-surface-400 uppercase tracking-wider mb-1">
                            Reviewing
                          </span>
                          <span className="text-lg font-black text-purple-600">
                            {stat.under_review}
                          </span>
                        </div>
                        <div className="bg-white p-2.5 rounded-xl border border-surface-100 text-center">
                          <span className="block text-[10px] font-bold text-surface-400 uppercase tracking-wider mb-1">
                            Approved
                          </span>
                          <span className="text-lg font-black text-emerald-600">
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

        {/* Detailed Department Employee List */}
        {activeTab === "departments" && role === "hr" && selectedDepartment && (
          <div className="bg-white rounded-3xl border border-surface-200 shadow-premium overflow-hidden mb-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="px-4 sm:px-8 py-5 sm:py-6 border-b border-surface-100 flex flex-col sm:flex-row sm:items-center justify-between bg-surface-50/50 gap-4">
              <div className="flex items-center gap-3">
                <button
                  onClick={closeDepartmentDetail}
                  className="p-2 -ml-2 text-surface-400 hover:text-surface-700 hover:bg-surface-200 rounded-xl transition-colors shrink-0"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <h2 className="text-lg sm:text-xl font-black text-surface-900 tracking-tight flex items-center gap-2">
                  <Users className="w-5 h-5 text-primary-500" />
                  {selectedDepartment} Directory
                </h2>
              </div>
              <div className="flex items-center gap-2 bg-surface-200/50 p-1 rounded-xl">
                <button
                  onClick={() => handleToggleSubmitted(true)}
                  className={`px-3 py-1.5 text-[11px] font-black uppercase tracking-widest rounded-lg transition-all ${
                    onlySubmitted
                      ? "bg-white text-primary-600 shadow-sm"
                      : "text-surface-500 hover:text-surface-700"
                  }`}
                >
                  Submitted
                </button>
                <button
                  onClick={() => handleToggleSubmitted(false)}
                  className={`px-3 py-1.5 text-[11px] font-black uppercase tracking-widest rounded-lg transition-all ${
                    !onlySubmitted
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
                <Loader2 className="w-8 h-8 text-primary-500 animate-spin" />
                <p className="text-surface-500 font-medium">
                  Loading employees...
                </p>
              </div>
            ) : deptEmployees.length === 0 ? (
              <div className="p-16 text-center">
                <div className="w-20 h-20 bg-surface-50 rounded-3xl flex items-center justify-center mx-auto mb-6 border border-surface-100">
                  <Users className="w-10 h-10 text-surface-300" />
                </div>
                <h3 className="text-lg font-bold text-surface-800 mb-2">
                  No Employees Found
                </h3>
                <p className="text-base text-surface-400 max-w-sm mx-auto">
                  There are currently no employees assigned to this department
                  in the Directory.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-surface-50/80 border-b border-surface-200 text-xs font-bold text-surface-500 uppercase tracking-wider">
                      <th className="px-6 py-4 font-bold">Employee</th>
                      <th className="px-6 py-4 font-bold">Designation</th>
                      <th className="px-6 py-4 font-bold">Reporting Manager</th>
                      <th className="px-6 py-4 font-bold">JD Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-100">
                    {deptEmployees.map((emp) => {
                      const config =
                        STATUS_CONFIG[emp.jd_status] ||
                        STATUS_CONFIG["Not Submitted"];

                      return (
                        <tr
                          key={emp.employee_id}
                          className="hover:bg-surface-50/60 transition-colors"
                        >
                          <td className="px-6 py-4">
                            <div className="flex flex-col">
                              <span className="font-bold text-surface-900">
                                {emp.name}
                              </span>
                              <span className="text-[11px] font-bold text-surface-400">
                                {emp.employee_id}
                              </span>
                            </div>
                          </td>
                          <td className="px-6 py-4 text-sm font-medium text-surface-700">
                            {emp.designation || "—"}
                          </td>
                          <td className="px-6 py-4 text-sm font-medium text-surface-700">
                            {emp.reporting_manager || "—"}
                          </td>
                          <td className="px-6 py-4">
                            <span
                              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-black uppercase tracking-widest border ${config.bg} ${config.color}`}
                            >
                              <span className="w-1.5 h-1.5 rounded-full bg-current" />
                              {config.label}
                            </span>
                            {emp.last_updated &&
                              emp.jd_status !== "Not Submitted" && (
                                <div className="mt-1 text-[10px] font-bold text-surface-400 flex items-center gap-1">
                                  <Clock className="w-3 h-3" />
                                  {new Date(
                                    emp.last_updated,
                                  ).toLocaleDateString()}
                                </div>
                              )}
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

        {/* JD List Area */}
        {activeTab !== "departments" && (
          <div className="bg-white rounded-3xl border border-surface-200 shadow-premium overflow-hidden mb-8">
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
                  {activeTab === "my_jds"
                    ? "No Documents Yet"
                    : "All Caught Up!"}
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

                  const isDraft =
                    jdItem.status === "draft" ||
                    jdItem.status === "jd_generated";

                  // Clicking the entire row routes appropriately depending on status
                  const href = isDraft
                    ? `/questionnaire/${jdItem.id}`
                    : `/jd/${jdItem.id}`;

                  return (
                    <div
                      key={jdItem.id}
                      className="group flex flex-col sm:flex-row sm:items-center justify-between p-6 sm:px-8 hover:bg-surface-50/60 transition-colors cursor-pointer"
                      onClick={() => router.push(href)}
                    >
                      <div className="flex items-center gap-5">
                        <div className="w-12 h-12 bg-surface-100 rounded-2xl flex items-center justify-center group-hover:bg-white group-hover:shadow-sm transition-all border border-transparent group-hover:border-surface-200 shrink-0">
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
                                ? new Date(
                                    jdItem.updated_at,
                                  ).toLocaleDateString("en-US", {
                                    month: "short",
                                    day: "numeric",
                                    year: "numeric",
                                  })
                                : "—"}
                            </span>
                            <span className="text-[12px] font-bold text-surface-400 bg-surface-100 px-2 py-0.5 rounded-md">
                              v{jdItem.version}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Actions Column */}
                      <div
                        className="flex items-center gap-3 mt-4 sm:mt-0 ml-auto pl-17 sm:pl-0"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {activeTab === "my_jds" && (
                          <>
                            <button
                              onClick={(e) => handleDeleteClick(e, jdItem.id)}
                              className="p-2 sm:p-2.5 text-surface-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-colors border border-transparent hover:border-red-100"
                              title="Delete JD"
                            >
                              <Trash2 className="w-4 h-4 sm:w-5 sm:h-5" />
                            </button>
                          </>
                        )}

                        <Link
                          href={href}
                          onClick={(e) => e.stopPropagation()}
                          className={`flex items-center gap-2 px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl font-bold text-sm transition-all ${
                            isDraft
                              ? "bg-primary-50 text-primary-700 hover:bg-primary-100 border border-primary-100/50"
                              : "bg-surface-100 text-surface-700 hover:bg-surface-200 border border-surface-200"
                          }`}
                        >
                          {isDraft ? (
                            <>
                              <Play className="w-4 h-4" />
                              <span className="hidden sm:inline">Continue</span>
                            </>
                          ) : (
                            <>
                              <Eye className="w-4 h-4" />
                              <span className="hidden sm:inline">View</span>
                              <span className="sm:hidden">View</span>
                            </>
                          )}
                        </Link>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      <DeleteModal
        isOpen={isDeleteModalOpen}
        onClose={() => setIsDeleteModalOpen(false)}
        onConfirm={confirmDelete}
        title="Delete Document"
        description="Are you sure you want to delete this JD document? This action cannot be undone and all data will be permanently removed."
        isDeleting={isDeleting}
      />
    </div>
  );
}
