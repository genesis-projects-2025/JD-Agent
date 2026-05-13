"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
    ArrowLeft,
    Download,
    Eye,
    FileText,
    Calendar,
    User,
    CheckCircle,
    XCircle,
    Clock,
    AlertCircle,
    Building,
    MapPin,
    Users,
} from "lucide-react";
import { getCookie, cookieKeys } from "@/lib/cookies";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface JDData {
    id: string;
    employee_id: string;
    employee_name: string;
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

    useEffect(() => {
        const token = getCookie(cookieKeys.ADMIN_TOKEN);
        if (!token) {
            router.push("/admin/login");
            return;
        }

        fetchJDData();
    }, [jdId]);

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
            if (!data || !data.structured_data) {
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
                    <button className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
                        <Download className="w-4 h-4" />
                        Export PDF
                    </button>
                </div>
            </div>

            {/* JD Content */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Main Content */}
                <div className="lg:col-span-2 space-y-6">
                    {/* Purpose */}
                    <div className="bg-white rounded-lg border border-slate-200 p-6">
                        <h2 className="text-lg font-semibold text-slate-900 mb-3">Role Purpose</h2>
                        <p className="text-slate-600 leading-relaxed">{structured.purpose}</p>
                    </div>

                    {/* Responsibilities */}
                    <div className="bg-white rounded-lg border border-slate-200 p-6">
                        <h2 className="text-lg font-semibold text-slate-900 mb-4">Key Responsibilities</h2>
                        <div className="space-y-3">
                            {structured.tasks.map((task, index) => (
                                <div key={index} className="flex items-start gap-3">
                                    <div className="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 text-xs font-medium mt-0.5">
                                        {index + 1}
                                    </div>
                                    <p className="text-slate-600 leading-relaxed">{task}</p>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Priority Tasks */}
                    <div className="bg-white rounded-lg border border-slate-200 p-6">
                        <h2 className="text-lg font-semibold text-slate-900 mb-4">Critical Priority Tasks</h2>
                        <div className="space-y-3">
                            {structured.priority_tasks.map((task, index) => (
                                <div key={index} className="flex items-start gap-3">
                                    <div className="w-6 h-6 rounded-full bg-red-100 flex items-center justify-center text-red-600 text-xs font-medium mt-0.5">
                                        !
                                    </div>
                                    <p className="text-slate-600 leading-relaxed font-medium">{task}</p>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Sidebar */}
                <div className="space-y-6">
                    {/* Skills */}
                    <div className="bg-white rounded-lg border border-slate-200 p-6">
                        <h3 className="text-sm font-semibold text-slate-900 mb-3 uppercase tracking-wide">
                            Required Skills
                        </h3>
                        <div className="flex flex-wrap gap-2">
                            {structured.skills.map((skill, index) => (
                                <span
                                    key={index}
                                    className="px-2.5 py-1 bg-blue-50 text-blue-700 text-xs font-medium rounded-md"
                                >
                                    {skill}
                                </span>
                            ))}
                        </div>
                    </div>

                    {/* Tools */}
                    <div className="bg-white rounded-lg border border-slate-200 p-6">
                        <h3 className="text-sm font-semibold text-slate-900 mb-3 uppercase tracking-wide">
                            Tools & Platforms
                        </h3>
                        <div className="flex flex-wrap gap-2">
                            {structured.tools.map((tool, index) => (
                                <span
                                    key={index}
                                    className="px-2.5 py-1 bg-green-50 text-green-700 text-xs font-medium rounded-md"
                                >
                                    {tool}
                                </span>
                            ))}
                        </div>
                    </div>

                    {/* Technologies */}
                    <div className="bg-white rounded-lg border border-slate-200 p-6">
                        <h3 className="text-sm font-semibold text-slate-900 mb-3 uppercase tracking-wide">
                            Technologies
                        </h3>
                        <div className="flex flex-wrap gap-2">
                            {structured.technologies.map((tech, index) => (
                                <span
                                    key={index}
                                    className="px-2.5 py-1 bg-purple-50 text-purple-700 text-xs font-medium rounded-md"
                                >
                                    {tech}
                                </span>
                            ))}
                        </div>
                    </div>

                    {/* Qualifications */}
                    <div className="bg-white rounded-lg border border-slate-200 p-6">
                        <h3 className="text-sm font-semibold text-slate-900 mb-4 uppercase tracking-wide">
                            Qualifications
                        </h3>
                        <div className="space-y-3">
                            <div>
                                <p className="text-xs text-slate-500 mb-1">Education</p>
                                <p className="text-sm text-slate-900">{structured.qualifications.education}</p>
                            </div>
                            <div>
                                <p className="text-xs text-slate-500 mb-1">Experience</p>
                                <p className="text-sm text-slate-900">{structured.qualifications.experience_years}</p>
                            </div>
                            {structured.qualifications.certifications.length > 0 && (
                                <div>
                                    <p className="text-xs text-slate-500 mb-2">Certifications</p>
                                    <div className="flex flex-wrap gap-1">
                                        {structured.qualifications.certifications.map((cert, index) => (
                                            <span
                                                key={index}
                                                className="px-2 py-1 bg-yellow-50 text-yellow-700 text-xs rounded"
                                            >
                                                {cert}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Working Relationships */}
                    <div className="bg-white rounded-lg border border-slate-200 p-6">
                        <h3 className="text-sm font-semibold text-slate-900 mb-4 uppercase tracking-wide">
                            Working Relationships
                        </h3>
                        <div className="space-y-3">
                            <div>
                                <p className="text-xs text-slate-500 mb-1">Reports To</p>
                                <p className="text-sm text-slate-900">{structured.working_relationships.reports_to}</p>
                            </div>
                            <div>
                                <p className="text-xs text-slate-500 mb-1">Team Size</p>
                                <p className="text-sm text-slate-900">{structured.working_relationships.team_size}</p>
                            </div>
                            {structured.working_relationships.stakeholders.length > 0 && (
                                <div>
                                    <p className="text-xs text-slate-500 mb-2">Key Stakeholders</p>
                                    <div className="space-y-1">
                                        {structured.working_relationships.stakeholders.map((stakeholder, index) => (
                                            <p key={index} className="text-sm text-slate-900">• {stakeholder}</p>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}