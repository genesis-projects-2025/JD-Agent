// components/session/ContinueSessionBanner.tsx
// Fetches the employee's session history DIRECTLY from the DB — no localStorage

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getOrCreateEmployeeId } from "@/lib/auth";
import {
  Clock,
  MessageSquare,
  ChevronRight,
  Loader2,
  RotateCcw,
  Sparkles,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import { fetchEmployeeJDs } from "@/lib/api";

type SessionRecord = {
  id: string;
  employee_id: string;
  title: string | null;
  status: string;
  version: number;
  created_at: string;
  updated_at: string;
};

const STATUS_META: Record<
  string,
  { label: string; dot: string; action: string }
> = {
  collecting: {
    label: "In Progress",
    dot: "bg-amber-400",
    action: "Resume Interview",
  },
  ready_for_generation: {
    label: "Ready to Generate JD",
    dot: "bg-blue-500",
    action: "Resume & Generate",
  },
  jd_generated: {
    label: "JD Generated",
    dot: "bg-emerald-500",
    action: "View JD",
  },
  sent_to_manager: {
    label: "Sent for Review",
    dot: "bg-purple-500",
    action: "View JD",
  },
  approved: { label: "Approved", dot: "bg-emerald-600", action: "View JD" },
  draft: { label: "Draft", dot: "bg-neutral-400", action: "Resume" },
};

function timeAgo(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

function SessionCard({
  session,
  onResume,
  isResuming,
}: {
  session: SessionRecord;
  onResume: (s: SessionRecord) => void;
  isResuming: boolean;
}) {
  const meta = STATUS_META[session.status] ?? STATUS_META.draft;
  const isJDDone = ["jd_generated", "sent_to_manager", "approved"].includes(
    session.status,
  );

  return (
    <div className="flex items-center gap-4 px-5 py-4 bg-white rounded-2xl border border-neutral-200 hover:border-blue-300 hover:shadow-sm transition-all duration-200">
      <div className="flex-shrink-0">
        <div className={`w-2.5 h-2.5 rounded-full ${meta.dot}`} />
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-xs sm:text-sm font-bold text-neutral-800 truncate">
          {session.title || "Untitled Interview"}
        </p>
        <div className="flex flex-wrap items-center gap-1 sm:gap-3 mt-0.5">
          <span className="text-[10px] sm:text-[11px] font-semibold text-neutral-400">
            {meta.label}
          </span>
          <span className="text-neutral-200 hidden sm:inline">•</span>
          <span className="flex items-center gap-1 text-[9px] sm:text-[11px] text-neutral-400 w-full sm:w-auto">
            <Clock className="w-3 h-3" />
            {timeAgo(session.updated_at)}
          </span>
        </div>
      </div>

      <button
        onClick={() => onResume(session)}
        disabled={isResuming}
        className="flex-shrink-0 flex items-center justify-center gap-1.5 p-2 sm:px-4 sm:py-2 rounded-xl text-[12px] font-bold transition-all active:scale-95 disabled:opacity-60 bg-blue-50 text-blue-700 border border-blue-100 hover:bg-blue-600 hover:text-white hover:border-blue-600 hover:shadow-md"
      >
        {isResuming ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : isJDDone ? (
          <Sparkles className="w-3.5 h-3.5" />
        ) : (
          <RotateCcw className="w-3.5 h-3.5" />
        )}
        <span className="hidden sm:inline">{meta.action}</span>
        <ChevronRight className="w-3 h-3 opacity-60 hidden sm:block" />
      </button>
    </div>
  );
}

export default function ContinueSessionBanner() {
  const router = useRouter();
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [resumingId, setResumingId] = useState<string | null>(null);

  const fetchSessions = async () => {
    setLoading(true);
    setError(false);
    try {
      const employeeId = getOrCreateEmployeeId();
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/jd/employee/${employeeId}`,
      );
      if (!res.ok) throw new Error();
      const data: SessionRecord[] = await fetchEmployeeJDs(employeeId);
      setSessions(
        data.sort(
          (a, b) =>
            new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
        ),
      );
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSessions();
  }, []);

  const handleResume = (session: SessionRecord) => {
    setResumingId(session.id);
    const isJDDone = ["jd_generated", "sent_to_manager", "approved"].includes(
      session.status,
    );
    router.push(
      isJDDone ? `/jd/${session.id}` : `/questionnaire/${session.id}`,
    );
  };

  // Loading skeleton
  if (loading)
    return (
      <div className="w-full max-w-md mx-auto mb-6">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-4 h-4 rounded-full bg-neutral-200 animate-pulse" />
          <div className="w-40 h-3 rounded bg-neutral-200 animate-pulse" />
        </div>
        <div className="space-y-2">
          {[1, 2].map((i) => (
            <div
              key={i}
              className="h-[68px] bg-neutral-100 rounded-2xl animate-pulse"
            />
          ))}
        </div>
      </div>
    );

  // Error
  if (error)
    return (
      <div className="w-full max-w-md mx-auto mb-6 px-4 py-3 bg-red-50 border border-red-100 rounded-2xl flex items-center justify-between">
        <div className="flex items-center gap-2 text-red-600 text-sm font-medium">
          <AlertCircle className="w-4 h-4" />
          Couldn't load your previous sessions
        </div>
        <button
          onClick={fetchSessions}
          className="flex items-center gap-1 text-[11px] font-bold text-red-700"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Retry
        </button>
      </div>
    );

  // No sessions yet
  if (sessions.length === 0) return null;

  const visible = expanded ? sessions : sessions.slice(0, 2);

  return (
    <div className="w-full max-w-md mx-auto mb-6">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-3.5 h-3.5 text-blue-600" />
          <span className="text-[11px] font-black text-neutral-500 uppercase tracking-widest">
            Your previous sessions
          </span>
          <span className="text-[10px] font-bold px-1.5 py-0.5 bg-neutral-100 text-neutral-500 rounded-full">
            {sessions.length}
          </span>
        </div>
        {sessions.length > 2 && (
          <button
            onClick={() => setExpanded((e) => !e)}
            className="text-[11px] font-bold text-blue-600 hover:text-blue-800"
          >
            {expanded ? "Show less" : `Show all ${sessions.length}`}
          </button>
        )}
      </div>

      <div className="space-y-2">
        {visible.map((session) => (
          <SessionCard
            key={session.id}
            session={session}
            onResume={handleResume}
            isResuming={resumingId === session.id}
          />
        ))}
      </div>

      <div className="flex items-center gap-3 mt-5 mb-1">
        <div className="flex-1 h-px bg-neutral-200" />
        <span className="text-[10px] font-bold text-neutral-400 uppercase tracking-widest">
          or start new
        </span>
        <div className="flex-1 h-px bg-neutral-200" />
      </div>
    </div>
  );
}
