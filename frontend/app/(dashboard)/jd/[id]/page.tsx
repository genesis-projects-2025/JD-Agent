// app/(dashboard)/jd/[id]/page.tsx

"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { fetchJD, updateJDStatus, deleteJD } from "@/lib/api";
import {
  FileText,
  Edit3,
  Send,
  ArrowLeft,
  Clock,
  Hash,
  Target,
  Users,
  Building2,
  CheckCircle2,
  Loader2,
  ShieldCheck,
  Download,
  Share2,
  AlertTriangle,
  RefreshCw,
  MessageSquare,
  Trash2,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { DeleteModal } from "@/components/ui/delete-modal";

// ── Types ─────────────────────────────────────────────────────────────────────

type JDData = {
  id: string;
  employee_id: string;
  title: string | null;
  status: string;
  version: number;
  generated_jd: string | null;
  jd_structured: Record<string, any> | null;
  responses: Record<string, any> | null;
  conversation_history: any[];
  created_at: string;
  updated_at: string;
};

// ── Status badge ──────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<
  string,
  { label: string; color: string; bg: string; icon: any }
> = {
  draft: {
    label: "Draft",
    color: "text-amber-700",
    bg: "bg-amber-50 border-amber-100",
    icon: Clock,
  },
  sent_to_manager: {
    label: "Under Review",
    color: "text-blue-700",
    bg: "bg-blue-50 border-blue-100",
    icon: ShieldCheck,
  },
  approved: {
    label: "Verified",
    color: "text-emerald-700",
    bg: "bg-emerald-50 border-emerald-100",
    icon: CheckCircle2,
  },
  rejected: {
    label: "Revisions Needed",
    color: "text-red-700",
    bg: "bg-red-50 border-red-100",
    icon: Target,
  },
  jd_generated: {
    label: "Architected",
    color: "text-primary-700",
    bg: "bg-primary-50 border-primary-100",
    icon: FileText,
  },
};

function StatusBadge({ status }: { status: string }) {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.draft;
  return (
    <span
      className={`inline-flex items-center gap-2 px-4 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest border ${config.bg} ${config.color} shadow-sm`}
    >
      <config.icon className="w-3.5 h-3.5" />
      {config.label}
    </span>
  );
}

// ── Recovery panel ─────────────────────────────────────────────────────────────
// Shown when generated_jd is null — displays conversation history + regenerate

function RecoveryPanel({
  sessionId,
  conversationHistory,
  hasInsights,
  onRegenerated,
}: {
  sessionId: string;
  conversationHistory: any[];
  hasInsights: boolean;
  onRegenerated: (jdText: string, jdStructured: any) => void;
}) {
  const router = useRouter();
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Parse a turn into readable text
  const parseMessage = (
    turn: any,
  ): { role: "user" | "assistant"; text: string } | null => {
    let text = "";
    if (turn.role === "user") {
      text = turn.content;
    } else {
      try {
        const parsed = JSON.parse(turn.content);
        text = parsed.conversation_response || turn.content;
      } catch {
        text = turn.content;
      }
    }
    if (!text?.trim()) return null;
    return { role: turn.role === "user" ? "user" : "assistant", text };
  };

  const messages = (conversationHistory || [])
    .map(parseMessage)
    .filter(Boolean) as { role: "user" | "assistant"; text: string }[];

  const handleRegenerate = async () => {
    setRegenerating(true);
    setError(null);
    try {
      // Generate JD from saved insights
      const genRes = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/jd/generate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: sessionId }),
        },
      );
      if (!genRes.ok) {
        const err = await genRes.json();
        throw new Error(err.detail || "Generation failed");
      }
      const data = await genRes.json();

      // Auto-save immediately so it's never lost again
      await fetch(`${process.env.NEXT_PUBLIC_API_URL}/jd/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: sessionId,
          jd_text: data.jd_text,
          jd_structured: data.jd_structured,
        }),
      });

      onRegenerated(data.jd_text, data.jd_structured);
    } catch (err: any) {
      setError(err.message || "Something went wrong. Please try again.");
    } finally {
      setRegenerating(false);
    }
  };

  return (
    <div className="min-h-[500px] flex flex-col gap-8">
      {/* Warning banner + actions */}
      <div className="flex items-start gap-4 p-6 bg-amber-50 border border-amber-200 rounded-2xl">
        <div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5">
          <AlertTriangle className="w-5 h-5 text-amber-600" />
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-black text-amber-900 mb-1">
            JD Was Not Saved
          </h3>
          <p className="text-[13px] text-amber-700 leading-relaxed mb-4">
            {hasInsights
              ? "Your interview is complete and your answers are preserved. The JD was generated but you left before saving it. Re-generate it below — it will be saved automatically this time."
              : "Your interview conversation is below but the JD was never generated. Go back to complete the interview and generate your JD."}
          </p>

          {error && (
            <p className="text-[12px] text-red-600 font-semibold mb-3">
              {error}
            </p>
          )}

          <div className="flex flex-wrap gap-3">
            {hasInsights && (
              <button
                onClick={handleRegenerate}
                disabled={regenerating}
                className="flex items-center gap-2 px-5 py-2.5 bg-primary-600 text-white text-[13px] font-bold rounded-xl hover:bg-primary-700 transition-all shadow-lg shadow-primary-500/20 active:scale-[0.98] disabled:opacity-60"
              >
                {regenerating ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <RefreshCw className="w-4 h-4" />
                )}
                {regenerating ? "Re-generating JD..." : "Re-generate My JD"}
              </button>
            )}
            <button
              onClick={() => router.push(`/questionnaire/${sessionId}`)}
              className="flex items-center gap-2 px-5 py-2.5 bg-white text-surface-700 border border-surface-200 text-[13px] font-bold rounded-xl hover:bg-surface-50 transition-all"
            >
              <MessageSquare className="w-4 h-4" />
              {hasInsights ? "Back to Chat" : "Continue Interview"}
            </button>
          </div>
        </div>
      </div>

      {/* Conversation history */}
      {messages.length > 0 && (
        <div>
          <div className="flex items-center gap-3 mb-5">
            <div className="w-1 h-5 bg-primary-400 rounded-full" />
            <h4 className="text-[11px] font-black text-surface-400 uppercase tracking-widest">
              Your Interview Conversation
            </h4>
            <span className="text-[10px] font-bold px-2 py-0.5 bg-surface-100 text-surface-500 rounded-full">
              {messages.length} messages
            </span>
          </div>

          <div className="space-y-4">
            {messages.map((msg, i) => (
              <div
                key={i}
                className={`flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}
              >
                {/* Avatar */}
                <div
                  className={`w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center text-[10px] font-black mt-1
                  ${
                    msg.role === "user"
                      ? "bg-primary-100 text-primary-700"
                      : "bg-surface-100 text-surface-500"
                  }`}
                >
                  {msg.role === "user" ? "You" : "AI"}
                </div>

                {/* Bubble */}
                <div
                  className={`max-w-[80%] px-4 py-3 rounded-2xl text-[13px] leading-relaxed font-medium
                  ${
                    msg.role === "user"
                      ? "bg-primary-600 text-white rounded-tr-sm"
                      : "bg-surface-50 text-surface-800 border border-surface-100 rounded-tl-sm"
                  }`}
                >
                  {msg.text}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* No history at all */}
      {messages.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-14 h-14 bg-surface-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <MessageSquare className="w-7 h-7 text-surface-300" />
          </div>
          <p className="text-surface-400 text-sm font-medium">
            No conversation history found.
          </p>
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function JDViewPage() {
  const params = useParams();
  const router = useRouter();
  const jdId = params.id as string;

  const [jd, setJd] = useState<JDData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sendingToManager, setSending] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        const data = await fetchJD(jdId);
        setJd(data);
      } catch (err: any) {
        setError(err?.response?.data?.detail || "Failed to load JD");
      } finally {
        setLoading(false);
      }
    }
    if (jdId) load();
  }, [jdId]);

  // After successful re-generation, update state in-place
  const handleRegenerated = (jdText: string, jdStructured: any) => {
    setJd((prev) =>
      prev
        ? {
            ...prev,
            generated_jd: jdText,
            jd_structured: jdStructured,
            status: "jd_generated",
          }
        : prev,
    );
  };

  const handleSendToManager = async () => {
    if (!jd) return;
    setSending(true);
    try {
      await updateJDStatus(jdId, {
        status: "sent_to_manager",
        employee_id: jd.employee_id,
      });
      setJd((prev) => (prev ? { ...prev, status: "sent_to_manager" } : prev));
    } catch (err: any) {
      alert(err?.response?.data?.detail || "Status sync failure");
    } finally {
      setSending(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!jd) return;
    setIsDeleting(true);
    try {
      await deleteJD(jdId, jd.employee_id);
      router.push(`/dashboard/${jd.employee_id}`);
    } catch (err: any) {
      alert(err?.message || "Failed to delete JD");
      setIsDeleting(false);
      setShowDeleteModal(false);
    }
  };

  // ── Loading ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="h-[calc(100vh-8rem)] flex items-center justify-center">
        <div className="text-center group">
          <div className="relative mb-4">
            <div className="absolute inset-0 bg-primary-100 rounded-full animate-ping opacity-20 scale-150" />
            <Loader2 className="w-10 h-10 text-primary-600 animate-spin mx-auto relative z-10" />
          </div>
          <p className="text-sm font-bold text-surface-400 uppercase tracking-widest">
            Synthesizing Document...
          </p>
        </div>
      </div>
    );
  }

  // ── Error ─────────────────────────────────────────────────────────────────
  if (error || !jd) {
    return (
      <div className="h-[calc(100vh-8rem)] flex items-center justify-center">
        <div className="text-center max-w-md p-8 bg-white rounded-3xl border border-surface-200 shadow-premium">
          <div className="w-16 h-16 bg-red-50 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <ShieldCheck className="w-8 h-8 text-red-500" />
          </div>
          <h2 className="text-2xl font-black text-surface-900 mb-2 tracking-tight">
            Asset Unauthorized
          </h2>
          <p className="text-surface-500 mb-8 font-medium">
            {error ||
              "The requested JD architecture is unavailable or access has been restricted."}
          </p>
          <button
            onClick={() => {
              const fallbackId = localStorage.getItem("employee_id");
              router.push(fallbackId ? `/dashboard/${fallbackId}` : "/");
            }}
            className="w-full py-4 bg-primary-600 text-white rounded-2xl font-bold hover:bg-primary-700 transition-all shadow-xl shadow-primary-500/10"
          >
            Return to Command Center
          </button>
        </div>
      </div>
    );
  }

  const s = jd.jd_structured || {};
  const displayTitle =
    jd.title ||
    s?.employee_information?.job_title ||
    s?.employee_information?.title ||
    "Strategic Role Specification";
  const hasJD = !!jd.generated_jd;
  const hasInsights = !!(jd.responses && Object.keys(jd.responses).length > 0);

  return (
    <div className="h-full flex flex-col bg-surface-50 overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 bg-white border-b border-surface-200 relative z-30">
        <div className="max-w-5xl mx-auto px-8 py-5">
          <div className="flex items-center justify-between">
            <button
              onClick={() => router.push(`/dashboard/${jd.employee_id}`)}
              className="group flex items-center gap-2.5 text-surface-400 hover:text-primary-600 transition-all font-black text-[10px] uppercase tracking-widest"
            >
              <div className="w-8 h-8 rounded-lg bg-surface-50 flex items-center justify-center group-hover:bg-primary-50 transition-colors">
                <ArrowLeft className="w-4 h-4" />
              </div>
              Return to Insights
            </button>
            <div className="flex items-center gap-4">
              <button
                onClick={() => setShowDeleteModal(true)}
                disabled={isDeleting}
                title="Delete JD"
                className="p-2 text-surface-400 hover:text-red-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isDeleting ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <Trash2 className="w-5 h-5" />
                )}
              </button>
              <button className="p-2 text-surface-400 hover:text-primary-600 transition-colors">
                <Download className="w-5 h-5" />
              </button>
              <button className="p-2 text-surface-400 hover:text-primary-600 transition-colors">
                <Share2 className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Main */}
      <div className="flex-1 overflow-y-auto pt-10 pb-20 px-4 md:px-8">
        <div className="max-w-4xl mx-auto">
          {/* Title + Actions */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-10">
            <div>
              <h2 className="text-[10px] font-black text-primary-600 uppercase tracking-[0.3em] mb-3 flex items-center gap-2">
                <ShieldCheck className="w-4 h-4" />
                Verified Document Output
              </h2>
              <h1 className="text-4xl font-black text-surface-900 tracking-tight leading-tight">
                {displayTitle}
              </h1>
              <div className="flex items-center gap-6 mt-4">
                <StatusBadge status={jd.status} />
                <div className="flex items-center gap-2 text-[10px] font-bold text-surface-400 uppercase tracking-widest">
                  <Hash className="w-3.5 h-3.5" />
                  REV {jd.version}.0
                </div>
                <div className="flex items-center gap-2 text-[10px] font-bold text-surface-400 uppercase tracking-widest">
                  <Clock className="w-3.5 h-3.5" />
                  STAMPED:{" "}
                  {jd.updated_at
                    ? new Date(jd.updated_at).toLocaleDateString()
                    : "PENDING"}
                </div>
              </div>
            </div>

            {/* Only show submit/refine buttons when JD exists */}
            {hasJD && (
              <div className="flex gap-3 flex-shrink-0">
                <button
                  onClick={() => router.push(`/jd/${jdId}/edit`)}
                  className="px-6 py-3.5 bg-white text-surface-700 border border-surface-200 rounded-2xl text-[14px] font-bold hover:bg-surface-50 transition-all shadow-sm active:scale-[0.98] flex items-center gap-2"
                >
                  <Edit3 className="w-4 h-4" />
                  Refine Section
                </button>
                <button
                  onClick={handleSendToManager}
                  disabled={
                    sendingToManager ||
                    jd.status === "sent_to_manager" ||
                    jd.status === "approved"
                  }
                  className={`px-8 py-3.5 rounded-2xl text-[14px] font-bold transition-all flex items-center gap-3 shadow-xl active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed
                    ${
                      jd.status === "sent_to_manager" ||
                      jd.status === "approved"
                        ? "bg-accent-50 text-accent-700 border border-accent-100 shadow-none"
                        : "bg-primary-600 text-white hover:bg-primary-700 shadow-primary-500/20"
                    }`}
                >
                  {sendingToManager ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : jd.status === "sent_to_manager" ? (
                    <CheckCircle2 className="w-4 h-4" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                  {jd.status === "sent_to_manager"
                    ? "Asset Released"
                    : jd.status === "approved"
                      ? "Finalized"
                      : "Submit for Approval"}
                </button>
              </div>
            )}
          </div>

          {/* Document card */}
          <div className="bg-white rounded-[40px] p-8 md:p-16 border border-surface-200 shadow-premium relative overflow-hidden">
            <div className="absolute top-0 right-0 p-12 opacity-[0.03] pointer-events-none">
              <Building2 className="w-64 h-64" />
            </div>

            <div className="relative z-10">
              {hasJD ? (
                // ── Normal render ─────────────────────────────────────────
                <div className="prose prose-neutral max-w-none prose-headings:font-bold prose-headings:text-neutral-900 prose-p:text-neutral-800 prose-li:text-neutral-800 prose-strong:text-blue-700 min-h-[500px]">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {jd.generated_jd!}
                  </ReactMarkdown>
                </div>
              ) : (
                // ── Recovery: show conversation + regenerate ──────────────
                <RecoveryPanel
                  sessionId={jd.id}
                  conversationHistory={jd.conversation_history ?? []}
                  hasInsights={hasInsights}
                  onRegenerated={handleRegenerated}
                />
              )}
            </div>

            {/* Footer — only shown when JD content exists */}
            {hasJD && (
              <div className="mt-24 pt-10 border-t border-surface-100 flex items-center justify-between opacity-40">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-surface-900 rounded-lg flex items-center justify-center">
                    <ShieldCheck className="w-4 h-4 text-white" />
                  </div>
                  <span className="text-[9px] font-black uppercase tracking-[0.2em]">
                    Pulse Pharma Intelligence
                  </span>
                </div>
                <span className="text-[9px] font-bold uppercase tracking-widest">
                  Confidential • Generated Internal Record
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      <DeleteModal
        isOpen={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        onConfirm={handleConfirmDelete}
        isDeleting={isDeleting}
      />
    </div>
  );
}
