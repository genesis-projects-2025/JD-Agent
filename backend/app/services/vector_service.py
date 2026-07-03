import asyncio
import logging
from typing import Any, List, Optional

from langchain_google_genai import GoogleGenerativeAIEmbeddings
from pinecone import Pinecone, ServerlessSpec

from app.core.config import settings

logger = logging.getLogger(__name__)

_pc: Pinecone | None = None
_index = None
_embeddings: GoogleGenerativeAIEmbeddings | None = None
_index_name = settings.PINECONE_INDEX_NAME

CANONICAL_SOURCE_APPROVED = "approved_jd"
CANONICAL_SOURCE_REFERENCE = "reference_jd"


def _normalise_role_tokens(text: str) -> set[str]:
    stop_words = {
        "a",
        "an",
        "and",
        "for",
        "in",
        "of",
        "the",
        "to",
        "with",
        "role",
        "jr",
        "sr",
    }
    tokens = {
        part.strip().lower()
        for part in text.replace("/", " ").replace("-", " ").split()
        if part.strip()
    }
    return {token for token in tokens if token not in stop_words and len(token) > 2}


def _role_overlap_score(role_query: str, candidate_role: str) -> float:
    query_tokens = _normalise_role_tokens(role_query)
    candidate_tokens = _normalise_role_tokens(candidate_role)
    if not query_tokens or not candidate_tokens:
        return 0.0
    return len(query_tokens & candidate_tokens) / len(query_tokens)


def _canonical_role(metadata: dict[str, Any]) -> str:
    return str(metadata.get("role_title") or metadata.get("role") or "").strip()


def _canonical_department(metadata: dict[str, Any]) -> str:
    return str(metadata.get("department") or metadata.get("dept") or "").strip()


def _is_matching_department(dept1: str, dept2: str) -> bool:
    d1 = str(dept1).strip().lower()
    d2 = str(dept2).strip().lower()
    if not d1 or not d2:
        return False
    if d1 == d2:
        return True
    
    synonyms = {
        "r&d": {"research & development", "research and development", "analytical r&d", "chemical r&d", "nano r&d", "r & d", "r and d"},
        "research & development": {"r&d", "research and development", "analytical r&d", "chemical r&d", "nano r&d", "r & d", "r and d"},
        "research and development": {"r&d", "research & development", "analytical r&d", "chemical r&d", "nano r&d", "r & d", "r and d"},
        "hr": {"hrd", "human resources", "hr & admin", "hr - bhr", "hr operations"},
        "human resources": {"hr", "hrd", "hr & admin", "hr - bhr", "hr operations"},
        "hrd": {"hr", "human resources", "hr & admin", "hr - bhr", "hr operations"},
        "finance": {"finance & accounting", "accounts", "accounting", "finance and accounting"},
        "finance & accounting": {"finance", "accounts", "accounting", "finance and accounting"},
        "accounts": {"finance", "finance & accounting", "accounting", "finance and accounting"},
        "qa": {"quality assurance", "cqa", "cqa & qa"},
        "quality assurance": {"qa", "cqa"},
        "cqa": {"qa", "quality assurance"},
        "qc": {"quality control"},
        "quality control": {"qc"},
        "scm": {"procurement", "material sourcing", "supply chain", "supply chain management"},
        "procurement": {"scm", "material sourcing", "supply chain", "supply chain management"},
    }
    
    if d1 in synonyms and d2 in synonyms[d1]:
        return True
    if d2 in synonyms and d1 in synonyms[d2]:
        return True
    return d1 in d2 or d2 in d1


def _canonical_experience(metadata: dict[str, Any]) -> str:
    return str(metadata.get("experience_level") or metadata.get("level") or "").strip()


def _canonical_category(metadata: dict[str, Any]) -> str:
    return str(metadata.get("category") or metadata.get("chunk_type") or "").strip()


def _coerce_text_list(items: Any) -> list[str]:
    if not isinstance(items, list):
        return []
    return [str(item).strip() for item in items if str(item).strip()]


def _build_metadata(
    *,
    jd_id: str,
    role_title: str,
    department: str,
    experience_level: str,
    category: str,
    source: str,
    text: str,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    metadata = {
        "jd_id": jd_id,
        "role_title": role_title,
        "department": department,
        "experience_level": experience_level,
        "category": category,
        "source": source,
        "text": text,
    }
    if extra:
        metadata.update(extra)
    return metadata


def get_pinecone_client() -> Pinecone:
    global _pc
    if _pc is None:
        if not settings.PINECONE_API_KEY:
            raise RuntimeError("Pinecone API key is not configured")
        _pc = Pinecone(api_key=settings.PINECONE_API_KEY)
    return _pc


async def _ensure_index_exists_async() -> None:
    """Async wrapper for Pinecone index creation with timeout."""
    try:
        def _sync_ensure():
            client = get_pinecone_client()
            try:
                existing_indexes = [idx.name for idx in client.list_indexes()]
            except Exception as e:
                logger.warning(f"Could not list Pinecone indexes: {e}")
                return  # Non-critical failure
            
            if _index_name not in existing_indexes:
                logger.info("Creating Pinecone index: %s", _index_name)
                try:
                    client.create_index(
                        name=_index_name,
                        dimension=3072,
                        metric="cosine",
                        spec=ServerlessSpec(cloud="aws", region="us-east-1"),
                    )
                except Exception as e:
                    logger.warning(f"Could not create Pinecone index: {e}")
        
        # Run sync Pinecone operations in thread pool with 10s timeout
        await asyncio.wait_for(
            asyncio.to_thread(_sync_ensure),
            timeout=10.0
        )
    except asyncio.TimeoutError:
        logger.warning("Pinecone index check timed out after 10s - continuing anyway")
    except Exception as e:
        logger.warning(f"Pinecone initialization failed: {e} - continuing anyway")


def get_index():
    """Get Pinecone index (use get_index_async for async context)."""
    global _index
    if _index is None:
        try:
            _index = get_pinecone_client().Index(_index_name)
        except Exception as e:
            logger.error(f"Failed to get Pinecone index: {e}")
            return None
    return _index


async def get_index_async():
    """Async-safe getter for Pinecone index."""
    global _index
    if _index is None:
        await _ensure_index_exists_async()
        try:
            _index = await asyncio.to_thread(lambda: get_pinecone_client().Index(_index_name))
        except Exception as e:
            logger.error(f"Failed to get Pinecone index: {e}")
            return None
    return _index


def get_embeddings() -> GoogleGenerativeAIEmbeddings:
    global _embeddings
    if _embeddings is None:
        _embeddings = GoogleGenerativeAIEmbeddings(
            model="models/gemini-embedding-001",
            google_api_key=settings.GEMINI_API_KEY,  # pyright: ignore
        )
    return _embeddings


async def vector_health() -> dict[str, Any]:
    if not settings.PINECONE_API_KEY:
        return {"status": "disabled"}
    try:
        idx = await get_index_async()
        if idx is None:
            return {"status": "degraded", "detail": "Could not connect to Pinecone"}
        stats = await asyncio.to_thread(idx.describe_index_stats)
        return {
            "status": "ok",
            "index_name": _index_name,
            "total_vector_count": stats.get("total_vector_count", 0),
        }
    except Exception as e:
        logger.warning("Vector health degraded: %s", e)
        return {"status": "degraded", "detail": str(e)}


async def index_approved_jd(
    jd_id: str,
    structured_data: dict,
    department: str = "General",
    title_override: str | None = None,
    experience_level: str = "Mid",
    insights_data: dict | None = None,
    source: str = CANONICAL_SOURCE_APPROVED,
):
    """Chunk and index an approved JD into Pinecone with canonical metadata."""
    try:
        jd_title = (
            title_override
            or structured_data.get("job_title")
            or structured_data.get("role_title")
            or structured_data.get("title")
            or (structured_data.get("employee_information", {}) or {}).get("job_title")
            or "Unknown Role"
        )

        try:
            idx = await get_index_async()
            if idx:
                await asyncio.to_thread(lambda: idx.delete(filter={"jd_id": jd_id}))
        except Exception as e:
            logger.warning("Failed to delete old vectors for JD %s: %s", jd_id, e)

        chunks: list[dict[str, Any]] = []

        def add_chunk(
            category: str,
            text: str,
            extra_meta: dict[str, Any] | None = None,
        ) -> None:
            if not text:
                return
            metadata = _build_metadata(
                jd_id=jd_id,
                role_title=jd_title,
                department=department,
                experience_level=experience_level,
                category=category,
                source=source,
                text=text,
                extra=extra_meta,
            )
            chunks.append(
                {
                    "id": f"{jd_id}_{category}_{len(chunks)}",
                    "text": text,
                    "metadata": metadata,
                }
            )

        if summary := (structured_data.get("role_summary") or structured_data.get("purpose")):
            add_chunk("role_summary", f"Role: {jd_title}. Summary: {summary}")

        tasks = (
            structured_data.get("key_responsibilities", [])
            or structured_data.get("responsibilities", [])
            or structured_data.get("tasks", [])
        )
        for index, task in enumerate(_coerce_text_list(tasks)):
            importance = "high" if index < 3 else "medium"
            add_chunk(
                "responsibilities",
                f"Role: {jd_title} Responsibility: {task}",
                {"importance": importance},
            )

            task_lower = task.lower()
            if any(keyword in task_lower for keyword in ["metric", "kpi", "performance", "target", "sla"]):
                add_chunk(
                    "performance_metrics",
                    f"Role: {jd_title} Metric (Extracted): {task}",
                    {"importance": "high"},
                )
            if any(keyword in task_lower for keyword in ["project", "initiative", "implementation", "launch"]):
                add_chunk(
                    "projects",
                    f"Role: {jd_title} Project (Extracted): {task}",
                    {"importance": "medium"},
                )

        tools = _coerce_text_list(
            structured_data.get("tools_and_technologies", [])
            or structured_data.get("tools", [])
        )
        if tools:
            add_chunk(
                "tools", 
                f"Role: {jd_title} Tools: {', '.join(tools)}", 
                {"items": tools}
            )

        skills = _coerce_text_list(
            structured_data.get("skills", [])
            or structured_data.get("technical_skills", [])
            or structured_data.get("required_skills", [])
        )
        if skills:
            add_chunk(
                "skills", 
                f"Role: {jd_title} Skills: {', '.join(skills)}", 
                {"items": skills}
            )

        additional = structured_data.get("additional_details", {}) or {}
        if isinstance(additional, dict):
            if additional.get("performance_metrics"):
                add_chunk(
                    "performance_metrics",
                    f"Role: {jd_title} Metrics: {additional.get('performance_metrics')}",
                )
            if additional.get("projects"):
                add_chunk("projects", f"Role: {jd_title} Projects: {additional.get('projects')}")

            education = additional.get("education") or structured_data.get("education")
            experience = additional.get("experience") or structured_data.get("experience")
            if education or experience:
                add_chunk(
                    "qualification",
                    f"Role: {jd_title} Education: {education or 'N/A'} Experience: {experience or 'N/A'}",
                )

        if insights_data and isinstance(insights_data, dict):
            workflows = insights_data.get("workflows", {})
            if isinstance(workflows, dict):
                for workflow_name, workflow_data in workflows.items():
                    steps = _coerce_text_list((workflow_data or {}).get("steps", []))
                    if steps:
                        add_chunk(
                            "workflow",
                            f"Role: {jd_title} Workflow ({workflow_name}): {' -> '.join(steps)}",
                        )

        if not chunks:
            return

        texts = [chunk["text"] for chunk in chunks]
        
        # Wrap blocking embedding operation
        vector_embeddings = await asyncio.to_thread(
            lambda: get_embeddings().embed_documents(texts)
        )
        vectors = [
            {
                "id": chunk["id"],
                "values": vector_embeddings[index],
                "metadata": chunk["metadata"],
            }
            for index, chunk in enumerate(chunks)
        ]
        
        # Wrap blocking upsert operation
        idx = await get_index_async()
        if idx:
            await asyncio.to_thread(lambda: idx.upsert(vectors=vectors))
        
        logger.info("Advanced RAG: Indexed JD %s (%s blocks, source=%s)", jd_id, len(chunks), source)
    except Exception as e:
        logger.error("Failed to index JD: %s", e)


def estimate_tokens(text: str) -> int:
    return len(text) // 3.5 + 1 # pyright: ignore[reportReturnType]


async def query_advanced_context(
    role_query: str,
    block_type: str | List[str],
    experience_level: str | None = None,
    department: str | None = None,
    top_k: int = 5,
    token_budget: int = 800,
) -> List[str]:
    """Retrieve categorized context with role-aware reranking."""
    try:
        categories = [block_type] if isinstance(block_type, str) else block_type
        query_text = (
            f"Role: {role_query.strip()}. Specifically looking for {categories[0]} "
            "and technical environment details."
        )
        
        # Wrap blocking embedding operation
        query_vec = await asyncio.to_thread(
            lambda: get_embeddings().embed_query(query_text)
        )

        idx = await get_index_async()
        if not idx:
            return []

        # Wrap blocking query operation
        results = await asyncio.to_thread(
            lambda: idx.query(
                vector=query_vec,
                filter={"category": categories[0]} if len(categories) == 1 else {"category": {"$in": categories}}, # pyright: ignore[reportArgumentType]
                top_k=max(top_k * 3, 12),
                include_metadata=True,
            )
        )

        reranked: list[tuple[float, str]] = []
        for match in results.get("matches", []):  # pyright: ignore
            metadata = match.get("metadata", {})
            text = str(metadata.get("text", "")).strip()
            score = float(match.get("score", 0))
            candidate_role = _canonical_role(metadata)
            candidate_department = _canonical_department(metadata)
            candidate_experience = _canonical_experience(metadata)
            role_overlap = _role_overlap_score(role_query, candidate_role or text)

            if score < 0.3 or not text:
                continue
            if department and candidate_department:
                if _is_matching_department(department, candidate_department):
                    score += 0.04
                else:
                    score -= 0.20
            if experience_level and candidate_experience and experience_level.lower() != candidate_experience.lower():
                score -= 0.03

            if score < 0.3:
                continue

            reranked.append((score + role_overlap, text))

        reranked.sort(key=lambda item: item[0], reverse=True)
        contexts: list[str] = []
        consumed_tokens = 0
        for _, text in reranked:
            text_tokens = estimate_tokens(text)
            if consumed_tokens + text_tokens > token_budget:
                break
            contexts.append(text)
            consumed_tokens += text_tokens
            if len(contexts) >= top_k:
                break
        return contexts
    except Exception as e:
        logger.error("Advanced context query failed: %s", e)
        return []


async def index_jd_document(jd_id: str, text: str, chunk_type: str, metadata: dict):
    """Index a single JD document chunk using canonical vector metadata."""
    try:
        # Always wrap embedding in asyncio.to_thread
        embedding = await asyncio.to_thread(
            lambda: get_embeddings().embed_query(text)
        )

        meta = _build_metadata(
            jd_id=jd_id,
            role_title=str(metadata.get("role_title", "")).strip() or "Unknown Role",
            department=str(metadata.get("department", "")).strip() or "General",
            experience_level=str(metadata.get("experience_level") or metadata.get("level") or "Mid"),
            category=chunk_type,
            source=str(metadata.get("source") or CANONICAL_SOURCE_REFERENCE),
            text=text[:500],
            extra={key: value for key, value in metadata.items() if key not in {"role_title", "department", "experience_level", "level", "source"}},
        )

        vector_id = f"{jd_id}_{chunk_type}_{hash(text) % 10000}"
        idx = await get_index_async()
        if idx:
            await asyncio.to_thread(
                lambda: idx.upsert(vectors=[{"id": vector_id, "values": embedding, "metadata": meta}])
            )
        logger.info("Indexed JD chunk: %s - %s", jd_id, chunk_type)
    except Exception as e:
        logger.error("Failed to index JD document: %s", e)


async def find_similar_jds(
    role_title: Optional[str] = None,
    department: Optional[str] = None,
    level: Optional[str] = None,
    skills: Optional[list] = None,
    limit: int = 5,
) -> list:
    """Find similar JDs using vector search with canonical metadata and reranking."""
    try:
        query_parts = []
        if role_title:
            query_parts.append(f"Role: {role_title}")
        if department:
            query_parts.append(f"Department: {department}")
        if level:
            query_parts.append(f"Experience level: {level}")
        if skills:
            query_parts.append(f"Skills: {', '.join(skills[:5])}")
        if not query_parts:
            return []

        query_text = ". ".join(query_parts)
        
        # Wrap blocking embedding operation
        query_embedding = await asyncio.to_thread(
            lambda: get_embeddings().embed_query(query_text)
        )

        idx = await get_index_async()
        if not idx:
            return []

        # Wrap blocking query operation
        results = await asyncio.to_thread(
            lambda: idx.query(
                vector=query_embedding,
                top_k=max(limit * 6, 12),
                include_metadata=True,
            )
        )

        grouped: dict[str, dict[str, Any]] = {}
        for match in results.get("matches", []):  # pyright: ignore
            metadata = match.get("metadata", {})
            jd_id = metadata.get("jd_id")
            if not jd_id:
                continue

            candidate_role = _canonical_role(metadata)
            candidate_department = _canonical_department(metadata)
            candidate_level = _canonical_experience(metadata)
            overlap = _role_overlap_score(role_title or "", candidate_role or str(metadata.get("text", "")))
            score = float(match.get("score", 0))
            if department and candidate_department:
                if _is_matching_department(department, candidate_department):
                    score += 0.04
                else:
                    score -= 0.20
            if level and candidate_level and level.lower() != candidate_level.lower():
                score -= 0.03

            if jd_id not in grouped:
                grouped[jd_id] = {
                    "jd_id": jd_id,
                    "role_title": candidate_role or "Unknown Role",
                    "department": candidate_department,
                    "level": candidate_level,
                    "similarity": score + overlap,
                    "chunks": [],
                }
            else:
                grouped[jd_id]["similarity"] = max(grouped[jd_id]["similarity"], score + overlap)

            text = str(metadata.get("text", ""))
            grouped[jd_id]["chunks"].append(
                {
                    "type": _canonical_category(metadata),
                    "text": text[:200] + "..." if len(text) > 200 else text,
                }
            )

        return sorted(grouped.values(), key=lambda item: item["similarity"], reverse=True)[:limit]
    except Exception as e:
        logger.error("Similar JD search failed: %s", e)
        return []

import math
from sqlalchemy import text

async def get_embeddings_for_text(text_val: str) -> list[float]:
    embeddings = get_embeddings()
    vector = await asyncio.to_thread(lambda: embeddings.embed_query(text_val))
    return vector

async def find_similar_skills_or_tools(db, table_name: str, query_text: str, limit: int = 3, threshold: float = 0.7) -> list[dict]:
    """Search similar tools or skills in the database using pgvector or a Python fallback for SQLite."""
    try:
        vector = await get_embeddings_for_text(query_text)
        
        # Check dialect
        async_conn = await db.connection()
        dialect_name = async_conn.dialect.name
        
        if dialect_name == "postgresql":
            vector_str = "[" + ",".join(map(str, vector)) + "]"
            # Native PostgreSQL pgvector cosine distance: <=> operator
            sql_query = text(f"""
                SELECT id, name, (1.0 - (embedding <=> :vec::vector)) as similarity 
                FROM {table_name} 
                WHERE embedding IS NOT NULL AND (1.0 - (embedding <=> :vec::vector)) >= :threshold
                ORDER BY embedding <=> :vec::vector 
                LIMIT :limit
            """)
            res = await db.execute(sql_query, {"vec": vector_str, "limit": limit, "threshold": threshold})
            return [{"id": r.id, "name": r.name, "similarity": float(r.similarity)} for r in res.all()]
        else:
            # Fallback for SQLite/others: read all rows and calculate in python
            sql_query = text(f"SELECT id, name, embedding FROM {table_name} WHERE embedding IS NOT NULL")
            res = await db.execute(sql_query)
            rows = res.all()
            
            results = []
            for r in rows:
                try:
                    r_vec = r.embedding
                    if isinstance(r_vec, str):
                        r_vec = [float(x) for x in r_vec.strip("[]").split(",") if x.strip()]
                    if not r_vec or len(r_vec) != len(vector):
                        continue
                    
                    # Cosine similarity calculation
                    dot_product = sum(a * b for a, b in zip(vector, r_vec))
                    magnitude_a = math.sqrt(sum(a * a for a in vector))
                    magnitude_b = math.sqrt(sum(b * b for b in r_vec))
                    if magnitude_a == 0 or magnitude_b == 0:
                        similarity = 0.0
                    else:
                        similarity = dot_product / (magnitude_a * magnitude_b)
                        
                    if similarity >= threshold:
                        results.append({"id": r.id, "name": r.name, "similarity": similarity})
                except Exception:
                    continue
            
            # Sort by similarity
            results.sort(key=lambda x: x["similarity"], reverse=True)
            return results[:limit]
    except Exception as e:
        logger.error(f"Error in find_similar_skills_or_tools: {e}")
        return []
