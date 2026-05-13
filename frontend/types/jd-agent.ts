export interface JDStructuredData {
  employee_information: Record<string, unknown>;
  role_summary: Record<string, unknown>;
  key_responsibilities: string[];
  required_skills: string[];
  tools_and_technologies: string[];
  team_structure: Record<string, unknown>;
  stakeholder_interactions: Record<string, unknown>;
  performance_metrics: string[];
  work_environment: Record<string, unknown>;
  additional_details: Record<string, unknown>;
}

export interface EmployeeRoleInsights {
  basic_info: Record<string, unknown>;
  purpose: string;
  daily_tasks: string[];
  weekly_tasks: string[];
  workflows: string[];
  tools: string[];
  technologies: string[];
  skills: string[];
  // Deprecated — kept for backward compatibility
  identity_context?: Record<string, unknown>;
  responsibilities?: string[];
  working_relationships?: Record<string, unknown>;
  education?: string;
  experience?: string;
}

export interface Progress {
  completion_percentage: number;
  missing_insight_areas: string[];
  status:
    | "collecting"
    | "ready_for_generation"
    | "jd_generated"
    | "approval_pending"
    | "approved";
  current_agent?: string;
  depth_scores?: Record<string, number>;
}

export interface Analytics {
  questions_asked: number;
  questions_answered: number;
  insights_collected: number;
  estimated_completion_time_minutes: number;
}

export interface Approval {
  approval_required: boolean;
  approval_status: "pending" | "approved" | "rejected";
}

export interface JDAgentResponse {
  next_question: string;
  progress: Progress;
  employee_role_insights: EmployeeRoleInsights;
  jd_structured_data: JDStructuredData;
  jd_text_format: string;
  suggested_skills?: string[];
  suggested_tools?: string[];
  task_list?: Array<{ description: string; frequency?: string; category?: string } | string>;
  current_agent?: string;
  analytics: Analytics;
  approval: Approval;
}

