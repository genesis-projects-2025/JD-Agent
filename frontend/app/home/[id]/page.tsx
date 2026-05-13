// frontend/app/home/[id]/page.tsx
"use client";

import { useEffect, useState, use } from "react";
import Link from "next/link";
import { getCurrentUser, AuthUser } from "@/lib/api";
import { PlayCircle, ArrowRight, FilePlus } from "lucide-react";

export default function HomePage({ params }: { params: Promise<{ id: string }> }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const resolvedParams = use(params);
  const employeeId = resolvedParams.id;

  useEffect(() => {
    // Defer user loading to avoid hydration mismatch
    const timer = setTimeout(() => {
      const currentUser = getCurrentUser();
      setUser(currentUser);
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="w-full h-full overflow-y-auto bg-slate-50 relative selection:bg-blue-100 selection:text-blue-900">
      {/* Navbar */}
      <nav className="sticky top-0 z-50 w-full bg-white/80 backdrop-blur-md border-b border-slate-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-20 items-center">
            {/* Logo area */}
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center h-10 w-auto">
                <img src="https://company-logo-wtn.s3.ap-southeast-2.amazonaws.com/logo.png" alt="Pulse Pharma Logo" className="h-full object-contain" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-slate-900 tracking-tight leading-none">
                  Pulse Pharma
                </h1>
                <p className="text-[10px] uppercase tracking-widest text-slate-500 font-medium mt-1">
                  Intelligence
                </p>
              </div>
            </div>

            {/* User Info */}
            <div className="flex items-center gap-4">
              {user && (
                <div className="hidden sm:block text-right">
                  <p className="text-sm font-medium text-slate-900">{user.name}</p>
                  <p className="text-xs text-slate-500">{user.role || 'Employee'} • {employeeId}</p>
                </div>
              )}
              <div className="w-10 h-10 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold shadow-inner">
                {user?.name ? user.name.charAt(0).toUpperCase() : "U"}
              </div>
            </div>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 lg:py-16 animate-in fade-in slide-in-from-bottom-4 duration-700">

        {/* Hero Section Header */}
        <div className="text-center max-w-3xl mx-auto mb-12">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-50 border border-blue-100 text-blue-700 text-xs font-semibold mb-6">
            <span className="w-2 h-2 rounded-full bg-blue-600 animate-pulse" />
            Innovation through applied learning
          </div>
          <h2 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-slate-900 tracking-tight mb-6">
            Welcome to Our <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-indigo-600">
              JD Intelligence
            </span>
          </h2>
          <p className="text-lg text-slate-600 leading-relaxed max-w-2xl mx-auto">
            Pulse Pharmaceuticals is a fast-growing pharmaceutical and nutraceutical company founded in 1997. We focus on preventive and supportive therapy alongside disease management.
          </p>
        </div>

         {/* Video Section */}
        <div className="max-w-4xl mx-auto mb-12">
          <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-200">
            <h3 className="text-lg font-medium text-slate-900 mb-4">How to Create Your Job Description</h3>
            <div className="relative w-full">
              <div className="relative w-full h-0 pt-[56.25%]">
                <video
                  controls
                  className="absolute inset-0 w-full h-full rounded-lg shadow-sm"
                  preload="metadata"
                >
                  <source
                    src="https://jd-intro-video.s3.ap-southeast-2.amazonaws.com/Jd_Intro_video.mp4"
                    type="video/mp4"
                  />
                  Your browser does not support the video tag.
                </video>
              </div>
            </div>
            <p className="mt-3 text-sm text-slate-500 text-center">
              Watch this quick introduction to understand how JD Intelligence helps you create effective job descriptions
            </p>
          </div>
        </div>

        {/* Action Buttons (Below Video) */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-20">
          <Link
            href={`/dashboard/${employeeId}`}
            className="w-full sm:w-auto px-8 py-4 bg-white text-slate-900 border border-slate-200 rounded-md shadow-sm hover:shadow-md hover:border-slate-300 transition-all font-medium flex items-center justify-center gap-2"
          >
            Go to Dashboard
            <ArrowRight className="w-4 h-4 text-slate-400" />
          </Link>
          <Link
            href="/questionnaire"
            className="w-full sm:w-auto px-8 py-4 bg-blue-600 hover:bg-blue-700 text-white rounded-md shadow-md shadow-blue-600/20 hover:shadow-lg hover:shadow-blue-600/30 transition-all font-medium flex items-center justify-center gap-2"
          >
            <FilePlus className="w-4 h-4" />
            Create my JD
          </Link>
        </div>

        {/* Info Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto pb-12">
          <div className="bg-white p-6 rounded-md border border-slate-100 shadow-sm hover:shadow-md transition-shadow">
            <h3 className="font-semibold text-slate-900 mb-2">Global Presence</h3>
            <p className="text-sm text-slate-600">Operations across India, South East Asia, Russia/CIS, and Africa.</p>
          </div>
          <div className="bg-white p-6 rounded-md border border-slate-100 shadow-sm hover:shadow-md transition-shadow">
            <h3 className="font-semibold text-slate-900 mb-2">Quality First</h3>
            <p className="text-sm text-slate-600">Supported by a state-of-the-art WHO-GMP approved manufacturing facility.</p>
          </div>
          <div className="bg-white p-6 rounded-md border border-slate-100 shadow-sm hover:shadow-md transition-shadow">
            <h3 className="font-semibold text-slate-900 mb-2">Modern Healthcare</h3>
            <p className="text-sm text-slate-600">Focusing on both treatment and comprehensive preventive care.</p>
          </div>
        </div>

      </main>
    </div>
  );
}
