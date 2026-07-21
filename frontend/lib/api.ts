/**
 * Authentication helper.
 * Enterprise mode: stores identity in persistent Secure Cookies.
 */

import { getCookie, setCookie, deleteCookie, cookieKeys } from "@/lib/cookies";
import type { JDAgentResponse } from "@/types/jd-agent";
import type {
  ReferenceJDDetailResponse,
  ReferenceJDListResponse,
  ReferenceJDPreviewResponse,
  ReferenceJDRecord,
} from "@/types/reference-jd";
import type {
  SessionConversationTurn,
  SessionDetail,
  SessionListItem,
} from "@/types/session";

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

export type ApiError = Error & {
  status?: number;
  detail?: string;
  isRateLimit?: boolean;
};

export type RequestHistoryItem = SessionConversationTurn;

export interface AdminPublishResponse {
  status: string;
  message: string;
  data: {
    reference_jd_id: string;
    jd_session_id: string;
    employee_id: string;
    processing_status: string;
    published_at?: string | null;
  };
}

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
  } as HeadersInit;

  return fetch(url, { ...options, headers, signal: controller.signal }).finally(() =>
    clearTimeout(timer)
  );
}

export async function fetchEmployeeJDs(employeeId: string): Promise<SessionListItem[]> {
  const res = await fetchWithTimeout(`${API_URL}/jd/employee/${employeeId}`);
  if (res.status === 404) return [];
  if (!res.ok) throw new Error("Failed to fetch employee JDs");
  return res.json();
}

export interface RoleTemplateResponse {
  exists: boolean;
  id?: string;
  title?: string;
  department?: string;
  jd_text?: string;
  jd_structured?: Record<string, any>;
  version?: number;
  updated_at?: string | null;
  message?: string;
}

export async function fetchEmployeeRoleTemplate(employeeId: string): Promise<RoleTemplateResponse> {
  const res = await fetchWithTimeout(`${API_URL}/jd/employee/${employeeId}/role-template`);
  if (!res.ok) throw new Error("Failed to fetch employee role template");
  return res.json();
}

export async function fetchManagerPendingJDs(managerId: string): Promise<SessionListItem[]> {
  const res = await fetchWithTimeout(`${API_URL}/jd/manager/${managerId}/pending`);
  if (res.status === 404) return [];
  if (!res.ok) throw new Error("Failed to fetch manager pending JDs");
  return res.json();
}

export async function fetchHRPendingJDs(): Promise<SessionListItem[]> {
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

export async function searchEmployees(
  query: string,
  page: number = 1,
  limit: number = 50,
) {
  const encodedQuery = encodeURIComponent(query);
  const res = await fetchWithTimeout(
    `${API_URL}/api/hr/search-employees?q=${encodedQuery}&page=${page}&limit=${limit}`,
  );
  if (res.status === 404) return [];
  if (!res.ok) throw new Error("Failed to search employees");
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
  template_session_id,
}: {
  employee_id: string;
  employee_name: string;
  template_session_id?: string;
}) {
  const url = template_session_id
    ? `${API_URL}/jd/init?template_session_id=${encodeURIComponent(template_session_id)}`
    : `${API_URL}/jd/init`;
  const res = await fetch(url, {
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
export async function fetchJD(jdId: string): Promise<SessionDetail> {
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
  return res.json() as Promise<SessionListItem[]>;
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
  data: { jd_text: string; jd_structured: Record<string, unknown>; employee_id: string },
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
  history: RequestHistoryItem[],
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

  return data as { reply: string; history: RequestHistoryItem[] };
}

export async function sendMessageStream(
  message: string,
  history: RequestHistoryItem[],
  sessionId: string | undefined,
  onChunk: (chunk: string) => void,
  onDone: (data: JDAgentResponse) => void,
  onError: (error: ApiError) => void,
  onStatus?: (status: string) => void
) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 300_000); // 5 min hard timeout — covers LLM extraction + RAG + generation

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
          if (parsed.type === "chunk" && parsed.content !== undefined) {
            onChunk(parsed.content);
          } else if (parsed.type === "status" && parsed.content) {
            if (onStatus) onStatus(parsed.content);
          } else if (parsed.type === "done") {
            console.group("🧠 JD-Agent Memory (Stream)");
            console.log("Agent:", parsed.parsed.current_agent);
            console.log("Insights:", parsed.parsed.employee_role_insights);
            console.log("Progress:", parsed.parsed.progress);
            console.groupEnd();
            
            onDone(parsed.parsed as JDAgentResponse);
            return; // clean exit
          } else if (parsed.type === "error") {
            const error = new Error(parsed.message || "Stream error") as ApiError;
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
  } catch (err: unknown) {
    const error = err as ApiError;
    if (error.name === "AbortError") {
      onError(
        new Error(
          "Stream timed out. The server is taking too long to respond. Please try again.",
        ) as ApiError,
      );
    } else {
      onError(error);
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
  jd_structured: Record<string, unknown>;
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

export async function fetchAdminReferenceJDs(): Promise<ReferenceJDListResponse> {
  const res = await fetch(`${API_URL}/admin/jds/`, {
    headers: { Authorization: `Bearer ${getCookie(cookieKeys.ADMIN_TOKEN)}` },
  });
  if (!res.ok) throw new Error("Failed to fetch reference JDs");
  return res.json();
}

export async function fetchAdminReferenceJD(jdId: string): Promise<ReferenceJDRecord> {
  const res = await fetch(`${API_URL}/admin/jds/${jdId}`, {
    headers: { Authorization: `Bearer ${getCookie(cookieKeys.ADMIN_TOKEN)}` },
  });
  if (!res.ok) throw new Error("Failed to fetch JD");
  const payload = (await res.json()) as ReferenceJDDetailResponse;
  return payload.data;
}

export async function fetchAdminReferenceJDPreview(
  jdId: string,
): Promise<ReferenceJDPreviewResponse["data"]> {
  const res = await fetch(`${API_URL}/admin/jds/${jdId}/preview`, {
    headers: { Authorization: `Bearer ${getCookie(cookieKeys.ADMIN_TOKEN)}` },
  });
  if (!res.ok) throw new Error("Failed to load preview");
  const payload = (await res.json()) as ReferenceJDPreviewResponse;
  return payload.data;
}

export async function publishAdminReferenceJD(jdId: string): Promise<AdminPublishResponse> {
  const res = await fetch(`${API_URL}/admin/jds/${jdId}/publish`, {
    method: "POST",
    headers: { Authorization: `Bearer ${getCookie(cookieKeys.ADMIN_TOKEN)}` },
  });
  if (!res.ok) throw new Error("Failed to publish JD");
  return res.json();
}

// ── KRA / KPI API ─────────────────────────────────────────────────────────────

export interface KRAThreshold {
  excellent: string;
  meets_expectation: string;
  below_expectation: string;
}

export interface KPISuggestion {
  kpi_id: string;
  metric: string;
  description?: string;
  target: string;
  measurement_method: string;
  frequency: string;
  threshold: KRAThreshold;
  weight?: number | null;
}

export interface KRASuggestion {
  kra_id: string;
  title: string;
  description: string;
  source_tasks: string[];
  manager_impact?: string;
  // Note: suggested_weight is no longer generated by the agent
  // Employees set weights manually in Step 3
}

export interface FinalKRA {
  kra_id: string;
  title: string;
  description: string;
  source_tasks: string[];
  weight: number | null; // null until employee sets it in Step 3
  manager_impact?: string;
  kpis: KPISuggestion[];
}

export type GenerationStep =
  | "kra_selection"
  | "kpi_generation"
  | "kpi_selection"
  | "weight_adjustment"
  | "confirmed"
  | "uploaded";

export interface KRAKPIRecord {
  id: string;
  jd_session_id: string;
  employee_id: string;
  manager_employee_id: string | null;
  generation_step: GenerationStep;
  kra_suggestions: { kra_suggestions: KRASuggestion[] } | null;
  selected_kra_ids: string[] | null;
  kpi_suggestions: Record<string, { kra_title: string; kpi_suggestions: KPISuggestion[] }> | null;
  selected_kpi_ids: Record<string, string[]> | null;
  kras: { kras: FinalKRA[]; total_weight: number } | null;
  status:
    | "draft"
    | "confirmed"
    | "sent_to_manager"
    | "manager_rejected"
    | "sent_to_hr"
    | "hr_rejected"
    | "approved";
  reviewer_comment?: string | null;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  skill_ratings?: Array<{ name: string; description: string; rating: number | "N/A" | null }> | null;
  improvement_area?: string | null;
  improvement_goal?: string | null;
  improvement_status?: string | null;
  conversation_history?: any[] | null;
  conversation_state?: any | null;
  generated_at: string | null;
  confirmed_at: string | null;
  updated_at: string | null;
}

export interface PrerequisiteStatus {
  ready: boolean;
  missing: string[];
  message: string;
  current_step: GenerationStep | null;
}

// ─── API functions ────────────────────────────────────────────────────────────

export async function fetchKRAKPIStatus(
  jdSessionId: string,
  employeeId: string,
): Promise<PrerequisiteStatus> {
  const res = await fetch(
    `${API_URL}/kra-kpi/${jdSessionId}/status?employee_id=${encodeURIComponent(employeeId)}`,
  );
  if (!res.ok) throw new Error("Failed to check KRA/KPI status");
  return res.json();
}

export async function generateKRASuggestions(
  jdSessionId: string,
  employeeId: string,
  bypassManager: boolean = false,
): Promise<{ status: string; generation_step: GenerationStep; kra_suggestions: KRAKPIRecord["kra_suggestions"] }> {
  const url = `${API_URL}/kra-kpi/generate/${jdSessionId}?employee_id=${encodeURIComponent(employeeId)}${
    bypassManager ? "&bypass_manager=true" : ""
  }`;
  const res = await fetch(url, { method: "POST" });
  const data = await res.json();
  if (!res.ok) {
    const err = new Error(data?.detail?.message || "KRA generation failed") as ApiError;
    err.detail = data?.detail?.message;
    (err as any).missing = data?.detail?.missing || [];
    throw err;
  }
  return data;
}

export async function fetchKRAKPI(jdSessionId: string, employeeId?: string): Promise<KRAKPIRecord | null> {
  const query = employeeId ? `?employee_id=${encodeURIComponent(employeeId)}` : "";
  const res = await fetch(`${API_URL}/kra-kpi/${jdSessionId}${query}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error("Failed to fetch KRA/KPI");
  return res.json();
}

export async function selectKRAs(
  jdSessionId: string,
  selectedKraIds: string[],
  employeeId?: string,
): Promise<{ status: string; generation_step: GenerationStep; kpi_suggestions: KRAKPIRecord["kpi_suggestions"] }> {
  const query = employeeId ? `?employee_id=${encodeURIComponent(employeeId)}` : "";
  const res = await fetch(`${API_URL}/kra-kpi/${jdSessionId}/select-kras${query}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ selected_kra_ids: selectedKraIds }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Selection failed" }));
    throw new Error(err.detail || "KRA selection failed");
  }
  return res.json();
}

export async function selectKPIs(
  jdSessionId: string,
  selectedKpiIds: Record<string, string[]>,
  employeeId?: string,
): Promise<{ status: string; generation_step: GenerationStep; kras: KRAKPIRecord["kras"] }> {
  const query = employeeId ? `?employee_id=${encodeURIComponent(employeeId)}` : "";
  const res = await fetch(`${API_URL}/kra-kpi/${jdSessionId}/select-kpis${query}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ selected_kpi_ids: selectedKpiIds }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Selection failed" }));
    throw new Error(err.detail || "KPI selection failed");
  }
  return res.json();
}

export async function saveKRAWeights(
  jdSessionId: string,
  kras: FinalKRA[],
  confirm = false,
  employeeId?: string,
): Promise<{ status: string; generation_step: GenerationStep; kras: KRAKPIRecord["kras"] }> {
  const query = employeeId ? `?employee_id=${encodeURIComponent(employeeId)}` : "";
  const res = await fetch(`${API_URL}/kra-kpi/${jdSessionId}/weights${query}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kras, confirm }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Save failed" }));
    throw new Error(err.detail || "Failed to save weights");
  }
  return res.json();
}

export async function sendKRAKPIForApproval(
  jdSessionId: string,
  employeeId?: string,
): Promise<{ status: string; message: string; kra_kpi_status: string }> {
  const query = employeeId ? `?employee_id=${encodeURIComponent(employeeId)}` : "";
  const res = await fetch(`${API_URL}/kra-kpi/${jdSessionId}/send-for-approval${query}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Failed to send for approval" }));
    throw new Error(err.detail || "Failed to send KRA/KPI for approval");
  }
  return res.json();
}

export async function fetchKRAKPIReviewSkills(
  jdSessionId: string,
): Promise<{ skills: Array<{ name: string; description: string; rating: number | "N/A" | null }> }> {
  const res = await fetch(`${API_URL}/kra-kpi/${jdSessionId}/review-skills`);
  if (!res.ok) {
    throw new Error("Failed to fetch skills for review");
  }
  return res.json();
}

export async function submitKRAKPIReview(
  jdSessionId: string,
  payload: {
    action: string;
    comment?: string;
    skill_ratings?: Array<{ name: string; description: string; rating: number | "N/A" | null }>;
    improvement_area?: string;
    improvement_goal?: string;
    reviewer_id: string;
  },
): Promise<{ status: string; message: string; kra_kpi_status: string }> {
  const res = await fetch(`${API_URL}/kra-kpi/${jdSessionId}/review`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Failed to submit review" }));
    throw new Error(err.detail || "Failed to submit KRA/KPI review");
  }
  return res.json();
}

export async function addCustomKRA(
  jdSessionId: string,
  title: string,
  description: string,
  selectedIds?: string[],
  employeeId?: string,
): Promise<{
  status: string;
  kra: KRASuggestion;
  selected_kra_ids: string[];
  kra_suggestions: any;
}> {
  const query = employeeId ? `?employee_id=${encodeURIComponent(employeeId)}` : "";
  const res = await fetch(`${API_URL}/kra-kpi/${jdSessionId}/custom-kra${query}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, description, selected_ids: selectedIds }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Failed to add custom KRA" }));
    throw new Error(err.detail || "Failed to add custom KRA");
  }
  return res.json();
}

export async function addCustomKPI(
  jdSessionId: string,
  kraId: string,
  metric: string,
  target: string,
  measurementMethod: string,
  frequency: string,
  selectedIds?: Record<string, string[]>,
  employeeId?: string,
): Promise<{
  status: string;
  kpi: KPISuggestion;
  selected_kpi_ids: Record<string, string[]>;
  kpi_suggestions: any;
}> {
  const query = employeeId ? `?employee_id=${encodeURIComponent(employeeId)}` : "";
  const res = await fetch(`${API_URL}/kra-kpi/${jdSessionId}/custom-kpi${query}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      kra_id: kraId,
      metric,
      target,
      measurement_method: measurementMethod,
      frequency,
      selected_ids: selectedIds,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Failed to add custom KPI" }));
    throw new Error(err.detail || "Failed to add custom KPI");
  }
  return res.json();
}

export async function fetchMyImprovements(
  employeeId: string,
): Promise<{
  has_improvement_plan: boolean;
  skill_ratings: Array<{ name: string; description: string; rating: number | "N/A" | null }>;
  improvement_area: string;
  improvement_goal: string;
  updated_at: string | null;
  reviewed_by: string | null;
}> {
  const res = await fetch(`${API_URL}/kra-kpi/improvements?employee_id=${encodeURIComponent(employeeId)}`);
  if (!res.ok) {
    throw new Error("Failed to fetch improvement plan");
  }
  return res.json();
}

export interface KRAKPIChatResponse {
  next_question: string;
  progress: {
    completion_percentage: number;
    current_step: GenerationStep;
    active_kra_title: string;
  };
  suggested_kras: KRAKPIRecord["kra_suggestions"] | null;
  suggested_kpis: {
    kra_title: string;
    kpi_suggestions: KPISuggestion[];
  } | null;
  final_framework: KRAKPIRecord["kras"] | null;
}

export async function sendKraKpiMessage(
  message: string,
  history: RequestHistoryItem[],
  sessionId?: string,
): Promise<{ reply: string; history: RequestHistoryItem[] }> {
  const res = await fetch(`${API_URL}/kra-kpi/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, history, id: sessionId }),
  });
  if (!res.ok) throw new Error("Failed to send message");
  return res.json();
}

export async function sendKraKpiMessageStream(
  message: string,
  history: RequestHistoryItem[],
  sessionId: string | undefined,
  onChunk: (chunk: string) => void,
  onDone: (data: KRAKPIChatResponse) => void,
  onError: (error: ApiError) => void,
  onStatus?: (status: string) => void
) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 300_000);

  try {
    const res = await fetch(`${API_URL}/kra-kpi/chat/stream`, {
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
          if (parsed.type === "chunk" && parsed.content !== undefined) {
            onChunk(parsed.content);
          } else if (parsed.type === "status" && parsed.content) {
            if (onStatus) onStatus(parsed.content);
          } else if (parsed.type === "done") {
            onDone(parsed.parsed as KRAKPIChatResponse);
            return;
          } else if (parsed.type === "error") {
            const error = new Error(parsed.content || "Stream error") as ApiError;
            onError(error);
            return;
          }
        } catch {
          console.warn("Failed to parse SSE event:", dataStr.slice(0, 100));
        }
      }
    }
  } catch (err: unknown) {
    const error = err as ApiError;
    if (error.name === "AbortError") {
      onError(
        new Error(
          "Stream timed out. The server is taking too long to respond. Please try again.",
        ) as ApiError,
      );
    } else {
      onError(error);
    }
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function updateAdminKRAKPI(employeeId: string, kras: any): Promise<any> {
  const res = await fetch(`${API_URL}/admin/kra-kpi/${employeeId}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getCookie(cookieKeys.ADMIN_TOKEN)}`,
    },
    body: JSON.stringify({ kras }),
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.detail || "Failed to update KRA/KPI framework");
  }
  return res.json();
}

export async function updateAdminReferenceJD(
  jdId: string,
  payload: {
    role_title?: string;
    department?: string;
    level?: string;
    structured_data: any;
  }
): Promise<any> {
  const res = await fetch(`${API_URL}/admin/jds/${jdId}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getCookie(cookieKeys.ADMIN_TOKEN)}`,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.detail || "Failed to update JD");
  }
  return res.json();
}

export interface BrainAgentSession {
  id: string;
  title: string;
  admin_user: string;
  entity_context: any;
  created_at: string;
  updated_at: string;
}

export interface BrainAgentConversationTurn {
  id: number;
  session_id: string;
  turn_index: number;
  role: "user" | "assistant";
  content: string;
  tool_calls: any;
  created_at: string;
}

export async function fetchBrainAgentSessions(): Promise<BrainAgentSession[]> {
  const res = await fetch(`${API_URL}/admin/brain-agent/sessions`, {
    headers: {
      Authorization: `Bearer ${getCookie(cookieKeys.ADMIN_TOKEN)}`,
    },
  });
  if (!res.ok) {
    throw new Error("Failed to fetch past sessions");
  }
  const data = await res.json();
  return data.sessions || [];
}

export async function fetchBrainAgentSessionTurns(sessionId: string): Promise<BrainAgentConversationTurn[]> {
  const res = await fetch(`${API_URL}/admin/brain-agent/sessions/${sessionId}`, {
    headers: {
      Authorization: `Bearer ${getCookie(cookieKeys.ADMIN_TOKEN)}`,
    },
  });
  if (!res.ok) {
    throw new Error("Failed to fetch conversation history");
  }
  const data = await res.json();
  return data.turns || [];
}

export async function deleteBrainAgentSession(sessionId: string): Promise<void> {
  const res = await fetch(`${API_URL}/admin/brain-agent/sessions/${sessionId}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${getCookie(cookieKeys.ADMIN_TOKEN)}`,
    },
  });
  if (!res.ok) {
    throw new Error("Failed to delete session");
  }
}

export async function exportBrainAgentCSV(query: string): Promise<Blob> {
  const res = await fetch(`${API_URL}/admin/brain-agent/export-csv`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getCookie(cookieKeys.ADMIN_TOKEN)}`,
    },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.detail || "CSV export failed");
  }
  return res.blob();
}


export interface PulseInsight {
  title: string;
  description: string;
  query: string;
  severity: "critical" | "warning" | "insight";
  icon: string;
}

export async function fetchPulseInsights(): Promise<PulseInsight[]> {
  try {
    const res = await fetch(`${API_URL}/admin/brain-agent/insights`, {
      headers: {
        Authorization: `Bearer ${getCookie(cookieKeys.ADMIN_TOKEN)}`,
      },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.insights || [];
  } catch {
    return [];
  }
}
