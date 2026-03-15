import asyncio
from app.services.docx_generator import generate_jd_docx
from app.services.pdf_generator import generate_jd_pdf

jd_data = {
    "employee_information": {"title": "Software Engineer", "department": "Engineering"},
    "purpose": "Write code",
    "responsibilities": ["Code", "Test"],
    "skills": ["Python", "FastAPI"],
    "metrics": ["Lines of code"]
}

pdf_buf = generate_jd_pdf(jd_data, "Software Engineer", "Engineering")
with open("test.pdf", "wb") as f:
    f.write(pdf_buf.getvalue())

docx_buf = generate_jd_docx(jd_data, "Software Engineer", "Engineering")
with open("test.docx", "wb") as f:
    f.write(docx_buf.getvalue())
print("Files generated.")
