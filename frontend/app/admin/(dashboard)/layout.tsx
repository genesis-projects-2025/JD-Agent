"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
 LayoutDashboard,
 Users,
 LogOut,
 FileText,
 Megaphone,
 Menu,
 X,
 ShieldCheck,
 Activity,
} from "lucide-react";
import { useEffect, useState } from "react";
import { getCookie, deleteCookie, cookieKeys } from "@/lib/cookies";

export default function AdminLayout({
 children,
}: {
 children: React.ReactNode;
}) {
 const pathname = usePathname();
 const router = useRouter();
 const [mounted, setMounted] = useState(false);
 const [isMobileOpen, setIsMobileOpen] = useState(false);
 const [isAuthenticated, setIsAuthenticated] = useState(false);

 useEffect(() => {
 setMounted(true);
 // Protect routes
 const token = getCookie(cookieKeys.ADMIN_TOKEN);
 const role = getCookie(cookieKeys.USER_ROLE);

 if (!token || role !== "ADMIN") {
 router.push("/admin/login");
 } else {
 setIsAuthenticated(true);
 }
 }, [router]);

 useEffect(() => {
 // Close sidebar on navigation on mobile
 setIsMobileOpen(false);
 }, [pathname]);

 const handleLogout = () => {
 deleteCookie(cookieKeys.ADMIN_TOKEN);
 deleteCookie(cookieKeys.USER_ROLE);
 setIsAuthenticated(false);
 router.push("/admin/login");
 };

 if (!mounted || !isAuthenticated) return null; // Prevent hydration errors and flicker

 const navItems = [
 { label: "Dashboard", href: "/admin/dashboard", icon: LayoutDashboard },
 { label: "Feedback Inbox", href: "/admin/feedback", icon: Megaphone },
 ];

 return (
 <div className="h-[100dvh] w-full bg-slate-50 flex relative overflow-hidden font-sans">
 {/* Mobile Backdrop */}
 {isMobileOpen && (
 <div
 className="md:hidden fixed inset-0 bg-slate-950/80 z-[60] backdrop-blur-md transition-opacity animate-in fade-in duration-300"
 onClick={() => setIsMobileOpen(false)}
 aria-hidden="true"
 />
 )}

 {/* Sidebar */}
 <aside
 className={`
 fixed inset-y-0 left-0 z-[70]
 md:relative md:z-10
 w-80 bg-slate-900 text-slate-400 flex flex-col border-r border-slate-800 shadow-md
 transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)] will-change-transform
 ${isMobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"}
 `}
 >
 <div className="p-8 pb-4 flex items-center justify-between">
 <div className="flex items-center gap-4">
 <div className="w-12 h-12 rounded-md bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white text-xl shadow-md shadow-blue-900/40 border border-blue-400/20">
 <ShieldCheck className="w-6 h-6" />
 </div>
 <div>
 <h2 className="text-xl font-medium text-white ">
 Admin
 </h2>
 <p className="text-[10px] font-medium text-slate-500">
 Pulse Pharma
 </p>
 </div>
 </div>
 <button
 onClick={() => setIsMobileOpen(false)}
 className="md:hidden p-2.5 text-slate-400 hover:text-white bg-slate-800 rounded-md hover:bg-slate-700 transition-all font-medium group"
 >
 <X className="w-6 h-6 transition-transform group-hover:rotate-90" />
 </button>
 </div>

 <nav className="flex-1 px-6 space-y-2 mt-8 overflow-y-auto custom-scrollbar">
 <div className="text-[10px] font-medium text-slate-600 tracking-[0.2em] mb-4 ml-2">
 Navigation
 </div>
 {navItems.map((item) => {
 const isActive = pathname.startsWith(item.href);
 return (
 <Link
 key={item.href}
 href={item.href}
 className={`flex items-center gap-4 px-5 py-4 rounded-md transition-all group relative ${
 isActive
 ? "bg-blue-600 text-white shadow-md shadow-blue-900/40"
 : "hover:bg-slate-800/50 hover:text-white"
 }`}
 >
 <item.icon
 className={`w-5 h-5 transition-transform group-hover:scale-110 ${isActive ? "text-white" : "text-slate-500"}`}
 />
 <span className="font-medium text-sm">{item.label}</span>
 {isActive && (
 <div className="absolute right-4 w-1.5 h-1.5 bg-white rounded-md animate-pulse shadow-[0_0_8px_white]"></div>
 )}
 </Link>
 );
 })}
 </nav>

 <div className="p-6 mt-auto border-t border-slate-800/50">
 <button
 onClick={handleLogout}
 aria-label="Sign out of admin"
 className="flex items-center justify-center gap-3 px-6 py-4 w-full rounded-md bg-slate-800/50 text-slate-400 hover:bg-red-500/10 hover:text-red-400 border border-slate-700/50 transition-all font-medium group text-[11px] "
 >
 <LogOut className="w-4 h-4 transition-transform group-hover:-translate-x-1" />
 Sign Out
 </button>
 </div>
 </aside>

 {/* Main Content Area */}
 <main className="flex-1 flex flex-col h-full w-full relative overflow-hidden">
 <header className="h-24 bg-white/80 backdrop-blur-xl border-b border-slate-200 flex items-center justify-between px-6 sm:px-12 z-50 sticky top-0 transition-all">
 <div className="flex items-center gap-6">
 <button
 onClick={() => setIsMobileOpen(true)}
 className="md:hidden p-3 text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-md transition-all border border-slate-200 shadow-sm active:scale-95"
 aria-label="Toggle menu"
 >
 <Menu className="w-6 h-6" />
 </button>
 <div className="space-y-1">
 <h1 className="text-2xl font-medium text-slate-900 sm:block hidden lg:text-3xl">
 {navItems.find((i) => pathname.startsWith(i.href))?.label ||
 "Intelligence Console"}
 </h1>
 <div className="flex items-center gap-2">
 <div className="w-2 h-2 rounded-md bg-blue-500 animate-pulse"></div>
 <span className="text-[10px] font-medium text-slate-400 ">
 Optimal Status
 </span>
 </div>
 </div>
 </div>

 <div className="flex items-center gap-4 sm:gap-6">
 <div className="hidden sm:flex flex-col items-end">
 <span className="text-sm font-medium text-slate-900">
 Administrator
 </span>
 <span className="text-[10px] font-medium text-blue-600 bg-blue-50 px-3 py-1 rounded-md border border-blue-100 ">
 Admin Console
 </span>
 </div>
 <div className="relative group">
 <div className="absolute -inset-1 bg-gradient-to-tr from-blue-500 to-indigo-600 rounded-md blur opacity-40 group-hover:opacity-100 transition duration-500"></div>
 <div className="relative w-12 h-12 bg-slate-100 rounded-md flex items-center justify-center text-slate-900 font-medium border-2 border-white shadow-md cursor-default overflow-hidden group-hover:scale-110 transition-transform">
 <span className="text-lg">M</span>
 </div>
 </div>
 </div>
 </header>

 <div className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 bg-slate-50/50 scroll-smooth custom-scrollbar">
 <div className="w-full pb-10">{children}</div>
 </div>
 </main>
 </div>
 );
}
