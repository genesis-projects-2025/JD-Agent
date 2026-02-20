import axios from "axios";
import { JDRecord, DashboardStats, ActivityEvent } from "@/types/jd";

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000",
});

/* ── Questionnaire / Chat ───────────────────────────────────────── */

export async function initQuestionnaire(data: {
  employee_id: string;
  employee_name?: string;
}) {
  const response = await api.post("/jd/init", data);
  return response.data;
}

export async function sendMessage(
  message: string,
  history: any[],
  id?: string,
) {
  const response = await api.post("/jd/chat", { message, history, id });
  return response.data;
}

export async function saveJD(data: {
  id: string;
  jd_text: string;
  jd_structured: any;
  employee_id?: string;
}) {
  const response = await api.post("/jd/save", data);
  return response.data;
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