// app/(dashboard)/dashboard/[id]/page.tsx

"use client";

import { useEffect, useState } from "react";
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
} from "lucide-react";

import { DeleteModal } from "@/components/ui/delete-modal";

import {
 AuthUser,
 fetchEmployeeJDs,
 getCurrentUser,
 getJDs,
 getOrCreateEmployeeId,
 isHR,
 isManager,
 isHead,
 fetchEmployeeProfile,
 fetchHRDepartmentStats,
 fetchDepartmentEmployees,
 fetchMyTeamStats,
 fetchMyTeamEmployees,
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
 reporting_manager?: string; // Added
 jd_status?: string; // Added
 jd_id?: string; // Added
 last_updated?: string | null; // Added
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
}: {
 jds: JDListItem[];
 showEmployee: boolean;
}) {
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

 const router = useRouter();
 const [isDeleting, setIsDeleting] = useState<string | null>(null);
 const [jdToDelete, setJdToDelete] = useState<JDListItem | null>(null);

 const handleDelete = async (jd: JDListItem, e: React.MouseEvent) => {
 e.preventDefault();
 e.stopPropagation();
 setJdToDelete(jd);
 };

 const confirmDelete = async () => {
 if (!jdToDelete) return;
 setIsDeleting(jdToDelete.id);
 try {
 const { deleteJD } = require("@/lib/api");
 const employeeId = getOrCreateEmployeeId();
 await deleteJD(jdToDelete.id, employeeId);
 // Fast refresh by just reloading the page or we could pass a callback
 window.location.reload();
 } catch (err: any) {
 alert(err?.message || "Failed to delete JD");
 setIsDeleting(null);
 setJdToDelete(null);
 }
 };

 return (
 <>
 <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
 {jds.map((jd) => {
 const config = STATUS_CONFIG[jd.status] || STATUS_CONFIG.draft;
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

 {/* Show employee name for manager/HR views */}
 {showEmployee && jd.employee_name && (
 <p className="text-xs text-primary-600 font-medium mb-1 flex items-center gap-1">
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
 <span className="text-xs font-medium text-primary-600 group-hover:translate-x-1 transition-transform inline-flex items-center gap-2">
 View JD
 <ArrowRight className="w-4 h-4" />
 </span>
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
 const [jds, setJds] = useState<JDListItem[]>([]);
 const [loading, setLoading] = useState(true);

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

 useEffect(() => {
 fetchEmployeeJDs(employeeId)
 .then((d) => {
 setAllJds(d || []);
 setJds(d || []);
 })
 .catch(console.error)
 .finally(() => setLoading(false));
 }, [employeeId]);

 useEffect(() => {
 if (filter === "all") setJds(allJds);
 else if (filter === "draft")
 setJds(
 allJds.filter((j) =>
 [
 "draft",
 "jd_generated",
 "collecting",
 "manager_rejected",
 "hr_rejected",
 ].includes(j.status),
 ),
 );
 else if (filter === "pending")
 setJds(
 allJds.filter((j) =>
 ["sent_to_manager", "sent_to_hr"].includes(j.status),
 ),
 );
 else if (filter === "approved")
 setJds(allJds.filter((j) => j.status === "approved"));
 }, [filter, allJds]);

 const draftCount = allJds.filter((j) =>
 [
 "draft",
 "jd_generated",
 "collecting",
 "manager_rejected",
 "hr_rejected",
 ].includes(j.status),
 ).length;
 const sentCount = allJds.filter((j) =>
 ["sent_to_manager", "sent_to_hr"].includes(j.status),
 ).length;
 const approvedCount = allJds.filter((j) => j.status === "approved").length;

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
 className="group flex flex-1 sm:flex-none w-full sm:w-auto items-center justify-center gap-3 px-8 py-4 bg-white text-blue-900 rounded-md font-medium hover:bg-cyan-50 hover:shadow-md hover:shadow-cyan-500/20 transition-all duration-300 active:scale-[0.98]"
 >
 <Plus className="w-5 h-5 group-hover:rotate-90 transition-transform text-blue-600" />
 Initialize New JD
 </Link>
 </div>
 </div>
 </header>

 {/* Horizontal Pill Filters */}
 <div className="bg-white p-2 rounded-md border border-surface-200 shadow-sm flex flex-wrap gap-2">
 {[
 {
 key: "all",
 label: "All Output",
 count: allJds.length,
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
 onClick={() => setFilter(tab.key as any)}
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
 <JDGrid jds={jds} showEmployee={false} />
 </div>
 </div>
 </div>
 );
}

// ── Manager view ──────────────────────────────────────────────────────────────

function ManagerView({ user }: { user: AuthUser }) {
 const [allJds, setAllJds] = useState<JDListItem[]>([]);
 const [myJds, setMyJds] = useState<JDListItem[]>([]);
 const [jds, setJds] = useState<JDListItem[]>([]);
 const [loading, setLoading] = useState(true);

 // My Team State
 const [teamStats, setTeamStats] = useState<any>(null);
 const [myTeamEmployees, setMyTeamEmployees] = useState<any[]>([]);
 const [loadingTeam, setLoadingTeam] = useState(false);



 const searchParams = useSearchParams();
 const currentView = searchParams.get("view");

 const [filter, setFilter] = useState<
 "all" | "pending" | "approved" | "my_jds" | "my_team" | "feedback"
 >(
 currentView === "feedback"
 ? "feedback"
 : currentView === "approvals"
 ? "pending"
 : "all",
 );


 useEffect(() => {
 async function load() {
 try {
 const { fetchManagerPendingJDs } = require("@/lib/api");
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

 // Default view shows pending
 setJds(
 (teamData || []).filter((j: any) => j.status === "sent_to_manager"),
 );
 } catch (err) {

 console.error(err);
 } finally {
 setLoading(false);
 }
 }
 load();
 }, [user.employee_id]);

 useEffect(() => {
 if (filter === "my_jds") {
 setJds(myJds);
 } else if (filter === "all") {
 setJds(allJds);
 } else if (filter === "pending") {
 setJds(allJds.filter((j) => j.status === "sent_to_manager"));
 } else if (filter === "approved") {
 setJds(
 allJds.filter(
 (j) => j.status === "approved" || j.status === "sent_to_hr",
 ),
 );
 }
 }, [filter, allJds, myJds]);

 if (loading) return <LoadingScreen />;

 const pending = allJds.filter((j) => j.status === "sent_to_manager").length;
 const approved = allJds.filter(
 (j) => j.status === "approved" || j.status === "sent_to_hr",
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
 onClick={() => setFilter(tab.key as any)}
 className={`flex-1 min-w-[140px] flex items-center gap-3 p-3 rounded-md transition-all duration-200 ${isActive
 ? "bg-slate-900 text-white shadow-md shadow-slate-900/20 ring-1 ring-slate-900"
 : "hover:bg-slate-50 text-slate-600 hover:text-slate-900"
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
 <p className="text-4xl font-medium text-surface-900 ">{teamStats.total_employees}</p>
 </div>
 <div className="bg-white p-6 rounded-md border border-surface-200 shadow-md hover:shadow-md transition-all duration-300 relative overflow-hidden group">
 <div className="absolute top-0 right-0 w-24 h-24 bg-blue-500/5 rounded-md blur-2xl -translate-y-1/2 translate-x-1/2 group-hover:scale-150 transition-transform duration-700" />
 <p className="text-[10px] font-medium tracking-[0.2em] text-blue-500 mb-2">In Progress</p>
 <p className="text-4xl font-medium text-surface-900 ">{teamStats.submitted + teamStats.under_review}</p>
 </div>
 <div className="bg-white p-6 rounded-md border border-surface-200 shadow-md hover:shadow-md transition-all duration-300 relative overflow-hidden group">
 <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-500/5 rounded-md blur-2xl -translate-y-1/2 translate-x-1/2 group-hover:scale-150 transition-transform duration-700" />
 <p className="text-[10px] font-medium tracking-[0.2em] text-emerald-500 mb-2">Approved</p>
 <p className="text-4xl font-medium text-surface-900 ">{teamStats.approved}</p>
 </div>
 <div className="bg-white p-6 rounded-md border border-surface-200 shadow-md hover:shadow-md transition-all duration-300 relative overflow-hidden group">
 <div className="absolute top-0 right-0 w-24 h-24 bg-primary-500/10 rounded-md blur-2xl -translate-y-1/2 translate-x-1/2 group-hover:scale-150 transition-transform duration-700" />
 <p className="text-[10px] font-medium tracking-[0.2em] text-primary-500 mb-2">Completion</p>
 <p className="text-4xl font-medium text-surface-900 ">{teamStats.completion_percentage}%</p>
 </div>
 </div>
 )}


 {/* Employee Directory */}
 <div className="bg-white rounded-[2.5rem] border border-surface-200 shadow-md overflow-hidden">
 <div className="overflow-x-auto">
 <table className="w-full text-left border-collapse">
 <thead>
 <tr className="bg-surface-50/50">
 <th className="px-6 py-5 text-[10px] font-medium text-surface-400 border-b border-surface-100">Team Member</th>
 <th className="px-6 py-5 text-[10px] font-medium text-surface-400 border-b border-surface-100">Designation</th>
 <th className="px-6 py-5 text-[10px] font-medium text-surface-400 border-b border-surface-100">JD Status</th>
 <th className="px-6 py-5 text-[10px] font-medium text-surface-400 border-b border-surface-100">Action</th>
 </tr>
 </thead>
 <tbody className="divide-y divide-surface-50">
 {myTeamEmployees.map((emp) => (
 <tr key={emp.employee_id} className="hover:bg-surface-50/50 transition-colors group">
 <td className="px-6 py-5">
 <div className="flex items-center gap-3">
 <div className="w-10 h-10 rounded-md bg-primary-50 text-primary-600 flex items-center justify-center font-medium text-xs ring-1 ring-primary-100">
 {emp.name.split(' ').map((n: any) => n[0]).join('').slice(0, 2).toUpperCase()}
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
 <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-lg border text-[10px] font-medium ${STATUS_CONFIG[emp.jd_status]?.bg || 'bg-surface-100 border-surface-200 text-surface-500'
 } ${STATUS_CONFIG[emp.jd_status]?.color || ''}`}>
 <span className={`w-1.5 h-1.5 rounded-md bg-current opacity-40`} />
 {STATUS_CONFIG[emp.jd_status]?.label || emp.jd_status}
 </div>
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
 href={`/dashboard/${emp.employee_id}`}
 className="inline-flex items-center gap-2 text-[10px] font-medium text-primary-600 hover:text-primary-700 transition-colors"
 >
 NO JD
 <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
 </Link>
 )}
 </td>

 </tr>
 ))}
 {myTeamEmployees.length === 0 && (
 <tr>
 <td colSpan={4} className="px-6 py-20 text-center">
 <Users className="w-12 h-12 text-surface-200 mx-auto mb-4" />
 <p className="text-surface-500 font-medium">No team members identified in your scope.</p>
 </td>
 </tr>
 )}
 </tbody>
 </table>
 </div>
 </div>
 </div>
 ) : (
 <JDGrid jds={jds} showEmployee={filter !== "my_jds"} />
 )}
 </div>

 </div>
 </div>
 );
}

// ── HR view ───────────────────────────────────────────────────────────────────

function HRView({ user }: { user: AuthUser }) {
 const router = useRouter();
 const [jds, setJds] = useState<JDListItem[]>([]);
 const [allJds, setAllJds] = useState<JDListItem[]>([]);
 const [myJds, setMyJds] = useState<JDListItem[]>([]);
 const [departmentStats, setDepartmentStats] = useState<any[]>([]);

 const [selectedDepartment, setSelectedDepartment] = useState<string | null>(
 null,
 );
 const [deptEmployees, setDeptEmployees] = useState<any[]>([]);
 const [loadingDept, setLoadingDept] = useState(false);
 const [onlySubmitted, setOnlySubmitted] = useState(true);

 const [loading, setLoading] = useState(true);

 const searchParams = useSearchParams();
 const currentView = searchParams.get("view");

 const [filter, setFilter] = useState(
 currentView === "approvals" ? "sent_to_hr" : "all",
 );

 useEffect(() => {
 async function load() {
 try {
 const [allData, personalData, statsData] = await Promise.all([
 getJDs({ submitted_only: true }),
 fetchEmployeeJDs(user.employee_id),
 fetchHRDepartmentStats().catch(() => []),
 ]);
 const data = allData || [];
 setAllJds(data);
 setJds(data);
 setMyJds(personalData || []);
 setDepartmentStats(statsData || []);
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

 // Client-side filter
 useEffect(() => {
 if (filter === "my_jds") {
 setJds(myJds);
 } else if (filter === "all") {
 setJds(allJds);
 } else {
 setJds(
 allJds.filter((j) => {
 // Strict HR policy: Never show drafts in the global directory
 const isDraft = ["collecting", "draft", "jd_generated"].includes(j.status);
 if (isDraft) return false;

 if (filter === "in_progress") {
 return ["sent_to_manager"].includes(j.status);
 }
 return j.status === filter;
 })
 );
 }
 }, [filter, allJds, myJds]);

 if (loading) return <LoadingScreen />;

 const counts = {
 all: allJds.length,
 sent_to_hr: allJds.filter((j) => j.status === "sent_to_hr").length,
 approved: allJds.filter((j) => j.status === "approved").length,
 my_jds: myJds.length,
 };

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
 {[
 {
 key: "all",
 label: "Directory",
 count: counts.all,
 icon: Briefcase,
 color: "text-surface-600",
 },
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
 {
 key: "departments",
 label: "Department Pulse",
 count: departmentStats.length,
 icon: Users,
 color: "text-purple-600",
 },


 ].map(({ key, label, count, icon: Icon, color, alert }) => (
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
 STATUS_CONFIG[emp.jd_status] ||
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

 {filter !== "departments" && (
 <div className="space-y-6">
 <h2 className="text-xl font-medium text-surface-900 flex items-center gap-3 px-2">
 <span className="w-1.5 h-6 bg-purple-600 rounded-md" />
 {filter === "all"
 ? "All JDs"
 : filter === "my_jds"
 ? "Your Personal Documents"
 : "Workflow Results"}
 </h2>
 <JDGrid jds={jds} showEmployee={filter !== "my_jds"} />
 </div>
 )}
 </div>
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

export default function DynamicDashboardPage() {
 const params = useParams();
 const router = useRouter();
 const searchParams = useSearchParams();
 const urlId = params.id as string;
 const currentView = searchParams.get("view");

 const [user, setUser] = useState<AuthUser | null>(null);
 const [empId, setEmpId] = useState<string>("");
 const [ready, setReady] = useState(false);

 useEffect(() => {
 // 1. Get raw session from cookies
 const { getCookie, cookieKeys } = require("@/lib/cookies");
 const sessionStr = getCookie(cookieKeys.AUTH_USER);
 if (!sessionStr) {
 router.replace("/");
 return;
 }

 let sessionUser: AuthUser;
 try {
 sessionUser = JSON.parse(sessionStr);
 } catch {
 router.replace("/");
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

 // Render correct dashboard based on role regardless of URL parameter.
 // The internal components use that URL parameter to set their active filter.
 if (user && isHR(user)) return <HRView user={user} />;
 if (user && isManager(user)) return <ManagerView user={user} />;

 // Default to EmployeeView
 return <EmployeeView employeeId={empId} user={user} />;
}
