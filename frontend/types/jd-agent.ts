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
  identity_context: Record<string, any>;
  daily_activities: string[];
  work_execution_methods: string[];
  tools_and_systems: string[];
  collaboration_patterns: Record<string, any>;
  stakeholder_interactions: Record<string, any>;
  decision_authority: Record<string, any>;
  performance_measurements: string[];
  work_environment: Record<string, any>;
  special_contributions: string[];
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
  conversation_response: string;
  progress: Progress;
  employee_role_insights: EmployeeRoleInsights;
  jd_structured_data: JDStructuredData;
  jd_text_format: string;
  analytics: Analytics;
  approval: Approval;
}
