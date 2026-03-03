"use client";

import { useEffect, useState } from "react";
import { API_URL } from "@/lib/api";
import {
  Users,
  CheckCircle,
  XCircle,
  Search,
  Filter,
  Loader2,
  TrendingUp,
  Activity,
  UserCheck,
} from "lucide-react";
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

export default function AdminDashboard() {
  const [stats, setStats] = useState<Record<string, number> | null>(null);
  const [charts, setCharts] = useState<Record<
    string,
    Array<Record<string, string | number>>
  > | null>(null);
  const [users, setUsers] = useState<Record<string, string>[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const fetchDashboardData = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem("admin_token");
      const headers = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`, // In real app use proper Bearer spec
      };

      const [statsRes, chartsRes, usersRes] = await Promise.all([
        fetch(`${API_URL}/admin/stats/overview`, { headers }),
        fetch(`${API_URL}/admin/stats/charts`, { headers }),
        fetch(`${API_URL}/admin/users`, { headers }),
      ]);

      if (statsRes.ok) setStats(await statsRes.json());
      if (chartsRes.ok) setCharts(await chartsRes.json());
      if (usersRes.ok) setUsers(await usersRes.json());
    } catch (err) {
      console.error("Failed to load admin data", err);
    } finally {
      setLoading(false);
    }
  };

  const filteredUsers = users.filter((u) => {
    const matchesSearch =
      u.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      u.employee_id.toLowerCase().includes(searchQuery.toLowerCase());

    if (!matchesSearch) return false;

    if (activeTab === "Employees" && u.role?.toLowerCase() !== "employee")
      return false;
    if (activeTab === "Managers" && u.role?.toLowerCase() !== "manager")
      return false;
    if (activeTab === "HR" && u.role?.toLowerCase() !== "hr") return false;

    if (statusFilter === "Pending") {
      const pendingStatuses = [
        "collecting",
        "draft",
        "jd_generated",
        "sent_to_manager",
        "sent_to_hr",
      ];
      if (!pendingStatuses.includes(u.jd_status?.toLowerCase())) return false;
    }
    if (
      statusFilter === "Approved" &&
      u.jd_status?.toLowerCase() !== "approved"
    )
      return false;
    if (
      statusFilter === "Rejected" &&
      !["manager_rejected", "hr_rejected"].includes(u.jd_status?.toLowerCase())
    )
      return false;

    return true;
  });

  const getStatusBadge = (status: string) => {
    const s = status.toLowerCase();
    if (s === "approved") {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />{" "}
          Approved
        </span>
      );
    }
    if (s.includes("rejected")) {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-red-50 text-red-700 border border-red-200">
          <div className="w-1.5 h-1.5 rounded-full bg-red-500" /> Rejected
        </span>
      );
    }
    if (s === "sent_to_manager" || s === "sent_to_hr") {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
          <div className="w-1.5 h-1.5 rounded-full bg-amber-500" /> Pending
        </span>
      );
    }
    if (["collecting", "draft", "jd_generated"].includes(s)) {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
          <div className="w-1.5 h-1.5 rounded-full bg-blue-500" /> Drafting
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-700 border border-slate-200">
        No JD
      </span>
    );
  };

  const PIE_COLORS = ["#10b981", "#f59e0b", "#ef4444"];

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center p-12">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-7xl mx-auto pb-12">
      {/* Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard
          title="Total Active Employees"
          value={stats?.total_employees || 0}
          icon={Users}
          color="blue"
          onClick={() => setStatusFilter("All")}
          isActive={statusFilter === "All"}
        />
        <StatCard
          title="JDs Pending Action"
          value={stats?.pending_jds || 0}
          icon={Activity}
          color="amber"
          trend="+12 this week"
          onClick={() => setStatusFilter("Pending")}
          isActive={statusFilter === "Pending"}
        />
        <StatCard
          title="JDs Approved"
          value={stats?.approved_jds || 0}
          icon={CheckCircle}
          color="emerald"
          trend="+5 this week"
          onClick={() => setStatusFilter("Approved")}
          isActive={statusFilter === "Approved"}
        />
        <StatCard
          title="JDs Rejected"
          value={stats?.rejected_jds || 0}
          icon={XCircle}
          color="red"
          trend="-2 this week"
          onClick={() => setStatusFilter("Rejected")}
          isActive={statusFilter === "Rejected"}
        />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Pipeline Bar Chart */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 lg:col-span-2">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-blue-500" />
              JD Completion Pipeline
            </h3>
          </div>
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={charts?.pipeline || []}
                margin={{ top: 20, right: 30, left: 0, bottom: 5 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  vertical={false}
                  stroke="#e2e8f0"
                />
                <XAxis
                  dataKey="status"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "#64748b", fontSize: 12 }}
                  dy={10}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "#64748b", fontSize: 12 }}
                />
                <Tooltip
                  cursor={{ fill: "#f1f5f9" }}
                  contentStyle={{
                    borderRadius: "12px",
                    border: "none",
                    boxShadow: "0 10px 15px -3px rgb(0 0 0 / 0.1)",
                  }}
                />
                <Bar
                  dataKey="count"
                  fill="#3b82f6"
                  radius={[6, 6, 0, 0]}
                  maxBarSize={60}
                >
                  {charts?.pipeline?.map((entry: any, index: number) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={
                        entry.status === "Approved"
                          ? "#10b981"
                          : entry.status === "Rejected"
                            ? "#ef4444"
                            : entry.status.includes("Pending")
                              ? "#f59e0b"
                              : "#3b82f6"
                      }
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Manager Response Rate Doughnut */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
              <UserCheck className="w-5 h-5 text-purple-500" />
              Manager Response Rate
            </h3>
          </div>
          <p className="text-sm text-slate-500 mb-4">
            Percentage of JDs reviewed by managers
          </p>
          <div className="h-64 w-full flex items-center justify-center relative">
            {charts?.manager_response &&
            charts.manager_response.length > 0 &&
            charts.manager_response.some(
              (r: any) => (r.value as number) > 0,
            ) ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={charts.manager_response}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={90}
                    paddingAngle={5}
                    dataKey="value"
                  >
                    {charts?.manager_response?.map(
                      (entry: any, index: number) => (
                        <Cell
                          key={`cell-${index}`}
                          fill={PIE_COLORS[index % PIE_COLORS.length]}
                        />
                      ),
                    )}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      borderRadius: "12px",
                      border: "none",
                      boxShadow: "0 10px 15px -3px rgb(0 0 0 / 0.1)",
                    }}
                  />
                  <Legend
                    verticalAlign="bottom"
                    height={36}
                    iconType="circle"
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="text-center text-slate-400">
                <PieChart className="w-20 h-20 mx-auto text-slate-200 mb-2" />
                <p>No manager data yet</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Master Database Table */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-6 border-b border-slate-200 space-y-4">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div className="flex items-center gap-3">
              <h3 className="text-lg font-bold text-slate-800">
                Master Directory
              </h3>
              {statusFilter !== "All" && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200 shadow-sm transition-all">
                  Status: {statusFilter}
                  <button
                    onClick={() => setStatusFilter("All")}
                    className="hover:text-blue-900 ml-1 rounded-full hover:bg-blue-200/50 p-0.5 transition-colors"
                    title="Clear filter"
                  >
                    <XCircle className="w-3.5 h-3.5" />
                  </button>
                </span>
              )}
            </div>

            <div className="relative w-full sm:w-72">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                placeholder="Search name or ID..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50"
              />
            </div>
          </div>

          <div className="flex items-center gap-2 overflow-x-auto pb-2">
            <Filter className="w-4 h-4 text-slate-400 mr-2" />
            {["All", "Employees", "Managers", "HR"].map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
                  activeTab === tab
                    ? "bg-slate-800 text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
              <tr>
                <th className="px-6 py-4 font-semibold">Employee</th>
                <th className="px-6 py-4 font-semibold">Role/Dept</th>
                <th className="px-6 py-4 font-semibold">Manager</th>
                <th className="px-6 py-4 font-semibold">JD Status</th>
                <th className="px-6 py-4 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredUsers.length > 0 ? (
                filteredUsers.map((user) => (
                  <tr
                    key={user.employee_id}
                    className="hover:bg-slate-50/50 transition-colors"
                  >
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-xs">
                          {user.name.charAt(0)}
                        </div>
                        <div>
                          <div className="font-semibold text-slate-800">
                            {user.name}
                          </div>
                          <div className="text-xs text-slate-500">
                            {user.employee_id}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-slate-700">{user.role || "N/A"}</div>
                      <div className="text-xs text-slate-500">
                        {user.department || "No Dept"}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-slate-600">
                      {user.manager_name || "-"}
                    </td>
                    <td className="px-6 py-4">
                      {getStatusBadge(user.jd_status)}
                    </td>
                    <td className="px-6 py-4 text-right">
                      {user.jd_session_id && (
                        <button className="text-blue-600 hover:text-blue-800 font-medium text-sm hover:underline">
                          View Details
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td
                    colSpan={5}
                    className="px-6 py-12 text-center text-slate-500"
                  >
                    No users found matching your filters.
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

// Subcomponents
function StatCard({
  title,
  value,
  icon: Icon,
  color,
  trend,
  onClick,
  isActive,
}: {
  title: string;
  value: number;
  icon: any;
  color: string;
  trend?: string;
  onClick?: () => void;
  isActive?: boolean;
}) {
  const colorMap: any = {
    blue: "bg-blue-50 text-blue-600",
    amber: "bg-amber-50 text-amber-600",
    emerald: "bg-emerald-50 text-emerald-600",
    red: "bg-red-50 text-red-600",
  };

  const ringMap: any = {
    blue: "border-blue-400 ring-2 ring-blue-400/20",
    amber: "border-amber-400 ring-2 ring-amber-400/20",
    emerald: "border-emerald-400 ring-2 ring-emerald-400/20",
    red: "border-red-400 ring-2 ring-red-400/20",
  };

  const activeStyles = isActive ? ringMap[color] : "border-slate-200";

  return (
    <div
      onClick={onClick}
      className={`bg-white p-6 rounded-2xl shadow-sm border flex flex-col relative overflow-hidden group transition-all ${
        onClick ? "cursor-pointer hover:shadow-md hover:-translate-y-1" : ""
      } ${activeStyles}`}
    >
      <div className="flex justify-between items-start z-10">
        <div>
          <p className="text-sm font-medium text-slate-500">{title}</p>
          <p className="text-3xl font-bold text-slate-800 mt-2">{value}</p>
        </div>
        <div className={`p-3 rounded-xl ${colorMap[color]}`}>
          <Icon className="w-6 h-6" />
        </div>
      </div>
      {trend && (
        <div className="mt-4 text-xs font-medium text-slate-500 bg-slate-50 inline-block px-2 py-1 rounded w-fit z-10">
          {trend}
        </div>
      )}

      {/* Decorative gradient blur */}
      <div className="absolute -bottom-4 -right-4 w-24 h-24 bg-gradient-to-tr from-transparent to-slate-100 rounded-full opacity-0 group-hover:opacity-100 transition-opacity" />
    </div>
  );
}
