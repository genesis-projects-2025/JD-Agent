"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { API_URL } from "@/lib/api";
import { getCookie, cookieKeys } from "@/lib/cookies";
import {
    Building2,
    Download,
    Upload,
    FileSpreadsheet,
    Layers,
    Users,
    CheckCircle2,
    Clock,
    Search,
    Loader2,
    FileText,
    ArrowDownToLine,
    UploadCloud,
    Sparkles,
    AlertCircle,
} from "lucide-react";

interface DeptSummary {
    department: string;
    total_employees: number;
    jd_completed: number;
    kra_completed: number;
    completion_rate: number;
}

interface EmployeeItem {
    employee_id: string;
    name: string;
    email: string;
    department: string;
    role: string;
    manager_name: string;
    jd_status: string;
    jd_session_id: string | null;
    kra_kpi_status: string;
    last_active: string | null;
}

export default function DarwinboxImportsPage() {
    const router = useRouter();
    const [departments, setDepartments] = useState<DeptSummary[]>([]);
    const [selectedDept, setSelectedDept] = useState<string>("all");
    const [employees, setEmployees] = useState<EmployeeItem[]>([]);
    const [loadingDepts, setLoadingDepts] = useState<boolean>(true);
    const [loadingEmployees, setLoadingEmployees] = useState<boolean>(false);
    const [exporting, setExporting] = useState<string | null>(null);
    const [enriching, setEnriching] = useState<boolean>(false);
    const [searchQuery, setSearchQuery] = useState<string>("");
    const [statusMessage, setStatusMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

    const fileInputRef = useRef<HTMLInputElement>(null);

    const getAuthHeaders = () => {
        const token = getCookie(cookieKeys.ADMIN_TOKEN);
        return {
            Authorization: `Bearer ${token}`,
        };
    };

    // Load department summary
    useEffect(() => {
        async function fetchDepartments() {
            try {
                setLoadingDepts(true);
                const res = await fetch(`${API_URL}/admin/departments/summary`, {
                    headers: getAuthHeaders(),
                });
                if (res.ok) {
                    const data = await res.json();
                    const deptList = Array.isArray(data) ? data : (data.departments || []);
                    setDepartments(deptList);
                }
            } catch (err) {
                console.error("Failed to load departments:", err);
            } finally {
                setLoadingDepts(false);
            }
        }
        fetchDepartments();
    }, []);

    // Load employees when selected department or search query changes
    useEffect(() => {
        async function fetchEmployees() {
            try {
                setLoadingEmployees(true);
                const deptParam = selectedDept !== "all" ? `&department=${encodeURIComponent(selectedDept)}` : "";
                const searchParam = searchQuery ? `&search=${encodeURIComponent(searchQuery)}` : "";
                const res = await fetch(`${API_URL}/admin/users?limit=1000${deptParam}${searchParam}`, {
                    headers: getAuthHeaders(),
                });
                if (res.ok) {
                    const data = await res.json();
                    setEmployees(data.items || []);
                }
            } catch (err) {
                console.error("Failed to fetch employees:", err);
            } finally {
                setLoadingEmployees(false);
            }
        }
        fetchEmployees();
    }, [selectedDept, searchQuery]);

    // Handle Direct File Download (Goals, Sub-Goals, or ZIP)
    const handleExport = async (type: "goals" | "subgoals" | "zip", targetEmpId?: string) => {
        try {
            const key = targetEmpId ? `${type}-${targetEmpId}` : `${type}-${selectedDept}`;
            setExporting(key);
            setStatusMessage(null);

            let url = `${API_URL}/admin/darwinbox/export?type=${type}`;
            if (targetEmpId) {
                url += `&employee_id=${encodeURIComponent(targetEmpId)}`;
            } else if (selectedDept !== "all") {
                url += `&department=${encodeURIComponent(selectedDept)}`;
            }

            const res = await fetch(url, { headers: getAuthHeaders() });
            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.detail || "Failed to download export file.");
            }

            const blob = await res.blob();
            const disposition = res.headers.get("content-disposition");
            let filename = `Darwinbox_${type}_${selectedDept === "all" ? "Company" : selectedDept}.csv`;
            if (disposition && disposition.includes("filename=")) {
                filename = disposition.split("filename=")[1].replace(/["']/g, "");
            }

            const downloadUrl = window.URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = downloadUrl;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(downloadUrl);
            document.body.removeChild(a);

            setStatusMessage({
                type: "success",
                text: `Successfully downloaded ${filename}`,
            });
        } catch (err: any) {
            setStatusMessage({
                type: "error",
                text: err.message || "Export download failed.",
            });
        } finally {
            setExporting(null);
        }
    };

    // Handle Report Upload -> Enrich -> Auto-Download Sub-Goals CSV
    const handleEnrichReportUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        try {
            setEnriching(true);
            setStatusMessage(null);

            const formData = new FormData();
            formData.append("file", file);

            let url = `${API_URL}/admin/darwinbox/enrich-subgoals`;
            if (selectedDept !== "all") {
                url += `?department=${encodeURIComponent(selectedDept)}`;
            }

            const res = await fetch(url, {
                method: "POST",
                headers: getAuthHeaders(),
                body: formData,
            });

            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.detail || "Failed to enrich sub-goals with uploaded report.");
            }

            const blob = await res.blob();
            const disposition = res.headers.get("content-disposition");
            let filename = `Enriched_Bulk_Sub_Goals_${selectedDept === "all" ? "Company" : selectedDept}.csv`;
            if (disposition && disposition.includes("filename=")) {
                filename = disposition.split("filename=")[1].replace(/["']/g, "");
            }

            const downloadUrl = window.URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = downloadUrl;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(downloadUrl);
            document.body.removeChild(a);

            setStatusMessage({
                type: "success",
                text: `Successfully enriched Darwinbox KRA IDs and downloaded ${filename}`,
            });
        } catch (err: any) {
            setStatusMessage({
                type: "error",
                text: err.message || "Failed to process Darwinbox report file.",
            });
        } finally {
            setEnriching(false);
            if (fileInputRef.current) {
                fileInputRef.current.value = "";
            }
        }
    };

    // Computed stats for selected department
    const totalSelectedEmployees = employees.length;
    const jdsApprovedCount = employees.filter((e) => e.jd_status.toLowerCase() === "approved").length;
    const krasApprovedCount = employees.filter(
        (e) => e.kra_kpi_status.toLowerCase() === "approved" || e.kra_kpi_status.toLowerCase() === "uploaded"
    ).length;

    return (
        <div className="p-8 max-w-[1600px] mx-auto space-y-8 font-sans">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                <div>
                    <div className="flex items-center gap-3">
                        <div className="p-2.5 bg-emerald-50 text-emerald-600 rounded-xl border border-emerald-100">
                            <UploadCloud className="w-6 h-6" />
                        </div>
                        <div>
                            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
                                Darwinbox Bulk Export & Enrich
                            </h1>
                            <p className="text-sm text-slate-500 mt-0.5">
                                Select a department to view employee statuses, download Bulk Goals, and enrich Sub-Goals with Darwinbox KRA IDs.
                            </p>
                        </div>
                    </div>
                </div>

                {/* Department Filter Dropdown */}
                <div className="flex items-center gap-3 bg-slate-50 p-2 rounded-xl border border-slate-200">
                    <Building2 className="w-5 h-5 text-slate-400 ml-2" />
                    <select
                        value={selectedDept}
                        onChange={(e) => setSelectedDept(e.target.value)}
                        className="bg-transparent text-sm font-semibold text-slate-800 outline-none cursor-pointer pr-4 py-1.5"
                    >
                        <option value="all">All Departments ({departments.reduce((acc, d) => acc + d.total_employees, 0)})</option>
                        {departments.map((d) => (
                            <option key={d.department} value={d.department}>
                                {d.department} ({d.total_employees} employees)
                            </option>
                        ))}
                    </select>
                </div>
            </div>

            {/* Status Message Notification */}
            {statusMessage && (
                <div
                    className={`p-4 rounded-xl border flex items-center gap-3 text-sm font-medium ${
                        statusMessage.type === "success"
                            ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                            : "bg-rose-50 border-emerald-200 text-rose-800"
                    }`}
                >
                    {statusMessage.type === "success" ? (
                        <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                    ) : (
                        <AlertCircle className="w-5 h-5 text-rose-600 shrink-0" />
                    )}
                    <span>{statusMessage.text}</span>
                </div>
            )}

            {/* Top Action Cards (Darwinbox Goal & Sub-Goal Workflow) */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Step 1: Download Bulk Goals CSV */}
                <div className="bg-gradient-to-br from-slate-900 to-slate-800 rounded-2xl p-6 text-white shadow-lg relative overflow-hidden flex flex-col justify-between">
                    <div className="absolute top-0 right-0 p-8 opacity-10">
                        <FileSpreadsheet className="w-32 h-32 text-white" />
                    </div>
                    <div>
                        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 mb-3">
                            Step 1 • Parent Goals
                        </div>
                        <h3 className="text-lg font-bold text-white">Download Bulk Goals CSV</h3>
                        <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                            Generate standard 11-column Bulk Goals CSV for {selectedDept === "all" ? "the entire company" : selectedDept}. Upload this file directly to Darwinbox under Goal Management.
                        </p>
                    </div>
                    <div className="mt-6 pt-4 border-t border-slate-700/60 flex items-center justify-between">
                        <button
                            onClick={() => handleExport("goals")}
                            disabled={Boolean(exporting)}
                            className="w-full py-2.5 px-4 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white font-semibold text-sm rounded-xl transition flex items-center justify-center gap-2 shadow-sm"
                        >
                            {exporting === `goals-${selectedDept}` ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                                <Download className="w-4 h-4" />
                            )}
                            <span>Download Bulk Goals CSV</span>
                        </button>
                    </div>
                </div>

                {/* Step 2: Upload Goal Report & Auto-Download Enriched Sub-Goals */}
                <div className="bg-white rounded-2xl p-6 border-2 border-emerald-500/80 shadow-md relative flex flex-col justify-between">
                    <div className="absolute -top-3 right-6 px-3 py-0.5 bg-emerald-500 text-white text-[11px] font-bold rounded-full uppercase tracking-wider">
                        Recommended
                    </div>
                    <div>
                        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 mb-3">
                            Step 2 • Auto-Enrich KRA IDs
                        </div>
                        <h3 className="text-lg font-bold text-slate-900">Upload Goal Report → Sub-Goals</h3>
                        <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                            Upload Darwinbox Export Report CSV. JD-Agent will extract unique KRA IDs, map them into Column 2, and auto-download the Enriched Sub-Goals CSV.
                        </p>
                    </div>

                    <div className="mt-6 pt-4 border-t border-slate-100">
                        <input
                            type="file"
                            ref={fileInputRef}
                            accept=".csv"
                            onChange={handleEnrichReportUpload}
                            className="hidden"
                        />
                        <button
                            onClick={() => fileInputRef.current?.click()}
                            disabled={enriching}
                            className="w-full py-2.5 px-4 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white font-semibold text-sm rounded-xl transition flex items-center justify-center gap-2 shadow-sm cursor-pointer"
                        >
                            {enriching ? (
                                <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />
                            ) : (
                                <Upload className="w-4 h-4 text-emerald-400" />
                            )}
                            <span>Upload Darwinbox Report CSV</span>
                        </button>
                    </div>
                </div>

                {/* Step 3: Direct Download Utilities */}
                <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm flex flex-col justify-between">
                    <div>
                        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-700 border border-slate-200 mb-3">
                            Utilities • Direct Exports
                        </div>
                        <h3 className="text-lg font-bold text-slate-900">Direct Download Options</h3>
                        <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                            Download plain Sub-Goals CSV with blank KRA IDs or a complete ZIP package containing both parent goals and sub-goals.
                        </p>
                    </div>

                    <div className="mt-6 pt-4 border-t border-slate-100 grid grid-cols-2 gap-3">
                        <button
                            onClick={() => handleExport("subgoals")}
                            disabled={Boolean(exporting)}
                            className="py-2 px-3 bg-slate-100 hover:bg-slate-200 text-slate-800 font-medium text-xs rounded-xl transition flex items-center justify-center gap-1.5 border border-slate-200"
                        >
                            <FileText className="w-3.5 h-3.5 text-slate-500" />
                            <span>Sub-Goals</span>
                        </button>
                        <button
                            onClick={() => handleExport("zip")}
                            disabled={Boolean(exporting)}
                            className="py-2 px-3 bg-slate-100 hover:bg-slate-200 text-slate-800 font-medium text-xs rounded-xl transition flex items-center justify-center gap-1.5 border border-slate-200"
                        >
                            <Layers className="w-3.5 h-3.5 text-slate-500" />
                            <span>ZIP Bundle</span>
                        </button>
                    </div>
                </div>
            </div>

            {/* Department Employee Section */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                {/* Section Header & Metrics */}
                <div className="p-6 border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-50/50">
                    <div>
                        <div className="flex items-center gap-3">
                            <h2 className="text-lg font-bold text-slate-900">
                                {selectedDept === "all" ? "All Employees Across Departments" : `${selectedDept} Department Employees`}
                            </h2>
                            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-slate-200 text-slate-700">
                                {totalSelectedEmployees} Total
                            </span>
                        </div>
                        <p className="text-xs text-slate-500 mt-1">
                            Review JD and KRA/KPI approval statuses before exporting to Darwinbox.
                        </p>
                    </div>

                    {/* Quick Stats Badges */}
                    <div className="flex items-center gap-3 text-xs font-semibold">
                        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 text-emerald-700 rounded-lg border border-emerald-200">
                            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                            <span>{jdsApprovedCount} JDs Approved</span>
                        </div>
                        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 text-blue-700 rounded-lg border border-blue-200">
                            <Sparkles className="w-4 h-4 text-blue-600" />
                            <span>{krasApprovedCount} KRAs Approved</span>
                        </div>
                    </div>
                </div>

                {/* Table Filter / Search */}
                <div className="p-4 border-b border-slate-100 bg-white flex items-center justify-between">
                    <div className="relative w-full max-w-sm">
                        <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                        <input
                            type="text"
                            placeholder="Search employee by name, ID, or role..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 outline-none focus:border-emerald-500 focus:bg-white transition"
                        />
                    </div>
                </div>

                {/* Employee Table */}
                <div className="overflow-x-auto">
                    {loadingEmployees ? (
                        <div className="p-12 text-center text-slate-400 flex items-center justify-center gap-2 text-sm font-medium">
                            <Loader2 className="w-5 h-5 animate-spin text-emerald-500" />
                            <span>Loading department employee records...</span>
                        </div>
                    ) : employees.length === 0 ? (
                        <div className="p-12 text-center text-slate-500 text-sm">
                            No employees found matching the filter criteria.
                        </div>
                    ) : (
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="border-b border-slate-100 bg-slate-50/80 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                                    <th className="py-3.5 px-6">Employee ID & Name</th>
                                    <th className="py-3.5 px-4">Role & Department</th>
                                    <th className="py-3.5 px-4">Manager</th>
                                    <th className="py-3.5 px-4 text-center">JD Status</th>
                                    <th className="py-3.5 px-4 text-center">KRA / KPI Status</th>
                                    <th className="py-3.5 px-6 text-right">Individual Export</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 text-xs font-medium text-slate-700">
                                {employees.map((emp) => {
                                    const isJdApproved = emp.jd_status.toLowerCase() === "approved";
                                    const isKraApproved =
                                        emp.kra_kpi_status.toLowerCase() === "approved" ||
                                        emp.kra_kpi_status.toLowerCase() === "uploaded";

                                    return (
                                        <tr key={emp.employee_id} className="hover:bg-slate-50/60 transition">
                                            {/* Employee ID & Name */}
                                            <td className="py-4 px-6">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-8 h-8 rounded-full bg-slate-100 border border-slate-200 text-slate-700 font-bold text-xs flex items-center justify-center shrink-0">
                                                        {emp.name.charAt(0)}
                                                    </div>
                                                    <div>
                                                        <div className="font-bold text-slate-900">{emp.name}</div>
                                                        <div className="text-[11px] font-semibold text-emerald-600">
                                                            {emp.employee_id}
                                                        </div>
                                                    </div>
                                                </div>
                                            </td>

                                            {/* Role & Dept */}
                                            <td className="py-4 px-4">
                                                <div className="font-semibold text-slate-800">{emp.role}</div>
                                                <div className="text-[11px] text-slate-400">{emp.department || "Unassigned"}</div>
                                            </td>

                                            {/* Manager */}
                                            <td className="py-4 px-4 text-slate-600">
                                                {emp.manager_name || "—"}
                                            </td>

                                            {/* JD Status */}
                                            <td className="py-4 px-4 text-center">
                                                <span
                                                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold ${
                                                        isJdApproved
                                                            ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                                                            : emp.jd_status.toLowerCase() === "no jd"
                                                            ? "bg-slate-100 text-slate-500 border border-slate-200"
                                                            : "bg-amber-50 text-amber-700 border border-amber-200"
                                                    }`}
                                                >
                                                    {isJdApproved ? (
                                                        <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                                                    ) : (
                                                        <Clock className="w-3 h-3" />
                                                    )}
                                                    <span className="capitalize">{emp.jd_status}</span>
                                                </span>
                                            </td>

                                            {/* KRA Status */}
                                            <td className="py-4 px-4 text-center">
                                                <span
                                                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold ${
                                                        isKraApproved
                                                            ? "bg-blue-50 text-blue-700 border border-blue-200"
                                                            : emp.kra_kpi_status.toLowerCase() === "not started"
                                                            ? "bg-slate-100 text-slate-500 border border-slate-200"
                                                            : "bg-purple-50 text-purple-700 border border-purple-200"
                                                    }`}
                                                >
                                                    {isKraApproved ? (
                                                        <CheckCircle2 className="w-3 h-3 text-blue-600" />
                                                    ) : (
                                                        <Clock className="w-3 h-3" />
                                                    )}
                                                    <span className="capitalize">{emp.kra_kpi_status}</span>
                                                </span>
                                            </td>

                                            {/* Individual Export Actions */}
                                            <td className="py-4 px-6 text-right">
                                                <div className="flex items-center justify-end gap-2">
                                                    <button
                                                        onClick={() => handleExport("goals", emp.employee_id)}
                                                        disabled={!isKraApproved || Boolean(exporting)}
                                                        title="Export Individual Bulk Goals CSV"
                                                        className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 disabled:opacity-40 text-slate-700 text-[11px] font-bold rounded-lg border border-slate-200 transition flex items-center gap-1"
                                                    >
                                                        <Download className="w-3 h-3" />
                                                        <span>Goals</span>
                                                    </button>
                                                    <button
                                                        onClick={() => handleExport("subgoals", emp.employee_id)}
                                                        disabled={!isKraApproved || Boolean(exporting)}
                                                        title="Export Individual Sub-Goals CSV"
                                                        className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 disabled:opacity-40 text-slate-700 text-[11px] font-bold rounded-lg border border-slate-200 transition flex items-center gap-1"
                                                    >
                                                        <FileText className="w-3 h-3" />
                                                        <span>Sub-Goals</span>
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>
        </div>
    );
}
