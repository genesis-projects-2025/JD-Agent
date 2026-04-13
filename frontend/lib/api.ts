/**
 * Authentication helper.
 * Enterprise mode: stores identity in persistent Secure Cookies.
 */

import { getCookie, setCookie, deleteCookie, cookieKeys } from "@/lib/cookies";

export type UserRole = "employee" | "manager" | "head" | "hr" | "admin";


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
export const isManager = (u: AuthUser | null) => u?.role === "manager" || u?.role === "head";
export const isHead = (u: AuthUser | null) => u?.role === "head";
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
    head: {
      employee_id: "head_test",
      name: "Test Head",
      email: "head@company.com",
      role: "head",
      department: "Engineering",
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

/** Fetch with automatic timeout (default 30s). Prevents infinite hangs. */
function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const empId = getCookie(cookieKeys.EMPLOYEE_ID);
  const headers = {
    ...options.headers,
    ...(empId ? { "X-Employee-ID": empId } : {}),
  } as any;

  return fetch(url, { ...options, headers, signal: controller.signal }).finally(() =>
    clearTimeout(timer)
  );
}

export async function fetchEmployeeJDs(employeeId: string) {
  const res = await fetchWithTimeout(`${API_URL}/jd/employee/${employeeId}`);
  if (res.status === 404) return [];
  if (!res.ok) throw new Error("Failed to fetch employee JDs");
  return res.json();
}

export async function fetchManagerPendingJDs(managerId: string) {
  const res = await fetchWithTimeout(`${API_URL}/jd/manager/${managerId}/pending`);
  if (res.status === 404) return [];
  if (!res.ok) throw new Error("Failed to fetch manager pending JDs");
  return res.json();
}

export async function fetchHRPendingJDs() {
  const res = await fetchWithTimeout(`${API_URL}/jd/hr/pending`);
  if (res.status === 404) return [];
  if (!res.ok) throw new Error("Failed to fetch HR pending JDs");
  return res.json();
}

export async function fetchHRDepartmentStats() {
  const res = await fetchWithTimeout(`${API_URL}/api/hr/department-stats`);
  if (res.status === 404) return [];
  if (!res.ok) throw new Error("Failed to fetch HR Department statistics");
  return res.json();
}

export async function fetchDepartmentEmployees(
  departmentName: string,
  page: number = 1,
  limit: number = 50,
  submittedOnly: boolean = false,
) {
  const encodedName = encodeURIComponent(departmentName);
  const res = await fetchWithTimeout(
    `${API_URL}/api/hr/departments/${encodedName}/employees?page=${page}&limit=${limit}&only_submitted=${submittedOnly}`,
  );
  if (res.status === 404) return [];
  if (!res.ok) throw new Error("Failed to fetch department employees");
  return res.json();
}

export async function fetchMyTeamStats(empCode: string) {
  const res = await fetchWithTimeout(`${API_URL}/api/hr/my-team-stats?emp_code=${empCode}`);
  if (!res.ok) throw new Error("Failed to fetch team statistics");
  return res.json();
}

export async function fetchMyTeamEmployees(
  empCode: string,
  page: number = 1,
  limit: number = 50
) {
  const res = await fetchWithTimeout(
    `${API_URL}/api/hr/my-team-employees?emp_code=${empCode}&page=${page}&limit=${limit}`
  );
  if (res.status === 404) return [];
  if (!res.ok) throw new Error("Failed to fetch team employees");
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
export async function confirmSkills(jdId: string, skills: string[]) {
  const res = await fetch(`${API_URL}/jd/${jdId}/confirm-skills`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ skills }),
  });
  if (!res.ok) throw new Error("Failed to confirm skills");
  return res.json();
}

export async function confirmTools(jdId: string, tools: string[]) {
  const res = await fetch(`${API_URL}/jd/${jdId}/confirm-tools`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tools }),
  });
  if (!res.ok) throw new Error("Failed to confirm tools");
  return res.json();
}

export async function confirmPriorityTasks(jdId: string, priority_tasks: string[]) {
  const res = await fetch(`${API_URL}/jd/${jdId}/confirm-priority-tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ priority_tasks }),
  });
  if (!res.ok) throw new Error("Failed to confirm priority tasks");
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

export async function getJDs(params?: { submitted_only?: boolean }) {
  let url = `${API_URL}/jd/list`;
  if (params?.submitted_only) {
    url += `?submitted_only=true`;
  }
  const res = await fetch(url);
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
  const data = await res.json();
  
  console.group("🧠 JD-Agent Memory (Sync)");
  console.log("Agent:", data.current_agent);
  console.log("Insights:", data.employee_role_insights);
  console.log("Progress:", data.progress);
  console.groupEnd();

  return data;
}

export async function sendMessageStream(
  message: string,
  history: any[],
  sessionId: string | undefined,
  onChunk: (chunk: string) => void,
  onDone: (data: any) => void,
  onError: (error: any) => void
) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 90_000); // 90s hard timeout

  try {
    const res = await fetch(`${API_URL}/jd/chat/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, history, id: sessionId }),
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`Stream failed: ${res.status}`);
    }

    const reader = res.body?.getReader();
    if (!reader) throw new Error("No readable stream");

    const decoder = new TextDecoder("utf-8");
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process ALL complete SSE events in the buffer
      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const raw = buffer.slice(0, boundary).trim();
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf("\n\n");

        if (!raw.startsWith("data: ")) continue;
        const dataStr = raw.slice(6).trim();
        if (!dataStr || dataStr === "[DONE]") continue;

        try {
          const parsed = JSON.parse(dataStr);
          if (parsed.type === "chunk" && parsed.content) {
            onChunk(parsed.content);
          } else if (parsed.type === "done") {
            console.group("🧠 JD-Agent Memory (Stream)");
            console.log("Agent:", parsed.parsed.current_agent);
            console.log("Insights:", parsed.parsed.employee_role_insights);
            console.log("Progress:", parsed.parsed.progress);
            console.groupEnd();
            
            onDone(parsed.parsed);
            return; // clean exit
          } else if (parsed.type === "error") {
            const error = new Error(parsed.message || "Stream error") as any;
            if (parsed.is_rate_limit) error.isRateLimit = true;
            onError(error);
            return;
          }
        } catch {
          // Partial JSON in a single SSE event is a server bug — log it
          console.warn("Failed to parse SSE event:", dataStr.slice(0, 100));
        }
      }
    }
  } catch (err: any) {
    if (err.name === "AbortError") {
      onError(new Error("Stream timed out after 90 seconds"));
    } else {
      onError(err);
    }
  } finally {
    clearTimeout(timeoutId);
  }
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

export function downloadJDDocx(sessionId: string): void {
  // Use path-based filename for maximum reliability
  const cleanFilename = "Pulse_Pharma_Job_Description.docx";
  const downloadUrl = `${API_URL}/jd/${sessionId}/download/docx/${cleanFilename}`;
  window.location.assign(downloadUrl);
}
export function downloadJDPdf(sessionId: string): void {
  // Use path-based filename for maximum reliability
  // This ensures the browser sees the .pdf extension as part of the location
  const cleanFilename = "Pulse_Pharma_Job_Description.pdf";
  const downloadUrl = `${API_URL}/jd/${sessionId}/download/pdf/${cleanFilename}`;
  window.location.assign(downloadUrl);
}
