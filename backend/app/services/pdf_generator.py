# app/services/pdf_generator.py
"""
Professional PDF generator for Job Descriptions.
Produces a clean, enterprise-grade PDF matching Pulse Pharma's standards.
"""

from io import BytesIO
from fpdf import FPDF

# Corporate Colors
PULSE_BLUE = (31, 78, 121)   # #1F4E79
PULSE_GRAY = (89, 89, 89)    # #595959
LIGHT_GRAY = (240, 242, 245) # #F0F2F5
BORDER_GRAY = (200, 200, 200)

class JDPDF(FPDF):
    def header(self):
        # Professional Enterprise Header Banner
        self.set_y(0)
        self.set_fill_color(*PULSE_BLUE)
        self.rect(0, 0, 210, 25, 'F')
        
        self.set_y(8)
        self.set_font("helvetica", "B", 20)
        self.set_text_color(255, 255, 255)
        self.cell(0, 10, "PULSE PHARMA", ln=True, align="C")
        
        self.set_font("helvetica", "I", 10)
        self.set_text_color(200, 220, 240)
        self.cell(0, 6, "Strategic Role Architecture", ln=True, align="C")
        self.ln(15)

    def footer(self):
        self.set_y(-15)
        self.set_font("helvetica", "I", 8)
        self.set_text_color(*PULSE_GRAY)
        self.cell(0, 10, "Pulse Pharma is an equal opportunity employer. Generated from Role Intelligence Interview.", align="C")

    def section_header(self, title):
        self.ln(4)
        self.set_font("helvetica", "B", 12)
        self.set_text_color(255, 255, 255)
        self.set_fill_color(*PULSE_BLUE)
        
        # A nice ribbon-like section header
        self.cell(0, 9, f"  {title}", ln=True, fill=True)
        self.ln(3)

    def grid_row(self, label, value):
        """Draws a bordered row resembling a professional table"""
        self.set_font("helvetica", "B", 10)
        self.set_text_color(*PULSE_BLUE)
        
        # Draw label cell
        self.set_fill_color(*LIGHT_GRAY)
        self.cell(50, 8, f" {label}", border=1, fill=True)
        
        # Draw value cell
        self.set_font("helvetica", "", 10)
        self.set_text_color(0, 0, 0)
        
        # If value is too long, we need multi_cell but then border math is hard in FPDF1.
        # We will use string slicing for simple grids or simple padding.
        # Ensure value is string
        val_str = str(value).replace('\n', ' / ')
        self.cell(140, 8, f" {val_str}", border=1, ln=True)
        
    def bullet_list(self, items):
        self.set_font("helvetica", "", 10)
        self.set_text_color(0, 0, 0)
        for item in items:
            if isinstance(item, dict):
                text = item.get("description") or item.get("task") or str(item)
            else:
                text = str(item)
            
            if not text.strip():
                continue
            
            self.set_x(15) # Indent
            # We use a standard dash
            self.multi_cell(0, 6, f"-  {text}")
            self.ln(1)
        self.ln(2)

def generate_jd_pdf(jd_data: dict, title: str = None, department: str = None) -> BytesIO:
    """
    Generate an enterprise-grade PDF from JD structured data.
    """
    pdf = JDPDF()
    pdf.add_page()
    pdf.set_auto_page_break(auto=True, margin=20)

    # --- Data Extraction & Schema Normalization ---
    if not isinstance(jd_data, dict):
        jd_data = {}

    emp_info = jd_data.get("employee_information") or jd_data.get("employee_info") or {}
    if isinstance(emp_info, str):
        emp_info = {}
        
    team = jd_data.get("team_structure") or jd_data.get("team") or {}
    work_env = jd_data.get("work_environment") or jd_data.get("environment") or {}
    stakeholders = jd_data.get("stakeholders") or jd_data.get("stakeholder_interactions") or {}
    additional = jd_data.get("additional") or jd_data.get("additional_details") or {}
    
    designation = emp_info.get("job_title") or emp_info.get("title") or title or "Strategic Role"
    dept = emp_info.get("department") or department or "Organization"
    location = emp_info.get("location") or emp_info.get("work_location", "-")
    work_type = emp_info.get("work_type", "-")
    
    reports_to = team.get("reports_to") or emp_info.get("reports_to", "-")
    
    # Text fields
    purpose = jd_data.get("purpose") or jd_data.get("role_summary", "")
    if isinstance(purpose, dict):
        purpose = purpose.get("summary", str(purpose))
        
    education = jd_data.get("education", "")
    experience = jd_data.get("experience", "")

    # Arrays
    responsibilities = jd_data.get("responsibilities") or jd_data.get("key_responsibilities", [])
    skills = jd_data.get("skills") or jd_data.get("required_skills", [])
    tools = jd_data.get("tools") or jd_data.get("tools_and_technologies", [])
    metrics = jd_data.get("metrics") or jd_data.get("performance_metrics", [])

    # --- View Construction ---
    
    # 1. Job Information Grid
    pdf.section_header("Job / Role Information")
    pdf.grid_row("Designation", designation)
    pdf.grid_row("Department", dept)
    pdf.grid_row("Location", location)
    pdf.grid_row("Work Type", work_type)
    pdf.grid_row("Reporting To", reports_to)
    
    pdf.ln(4)
    if purpose:
        pdf.set_font("helvetica", "B", 10)
        pdf.set_text_color(*PULSE_BLUE)
        pdf.cell(0, 8, "Purpose of the Role:", ln=True)
        pdf.set_font("helvetica", "", 10)
        pdf.set_text_color(0, 0, 0)
        pdf.multi_cell(0, 6, str(purpose))
        pdf.ln(2)

    # 2. Responsibilities
    if responsibilities:
        pdf.section_header("Core Responsibilities & Accountabilities")
        pdf.bullet_list(responsibilities)

    # 3. Stakeholders & Team
    pdf.section_header("Working Relationships")
    
    # Extract stakeholders
    internal = stakeholders.get("internal", []) or stakeholders.get("internal_stakeholders", [])
    external = stakeholders.get("external", []) or stakeholders.get("external_stakeholders", [])
    team_size = team.get("team_size") or stakeholders.get("team_size", "-")
    
    pdf.grid_row("Team Size", team_size)
    if internal:
        int_str = ", ".join(internal) if isinstance(internal, list) else str(internal)
        pdf.grid_row("Internal Teams", int_str)
    if external:
        ext_str = ", ".join(external) if isinstance(external, list) else str(external)
        pdf.grid_row("External Entities", ext_str)

    # 4. Qualifications
    if education or experience:
        pdf.section_header("Qualifications & Experience")
        if education:
            pdf.set_font("helvetica", "B", 10)
            pdf.set_text_color(*PULSE_BLUE)
            pdf.cell(0, 6, "Education:", ln=True)
            pdf.set_font("helvetica", "", 10)
            pdf.set_text_color(0, 0, 0)
            pdf.multi_cell(0, 6, str(education))
            pdf.ln(1)
        if experience:
            pdf.set_font("helvetica", "B", 10)
            pdf.set_text_color(*PULSE_BLUE)
            pdf.cell(0, 6, "Experience:", ln=True)
            pdf.set_font("helvetica", "", 10)
            pdf.set_text_color(0, 0, 0)
            pdf.multi_cell(0, 6, str(experience))
            pdf.ln(1)

    # 5. Skills & Tools
    if skills or tools:
        pdf.section_header("Technical Skills & Expertise")
        all_items = []
        if isinstance(skills, list):
            all_items.extend(skills)
        if isinstance(tools, list):
            all_items.extend([f"{t} (Tool/Platform)" for t in tools])
        
        pdf.bullet_list(all_items)

    # 6. Performance Metrics
    if metrics:
        pdf.section_header("Performance Indicators (KPIs)")
        pdf.bullet_list(metrics)

    # 7. Environment & Additional
    env_str = work_env.get("culture", "") or work_env.get("type", "")
    add_str = additional.get("unique_contributions", "") or additional.get("special_projects", "")
    
    if env_str or add_str:
        pdf.section_header("Work Environment & Additional Details")
        if env_str:
            pdf.set_font("helvetica", "B", 10)
            pdf.set_text_color(*PULSE_BLUE)
            pdf.cell(0, 6, "Environment & Culture:", ln=True)
            pdf.set_font("helvetica", "", 10)
            pdf.set_text_color(0, 0, 0)
            pdf.multi_cell(0, 6, str(env_str))
            pdf.ln(1)
        if add_str:
            if isinstance(add_str, list):
                add_str = ", ".join(add_str)
            pdf.set_font("helvetica", "B", 10)
            pdf.set_text_color(*PULSE_BLUE)
            pdf.cell(0, 6, "Special Notes:", ln=True)
            pdf.set_font("helvetica", "", 10)
            pdf.set_text_color(0, 0, 0)
            pdf.multi_cell(0, 6, str(add_str))
            pdf.ln(1)


    # Output to BytesIO
    buffer = BytesIO()
    pdf_bytes = pdf.output()
    if isinstance(pdf_bytes, str):
        pdf_bytes = pdf_bytes.encode('latin-1')
    buffer.write(pdf_bytes)
    buffer.seek(0)
    return buffer

