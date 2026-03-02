import { getCurrentUser } from "./api";

/**
 * Modern SSO helper to fetch the active authenticated user from sessionStorage.
 * Replaces the legacy random-generation fallback.
 */

export function getOrCreateEmployeeId(): string {
  if (typeof window === "undefined") return "server_id";

  const user = getCurrentUser();
  if (user && user.employee_id) {
    return user.employee_id;
  }

  // Failsafe (should never hit if SSO is active)
  return "UNKNOWN_USER";
}

export function getEmployeeId(): string | null {
  if (typeof window === "undefined") return null;

  const user = getCurrentUser();
  return user ? user.employee_id : null;
}
