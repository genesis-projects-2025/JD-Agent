// components/layout/sidebar.tsx
"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import {
  fetchEmployeeJDs,
  getCurrentUser,
  fetchManagerPendingJDs,
  fetchHRPendingJDs,
} from "@/lib/api";
import { useAuth } from "@/components/providers/auth-provider";
import {
  LayoutDashboard,
  MessageSquare,
  CheckCircle2,
  FileText,
  Settings,
  HelpCircle,
  Clock,
  ChevronRight,
  Loader2,
  LogOut,
  Users,
  ShieldCheck,
  Megaphone,
} from "lucide-react";
import FeedbackModal from "@/components/feedback/FeedbackModal";

type JDListItem = {
  id: string;
  title: string | null;
  status: string;
  version: number;
  updated_at: string | null;
};

const STATUS_CONFIG: Record<string, { label: string; dotColor: string }> = {
  collecting: { label: "In Progress", dotColor: "bg-amber-400" },
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
  const [myJds, setMyJds] = useState<JDListItem[]>([]);
  const [loadingJds, setLoadingJds] = useState(false);
  const [isFeedbackOpen, setIsFeedbackOpen] = useState(false);

  const user = getCurrentUser();
  const role = user?.role || "employee";
  const currentView = searchParams.get("view");

  // Base links everyone has
  const links = [
    {
      name: "Dashboard",
      href: employeeId ? `/dashboard/${employeeId}` : "/",
      icon: LayoutDashboard,
      description: "Overview & stats",
    },
    {
      name: "Create My JD",
      href: "/questionnaire",
      icon: MessageSquare,
      description: "Start new interview",
    },
  ];

  // Role-specific links
  if (role === "manager") {
    links.push({
      name: "Pending Approvals",
      href: employeeId ? `/dashboard/${employeeId}?view=approvals` : "/",
      icon: Users,
      description: "Review pending JDs",
    });
    links.push({
      name: "Feedback from HR",
      href: employeeId ? `/dashboard/${employeeId}?view=feedback` : "/",
      icon: CheckCircle2,
      description: "Feedback & status",
    });
  } else if (role === "hr") {
    links.push({
      name: "Feedback to Manager",
      href: employeeId ? `/dashboard/${employeeId}?view=approvals` : "/",
      icon: ShieldCheck,
      description: "Finalize JD assets",
    });
  } else {
    links.push({
      name: "Feedback from Manager",
      href: employeeId ? `/dashboard/${employeeId}?view=approvals` : "/",
      icon: CheckCircle2,
      description: "Feedback & status",
    });
  }

  const isActive = (href: string) => {
    const baseHref = href.split("?")[0];
    const isBaseMatch = pathname === baseHref || pathname.startsWith(baseHref);

    // Exact match for root navigation without params
    if (!href.includes("?")) {
      return isBaseMatch && !currentView;
    }

    // Match for parameterized links
    const linkView = href.split("view=")[1];
    return isBaseMatch && currentView === linkView;
  };

  // Load saved JDs
  useEffect(() => {
    if (!isAuthenticated || !employeeId) return;

    async function loadJDs() {
      setLoadingJds(true);
      try {
        // Dynamically fetch different JDs depending on role
        if (role === "manager") {
          const [pendingData, myData] = await Promise.all([
            fetchManagerPendingJDs(employeeId as string),
            fetchEmployeeJDs(employeeId as string),
          ]);
          setJds(pendingData || []);
          setMyJds(myData || []);
        } else if (role === "hr") {
          const [pendingData, myData] = await Promise.all([
            fetchHRPendingJDs(),
            fetchEmployeeJDs(employeeId as string),
          ]);
          setJds(pendingData || []);
          setMyJds(myData || []);
        } else {
          const data = await fetchEmployeeJDs(employeeId as string);
          setJds(data || []);
          setMyJds([]);
        }
      } catch (err) {
        console.error("Failed to load JDs for sidebar:", err);
        setJds([]);
        setMyJds([]);
      } finally {
        setLoadingJds(false);
      }
    }
    loadJDs();
  }, [pathname, employeeId, isAuthenticated, role]); // Reload when navigating or ID changes

  // Hide sidebar if they are not logged in or are on the admin portal
  if (!isAuthenticated || pathname.startsWith("/admin")) return null;

  return (
    <aside className="w-72 h-screen bg-gradient-to-b from-neutral-900 via-neutral-900 to-neutral-800 text-white flex flex-col border-r border-neutral-800 shadow-2xl">
      {/* Logo Section */}
      <div className="p-6 border-b border-neutral-800/50">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-primary-500 to-primary-700 rounded-xl flex items-center justify-center shadow-lg shadow-primary-900/50">
            <FileText className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight">
              JD Intelligence
            </h1>
            <p className="text-xs text-neutral-400">Pulse Pharma</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="p-4 space-y-1.5">
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
                  className={`font-medium text-sm ${active ? "text-white" : ""}`}
                >
                  {link.name}
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
        <div className="px-5 py-3 flex items-center justify-between">
          <h2 className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">
            {role === "manager"
              ? "Pending Approvals"
              : role === "hr"
                ? "HR Review Queue"
                : "My JD Creations"}
          </h2>
          {loadingJds && (
            <Loader2 className="w-3.5 h-3.5 text-neutral-500 animate-spin" />
          )}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-3 space-y-1">
          {!loadingJds && jds.length === 0 && (
            <div className="px-3 py-6 text-center">
              <FileText className="w-8 h-8 text-neutral-700 mx-auto mb-2" />
              <p className="text-xs text-neutral-500">No pending JDs</p>
              <p className="text-xs text-neutral-600 mt-1">
                You're all caught up!
              </p>
            </div>
          )}

          {jds.map((jdItem) => {
            const config = STATUS_CONFIG[jdItem.status] || STATUS_CONFIG.draft;
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
                  group flex flex-col gap-1.5 px-3 py-3 rounded-lg transition-all duration-150 mb-1
                  ${
                    isJDActive
                      ? "bg-neutral-700/50 border border-neutral-600"
                      : "hover:bg-neutral-800/60 border border-transparent"
                  }
                `}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-neutral-200 truncate">
                    {jdItem.title || "Untitled JD"}
                  </span>
                  <ChevronRight className="w-3.5 h-3.5 text-neutral-600 group-hover:text-neutral-400 flex-shrink-0 transition-colors" />
                </div>

                <div className="flex items-center gap-3">
                  <span className="flex items-center gap-1.5">
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${config.dotColor}`}
                    />
                    <span className="text-xs text-neutral-500">
                      {config.label}
                    </span>
                  </span>
                  <span className="flex items-center gap-1 text-xs text-neutral-600">
                    <Clock className="w-3 h-3" />
                    {formatDate(jdItem.updated_at)}
                  </span>
                </div>
              </Link>
            );
          })}

          {/* Secondary List for My Created JDs if they are Manager/HR */}
          {myJds.length > 0 && (
            <div className="mt-6 pt-4 border-t border-neutral-800/50">
              <h2 className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-3 px-2">
                My JD Creations
              </h2>
              {myJds.map((jdItem) => {
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
                      group flex flex-col gap-1.5 px-3 py-3 rounded-lg transition-all duration-150 mb-1
                      ${
                        isJDActive
                          ? "bg-neutral-700/50 border border-neutral-600"
                          : "hover:bg-neutral-800/60 border border-transparent"
                      }
                    `}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-neutral-200 truncate">
                        {jdItem.title || "Untitled JD"}
                      </span>
                      <ChevronRight className="w-3.5 h-3.5 text-neutral-600 group-hover:text-neutral-400 flex-shrink-0 transition-colors" />
                    </div>

                    <div className="flex items-center gap-3">
                      <span className="flex items-center gap-1.5">
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${config.dotColor}`}
                        />
                        <span className="text-xs text-neutral-500">
                          {config.label}
                        </span>
                      </span>
                      <span className="flex items-center gap-1 text-xs text-neutral-600">
                        <Clock className="w-3 h-3" />
                        {formatDate(jdItem.updated_at)}
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Footer Section */}
      <div className="p-4 border-t border-neutral-800/50 space-y-2 flex flex-col">
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
  );
}
