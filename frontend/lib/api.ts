import axios from "axios";

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000",
});

export async function sendMessage(message: string, history: any[]) {
  const response = await api.post("/jd/chat", { message, history });
  return response.data;
}

export async function generateJD(history: any[]) {
  const response = await api.post("/jd/generate-jd", { history });
  console.log(response.data);
  return response.data;
}
