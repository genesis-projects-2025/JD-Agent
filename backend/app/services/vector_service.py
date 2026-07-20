import asyncio
import logging
import math
from typing import Any, List, Optional

from langchain_google_genai import GoogleGenerativeAIEmbeddings
from pinecone import Pinecone, ServerlessSpec
from sqlalchemy import text

from app.core.config import settings

# Configure logger for tracking indexing, query performance, and connection states
logger = logging.getLogger(__name__)

# Global singletons for lazy initialization
_pc: Pinecone | None = None
_index = None
_embeddings: GoogleGenerativeAIEmbeddings | None = None
_index_name = settings.PINECONE_INDEX_NAME

# Canonical source labels to segregate JD types in vector storage
CANONICAL_SOURCE_APPROVED = "approved_jd"
CANONICAL_SOURCE_REFERENCE = "reference_jd"


def _normalise_role_tokens(text: str) -> set[str]:
    """
    Cleans and tokenizes job role titles to enable precise lexical comparison.
    
    Why:
      Standard vector embeddings can sometimes score unrelated jobs highly due to shared 
      generic corporate jargon. Lexical overlap of title tokens serves as a boosting mechanism 
      during our custom reranking.
    
    Steps:
      1. Strips out common English stop words and structural suffixes (e.g., 'jr', 'sr', 'role').
      2. Replaces slashes and hyphens with spaces to split compound titles (e.g., 'Software/Data-Engineer').
      3. Normalizes tokens to lowercase and keeps only tokens longer than 2 characters.
    """
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
    # Clean text, split into words, and filter
    tokens = {
        part.strip().lower()
        for part in text.replace("/", " ").replace("-", " ").split()
        if part.strip()
    }
    return {token for token in tokens if token not in stop_words and len(token) > 2}


def _role_overlap_score(role_query: str, candidate_role: str) -> float:
    """
    Calculates the proportion of query role tokens that are present in the candidate role.
    
    Why:
      If a user queries for a "Python Backend Developer", a candidate with "Backend Developer" 
      should rank higher than a candidate with "Frontend Developer" even if their overall 
      semantic embedding distance is similar.
    
    Returns:
      A float ratio between 0.0 (no overlap) and 1.0 (complete token overlap).
    """
    query_tokens = _normalise_role_tokens(role_query)
    candidate_tokens = _normalise_role_tokens(candidate_role)
    if not query_tokens or not candidate_tokens:
        return 0.0
    # Intersection of sets divided by length of query set
    return len(query_tokens & candidate_tokens) / len(query_tokens)


def _canonical_role(metadata: dict[str, Any]) -> str:
    """
    Extracts the role title from Pinecone metadata dict using fallback keys.
    """
    return str(metadata.get("role_title") or metadata.get("role") or "").strip()


def _canonical_department(metadata: dict[str, Any]) -> str:
    """
    Extracts the department name from Pinecone metadata dict using fallback keys.
    """
    return str(metadata.get("department") or metadata.get("dept") or "").strip()


def _is_matching_department(dept1: str, dept2: str) -> bool:
    """
    Compares two department strings and checks if they match, taking synonyms into account.
    
    Why:
      Departments are frequently referred to by different names (e.g., 'HR' vs 'Human Resources' 
      or 'SCM' vs 'Supply Chain Management'). This function ensures we can correlate them correctly 
      during search filtering or reranking.
      
    Returns:
      True if department names match or are synonyms; False otherwise.
    """
    d1 = str(dept1).strip().lower()
    d2 = str(dept2).strip().lower()
    if not d1 or not d2:
        return False
    if d1 == d2:
        return True
    
    # Predefined dictionary mapping common department variations and abbreviations
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
    
    # Check if either department is in the synonym list of the other, or if one is a substring of the other
    if d1 in synonyms and d2 in synonyms[d1]:
        return True
    if d2 in synonyms and d1 in synonyms[d2]:
        return True
    return d1 in d2 or d2 in d1


def _canonical_experience(metadata: dict[str, Any]) -> str:
    """
    Extracts experience level (e.g., Junior, Mid, Senior) from Pinecone metadata.
    """
    return str(metadata.get("experience_level") or metadata.get("level") or "").strip()


def _canonical_category(metadata: dict[str, Any]) -> str:
    """
    Extracts the document chunk's category (e.g., responsibilities, skills) from Pinecone metadata.
    """
    return str(metadata.get("category") or metadata.get("chunk_type") or "").strip()


def _coerce_text_list(items: Any) -> list[str]:
    """
    Sanitizes raw input (which could be lists, strings, or None) into a clean list of stripped strings.
    """
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
    """
    Standardizes the metadata dictionary structure sent to Pinecone.
    
    Why:
      Maintains strict schema compliance. Keeping the source text directly in the metadata 
      allows us to construct responses immediately upon retrieval, eliminating database lookup roundtrips.
    """
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
    """
    Initializes and returns the Pinecone client singleton.
    
    Why:
      Follows the singleton design pattern to reuse connections and avoid 
      re-authenticating on every database operation.
    """
    global _pc
    if _pc is None:
        if not settings.PINECONE_API_KEY:
            raise RuntimeError("Pinecone API key is not configured")
        _pc = Pinecone(api_key=settings.PINECONE_API_KEY)
    return _pc


async def _ensure_index_exists_async() -> None:
    """
    Asynchronously checks if the designated Pinecone index exists and creates it if missing.
    
    How:
      - Uses Pinecone client to fetch active indexes.
      - If settings.PINECONE_INDEX_NAME does not exist, starts serverless index creation.
      - Uses `asyncio.to_thread` to execute blocking synchronous client calls safely in a separate thread.
      - Wraps execution in a 10-second timeout block to prevent blocking the web server in case of network lags.
    """
    try:
        def _sync_ensure():
            client = get_pinecone_client()
            try:
                existing_indexes = [idx.name for idx in client.list_indexes()]
            except Exception as e:
                logger.warning(f"Could not list Pinecone indexes: {e}")
                return  # Non-critical failure: continue even if we can't fetch metadata
            
            if _index_name not in existing_indexes:
                logger.info("Creating Pinecone index: %s", _index_name)
                try:
                    # Dimension 3072 is standard for 'models/gemini-embedding-001'
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
    """
    Returns the synchronous Pinecone Index reference.
    """
    global _index
    if _index is None:
        try:
            _index = get_pinecone_client().Index(_index_name)
        except Exception as e:
            logger.error(f"Failed to get Pinecone index: {e}")
            return None
    return _index


async def get_index_async():
    """
    Asynchronously fetches the Pinecone index reference.
    
    Why:
      Ensures the index is first checked/created asynchronously, then obtains the index handle 
      via a thread pool to avoid blocking the asynchronous loop.
    """
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
    """
    Initializes and returns the Google Generative AI embeddings helper singleton.
    We target 'models/gemini-embedding-001' which produces 3072-dimensional vector spaces.
    """
    global _embeddings
    if _embeddings is None:
        _embeddings = GoogleGenerativeAIEmbeddings(
            model="models/gemini-embedding-001",
            google_api_key=settings.GEMINI_API_KEY,  # pyright: ignore
        )
    return _embeddings


async def vector_health() -> dict[str, Any]:
    """
    Checks the status and availability of the vector database.
    
    Returns:
      A dictionary indicating health status:
      - {"status": "disabled"} -> Pinecone configuration is missing.
      - {"status": "degraded", ...} -> Connection failed or index is unreachable.
      - {"status": "ok", ...} -> Connection is healthy, returns active vector counts.
    """
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
    employee_id: str | None = None,
):
    """
    Chunks and indexes a structured Job Description (JD) into the Pinecone database.
    
    Why:
      Instead of indexing the entire JD document text as one block (which weakens vector queries), 
      we divide the JD into categorized blocks (summary, tasks, tools, skills, education, workflow) 
      to allow high-accuracy, context-specific semantic searches (e.g. searching only responsibilities).
      
    How:
      1. Determines a canonical job title.
      2. Deletes any pre-existing vectors for this JD ID to prevent duplicates.
      3. Parses structured JSON details and appends text chunks with metadata for:
         - Role summary & purpose
         - Key responsibilities (further checking for metrics and projects indicators)
         - Tools & technologies list
         - Technical/required skills
         - Education/experience credentials
         - Extracted process workflows
      4. Asynchronously invokes Gemini Embeddings in thread pools to generate vector representations.
      5. Upserts batch vectors containing [vector ID, embedding array, metadata schema] into Pinecone.
    """
    try:
        # Determine the fallback hierarchy to get a valid job title
        jd_title = (
            title_override
            or structured_data.get("job_title")
            or structured_data.get("role_title")
            or structured_data.get("title")
            or (structured_data.get("employee_information", {}) or {}).get("job_title")
            or "Unknown Role"
        )

        # Clear out existing vectors associated with this JD ID to maintain a clean index
        try:
            idx = await get_index_async()
            if idx:
                await asyncio.to_thread(lambda: idx.delete(filter={"jd_id": jd_id}))
        except Exception as e:
            logger.warning("Failed to delete old vectors for JD %s: %s", jd_id, e)

        chunks: list[dict[str, Any]] = []

        # Helper callback to construct and register chunks in our processing queue
        def add_chunk(
            category: str,
            text: str,
            extra_meta: dict[str, Any] | None = None,
        ) -> None:
            if not text:
                return
            extra_to_use = dict(extra_meta) if extra_meta else {}
            if employee_id:
                extra_to_use["employee_id"] = employee_id

            metadata = _build_metadata(
                jd_id=jd_id,
                role_title=jd_title,
                department=department,
                experience_level=experience_level,
                category=category,
                source=source,
                text=text,
                extra=extra_to_use,
            )
            chunks.append(
                {
                    "id": f"{jd_id}_{category}_{len(chunks)}",
                    "text": text,
                    "metadata": metadata,
                }
            )

        # Extract & chunk role summary
        if summary := (structured_data.get("role_summary") or structured_data.get("purpose")):
            add_chunk("role_summary", f"Role: {jd_title}. Summary: {summary}")

        # Extract, prioritize, and chunk responsibilities
        tasks = (
            structured_data.get("key_responsibilities", [])
            or structured_data.get("responsibilities", [])
            or structured_data.get("tasks", [])
        )
        for index, task in enumerate(_coerce_text_list(tasks)):
            # Assume first 3 tasks are high-priority responsibilities
            importance = "high" if index < 3 else "medium"
            add_chunk(
                "responsibilities",
                f"Role: {jd_title} Responsibility: {task}",
                {"importance": importance},
            )

            # Look for indicators of KPIs or targets within tasks to tag as metrics
            task_lower = task.lower()
            if any(keyword in task_lower for keyword in ["metric", "kpi", "performance", "target", "sla"]):
                add_chunk(
                    "performance_metrics",
                    f"Role: {jd_title} Metric (Extracted): {task}",
                    {"importance": "high"},
                )
            # Look for projects/initiatives markers to catalog separately
            if any(keyword in task_lower for keyword in ["project", "initiative", "implementation", "launch"]):
                add_chunk(
                    "projects",
                    f"Role: {jd_title} Project (Extracted): {task}",
                    {"importance": "medium"},
                )

        # Extract and catalog software tools / hardware equipment
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

        # Extract and catalog core skills
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

        # Handle details defined within the 'additional_details' dictionary
        additional = structured_data.get("additional_details", {}) or {}
        if isinstance(additional, dict):
            if additional.get("performance_metrics"):
                add_chunk(
                    "performance_metrics",
                    f"Role: {jd_title} Metrics: {additional.get('performance_metrics')}",
                )
            if additional.get("projects"):
                add_chunk("projects", f"Role: {jd_title} Projects: {additional.get('projects')}")

            # Education & experience qualifications details
            education = additional.get("education") or structured_data.get("education")
            experience = additional.get("experience") or structured_data.get("experience")
            if education or experience:
                add_chunk(
                    "qualification",
                    f"Role: {jd_title} Education: {education or 'N/A'} Experience: {experience or 'N/A'}",
                )

        # Catalog parsed workflows / operational procedures
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

        # Prepare strings for Gemini embedding generation
        texts = [chunk["text"] for chunk in chunks]
        
        # Call Gemini embeddings safely using asyncio to avoid choking the event loop
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
        
        # Commit chunks to Pinecone index in a thread pool
        idx = await get_index_async()
        if idx:
            await asyncio.to_thread(lambda: idx.upsert(vectors=vectors))
        
        logger.info("Advanced RAG: Indexed JD %s (%s blocks, source=%s)", jd_id, len(chunks), source)
    except Exception as e:
        logger.error("Failed to index JD: %s", e)


def estimate_tokens(text: str) -> int:
    """
    A lightweight heuristic to estimate the number of LLM tokens in a string.
    
    Why:
      Avoids calling full tokenizers like TikToken for standard budget checks.
      Estimates ~3.5 characters per token.
    """
    return len(text) // 3.5 + 1 # pyright: ignore[reportReturnType]


async def query_advanced_context(
    role_query: str,
    block_type: str | List[str],
    experience_level: str | None = None,
    department: str | None = None,
    top_k: int = 5,
    token_budget: int = 800,
) -> List[str]:
    """
    Retrieves highly relevant, categorized text chunks from Pinecone, applying customized reranking.
    
    How it works:
      1. Converts the natural language role query and category filters into a search vector.
      2. Performs metadata filtering on categories (e.g., only search within 'skills' or 'responsibilities').
      3. Requests candidates (3x top_k to allow a pool for reranking).
      4. Iterates over candidates and adjusts search scores:
         - Department match: adds bonus score if they match (+0.04), heavily penalizes mismatch (-0.20).
         - Experience match: applies mild penalty for mismatch (-0.03).
         - Role Title overlap: computes lexical overlap and boosts scoring.
      5. Filters out low-scoring matches (similarity score below 0.3).
      6. Truncates results to fit within the `token_budget` limit to avoid bloating LLM prompts.
    """
    try:
        categories = [block_type] if isinstance(block_type, str) else block_type
        query_text = (
            f"Role: {role_query.strip()}. Specifically looking for {categories[0]} "
            "and technical environment details."
        )
        
        # Safely generate search vector
        query_vec = await asyncio.to_thread(
            lambda: get_embeddings().embed_query(query_text)
        )

        idx = await get_index_async()
        if not idx:
            return []

        # Query Pinecone using metadata category filter
        results = await asyncio.to_thread(
            lambda: idx.query(
                vector=query_vec,
                filter={"category": categories[0]} if len(categories) == 1 else {"category": {"$in": categories}}, # pyright: ignore[reportArgumentType]
                top_k=max(top_k * 3, 12),
                include_metadata=True,
            )
        )

        # Custom reranking logic implementation
        reranked: list[tuple[float, str]] = []
        for match in results.get("matches", []):  # pyright: ignore
            metadata = match.get("metadata", {})
            text = str(metadata.get("text", "")).strip()
            score = float(match.get("score", 0))
            candidate_role = _canonical_role(metadata)
            candidate_department = _canonical_department(metadata)
            candidate_experience = _canonical_experience(metadata)
            # Compute lexical title overlay factor
            role_overlap = _role_overlap_score(role_query, candidate_role or text)

            if score < 0.3 or not text:
                continue
            
            # Department matching logic: boost same department, suppress different ones
            if department and candidate_department:
                if _is_matching_department(department, candidate_department):
                    score += 0.04
                else:
                    score -= 0.20
            
            # Experience level matching logic
            if experience_level and candidate_experience and experience_level.lower() != candidate_experience.lower():
                score -= 0.03

            if score < 0.3:
                continue

            # Reranked score is a blend of semantic vector similarity + lexical overlap
            reranked.append((score + role_overlap, text))

        # Sort matches by the adjusted score descending
        reranked.sort(key=lambda item: item[0], reverse=True)
        
        # Enforce budget restrictions
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
    """
    Indexes a single standalone text chunk of a JD into Pinecone.
    
    Use case:
      Generally used when doing custom/ad-hoc additions of single snippets instead of 
      full structured JD parses.
    """
    try:
        # Generate single text query embedding
        embedding = await asyncio.to_thread(
            lambda: get_embeddings().embed_query(text)
        )

        # Standardize metadata schema
        meta = _build_metadata(
            jd_id=jd_id,
            role_title=str(metadata.get("role_title", "")).strip() or "Unknown Role",
            department=str(metadata.get("department", "")).strip() or "General",
            experience_level=str(metadata.get("experience_level") or metadata.get("level") or "Mid"),
            category=chunk_type,
            source=str(metadata.get("source") or CANONICAL_SOURCE_REFERENCE),
            text=text[:500],  # Truncate index view text field to 500 chars to avoid Pinecone metadata size issues
            extra={key: value for key, value in metadata.items() if key not in {"role_title", "department", "experience_level", "level", "source"}},
        )

        # Compute a stable identifier
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
    """
    Finds job descriptions in Pinecone that are similar to the provided search criteria.
    
    Why:
      Used when mapping dependencies, identifying overlapping responsibilities, or looking for 
      clones of JDs across departments to save HR creation time.
      
    How:
      1. Assembles query tags into a text query.
      2. Computes the query embedding.
      3. Searches Pinecone index for matches.
      4. Groups individual vector chunks back by `jd_id` so we return complete JDs instead of separate fragments.
      5. Selects the maximum similarity score among all chunks of a JD as its group similarity.
      6. Returns a list sorted by similarity.
    """
    try:
        # Synthesize query representation text
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
        
        # Safely compute embedding vector
        query_embedding = await asyncio.to_thread(
            lambda: get_embeddings().embed_query(query_text)
        )

        idx = await get_index_async()
        if not idx:
            return []

        # Run query with extra candidates to ensure good grouped diversity
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
            
            # Custom matching heuristics applied to group scores
            overlap = _role_overlap_score(role_title or "", candidate_role or str(metadata.get("text", "")))
            score = float(match.get("score", 0))
            if department and candidate_department:
                if _is_matching_department(department, candidate_department):
                    score += 0.04
                else:
                    score -= 0.20
            if level and candidate_level and level.lower() != candidate_level.lower():
                score -= 0.03

            # Grouping entries by JD ID
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

        # Sort JDs by calculated similarity score and limit
        return sorted(grouped.values(), key=lambda item: item["similarity"], reverse=True)[:limit]
    except Exception as e:
        logger.error("Similar JD search failed: %s", e)
        return []


async def get_embeddings_for_text(text_val: str) -> list[float]:
    """
    Generates and returns raw floats representing the text embedding vector.
    """
    embeddings = get_embeddings()
    vector = await asyncio.to_thread(lambda: embeddings.embed_query(text_val))
    return vector


async def find_similar_skills_or_tools(db, table_name: str, query_text: str, limit: int = 3, threshold: float = 0.7) -> list[dict]:
    """
    Searches for semantically similar tools or skills directly in the database.
    
    Why:
      We index standard skills and tools within relational database tables (e.g. Postgres or SQLite) 
      rather than Pinecone. This function allows us to locate semantic variations using either 
      native Postgres vector operations, or a standard Python fallback calculation for SQLite.
      
    How:
      1. Generates the embedding representation of search query.
      2. Detects the database dialect.
      3. For PostgreSQL:
         Uses pgvector's cosine distance operator `<=>` (1 - cosine distance is similarity) and 
         performs a native database query filtered by the similarity threshold.
      4. For SQLite / other fallbacks:
         Reads all relevant rows from the table, computes the cosine similarity in Python 
         using the dot product and square root magnitudes, filters by threshold, and returns the sorted matches.
    """
    try:
        vector = await get_embeddings_for_text(query_text)
        
        # Check current database dialect name
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
            # Fallback for SQLite/others: read all rows and calculate similarity mathematically in Python
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
                    
                    # Cosine similarity formula: (A . B) / (||A|| * ||B||)
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
            
            # Sort descending by calculated similarity
            results.sort(key=lambda x: x["similarity"], reverse=True)
            return results[:limit]
    except Exception as e:
        logger.error(f"Error in find_similar_skills_or_tools: {e}")
        return []


async def index_employee_kras(
    employee_id: str,
    kras_data: dict,
    role_title: str,
    department: str = "General",
    experience_level: str = "Mid",
):
    """
    Indexes an employee's Key Result Area (KRA) & Key Performance Indicator (KPI) framework into Pinecone.
    
    Why:
      Allows semantic queries to align employee output with standard job requirements, 
      facilitate appraisals, or map actual employee deliverables to the JD framework.
      
    How:
      1. Purges existing KRA/KPI vectors for the given employee ID under the 'performance_goals' category.
      2. Iterates over all KRAs in the payload:
         - Creates a chunk describing the KRA title, description, and weight (%).
         - Iterates over all KPIs under this KRA.
         - Creates a chunk for each KPI detailing its target metrics and descriptions.
      3. Generates vector embeddings for all KRA and KPI text chunks via Gemini.
      4. Upserts all chunks to Pinecone under the 'performance_goals' category with rich metadata referencing 
         employee ID, weights, metrics, and parent KRA titles.
    """
    try:
        # Delete old KRA/KPI vectors for this employee first to prevent stale records
        try:
            idx = await get_index_async()
            if idx:
                await asyncio.to_thread(lambda: idx.delete(filter={"employee_id": employee_id, "category": "performance_goals"}))
        except Exception as e:
            logger.warning("Failed to delete old KRA/KPI vectors for employee %s: %s", employee_id, e)

        chunks: list[dict[str, Any]] = []
        kras_list = kras_data.get("kras", [])
        
        for kra_idx, kra in enumerate(kras_list):
            kra_title = kra.get("title") or "Key Result Area"
            kra_desc = kra.get("description") or ""
            kra_weight = kra.get("weight") or 0
            
            # Synthesize text representation for the KRA
            kra_text = f"Employee ID: {employee_id}. Role: {role_title}. KRA {kra_idx+1}: {kra_title} (Weight: {kra_weight}%). Description: {kra_desc}"
            
            metadata = _build_metadata(
                jd_id=f"KRA_{employee_id}",
                role_title=role_title,
                department=department,
                experience_level=experience_level,
                category="performance_goals",
                source="employee_kra",
                text=kra_text,
                extra={"employee_id": employee_id, "kra_title": kra_title, "weight": kra_weight}
            )
            
            chunks.append({
                "id": f"{employee_id}_KRA_{kra_idx}",
                "text": kra_text,
                "metadata": metadata
            })
            
            # Extract and chunk nested KPIs under the current KRA
            kpis_list = kra.get("kpis", [])
            for kpi_idx, kpi in enumerate(kpis_list):
                kpi_title = kpi.get("title") or "Key Performance Indicator"
                kpi_metric = kpi.get("metric") or ""
                kpi_target = kpi.get("target") or ""
                kpi_desc = kpi.get("description") or ""
                
                # Synthesize text representation for the KPI
                kpi_text = (
                    f"Employee ID: {employee_id}. Role: {role_title}. KRA: {kra_title}. "
                    f"KPI {kpi_idx+1}: {kpi_title}. Metric: {kpi_metric}. Target: {kpi_target}. "
                    f"Description: {kpi_desc}"
                )
                
                kpi_metadata = _build_metadata(
                    jd_id=f"KRA_{employee_id}",
                    role_title=role_title,
                    department=department,
                    experience_level=experience_level,
                    category="performance_goals",
                    source="employee_kpi",
                    text=kpi_text,
                    extra={
                        "employee_id": employee_id,
                        "kra_title": kra_title,
                        "kpi_title": kpi_title,
                        "metric": kpi_metric,
                        "target": kpi_target
                    }
                )
                
                chunks.append({
                    "id": f"{employee_id}_KRA_{kra_idx}_KPI_{kpi_idx}",
                    "text": kpi_text,
                    "metadata": kpi_metadata
                })

        if not chunks:
            return

        texts = [chunk["text"] for chunk in chunks]
        
        # Asynchronously generate embeddings
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
        
        # Upsert KRA & KPI vectors to Pinecone
        idx = await get_index_async()
        if idx:
            await asyncio.to_thread(lambda: idx.upsert(vectors=vectors))
            
        logger.info("Indexed employee KRA/KPI framework for employee %s (%s vectors)", employee_id, len(chunks))
    except Exception as e:
        logger.error("Failed to index employee KRA/KPI: %s", e)
