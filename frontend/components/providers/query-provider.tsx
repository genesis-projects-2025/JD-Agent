// frontend/components/providers/query-provider.tsx
"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

export function QueryProvider({ children }: { children: React.ReactNode }) {
  // Create one QueryClient per browser session.
  // useState ensures it isn't recreated on every render.
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Don't refetch when the user just switches browser tabs
            refetchOnWindowFocus: false,
            // Keep successful data fresh for 30 s before background refetch
            staleTime: 30_000,
            // Keep unused data in cache for 5 minutes
            gcTime: 5 * 60_000,
            
            // ── FIX: Custom retry logic ──
            // Do not retry 4xx errors (like 404 Not Found, 403 Forbidden)
            // because retrying them is pointless and spams the network.
            retry: (failureCount, error: any) => {
              const status = error?.response?.status || error?.status;
              if (status >= 400 && status < 500) {
                return false; // Do not retry client errors
              }
              // Only retry once for server errors (like 500) or network issues
              return failureCount < 1; 
            },
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}