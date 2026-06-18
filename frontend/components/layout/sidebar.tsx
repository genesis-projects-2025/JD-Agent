// frontend/components/layout/sidebar.tsx
// PERFORMANCE: replaced useState+useEffect+fetch with React Query hooks.
// - Employee JD list and unread-feedback badge are now cached and deduplicated.
// - When the dashboard also calls useEmployeeJDs for the same id, it hits the
// cache — no extra network request.

"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState, useLayoutEffect } from "react";
import { getCurrentUser } from "@/lib/api";
import { useAuth } from "@/components/providers/auth-provider";
import { useEmployeeJDs, useUnreadFeedback } from "@/hooks/useJDQueries";
import type { SessionListItem } from "@/types/session";

interface JDSession extends SessionListItem {
    id: string;
    title: string | null;
    status: string;
    updated_at: string | null;
}
import {
    LayoutDashboard,
    FileText,
    Settings,
    HelpCircle,
    LogOut,
    Megaphone,
    Menu,
    X,
    FilePlus,
    ShieldCheck,
    AlertTriangle,
    ChevronRight,
    Clock,
    Loader2,
    MessageSquare,
    Target,
} from "lucide-react";
import FeedbackModal from "@/components/feedback/FeedbackModal";

const STATUS_CONFIG: Record<string, { label: string; dotColor: string }> = {
    collecting: { label: "In Progress", dotColor: "bg-amber-400" },
    ready_for_generation: { label: "Ready to Gen", dotColor: "bg-blue-400" },
    draft: { label: "Draft", dotColor: "bg-neutral-400" },
    jd_generated: { label: "Generated", dotColor: "bg-emerald-400" },
    sent_to_manager: { label: "Under Review", dotColor: "bg-blue-400" },
    manager_rejected: { label: "Needs Rev", dotColor: "bg-red-400" },
    sent_to_hr: { label: "HR Review", dotColor: "bg-purple-400" },
    hr_rejected: { label: "Action Reqd", dotColor: "bg-red-400" },
    approved: { label: "Approved", dotColor: "bg-emerald-500" },
    rejected: { label: "Rejected", dotColor: "bg-red-400" },
};

function formatDate(dateStr: string | null): string {
    if (!dateStr) return "—";
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
}

export default function Sidebar() {
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const { employeeId, isAuthenticated, logout } = useAuth();

    const [isFeedbackOpen, setIsFeedbackOpen] = useState(false);
    const [isMounted, setIsMounted] = useState(false);
    const [isMobileOpen, setIsMobileOpen] = useState(false);

    const user = isMounted ? getCurrentUser() : null;
    const role = user?.role || "employee";
    const currentView = searchParams.get("view");

    // ── React Query — cached, deduplicated ───────────────────────────────────
    const { data: jds = [], isLoading: loadingJds } = useEmployeeJDs(
        isAuthenticated && employeeId ? employeeId : null,
    );

    const { data: unreadFeedback = [] } = useUnreadFeedback(
        isMounted && employeeId
            ? employeeId
            : null,
        role,
    );

    const unreadFeedbackCount = Array.isArray(unreadFeedback)
        ? unreadFeedback.length
        : 0;

    // ── Nav links ─────────────────────────────────────────────────────────────
    type NavItem = {
        name: string;
        href: string;
        icon: React.ElementType;
        description: string;
    };

    const approvedJd = jds.find((j: any) => j.status === "approved") || jds[0];
    const targetJdId = approvedJd?.id;

    const links: NavItem[] = [
        {
            name: "Dashboard",
            href: employeeId ? `/dashboard/${btoa(employeeId)}` : "/",
            icon: LayoutDashboard,
            description: "My job descriptions",
        },
        {
            name: "Create JD",
            href: "/questionnaire",
            icon: FilePlus,
            description: "Start AI interview",
        },
        {
            name: "KRA / KPI",
            href: targetJdId ? `/jd/${targetJdId}?tab=kra-kpi` : "/questionnaire",
            icon: Target,
            description: "My performance goals",
        },
    ];

    if (role === "employee") {
        links.push({
            name: "Feedback",
            href: employeeId ? `/feedback/${btoa(employeeId)}` : "/",
            icon: MessageSquare,
            description: "Review comments",
        });
    } else if (role === "manager" || role === "head") {
        links.push({
            name: "Approvals",
            href: employeeId ? `/feedback/${btoa(employeeId)}` : "/",
            icon: AlertTriangle,
            description: "Pending reviews",
        });
    } else if (role === "hr" || role === "admin") {
        links.push({
            name: "Reviews",
            href: employeeId ? `/feedback/${btoa(employeeId)}` : "/",
            icon: ShieldCheck,
            description: "Final approvals",
        });
    }

    // Admin-only: JD Library
    if (role === "admin") {
        links.push({
            name: "Reference Library",
            href: "/admin/jd-library",
            icon: FileText,
            description: "Upload & manage JDs",
        });
    }

    const isActive = (href: string) => {
        if (href === "/" && pathname !== "/") return false;
        const baseHref = href.split("?")[0];
        // Exact match for leaf routes like /questionnaire (no trailing segments)
        const isBaseMatch =
            pathname === baseHref ||
            (baseHref !== "/questionnaire" && pathname.startsWith(baseHref + "/"));
        if (!isBaseMatch) return false;
        if (!href.includes("?")) return !currentView;
        const linkView = href.split("view=")[1]?.split("&")[0];
        return currentView === linkView;
    };

    useEffect(() => {
        // Defer mounting to avoid hydration mismatch
        const mountTimer = setTimeout(() => setIsMounted(true), 0);
        return () => clearTimeout(mountTimer);
    }, []);
    useEffect(() => {
        // Close sidebar on navigation on mobile (deferred to avoid cascading renders)
        const closeTimer = setTimeout(() => setIsMobileOpen(false), 0);
        return () => clearTimeout(closeTimer);
    }, [pathname, searchParams]);

    if (!isMounted || !isAuthenticated) return null;

    return (
        <>
            {isAuthenticated && (
                <button
                    onClick={() => setIsMobileOpen(true)}
                    aria-label="Open menu"
                    className={`md:hidden fixed top-4 left-4 z-40 p-2.5 rounded-md shadow-md transition-all active:scale-95 ${pathname.startsWith("/admin")
                            ? "bg-slate-900 text-white hover:bg-slate-800"
                            : "bg-neutral-900 text-white hover:bg-neutral-800"
                        }`}
                >
                    <Menu className="w-5 h-5" />
                </button>
            )}

            {isMobileOpen && (
                <div
                    className="md:hidden fixed inset-0 bg-black/60 z-40 backdrop-blur-sm animate-in fade-in duration-200"
                    onClick={() => setIsMobileOpen(false)}
                    aria-hidden="true"
                />
            )}

            <aside
                className={`
 fixed inset-y-0 left-0 z-50
 md:relative md:z-auto
 w-72 h-screen bg-gradient-to-b from-neutral-900 via-neutral-900 to-neutral-800
 text-white flex flex-col border-r border-neutral-800 shadow-md
 transition-transform duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] will-change-transform
 ${isMobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"}
 `}
            >
                <div className="p-6 flex items-center justify-between shrink-0">
                    <Link
                        href={employeeId ? `/home/${btoa(employeeId)}` : "/"}
                        className="flex items-center gap-3 group transition-opacity hover:opacity-80"
                    >
                        <div className="h-10 w-auto flex items-center justify-center group-hover:scale-105 transition-transform">
                            <img
                                src="https://company-logo-wtn.s3.ap-southeast-2.amazonaws.com/logo.png"
                                alt="Pulse Pharma Logo"
                                className="h-full object-contain"
                            />
                        </div>
                        <div>
                            <h1 className="text-lg font-medium ">JD</h1>
                            <p className="text-xs text-neutral-400">Pulse Pharma</p>
                        </div>
                    </Link>
                    <button
                        onClick={() => setIsMobileOpen(false)}
                        aria-label="Close menu"
                        className="md:hidden p-2 text-neutral-400 hover:text-white bg-neutral-800 rounded-lg transition-colors active:scale-95"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <nav className="p-4 space-y-1.5 shrink-0">
                    {links.map((link) => {
                        const Icon = link.icon;
                        const active = isActive(link.href);
                        return (
                            <Link
                                key={link.name}
                                href={link.href}
                                className={`
 group relative flex items-center gap-3 px-4 py-3.5 rounded-md
 transition-all duration-200 ease-out
 ${active
                                        ? "bg-primary-600 text-white shadow-md shadow-primary-900/30"
                                        : "text-neutral-400 hover:text-white hover:bg-neutral-800/50"
                                    }
 `}
                            >
                                {active && (
                                    <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-white rounded-r-full" />
                                )}
                                <Icon
                                    className={`w-5 h-5 transition-transform ${active ? "scale-110" : "group-hover:scale-105"}`}
                                />
                                <div className="flex-1">
                                    <div
                                        className={`font-medium text-sm ${active ? "text-white" : ""} flex items-center gap-2`}
                                    >
                                        {link.name}
                                        {(link.name === "Approvals" || link.name === "Reviews" || link.name === "Feedback") &&
                                            unreadFeedbackCount > 0 && (
                                                <span className="inline-flex items-center justify-center w-5 h-5 text-[10px] font-medium bg-red-500 text-white rounded-md animate-pulse shadow-md shadow-red-500/30">
                                                    {unreadFeedbackCount}
                                                </span>
                                            )}
                                    </div>
                                    <div className="text-xs opacity-60 mt-0.5">
                                        {link.description}
                                    </div>
                                </div>
                            </Link>
                        );
                    })}
                </nav>

                {/* JD list */}
                <div className="flex-1 overflow-hidden flex flex-col border-t border-neutral-800/50 mt-2">
                    <div className="px-5 py-3 flex items-center justify-between shrink-0">
                        <h2 className="text-xs font-semibold text-neutral-500 tracking-wider">
                            My JDs
                        </h2>
                        {loadingJds && (
                            <Loader2 className="w-3.5 h-3.5 text-neutral-500 animate-spin" />
                        )}
                    </div>

                    <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-3 space-y-1 custom-scrollbar">
                        {!loadingJds && jds.length === 0 && (
                            <div className="px-3 py-6 text-center">
                                <FileText className="w-8 h-8 text-neutral-700 mx-auto mb-2" />
                                <p className="text-xs text-neutral-500">No JDs started</p>
                                <p className="text-xs text-neutral-600 mt-1">
                                    Click 'Create New JD' above!
                                </p>
                            </div>
                        )}

                        {(jds as SessionListItem[]).map((jdItem) => {
                            const config =
                                STATUS_CONFIG[jdItem.status] || STATUS_CONFIG.draft;
                            const href = [
                                "draft",
                                "jd_generated",
                                "sent_to_manager",
                                "manager_rejected",
                                "sent_to_hr",
                                "hr_rejected",
                                "approved",
                            ].includes(jdItem.status)
                                ? `/jd/${jdItem.id}`
                                : `/questionnaire/${jdItem.id}`;
                            const isJDActive = pathname === href;

                            return (
                                <Link
                                    key={jdItem.id}
                                    href={href}
                                    className={`
 group block relative overflow-hidden rounded-md transition-all duration-300 mb-2.5
 ${isJDActive
                                            ? "bg-primary-900/40 border border-primary-500/30 shadow-[0_0_15px_rgba(59,130,246,0.1)]"
                                            : "bg-neutral-800/30 border border-neutral-700/50 hover:bg-neutral-800 hover:border-neutral-600 hover:-translate-y-0.5 hover:shadow-md"
                                        }
 `}
                                >
                                    <div className="p-3">
                                        <div className="flex items-start justify-between gap-2 mb-2">
                                            <span className="text-sm font-medium text-neutral-200 leading-tight line-clamp-2">
                                                {jdItem.title || "Untitled JD"}
                                            </span>
                                            <ChevronRight
                                                className={`w-4 h-4 flex-shrink-0 mt-0.5 transition-transform duration-300 ${isJDActive
                                                        ? "text-primary-400 translate-x-1"
                                                        : "text-neutral-500 group-hover:text-neutral-300 group-hover:translate-x-1"
                                                    }`}
                                            />
                                        </div>
                                        <div className="flex items-center justify-between mt-auto">
                                            <span className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-black/20 border border-white/5">
                                                <span
                                                    className={`w-1.5 h-1.5 rounded-md ${config.dotColor}`}
                                                />
                                                <span className="text-[10px] font-medium text-neutral-400 tracking-wider">
                                                    {config.label}
                                                </span>
                                            </span>
                                            <span className="flex items-center gap-1 text-[10px] font-medium text-neutral-500">
                                                <Clock className="w-3 h-3" />
                                                {formatDate(jdItem.updated_at)}
                                            </span>
                                        </div>
                                    </div>
                                    {isJDActive && (
                                        <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary-500 rounded-l-xl" />
                                    )}
                                </Link>
                            );
                        })}
                    </div>
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-neutral-800/50 space-y-2 flex flex-col shrink-0 mt-auto">
                    <button
                        onClick={() => setIsFeedbackOpen(true)}
                        className="w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-emerald-400 hover:text-white hover:bg-emerald-500/20 transition-all text-sm font-medium border border-emerald-500/20"
                    >
                        <Megaphone className="w-4 h-4" />
                        <span>Send Feedback</span>
                    </button>
                    <div className="h-px bg-neutral-800/50 my-2" />
                    <button className="w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800/50 transition-all text-sm">
                        <Settings className="w-4 h-4" />
                        <span>Settings</span>
                    </button>
                    <button className="w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800/50 transition-all text-sm">
                        <HelpCircle className="w-4 h-4" />
                        <span>Help & Support</span>
                    </button>
                    <div className="h-px bg-neutral-800/50 my-2" />
                    <button
                        onClick={logout}
                        className="w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-rose-400 hover:text-white hover:bg-rose-500/20 transition-all text-sm"
                    >
                        <LogOut className="w-4 h-4" />
                        <span>Sign Out</span>
                    </button>
                </div>

                <FeedbackModal
                    isOpen={isFeedbackOpen}
                    onClose={() => setIsFeedbackOpen(false)}
                />
            </aside>
        </>
    );
}
