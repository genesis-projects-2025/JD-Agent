"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, ShieldAlert } from "lucide-react";
import { loginWithOrganogram } from "@/lib/api";

interface AuthContextType {
  employeeId: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType>({
  employeeId: null,
  isAuthenticated: false,
  isLoading: true,
  logout: () => {},
});

export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const authenticate = async () => {
      // 1. Check URL for `?emp_cd=...`
      const urlEmpCode = searchParams.get("emp_cd");

      if (urlEmpCode) {
        setIsLoading(true);
        setError(null);
        try {
          // Sync with Postgres organogram
          const res = await loginWithOrganogram(urlEmpCode);
          const emp = res.employee;

          // Cache session carefully in sessionStorage so tabs are isolated
          sessionStorage.setItem("auth_user", JSON.stringify(emp));
          sessionStorage.setItem("employee_id", emp.employee_id);
          setEmployeeId(emp.employee_id);

          // Console Debugger for the user
          console.group(
            `%c🚀 AUTHENTICATED: ${emp.employee_id}`,
            "color: #10b981; font-weight: bold; font-size: 14px",
          );
          console.log(
            "%cEmployee Data:",
            "color: #3b82f6; font-weight: bold",
            emp,
          );
          console.groupEnd();

          // Clean up the URL parameter natively so they don't share authenticated raw links
          const newUrl = window.location.pathname;
          router.replace(newUrl);
        } catch (err: any) {
          console.error("Auth Failure:", err);
          setError("Invalid Employee Code or Unauthorized Access.");
          sessionStorage.removeItem("auth_user");
          sessionStorage.removeItem("employee_id");
        } finally {
          setIsLoading(false);
          return;
        }
      }

      // 2. No URL param — Check Session Storage Cache fallback
      const cachedId = sessionStorage.getItem("employee_id");
      if (cachedId) {
        setEmployeeId(cachedId);
      }

      setIsLoading(false);
    };

    authenticate();
  }, [searchParams, router]);

  const logout = () => {
    sessionStorage.removeItem("employee_id");
    sessionStorage.removeItem("auth_user");
    setEmployeeId(null);
    router.push("/"); // Boot to landing
  };

  // Render blocking state for mid-auth
  if (isLoading) {
    return (
      <div className="min-h-screen bg-surface-50 flex flex-col items-center justify-center p-6">
        <Loader2 className="w-10 h-10 text-primary-600 animate-spin mb-4" />
        <p className="text-sm font-bold text-surface-400 uppercase tracking-widest animate-pulse">
          Authenticating Profile...
        </p>
      </div>
    );
  }

  // Hard block for invalid codes
  if (error) {
    return (
      <div className="min-h-screen bg-surface-50 flex items-center justify-center p-6">
        <div className="bg-white p-8 rounded-3xl shadow-xl max-w-md w-full text-center border border-red-100">
          <div className="w-16 h-16 bg-red-50 text-red-600 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <ShieldAlert className="w-8 h-8" />
          </div>
          <h2 className="text-2xl font-black text-surface-900 mb-2">
            Access Denied
          </h2>
          <p className="text-surface-500 font-medium mb-8 leading-relaxed">
            The employee code provided does not exist within the Pulse Pharma
            active directory.
          </p>
          <button
            onClick={() => {
              setError(null);
              router.push("/");
            }}
            className="w-full py-3.5 bg-surface-100 text-surface-700 font-bold rounded-xl hover:bg-surface-200 transition-colors"
          >
            Return to Home
          </button>
        </div>
      </div>
    );
  }

  return (
    <AuthContext.Provider
      value={{ employeeId, isAuthenticated: !!employeeId, isLoading, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
}
