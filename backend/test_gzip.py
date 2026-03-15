import uvicorn
from fastapi import FastAPI
from fastapi.responses import Response
from fastapi.middleware.gzip import GZipMiddleware
import asyncio
from app.services.pdf_generator import generate_jd_pdf
from app.services.docx_generator import generate_jd_docx

app = FastAPI()
app.add_middleware(GZipMiddleware, minimum_size=100)

jd_data = {
    "employee_information": {"title": "Test", "department": "Test"},
}

@app.get("/pdf")
def get_pdf():
    pdf_buf = generate_jd_pdf(jd_data, "Test", "Test")
    content = pdf_buf.getvalue()
    return Response(
        content=content,
        media_type="application/pdf",
        headers={
            "Content-Disposition": 'attachment; filename="test.pdf"',
            "Content-Length": str(len(content)),
        }
    )

@app.get("/pdf-no-gzip")
def get_pdf_no_gzip():
    pdf_buf = generate_jd_pdf(jd_data, "Test", "Test")
    content = pdf_buf.getvalue()
    return Response(
        content=content,
        media_type="application/pdf",
        headers={
            "Content-Disposition": 'attachment; filename="test.pdf"',
            "Content-Length": str(len(content)),
            "Content-Encoding": "identity" # Bypass gzip
        }
    )

@app.get("/docx")
def get_docx():
    from fastapi.responses import StreamingResponse
    docx_buf = generate_jd_docx(jd_data, "Test", "Test")
    # Simulate current code
    return StreamingResponse(
        docx_buf,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={
            "Content-Disposition": 'attachment; filename="test.docx"',
        }
    )

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=9999)
