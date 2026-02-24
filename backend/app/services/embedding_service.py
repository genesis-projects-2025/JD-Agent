# app/services/embedding_service.py
"""
Vector DB layer — Google gemini-embedding-001 + Pinecone v8 (AsyncIO).

One Pinecone index  : "jd-agent"
One namespace       : "employees"
4 vectors per session: jd_text, jd_structured, insights, conversation

Vector IDs are deterministic MD5 hashes of (session_id + doc_type)
so re-saves always OVERWRITE — never create duplicates.
"""

import asyncio
import hashlib
import json
from typing import Optional

from google import genai
from pinecone import Pinecone, ServerlessSpec, PineconeAsyncio

from app.core.config import settings

# ── Constants ──────────────────────────────────────────────────────────────────
INDEX_NAME  = "jd-agent"
NAMESPACE   = "employees"
EMBED_MODEL = "gemini-embedding-001"   # ✅ correct model name (no "models/" prefix)
EMBED_DIM   = 3072                      # ✅ correct dims for gemini-embedding-001

# ── Google Gemini client ───────────────────────────────────────────────────────
gemini_client = genai.Client(api_key=settings.GEMINI_API_KEY)

# ── Pinecone sync client — ONLY for index creation/management ─────────────────
# (index creation is a one-time control-plane operation, sync is fine here)
_pc_sync = Pinecone(api_key=settings.PINECONE_API_KEY)

# Cache the index host URL so AsyncIO client can connect fast
_index_host: Optional[str] = None


def _ensure_index_exists() -> str:
    """
    Creates index if not exists. Returns the host URL.
    Called once at startup — sync is fine for control-plane ops.
    """
    global _index_host
    if _index_host:
        return _index_host

    # ✅ v8 way to check existing indexes
    existing_names = _pc_sync.list_indexes().names()

    if INDEX_NAME not in existing_names:
        print(f"[Pinecone] Creating index '{INDEX_NAME}'...")
        _pc_sync.create_index(
            name=INDEX_NAME,
            dimension=EMBED_DIM,
            metric="cosine",
            spec=ServerlessSpec(
                cloud="aws",
                region="us-east-1"          # match your Pinecone project region
            ),
        )
        # Wait until index is ready
        import time
        while not _pc_sync.describe_index(INDEX_NAME).status["ready"]:
            print("[Pinecone] Waiting for index to be ready...")
            time.sleep(2)
        print(f"[Pinecone] ✅ Index '{INDEX_NAME}' is ready")

    # Cache the host for async connections
    _index_host = _pc_sync.describe_index(INDEX_NAME).host
    print(f"[Pinecone] Index host: {_index_host}")
    return _index_host


# ── Embedding helpers ──────────────────────────────────────────────────────────

def _vid(session_id: str, doc_type: str) -> str:
    """Deterministic vector ID — same session+type always overwrites same slot."""
    return hashlib.md5(f"{session_id}:{doc_type}".encode()).hexdigest()


async def _embed_text(text: str, char_limit: int = 8000) -> list[float]:
    """Embed any text using Gemini. Returns zero vector if text is empty."""
    text = (text or "").strip()[:char_limit]
    if not text:
        return [0.0] * EMBED_DIM

    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(
        None,
        lambda: gemini_client.models.embed_content(
            model=EMBED_MODEL,
            contents=text,
        ),
    )

    embedding = result.embeddings[0].values

    # ✅ Safety check — crash early if dim is wrong
    if len(embedding) != EMBED_DIM:
        raise ValueError(
            f"Embedding dim mismatch! Expected {EMBED_DIM}, got {len(embedding)}. "
            f"Check EMBED_MODEL and EMBED_DIM constants."
        )

    return embedding


async def embed_query(text: str) -> list[float]:
    """Embed a search query (shorter char limit)."""
    return await _embed_text(text, char_limit=2000)


# ── Metadata safety helper ─────────────────────────────────────────────────────

def _safe_meta_str(value: str, limit: int = 10_000) -> str:
    """
    Pinecone metadata values must be < 40KB total per vector.
    Truncate large strings to stay safe.
    """
    return (value or "")[:limit]


# ── Main store function ────────────────────────────────────────────────────────

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
    """
    Upsert 4 vectors for a session into Pinecone.
    Uses AsyncIO client — safe to call from FastAPI route handlers.
    Returns number of vectors stored.
    """
    host = _ensure_index_exists()

    base_meta = {
        "session_id":    session_id,
        "employee_id":   employee_id or "",
        "employee_name": employee_name or "",
        "job_title":     job_title or "",
        "department":    department or "",
    }

    vectors = []

    # ── 1. JD TEXT ──────────────────────────────────────────────────────────
    if jd_text:
        vectors.append({
            "id":     _vid(session_id, "jd_text"),
            "values": await _embed_text(jd_text),
            "metadata": {
                **base_meta,
                "doc_type": "jd_text",
                "raw_text": _safe_meta_str(jd_text),
            },
        })

    # ── 2. JD STRUCTURED ───────────────────────────────────────────────────
    if jd_structured:
        structured_raw = json.dumps(jd_structured, ensure_ascii=False)
        vectors.append({
            "id":     _vid(session_id, "jd_structured"),
            "values": await _embed_text(structured_raw),
            "metadata": {
                **base_meta,
                "doc_type": "jd_structured",
                "raw_json": _safe_meta_str(structured_raw),
            },
        })

    # ── 3. INSIGHTS ─────────────────────────────────────────────────────────
    if insights:
        insights_raw = json.dumps(insights, ensure_ascii=False)
        vectors.append({
            "id":     _vid(session_id, "insights"),
            "values": await _embed_text(insights_raw),
            "metadata": {
                **base_meta,
                "doc_type": "insights",
                "raw_json": _safe_meta_str(insights_raw),
            },
        })

    # ── 4. CONVERSATION HISTORY ─────────────────────────────────────────────
    if conversation_history:
        convo_raw = json.dumps(conversation_history, ensure_ascii=False)
        vectors.append({
            "id":     _vid(session_id, "conversation"),
            "values": await _embed_text(convo_raw),
            "metadata": {
                **base_meta,
                "doc_type": "conversation",
                "raw_json": _safe_meta_str(convo_raw),
            },
        })

    if not vectors:
        print(f"[Pinecone] ⚠️  No vectors to store for session {session_id}")
        return 0

    # ✅ Use AsyncIO index client — proper async upsert for FastAPI

    async with _pc_sync.IndexAsyncio(host=host) as idx:
        await idx.upsert(vectors=vectors, namespace=NAMESPACE)

    print(f"[Pinecone] ✅ Stored {len(vectors)} vectors for session {session_id}")
    return len(vectors)


# ── Search ─────────────────────────────────────────────────────────────────────

async def search_employees(
    query: str,
    doc_type: Optional[str] = None,
    department: Optional[str] = None,
    top_k: int = 12,
) -> list[dict]:
    """
    Semantic search over all employee vectors.
    Returns list of result dicts sorted by score (highest first).
    """
    host = _ensure_index_exists()
    query_vec = await embed_query(query)

    # Build metadata filter
    filters = {}
    if doc_type:
        filters["doc_type"] = {"$eq": doc_type}
    if department:
        filters["department"] = {"$eq": department}

    async with _pc_sync.IndexAsyncio(host=host) as idx:
        results = await idx.query(
            vector=query_vec,
            top_k=top_k,
            namespace=NAMESPACE,
            include_metadata=True,
            filter=filters if filters else None,
        )

    return [
        {
            "score":         round(m.score, 4),
            "session_id":    (m.metadata or {}).get("session_id", ""),
            "employee_id":   (m.metadata or {}).get("employee_id", ""),
            "employee_name": (m.metadata or {}).get("employee_name", ""),
            "job_title":     (m.metadata or {}).get("job_title", ""),
            "department":    (m.metadata or {}).get("department", ""),
            "doc_type":      (m.metadata or {}).get("doc_type", ""),
            "text": (
                (m.metadata or {}).get("raw_text")
                or (m.metadata or {}).get("raw_json", "")
            ),
        }
        for m in results.matches
    ]