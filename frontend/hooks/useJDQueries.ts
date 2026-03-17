// frontend/hooks/useJDQueries.ts
// Centralised React Query hooks — replaces useState+useEffect fetch patterns.
// Benefits:
//   • Deduplicates identical requests (sidebar + dashboard both call /employee/:id — fires once)
//   • Auto-refetches in background so data stays fresh
//   • Instant cache hit on navigation (no loading spinner on revisit)
//   • Automatic retry on failure

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fetchEmployeeJDs,
  fetchManagerPendingJDs,
  fetchHRPendingJDs,
  fetchHRDepartmentStats,
  fetchDepartmentEmployees,
  fetchUnreadFeedback,
  fetchAllFeedback,
  fetchReviewComments,
  fetchJD,
  updateJDStatus,
  markFeedbackRead,
  createReviewComment,
  type AuthUser,
} from "@/lib/api";

// ── Query Key Factory ─────────────────────────────────────────────────────────
// Centralised keys make it easy to invalidate the right caches after mutations.

export const qk = {
  employeeJDs: (id: string) => ["jds", "employee", id] as const,
  managerJDs: (id: string) => ["jds", "manager", id] as const,
  hrJDs: () => ["jds", "hr"] as const,
  jd: (id: string) => ["jd", id] as const,
  reviews: (jdId: string) => ["reviews", jdId] as const,
  unreadFeedback: (id: string, role: string) =>
    ["feedback", "unread", id, role] as const,
  allFeedback: (id: string, role: string) =>
    ["feedback", "all", id, role] as const,
  deptStats: () => ["hr", "dept-stats"] as const,
  deptEmployees: (dept: string) => ["hr", "dept-employees", dept] as const,
};

// ── Employee JDs (sidebar + dashboard) ───────────────────────────────────────

export function useEmployeeJDs(employeeId: string | null) {
  return useQuery({
    queryKey: qk.employeeJDs(employeeId ?? ""),
    queryFn: () => fetchEmployeeJDs(employeeId!),
    enabled: !!employeeId,
    staleTime: 60_000,          // ← 60s, was 30s
    gcTime: 10 * 60_000,        // ← keep in cache 10min, was default 5min
    refetchOnWindowFocus: false, // ← already in defaultOptions but be explicit
  });
}

// ── Manager pending JDs ───────────────────────────────────────────────────────

export function useManagerJDs(managerId: string | null) {
  return useQuery({
    queryKey: qk.managerJDs(managerId ?? ""),
    queryFn: () => fetchManagerPendingJDs(managerId!),
    enabled: !!managerId,
    staleTime: 30_000,
  });
}

// ── HR pending JDs ────────────────────────────────────────────────────────────

export function useHRJDs() {
  return useQuery({
    queryKey: qk.hrJDs(),
    queryFn: fetchHRPendingJDs,
    staleTime: 60_000,           // ← was 30s
    refetchIntervalInBackground: false,
  });
}

// ── Single JD ────────────────────────────────────────────────────────────────

export function useJD(jdId: string | null) {
  return useQuery({
    queryKey: qk.jd(jdId ?? ""),
    queryFn: () => fetchJD(jdId!),
    enabled: !!jdId,
    staleTime: 15_000,
  });
}

// ── Review comments ───────────────────────────────────────────────────────────

export function useReviewComments(jdId: string | null) {
  return useQuery({
    queryKey: qk.reviews(jdId ?? ""),
    queryFn: () => fetchReviewComments(jdId!),
    enabled: !!jdId,
    staleTime: 15_000,
  });
}

// ── Unread feedback (sidebar badge) ──────────────────────────────────────────

export function useUnreadFeedback(
  employeeId: string | null,
  role: string = "employee"
) {
  return useQuery({
    queryKey: qk.unreadFeedback(employeeId ?? "", role),
    queryFn: () => fetchUnreadFeedback(employeeId!, role),
    // HR also needs feedback — they can see what they've sent to managers
    enabled: !!employeeId && (role === "employee" || role === "manager" || role === "hr"),
    staleTime: 120_000,        // ← 2 min, was 60s
    refetchInterval: 120_000,  // ← 2 min polling, was 60s
    refetchIntervalInBackground: false, // ← don't poll when tab is hidden
  });
}

// ── All feedback ──────────────────────────────────────────────────────────────

export function useAllFeedback(
  employeeId: string | null,
  role: string = "employee"
) {
  return useQuery({
    queryKey: qk.allFeedback(employeeId ?? "", role),
    queryFn: () => fetchAllFeedback(employeeId!, role),
    enabled: !!employeeId,
    staleTime: 60_000,
  });
}

// ── HR department stats ───────────────────────────────────────────────────────

export function useHRDeptStats() {
  return useQuery({
    queryKey: qk.deptStats(),
    queryFn: fetchHRDepartmentStats,
    staleTime: 5 * 60_000,   // stats don't change often — 5 min fresh
  });
}

// ── Department employees ──────────────────────────────────────────────────────

export function useDeptEmployees(deptName: string | null) {
  return useQuery({
    queryKey: qk.deptEmployees(deptName ?? ""),
    queryFn: () => fetchDepartmentEmployees(deptName!, 1, 100),
    enabled: !!deptName,
    staleTime: 2 * 60_000,
  });
}

// ── Mutations ─────────────────────────────────────────────────────────────────

/** Mark a single feedback comment as read; invalidates unread badge. */
export function useMarkFeedbackRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: markFeedbackRead,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["feedback", "unread"] });
      qc.invalidateQueries({ queryKey: ["feedback", "all"] }); // ← also refresh the full list
    },
  });
}
// NEW — was missing entirely
export function useCreateReviewComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      jdId,
      data,
    }: {
      jdId: string;
      data: {
        action: "rejected" | "approved" | "revision_requested";
        target_role: "employee" | "manager";
        comment?: string;
        reviewer_id: string;
      };
    }) => createReviewComment(jdId, data),
    onSuccess: (_data, { jdId }) => {
      // Refresh everything touched by a review action
      qc.invalidateQueries({ queryKey: qk.jd(jdId) });
      qc.invalidateQueries({ queryKey: qk.reviews(jdId) });
      qc.invalidateQueries({ queryKey: ["jds", "manager"] });
      qc.invalidateQueries({ queryKey: qk.hrJDs() });
      qc.invalidateQueries({ queryKey: ["feedback", "unread"] });
    },
  });
}
/** Update JD status (submit / approve / reject); refreshes affected lists. */
export function useUpdateJDStatus(employeeId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      jdId,
      status,
      empId,
    }: {
      jdId: string;
      status: string;
      empId: string;
    }) => updateJDStatus(jdId, { status, employee_id: empId }),
    onSuccess: (_data, { jdId, empId }) => {
      qc.invalidateQueries({ queryKey: qk.employeeJDs(empId) });
      qc.invalidateQueries({ queryKey: qk.hrJDs() });
      qc.invalidateQueries({ queryKey: ["jds", "manager"] });
      qc.invalidateQueries({ queryKey: qk.jd(jdId) });        // ← invalidate single JD
      qc.invalidateQueries({ queryKey: qk.reviews(jdId) });   // ← invalidate its reviews too
    },
  });
}