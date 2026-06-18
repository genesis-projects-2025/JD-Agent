export interface SessionListItem {
  id: string;
  employee_id: string;
  employee_name?: string;
  department?: string;
  title: string | null;
  status: string;
  version: number;
  created_at: string | null;
  updated_at: string | null;
}

export interface SessionConversationTurn {
  role: "user" | "assistant";
  content: string;
}

export interface SessionDetail {
  id: string;
  employee_id: string;
  title: string | null;
  status: string;
  version: number;
  generated_jd: string | null;
  jd_structured: Record<string, unknown> | null;
  responses: Record<string, unknown> | null;
  insights?: Record<string, unknown> | null;
  conversation_history: SessionConversationTurn[];
  conversation_state: Record<string, unknown> | null;
  current_agent?: string;
  created_at: string;
  updated_at: string;
}
