// components/layout/sidebar.tsx
"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import {
  fetchEmployeeJDs,
  fetchManagerPendingJDs,
  fetchHRPendingJDs,
  getCurrentUser,
  fetchUnreadFeedback,
} from "@/lib/api";
import { useAuth } from "@/components/providers/auth-provider";
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
  Users,
  ShieldCheck,
  CheckCircle2,
  ChevronRight,
  Clock,
  Loader2,
} from "lucide-react";
import FeedbackModal from "@/components/feedback/FeedbackModal";

type JDListItem = {
  id: string;
  title: string | null;
  status: string;
  version: number;
  updated_at: string | null;
};

type NavItem = {
  name: string;
  href: string;
  icon: React.ElementType;
  description: string;
};

const STATUS_CONFIG: Record<string, { label: string; dotColor: string }> = {
  draft: { label: "Draft", dotColor: "bg-amber-400" },
  jd_generated: { label: "Draft", dotColor: "bg-amber-400" },
  sent_to_manager: { label: "Under Review", dotColor: "bg-blue-400" },
  manager_rejected: { label: "Needs Rev", dotColor: "bg-red-400" },
  sent_to_hr: { label: "HR Review", dotColor: "bg-purple-400" },
  hr_rejected: { label: "Action Reqd", dotColor: "bg-red-400" },
  approved: { label: "Approved", dotColor: "bg-emerald-400" },
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

  const [jds, setJds] = useState<JDListItem[]>([]);
  const [loadingJds, setLoadingJds] = useState(false);
  const [isFeedbackOpen, setIsFeedbackOpen] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [unreadFeedbackCount, setUnreadFeedbackCount] = useState(0);

  // Safely get user info
  const user = isMounted ? getCurrentUser() : null;
  const role = user?.role || "employee";
  const currentView = searchParams.get("view");

  // Load saved JDs
  useEffect(() => {
    if (!isAuthenticated || !employeeId) return;

    async function loadJDs() {
      setLoadingJds(true);
      try {
        const data = await fetchEmployeeJDs(employeeId as string);
        setJds(data || []);
      } catch (err) {
        console.error("Failed to load JDs for sidebar:", err);
        setJds([]);
      } finally {
        setLoadingJds(false);
      }
    }
    loadJDs();
  }, [pathname, employeeId, isAuthenticated, role]);

  // Load unread feedback count for sidebar badge
  useEffect(() => {
    if (!isAuthenticated || !employeeId || !isMounted) return;
    const r = user?.role || "employee";
    if (r !== "manager" && r !== "employee") return;
    fetchUnreadFeedback(employeeId, r)
      .then((data) =>
        setUnreadFeedbackCount(Array.isArray(data) ? data.length : 0),
      )
      .catch(() => setUnreadFeedbackCount(0));
  }, [pathname, employeeId, isAuthenticated, isMounted, user?.role]);

  // Base links everyone has
  const links: NavItem[] = [
    {
      name: "Dashboard",
      href: employeeId ? `/dashboard/${employeeId}` : "/",
      icon: LayoutDashboard,
      description: "Overview & stats",
    },
    {
      name: "Create New JD",
      href: "/questionnaire",
      icon: FilePlus,
      description: "Start new interview",
    },
  ];

  // Role-specific links
  if (role === "manager") {
    links.push({
      name: "Pending JDs",
      href: employeeId ? `/dashboard/${employeeId}?view=pending` : "/",
      icon: Users,
      description: "Review JDs from employees",
    });
    links.push({
      name: "Feedback from HR",
      href: employeeId ? `/dashboard/${employeeId}?view=feedback` : "/",
      icon: CheckCircle2,
      description: "HR change requests",
    });
  } else if (role === "hr") {
    links.push({
      name: "Pending JDs",
      href: employeeId ? `/dashboard/${employeeId}?view=pending` : "/",
      icon: ShieldCheck,
      description: "Review JDs from managers",
    });
    links.push({
      name: "Feedback to Manager",
      href: employeeId ? `/dashboard/${employeeId}?view=approvals` : "/",
      icon: ShieldCheck,
      description: "Requested changes",
    });
  }

  // Determine active link
  const isActive = (href: string) => {
    if (href === "/" && pathname !== "/") return false;

    const baseHref = href.split("?")[0];
    const isBaseMatch =
      pathname === baseHref || pathname.startsWith(baseHref + "/");

    if (!isBaseMatch) return false;

    // For links without a query string
    if (!href.includes("?")) {
      return !currentView;
    }

    // For links with a specific view parameter
    const linkView = href.split("view=")[1]?.split("&")[0];
    return currentView === linkView;
  };

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    setIsMobileOpen(false);
  }, [pathname, searchParams]);

  // Hide sidebar if they are not logged in or are on the admin portal
  if (!isMounted || !isAuthenticated || pathname.startsWith("/admin"))
    return null;

  return (
    <>
      {/* Mobile Toggle Button — hidden on questionnaire/chat pages */}
      {isAuthenticated &&
        !pathname.startsWith("/admin") &&
        !pathname.startsWith("/questionnaire") && (
          <button
            onClick={() => setIsMobileOpen(true)}
            className="md:hidden fixed top-4 left-4 z-40 p-2.5 bg-neutral-900 text-white rounded-xl shadow-xl hover:bg-neutral-800 transition-colors"
          >
            <Menu className="w-5 h-5" />
          </button>
        )}

      {/* Mobile Backdrop */}
      {isMobileOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/60 z-40 backdrop-blur-sm transition-opacity"
          onClick={() => setIsMobileOpen(false)}
        />
      )}

      <aside
        className={`
        fixed inset-y-0 left-0 z-50
        md:relative md:z-auto
        w-72 h-screen bg-gradient-to-b from-neutral-900 via-neutral-900 to-neutral-800 text-white flex flex-col border-r border-neutral-800 shadow-2xl
        transition-transform duration-300 ease-out
        ${isMobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"}
      `}
      >
        <div className="p-6 flex items-center justify-between shrink-0">
          <Link
            href={employeeId ? `/dashboard/${employeeId}` : "/"}
            className="flex items-center gap-3 group transition-opacity hover:opacity-80"
          >
            <div className="w-10 h-10 bg-gradient-to-br from-primary-500 to-primary-700 rounded-xl flex items-center justify-center shadow-lg shadow-primary-900/50 group-hover:scale-105 transition-transform">
              <FileText className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight">
                JD Intelligence
              </h1>
              <p className="text-xs text-neutral-400">Pulse Pharma</p>
            </div>
          </Link>
          <button
            onClick={() => setIsMobileOpen(false)}
            className="md:hidden p-2 text-neutral-400 hover:text-white bg-neutral-800 rounded-lg"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="p-4 space-y-1.5 shrink-0">
          {links.map((link) => {
            const Icon = link.icon;
            const active = isActive(link.href);

            return (
              <Link
                key={link.href}
                href={link.href}
                className={`
                group relative flex items-center gap-3 px-4 py-3.5 rounded-xl 
                transition-all duration-200 ease-out
                ${
                  active
                    ? "bg-primary-600 text-white shadow-lg shadow-primary-900/30"
                    : "text-neutral-400 hover:text-white hover:bg-neutral-800/50"
                }
              `}
              >
                {/* Active Indicator */}
                {active && (
                  <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-white rounded-r-full" />
                )}

                {/* Icon */}
                <Icon
                  className={`w-5 h-5 transition-transform ${active ? "scale-110" : "group-hover:scale-105"}`}
                />

                {/* Text */}
                <div className="flex-1">
                  <div
                    className={`font-medium text-sm ${active ? "text-white" : ""} flex items-center gap-2`}
                  >
                    {link.name}
                    {link.name.includes("Feedback") &&
                      unreadFeedbackCount > 0 && (
                        <span className="inline-flex items-center justify-center w-5 h-5 text-[10px] font-bold bg-red-500 text-white rounded-full animate-pulse shadow-lg shadow-red-500/30">
                          {unreadFeedbackCount}
                        </span>
                      )}
                  </div>
                  <div className="text-xs opacity-60 mt-0.5">
                    {link.description}
                  </div>
                </div>

                {/* Hover Effect */}
                {!active && (
                  <div className="absolute inset-0 bg-gradient-to-r from-primary-600/0 to-primary-600/5 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity" />
                )}
              </Link>
            );
          })}
        </nav>

        {/* Saved JDs Section */}
        <div className="flex-1 overflow-hidden flex flex-col border-t border-neutral-800/50 mt-2">
          <div className="px-5 py-3 flex items-center justify-between shrink-0">
            <h2 className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">
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

            {jds.map((jdItem) => {
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
                  group block relative overflow-hidden rounded-xl transition-all duration-300 mb-2.5
                  ${
                    isJDActive
                      ? "bg-primary-900/40 border border-primary-500/30 shadow-[0_0_15px_rgba(59,130,246,0.1)]"
                      : "bg-neutral-800/30 border border-neutral-700/50 hover:bg-neutral-800 hover:border-neutral-600 hover:-translate-y-0.5 hover:shadow-lg"
                  }
                `}
                >
                  <div className="p-3">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <span className="text-sm font-bold text-neutral-200 leading-tight line-clamp-2">
                        {jdItem.title || "Untitled JD"}
                      </span>
                      <ChevronRight
                        className={`w-4 h-4 flex-shrink-0 mt-0.5 transition-transform duration-300 ${
                          isJDActive
                            ? "text-primary-400 translate-x-1"
                            : "text-neutral-500 group-hover:text-neutral-300 group-hover:translate-x-1"
                        }`}
                      />
                    </div>

                    <div className="flex items-center justify-between mt-auto">
                      <span className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-black/20 border border-white/5">
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${config.dotColor}`}
                        />
                        <span className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider">
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

        {/* Footer Section */}
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
