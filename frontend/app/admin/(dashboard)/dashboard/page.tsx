"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { API_URL } from "@/lib/api";
import {
  Users,
  CheckCircle,
  XCircle,
  Search,
  Clock,
  UserCheck,
  ChevronRight,
  ShieldCheck,
  FileText,
  Eye,
} from "lucide-react";
import Link from "next/link";
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
const BAR_COLORS = ["#3b82f6", "#8b5cf6", "#10b981", "#f59e0b", "#ef4444"];

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

export default function AdminDashboard() {
  const router = useRouter();
  const [stats, setStats] = useState<any>(null);
  const [charts, setCharts] = useState<any>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [jds, setJds] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState("All Users");

  useEffect(() => {
    const token = localStorage.getItem("admin_token");
    if (!token) {
      router.push("/admin/login");
      return;
    }
    fetchDashboardData();
  }, []);

  const fetchDashboardData = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem("admin_token");
      const headers = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      };

      const [statsRes, chartsRes, usersRes, jdsRes] = await Promise.all([
        fetch(`${API_URL}/admin/stats/overview`, { headers }),
        fetch(`${API_URL}/admin/stats/charts`, { headers }),
        fetch(`${API_URL}/admin/users`, { headers }),
        fetch(`${API_URL}/jd/list`, { headers }),
      ]);

      if (statsRes.status === 401 || statsRes.status === 403) {
        localStorage.removeItem("admin_token");
        router.push("/admin/login");
        return;
      }

      if (statsRes.ok) setStats(await statsRes.json());
      if (chartsRes.ok) setCharts(await chartsRes.json());
      if (usersRes.ok) setUsers(await usersRes.json());
      if (jdsRes.ok) setJds(await jdsRes.json());
    } catch (err) {
      console.error("Failed to load admin data", err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="h-[60vh] flex flex-col items-center justify-center space-y-4">
        <div className="relative">
          <div className="w-14 h-14 border-[3px] border-blue-600/20 border-t-blue-600 rounded-full animate-spin" />
          <ShieldCheck className="w-5 h-5 text-blue-600 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
        </div>
        <p className="text-sm font-medium text-slate-400 animate-pulse">
          Loading dashboard...
        </p>
      </div>
    );
  }

  /* ─── Tab / filter logic ─── */
  const isJDTab = ["Approved", "Rejected", "Pending"].includes(activeTab);

  const filteredUsers = users.filter((u) => {
    const q = searchQuery.toLowerCase();
    const matchSearch =
      u.name?.toLowerCase().includes(q) ||
      u.employee_id?.toLowerCase().includes(q);
    if (activeTab === "All Users") return matchSearch;
    if (activeTab === "Managers") return matchSearch && u.role === "Manager";
    if (activeTab === "HR") return matchSearch && u.role === "HR";
    return matchSearch;
  });

  const filteredJDs = jds.filter((jd) => {
    const q = searchQuery.toLowerCase();
    const matchSearch = jd.title?.toLowerCase().includes(q);
    if (activeTab === "Approved")
      return matchSearch && jd.status === "approved";
    if (activeTab === "Rejected")
      return (
        matchSearch &&
        ["manager_rejected", "hr_rejected", "rejected"].includes(jd.status)
      );
    if (activeTab === "Pending")
      return (
        matchSearch && ["sent_to_manager", "sent_to_hr"].includes(jd.status)
      );
    return false;
  });

  const displayData = isJDTab ? filteredJDs : filteredUsers;

  const tabs = [
    { id: "All Users", label: "All Users", icon: Users },
    { id: "Approved", label: "Approved", icon: CheckCircle },
    { id: "Rejected", label: "Rejected", icon: XCircle },
    { id: "Pending", label: "Pending", icon: Clock },
    { id: "Managers", label: "Managers", icon: UserCheck },
    { id: "HR", label: "HR", icon: ShieldCheck },
  ];

  const statCards = [
    {
      label: "Total Employees",
      value: stats?.total_employees || 0,
      icon: Users,
      gradient: "from-blue-500 to-blue-600",
      shadow: "shadow-blue-200/60",
    },
    {
      label: "Pending JDs",
      value: stats?.pending_jds || 0,
      icon: Clock,
      gradient: "from-amber-400 to-orange-500",
      shadow: "shadow-amber-200/60",
    },
    {
      label: "Approved JDs",
      value: stats?.approved_jds || 0,
      icon: CheckCircle,
      gradient: "from-emerald-500 to-teal-600",
      shadow: "shadow-emerald-200/60",
    },
    {
      label: "Rejected JDs",
      value: stats?.rejected_jds || 0,
      icon: XCircle,
      gradient: "from-rose-500 to-pink-600",
      shadow: "shadow-rose-200/60",
    },
  ];

  return (
    <div className="space-y-6 sm:space-y-8">
      {/* ─── Stats Cards ─── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-5">
        {statCards.map((s, i) => (
          <div
            key={i}
            className={`relative overflow-hidden rounded-xl sm:rounded-2xl bg-gradient-to-br ${s.gradient} p-4 sm:p-6 text-white shadow-lg ${s.shadow} hover:shadow-xl hover:-translate-y-0.5 transition-all duration-300`}
          >
            {/* Decorative circles */}
            <div className="absolute -top-6 -right-6 w-20 h-20 sm:w-24 sm:h-24 bg-white/10 rounded-full" />
            <div className="absolute -bottom-4 -left-4 w-14 h-14 sm:w-16 sm:h-16 bg-white/5 rounded-full" />

            <div className="relative">
              <div className="flex items-center justify-between mb-3 sm:mb-4">
                <s.icon className="w-6 h-6 sm:w-7 sm:h-7 opacity-90" />
                <span className="text-[10px] sm:text-xs font-medium bg-white/20 px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-full">
                  Live
                </span>
              </div>
              <h3 className="text-2xl sm:text-4xl font-extrabold tracking-tight">
                {s.value}
              </h3>
              <p className="text-xs sm:text-sm font-medium opacity-90 mt-0.5">
                {s.label}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* ─── Charts Row ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
        {/* JD Pipeline */}
        <div className="bg-white rounded-xl sm:rounded-2xl p-4 sm:p-6 border border-slate-200 shadow-sm">
          <div className="mb-4 sm:mb-6">
            <h2 className="text-base sm:text-lg font-bold text-slate-900 flex items-center gap-2">
              <div className="w-1 h-5 sm:w-1.5 sm:h-6 bg-blue-500 rounded-full" />
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
        <div className="bg-white rounded-xl sm:rounded-2xl p-4 sm:p-6 border border-slate-200 shadow-sm">
          <div className="mb-4 sm:mb-6">
            <h2 className="text-base sm:text-lg font-bold text-slate-900 flex items-center gap-2">
              <div className="w-1 h-5 sm:w-1.5 sm:h-6 bg-indigo-500 rounded-full" />
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
      <div className="bg-white rounded-xl sm:rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        {/* Table header */}
        <div className="p-4 sm:p-6 border-b border-slate-100">
          <div className="flex flex-col gap-4">
            {/* Title row */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-lg sm:text-xl font-bold text-slate-900">
                  {isJDTab ? `${activeTab} JDs` : "Employee's List"}
                </h2>
                <p className="text-xs sm:text-sm text-slate-400 mt-0.5">
                  {isJDTab
                    ? "Filter and review job descriptions"
                    : "View and manage all employees"}
                </p>
              </div>

              {/* Search */}
              <div className="relative w-full sm:w-auto sm:min-w-[280px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  placeholder={
                    isJDTab ? "Search JDs..." : "Search employees..."
                  }
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-400 text-sm text-slate-800 placeholder:text-slate-400 transition-all"
                />
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
                    className={`flex items-center gap-1.5 px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-all whitespace-nowrap shrink-0 ${
                      active
                        ? "bg-slate-900 text-white shadow-md"
                        : "text-slate-500 hover:text-slate-700 hover:bg-slate-100"
                    }`}
                  >
                    <tab.icon className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                    {tab.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Table body */}
        <div className="overflow-x-auto">
          <table className="w-full text-left min-w-[600px]">
            <thead>
              <tr className="bg-slate-50/80 border-b border-slate-100">
                {isJDTab
                  ? [
                      "JD Title",
                      "Employee ID",
                      "Version",
                      "Updated",
                      "Status",
                      "",
                    ].map((h, i) => (
                      <th
                        key={i}
                        className="px-4 sm:px-6 py-3 text-[11px] font-semibold text-slate-500 uppercase tracking-wider"
                      >
                        {h}
                      </th>
                    ))
                  : ["Employee", "Role", "JD Status", "Last Active", ""].map(
                      (h, i) => (
                        <th
                          key={i}
                          className="px-4 sm:px-6 py-3 text-[11px] font-semibold text-slate-500 uppercase tracking-wider"
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
                    {isJDTab ? (
                      <>
                        {/* JD Title */}
                        <td className="px-4 sm:px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-lg bg-blue-100 flex items-center justify-center text-blue-600 shrink-0">
                              <FileText className="w-4 h-4" />
                            </div>
                            <span className="font-semibold text-sm text-slate-900 line-clamp-1 max-w-[200px] sm:max-w-[280px]">
                              {item.title || "Untitled JD"}
                            </span>
                          </div>
                        </td>
                        {/* Employee ID */}
                        <td className="px-4 sm:px-6 py-4 text-sm text-slate-500 font-medium">
                          {item.employee_id || "—"}
                        </td>
                        {/* Version */}
                        <td className="px-4 sm:px-6 py-4 text-sm text-slate-500 font-medium">
                          v{item.version || "1"}.0
                        </td>
                        {/* Updated */}
                        <td className="px-4 sm:px-6 py-4 text-sm text-slate-500">
                          {item.updated_at
                            ? new Date(item.updated_at).toLocaleDateString(
                                "en-IN",
                                {
                                  day: "2-digit",
                                  month: "short",
                                  year: "numeric",
                                },
                              )
                            : "—"}
                        </td>
                        {/* Status */}
                        <td className="px-4 sm:px-6 py-4">
                          <span
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold border ${statusBadgeClass(item.status)}`}
                          >
                            <span
                              className={`w-1.5 h-1.5 rounded-full ${statusDotColor(item.status)}`}
                            />
                            {formatStatus(item.status)}
                          </span>
                        </td>
                        {/* Action */}
                        <td className="px-4 sm:px-6 py-4">
                          <Link
                            href={`/jd/${item.id}`}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-md transition-colors"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            View
                          </Link>
                        </td>
                      </>
                    ) : (
                      <>
                        {/* Employee */}
                        <td className="px-4 sm:px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center font-bold text-sm text-slate-600 border border-slate-200 shrink-0">
                              {item.name?.charAt(0) || "?"}
                            </div>
                            <div>
                              <div className="font-semibold text-sm text-slate-900">
                                {item.name || "Unknown"}
                              </div>
                              <div className="text-[11px] text-slate-400">
                                {item.employee_id}
                              </div>
                            </div>
                          </div>
                        </td>
                        {/* Role */}
                        <td className="px-4 sm:px-6 py-4">
                          <span
                            className={`px-2.5 py-1 rounded-md text-xs font-semibold border ${
                              item.role === "Manager"
                                ? "bg-indigo-50 text-indigo-700 border-indigo-200"
                                : item.role === "HR"
                                  ? "bg-teal-50 text-teal-700 border-teal-200"
                                  : "bg-slate-50 text-slate-600 border-slate-200"
                            }`}
                          >
                            {item.role || "Employee"}
                          </span>
                        </td>
                        {/* JD Status — uses jd_status from backend */}
                        <td className="px-4 sm:px-6 py-4">
                          <span
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold border ${statusBadgeClass(item.jd_status)}`}
                          >
                            <span
                              className={`w-1.5 h-1.5 rounded-full ${statusDotColor(item.jd_status)}`}
                            />
                            {formatStatus(item.jd_status)}
                          </span>
                        </td>
                        {/* Last Active */}
                        <td className="px-4 sm:px-6 py-4 text-sm text-slate-500">
                          {item.last_active
                            ? new Date(item.last_active).toLocaleDateString(
                                "en-IN",
                                {
                                  day: "2-digit",
                                  month: "short",
                                  year: "numeric",
                                },
                              )
                            : "—"}
                        </td>
                        {/* Action */}
                        <td className="px-4 sm:px-6 py-4">
                          {item.jd_session_id ? (
                            <Link
                              href={`/jd/${item.jd_session_id}`}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-md transition-colors"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              View JD
                            </Link>
                          ) : (
                            <span className="text-xs text-slate-300 font-medium">
                              —
                            </span>
                          )}
                        </td>
                      </>
                    )}
                  </tr>
                ))
              ) : (
                <tr>
                  <td
                    colSpan={isJDTab ? 6 : 5}
                    className="px-6 py-16 text-center"
                  >
                    <div className="flex flex-col items-center">
                      <div className="w-14 h-14 bg-slate-100 rounded-xl flex items-center justify-center text-slate-300 mb-3">
                        {isJDTab ? (
                          <FileText className="w-7 h-7" />
                        ) : (
                          <UserCheck className="w-7 h-7" />
                        )}
                      </div>
                      <p className="text-sm font-medium text-slate-400">
                        {isJDTab
                          ? `No ${activeTab.toLowerCase()} job descriptions found`
                          : "No employees match your search"}
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
