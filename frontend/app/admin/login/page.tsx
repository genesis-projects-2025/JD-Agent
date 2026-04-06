"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { API_URL } from "@/lib/api";
import { Lock, User, Loader2, Eye, EyeOff } from "lucide-react";
import { setCookie, cookieKeys } from "@/lib/cookies";

export default function AdminLoginPage() {
 const router = useRouter();
 const [code, setCode] = useState("");
 const [password, setPassword] = useState("");
 const [loading, setLoading] = useState(false);
 const [error, setError] = useState("");
 const [showPassword, setShowPassword] = useState(false);

 const handleLogin = async (e: React.FormEvent) => {
 e.preventDefault();
 setLoading(true);
 setError("");

 try {
 const res = await fetch(`${API_URL}/auth/admin-login`, {
 method: "POST",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({ code, password }),
 });

 if (!res.ok) {
 throw new Error("Invalid admin credentials");
 }

 const data = await res.json();

 // Store admin token and role using enterprise cookies
 setCookie(cookieKeys.ADMIN_TOKEN, data.token);
 setCookie(cookieKeys.USER_ROLE, data.role);

 router.push("/admin/dashboard");
 } catch (err: any) {
 setError(err.message || "Failed to login");
 } finally {
 setLoading(false);
 }
 };

 return (
 <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900 overflow-hidden text-slate-100">
 {/* Background Decor */}
 <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-600/20 rounded-md blur-[120px]" />
 <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-purple-600/20 rounded-md blur-[120px]" />

 <div className="relative z-10 w-full max-w-md p-6 sm:p-8 m-4 bg-slate-800/50 backdrop-blur-xl border border-slate-700 rounded-md shadow-md">
 <div className="text-center mb-8 sm:mb-10">
 <div className="mx-auto w-16 h-16 bg-blue-500/10 rounded-md flex items-center justify-center mb-6 border border-blue-500/20">
 <Lock className="w-8 h-8 text-blue-400" />
 </div>
 <h1 className="text-2xl sm:text-3xl font-medium bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
 Admin Portal
 </h1>
 <p className="text-sm sm:text-base text-slate-400 mt-2">
 Sign in to access the Admin Console
 </p>
 </div>

 <form onSubmit={handleLogin} className="space-y-6">
 {error && (
 <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-md text-red-400 text-sm text-center">
 {error}
 </div>
 )}

 <div className="space-y-2">
 <label className="text-sm font-medium text-slate-300 ml-1">
 Admin UserName
 </label>
 <div className="relative">
 <User className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
 <input
 type="text"
 value={code}
 onChange={(e) => setCode(e.target.value)}
 autoComplete="off"
 className="w-full bg-slate-900/50 border border-slate-700 text-slate-100 px-11 py-3 sm:py-3.5 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all font-medium text-sm sm:text-base"
 placeholder="Enter admin code"
 disabled={loading}
 />
 </div>
 </div>

 <div className="space-y-2">
 <label className="text-sm font-medium text-slate-300 ml-1">
 Password
 </label>
 <div className="relative">
 <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
 <input
 type={showPassword ? "text" : "password"}
 value={password}
 onChange={(e) => setPassword(e.target.value)}
 autoComplete="current-password"
 className="w-full bg-slate-900/50 border border-slate-700 text-slate-100 px-11 py-3 sm:py-3.5 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all font-medium text-sm sm:text-base pr-12"
 placeholder="••••••••"
 disabled={loading}
 />
 <button
 type="button"
 onClick={() => setShowPassword(!showPassword)}
 className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
 disabled={loading}
 >
 {showPassword ? (
 <EyeOff className="w-5 h-5" />
 ) : (
 <Eye className="w-5 h-5" />
 )}
 </button>
 </div>
 </div>

 <button
 type="submit"
 disabled={loading || !code || !password}
 className="w-full py-3.5 sm:py-4 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white rounded-md font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center shadow-md shadow-blue-900/20 text-sm sm:text-base"
 >
 {loading ? (
 <Loader2 className="w-5 h-5 animate-spin" />
 ) : (
 "Access Dashboard"
 )}
 </button>
 </form>
 </div>
 </div>
 );
}
