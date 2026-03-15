# app/services/pdf_generator.py
"""
Professional PDF generator for Job Descriptions.
Produces a clean, enterprise-grade PDF matching Pulse Pharma's standards.
"""

from io import BytesIO
from fpdf import FPDF

class JDPDF(FPDF):
    def header(self):
        # Company Header
        self.set_font("helvetica", "B", 16)
        self.set_text_color(31, 78, 121)  # #1F4E79
        self.cell(0, 10, "PULSE PHARMA", ln=True, align="C")
        
        self.set_font("helvetica", "I", 10)
        self.set_text_color(89, 89, 89)   # #595959
        self.cell(0, 10, "Job Description Document", ln=True, align="C")
        self.ln(5)

    def footer(self):
        self.set_y(-15)
        self.set_font("helvetica", "I", 8)
        self.set_text_color(153, 153, 153) # #999999
        self.cell(0, 10, "Pulse Pharma is an equal opportunity employer. Generated from Role Intelligence Interview.", align="C")

    def section_header(self, title):
        self.set_font("helvetica", "B", 11)
        self.set_text_color(255, 255, 255)
        self.set_fill_color(31, 78, 121)   # #1F4E79
        self.cell(0, 10, f"  {title}", ln=True, fill=True)
        self.ln(2)

    def sub_header(self, title):
        self.set_font("helvetica", "B", 10)
        self.set_text_color(31, 78, 121)
        self.cell(0, 7, f"{title}:", ln=True)
        self.set_font("helvetica", "", 10)
        self.set_text_color(0, 0, 0)

def generate_jd_pdf(jd_data: dict, title: str = None, department: str = None) -> BytesIO:
    """
    Generate a professional PDF from JD structured data.
    """
    pdf = JDPDF()
    pdf.add_page()
    pdf.set_auto_page_break(auto=True, margin=15)

    # --- Data Extraction & Fallbacks ---
    if not isinstance(jd_data, dict):
        jd_data = {}

    emp_info = jd_data.get("employee_information") or jd_data.get("employee_info") or {}
    if isinstance(emp_info, str):
        emp_info = {}
    
    designation = emp_info.get("title") or title or "Strategic Role"
    dept = emp_info.get("department") or department or "Organization"
    location = emp_info.get("location") or emp_info.get("work_location", "Head Office")
    
    # Reports To fallback
    team = jd_data.get("team_structure") or jd_data.get("team") or {}
    reports_to = team.get("reports_to") or emp_info.get("reports_to") or team.get("reporting_manager", "-")
    
    purpose = jd_data.get("purpose") or jd_data.get("summary", "")
    responsibilities = jd_data.get("responsibilities") or jd_data.get("key_responsibilities", [])
    skills = jd_data.get("skills") or jd_data.get("expertise", [])
    tools = jd_data.get("tools") or jd_data.get("technologies", [])
    metrics = jd_data.get("metrics") or jd_data.get("performance_metrics", [])
    
    work_env = jd_data.get("work_environment") or jd_data.get("environment", {})

    # --- Section: Job Information ---
    pdf.section_header("Role Overview")
    
    # Grid-like layout for core info
    pdf.sub_header("Designation")
    pdf.multi_cell(0, 6, str(designation))
    pdf.ln(2)
    
    pdf.sub_header("Reporting To")
    pdf.multi_cell(0, 6, str(reports_to))
    pdf.ln(2)
    
    pdf.sub_header("Department & Location")
    pdf.multi_cell(0, 6, f"{dept} | {location}")
    pdf.ln(2)
    
    pdf.sub_header("Purpose of the Job")
    pdf.multi_cell(0, 6, str(purpose))
    pdf.ln(6)

    # --- Section: Key Responsibilities ---
    if responsibilities:
        pdf.section_header("Core Responsibilities & Accountabilities")
        pdf.set_font("helvetica", "", 10)
        for resp in responsibilities:
            # Handle list of strings or list of dicts
            if isinstance(resp, dict):
                resp_text = resp.get("description") or resp.get("task") or str(resp)
            else:
                resp_text = str(resp)
            
            if not resp_text.strip():
                continue
            
            pdf.set_x(15) # Indent
            pdf.multi_cell(0, 6, f"- {resp_text}")
            pdf.ln(1)
        pdf.ln(4)

    # --- Section: Expertise & Tools ---
    if skills or tools:
        pdf.section_header("Technical Skills & Expertise")
        all_items = []
        if skills:
            all_items.extend(skills)
        if tools:
            all_items.extend(tools)
        
        pdf.set_font("helvetica", "", 10)
        # Filter duplicates and empty
        unique_skills = []
        for s in all_items:
            s_str = str(s).strip()
            if s_str and s_str not in unique_skills:
                unique_skills.append(s_str)
        
        pdf.multi_cell(0, 6, ", ".join(unique_skills))
        pdf.ln(6)

    # --- Section: Team & Culture ---
    pdf.section_header("Working Environment & Team")
    
    team_size = team.get("team_size") or team.get("size", "-")
    collab = team.get("collaborates_with") or team.get("stakeholders", "-")
    if isinstance(collab, list):
        collab = ", ".join(map(str, collab))
    
    pdf.sub_header("Team Dynamics")
    pdf.multi_cell(0, 6, f"Team Size: {team_size}\nCollaborates with: {collab}")
    pdf.ln(2)
    
    pdf.sub_header("Culture & Expectations")
    pdf.multi_cell(0, 6, str(work_env.get("culture") or work_env.get("description", "-")))
    pdf.ln(6)

    # --- Section: Performance Metrics ---
    if metrics:
        pdf.section_header("Performance Indicators (KPIs)")
        pdf.set_font("helvetica", "", 10)
        for i, metric in enumerate(metrics, 1):
            if isinstance(metric, dict):
                metric_text = metric.get("description") or metric.get("metric") or str(metric)
            else:
                metric_text = str(metric)
            
            pdf.multi_cell(0, 6, f"{i}. {metric_text}")
            pdf.ln(1)
        pdf.ln(2)

    # Output to BytesIO
    buffer = BytesIO()
    pdf_bytes = pdf.output()
    if isinstance(pdf_bytes, str):
        pdf_bytes = pdf_bytes.encode('latin-1')
    buffer.write(pdf_bytes)
    buffer.seek(0)
    return buffer
