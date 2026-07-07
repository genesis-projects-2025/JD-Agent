"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
    ArrowLeft,
    Download,
    FileText,
    User,
    CheckCircle,
    XCircle,
    Clock,
    AlertCircle,
    Building,
    Target,
    Sparkles,
    Plus,
    Trash2,
    Save,
    ChevronDown,
    ChevronUp,
    AlertTriangle,
    Loader2,
} from "lucide-react";
import { getCookie, cookieKeys } from "@/lib/cookies";
import { downloadJDPdfClient } from "@/lib/download-jd-pdf";
import { PdfDocumentView } from "@/components/jd/pdf-document-view";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface JDData {
    id: string;
    employee_id: string;
    employee_name: string;
    jd_structured?: any;
    structured_data: {
        role_title: string;
        department: string;
        level: string;
        purpose: string;
        tasks: string[];
        priority_tasks: string[];
        skills: string[];
        tools: string[];
        technologies: string[];
        qualifications: {
            education: string;
            experience_years: string;
            certifications: string[];
        };
        working_relationships: {
            reports_to: string;
            team_size: string;
            stakeholders: string[];
        };
    };
    pdf_filename?: string;
    processing_status: string;
    uploaded_at: string;
    text_length: number;
}

function formatStatus(status: string): string {
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
    };
    return map[status] || status.replace(/_/g, " ");
}

function statusBadgeClass(status: string): string {
    if (status === "approved")
        return "bg-emerald-50 text-emerald-700 border-emerald-200";
    if (["manager_rejected", "hr_rejected", "rejected"].includes(status))
        return "bg-rose-50 text-rose-700 border-rose-200";
    if (["sent_to_manager", "sent_to_hr"].includes(status))
        return "bg-amber-50 text-amber-700 border-amber-200";
    return "bg-blue-50 text-blue-700 border-blue-200";
}

function statusIcon(status: string) {
    if (status === "approved") return <CheckCircle className="w-4 h-4" />;
    if (["manager_rejected", "hr_rejected", "rejected"].includes(status))
        return <XCircle className="w-4 h-4" />;
    if (["sent_to_manager", "sent_to_hr"].includes(status))
        return <Clock className="w-4 h-4" />;
    return <AlertCircle className="w-4 h-4" />;
}

export default function AdminJDViewPage() {
    const params = useParams();
    const router = useRouter();
    const [jdData, setJdData] = useState<JDData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const jdId = params.id as string;

    // --- KRA/KPI Tab States ---
    const [activeTab, setActiveTab] = useState<"jd" | "kra-kpi">("jd");
    const [kraRecord, setKraRecord] = useState<any | null>(null);
    const [loadingKra, setLoadingKra] = useState(false);
    const [kraError, setKraError] = useState<string | null>(null);
    const [isEditingKra, setIsEditingKra] = useState(false);
    const [editedKras, setEditedKras] = useState<any[]>([]);
    const [savingKra, setSavingKra] = useState(false);

    const fetchJDData = async () => {
        try {
            setLoading(true);
            const token = getCookie(cookieKeys.ADMIN_TOKEN);
            const headers = {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
            };

            const response = await fetch(`${API_URL}/jd/${jdId}`, { headers });

            if (response.status === 401 || response.status === 403) {
                router.push("/admin/login");
                return;
            }

            if (!response.ok) {
                throw new Error(`Failed to fetch JD data: ${response.status}`);
            }

            const data = await response.json();

            if (!data || (!data.structured_data && !data.jd_structured)) {
                setError("JD structured data not found.");
            } else {
                const safeParseObject = (obj: any): any => {
                    if (!obj) return {};
                    if (typeof obj !== "string") return obj;
                    try {
                        const parsed = JSON.parse(obj);
                        return typeof parsed === "string" ? safeParseObject(parsed) : parsed;
                    } catch (e) {
                        return {};
                    }
                };

                let pStruct = safeParseObject(data.jd_structured);

                if (
                    !pStruct ||
                    Object.keys(pStruct).length === 0 ||
                    (!pStruct.responsibilities && !pStruct.key_responsibilities)
                ) {
                    try {
                        const p = safeParseObject(data.generated_jd);
                        if (p.jd_structured_data) {
                            pStruct = p.jd_structured_data;
                        } else if (p.role_summary || p.key_responsibilities || p.responsibilities) {
                            pStruct = p;
                        }
                    } catch (e) { }
                }

                if (pStruct && typeof pStruct === "object") {
                    if (pStruct.key_responsibilities && !pStruct.responsibilities) {
                        pStruct.responsibilities = pStruct.key_responsibilities;
                    }
                    if (pStruct.technical_skills && !pStruct.skills) {
                        pStruct.skills = pStruct.technical_skills;
                    }
                    if (pStruct.required_skills && !pStruct.skills) {
                        pStruct.skills = pStruct.required_skills;
                    }
                    if (pStruct.tools_used && !pStruct.tools) {
                        pStruct.tools = pStruct.tools_used;
                    }
                    if (pStruct.tools_and_technologies && !pStruct.tools) {
                        pStruct.tools = pStruct.tools_and_technologies;
                    }
                    if (pStruct.role_summary && !pStruct.purpose) {
                        pStruct.purpose = pStruct.role_summary;
                    }
                    if (pStruct.performance_metrics && !pStruct.metrics) {
                        pStruct.metrics = pStruct.performance_metrics;
                    }
                    if (pStruct.stakeholder_interactions && !pStruct.stakeholders) {
                        pStruct.stakeholders = pStruct.stakeholder_interactions;
                    }
                    if (pStruct.additional_details && !pStruct.additional) {
                        pStruct.additional = pStruct.additional_details;
                    }
                    if (pStruct.joblevel && !pStruct.job_level) {
                        pStruct.job_level = pStruct.joblevel;
                    }
                    if (pStruct.talent_bar && typeof pStruct.talent_bar === "object") {
                        pStruct.education = pStruct.education || pStruct.talent_bar.education || "";
                        pStruct.experience = pStruct.experience || pStruct.talent_bar.experience || "";
                    }
                    if (pStruct.qualifications && typeof pStruct.qualifications === "object") {
                        pStruct.education = pStruct.education || pStruct.qualifications.education || "";
                        pStruct.experience = pStruct.experience || pStruct.qualifications.experience || "";
                    }
                }

                if (!pStruct || typeof pStruct !== "object") pStruct = {};
                pStruct.responsibilities = pStruct.responsibilities || [];
                pStruct.skills = pStruct.skills || [];
                pStruct.tools = pStruct.tools || [];
                pStruct.purpose = pStruct.purpose || "";
                pStruct.education = pStruct.education || "";
                pStruct.experience = pStruct.experience || "";
                pStruct.metrics = pStruct.metrics || [];
                pStruct.stakeholders = pStruct.stakeholders || {};
                pStruct.additional = pStruct.additional || {};
                pStruct.team_structure = pStruct.team_structure || {};
                pStruct.work_environment = pStruct.work_environment || {};
                pStruct.job_level = pStruct.job_level || pStruct.joblevel || "";

                const empInfo = pStruct.employee_information || {};
                const wr = pStruct.working_relationships || {};

                const structuredData = {
                    role_title: empInfo.job_title || data.title || "Unknown Role",
                    department: empInfo.department || "General",
                    level: pStruct.experience || "Mid",
                    purpose: pStruct.purpose || "",
                    tasks: pStruct.responsibilities || [],
                    priority_tasks: pStruct.responsibilities ? pStruct.responsibilities.slice(0, 3) : [],
                    skills: pStruct.skills || [],
                    tools: pStruct.tools || [],
                    technologies: pStruct.tools || [],
                    job_level: pStruct.job_level || "",
                    qualifications: {
                        education: pStruct.education || "",
                        experience_years: pStruct.experience || "",
                        certifications: pStruct.certifications || []
                    },
                    working_relationships: {
                        reports_to: wr.reports_to || empInfo.reports_to || "",
                        team_size: wr.team_size || empInfo.team_size || "",
                        stakeholders: Array.isArray(pStruct.stakeholders) ? pStruct.stakeholders : []
                    }
                };

                setJdData({
                    id: data.id || jdId,
                    employee_id: data.employee_id || "EMP001",
                    employee_name: data.employee_name || "Employee",
                    jd_structured: pStruct,
                    structured_data: data.structured_data || structuredData,
                    processing_status: data.status || data.processing_status || "approved",
                    uploaded_at: data.created_at || data.uploaded_at || new Date().toISOString(),
                    text_length: data.generated_jd ? data.generated_jd.length : (data.text_length || 0)
                });
            }
        } catch (err) {
            console.error("Failed to load JD data", err);
            setError(err instanceof Error ? err.message : "Failed to load JD data");
        } finally {
            setLoading(false);
        }
    };

    const fetchKraData = async () => {
        setLoadingKra(true);
        setKraError(null);
        try {
            const token = getCookie(cookieKeys.ADMIN_TOKEN);
            const res = await fetch(`${API_URL}/kra-kpi/${jdId}`, {
                headers: {
                    Authorization: `Bearer ${token}`
                }
            });
            if (res.status === 404) {
                setKraRecord(null);
            } else if (!res.ok) {
                throw new Error("Failed to load KRA/KPI");
            } else {
                const data = await res.json();
                setKraRecord(data);
                const krasArray = data?.kras?.kras || [];
                setEditedKras(JSON.parse(JSON.stringify(krasArray)));
            }
        } catch (err) {
            console.error("Error loading KRA/KPI", err);
            setKraError(err instanceof Error ? err.message : "Failed to load KRA/KPI");
        } finally {
            setLoadingKra(false);
        }
    };

    useEffect(() => {
        const token = getCookie(cookieKeys.ADMIN_TOKEN);
        if (!token) {
            router.push("/admin/login");
            return;
        }
        fetchJDData();
    }, [jdId]);

    useEffect(() => {
        if (activeTab === "kra-kpi") {
            fetchKraData();
        }
    }, [activeTab, jdId]);

    // --- KRA/KPI Editing Handlers ---
    const handleUpdateKraField = (idx: number, field: string, value: any) => {
        setEditedKras((prev) => {
            const updated = [...prev];
            updated[idx] = {
                ...updated[idx],
                [field]: field === 'weight' ? (value === '' ? 0 : parseInt(value) || 0) : value
            };
            return updated;
        });
    };

    const handleDeleteKra = (idx: number) => {
        setEditedKras((prev) => prev.filter((_, i) => i !== idx));
    };

    const handleAddKra = () => {
        setEditedKras((prev) => [
            ...prev,
            {
                kra_id: `custom_kra_${Date.now()}`,
                title: "New Key Result Area",
                description: "",
                weight: 0,
                kpis: []
            }
        ]);
    };

    const handleUpdateKpiField = (kraIdx: number, kpiIdx: number, field: string, value: any) => {
        setEditedKras((prev) => {
            const updated = [...prev];
            const kra = { ...updated[kraIdx] };
            const kpis = [...(kra.kpis || [])];
            kpis[kpiIdx] = {
                ...kpis[kpiIdx],
                [field]: value
            };
            kra.kpis = kpis;
            updated[kraIdx] = kra;
            return updated;
        });
    };

    const handleDeleteKpi = (kraIdx: number, kpiIdx: number) => {
        setEditedKras((prev) => {
            const updated = [...prev];
            const kra = { ...updated[kraIdx] };
            kra.kpis = (kra.kpis || []).filter((_: any, i: number) => i !== kpiIdx);
            updated[kraIdx] = kra;
            return updated;
        });
    };

    const handleAddKpi = (kraIdx: number) => {
        setEditedKras((prev) => {
            const updated = [...prev];
            const kra = { ...updated[kraIdx] };
            kra.kpis = [
                ...(kra.kpis || []),
                {
                    kpi_id: `custom_kpi_${Date.now()}`,
                    title: "New KPI Indicator",
                    description: "",
                    metric: "",
                    target: ""
                }
            ];
            updated[kraIdx] = kra;
            return updated;
        });
    };

    const handleSaveKraChanges = async () => {
        if (!jdData) return;
        setSavingKra(true);
        try {
            const token = getCookie(cookieKeys.ADMIN_TOKEN);
            const res = await fetch(`${API_URL}/admin/kra-kpi/${jdData.employee_id}`, {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ kras: { kras: editedKras } }),
            });
            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.detail || "Failed to update KRA/KPI framework");
            }
            alert("KRA/KPI framework successfully updated and saved to employee dashboard!");
            setIsEditingKra(false);
            await fetchKraData();
        } catch (err) {
            console.error("Failed to save KRA/KPI", err);
            alert(err instanceof Error ? err.message : "Failed to save KRA/KPI framework");
        } finally {
            setSavingKra(false);
        }
    };

    if (loading) {
        return (
            <div className="h-[60vh] flex flex-col items-center justify-center space-y-4">
                <div className="relative">
                    <div className="w-14 h-14 border-[3px] border-blue-600/20 border-t-blue-600 rounded-md animate-spin" />
                    <FileText className="w-5 h-5 text-blue-600 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
                </div>
                <p className="text-sm font-medium text-slate-400 animate-pulse">
                    Loading JD details...
                </p>
            </div>
        );
    }

    if (error || !jdData) {
        return (
            <div className="space-y-6">
                <div className="flex items-center gap-4">
                    <Link
                        href="/admin/dashboard"
                        className="flex items-center gap-2 px-4 py-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        Back to Dashboard
                    </Link>
                </div>
                <div className="text-center py-12">
                    <AlertCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
                    <h2 className="text-xl font-semibold text-slate-900 mb-2">Error Loading JD</h2>
                    <p className="text-slate-600">{error || "JD not found"}</p>
                </div>
            </div>
        );
    }

    const structured = jdData.structured_data;
    const totalWeight = editedKras.reduce((acc, k) => acc + (k.weight || 0), 0);

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <Link
                        href="/admin/dashboard"
                        className="flex items-center gap-2 px-4 py-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        Back to Dashboard
                    </Link>
                    <div className="h-6 w-px bg-slate-200" />
                    <div>
                        <h1 className="text-2xl font-bold text-slate-900">
                            {structured.role_title}
                        </h1>
                        <div className="flex items-center gap-4 mt-1">
                            <span className="text-sm text-slate-500 flex items-center gap-1">
                                <User className="w-4 h-4" />
                                {jdData.employee_name} ({jdData.employee_id})
                            </span>
                            <span className="text-sm text-slate-500 flex items-center gap-1">
                                <Building className="w-4 h-4" />
                                {structured.department}
                            </span>
                            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold border ${statusBadgeClass(jdData.processing_status)}`}>
                                {statusIcon(jdData.processing_status)}
                                {formatStatus(jdData.processing_status)}
                            </span>
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    {activeTab === "jd" && (
                        <button
                            onClick={() => {
                                const dataToDownload = jdData.jd_structured || jdData.structured_data;
                                if (dataToDownload) {
                                    downloadJDPdfClient(
                                        dataToDownload,
                                        structured.role_title || undefined,
                                        structured.department || undefined
                                    );
                                } else {
                                    alert("No JD data available to download.");
                                }
                            }}
                            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-semibold"
                        >
                            <Download className="w-4 h-4" />
                            Export PDF
                        </button>
                    )}
                </div>
            </div>

            {/* Tab Switcher */}
            <div className="flex items-center gap-1 bg-slate-100 p-1.5 rounded-xl w-fit border border-slate-250/20">
                <button
                    onClick={() => setActiveTab("jd")}
                    className={`px-5 py-2.5 text-xs font-bold rounded-lg transition-all flex items-center gap-2 ${activeTab === "jd" ? "bg-white text-blue-700 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
                >
                    <FileText className="w-4 h-4" />
                    Job Description
                </button>
                <button
                    onClick={() => setActiveTab("kra-kpi")}
                    className={`px-5 py-2.5 text-xs font-bold rounded-lg transition-all flex items-center gap-2 ${activeTab === "kra-kpi" ? "bg-white text-indigo-700 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
                >
                    <Target className="w-4 h-4" />
                    Performance Goals (KRA/KPI)
                </button>
            </div>

            {/* JD Content Tab */}
            {activeTab === "jd" && (
                <div className="bg-slate-50 p-6 rounded-xl border border-slate-200 shadow-inner flex justify-center overflow-x-auto">
                    <PdfDocumentView
                        data={jdData.jd_structured || jdData.structured_data}
                        roleTitle={structured.role_title}
                        dept={structured.department}
                    />
                </div>
            )}

            {/* KRA/KPI Tab */}
            {activeTab === "kra-kpi" && (
                <div className="space-y-6">
                    {loadingKra ? (
                        <div className="h-[40vh] flex flex-col items-center justify-center space-y-4">
                            <Loader2 className="w-10 h-10 text-indigo-600 animate-spin" />
                            <p className="text-sm font-medium text-slate-400">Loading KRA/KPI framework...</p>
                        </div>
                    ) : kraError ? (
                        <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
                            <AlertCircle className="w-10 h-10 text-red-500 mx-auto mb-2" />
                            <h3 className="text-md font-semibold text-red-800">Failed to load KRA/KPI</h3>
                            <p className="text-xs text-red-600 mt-1">{kraError}</p>
                        </div>
                    ) : !kraRecord ? (
                        <div className="bg-white border border-slate-200 rounded-2xl p-12 text-center shadow-sm">
                            <Target className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                            <h3 className="text-lg font-bold text-slate-800">No Goals Deployed</h3>
                            <p className="text-sm text-slate-500 mt-1 max-w-md mx-auto">
                                No performance framework (KRA/KPI) has been uploaded or configured for this employee yet.
                            </p>
                            <Link
                                href="/admin/jd-library"
                                className="inline-flex items-center gap-2 mt-6 px-5 py-2.5 bg-indigo-600 text-white rounded-xl text-xs font-bold hover:bg-indigo-750 transition-all shadow-sm"
                            >
                                <Plus className="w-4 h-4" />
                                Upload KRA/KPI Framework
                            </Link>
                        </div>
                    ) : (
                        /* KRA KPI Editor Card */
                        <div className="bg-white rounded-2xl border border-slate-200 p-8 shadow-sm space-y-6">
                            <div className="flex items-center justify-between border-b border-slate-100 pb-5">
                                <div>
                                    <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                                        <Sparkles className="w-5 h-5 text-indigo-500" />
                                        Performance Framework (KRA/KPI)
                                    </h2>
                                    <p className="text-xs text-slate-500 mt-0.5">
                                        Managing performance targets for {jdData.employee_name} ({jdData.employee_id})
                                    </p>
                                </div>
                                <div className="flex items-center gap-3">
                                    {totalWeight > 0 && (
                                        <span className={`text-xs font-bold px-3 py-1.5 border rounded-lg ${totalWeight === 100 ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-700 border-amber-200'}`}>
                                            Total Weight: {totalWeight}%
                                        </span>
                                    )}
                                    <button
                                        onClick={() => {
                                            if (isEditingKra) {
                                                // Reset changes
                                                setEditedKras(JSON.parse(JSON.stringify(kraRecord?.kras?.kras || [])));
                                            }
                                            setIsEditingKra(!isEditingKra);
                                        }}
                                        className="px-4 py-2 border border-slate-200 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-50 transition-colors shadow-sm"
                                    >
                                        {isEditingKra ? "Cancel" : "Edit Framework"}
                                    </button>
                                </div>
                            </div>

                            {/* Weight Visualizer Bar */}
                            {editedKras.length > 0 && (
                                <div className="h-2.5 w-full bg-slate-100 rounded-full overflow-hidden flex shadow-inner">
                                    {editedKras.map((kra, idx) => {
                                        const colors = ['bg-indigo-500', 'bg-violet-500', 'bg-emerald-500', 'bg-amber-500', 'bg-rose-500', 'bg-blue-500'];
                                        const color = colors[idx % colors.length];
                                        return (
                                            <div
                                                key={idx}
                                                className={`${color} h-full transition-all duration-300`}
                                                style={{ width: `${(kra.weight / (totalWeight || 1)) * 100 || 20}%` }}
                                                title={`${kra.title}: ${kra.weight}%`}
                                            />
                                        );
                                    })}
                                </div>
                            )}

                            {/* Weight warning */}
                            {isEditingKra && totalWeight !== 100 && (
                                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
                                    <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                                    <div>
                                        <h4 className="text-xs font-bold text-amber-800">Weights do not sum to 100%</h4>
                                        <p className="text-[11px] text-amber-600 mt-0.5">
                                            Currently, the sum of all KRA weights is {totalWeight}%. It is highly recommended to adjust weights so they sum up to exactly 100%.
                                        </p>
                                    </div>
                                </div>
                            )}

                            <div className="space-y-6">
                                {editedKras.map((kra, idx) => (
                                    <div key={idx} className="border border-slate-200 rounded-2xl overflow-hidden shadow-sm bg-white hover:border-slate-300 transition-colors">
                                        <div className="bg-slate-50/80 p-4 border-b border-slate-200 flex items-center justify-between gap-4">
                                            <div className="flex-1">
                                                <span className="text-[10px] text-indigo-600 font-bold uppercase tracking-wider flex items-center gap-2">
                                                    KRA {idx + 1}
                                                    {isEditingKra && (
                                                        <button
                                                            onClick={() => handleDeleteKra(idx)}
                                                            className="text-red-500 hover:text-red-700 transition-colors ml-2"
                                                            title="Delete KRA"
                                                        >
                                                            <Trash2 className="w-3.5 h-3.5" />
                                                        </button>
                                                    )}
                                                </span>
                                                {isEditingKra ? (
                                                    <input
                                                        type="text"
                                                        value={kra.title}
                                                        onChange={(e) => handleUpdateKraField(idx, 'title', e.target.value)}
                                                        className="w-full bg-white border border-slate-200 rounded px-2.5 py-1.5 text-sm font-semibold text-slate-900 mt-1 focus:outline-none focus:border-indigo-500"
                                                    />
                                                ) : (
                                                    <h4 className="text-sm font-semibold text-slate-900 mt-0.5">{kra.title}</h4>
                                                )}
                                            </div>
                                            <div>
                                                {isEditingKra ? (
                                                    <div className="flex items-center gap-1 bg-white border border-slate-200 rounded px-2.5 py-1.5 w-24">
                                                        <input
                                                            type="number"
                                                            value={kra.weight ?? 0}
                                                            onChange={(e) => handleUpdateKraField(idx, 'weight', e.target.value)}
                                                            className="w-full bg-transparent text-xs text-center font-bold text-indigo-700 outline-none"
                                                            placeholder="Weight"
                                                        />
                                                        <span className="text-xs font-semibold text-slate-400 select-none">%</span>
                                                    </div>
                                                ) : kra.weight ? (
                                                    <span className="px-2.5 py-1 bg-indigo-50 border border-indigo-150 rounded-lg text-xs font-bold text-indigo-700">
                                                        {kra.weight}% Weight
                                                    </span>
                                                ) : null}
                                            </div>
                                        </div>
                                        <div className="p-4 space-y-4">
                                            <div>
                                                <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block mb-1">Description</label>
                                                {isEditingKra ? (
                                                    <textarea
                                                        value={kra.description || ""}
                                                        onChange={(e) => handleUpdateKraField(idx, 'description', e.target.value)}
                                                        className="w-full bg-white border border-slate-200 rounded px-2.5 py-1.5 text-xs text-slate-700 focus:outline-none focus:border-indigo-500"
                                                        rows={2}
                                                    />
                                                ) : (
                                                    <p className="text-xs text-slate-500 leading-relaxed">{kra.description}</p>
                                                )}
                                            </div>
                                            
                                            <div className="border-t border-slate-100 pt-3">
                                                <div className="flex items-center justify-between mb-2">
                                                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">KPI Key Performance Indicators</span>
                                                    {isEditingKra && (
                                                        <button
                                                            onClick={() => handleAddKpi(idx)}
                                                            className="flex items-center gap-1 px-2.5 py-1 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded text-[10px] font-semibold text-slate-600 transition-colors"
                                                        >
                                                            <Plus className="w-3 h-3" /> Add KPI
                                                        </button>
                                                    )}
                                                </div>

                                                <div className="space-y-3">
                                                    {(kra.kpis || []).map((kpi: any, kpiIdx: number) => (
                                                        <div key={kpiIdx} className="bg-slate-50/50 rounded-xl p-3 border border-slate-100 space-y-3">
                                                            <div className="flex items-start justify-between gap-3">
                                                                <div className="flex-1 space-y-2">
                                                                    {isEditingKra ? (
                                                                        <div className="space-y-2">
                                                                            <input
                                                                                type="text"
                                                                                value={kpi.title}
                                                                                onChange={(e) => handleUpdateKpiField(idx, kpiIdx, 'title', e.target.value)}
                                                                                placeholder="KPI Title"
                                                                                className="w-full bg-white border border-slate-200 rounded px-2 py-1 text-xs font-semibold text-slate-800 focus:outline-none"
                                                                            />
                                                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                                                                <input
                                                                                    type="text"
                                                                                    value={kpi.metric || ""}
                                                                                    onChange={(e) => handleUpdateKpiField(idx, kpiIdx, 'metric', e.target.value)}
                                                                                    placeholder="Metric / Measurement"
                                                                                    className="w-full bg-white border border-slate-200 rounded px-2 py-1 text-[11px] text-slate-600 focus:outline-none"
                                                                                />
                                                                                <input
                                                                                    type="text"
                                                                                    value={kpi.target || ""}
                                                                                    onChange={(e) => handleUpdateKpiField(idx, kpiIdx, 'target', e.target.value)}
                                                                                    placeholder="Target Date / Value"
                                                                                    className="w-full bg-white border border-slate-200 rounded px-2 py-1 text-[11px] text-slate-600 focus:outline-none"
                                                                                />
                                                                            </div>
                                                                        </div>
                                                                    ) : (
                                                                        <div>
                                                                            <h5 className="text-xs font-semibold text-slate-800">
                                                                                {kpiIdx + 1}. {kpi.title}
                                                                            </h5>
                                                                            <div className="flex flex-wrap items-center gap-3 mt-1 text-[10px] text-slate-500">
                                                                                {kpi.metric && <span>Metric: <strong className="text-slate-700">{kpi.metric}</strong></span>}
                                                                                {kpi.target && <span>Target: <strong className="text-slate-700">{kpi.target}</strong></span>}
                                                                            </div>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                                {isEditingKra && (
                                                                    <button
                                                                        onClick={() => handleDeleteKpi(idx, kpiIdx)}
                                                                        className="text-slate-400 hover:text-red-500 transition-colors p-1"
                                                                        title="Delete KPI"
                                                                    >
                                                                        <Trash2 className="w-3.5 h-3.5" />
                                                                    </button>
                                                                )}
                                                            </div>
                                                        </div>
                                                    ))}
                                                    {(kra.kpis || []).length === 0 && (
                                                        <p className="text-[11px] text-slate-400 italic">No KPIs added to this KRA yet.</p>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ))}

                                {editedKras.length === 0 && (
                                    <div className="text-center py-8 bg-slate-50 border border-slate-200 rounded-xl">
                                        <p className="text-xs text-slate-400 italic">No KRAs in this framework. Click Add KRA below.</p>
                                    </div>
                                )}

                                {isEditingKra && (
                                    <div className="flex justify-between items-center border-t border-slate-100 pt-5">
                                        <button
                                            onClick={handleAddKra}
                                            className="inline-flex items-center gap-2 px-4 py-2 border border-slate-200 rounded-lg text-xs font-semibold text-indigo-600 hover:bg-indigo-50 hover:border-indigo-200 transition-all shadow-sm"
                                        >
                                            <Plus className="w-4 h-4" /> Add KRA
                                        </button>
                                        <button
                                            onClick={handleSaveKraChanges}
                                            disabled={savingKra}
                                            className="inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-750 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-indigo-100 disabled:opacity-50"
                                        >
                                            {savingKra ? (
                                                <>
                                                    <Loader2 className="w-4 h-4 animate-spin" />
                                                    Saving...
                                                </>
                                            ) : (
                                                <>
                                                    <Save className="w-4 h-4" />
                                                    Save Changes
                                                </>
                                            )}
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}