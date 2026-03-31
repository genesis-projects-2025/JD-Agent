// frontend/components/providers/query-provider.tsx
// Wrap the app with React Query so all components can use useQuery / useMutation.
// This replaces scattered useState + useEffect + fetch patterns with cached,
// auto-refreshing queries that deduplicate identical in-flight requests.

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
 // Retry failed requests once before showing an error
 retry: 1,
 },
 },
 })
 );

 return (
 <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
 );
}
