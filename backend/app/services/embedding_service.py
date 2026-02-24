# app/services/embedding_service.py
"""
Vector DB layer — Google text-embedding-004 + Pinecone.

One Pinecone index  : "jd-agent"
One namespace       : "employees"
4 vectors per session:
  jd_text       → full generated JD markdown
  jd_structured → responsibilities + metrics as searchable prose
  insights      → daily activities, tools, execution processes
  conversation  → employee's OWN words (user turns only)

Vector IDs are deterministic MD5 hashes of (session_id + doc_type)
so re-saves always OVERWRITE — never create duplicates.
"""

import asyncio
import hashlib
import json
from typing import Optional
from google import genai
from pinecone import Pinecone, ServerlessSpec
from google.genai import types
from app.core.config import settings

# ── Constants ─────────────────────────────────────────────────────────────────
INDEX_NAME  = "jd-agent"
NAMESPACE   = "employees"
EMBED_MODEL = "models/gemini-embedding-001"   # Google's best, 768 dims
EMBED_DIM   = 3072

# ── Lazy singleton index ──────────────────────────────────────────────────────
_pinecone_index = None


client = genai.Client(api_key=settings.GEMINI_API_KEY)
def _get_index():
    global _pinecone_index
    if _pinecone_index is not None:
        return _pinecone_index

    pc = Pinecone(api_key=settings.PINECONE_API_KEY)

    existing_names = [i.name for i in pc.list_indexes()]
    if INDEX_NAME not in existing_names:
        pc.create_index(
            name=INDEX_NAME,
            dimension=EMBED_DIM,
            metric="cosine",
            spec=ServerlessSpec(cloud="aws", region="us-east-1"),
        )
        print(f"✅ Pinecone index '{INDEX_NAME}' created (dim={EMBED_DIM})")

    _pinecone_index = pc.Index(INDEX_NAME)
    return _pinecone_index


# ── Embedding helpers ─────────────────────────────────────────────────────────

def _vid(session_id: str, doc_type: str) -> str:
    """Deterministic vector ID — same session+type always overwrites same slot."""
    return hashlib.md5(f"{session_id}:{doc_type}".encode()).hexdigest()


async def _embed_document(text: str) -> list[float]:
    text = (text or "").strip()[:8000]
    if not text:
        return [0.0] * EMBED_DIM

    loop = asyncio.get_event_loop()

    result = await loop.run_in_executor(
        None,
        lambda: client.models.embed_content(
            model="gemini-embedding-001",
            contents=text,
        ),
    )

    embedding = result.embeddings[0].values
    print("ACTUAL DIM:", len(embedding))  # optional debug

    return embedding


async def embed_query(text: str) -> list[float]:
    text = (text or "").strip()[:2000]
    if not text:
        return [0.0] * EMBED_DIM

    loop = asyncio.get_event_loop()

    result = await loop.run_in_executor(
        None,
        lambda: client.models.embed_content(
            model="gemini-embedding-001",
            contents=text,
        ),
    )

    return result.embeddings[0].values

# ── Main store function ───────────────────────────────────────────────────────

async def store_employee_jd_session(
    session_id: str,
    employee_id: str,
    employee_name: str,
    job_title: str,
    department: str,
    jd_text: str,
    jd_structured: dict,
    insights: dict,
    conversation_history: list,
) -> int:

    index = _get_index()
    vectors = []

    base_meta = {
        "session_id": session_id,
        "employee_id": employee_id or "",
        "employee_name": employee_name or "",
        "job_title": job_title or "",
        "department": department or "",
    }

    # 1️⃣ JD TEXT (as-is)
    if jd_text:
        vectors.append({
            "id": _vid(session_id, "jd_text"),
            "values": await _embed_document(jd_text),
            "metadata": {
                **base_meta,
                "doc_type": "jd_text",
                "raw_text": jd_text
            },
        })

    # 2️⃣ JD STRUCTURED (full JSON as string)
    if jd_structured:
        structured_raw = json.dumps(jd_structured, ensure_ascii=False)
        vectors.append({
            "id": _vid(session_id, "jd_structured"),
            "values": await _embed_document(structured_raw),
            "metadata": {
                **base_meta,
                "doc_type": "jd_structured",
                "raw_json": structured_raw
            },
        })

    # 3️⃣ INSIGHTS / RESPONSES (full dict as string)
    if insights:
        insights_raw = json.dumps(insights, ensure_ascii=False)
        vectors.append({
            "id": _vid(session_id, "insights"),
            "values": await _embed_document(insights_raw),
            "metadata": {
                **base_meta,
                "doc_type": "insights",
                "raw_json": insights_raw
            },
        })

    # 4️⃣ FULL CONVERSATION HISTORY (no filtering)
    if conversation_history:
        convo_raw = json.dumps(conversation_history, ensure_ascii=False)
        vectors.append({
            "id": _vid(session_id, "conversation"),
            "values": await _embed_document(convo_raw),
            "metadata": {
                **base_meta,
                "doc_type": "conversation",
                "raw_json": convo_raw
            },
        })

    if not vectors:
        return 0

    index.upsert(vectors=vectors, namespace=NAMESPACE)
    print(f"✅ Stored {len(vectors)} raw vectors for session {session_id}")
    return len(vectors)
# ── Search ────────────────────────────────────────────────────────────────────

async def search_employees(
    query: str,
    doc_type: Optional[str] = None,
    department: Optional[str] = None,
    top_k: int = 12,
) -> list[dict]:
    """
    Semantic search over all employee vectors.
    Returns list of result dicts sorted by relevance score.
    """
    index = _get_index()
    query_vec = await embed_query(query)

    pf = {}
    if doc_type:
        pf["doc_type"] = {"$eq": doc_type}
    if department:
        pf["department"] = {"$eq": department}

    results = index.query(
        vector=query_vec,
        top_k=top_k,
        namespace=NAMESPACE,
        include_metadata=True,
        filter=pf if pf else None,
    )

    return [
        {
            "score":                round(m.score, 4),
            "session_id":           (m.metadata or {}).get("session_id", ""),
            "employee_id":          (m.metadata or {}).get("employee_id", ""),
            "employee_name":        (m.metadata or {}).get("employee_name", ""),
            "job_title":            (m.metadata or {}).get("job_title", ""),
            "department":           (m.metadata or {}).get("department", ""),
            "doc_type":             (m.metadata or {}).get("doc_type", ""),
            "automation_potential": (m.metadata or {}).get("automation_potential", False),
            "required_skills":      (m.metadata or {}).get("required_skills", []),
            "tools_used":           (m.metadata or {}).get("tools_used", []),
            "text":                 (m.metadata or {}).get("text", ""),
        }
        for m in results.matches
    ]
