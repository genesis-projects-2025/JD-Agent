##leave policy

import os
import re
import time
from pathlib import Path
from typing import Dict, List

import numpy as np
from dotenv import load_dotenv
from pinecone import Pinecone, ServerlessSpec
from pypdf import PdfReader
from pathlib import Path

# Points to JD-Agent/ (2 levels up from backend/RAG_ingestion_policies/ingestion.py)
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
PDF_PATH = PROJECT_ROOT / "HR-Policies" / "Pulse-Attendance & Leave Policy-Final.pdf"

PDF_PATH = "HR-Policies/Pulse-Attendance & Leave Policy-Final.pdf"
def extract_full_text(pdf_path: str) -> str:
    reader = PdfReader(str(Path(pdf_path)))
    text = "\n".join(p.extract_text() or "" for p in reader.pages)
    text = re.sub(r"\bPage\s+\d+\b", "", text)
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    lines = [ln.strip() for ln in text.split("\n")]
    return "\n".join(ln for ln in lines if ln)

extracted_text = extract_full_text(PDF_PATH)
print(extracted_text)
