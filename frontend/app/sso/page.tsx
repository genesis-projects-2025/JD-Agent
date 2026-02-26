"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { API_URL } from "@/lib/api";

function SSOSync() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const syncUser = async () => {
      const employee_id = searchParams.get("employee_id");
      if (!employee_id) {
        setError(
          "Missing employee_id in URL. Test by adding ?employee_id=emp_001&role=manager&name=Test",
        );
        return;
      }

      try {
        const res = await fetch(`${API_URL}/auth/sso-sync`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            emp_code: employee_id,
          }),
        });

        if (!res.ok) {
          throw new Error("Failed to sync SSO user with backend");
        }

        const data = await res.json();

        // Save to localStorage matching auth.ts and api.ts AuthUser type expectations
        localStorage.setItem("auth_user", JSON.stringify(data.employee));
        localStorage.setItem("employee_id", data.employee.employee_id);

        // Redirect to their dashboard
        router.push(`/dashboard/${data.employee.employee_id}`);
      } catch (err: any) {
        console.error("SSO Error:", err);
        setError(err.message || "SSO Sync Failed");
      }
    };

    syncUser();
  }, [searchParams, router]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-red-50 text-red-600 font-bold p-8">
        <div className="max-w-md text-center">
          <p className="text-xl mb-4">SSO Authentication Failed</p>
          <p className="text-sm font-normal px-4 py-2 bg-red-100 rounded-md">
            {error}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50">
      <Loader2 className="w-12 h-12 text-blue-600 animate-spin mb-4" />
      <h1 className="text-lg font-bold text-slate-800">
        Authenticating via SSO...
      </h1>
      <p className="text-sm text-slate-500 mt-2">
        Please wait while we log you in securely.
      </p>
    </div>
  );
}

export default function SSOCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
        </div>
      }
    >
      <SSOSync />
    </Suspense>
  );
}
