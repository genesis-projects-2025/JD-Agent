"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { API_URL } from "@/lib/api";
import { formatDate } from "@/lib/format-date";
import {
    Users,
    CheckCircle,
    XCircle,
    Search,
    Clock,
    UserCheck,
    ShieldCheck,
    FileText,
    Eye,
    Download,
    Building2,
    Filter,
    FileSpreadsheet,
    Layers,
    ArrowUpRight,
    Loader2,
} from "lucide-react";
import Link from "next/link";
import { getCookie, deleteCookie, cookieKeys } from "@/lib/cookies";
import { getAdminCache, setAdminCache } from "@/lib/admin-cache";
import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    PieChart,
    Pie,
    Cell,
    Legend,
} from "recharts";

const PIE_COLORS = ["#10b981", "#f59e0b"];
const BAR_COLORS = ["#3b82f6", "#8b5cf6", "#f59e0b", "#10b981", "#ef4444"];

/** Human-readable status labels */
function formatStatus(raw: string | null | undefined): string {
    if (!raw) return "No JD";
    const map: Record<string, string> = {
        collecting: "Collecting Info",
        draft: "Draft",
        jd_generated: "JD Generated",
        sent_to_manager: "Pending Manager",
        sent_to_hr: "Pending HR",
        manager_rejected: "Rejected by Manager",
        hr_rejected: "Rejected by HR",
        approved: "Approved",
        rejected: "Rejected",
        "No JD": "No JD",
    };
    return map[raw] || raw.replace(/_/g, " ");
}

/** Status badge color classes */
function statusBadgeClass(raw: string | null | undefined): string {
    if (!raw || raw === "No JD")
        return "bg-slate-50 text-slate-500 border-slate-200";
    if (raw === "approved")
        return "bg-emerald-50 text-emerald-700 border-emerald-200";
    if (["manager_rejected", "hr_rejected", "rejected"].includes(raw))
        return "bg-rose-50 text-rose-700 border-rose-200";
    if (["sent_to_manager", "sent_to_hr"].includes(raw))
        return "bg-amber-50 text-amber-700 border-amber-200";
    return "bg-blue-50 text-blue-700 border-blue-200";
}

/** Status dot color */
function statusDotColor(raw: string | null | undefined): string {
    if (!raw || raw === "No JD") return "bg-slate-400";
    if (raw === "approved") return "bg-emerald-500";
    if (["manager_rejected", "hr_rejected", "rejected"].includes(raw))
        return "bg-rose-500";
    if (["sent_to_manager", "sent_to_hr"].includes(raw)) return "bg-amber-500";
    return "bg-blue-500";
}

function formatKraKpiStatus(status: string | null | undefined): string {
    if (!status) return "Not Started";
    if (status === "approved") return "Approved";
    if (status === "sent_to_hr") return "Awaiting HR Review";
    if (status === "hr_rejected") return "HR Revision Needed";
    if (status === "sent_to_manager") return "Awaiting Mgr Review";
    if (status === "manager_rejected") return "Mgr Revision Needed";
    if (status === "confirmed") return "Pending Mgr Action";
    if (status === "draft") return "In Progress";
    return status.replace(/_/g, " ");
}

function kraKpiBadgeClass(status: string | null | undefined): string {
    if (!status) return "bg-slate-50 text-slate-400 border-slate-200";
    if (["manager_rejected", "hr_rejected", "rejected"].includes(status))
        return "bg-rose-50 text-rose-700 border-rose-200";
    return "bg-blue-50 text-blue-700 border-blue-200";
}

function kraKpiStatusBadgeClass(status: string | null | undefined): string {
    if (!status || status === "Not Started")
        return "bg-slate-100 text-slate-500 border-slate-200";
    if (status === "approved" || status === "confirmed")
        return "bg-emerald-50 text-emerald-700 border-emerald-200";
    if (["sent_to_manager", "sent_to_hr"].includes(status))
        return "bg-purple-50 text-purple-700 border-purple-200";
    return "bg-blue-50 text-blue-700 border-blue-200";
}

function kraKpiDotColor(status: string | null | undefined): string {
    if (!status || status === "Not Started") return "bg-slate-400";
    if (status === "approved") return "bg-emerald-500";
    if (status === "sent_to_hr") return "bg-purple-500";
    if (status === "hr_rejected") return "bg-rose-500";
    if (status === "sent_to_manager") return "bg-blue-500";
    if (status === "manager_rejected") return "bg-amber-500";
    if (status === "confirmed") return "bg-indigo-500";
    return "bg-slate-500";
}

interface DashboardCachePayload {
    stats: any;
    charts: any;
    users: any[];
    jds: any[];
}

export default function AdminDashboard() {
    const router = useRouter();
    
    // Check client RAM cache for instant rendering
    const cached = getAdminCache<DashboardCachePayload>("dashboard");
    const hasValidCache = Boolean(cached.data && cached.data.stats && cached.data.stats.total_employees !== undefined);
    
    const [stats, setStats] = useState<any>(hasValidCache ? cached.data!.stats : null);
    const [charts, setCharts] = useState<any>(hasValidCache ? cached.data!.charts : null);
    const [users, setUsers] = useState<any[]>(hasValidCache ? cached.data!.users : []);
    const [deptSummary, setDeptSummary] = useState<any[]>([]);
    const [selectedDept, setSelectedDept] = useState<string>("All");
    const [isExporting, setIsExporting] = useState<boolean>(false);
    const [loading, setLoading] = useState(!hasValidCache);
    const [searchQuery, setSearchQuery] = useState("");
    const [activeTab, setActiveTab] = useState("All Users");
    const [showExportMenu, setShowExportMenu] = useState(false);

    useEffect(() => {
        fetchDashboardData();
    }, []);

    const fetchDashboardData = async () => {
        try {
            if (!hasValidCache) {
                setLoading(true);
            }
            const token = getCookie(cookieKeys.ADMIN_TOKEN);
            const headers: Record<string, string> = {
                "Content-Type": "application/json",
            };
            if (token) {
                headers["Authorization"] = `Bearer ${token}`;
            }

            const [statsRes, chartsRes, usersRes, deptRes] = await Promise.all([
                fetch(`${API_URL}/admin/stats/overview`, { headers }).catch((err) => {
                    console.warn("stats/overview fetch error:", err);
                    return null;
                }),
                fetch(`${API_URL}/admin/stats/charts`, { headers }).catch((err) => {
                    console.warn("stats/charts fetch error:", err);
                    return null;
                }),
                fetch(`${API_URL}/admin/users?limit=1000`, { headers }).catch((err) => {
                    console.warn("admin/users fetch error:", err);
                    return null;
                }),
                fetch(`${API_URL}/admin/departments/summary`, { headers }).catch((err) => {
                    console.warn("admin/departments/summary fetch error:", err);
                    return null;
                }),
            ]);

            if (statsRes && (statsRes.status === 401 || statsRes.status === 403)) {
                deleteCookie(cookieKeys.ADMIN_TOKEN);
                router.push("/admin/login");
                return;
            }

            const freshStats = statsRes?.ok ? await statsRes.json().catch(() => null) : null;
            const freshCharts = chartsRes?.ok ? await chartsRes.json().catch(() => null) : null;
            const rawUsersData = usersRes?.ok ? await usersRes.json().catch(() => null) : null;
            const freshUsers = Array.isArray(rawUsersData) ? rawUsersData : (rawUsersData?.items || []);
            const freshDept = deptRes?.ok ? await deptRes.json().catch(() => []) : [];

            if (freshStats) setStats(freshStats);
            if (freshCharts) setCharts(freshCharts);
            if (freshUsers && freshUsers.length > 0) setUsers(freshUsers);
            if (freshDept && freshDept.length > 0) setDeptSummary(freshDept);

            if (freshStats) {
                setAdminCache<DashboardCachePayload>("dashboard", {
                    stats: freshStats,
                    charts: freshCharts || charts,
                    users: freshUsers.length > 0 ? freshUsers : users,
                    jds: [],
                });
            }
        } catch (err) {
            console.error("Failed to load admin data", err);
        } finally {
            setLoading(false);
        }
    };

    const handleExportReport = async (format: "excel" | "csv") => {
        try {
            setIsExporting(true);
            setShowExportMenu(false);
            const token = getCookie(cookieKeys.ADMIN_TOKEN);
            const headers: Record<string, string> = {};
            if (token) {
                headers["Authorization"] = `Bearer ${token}`;
            }

            const deptParam = selectedDept !== "All" ? `&department=${encodeURIComponent(selectedDept)}` : "";
            const url = `${API_URL}/admin/reports/export?format=${format}${deptParam}`;

            const res = await fetch(url, { headers });
            if (!res.ok) {
                throw new Error("Failed to generate report export");
            }

            const blob = await res.blob();
            const blobUrl = window.URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = blobUrl;
            const deptLabel = selectedDept !== "All" ? selectedDept.replace(/\s+/g, "_") : "Company_Wide";
            a.download = `JD_Status_Report_${deptLabel}.${format === "excel" ? "xlsx" : "csv"}`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(blobUrl);
        } catch (err: any) {
            console.error("Export report error:", err);
            alert(err.message || "Failed to download report");
        } finally {
            setIsExporting(false);
        }
    };

    const handleExportDepartmentExcel = async (deptName: string) => {
        try {
            setIsExporting(true);
            const token = getCookie(cookieKeys.ADMIN_TOKEN);
            const headers: Record<string, string> = {};
            if (token) {
                headers["Authorization"] = `Bearer ${token}`;
            }

            const url = `${API_URL}/admin/reports/export?format=excel&department=${encodeURIComponent(deptName)}`;
            const res = await fetch(url, { headers });
            if (!res.ok) throw new Error("Failed to generate department Excel report");

            const blob = await res.blob();
            const blobUrl = window.URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = blobUrl;
            a.download = `JD_Status_Report_${deptName.replace(/\s+/g, "_")}.xlsx`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(blobUrl);
        } catch (err: any) {
            alert(err.message || "Failed to download report");
        } finally {
            setIsExporting(false);
        }
    };

    if (loading) {
        return (
            <div className="h-[60vh] flex flex-col items-center justify-center space-y-4">
                <div className="relative">
                    <div className="w-14 h-14 border-[3px] border-blue-600/20 border-t-blue-600 rounded-md animate-spin" />
                    <ShieldCheck className="w-5 h-5 text-blue-600 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
                </div>
                <p className="text-sm font-medium text-slate-400 animate-pulse">
                    Loading executive dashboard...
                </p>
            </div>
        );
    }

    // Dynamic list of departments
    const departmentsList = Array.from(
        new Set(
            [
                ...deptSummary.map((d) => d.department),
                ...users.map((u) => u.department).filter(Boolean),
            ].filter(Boolean)
        )
    ).sort();

    /* ─── Tab / filter logic ─── */
    const deptUsers = users.filter((u) => {
        const q = searchQuery.toLowerCase();
        const matchSearch =
            !q ||
            u.name?.toLowerCase().includes(q) ||
            u.employee_id?.toLowerCase().includes(q) ||
            u.department?.toLowerCase().includes(q) ||
            u.role?.toLowerCase().includes(q);

        const matchDept =
            selectedDept === "All" ||
            (u.department || "").trim().toLowerCase() === selectedDept.trim().toLowerCase();

        return matchSearch && matchDept;
    });

    const tabCounts = {
        "All Users": deptUsers.length,
        "Approved": deptUsers.filter((u) => u.jd_status === "approved").length,
        "Pending": deptUsers.filter((u) => ["sent_to_manager", "sent_to_hr"].includes(u.jd_status)).length,
        "In Progress": deptUsers.filter((u) => ["collecting", "draft", "jd_generated", "ready_for_generation"].includes(u.jd_status)).length,
        "Not Started": deptUsers.filter((u) => !u.jd_status || u.jd_status === "No JD").length,
        "Rejected": deptUsers.filter((u) => ["manager_rejected", "hr_rejected", "rejected"].includes(u.jd_status)).length,
        "Managers": deptUsers.filter((u) => (u.role || "").toLowerCase().includes("manager") || (u.role || "").toLowerCase().includes("head") || (u.role || "").toLowerCase().includes("lead")).length,
        "HR": deptUsers.filter((u) => (u.role || "").toLowerCase().includes("hr") || (u.department || "").toLowerCase().includes("hr")).length,
    };

    const displayData = deptUsers.filter((u) => {
        if (activeTab === "All Users") return true;
        if (activeTab === "Approved") return u.jd_status === "approved";
        if (activeTab === "Pending") return ["sent_to_manager", "sent_to_hr"].includes(u.jd_status);
        if (activeTab === "In Progress") return ["collecting", "draft", "jd_generated", "ready_for_generation"].includes(u.jd_status);
        if (activeTab === "Not Started") return !u.jd_status || u.jd_status === "No JD";
        if (activeTab === "Rejected") return ["manager_rejected", "hr_rejected", "rejected"].includes(u.jd_status);
        if (activeTab === "Managers") return (u.role || "").toLowerCase().includes("manager") || (u.role || "").toLowerCase().includes("head") || (u.role || "").toLowerCase().includes("lead");
        if (activeTab === "HR") return (u.role || "").toLowerCase().includes("hr") || (u.department || "").toLowerCase().includes("hr");
        return true;
    });

    const tabs = [
        { id: "All Users", label: "All Users", icon: Users },
        { id: "Approved", label: "Approved JD, KRA & KPI", icon: CheckCircle },
        { id: "Pending", label: "Pending JDs", icon: Clock },
        { id: "In Progress", label: "Draft / In Progress", icon: Layers },
        { id: "Not Started", label: "Not Started", icon: FileText },
        { id: "Rejected", label: "Rejected JDs", icon: XCircle },
        { id: "Managers", label: "Managers", icon: UserCheck },
        { id: "HR", label: "HR", icon: ShieldCheck },
    ];

    const statCards = [
        {
            label: "Total Employees",
            value: stats?.total_employees || users.length || 0,
            icon: Users,
            bg: "bg-blue-50 text-blue-600 border-blue-100",
        },
        {
            label: "Total Active JDs",
            value: stats?.total_generated_jds || 0,
            icon: FileText,
            bg: "bg-indigo-50 text-indigo-600 border-indigo-100",
        },
        {
            label: "Pending Review JDs",
            value: stats?.pending_jds || 0,
            icon: Clock,
            bg: "bg-amber-50 text-amber-600 border-amber-100",
        },
        {
            label: "Approved JD, KRA & KPI",
            value: stats?.approved_jds || 0,
            icon: CheckCircle,
            bg: "bg-emerald-50 text-emerald-600 border-emerald-100",
        },
        {
            label: "Rejected JDs",
            value: stats?.rejected_jds || 0,
            icon: XCircle,
            bg: "bg-rose-50 text-rose-600 border-rose-100",
        },
    ];

    return (
        <div className="space-y-6 sm:space-y-8 pb-12">
            {/* ─── Top Header Action Row ─── */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                <div>
                    <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2.5">
                        <Building2 className="w-6 h-6 text-blue-600" />
                        Executive JD & KRA/KPI Control Center
                    </h1>
                    <p className="text-xs sm:text-sm text-slate-500 mt-1">
                        Company-wide department progress tracking, approval workflow management, and reporting
                    </p>
                </div>

                {/* Export Report Actions */}
                <div className="relative">
                    <button
                        onClick={() => setShowExportMenu(!showExportMenu)}
                        disabled={isExporting}
                        className="w-full sm:w-auto flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg font-semibold text-xs sm:text-sm shadow-sm transition-all disabled:opacity-50"
                    >
                        {isExporting ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                            <Download className="w-4 h-4" />
                        )}
                        Export Executive Report
                    </button>

                    {showExportMenu && (
                        <div className="absolute right-0 mt-2 w-56 bg-white border border-slate-200 rounded-xl shadow-xl z-50 p-2 space-y-1">
                            <button
                                onClick={() => handleExportReport("excel")}
                                className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-emerald-50 hover:text-emerald-700 rounded-lg transition-colors text-left"
                            >
                                <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
                                Download Excel (.xlsx)
                            </button>
                            <button
                                onClick={() => handleExportReport("csv")}
                                className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-blue-50 hover:text-blue-700 rounded-lg transition-colors text-left"
                            >
                                <FileText className="w-4 h-4 text-blue-600" />
                                Download CSV (.csv)
                            </button>
                        </div>
                    )}
                </div>
            </div>

            {/* ─── Stats Cards ─── */}
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4">
                {statCards.map((s, i) => (
                    <div
                        key={i}
                        className="bg-white border border-slate-200 rounded-lg p-4 sm:p-6 shadow-sm hover:shadow-md transition-all duration-300"
                    >
                        <div className="flex items-center justify-between mb-3 sm:mb-4">
                            <span className="text-[10px] sm:text-xs font-semibold text-slate-500 uppercase tracking-wider">
                                {s.label}
                            </span>
                            <div className={`p-2 rounded-lg border ${s.bg}`}>
                                <s.icon className="w-5 h-5 sm:w-6 sm:h-6" />
                            </div>
                        </div>
                        <h3 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">
                            {s.value}
                        </h3>
                        <p className="text-[10px] sm:text-xs text-slate-400 mt-1.5 flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                            Live data
                        </p>
                    </div>
                ))}
            </div>

            {/* ─── Department Progress Breakdown Section ─── */}
            {deptSummary.length > 0 && (
                <div className="bg-white rounded-xl border border-slate-200 p-5 sm:p-6 shadow-sm">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5 border-b border-slate-100 pb-4">
                        <div>
                            <h2 className="text-base sm:text-lg font-bold text-slate-900 flex items-center gap-2">
                                <Layers className="w-5 h-5 text-indigo-600" />
                                Department-Wise Completion Overview
                            </h2>
                            <p className="text-xs text-slate-500 mt-0.5">
                                Track completion rates and pending approvals across all corporate departments
                            </p>
                        </div>
                        <div className="text-xs font-semibold text-slate-400 bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-200 w-fit">
                            {deptSummary.length} Active Departments
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {deptSummary.map((d, i) => {
                            const isSelected = selectedDept.toLowerCase() === d.department.toLowerCase();
                            return (
                                <div
                                    key={i}
                                    onClick={() => {
                                        if (isSelected) {
                                            setSelectedDept("All");
                                        } else {
                                            setSelectedDept(d.department);
                                            setActiveTab("All Users");
                                            document.getElementById("employee-directory-table")?.scrollIntoView({ behavior: "smooth" });
                                        }
                                    }}
                                    className={`cursor-pointer border rounded-xl p-4 transition-all duration-200 ${
                                        isSelected
                                            ? "border-blue-500 bg-blue-50/40 shadow-md ring-2 ring-blue-500/20"
                                            : "border-slate-200 bg-white hover:border-blue-300 hover:shadow-sm"
                                    }`}
                                >
                                    <div className="flex items-start justify-between gap-2 mb-3">
                                        <div>
                                            <h3 className="font-semibold text-sm text-slate-900 group-hover:text-blue-600 transition-colors">
                                                {d.department}
                                            </h3>
                                            <span className="text-[11px] text-slate-500">
                                                {d.total_employees} Employees
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleExportDepartmentExcel(d.department);
                                                }}
                                                title={`Download ${d.department} Excel Report`}
                                                className="p-1 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors border border-transparent hover:border-emerald-200"
                                            >
                                                <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
                                            </button>
                                            <span
                                                className={`px-2.5 py-1 rounded-full text-xs font-bold ${
                                                    d.completion_rate >= 80
                                                        ? "bg-emerald-100 text-emerald-800 border border-emerald-200"
                                                        : d.completion_rate >= 40
                                                        ? "bg-amber-100 text-amber-800 border border-amber-200"
                                                        : "bg-rose-100 text-rose-800 border border-rose-200"
                                                }`}
                                            >
                                                {d.completion_rate}% Done
                                            </span>
                                        </div>
                                    </div>

                                    {/* Progress Bar */}
                                    <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden mb-3">
                                        <div
                                            className={`h-full rounded-full transition-all duration-500 ${
                                                d.completion_rate >= 80
                                                    ? "bg-emerald-500"
                                                    : d.completion_rate >= 40
                                                    ? "bg-amber-500"
                                                    : "bg-rose-500"
                                            }`}
                                            style={{ width: `${Math.min(100, d.completion_rate)}%` }}
                                        />
                                    </div>

                                    {/* Status Stats Grid */}
                                    <div className="grid grid-cols-3 gap-1.5 text-[11px] pt-2 border-t border-slate-100 font-medium">
                                        <div className="bg-emerald-50/60 text-emerald-700 rounded-md p-1.5 text-center">
                                            <span className="block font-bold text-xs">{d.jd_completed}</span>
                                            Approved
                                        </div>
                                        <div className="bg-amber-50/60 text-amber-700 rounded-md p-1.5 text-center">
                                            <span className="block font-bold text-xs">{d.pending_manager + d.pending_hr}</span>
                                            Pending
                                        </div>
                                        <div className="bg-slate-100 text-slate-600 rounded-md p-1.5 text-center">
                                            <span className="block font-bold text-xs">{d.in_progress + d.not_started}</span>
                                            In Draft
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* ─── Charts Row ─── */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
                {/* JD Pipeline */}
                <div className="bg-white rounded-md sm:rounded-md p-4 sm:p-6 border border-slate-200 shadow-sm">
                    <div className="mb-4 sm:mb-6">
                        <h2 className="text-base sm:text-lg font-medium text-slate-900 flex items-center gap-2">
                            <div className="w-1 h-5 sm:w-1.5 sm:h-6 bg-blue-500 rounded-md" />
                            JD Pipeline
                        </h2>
                        <p className="text-[11px] sm:text-xs text-slate-400 mt-1 ml-3 sm:ml-4">
                            JD approval flow overview
                        </p>
                    </div>
                    <div className="h-[220px] sm:h-[300px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart
                                data={charts?.pipeline || []}
                                margin={{ top: 5, right: 10, left: -20, bottom: 0 }}
                            >
                                <CartesianGrid
                                    strokeDasharray="3 3"
                                    vertical={false}
                                    stroke="#f1f5f9"
                                />
                                <XAxis
                                    dataKey="status"
                                    axisLine={false}
                                    tickLine={false}
                                    tick={{ fill: "#64748b", fontSize: 10, fontWeight: 600 }}
                                    dy={6}
                                    interval={0}
                                    angle={-15}
                                    textAnchor="end"
                                    height={50}
                                />
                                <YAxis
                                    axisLine={false}
                                    tickLine={false}
                                    tick={{ fill: "#94a3b8", fontSize: 10 }}
                                    allowDecimals={false}
                                    width={30}
                                />
                                <Tooltip
                                    cursor={{ fill: "rgba(59,130,246,0.04)" }}
                                    contentStyle={{
                                        borderRadius: "10px",
                                        border: "1px solid #e2e8f0",
                                        boxShadow: "0 4px 12px rgb(0 0 0 / 0.06)",
                                        fontSize: "12px",
                                        fontWeight: 600,
                                        padding: "8px 12px",
                                    }}
                                />
                                <Bar dataKey="count" radius={[6, 6, 0, 0]} barSize={36}>
                                    {(charts?.pipeline || []).map((_: any, idx: number) => (
                                        <Cell
                                            key={idx}
                                            fill={BAR_COLORS[idx % BAR_COLORS.length]}
                                        />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* Manager Response Donut */}
                <div className="bg-white rounded-md sm:rounded-md p-4 sm:p-6 border border-slate-200 shadow-sm">
                    <div className="mb-4 sm:mb-6">
                        <h2 className="text-base sm:text-lg font-medium text-slate-900 flex items-center gap-2">
                            <div className="w-1 h-5 sm:w-1.5 sm:h-6 bg-indigo-500 rounded-md" />
                            Manager Response
                        </h2>
                        <p className="text-[11px] sm:text-xs text-slate-400 mt-1 ml-3 sm:ml-4">
                            JDs reviewed vs. awaiting manager action
                        </p>
                    </div>
                    <div className="h-[220px] sm:h-[300px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                                <Pie
                                    data={charts?.manager_response || []}
                                    cx="50%"
                                    cy="45%"
                                    innerRadius="40%"
                                    outerRadius="65%"
                                    paddingAngle={4}
                                    dataKey="value"
                                    nameKey="name"
                                >
                                    {(charts?.manager_response || []).map(
                                        (_: any, idx: number) => (
                                            <Cell
                                                key={idx}
                                                fill={PIE_COLORS[idx % PIE_COLORS.length]}
                                                stroke="white"
                                                strokeWidth={3}
                                            />
                                        ),
                                    )}
                                </Pie>
                                <Tooltip
                                    contentStyle={{
                                        borderRadius: "10px",
                                        border: "1px solid #e2e8f0",
                                        boxShadow: "0 4px 12px rgb(0 0 0 / 0.06)",
                                        fontSize: "12px",
                                        fontWeight: 600,
                                        padding: "8px 12px",
                                    }}
                                />
                                <Legend
                                    verticalAlign="bottom"
                                    align="center"
                                    iconType="circle"
                                    iconSize={10}
                                    formatter={(value: any) => (
                                        <span className="text-xs font-medium text-slate-600 ml-1">
                                            {value}
                                        </span>
                                    )}
                                />
                            </PieChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            </div>

            {/* ─── Data Table ─── */}
            <div id="employee-directory-table" className="bg-white rounded-md sm:rounded-md border border-slate-200 shadow-sm overflow-hidden">
                {/* Table header */}
                <div className="p-4 sm:p-6 border-b border-slate-100">
                    <div className="flex flex-col gap-4">
                        {/* Title row */}
                        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                            <div>
                                <h2 className="text-lg sm:text-xl font-bold text-slate-900 flex items-center gap-2">
                                    {activeTab === "All Users" ? "Employee Directory" : activeTab === "Approved" ? "Approved JDs, KRAs & KPIs" : `${activeTab} Directory`}
                                    {selectedDept !== "All" && (
                                        <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-blue-100 text-blue-800 border border-blue-200">
                                            Dept: {selectedDept}
                                        </span>
                                    )}
                                </h2>
                                <p className="text-xs sm:text-sm text-slate-400 mt-0.5">
                                    View and manage employee job descriptions, status, and performance frameworks ({displayData.length} records)
                                </p>
                            </div>

                            {/* Search & Department Selector */}
                            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 w-full lg:w-auto">
                                {/* Department Dropdown */}
                                <div className="relative min-w-[180px]">
                                    <select
                                        value={selectedDept}
                                        onChange={(e) => {
                                            setSelectedDept(e.target.value);
                                            setActiveTab("All Users");
                                        }}
                                        className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs sm:text-sm font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-400 appearance-none pr-8 cursor-pointer"
                                    >
                                        <option value="All">All Departments ({departmentsList.length})</option>
                                        {departmentsList.map((d, i) => (
                                            <option key={i} value={d}>
                                                {d}
                                            </option>
                                        ))}
                                    </select>
                                    <Filter className="w-3.5 h-3.5 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                                </div>

                                {/* Search Input */}
                                <div className="relative w-full sm:w-[240px]">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                                    <input
                                        type="text"
                                        placeholder="Search name, ID, role or dept..."
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-400 text-xs sm:text-sm text-slate-800 placeholder:text-slate-400 transition-all"
                                    />
                                </div>

                                {/* Direct Excel Export Button */}
                                <button
                                    onClick={() => handleExportReport("excel")}
                                    disabled={isExporting}
                                    className="flex items-center justify-center gap-1.5 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold shadow-sm transition-all whitespace-nowrap shrink-0 disabled:opacity-50"
                                    title={selectedDept !== "All" ? `Download ${selectedDept} Excel Report` : "Download Company-Wide Excel Report"}
                                >
                                    <FileSpreadsheet className="w-3.5 h-3.5" />
                                    Excel Report
                                </button>
                            </div>
                        </div>

                        {/* Tabs */}
                        <div className="flex items-center gap-1 overflow-x-auto no-scrollbar -mx-1 px-1 pb-0.5">
                            {tabs.map((tab) => {
                                const active = activeTab === tab.id;
                                return (
                                    <button
                                        key={tab.id}
                                        onClick={() => {
                                            setActiveTab(tab.id);
                                            setSearchQuery("");
                                        }}
                                        className={`flex items-center gap-1.5 px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-all whitespace-nowrap shrink-0 ${active
                                            ? "bg-slate-900 text-white shadow-md"
                                            : "text-slate-500 hover:text-slate-700 hover:bg-slate-100"
                                            }`}
                                    >
                                        <tab.icon className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                                        {tab.label}
                                        <span
                                            className={`ml-1 px-1.5 py-0.5 text-[10px] font-bold rounded-full ${
                                                active
                                                    ? "bg-slate-700 text-white"
                                                    : "bg-slate-200 text-slate-600"
                                            }`}
                                        >
                                            {tabCounts[tab.id as keyof typeof tabCounts] ?? 0}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </div>

                {/* Table body */}
                <div className="overflow-x-auto">
                    <table className="w-full text-left min-w-[750px]">
                        <thead>
                            <tr className="bg-slate-50/80 border-b border-slate-100">
                                {["Employee", "Role & Manager", "JD Status", "KRA / KPI Status", "Last Active", "Action"].map(
                                    (h, i) => (
                                        <th
                                            key={i}
                                            className="px-3 sm:px-6 py-3 text-[10px] sm:text-[11px] font-semibold text-slate-500 uppercase tracking-wider"
                                        >
                                            {h}
                                        </th>
                                    ),
                                )}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {displayData.length > 0 ? (
                                displayData.map((item, i) => (
                                    <tr
                                        key={i}
                                        className="hover:bg-blue-50/30 transition-colors group"
                                    >
                                        {/* Employee */}
                                        <td className="px-3 sm:px-6 py-4">
                                            <div className="flex items-center gap-3">
                                                <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center font-medium text-sm text-slate-600 border border-slate-200 shrink-0">
                                                    {item.name?.charAt(0) || "?"}
                                                </div>
                                                <div>
                                                    <div className="font-semibold text-sm text-slate-900">
                                                        {item.name || "Unknown"}
                                                    </div>
                                                    <div className="text-[11px] text-slate-400 font-mono">
                                                        {item.employee_id} {item.department ? `• ${item.department}` : ""}
                                                    </div>
                                                </div>
                                            </div>
                                        </td>
                                        {/* Role & Manager */}
                                        <td className="px-3 sm:px-6 py-4">
                                            <div className="flex flex-col">
                                                <span className="font-medium text-xs text-slate-800">
                                                    {item.role || "Employee"}
                                                </span>
                                                {item.manager_name && (
                                                    <span className="text-[11px] text-slate-400">
                                                        Mgr: {item.manager_name}
                                                    </span>
                                                )}
                                            </div>
                                        </td>
                                        {/* JD Status */}
                                        <td className="px-3 sm:px-6 py-4">
                                            <span
                                                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold border ${statusBadgeClass(item.jd_status)}`}
                                            >
                                                <span
                                                    className={`w-1.5 h-1.5 rounded-md ${statusDotColor(item.jd_status)}`}
                                                />
                                                {formatStatus(item.jd_status)}
                                            </span>
                                        </td>
                                        {/* KRA / KPI Status */}
                                        <td className="px-3 sm:px-6 py-4">
                                            <span
                                                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold border ${kraKpiBadgeClass(item.kra_kpi_status)}`}
                                            >
                                                <span
                                                    className={`w-1.5 h-1.5 rounded-md ${kraKpiDotColor(item.kra_kpi_status)}`}
                                                />
                                                {formatKraKpiStatus(item.kra_kpi_status)}
                                            </span>
                                        </td>
                                        {/* Last Active */}
                                        <td className="px-4 sm:px-6 py-4 text-xs text-slate-500 font-medium whitespace-nowrap">
                                            {item.last_active ? formatDate(item.last_active) : "—"}
                                        </td>
                                        {/* Action */}
                                        <td className="px-3 sm:px-6 py-4">
                                            <Link
                                                href={`/admin/jd/${item.jd_session_id || item.employee_id}`}
                                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-md transition-colors"
                                            >
                                                <Eye className="w-3.5 h-3.5" />
                                                View
                                            </Link>
                                        </td>
                                    </tr>
                                ))
                            ) : (
                                <tr>
                                    <td
                                        colSpan={6}
                                        className="px-6 py-16 text-center"
                                    >
                                        <div className="flex flex-col items-center">
                                            <div className="w-14 h-14 bg-slate-100 rounded-md flex items-center justify-center text-slate-300 mb-3">
                                                <UserCheck className="w-7 h-7" />
                                            </div>
                                            <p className="text-sm font-medium text-slate-400">
                                                No employees found matching filter criteria
                                            </p>
                                        </div>
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
