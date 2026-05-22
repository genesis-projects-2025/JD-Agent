"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { API_URL } from "@/lib/api";
import { setCookie, cookieKeys } from "@/lib/cookies";

function SSOSync() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const syncUser = async () => {
      let employee_id = searchParams.get("employee_id");
      
      // Decode if it's base64 encoded
      if (employee_id) {
        try {
          const decoded = atob(employee_id);
          // If decoding succeeds but results in garbage characters (like when atob("E10695") returns "]:÷"),
          // we should stick with the original string. Valid decoded IDs should be printable characters.
          // Most employee IDs are alphanumeric (e.g., E10695).
          if (/^[a-zA-Z0-9_-]+$/.test(decoded)) {
            employee_id = decoded;
          }
        } catch (e) {
          // Use as-is if not base64
        }
      }

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
          setError(
            `Invalid authentication code or server error: ${res.status}`,
          );
          return;
        }

        const data = await res.json();

        // Save to cookies to match the rest of the application
        setCookie(cookieKeys.AUTH_USER, JSON.stringify(data.employee));
        setCookie(cookieKeys.EMPLOYEE_ID, data.employee.employee_id);

        // Redirect to their home page with base64 encoding for the ID
        const encodedId = btoa(data.employee.employee_id);
        router.push(`/home/${encodedId}`);
      } catch (err: unknown) {
        const errorMessage =
          err instanceof Error ? err.message : "Unknown error";
        // Only log actual network crashes here
        console.warn("Network or SSO Sync Error:", errorMessage);
        setError("Network Error: Could not reach the authentication server.");
      }
    };

    syncUser();
  }, [searchParams, router]);

  if (error) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-red-50 text-red-600 font-medium p-8">
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
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-slate-50">
      <Loader2 className="w-12 h-12 text-blue-600 animate-spin mb-4" />
      <h1 className="text-lg font-medium text-slate-800">
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
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
        </div>
      }
    >
      <SSOSync />
    </Suspense>
  );
}
