"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { API_URL } from "@/lib/api";
import { X, Star, Send, Loader2, MessageSquare } from "lucide-react";
import { useAuth } from "@/components/providers/auth-provider";

interface FeedbackModalProps {
  isOpen: boolean;
  onClose: () => void;
  jdSessionId?: string;
  defaultCategory?: string;
}

export default function FeedbackModal({
  isOpen,
  onClose,
  jdSessionId,
  defaultCategory = "General",
}: FeedbackModalProps) {
  const { employeeId } = useAuth();
  const [category, setCategory] = useState(defaultCategory);
  const [rating, setRating] = useState<number>(0);
  const [hoveredRating, setHoveredRating] = useState<number>(0);
  const [message, setMessage] = useState("");

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!isOpen || !mounted) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!employeeId) {
      setError("You must be logged in to submit feedback.");
      return;
    }
    if (!message.trim()) {
      setError("Please enter a message.");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const payload = {
        employee_id: employeeId,
        jd_session_id: jdSessionId || null,
        category,
        rating: rating > 0 ? rating : null,
        message,
      };

      const res = await fetch(`${API_URL}/feedback`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        throw new Error("Failed to submit feedback");
      }

      setSuccess(true);
      setTimeout(() => {
        onClose();
        // Reset form after closing
        setTimeout(() => {
          setSuccess(false);
          setMessage("");
          setRating(0);
          setCategory("General");
        }, 300);
      }, 2000);
    } catch (err: any) {
      setError(err.message || "An error occurred");
    } finally {
      setIsSubmitting(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6 bg-slate-900/40 backdrop-blur-sm animate-in fade-in duration-200">
      <div
        className="bg-white rounded-2xl w-full max-w-md shadow-2xl border border-slate-200 overflow-hidden flex flex-col animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {success ? (
          <div className="p-8 text-center space-y-4">
            <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Star className="w-8 h-8 text-emerald-500 fill-emerald-500" />
            </div>
            <h3 className="text-xl font-bold text-slate-800">Thank you!</h3>
            <p className="text-slate-500 text-sm">
              Your feedback helps us improve the JD creation experience.
            </p>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between p-5 border-b border-slate-100 bg-slate-50/50">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-blue-100 text-blue-600 flex items-center justify-center">
                  <MessageSquare className="w-4 h-4" />
                </div>
                <h3 className="text-lg font-bold text-slate-800">
                  Send Feedback
                </h3>
              </div>
              <button
                onClick={onClose}
                className="p-2 -mr-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-5 space-y-5">
              {/* Category Selection */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-700">
                  What is this regarding?
                </label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                >
                  <option value="General">General Feedback</option>
                  <option value="Bug Report">Report a Bug</option>
                  <option value="Feature Request">Feature Request</option>
                  <option value="JD Process">JD Generation Process</option>
                </select>
              </div>

              {/* Rating */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700 flex justify-between">
                  Rate your experience
                  <span className="text-slate-400 font-normal text-xs">
                    (optional)
                  </span>
                </label>
                <div className="flex items-center gap-1">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button
                      key={star}
                      type="button"
                      onClick={() => setRating(star)}
                      onMouseEnter={() => setHoveredRating(star)}
                      onMouseLeave={() => setHoveredRating(0)}
                      className="p-1 focus:outline-none transition-transform hover:scale-110"
                    >
                      <Star
                        className={`w-7 h-7 transition-colors ${
                          star <= (hoveredRating || rating)
                            ? "text-amber-400 fill-amber-400 drop-shadow-sm"
                            : "text-slate-200"
                        }`}
                      />
                    </button>
                  ))}
                </div>
              </div>

              {/* Message */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-700">
                  Detailed Feedback
                </label>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Tell us what you liked, what could be better, or describe the issue you encountered..."
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/50 min-h-[120px] resize-none"
                />
              </div>

              {error && (
                <div className="text-red-500 text-sm bg-red-50 p-3 rounded-lg border border-red-100">
                  {error}
                </div>
              )}

              {/* Actions */}
              <div className="pt-2 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg text-sm font-medium transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || !message.trim()}
                  className="flex items-center gap-2 px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded-lg text-sm font-medium transition-colors shadow-sm"
                >
                  {isSubmitting ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                  Submit Feedback
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}
