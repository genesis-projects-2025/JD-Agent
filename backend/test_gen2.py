import asyncio
from app.services.docx_generator import generate_jd_docx
from app.services.pdf_generator import generate_jd_pdf

jd_data = {
    "employee_info": {"title": "Software Engineer", "department": "Engineering", "job_title": "Senior Solutions Architect"},
    "purpose": "Design scalable systems and lead technical initiatives across the engineering organization.",
    "responsibilities": ["Lead architectural discussions.", "Mentor junior developers.", "Review code for security."],
    "skills": ["Python", "FastAPI", "React", "AWS"],
    "metrics": ["System Uptime > 99.99%", "Team velocity improvement"],
    "stakeholders": {
        "internal": ["Product Managers", "Design Team"],
        "external": ["Client Technical Leads", "Vendors"]
    },
    "education": "BS in Computer Science or equivalent",
    "experience": "5+ years of software development experience",
    "additional": {
        "unique_contributions": "Creator of the internal CLI tool used by all devs."
    }
}

pdf_buf = generate_jd_pdf(jd_data, "Software Engineer", "Engineering")
with open("test2.pdf", "wb") as f:
    f.write(pdf_buf.getvalue())

docx_buf = generate_jd_docx(jd_data, "Software Engineer", "Engineering")
with open("test2.docx", "wb") as f:
    f.write(docx_buf.getvalue())
print("Files generated successfully.")
