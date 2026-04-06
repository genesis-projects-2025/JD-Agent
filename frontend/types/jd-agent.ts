export interface JDStructuredData {
  employee_information: Record<string, any>;
  role_summary: Record<string, any>;
  key_responsibilities: string[];
  required_skills: string[];
  tools_and_technologies: string[];
  team_structure: Record<string, any>;
  stakeholder_interactions: Record<string, any>;
  performance_metrics: string[];
  work_environment: Record<string, any>;
  additional_details: Record<string, any>;
}

export interface EmployeeRoleInsights {
  basic_info: Record<string, any>;
  purpose: string;
  daily_tasks: string[];
  weekly_tasks: string[];
  workflows: string[];
  tools: string[];
  technologies: string[];
  skills: string[];
  // Deprecated — kept for backward compatibility
  identity_context?: Record<string, any>;
  responsibilities?: string[];
  working_relationships?: Record<string, any>;
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
  current_agent?: string;
  analytics: Analytics;
  approval: Approval;
}
