// lib/api.ts
import axios, { AxiosError } from "axios";
import { DashboardStats } from "@/types/jd";
import { ActivityEvent } from "@/types/jd";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface JDStructuredData {
  employee_information: {
    name?: string;
    title?: string;
    department?: string;
    location?: string;
    reports_to?: string;
    work_type?: string;
  };
  role_summary: string;
  key_responsibilities: string[];
  required_skills: string[];
  tools_and_technologies: string[];
  team_structure: {
    team_size?: string;
    direct_reports?: string;
    collaborates_with?: string[];
    mentoring?: string;
  };
  stakeholder_interactions: {
    internal?: string[];
    external?: string[];
    frequency?: string;
  };
  performance_metrics: string[];
  work_environment: {
    type?: string;
    culture?: string;
    work_pace?: string;
    work_style?: string;
  };
  additional_details: {
    special_projects?: string[];
    unique_contributions?: string;
    growth_opportunities?: string;
  };
}

export interface JDRecord {
  id: string;
  employee_id: string;
  title: string | null;
  status: string;
  version: number;
  generated_jd: string | null;
  jd_structured: JDStructuredData | null;
  responses: Record<string, any> | null;
  conversation_history: ConversationTurn[];
  conversation_state: Record<string, any> | null;
  created_at: string;
  updated_at: string;
}

export interface JDListItem {
  id: string;
  employee_id: string;
  title: string | null;
  status: string;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
  timestamp?: string;
}

export interface ChatResponse {
  reply: string;
  history: ConversationTurn[];
}

export interface InitResponse {
  id: string;
  status: string;
  employee_id: string;
}

export interface GenerateJDResponse {
  id: string;
  jd_text: string;
  jd_structured: JDStructuredData;
  status: string;
}

export interface SaveJDResponse {
  status: string;
  id: string;
  employee_id: string;
  title: string;
  message: string;
}

export interface UpdateJDResponse {
  status: string;
  id: string;
  version: number;
  updated_at: string;
  message: string;
}

// ── Client ────────────────────────────────────────────────────────────────────

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000",
  headers: { "Content-Type": "application/json" },
  timeout: 60000, // 60s — LLM calls can be slow
});

// ── Error Normaliser ──────────────────────────────────────────────────────────
// Converts Axios errors into plain Errors with .status and .detail attached
// so callers can do: catch (e) { if (e.status === 429) ... }

function normaliseError(err: unknown): never {
  if (axios.isAxiosError(err)) {
    const axiosErr = err as AxiosError<{ detail?: string }>;
    const status = axiosErr.response?.status ?? 0;
    const detail =
      axiosErr.response?.data?.detail ||
      axiosErr.message ||
      "An unexpected error occurred";
    const error = Object.assign(new Error(detail), { status, detail });
    throw error;
  }
  throw err;
}
// ── Interview Endpoints ───────────────────────────────────────────────────────

export async function initQuestionnaire(data: {
  employee_id: string;
  employee_name?: string;
}): Promise<InitResponse> {
  try {
    const res = await api.post<InitResponse>("/jd/init", data);
    return res.data;
  } catch (err) {
    return normaliseError(err);
  }
}

export async function sendMessage(
  message: string,
  history: ConversationTurn[],
  id?: string,
): Promise<ChatResponse> {
  try {
    const res = await api.post<ChatResponse>("/jd/chat", {
      message,
      history,
      id,
    });
    return res.data;
  } catch (err) {
    return normaliseError(err);
  }
}

// ── JD Generation & Save ──────────────────────────────────────────────────────

/**
 * Triggers JD generation from the collected insights.
 * Called when the user clicks "Generate JD" — NOT inside a chat turn.
 * Returns jd_text (markdown) and jd_structured (JSON) for frontend display.
 */
export async function generateJD(payload: {
  id: string;
}): Promise<GenerateJDResponse> {
  try {
    const res = await api.post<GenerateJDResponse>("/jd/generate", payload);
    return res.data;
  } catch (err) {
    return normaliseError(err);
  }
}

/**
 * Saves the displayed JD to the database.
 * Called when the user clicks "Save JD" after reviewing the generated output.
 */
export async function saveJD(data: {
  id: string;
  jd_text: string;
  jd_structured: JDStructuredData | Record<string, any>;
  employee_id?: string;
}): Promise<SaveJDResponse> {
  try {
    // Guard: always send a valid object, never null
    const payload = {
      ...data,
      jd_structured: data.jd_structured ?? {},
    };
    const res = await api.post<SaveJDResponse>("/jd/save", payload);
    return res.data;
  } catch (err) {
    return normaliseError(err);
  }
}

// ── JD Management ─────────────────────────────────────────────────────────────

export async function fetchEmployeeJDs(
  employeeId: string,
): Promise<JDListItem[]> {
  try {
    const res = await api.get<JDListItem[]>(`/jd/employee/${employeeId}`);
    return res.data;
  } catch (err) {
    return normaliseError(err);
  }
}

export async function fetchJD(jdId: string): Promise<JDRecord> {
  try {
    const res = await api.get<JDRecord>(`/jd/${jdId}`);
    return res.data;
  } catch (err) {
    return normaliseError(err);
  }
}

export async function deleteJD(
  jdId: string,
  employeeId: string,
): Promise<{ status: string; message: string }> {
  try {
    const res = await api.delete(`/jd/${jdId}?employee_id=${employeeId}`);
    return res.data;
  } catch (err) {
    return normaliseError(err);
  }
}

export async function updateJD(
  jdId: string,
  data: {
    jd_text: string;
    jd_structured: JDStructuredData | Record<string, any>;
    employee_id: string;
  },
): Promise<UpdateJDResponse> {
  try {
    const res = await api.put<UpdateJDResponse>(`/jd/${jdId}`, data);
    return res.data;
  } catch (err) {
    return normaliseError(err);
  }
}

export async function updateJDStatus(
  jdId: string,
  data: { status: string; employee_id: string },
): Promise<{
  status: string;
  id: string;
  new_status: string;
  message: string;
}> {
  try {
    const res = await api.patch(`/jd/${jdId}/status`, data);
    return res.data;
  } catch (err) {
    return normaliseError(err);
  }
}

/* ── Dashboard ──────────────────────────────────────────────────── */

export async function getDashboardStats(): Promise<DashboardStats> {
  const response = await api.get("/jd/stats");
  return response.data;
}

export async function getRecentActivity(): Promise<ActivityEvent[]> {
  const response = await api.get("/jd/activity");
  return response.data;
}

/* ── JD List & Approvals ────────────────────────────────────────── */

export async function getJDs(): Promise<JDRecord[]> {
  const response = await api.get("/jd/list");
  return response.data;
}

export async function approveJD(id: string): Promise<void> {
  await api.post(`/jd/${id}/approve`);
}

export async function rejectJD(id: string, comment: string): Promise<void> {
  await api.post(`/jd/${id}/reject`, { comment });
}
