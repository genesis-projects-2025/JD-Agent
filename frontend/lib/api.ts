import axios from "axios";

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000",
});

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
