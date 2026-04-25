// frontend/app/home/[id]/page.tsx
"use client";

import { useEffect, useState, use } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getCurrentUser, AuthUser } from "@/lib/api";
import { PlayCircle, ArrowRight, FilePlus } from "lucide-react";

export default function HomePage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);
  const resolvedParams = use(params);
  const employeeId = resolvedParams.id;

  useEffect(() => {
    // We assume the user is already authenticated via SSO and cookies are set
    const currentUser = getCurrentUser();
    setUser(currentUser);
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
            Welcome to your <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-indigo-600">
              JD Intelligence Hub
            </span>
          </h2>
          <p className="text-lg text-slate-600 leading-relaxed max-w-2xl mx-auto">
            Pulse Pharmaceuticals is a fast-growing pharmaceutical and nutraceutical company founded in 1997. We focus on preventive and supportive therapy alongside disease management.
          </p>
        </div>

        {/* Video Placeholder */}
        <div className="max-w-4xl mx-auto mb-12 relative group">
          <div className="absolute -inset-1 bg-gradient-to-r from-blue-600 to-indigo-600 rounded-[2rem] blur opacity-20 group-hover:opacity-30 transition duration-1000"></div>
          <div className="relative aspect-video bg-slate-900 rounded-[2rem] overflow-hidden shadow-2xl flex flex-col items-center justify-center border border-slate-800">
            {/* Background pattern */}
            <div className="absolute inset-0 opacity-10 bg-[radial-gradient(#ffffff_1px,transparent_1px)] [background-size:20px_20px]"></div>
            
            <div className="w-20 h-20 bg-white/10 backdrop-blur-md rounded-full flex items-center justify-center mb-4 cursor-pointer hover:scale-110 transition-transform hover:bg-white/20 border border-white/10">
              <PlayCircle className="w-10 h-10 text-white ml-1" />
            </div>
            <p className="text-white/80 font-medium text-lg tracking-wide z-10">How to create your JD</p>
            <p className="text-white/50 text-sm mt-2 z-10">(Video content coming soon)</p>
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
