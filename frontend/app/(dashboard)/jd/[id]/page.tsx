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
} from "lucide-react";

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
  { label: string; color: string; bg: string }
> = {
  draft: {
    label: "Draft",
    color: "text-amber-700",
    bg: "bg-amber-50 border-amber-200",
  },
  sent_to_manager: {
    label: "Sent to Manager",
    color: "text-blue-700",
    bg: "bg-blue-50 border-blue-200",
  },
  approved: {
    label: "Approved",
    color: "text-emerald-700",
    bg: "bg-emerald-50 border-emerald-200",
  },
  rejected: {
    label: "Rejected",
    color: "text-red-700",
    bg: "bg-red-50 border-red-200",
  },
  jd_generated: {
    label: "Draft",
    color: "text-amber-700",
    bg: "bg-amber-50 border-amber-200",
  },
};

function StatusBadge({ status }: { status: string }) {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.draft;
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border ${config.bg} ${config.color}`}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-current" />
      {config.label}
    </span>
  );
}

function SectionCard({
  icon: Icon,
  title,
  children,
}: {
  icon: any;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-xl border border-neutral-200 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-center gap-3 px-6 py-4 border-b border-neutral-100">
        <div className="w-9 h-9 bg-blue-50 rounded-lg flex items-center justify-center">
          <Icon className="w-4.5 h-4.5 text-blue-600" />
        </div>
        <h3 className="text-sm font-semibold text-neutral-900 uppercase tracking-wide">
          {title}
        </h3>
      </div>
      <div className="px-6 py-5">{children}</div>
    </div>
  );
}

function ListItems({ items }: { items: string[] }) {
  if (!items || items.length === 0)
    return <p className="text-neutral-400 text-sm italic">Not specified</p>;
  return (
    <ul className="space-y-2.5">
      {items.map((item, i) => (
        <li key={i} className="flex items-start gap-3 text-sm text-neutral-700">
          <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0" />
          <span className="leading-relaxed">{item}</span>
        </li>
      ))}
    </ul>
  );
}

function DictDisplay({ data }: { data: Record<string, any> | string }) {
  if (!data || (typeof data === "object" && Object.keys(data).length === 0)) {
    return <p className="text-neutral-400 text-sm italic">Not specified</p>;
  }
  if (typeof data === "string") {
    return <p className="text-sm text-neutral-700 leading-relaxed">{data}</p>;
  }
  return (
    <div className="space-y-3">
      {Object.entries(data).map(([key, value]) => (
        <div key={key}>
          <dt className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-1">
            {key.replace(/_/g, " ")}
          </dt>
          <dd className="text-sm text-neutral-700 leading-relaxed">
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
      alert(err?.response?.data?.detail || "Failed to update status");
    } finally {
      setSendingToManager(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <Loader2 className="w-8 h-8 text-blue-600 animate-spin mx-auto mb-3" />
          <p className="text-sm text-neutral-500">Loading Job Description...</p>
        </div>
      </div>
    );
  }

  if (error || !jd) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 bg-red-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <FileText className="w-8 h-8 text-red-400" />
          </div>
          <h2 className="text-lg font-semibold text-neutral-900 mb-2">
            JD Not Found
          </h2>
          <p className="text-sm text-neutral-500 mb-6">
            {error || "The requested Job Description could not be found."}
          </p>
          <button
            onClick={() => router.push("/dashboard")}
            className="px-6 py-2.5 bg-neutral-900 text-white rounded-lg text-sm font-medium hover:bg-neutral-800 transition-colors"
          >
            Back to Dashboard
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
    "Untitled Job Description";

  return (
    <div className="h-[calc(100vh-3rem)] flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 bg-gradient-to-r from-neutral-900 via-neutral-800 to-neutral-900 text-white">
        <div className="max-w-5xl mx-auto px-8 py-6">
          <div className="flex items-center gap-2 mb-4">
            <button
              onClick={() => router.push("/dashboard")}
              className="flex items-center gap-1.5 text-neutral-400 hover:text-white transition-colors text-sm"
            >
              <ArrowLeft className="w-4 h-4" />
              Dashboard
            </button>
          </div>
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 bg-white/10 backdrop-blur-sm rounded-2xl flex items-center justify-center border border-white/20">
                <Briefcase className="w-7 h-7 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold tracking-tight">
                  {displayTitle}
                </h1>
                <div className="flex items-center gap-4 mt-2">
                  <StatusBadge status={jd.status} />
                  <span className="flex items-center gap-1.5 text-neutral-400 text-xs">
                    <Hash className="w-3.5 h-3.5" />
                    Version {jd.version}
                  </span>
                  <span className="flex items-center gap-1.5 text-neutral-400 text-xs">
                    <Clock className="w-3.5 h-3.5" />
                    {jd.updated_at
                      ? new Date(jd.updated_at).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : "—"}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex gap-3 flex-shrink-0">
              <button
                onClick={() => router.push(`/jd/${jdId}/edit`)}
                className="px-5 py-2.5 bg-white/10 hover:bg-white/20 backdrop-blur-sm rounded-xl text-sm font-medium transition-all flex items-center gap-2 border border-white/10"
              >
                <Edit3 className="w-4 h-4" />
                Edit JD
              </button>
              <button
                onClick={handleSendToManager}
                disabled={
                  sendingToManager ||
                  jd.status === "sent_to_manager" ||
                  jd.status === "approved"
                }
                className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 rounded-xl text-sm font-bold transition-all flex items-center gap-2 shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {sendingToManager ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : jd.status === "sent_to_manager" ? (
                  <CheckCircle2 className="w-4 h-4" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
                {jd.status === "sent_to_manager"
                  ? "Sent"
                  : jd.status === "approved"
                    ? "Approved"
                    : "Send to Manager"}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-y-auto bg-neutral-50">
        <div className="max-w-5xl mx-auto px-8 py-8 space-y-6">
          {/* Role Summary */}
          {s.role_summary && (
            <SectionCard icon={Briefcase} title="Role Summary">
              <DictDisplay data={s.role_summary} />
            </SectionCard>
          )}

          {/* Key Responsibilities */}
          <SectionCard icon={Target} title="Key Responsibilities">
            <ListItems items={s.key_responsibilities || []} />
          </SectionCard>

          {/* Required Skills */}
          <SectionCard icon={Star} title="Required Skills">
            {s.required_skills && s.required_skills.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {s.required_skills.map((skill: string, i: number) => (
                  <span
                    key={i}
                    className="px-3 py-1.5 bg-blue-50 text-blue-700 rounded-lg text-sm font-medium border border-blue-100"
                  >
                    {skill}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-neutral-400 text-sm italic">Not specified</p>
            )}
          </SectionCard>

          {/* Tools & Technologies */}
          <SectionCard icon={Wrench} title="Tools & Technologies">
            {s.tools_and_technologies && s.tools_and_technologies.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {s.tools_and_technologies.map((tool: string, i: number) => (
                  <span
                    key={i}
                    className="px-3 py-1.5 bg-neutral-100 text-neutral-700 rounded-lg text-sm font-medium border border-neutral-200"
                  >
                    {tool}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-neutral-400 text-sm italic">Not specified</p>
            )}
          </SectionCard>

          {/* Team Structure */}
          {s.team_structure && Object.keys(s.team_structure).length > 0 && (
            <SectionCard icon={Users} title="Team Structure">
              <DictDisplay data={s.team_structure} />
            </SectionCard>
          )}

          {/* Performance Metrics */}
          {s.performance_metrics && s.performance_metrics.length > 0 && (
            <SectionCard icon={BarChart3} title="Performance Metrics">
              <ListItems items={s.performance_metrics} />
            </SectionCard>
          )}

          {/* Work Environment */}
          {s.work_environment && Object.keys(s.work_environment).length > 0 && (
            <SectionCard icon={Building2} title="Work Environment">
              <DictDisplay data={s.work_environment} />
            </SectionCard>
          )}

          {/* Stakeholder Interactions */}
          {s.stakeholder_interactions &&
            Object.keys(s.stakeholder_interactions).length > 0 && (
              <SectionCard icon={Users} title="Stakeholder Interactions">
                <DictDisplay data={s.stakeholder_interactions} />
              </SectionCard>
            )}

          {/* Additional Details */}
          {s.additional_details &&
            Object.keys(s.additional_details).length > 0 && (
              <SectionCard icon={FileText} title="Additional Details">
                <DictDisplay data={s.additional_details} />
              </SectionCard>
            )}

          {/* Raw Text fallback */}
          {jd.generated_jd && (
            <SectionCard icon={FileText} title="Full JD Text">
              <pre className="whitespace-pre-wrap text-sm text-neutral-700 leading-relaxed font-sans">
                {jd.generated_jd}
              </pre>
            </SectionCard>
          )}

          <div className="h-8" />
        </div>
      </div>
    </div>
  );
}
