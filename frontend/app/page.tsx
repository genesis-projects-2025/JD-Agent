"use client";

import { useRouter } from "next/navigation";
import { useAuth } from "@/components/providers/auth-provider";
import {
 FileText,
 ArrowRight,
 Shield,
 Zap,
 CheckCircle2,
 Building2,
 Users,
 ShieldAlert,
} from "lucide-react";

export default function HomePage() {
 const router = useRouter();
 const { isAuthenticated, employeeId } = useAuth();

 const handleGoToDashboard = () => {
 if (isAuthenticated && employeeId) {
 router.push(`/dashboard/${employeeId}`);
 }
 };

 const handleStartInterview = () => {
 if (isAuthenticated && employeeId) {
 router.push("/questionnaire");
 }
 };

 return (
 <div className="min-h-screen bg-white text-neutral-900 font-sans selection:bg-blue-100 italic:selection:bg-blue-200">
 {/* Navigation */}
 <nav className="fixed top-0 left-0 right-0 z-50 bg-white/80 backdrop-blur-xl border-b border-neutral-100">
 <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
 <div className="flex items-center gap-3">
 <div className="w-10 h-10 bg-gradient-to-br from-blue-600 to-blue-800 rounded-md flex items-center justify-center shadow-md shadow-blue-900/20">
 <FileText className="w-5 h-5 text-white" />
 </div>
 <span className="text-xl font-medium text-neutral-900 hidden sm:inline-block">
 Pulse Pharma Intelligence
 </span>
 <span className="text-xl font-medium text-neutral-900 sm:hidden">
 Pulse Pharma
 </span>
 </div>
 <div className="flex items-center gap-4">
 {!isAuthenticated && (
 <div className="flex items-center gap-2 text-red-600 font-medium text-xs sm:text-sm bg-red-50 px-3 py-1.5 md:px-4 md:py-2 rounded-md border border-red-100">
 <ShieldAlert className="w-4 h-4" />
 Access Restricted
 </div>
 )}
 {isAuthenticated && (
 <>
  <button
  onClick={handleGoToDashboard}
  className="text-sm font-semibold text-neutral-600 hover:text-blue-600 transition-colors"
  >
  My JDs
  </button>
  <button
  onClick={handleStartInterview}
  className="px-4 py-2 md:px-6 md:py-2.5 bg-neutral-900 text-white rounded-md text-xs sm:text-sm font-medium shadow-md shadow-neutral-900/20 hover:scale-[1.02] active:scale-[0.98] transition-all"
  >
  Create JD
  </button>
 </>
 )}
 </div>
 </div>
 </nav>

 {/* Hero Section */}
 <section className="pt-28 sm:pt-40 pb-16 sm:pb-24 px-6 relative overflow-hidden">
 {/* Background Decor */}
 <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-full -z-10 bg-[radial-gradient(circle_at_50%_0%,#eff6ff_0%,transparent_50%)]" />

 <div className="max-w-7xl mx-auto text-center">
 {!isAuthenticated ? (
 <div className="flex flex-col items-center animate-in fade-in slide-in-from-bottom-8 duration-700 max-w-2xl mx-auto bg-white p-12 rounded-[40px] shadow-md border border-neutral-100 mt-10">
 <div className="w-20 h-20 bg-red-50 rounded-md flex items-center justify-center text-red-600 mb-8 border-4 border-white shadow-md">
 <ShieldAlert className="w-10 h-10" />
 </div>
  <h1 className="text-4xl md:text-5xl font-bold text-neutral-900 mb-6 leading-tight">
  Access Required
  </h1>
  <p className="text-lg text-neutral-600 mb-8 leading-relaxed">
  This portal requires valid employee authentication.
  Please use the secure link provided by your organization.
  </p>
 <div className="flex items-center gap-3 text-sm font-medium text-neutral-400 bg-neutral-50 px-6 py-3 rounded-md">
 <Shield className="w-4 h-4" />
 Zero Trust Network
 </div>
 </div>
 ) : (
 <>
 <div className="inline-flex items-center gap-2 px-3 py-1 rounded-md bg-blue-50 border border-blue-100 text-blue-700 text-xs font-medium mb-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
 <FileText className="w-3 h-3 fill-current" />
 <span>AI-POWERED JD INTELLIGENCE</span>
 </div>

  <h1 className="text-3xl sm:text-5xl md:text-6xl lg:text-7xl font-bold text-neutral-900 mb-6 sm:mb-8 max-w-4xl mx-auto leading-[1.05] animate-in fade-in slide-in-from-bottom-8 duration-1000">
  Create Professional{" "}
  <span className="text-blue-600">Job Descriptions</span>{" "}
  with AI
  </h1>

  <p className="text-lg md:text-xl text-neutral-600 mb-12 max-w-2xl mx-auto leading-relaxed animate-in fade-in slide-in-from-bottom-12 duration-1200 px-4">
  Streamline your hiring process with intelligent interviews and automated
  approvals. Generate compliant, professional JDs in minutes.
  </p>

 <div className="flex flex-col sm:flex-row items-center justify-center gap-4 animate-in fade-in slide-in-from-bottom-16 duration-1500">
  <button
  onClick={handleStartInterview}
  className="group px-8 py-4 bg-blue-600 text-white rounded-md font-medium shadow-md shadow-blue-600/30 hover:bg-blue-700 hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center gap-2"
  >
  Create New JD
  <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
  </button>
  <button
  onClick={handleGoToDashboard}
  className="w-full sm:w-auto px-8 py-4 bg-white text-neutral-900 border border-neutral-200 rounded-md font-medium hover:bg-neutral-50 hover:border-neutral-300 transition-all flex items-center justify-center gap-2"
  >
  My Dashboard
  </button>
 </div>
 </>
 )}

 <div className="mt-16 pt-16 border-t border-neutral-100 grid grid-cols-2 md:grid-cols-4 gap-8 opacity-60">
 <div className="flex flex-col items-center gap-2">
 <Shield className="w-6 h-6" />
  <span className="text-xs font-medium text-neutral-500">
  Secure & Compliant
  </span>
  </div>
  <div className="flex flex-col items-center gap-2">
  <Zap className="w-6 h-6 text-neutral-500" />
  <span className="text-xs font-medium text-neutral-500">
  Instant Generation
  </span>
  </div>
  <div className="flex flex-col items-center gap-2">
  <Users className="w-6 h-6 text-neutral-500" />
  <span className="text-xs font-medium text-neutral-500">
  Team Collaboration
  </span>
  </div>
  <div className="flex flex-col items-center gap-2">
  <Building2 className="w-6 h-6 text-neutral-500" />
  <span className="text-xs font-medium text-neutral-500">
  Industry Optimized
  </span>
 </div>
 </div>
 </div>
 </section>

 {/* Features Preview */}
 <section className="py-24 bg-neutral-50">
 <div className="max-w-7xl mx-auto px-6">
 <div className="grid md:grid-cols-3 gap-8">
 <div className="bg-white p-8 rounded-md border border-neutral-100 shadow-sm hover:shadow-md hover:-translate-y-1 transition-all">
 <div className="w-12 h-12 bg-blue-50 rounded-md flex items-center justify-center text-blue-600 mb-6">
 <MessageSquare className="w-6 h-6" />
 </div>
  <h3 className="text-xl font-semibold mb-4 text-neutral-900">AI-Powered Interviews</h3>
  <p className="text-neutral-600 leading-relaxed text-sm">
  Our intelligent agent conducts structured interviews to capture
  all essential job requirements and competencies.
  </p>
  </div>

  <div className="bg-white p-8 rounded-md border border-neutral-100 shadow-sm hover:shadow-md hover:-translate-y-1 transition-all">
  <div className="w-12 h-12 bg-emerald-50 rounded-md flex items-center justify-center text-emerald-600 mb-6">
  <CheckCircle2 className="w-6 h-6" />
  </div>
  <h3 className="text-xl font-semibold mb-4 text-neutral-900">Approval Workflows</h3>
  <p className="text-neutral-600 leading-relaxed text-sm">
  Streamlined review process with manager and HR approvals,
  complete with real-time status tracking.
  </p>
  </div>

  <div className="bg-white p-8 rounded-md border border-neutral-100 shadow-sm hover:shadow-md hover:-translate-y-1 transition-all">
  <div className="w-12 h-12 bg-purple-50 rounded-md flex items-center justify-center text-purple-600 mb-6">
  <Shield className="w-6 h-6" />
  </div>
  <h3 className="text-xl font-semibold mb-4 text-neutral-900">Enterprise Security</h3>
  <p className="text-neutral-600 leading-relaxed text-sm">
  Bank-level security with role-based access control and
  encrypted data storage for all JD information.
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
