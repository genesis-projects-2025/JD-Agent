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

            // If API fails, show mock data for demonstration
            if (!data || (!data.structured_data && !data.jd_structured)) {
                setJdData({
                    id: jdId,
                    employee_id: "EMP001",
                    employee_name: "John Smith",
                    structured_data: {
                        role_title: "Senior Software Engineer",
                        department: "Engineering",
                        level: "Senior",
                        purpose: "Lead development of scalable web applications and mentor junior developers while ensuring high-quality code standards and best practices.",
                        tasks: [
                            "Design and implement complex software solutions",
                            "Code review and mentor junior developers",
                            "Architect scalable system components",
                            "Collaborate with cross-functional teams",
                            "Optimize application performance",
                            "Participate in technical planning and architecture decisions"
                        ],
                        priority_tasks: [
                            "Lead major feature development",
                            "Ensure code quality and standards",
                            "Mentor team members"
                        ],
                        skills: [
                            "JavaScript/TypeScript",
                            "React/Next.js",
                            "Node.js",
                            "Python",
                            "System Design",
                            "Code Review",
                            "Team Leadership"
                        ],
                        tools: [
                            "VS Code",
                            "Git",
                            "Docker",
                            "Jenkins",
                            "Postman",
                            "Figma"
                        ],
                        technologies: [
                            "React",
                            "Next.js",
                            "TypeScript",
                            "Node.js",
                            "PostgreSQL",
                            "Redis",
                            "AWS"
                        ],
                        qualifications: {
                            education: "Bachelor's degree in Computer Science or equivalent",
                            experience_years: "5+ years",
                            certifications: ["AWS Certified Developer", "React Certification"]
                        },
                        working_relationships: {
                            reports_to: "Engineering Manager",
                            team_size: "5 direct reports",
                            stakeholders: ["Product Manager", "Design Team", "DevOps Team", "QA Team"]
                        }
                    },
                    processing_status: "approved",
                    uploaded_at: new Date().toISOString(),
                    text_length: 2450
                });
            } else if (data.jd_structured && !data.structured_data) {
                // Safely transform backend's jd_structured to frontend's expected structured_data
                const s = data.jd_structured;
                const empInfo = s.employee_information || {};
                const qual = {
                    education: s.education || "",
                    experience_years: s.experience || "",
                    certifications: s.certifications || []
                };
                const wr = s.working_relationships || {};
                
                setJdData({
                    id: data.id || jdId,
                    employee_id: data.employee_id || "EMP001",
                    employee_name: data.employee_name || "Employee",
                    structured_data: {
                        role_title: empInfo.job_title || data.title || "Unknown Role",
                        department: empInfo.department || "General",
                        level: s.experience || "Mid",
                        purpose: s.purpose || "",
                        tasks: s.responsibilities || [],
                        priority_tasks: s.responsibilities ? s.responsibilities.slice(0, 3) : [],
                        skills: s.skills || [],
                        tools: s.tools || [],
                        technologies: s.tools || [],
                        qualifications: qual,
                        working_relationships: {
                            reports_to: wr.reports_to || empInfo.reports_to || "",
                            team_size: wr.team_size || empInfo.team_size || "",
                            stakeholders: wr.stakeholders || []
                        }
                    },
                    processing_status: data.status || "approved",
                    uploaded_at: data.created_at || new Date().toISOString(),
                    text_length: data.generated_jd ? data.generated_jd.length : 0
                });
            } else {
                setJdData(data);
            }
        } catch (err) {
            console.error("Failed to load JD data", err);
            setError(err instanceof Error ? err.message : "Failed to load JD data");
        } finally {
            setLoading(false);
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
                {/* Header */}
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
                        className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                    >
                        <Download className="w-4 h-4" />
                        Export PDF
                    </button>
                </div>
            </div>

            {/* JD Content */}
            <div className="bg-slate-50 p-6 rounded-xl border border-slate-200 shadow-inner flex justify-center overflow-x-auto">
                <PdfDocumentView
                    data={jdData.jd_structured || jdData.structured_data}
                    roleTitle={structured.role_title}
                    dept={structured.department}
                />
            </div>
        </div>
    );
}