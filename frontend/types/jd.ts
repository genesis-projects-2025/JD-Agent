export type JDStatus = "pending" | "approved" | "rejected" | "in_progress";

export interface JDRecord {
  id: string;
  employee_id: string;
  employee_name: string;
  role_title: string;
  department: string;
  created_at: string;
  updated_at: string;
  status: JDStatus;
  jd_text: string;
  jd_structured: Record<string, any>;
  reviewer_comment?: string;
  reviewed_by?: string;
  reviewed_at?: string;
  completion_percentage: number;
}

export interface DashboardStats {
  total_jds: number;
  pending_approvals: number;
  approved_this_month: number;
  in_progress: number;
  avg_completion_minutes: number;
  approval_rate: number;
  trend_total: number;
  trend_approved: number;
}

export interface ActivityEvent {
  id: string;
  type: "created" | "submitted" | "approved" | "rejected" | "edited";
  employee_name: string;
  role_title: string;
  timestamp: string;
  actor?: string;
}