/**
 * Authentication helper.
 * Enterprise mode: stores identity in persistent Secure Cookies.
 */

import { getCookie, setCookie, deleteCookie, cookieKeys } from "@/lib/cookies";

export type UserRole = "employee" | "manager" | "hr" | "admin";

export type AuthUser = {
  employee_id: string;
  name: string;
  email: string | null;
  role: string;
  department?: string | null;
  reporting_manager?: string | null;
  reporting_manager_code?: string | null;
  phone_mobile?: string | null;
};

// ── Core identity ─────────────────────────────────────────────────────────────

export function getOrCreateEmployeeId(): string {
  if (typeof window === "undefined") return "server_id";

  // If SSO user is logged in, use their real ID
  const user = getCurrentUser();
  if (user?.employee_id) return user.employee_id;

  // Fallback: anonymous dev ID
  let id = getCookie(cookieKeys.EMPLOYEE_ID);
  if (!id) {
    id =
      "emp_" +
      Math.random().toString(36).substring(2, 11) +
      Date.now().toString(36);
    setCookie(cookieKeys.EMPLOYEE_ID, id);
  }
  return id;
}

export function getEmployeeId(): string | null {
  if (typeof window === "undefined") return null;
  return getCookie(cookieKeys.EMPLOYEE_ID);
}

// ── Current logged-in user ────────────────────────────────────────────────────
// Enterprise: reads from secure cookies (set by SSO or login)
// PROD: replace body with → parse JWT from cookie or call /api/me

export function getCurrentUser(): AuthUser | null {
  if (typeof window === "undefined") return null;
  const raw = getCookie(cookieKeys.AUTH_USER);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

// ── Role helpers ──────────────────────────────────────────────────────────────

export const isEmployee = (u: AuthUser | null) => !u || u.role === "employee";
export const isManager = (u: AuthUser | null) => u?.role === "manager";
export const isHR = (u: AuthUser | null) =>
  u?.role === "hr" || u?.role === "admin";
export const canApprove = (u: AuthUser | null) => isManager(u) || isHR(u);

// ── DEV: simulate login ───────────────────────────────────────────────────────
// Run in browser console: devLogin("manager")  or  devLogin("hr")

export function devLogin(role: UserRole): AuthUser {
  const empId =
    getCookie(cookieKeys.EMPLOYEE_ID) ||
    "emp_" +
      Math.random().toString(36).substring(2, 11) +
      Date.now().toString(36);

  const users: Record<UserRole, AuthUser> = {
    employee: {
      employee_id: empId,
      name: "Test Employee",
      email: "employee@company.com",
      role: "employee",
      department: "Engineering",
    },
    manager: {
      employee_id: "mgr_test",
      name: "Test Manager",
      email: "manager@company.com",
      role: "manager",
      department: "Engineering",
    },
    hr: {
      employee_id: "hr_test",
      name: "Test HR",
      email: "hr@company.com",
      role: "hr",
      department: "HR",
    },
    admin: {
      employee_id: "admin_001",
      name: "Admin",
      email: "admin@company.com",
      role: "admin",
      department: "Internal",
    },
  };

  const user = users[role];
  setCookie(cookieKeys.AUTH_USER, JSON.stringify(user));
  setCookie(cookieKeys.EMPLOYEE_ID, user.employee_id);
  return user;
}

export default function devLogout() {
  deleteCookie(cookieKeys.AUTH_USER);
}

// ── API Fetching Functions ────────────────────────────────────────────────────

export const API_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export async function fetchEmployeeJDs(employeeId: string) {
  const res = await fetch(`${API_URL}/jd/employee/${employeeId}`);
  if (res.status === 404) return [];
  if (!res.ok) throw new Error("Failed to fetch employee JDs");
  return res.json();
}

export async function fetchManagerPendingJDs(managerId: string) {
  const res = await fetch(`${API_URL}/jd/manager/${managerId}/pending`);
  if (res.status === 404) return [];
  if (!res.ok) throw new Error("Failed to fetch manager pending JDs");
  return res.json();
}

export async function fetchHRPendingJDs() {
  const res = await fetch(`${API_URL}/jd/hr/pending`);
  if (res.status === 404) return [];
  if (!res.ok) throw new Error("Failed to fetch HR pending JDs");
  return res.json();
}

export async function fetchHRDepartmentStats() {
  const res = await fetch(`${API_URL}/api/hr/department-stats`);
  if (res.status === 404) return [];
  if (!res.ok) throw new Error("Failed to fetch HR Department statistics");
  return res.json();
}

export async function fetchDepartmentEmployees(
  departmentName: string,
  page: number = 1,
  limit: number = 50,
) {
  const encodedName = encodeURIComponent(departmentName);
  const res = await fetch(
    `${API_URL}/api/hr/departments/${encodedName}/employees?page=${page}&limit=${limit}`,
  );
  if (res.status === 404) return [];
  if (!res.ok) throw new Error("Failed to fetch department employees");
  return res.json();
}

// ── Organogram Login ──────────────────────────────────────────────────────────

export async function fetchOrganogramEmployees() {
  const res = await fetch(`${API_URL}/auth/organogram/employees`);
  if (!res.ok) throw new Error("Failed to fetch organogram employees");
  return res.json(); // { employees: [...] }
}

export async function loginWithOrganogram(empCode: string) {
  const res = await fetch(`${API_URL}/auth/sso-sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ emp_code: empCode }),
  });
  if (!res.ok) throw new Error("Failed to login with organogram");
  return res.json(); // { status: "success", employee: AuthUser }
}

export async function fetchEmployeeProfile(empCode: string): Promise<AuthUser> {
  const res = await fetch(`${API_URL}/auth/me/${empCode}`);
  if (!res.ok) {
    const errorText = await res.text().catch(() => "Unknown backend error");
    console.error(
      `Failed to fetch employee profile for ${empCode}: Status ${res.status}.`,
      errorText,
    );
    throw new Error(`Profile fetch failed: ${res.status}`);
  }
  return res.json();
}

export async function initQuestionnaire({
  employee_id,
  employee_name,
}: {
  employee_id: string;
  employee_name: string;
}) {
  const res = await fetch(`${API_URL}/jd/init`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ employee_id, employee_name }),
  });
  if (!res.ok) throw new Error("Failed to init questionnaire");
  return res.json();
}

export async function fetchJD(jdId: string) {
  const res = await fetch(`${API_URL}/jd/${jdId}`);
  if (!res.ok) throw new Error("Failed to fetch JD");
  return res.json();
}

export async function updateJDStatus(
  jdId: string,
  data: { status: string; employee_id: string },
) {
  const res = await fetch(`${API_URL}/jd/${jdId}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      status: data.status,
      employee_id: data.employee_id,
    }),
  });
  if (!res.ok) throw new Error("Failed to update status");
  return res.json();
}

export async function deleteJD(jdId: string, employeeId: string) {
  const res = await fetch(`${API_URL}/jd/${jdId}?employee_id=${employeeId}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Failed to delete JD");
  return res.json();
}

export async function getJDs(params?: { status?: string }) {
  const res = await fetch(`${API_URL}/jd/list`);
  if (res.status === 404) return [];
  if (!res.ok) throw new Error("Failed to fetch all JDs");
  return res.json();
}

export async function approveJD(jdId: string, employeeId: string = "admin") {
  return updateJDStatus(jdId, { status: "approved", employee_id: employeeId });
}

export async function rejectJD(
  jdId: string,
  comment: string,
  employeeId: string = "admin",
) {
  return updateJDStatus(jdId, { status: "rejected", employee_id: employeeId });
}

export async function submitJD(
  jdId: string,
  employeeId: string,
  targetStatus: string = "sent_to_manager",
) {
  return updateJDStatus(jdId, {
    status: targetStatus,
    employee_id: employeeId,
  });
}

export async function submitToManager(
  jdId: string,
  employeeId: string = "admin",
) {
  return updateJDStatus(jdId, {
    status: "sent_to_manager",
    employee_id: employeeId,
  });
}

export async function rejectJDManager(
  jdId: string,
  comment: string,
  employeeId: string = "admin",
) {
  return updateJDStatus(jdId, {
    status: "manager_rejected",
    employee_id: employeeId,
  });
}

export async function sendToHR(jdId: string, employeeId: string = "admin") {
  return updateJDStatus(jdId, {
    status: "sent_to_hr",
    employee_id: employeeId,
  });
}

export async function rejectJDHR(
  jdId: string,
  comment: string,
  employeeId: string = "admin",
) {
  return updateJDStatus(jdId, {
    status: "hr_rejected",
    employee_id: employeeId,
  });
}

export async function updateJD(
  jdId: string,
  data: { jd_text: string; jd_structured: any; employee_id: string },
) {
  const res = await fetch(`${API_URL}/jd/${jdId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to update JD");
  return res.json();
}

export async function sendMessage(
  message: string,
  history: any[],
  sessionId?: string,
) {
  const res = await fetch(`${API_URL}/jd/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, history, id: sessionId }),
  });
  if (!res.ok) throw new Error("Failed to send message");
  return res.json();
}

export async function generateJD(data: { id: string }) {
  const res = await fetch(`${API_URL}/jd/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(errorText || "Failed to generate JD");
  }
  return res.json();
}

export async function saveJD(data: {
  id: string;
  jd_text: string;
  jd_structured: any;
  employee_id: string;
}) {
  const res = await fetch(`${API_URL}/jd/save`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(errorText || "Failed to save JD");
  }
  return res.json();
}

// ── Review / Feedback API ─────────────────────────────────────────────────────

export async function createReviewComment(
  jdId: string,
  data: {
    action: "rejected" | "approved" | "revision_requested";
    target_role: "employee" | "manager";
    comment?: string;
    reviewer_id: string;
  },
) {
  const res = await fetch(`${API_URL}/jd/${jdId}/review`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to submit review");
  return res.json();
}

export async function fetchReviewComments(jdId: string) {
  const res = await fetch(`${API_URL}/jd/${jdId}/reviews`);
  if (!res.ok) throw new Error("Failed to fetch review comments");
  return res.json();
}

export async function fetchUnreadFeedback(
  employeeId: string,
  role: string = "employee",
) {
  const res = await fetch(`${API_URL}/jd/feedback/${employeeId}?role=${role}`);
  if (!res.ok) throw new Error("Failed to fetch feedback");
  return res.json();
}

export async function fetchAllFeedback(
  employeeId: string,
  role: string = "employee",
) {
  const res = await fetch(
    `${API_URL}/jd/feedback/all/${employeeId}?role=${role}`,
  );
  if (!res.ok) throw new Error("Failed to fetch all feedback");
  return res.json();
}

export async function markFeedbackRead(commentId: string) {
  const res = await fetch(`${API_URL}/jd/feedback/${commentId}/read`, {
    method: "PATCH",
  });
  if (!res.ok) throw new Error("Failed to mark feedback as read");
  return res.json();
}
