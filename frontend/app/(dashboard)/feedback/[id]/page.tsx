"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { fetchAllFeedback, AuthUser, getCurrentUser } from "@/lib/api";
import {
  AlertTriangle,
  ArrowLeft,
  Calendar,
  CheckCircle2,
  FileText,
  MessageSquare,
  User,
  ExternalLink,
  Loader2,
} from "lucide-react";

type FeedbackItem = {
  id: string;
  jd_session_id: string;
  jd_title: string;
  jd_status: string;
  jd_employee_name: string;
  jd_department: string;
  reviewer_name: string;
  reviewer_role: string;
  target_role: string;
  action: string;
  comment: string;
  is_read: boolean;
  created_at: string | null;
};

export default function FeedbackPage() {
  const params = useParams();
  const router = useRouter();
  const employeeId = params.id as string;

  const [feedback, setFeedback] = useState<FeedbackItem[]>([]);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const u = getCurrentUser();
        if (!u) {
          router.push("/admin/login");
          return;
        }

        // getCurrentUser has basic info from sessionStorage
        // If we needed deep DB details we'd fetch from an /api/users endpoint.
        // For this page, AuthUser has enough context (employee_id, role)
        setCurrentUser(u);

        const data = await fetchAllFeedback(employeeId, u.role);
        setFeedback(data);
      } catch (e) {
        console.error("Error loading feedback page:", e);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [employeeId, router]);

  if (loading) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-surface-50 z-50">
        <div className="text-center group">
          <div className="relative mb-4">
            <div className="absolute inset-0 bg-primary-100 rounded-full animate-ping opacity-20 scale-150" />
            <Loader2 className="w-10 h-10 text-primary-600 animate-spin mx-auto relative z-10" />
          </div>
          <p className="text-[11px] font-black text-surface-400 uppercase tracking-[0.2em]">
            Syncing Feedback...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 overflow-y-auto p-4 sm:p-6 pb-24">
      <div className="max-w-7xl mx-auto space-y-8 sm:space-y-10 pt-14 pb-10 sm:pt-0 animate-in fade-in slide-in-from-bottom-4 duration-700">
        <div className="px-4 xl:px-0 flex flex-col sm:flex-row sm:items-end justify-between gap-6 relative z-10">
          <div>
            <button
              onClick={() => router.push(`/dashboard/${employeeId}`)}
              className="flex items-center gap-2 text-surface-400 hover:text-primary-600 transition-colors text-[11px] font-black uppercase tracking-widest mb-6 group"
            >
              <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
              Back to Dashboard
            </button>

            <div className="flex items-center gap-4 mb-4">
              <div className="w-14 h-14 bg-gradient-to-br from-primary-500 to-primary-600 rounded-2xl flex items-center justify-center shadow-lg shadow-primary-500/20 transform rotate-[-3deg] hover:rotate-0 transition-transform duration-300">
                <MessageSquare className="w-7 h-7 text-white" />
              </div>
              <div>
                <h1 className="text-3xl sm:text-5xl font-black text-surface-900 tracking-tight">
                  Feedback Hub
                </h1>
                <p className="text-surface-500 mt-2 text-sm sm:text-base max-w-xl font-medium leading-relaxed">
                  {currentUser?.role === "hr"
                    ? "Track change requests you've sent to managers."
                    : "Review and address feedback on your strategic role architectures."}
                </p>
              </div>
            </div>
          </div>

          {/* Stats */}
          <div className="flex gap-4">
            <div className="bg-white px-5 py-4 rounded-2xl border border-surface-200/60 shadow-sm flex items-center gap-4 min-w-[160px]">
              <div className="w-10 h-10 rounded-xl bg-orange-100/50 flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-orange-600" />
              </div>
              <div>
                <p className="text-[11px] font-bold text-surface-500 uppercase tracking-widest mb-0.5">
                  Unread
                </p>
                <p className="text-2xl font-black text-surface-900 leading-none">
                  {feedback.filter((f) => !f.is_read).length}
                </p>
              </div>
            </div>
            <div className="bg-white px-5 py-4 rounded-2xl border border-surface-200/60 shadow-sm flex items-center gap-4 min-w-[160px]">
              <div className="w-10 h-10 rounded-xl bg-surface-100 flex items-center justify-center">
                <FileText className="w-5 h-5 text-surface-600" />
              </div>
              <div>
                <p className="text-[11px] font-bold text-surface-500 uppercase tracking-widest mb-0.5">
                  Total
                </p>
                <p className="text-2xl font-black text-surface-900 leading-none">
                  {feedback.length}
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="px-4 xl:px-0">
          {feedback.length === 0 ? (
            <div className="bg-white/50 backdrop-blur-xl border border-surface-200/60 rounded-3xl p-16 text-center shadow-sm">
              <div className="w-20 h-20 bg-surface-100 rounded-3xl flex items-center justify-center mx-auto mb-6 transform rotate-3">
                <CheckCircle2 className="w-10 h-10 text-surface-400" />
              </div>
              <h3 className="text-xl font-bold text-surface-900 mb-2">
                All caught up!
              </h3>
              <p className="text-surface-500 max-w-sm mx-auto font-medium">
                You don't have any feedback history to review right now.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {feedback.map((item, idx) => (
                <div
                  key={item.id}
                  className={`bg-white rounded-[24px] p-6 border transition-all duration-300 group hover:shadow-premium hover:-translate-y-1 relative ${
                    !item.is_read
                      ? "border-orange-200 shadow-sm"
                      : "border-surface-200 shadow-sm"
                  }`}
                  style={{ animationDelay: `${idx * 100}ms` }}
                >
                  {/* Type & Status */}
                  <div className="flex items-start justify-between mb-5">
                    <div className="flex flex-col gap-2">
                      <span
                        className={`px-3 py-1 text-[10px] font-black uppercase tracking-widest rounded-lg flex items-center gap-1.5 w-fit ${
                          item.action === "approve"
                            ? "bg-emerald-50 text-emerald-700 border border-emerald-100"
                            : "bg-red-50 text-red-700 border border-red-100"
                        }`}
                      >
                        {item.action === "approve" ? (
                          <CheckCircle2 className="w-3.5 h-3.5" />
                        ) : (
                          <AlertTriangle className="w-3.5 h-3.5" />
                        )}
                        {item.action === "approve"
                          ? "Approved"
                          : "Revision Requested"}
                      </span>
                      {!item.is_read && (
                        <span className="w-2.5 h-2.5 bg-orange-500 rounded-full animate-pulse absolute -top-1 -right-1 ring-4 ring-white shadow-lg shadow-orange-500/50" />
                      )}
                    </div>

                    {item.created_at && (
                      <div className="flex items-center gap-1.5 text-surface-400">
                        <Calendar className="w-3.5 h-3.5" />
                        <span className="text-[11px] font-bold uppercase tracking-wider">
                          {new Date(item.created_at).toLocaleDateString(
                            undefined,
                            {
                              month: "short",
                              day: "numeric",
                            },
                          )}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Content */}
                  <div className="space-y-4">
                    <div>
                      <h3 className="text-lg font-black text-surface-900 tracking-tight leading-snug line-clamp-2 mb-1 group-hover:text-primary-700 transition-colors">
                        {item.jd_title}
                      </h3>
                      {item.jd_employee_name !== "Unknown" && (
                        <p className="text-sm font-medium text-surface-500 flex items-center gap-1.5">
                          <User className="w-3.5 h-3.5" />
                          {item.jd_employee_name}
                          {item.jd_department && (
                            <span className="opacity-60">
                              • {item.jd_department}
                            </span>
                          )}
                        </p>
                      )}
                    </div>

                    <div className="p-4 bg-surface-50 rounded-2xl relative">
                      <div className="absolute top-0 left-0 w-1 h-full bg-surface-300 rounded-l-2xl"></div>
                      <p className="text-[15px] leading-relaxed text-surface-700 italic">
                        "{item.comment}"
                      </p>
                    </div>

                    <div className="flex items-center gap-2 text-surface-500">
                      <User className="w-4 h-4 text-surface-400" />
                      <span className="text-sm font-medium">
                        Reviewed by{" "}
                        <strong className="text-surface-700">
                          {item.reviewer_name}
                        </strong>
                        {item.reviewer_role && (
                          <span className="text-surface-400">
                            {" "}
                            ({item.reviewer_role})
                          </span>
                        )}
                      </span>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="mt-6 pt-5 border-t border-surface-100 flex items-center justify-end">
                    <button
                      onClick={async () => {
                        if (!item.is_read) {
                          try {
                            const { markFeedbackRead } =
                              await import("@/lib/api");
                            await markFeedbackRead(item.id);
                          } catch (e) {
                            console.error("Failed to mark as read:", e);
                          }
                        }
                        router.push(`/jd/${item.jd_session_id}?view=feedback`);
                      }}
                      className="flex items-center gap-2 px-4 py-2 bg-primary-50 text-primary-700 hover:bg-primary-100 hover:text-primary-800 rounded-xl text-sm font-bold transition-colors group/btn"
                    >
                      View Document
                      <ExternalLink className="w-4 h-4 group-hover/btn:-rotate-12 group-hover/btn:scale-110 transition-transform" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
