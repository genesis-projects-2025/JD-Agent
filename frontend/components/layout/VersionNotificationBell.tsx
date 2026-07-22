"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Bell, Sparkles, X, Check, ShieldCheck, Calendar, BookOpen, Layers, BarChart3, Bot } from "lucide-react";
import { APP_VERSION, RELEASE_HISTORY } from "@/config/version";

export default function VersionNotificationBell() {
  const [isOpen, setIsOpen] = useState(false);
  const [hasUnread, setHasUnread] = useState(false);
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
    try {
      const lastSeen = localStorage.getItem("jd_agent_last_seen_version");
      if (lastSeen !== APP_VERSION) {
        setHasUnread(true);
      }
    } catch {
      // Fallback
    }
  }, []);

  const handleOpen = () => {
    setIsOpen(true);
    setHasUnread(false);
    try {
      localStorage.setItem("jd_agent_last_seen_version", APP_VERSION);
    } catch {
      // Fallback
    }
  };

  return (
    <>
      {/* ── Elegant Minimal Purple Bell Badge ─────────────────────────────── */}
      <button
        type="button"
        onClick={handleOpen}
        className="relative flex items-center gap-2 px-3 py-1.5 rounded-full bg-purple-50 hover:bg-purple-100 text-purple-900 font-semibold text-xs transition-all duration-200 border border-purple-200 shadow-sm active:scale-95 cursor-pointer"
        title={`JD-Agent v${APP_VERSION} Release Notes`}
      >
        <div className="relative flex items-center justify-center">
          <Bell className="w-4 h-4 text-purple-700" />
          {hasUnread && (
            <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-purple-600 rounded-full ring-2 ring-white animate-pulse" />
          )}
        </div>
        <span className="font-bold tracking-tight text-purple-900">
          v{APP_VERSION}
        </span>
      </button>

      {/* ── Viewport-Centered Modal Dialog (Portaled to document.body) ──── */}
      {isOpen && isMounted && createPortal(
        <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4 sm:p-6 bg-slate-950/70 backdrop-blur-md animate-in fade-in duration-200">
          <div
            className="relative w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[85vh] animate-in zoom-in-95 duration-200 text-slate-900"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Elegant Purple Header */}
            <div className="px-6 py-5 bg-gradient-to-r from-purple-950 via-purple-900 to-indigo-950 text-white flex items-center justify-between border-b border-purple-800 shrink-0">
              <div className="flex items-center gap-3.5">
                <div className="w-10 h-10 bg-purple-800/80 rounded-xl border border-purple-500/30 flex items-center justify-center shadow-inner">
                  <Sparkles className="w-5 h-5 text-purple-200" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold text-white tracking-tight leading-none">
                      JD-Agent Release Notes
                    </h3>
                    <span className="px-2 py-0.5 text-[10px] font-bold bg-purple-500/20 text-purple-200 rounded-full border border-purple-400/30">
                      v{APP_VERSION}
                    </span>
                  </div>
                  <p className="text-xs text-purple-200 mt-1 flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-purple-300" />
                    Pulse Pharma Platform Release • 2026-07-22
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="p-1.5 text-purple-300 hover:text-white hover:bg-purple-800/50 rounded-lg transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Minimalist Documentation Body */}
            <div className="p-6 overflow-y-auto space-y-5 flex-1 bg-white">
              {/* Highlight summary */}
              <div className="p-4 bg-purple-50/70 rounded-xl border border-purple-100 flex items-start gap-3">
                <ShieldCheck className="w-5 h-5 text-purple-700 shrink-0 mt-0.5" />
                <p className="text-xs text-purple-950 leading-relaxed font-medium">
                  Welcome to <strong>v{APP_VERSION}</strong>. This update introduces multi-tab session safety, real-time AI role visualization, HR bottleneck tracking, and enterprise database safeguards.
                </p>
              </div>

              {/* Release Features */}
              <div className="space-y-3">
                <h4 className="text-xs font-bold text-purple-900 uppercase tracking-wider flex items-center gap-1.5">
                  <BookOpen className="w-4 h-4 text-purple-700" />
                  Release Highlights
                </h4>

                <div className="space-y-2.5">
                  <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 flex items-start gap-3">
                    <div className="w-2 h-2 rounded-full bg-purple-600 mt-1.5 shrink-0" />
                    <div className="text-xs text-slate-700 leading-relaxed">
                      <strong className="font-semibold text-slate-900 block mb-0.5">
                        Multi-Tab Session Isolation
                      </strong>
                      HR admins can open multiple employee profiles in separate browser tabs without cross-tab data contamination.
                    </div>
                  </div>

                  <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 flex items-start gap-3">
                    <div className="w-2 h-2 rounded-full bg-purple-600 mt-1.5 shrink-0" />
                    <div className="text-xs text-slate-700 leading-relaxed">
                      <strong className="font-semibold text-slate-900 block mb-0.5">
                        Live Role Blueprint Sidebar
                      </strong>
                      Real-time visual sidebar during interview chat showing captured responsibilities, tools, and technical skills.
                    </div>
                  </div>

                  <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 flex items-start gap-3">
                    <div className="w-2 h-2 rounded-full bg-purple-600 mt-1.5 shrink-0" />
                    <div className="text-xs text-slate-700 leading-relaxed">
                      <strong className="font-semibold text-slate-900 block mb-0.5">
                        HR Admin Command Center
                      </strong>
                      Department progress overview, manager review bottleneck leaderboard, and bulk CSV report downloads.
                    </div>
                  </div>

                  <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 flex items-start gap-3">
                    <div className="w-2 h-2 rounded-full bg-purple-600 mt-1.5 shrink-0" />
                    <div className="text-xs text-slate-700 leading-relaxed">
                      <strong className="font-semibold text-slate-900 block mb-0.5">
                        Hands-Free Voice Interactivity
                      </strong>
                      Active speech audio waveform visualizer, pause-detection auto-submission, and assistant playback speed controls.
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between shrink-0">
              <span className="text-xs font-medium text-slate-500">
                Pulse Pharma Intelligence • v{APP_VERSION}
              </span>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="px-5 py-2 bg-purple-700 hover:bg-purple-800 text-white font-semibold text-xs rounded-lg shadow-sm transition-all active:scale-95 cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
