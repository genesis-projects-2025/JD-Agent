export interface ReferenceJDStructuredData {
  role_title?: string;
  department?: string;
  level?: string;
  purpose?: string;
  tasks?: string[];
  priority_tasks?: string[];
  skills?: string[];
  tools?: string[];
  technologies?: string[];
  qualifications?: {
    education?: string;
    experience_years?: string;
    certifications?: string[];
  };
  working_relationships?: {
    reports_to?: string;
    team_size?: string;
    stakeholders?: string[];
  };
  [key: string]: unknown;
}

export interface ReferenceJDRecord {
  id: string;
  role_title: string;
  department: string;
  level: string;
  employee_id: string;
  employee_name: string;
  processing_status: string;
  uploaded_at: string;
  published_at?: string | null;
  pdf_filename?: string;
  uploaded_by?: string;
  structured_data?: ReferenceJDStructuredData;
}

export interface ReferenceJDListResponse {
  data: ReferenceJDRecord[];
  total: number;
  skip: number;
  limit: number;
}

export interface ReferenceJDDetailResponse {
  data: ReferenceJDRecord;
}

export interface ReferenceJDPreviewResponse {
  data: {
    id: string;
    jd_structured: Record<string, unknown>;
    jd_text: string;
    reference_data: {
      id: string;
      role_title: string;
      department: string;
      processing_status: string;
      employee_id: string;
      employee_name: string;
    };
  };
}
