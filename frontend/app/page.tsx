"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getOrCreateEmployeeId } from "@/lib/auth";
import {
  FileText,
  ArrowRight,
  Shield,
  Zap,
  Star,
  CheckCircle2,
  Building2,
  Users,
} from "lucide-react";

export default function HomePage() {
  const router = useRouter();
  const [employeeId, setEmployeeId] = useState<string | null>(null);

  useEffect(() => {
    // Ensure employee ID is created on first landing
    setEmployeeId(getOrCreateEmployeeId());
  }, []);

  const handleGoToDashboard = () => {
    if (employeeId) {
      router.push(`/dashboard/${employeeId}`);
    }
  };

  const handleStartInterview = () => {
    router.push("/questionnaire");
  };

  return (
    <div className="min-h-screen bg-white text-neutral-900 font-sans selection:bg-blue-100 italic:selection:bg-blue-200">
      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-white/80 backdrop-blur-xl border-b border-neutral-100">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-blue-600 to-blue-800 rounded-xl flex items-center justify-center shadow-lg shadow-blue-900/20">
              <FileText className="w-5 h-5 text-white" />
            </div>
            <span className="text-xl font-bold tracking-tight text-neutral-900">
              Pulse Pharma Intelligence
            </span>
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={handleGoToDashboard}
              className="text-sm font-semibold text-neutral-600 hover:text-blue-600 transition-colors"
            >
              Sign In
            </button>
            <button
              onClick={handleStartInterview}
              className="px-6 py-2.5 bg-neutral-900 text-white rounded-full text-sm font-bold shadow-xl shadow-neutral-900/20 hover:scale-[1.02] active:scale-[0.98] transition-all"
            >
              Get Started
            </button>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="pt-40 pb-24 px-6 relative overflow-hidden">
        {/* Background Decor */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-full -z-10 bg-[radial-gradient(circle_at_50%_0%,#eff6ff_0%,transparent_50%)]" />

        <div className="max-w-7xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-50 border border-blue-100 text-blue-700 text-xs font-bold mb-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
            <Star className="w-3 h-3 fill-current" />
            <span>AI-POWERED JD INTELLIGENCE</span>
          </div>

          <h1 className="text-6xl md:text-7xl font-extrabold tracking-tight text-neutral-900 mb-8 max-w-4xl mx-auto leading-[1.1] animate-in fade-in slide-in-from-bottom-8 duration-1000">
            Precision Hiring Starts with{" "}
            <span className="text-blue-600">Perfect Descriptions</span>
          </h1>

          <p className="text-xl text-neutral-500 mb-12 max-w-2xl mx-auto leading-relaxed animate-in fade-in slide-in-from-bottom-12 duration-1200">
            Automate your job description workflow with Pulse Pharma's
            intelligent agent. From interview to approval in minutes, not days.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 animate-in fade-in slide-in-from-bottom-16 duration-1500">
            <button
              onClick={handleStartInterview}
              className="group px-8 py-4 bg-blue-600 text-white rounded-2xl font-bold shadow-2xl shadow-blue-600/30 hover:bg-blue-700 hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center gap-2"
            >
              Start JD Interview
              <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </button>
            <button
              onClick={handleGoToDashboard}
              className="px-8 py-4 bg-white text-neutral-900 border border-neutral-200 rounded-2xl font-bold hover:bg-neutral-50 hover:border-neutral-300 transition-all flex items-center gap-2"
            >
              View Dashboard
            </button>
          </div>

          <div className="mt-16 pt-16 border-t border-neutral-100 grid grid-cols-2 md:grid-cols-4 gap-8 opacity-60">
            <div className="flex flex-col items-center gap-2">
              <Shield className="w-6 h-6" />
              <span className="text-xs font-bold uppercase tracking-widest text-neutral-400">
                Enterprise Secure
              </span>
            </div>
            <div className="flex flex-col items-center gap-2">
              <Zap className="w-6 h-6" />
              <span className="text-xs font-bold uppercase tracking-widest text-neutral-400">
                Real-time Generation
              </span>
            </div>
            <div className="flex flex-col items-center gap-2">
              <Users className="w-6 h-6" />
              <span className="text-xs font-bold uppercase tracking-widest text-neutral-400">
                Collaborative Flow
              </span>
            </div>
            <div className="flex flex-col items-center gap-2">
              <Building2 className="w-6 h-6" />
              <span className="text-xs font-bold uppercase tracking-widest text-neutral-400">
                Pharma Optimized
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Features Preview */}
      <section className="py-24 bg-neutral-50">
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid md:grid-cols-3 gap-8">
            <div className="bg-white p-8 rounded-3xl border border-neutral-100 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all">
              <div className="w-12 h-12 bg-blue-50 rounded-2xl flex items-center justify-center text-blue-600 mb-6">
                <MessageSquare className="w-6 h-6" />
              </div>
              <h3 className="text-xl font-bold mb-4">Interview-Based</h3>
              <p className="text-neutral-500 leading-relaxed text-sm">
                No more blank pages. Saniya, our AI Agent, interviews you to
                extract the core requirements of any role.
              </p>
            </div>

            <div className="bg-white p-8 rounded-3xl border border-neutral-100 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all">
              <div className="w-12 h-12 bg-emerald-50 rounded-2xl flex items-center justify-center text-emerald-600 mb-6">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <h3 className="text-xl font-bold mb-4">Manager Approvals</h3>
              <p className="text-neutral-500 leading-relaxed text-sm">
                Seamlessly send generated JDs to managers for review and track
                their status in real-time.
              </p>
            </div>

            <div className="bg-white p-8 rounded-3xl border border-neutral-100 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all">
              <div className="w-12 h-12 bg-purple-50 rounded-2xl flex items-center justify-center text-purple-600 mb-6">
                <Shield className="w-6 h-6" />
              </div>
              <h3 className="text-xl font-bold mb-4">Data Privacy</h3>
              <p className="text-neutral-500 leading-relaxed text-sm">
                Your JDs are your own. Our secure identity system ensures you
                only see what belongs to you.
              </p>
            </div>
          </div>
        </div>
      </section>

      <footer className="py-12 border-t border-neutral-100 text-center">
        <p className="text-sm text-neutral-400 font-medium">
          © {new Date().getFullYear()} Pulse Pharma. All rights reserved.
        </p>
      </footer>
    </div>
  );
}

// Minimal placeholder for missing icon in landing page
function MessageSquare(props: any) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}
