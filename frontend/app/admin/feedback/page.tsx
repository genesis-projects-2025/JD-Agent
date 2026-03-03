"use client";

import { useEffect, useState } from "react";
import { API_URL } from "@/lib/api";
import {
  Loader2,
  Search,
  MessageSquare,
  Star,
  Clock,
  CheckCircle2,
  XCircle,
  User,
  Building2,
  Link as LinkIcon,
} from "lucide-react";
import Link from "next/link";

interface FeedbackItem {
  id: string;
  employee_id: string;
  jd_session_id: string | null;
  user_name: string;
  user_role: string;
  user_department: string;
  category: string;
  rating: number | null;
  message: string;
  status: string;
  created_at: string;
}

export default function AdminFeedbackInbox() {
  const [feedbacks, setFeedbacks] = useState<FeedbackItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    fetchFeedbacks();
  }, []);

  const fetchFeedbacks = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem("admin_token");
      const res = await fetch(`${API_URL}/admin/feedback`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setFeedbacks(data);
        if (data.length > 0) setSelectedId(data[0].id);
      }
    } catch (err) {
      console.error("Failed to fetch feedback", err);
    } finally {
      setLoading(false);
    }
  };

  const updateStatus = async (id: string, newStatus: string) => {
    try {
      const token = localStorage.getItem("admin_token");
      const res = await fetch(`${API_URL}/admin/feedback/${id}/status`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ status: newStatus }),
      });

      if (res.ok) {
        setFeedbacks((prev) =>
          prev.map((fb) => (fb.id === id ? { ...fb, status: newStatus } : fb)),
        );
      } else {
        alert("Failed to update status");
      }
    } catch (err) {
      alert("Error updating status");
    }
  };

  const filteredFeedbacks = feedbacks.filter((fb) => {
    if (statusFilter !== "all" && fb.status !== statusFilter) return false;

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      return (
        fb.user_name.toLowerCase().includes(query) ||
        fb.message.toLowerCase().includes(query) ||
        fb.category.toLowerCase().includes(query)
      );
    }
    return true;
  });

  const selectedFeedback = feedbacks.find((fb) => fb.id === selectedId);

  const formatDate = (dateString: string) => {
    const d = new Date(dateString);
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(d);
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center p-12">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-8rem)] flex gap-6 max-w-[1600px] mx-auto">
      {/* Left Pane: Inbox List */}
      <div className="w-1/3 min-w-[320px] bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col overflow-hidden">
        <div className="p-4 border-b border-slate-200 bg-slate-50 space-y-3">
          <h2 className="font-bold text-slate-800 flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-blue-500" />
            Feedback Inbox
          </h2>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search messages..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500/50"
            />
          </div>
          <div className="flex gap-2">
            {["all", "unread", "reviewed", "resolved"].map((status) => (
              <button
                key={status}
                onClick={() => setStatusFilter(status)}
                className={`px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider transition-colors ${
                  statusFilter === status
                    ? "bg-slate-800 text-white"
                    : "bg-white border border-slate-200 text-slate-500 hover:bg-slate-100"
                }`}
              >
                {status}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
          {filteredFeedbacks.length === 0 ? (
            <div className="p-8 text-center text-slate-500 text-sm">
              No feedback found matching your criteria.
            </div>
          ) : (
            filteredFeedbacks.map((fb) => (
              <button
                key={fb.id}
                onClick={() => setSelectedId(fb.id)}
                className={`w-full text-left p-4 transition-colors relative ${
                  selectedId === fb.id ? "bg-blue-50" : "hover:bg-slate-50"
                }`}
              >
                {fb.status === "unread" && (
                  <div className="absolute left-0 top-0 bottom-0 w-1 bg-blue-500" />
                )}
                <div className="flex justify-between items-start mb-1">
                  <span
                    className={`font-medium ${fb.status === "unread" ? "text-slate-900 font-bold" : "text-slate-700"}`}
                  >
                    {fb.user_name}
                  </span>
                  <span className="text-xs text-slate-400 whitespace-nowrap ml-2">
                    {formatDate(fb.created_at)}
                  </span>
                </div>
                <div className="text-xs text-blue-600 font-medium mb-2">
                  {fb.category}
                </div>
                <p className="text-sm text-slate-500 line-clamp-2 leading-relaxed">
                  {fb.message}
                </p>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Right Pane: Detail View */}
      <div className="flex-1 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
        {selectedFeedback ? (
          <>
            <div className="p-6 border-b border-slate-200 bg-slate-50 flex items-start justify-between">
              <div>
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-12 h-12 bg-blue-100 text-blue-700 rounded-full flex items-center justify-center font-bold text-lg">
                    {selectedFeedback.user_name.charAt(0)}
                  </div>
                  <div>
                    <h1 className="text-xl font-bold text-slate-900">
                      {selectedFeedback.user_name}
                    </h1>
                    <div className="flex items-center gap-4 text-sm text-slate-500 mt-1">
                      <span className="flex items-center gap-1.5 border border-slate-200 bg-white px-2 py-0.5 rounded-md">
                        <User className="w-3.5 h-3.5" />{" "}
                        {selectedFeedback.user_role}
                      </span>
                      <span className="flex items-center gap-1.5 border border-slate-200 bg-white px-2 py-0.5 rounded-md">
                        <Building2 className="w-3.5 h-3.5" />{" "}
                        {selectedFeedback.user_department}
                      </span>
                      <span className="flex items-center gap-1.5 text-slate-400">
                        <Clock className="w-3.5 h-3.5" />{" "}
                        {formatDate(selectedFeedback.created_at)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex gap-2">
                {selectedFeedback.status !== "reviewed" && (
                  <button
                    onClick={() =>
                      updateStatus(selectedFeedback.id, "reviewed")
                    }
                    className="px-4 py-2 bg-white border border-slate-200 text-slate-600 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors shadow-sm"
                  >
                    Mark Reviewed
                  </button>
                )}
                {selectedFeedback.status !== "resolved" && (
                  <button
                    onClick={() =>
                      updateStatus(selectedFeedback.id, "resolved")
                    }
                    className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 transition-colors shadow-sm flex items-center gap-2"
                  >
                    <CheckCircle2 className="w-4 h-4" /> Resolve
                  </button>
                )}
                {selectedFeedback.status === "resolved" && (
                  <span className="px-4 py-2 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg text-sm font-bold flex items-center gap-2 cursor-default">
                    <CheckCircle2 className="w-4 h-4" /> Resolved
                  </span>
                )}
              </div>
            </div>

            <div className="p-8 flex-1 overflow-y-auto">
              <div className="flex items-center justify-between mb-6 pb-6 border-b border-slate-100">
                <div className="flex items-center gap-3">
                  <span className="px-3 py-1 bg-blue-50 text-blue-700 border border-blue-200 rounded-md text-xs font-bold tracking-wide uppercase">
                    {selectedFeedback.category}
                  </span>
                  {selectedFeedback.rating && (
                    <span className="flex items-center gap-1 bg-amber-50 text-amber-700 border border-amber-200 px-2 py-1 rounded-md text-sm font-bold">
                      {selectedFeedback.rating}{" "}
                      <Star className="w-4 h-4 fill-amber-500 text-amber-500" />
                    </span>
                  )}
                </div>

                {selectedFeedback.jd_session_id && (
                  <Link
                    href={`/admin/jds`}
                    className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-800 hover:underline font-medium"
                  >
                    <LinkIcon className="w-4 h-4" />
                    Linked JD Session
                  </Link>
                )}
              </div>

              <div className="prose max-w-none">
                <p className="text-slate-700 leading-relaxed whitespace-pre-wrap">
                  {selectedFeedback.message}
                </p>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-400 p-8 space-y-4">
            <MessageSquare className="w-16 h-16 opacity-20" />
            <p>Select a feedback message to read</p>
          </div>
        )}
      </div>
    </div>
  );
}
