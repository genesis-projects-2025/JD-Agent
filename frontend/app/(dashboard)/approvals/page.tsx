"use client";

import { Check, HelpCircle, LucideIcon, X } from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import {
  CheckCircle2,
  XCircle,
  Clock,
  Search,
  Filter,
  ChevronDown,
  ChevronUp,
  MessageSquare,
  User,
  Calendar,
  Tag,
  Loader2,
  FileText,
  RotateCcw,
  CheckCheck,
  AlertCircle,
  ArrowLeft,
} from "lucide-react";
import { getJDs, approveJD, rejectJD } from "@/lib/api";
import { JDRecord, JDStatus } from "@/types/jd";
import { exportJDToPDF } from "@/lib/pdf-export";

/* ── Helpers ─────────────────────────────────────────────────────── */

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const STATUS_TABS: { key: JDStatus | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "pending", label: "Pending Review" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Needs Revision" },
  { key: "in_progress", label: "In Progress" },
];
type StatusConfig = {
  icon: LucideIcon;
  bg: string;
  text: string;
  label: string;
};

const statusConfig: Partial<Record<JDStatus, StatusConfig>> & {
  default: StatusConfig;
} = {
  pending: {
    icon: Clock,
    bg: "bg-yellow-100",
    text: "text-yellow-800",
    label: "Pending",
  },
  approved: {
    icon: Check,
    bg: "bg-green-100",
    text: "text-green-800",
    label: "Approved",
  },
  rejected: {
    icon: X,
    bg: "bg-red-100",
    text: "text-red-800",
    label: "Rejected",
  },

  // ⭐ fallback for unknown statuses
  default: {
    icon: HelpCircle,
    bg: "bg-gray-100",
    text: "text-gray-800",
    label: "Unknown",
  },
};

/* ── Reject Modal ────────────────────────────────────────────────── */

function RejectModal({
  jd,
  onConfirm,
  onCancel,
}: {
  jd: JDRecord;
  onConfirm: (comment: string) => void;
  onCancel: () => void;
}) {
  const [comment, setComment] = useState("");
  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl border border-neutral-200 w-full max-w-md animate-in fade-in zoom-in-95 duration-200">
        <div className="p-6 border-b border-neutral-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-rose-50 rounded-xl flex items-center justify-center">
              <XCircle className="w-5 h-5 text-rose-600" />
            </div>
            <div>
              <h3 className="font-semibold text-neutral-900">
                Return for Revision
              </h3>
              <p className="text-sm text-neutral-500">
                {jd.role_title} — {jd.employee_name}
              </p>
            </div>
          </div>
        </div>
        <div className="p-6 space-y-4">
          <label className="block">
            <span className="text-sm font-medium text-neutral-700 mb-2 block">
              Feedback for employee <span className="text-rose-500">*</span>
            </span>
            <textarea
              autoFocus
              rows={4}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Explain what needs to be revised or clarified..."
              className="w-full px-4 py-3 text-sm border border-neutral-200 rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-rose-500 focus:border-transparent transition-all text-neutral-800 placeholder:text-neutral-400"
            />
          </label>
          <div className="flex gap-3">
            <button
              onClick={onCancel}
              className="flex-1 py-2.5 border border-neutral-200 text-neutral-700 rounded-xl text-sm font-medium hover:bg-neutral-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => onConfirm(comment)}
              disabled={!comment.trim()}
              className="flex-1 py-2.5 bg-rose-600 text-white rounded-xl text-sm font-semibold hover:bg-rose-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Return JD
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── JD Detail Panel ─────────────────────────────────────────────── */

function JDDetailPanel({
  jd,
  onApprove,
  onReject,
  onClose,
  isActing,
}: {
  jd: JDRecord;
  onApprove: () => void;
  onReject: () => void;
  onClose: () => void;
  isActing: boolean;
}) {
  const DefaultIcon = HelpCircle;

  const sc = statusConfig[jd?.status] ?? statusConfig.default;

  const StatusIcon = sc.icon ?? DefaultIcon;
  const skills: string[] = jd.jd_structured?.required_skills ?? [];

  return (
    <div className="flex-1 flex flex-col bg-white rounded-2xl border border-neutral-200 shadow-sm overflow-hidden">
      {/* Detail Header */}
      <div className="flex-shrink-0 px-6 py-5 border-b border-neutral-100 flex items-center justify-between">
        <button
          onClick={onClose}
          className="flex items-center gap-2 text-sm text-neutral-500 hover:text-neutral-800 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to list
        </button>
        <button
          onClick={() => exportJDToPDF(jd.jd_text, jd.role_title)}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-neutral-600 bg-neutral-50 border border-neutral-200 rounded-xl hover:bg-neutral-100 transition-colors"
        >
          <FileText className="w-4 h-4" />
          Export PDF
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Meta block */}
        <div className="px-6 py-5 border-b border-neutral-100 space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-bold text-neutral-900">
                {jd.role_title}
              </h2>
              <div className="flex items-center gap-2 mt-1 text-sm text-neutral-500">
                <User className="w-3.5 h-3.5" />
                {jd.employee_name}
                <span className="text-neutral-200">·</span>
                <Tag className="w-3.5 h-3.5" />
                {jd.department}
              </div>
            </div>
            <span
              className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full flex-shrink-0 ${sc.bg} ${sc.text}`}
            >
              <StatusIcon className="w-3.5 h-3.5" />
              {sc.label}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="bg-neutral-50 rounded-xl p-3">
              <div className="text-xs text-neutral-400 mb-0.5">Created</div>
              <div className="text-sm font-medium text-neutral-700">
                {formatDate(jd.created_at)}
              </div>
            </div>
            <div className="bg-neutral-50 rounded-xl p-3">
              <div className="text-xs text-neutral-400 mb-0.5">
                Last updated
              </div>
              <div className="text-sm font-medium text-neutral-700">
                {timeAgo(jd.updated_at)}
              </div>
            </div>
          </div>

          {skills.length > 0 && (
            <div>
              <div className="text-xs text-neutral-400 mb-2">
                Required Skills
              </div>
              <div className="flex flex-wrap gap-1.5">
                {skills.map((s) => (
                  <span
                    key={s}
                    className="px-2.5 py-1 bg-blue-50 text-blue-700 text-xs font-medium rounded-full"
                  >
                    {s}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Completion bar */}
          <div>
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className="text-neutral-400">Completion</span>
              <span className="font-medium text-neutral-600">
                {jd.completion_percentage}%
              </span>
            </div>
            <div className="h-1.5 bg-neutral-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 rounded-full transition-all duration-700"
                style={{ width: `${jd.completion_percentage}%` }}
              />
            </div>
          </div>
        </div>

        {/* Rejection feedback */}
        {jd.status === "rejected" && jd.reviewer_comment && (
          <div className="mx-6 my-4 p-4 bg-rose-50 border border-rose-200 rounded-xl">
            <div className="flex items-center gap-2 text-rose-700 font-semibold text-sm mb-2">
              <MessageSquare className="w-4 h-4" />
              HR Feedback
            </div>
            <p className="text-sm text-rose-700 leading-relaxed">
              {jd.reviewer_comment}
            </p>
            {jd.reviewed_at && (
              <p className="text-xs text-rose-400 mt-2">
                {timeAgo(jd.reviewed_at)} by {jd.reviewed_by}
              </p>
            )}
          </div>
        )}

        {/* Approval note */}
        {jd.status === "approved" && jd.reviewed_at && (
          <div className="mx-6 my-4 p-4 bg-emerald-50 border border-emerald-200 rounded-xl">
            <div className="flex items-center gap-2 text-emerald-700 font-semibold text-sm">
              <CheckCheck className="w-4 h-4" />
              Approved {timeAgo(jd.reviewed_at)} by {jd.reviewed_by}
            </div>
          </div>
        )}

        {/* JD Text */}
        {jd.jd_text ? (
          <div className="px-6 pb-6">
            <div className="text-xs text-neutral-400 mb-3 mt-2">
              Job Description Content
            </div>
            <div className="bg-neutral-50 rounded-2xl p-6 border border-neutral-200">
              <pre className="whitespace-pre-wrap font-sans text-sm text-neutral-700 leading-relaxed">
                {jd.jd_text}
              </pre>
            </div>
          </div>
        ) : (
          <div className="px-6 py-8 text-center text-neutral-400 text-sm">
            Interview still in progress — JD not yet generated.
          </div>
        )}
      </div>

      {/* Action Footer */}
      {jd.status === "pending" && (
        <div className="flex-shrink-0 px-6 py-4 border-t border-neutral-100 bg-white flex gap-3">
          <button
            onClick={onReject}
            disabled={isActing}
            className="flex-1 py-3 border-2 border-rose-200 text-rose-600 rounded-xl text-sm font-semibold hover:bg-rose-50 transition-colors disabled:opacity-40 flex items-center justify-center gap-2"
          >
            <XCircle className="w-4 h-4" />
            Return for Revision
          </button>
          <button
            onClick={onApprove}
            disabled={isActing}
            className="flex-1 py-3 bg-emerald-600 text-white rounded-xl text-sm font-bold hover:bg-emerald-700 transition-colors disabled:opacity-40 shadow-lg shadow-emerald-900/20 flex items-center justify-center gap-2"
          >
            {isActing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <CheckCircle2 className="w-4 h-4" />
            )}
            Approve JD
          </button>
        </div>
      )}
    </div>
  );
}

/* ── JD Card ─────────────────────────────────────────────────────── */

function JDCard({
  jd,
  selected,
  onSelect,
}: {
  jd: JDRecord;
  selected: boolean;
  onSelect: () => void;
}) {
  const DefaultIcon = HelpCircle;

  const sc = statusConfig[jd?.status] ?? statusConfig.default;

  const StatusIcon = sc.icon ?? DefaultIcon;
  const skills: string[] = jd.jd_structured?.required_skills ?? [];

  return (
    <button
      onClick={onSelect}
      className={`w-full text-left p-4 rounded-xl border transition-all ${
        selected
          ? "border-blue-500 bg-blue-50/50 shadow-sm"
          : "border-neutral-200 bg-white hover:border-neutral-300 hover:shadow-sm"
      }`}
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm text-neutral-900 truncate">
            {jd.role_title}
          </div>
          <div className="text-xs text-neutral-500 mt-0.5">
            {jd.employee_name} · {jd.department}
          </div>
        </div>
        <span
          className={`flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-full flex-shrink-0 ${sc.bg} ${sc.text}`}
        >
          <StatusIcon className="w-3 h-3" />
          {sc.label}
        </span>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs text-neutral-400">
          <Calendar className="w-3 h-3" />
          {timeAgo(jd.updated_at)}
        </div>
        <div className="flex items-center gap-1.5 w-20">
          <div className="flex-1 h-1 bg-neutral-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-400 rounded-full"
              style={{ width: `${jd.completion_percentage}%` }}
            />
          </div>
          <span className="text-[10px] text-neutral-400">
            {jd.completion_percentage}%
          </span>
        </div>
      </div>
    </button>
  );
}

/* ── Page ────────────────────────────────────────────────────────── */

export default function ApprovalsPage() {
  const [jds, setJds] = useState<JDRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<JDStatus | "all">("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<JDRecord | null>(null);
  const [isActing, setIsActing] = useState(false);

  useEffect(() => {
    getJDs().then((data) => {
      setJds(data);
      const firstPending = data.find((d: any) => d.status === "pending");
      if (firstPending) setSelectedId(firstPending.id);
      setLoading(false);
    });
  }, []);

  const filtered = jds.filter((jd) => {
    const matchesTab = activeTab === "all" || jd.status === activeTab;
    const q = search.toLowerCase();
    const matchesSearch =
      !q ||
      jd.employee_name.toLowerCase().includes(q) ||
      jd.role_title.toLowerCase().includes(q) ||
      jd.department.toLowerCase().includes(q);
    return matchesTab && matchesSearch;
  });

  const selectedJD = jds.find((j) => j.id === selectedId) ?? null;

  const pendingCount = jds.filter((j) => j.status === "pending").length;

  const handleApprove = useCallback(async () => {
    if (!selectedId) return;
    setIsActing(true);
    await approveJD(selectedId);
    setJds((prev) =>
      prev.map((j) =>
        j.id === selectedId
          ? {
              ...j,
              status: "approved",
              reviewed_by: "You",
              reviewed_at: new Date().toISOString(),
            }
          : j,
      ),
    );
    setIsActing(false);
  }, [selectedId]);

  const handleRejectConfirm = useCallback(
    async (comment: string) => {
      if (!rejectTarget) return;
      setIsActing(true);
      await rejectJD(rejectTarget.id, comment);
      setJds((prev) =>
        prev.map((j) =>
          j.id === rejectTarget.id
            ? {
                ...j,
                status: "rejected",
                reviewer_comment: comment,
                reviewed_by: "You",
                reviewed_at: new Date().toISOString(),
              }
            : j,
        ),
      );
      setRejectTarget(null);
      setIsActing(false);
    },
    [rejectTarget],
  );

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Page Header */}
      <div className="flex-shrink-0 mb-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-neutral-900">
              JD Approvals
            </h1>
            <p className="text-sm text-neutral-500 mt-0.5">
              Review, approve, or return Job Descriptions for revision
            </p>
          </div>
          {pendingCount > 0 && (
            <div className="flex items-center gap-2 px-4 py-2 bg-amber-50 border border-amber-200 rounded-xl">
              <Clock className="w-4 h-4 text-amber-600" />
              <span className="text-sm font-semibold text-amber-700">
                {pendingCount} pending{" "}
                {pendingCount === 1 ? "review" : "reviews"}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Main Layout */}
      <div className="flex-1 min-h-0 flex gap-4">
        {/* Left: List Panel */}
        <div className="w-80 flex-shrink-0 flex flex-col bg-white rounded-2xl border border-neutral-200 shadow-sm overflow-hidden">
          {/* Search */}
          <div className="flex-shrink-0 p-3 border-b border-neutral-100">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search JDs..."
                className="w-full pl-9 pr-4 py-2.5 text-sm bg-neutral-50 border border-neutral-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all text-neutral-700 placeholder:text-neutral-400"
              />
            </div>
          </div>

          {/* Tabs */}
          <div className="flex-shrink-0 px-2 py-2 border-b border-neutral-100 space-y-0.5">
            {STATUS_TABS.map((tab) => {
              const count =
                tab.key === "all"
                  ? jds.length
                  : jds.filter((j) => j.status === tab.key).length;
              return (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    activeTab === tab.key
                      ? "bg-blue-50 text-blue-700"
                      : "text-neutral-600 hover:bg-neutral-50"
                  }`}
                >
                  <span>{tab.label}</span>
                  <span
                    className={`text-xs px-1.5 py-0.5 rounded-full ${
                      activeTab === tab.key
                        ? "bg-blue-100 text-blue-700"
                        : "bg-neutral-100 text-neutral-500"
                    }`}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* JD List */}
          <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
            {loading ? (
              [...Array(4)].map((_, i) => (
                <div
                  key={i}
                  className="h-20 bg-neutral-100 rounded-xl animate-pulse"
                />
              ))
            ) : filtered.length === 0 ? (
              <div className="text-center py-12 text-sm text-neutral-400">
                No JDs match your filters
              </div>
            ) : (
              filtered.map((jd) => (
                <JDCard
                  key={jd.id}
                  jd={jd}
                  selected={jd.id === selectedId}
                  onSelect={() => setSelectedId(jd.id)}
                />
              ))
            )}
          </div>
        </div>

        {/* Right: Detail Panel */}
        {selectedJD ? (
          <JDDetailPanel
            jd={selectedJD}
            onApprove={handleApprove}
            onReject={() => setRejectTarget(selectedJD)}
            onClose={() => setSelectedId(null)}
            isActing={isActing}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center bg-white rounded-2xl border border-neutral-200 shadow-sm">
            <div className="text-center">
              <div className="w-16 h-16 bg-neutral-100 rounded-2xl flex items-center justify-center mx-auto mb-3">
                <FileText className="w-8 h-8 text-neutral-300" />
              </div>
              <p className="text-neutral-500 font-medium">
                Select a JD to review
              </p>
              <p className="text-sm text-neutral-400 mt-1">
                Choose from the list on the left
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Reject Modal */}
      {rejectTarget && (
        <RejectModal
          jd={rejectTarget}
          onConfirm={handleRejectConfirm}
          onCancel={() => setRejectTarget(null)}
        />
      )}
    </div>
  );
}
