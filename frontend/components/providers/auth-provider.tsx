"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, ShieldAlert } from "lucide-react";
import { loginWithOrganogram } from "@/lib/api";
import { getCookie, setCookie, deleteCookie, cookieKeys } from "@/lib/cookies";

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
      // 1. URL check for `?emp_cd=...` (High priority)
      const urlEmpCode = searchParams.get("emp_cd");

      // 2. Local Cache check (Fast path - using Cookies)
      const cachedId = getCookie(cookieKeys.EMPLOYEE_ID);
      if (cachedId && !urlEmpCode) {
        setEmployeeId(cachedId);
        setIsLoading(false); // Immediate interactive state
      }

      if (urlEmpCode) {
        setIsLoading(true);
        setError(null);
        try {
          const res = await loginWithOrganogram(urlEmpCode);
          const emp = res.employee;

          setCookie(cookieKeys.AUTH_USER, JSON.stringify(emp));
          setCookie(cookieKeys.EMPLOYEE_ID, emp.employee_id);
          setEmployeeId(emp.employee_id);

          // Clean URL
          const newUrl = window.location.pathname;
          router.replace(newUrl);
        } catch (err: any) {
          console.error("Auth Failure:", err.message);
          setError("Invalid Employee Code or Unauthorized Access.");
          deleteCookie(cookieKeys.AUTH_USER);
          deleteCookie(cookieKeys.EMPLOYEE_ID);
        } finally {
          setIsLoading(false);
        }
      } else if (!cachedId) {
        setIsLoading(false);
      }
    };

    authenticate();
  }, [searchParams, router]);

  const logout = () => {
    deleteCookie(cookieKeys.EMPLOYEE_ID);
    deleteCookie(cookieKeys.AUTH_USER);
    setEmployeeId(null);
    router.push("/");
  };

  // Only block if we are actually waiting for a NEW login from URL
  const isBlocking = isLoading && searchParams.get("emp_cd");

  if (isBlocking) {
    return (
      <div className="min-h-screen bg-surface-50 flex flex-col items-center justify-center p-6">
        <Loader2 className="w-10 h-10 text-primary-600 animate-spin mb-4" />
        <p className="text-sm font-bold text-surface-400 uppercase tracking-widest animate-pulse">
          Authenticating Profile...
        </p>
      </div>
    );
  }

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
          <p className="text-surface-500 font-medium mb-8 leading-relaxed text-sm">
            Employee code invalid. Please use a valid Pulse Pharma Code.
          </p>
          <button
            onClick={() => {
              setError(null);
              router.push("/");
            }}
            className="w-full py-3 bg-surface-100 text-surface-700 font-bold rounded-xl hover:bg-surface-200 transition-colors"
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
