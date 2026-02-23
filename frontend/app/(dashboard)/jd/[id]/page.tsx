// app/(dashboard)/jd/[id]/page.tsx - ENTERPRISE REDESIGN

"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { fetchJD, updateJDStatus } from "@/lib/api";
import {
  FileText,
  Edit3,
  Send,
  ArrowLeft,
  Clock,
  Hash,
  Briefcase,
  Target,
  Wrench,
  Users,
  BarChart3,
  Building2,
  Star,
  CheckCircle2,
  Loader2,
  ShieldCheck,
  Download,
  Share2,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type JDData = {
  id: string;
  employee_id: string;
  title: string | null;
  status: string;
  version: number;
  generated_jd: string | null;
  jd_structured: Record<string, any> | null;
  created_at: string;
  updated_at: string;
};

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

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: any;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="group pb-10 last:pb-0 border-b border-surface-50 last:border-0">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 bg-surface-50 rounded-xl flex items-center justify-center border border-surface-100 group-hover:bg-primary-50 group-hover:border-primary-100 transition-colors">
          <Icon className="w-5 h-5 text-surface-400 group-hover:text-primary-600 transition-colors" />
        </div>
        <h3 className="text-sm font-black text-surface-400 uppercase tracking-[0.2em]">
          {title}
        </h3>
      </div>
      <div className="pl-0 md:pl-13">{children}</div>
    </section>
  );
}

function ListItems({ items }: { items: string[] }) {
  if (!items || items.length === 0) return null;
  return (
    <ul className="space-y-4">
      {items.map((item, i) => (
        <li
          key={i}
          className="flex items-start gap-4 text-[15px] text-surface-700 group/item"
        >
          <div className="mt-2 w-1.5 h-1.5 rounded-full bg-primary-300 group-hover/item:bg-primary-600 transition-colors flex-shrink-0" />
          <span className="leading-relaxed font-medium">{item}</span>
        </li>
      ))}
    </ul>
  );
}

function DictDisplay({ data }: { data: Record<string, any> | string }) {
  if (!data || (typeof data === "object" && Object.keys(data).length === 0)) {
    return null;
  }
  if (typeof data === "string") {
    return (
      <p className="text-[15px] text-surface-700 leading-relaxed font-medium italic">
        {data}
      </p>
    );
  }
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-6">
      {Object.entries(data).map(([key, value]) => (
        <div key={key}>
          <dt className="text-[10px] font-black text-surface-400 uppercase tracking-widest mb-2">
            {key.replace(/_/g, " ")}
          </dt>
          <dd className="text-[15px] text-surface-900 leading-relaxed font-bold">
            {typeof value === "object"
              ? JSON.stringify(value, null, 2)
              : String(value)}
          </dd>
        </div>
      ))}
    </div>
  );
}

export default function JDViewPage() {
  const params = useParams();
  const router = useRouter();
  const jdId = params.id as string;

  const [jd, setJd] = useState<JDData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sendingToManager, setSendingToManager] = useState(false);

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

  const handleSendToManager = async () => {
    if (!jd) return;
    setSendingToManager(true);
    try {
      await updateJDStatus(jdId, {
        status: "sent_to_manager",
        employee_id: jd.employee_id,
      });
      setJd((prev) => (prev ? { ...prev, status: "sent_to_manager" } : prev));
    } catch (err: any) {
      alert(err?.response?.data?.detail || "Status sync failure");
    } finally {
      setSendingToManager(false);
    }
  };

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

  return (
    <div className="h-full flex flex-col bg-surface-50 overflow-hidden">
      {/* Precision Header Control */}
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

      {/* Main Document Interface */}
      <div className="flex-1 overflow-y-auto pt-10 pb-20 px-4 md:px-8">
        <div className="max-w-4xl mx-auto">
          {/* Action Bar Floating (Optional logic) */}
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
                className={`
                    px-8 py-3.5 rounded-2xl text-[14px] font-bold transition-all flex items-center gap-3 shadow-xl active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed
                    ${
                      jd.status === "sent_to_manager" ||
                      jd.status === "approved"
                        ? "bg-accent-50 text-accent-700 border border-accent-100 shadow-none"
                        : "bg-primary-600 text-white hover:bg-primary-700 shadow-primary-500/20"
                    }
                  `}
              >
                {sendingToManager ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : jd.status === "sent_to_manager" ? (
                  <CheckCircle2 className="w-4 h-4" />
                ) : (
                  <Send className="w-4 h-4 transition-transform group-hover:translate-x-1" />
                )}
                {jd.status === "sent_to_manager"
                  ? "Asset Released"
                  : jd.status === "approved"
                    ? "Finalized"
                    : "Submit for Approval"}
              </button>
            </div>
          </div>

          {/* THE DOCUMENT CORE */}
          <div className="bg-white rounded-[40px] p-8 md:p-16 border border-surface-200 shadow-premium relative overflow-hidden">
            {/* Subtle Background Mark */}
            <div className="absolute top-0 right-0 p-12 opacity-[0.03] pointer-events-none">
              <Building2 className="w-64 h-64" />
            </div>

            <div className="relative z-10">
              <div className="prose prose-neutral max-w-none prose-headings:font-bold prose-headings:text-neutral-900 prose-p:text-neutral-800 prose-li:text-neutral-800 prose-strong:text-blue-700 min-h-[500px]">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {jd.generated_jd ||
                    "Document content is being synchronized..."}
                </ReactMarkdown>
              </div>
            </div>

            {/* Footer Mark */}
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
          </div>
        </div>
      </div>
    </div>
  );
}
