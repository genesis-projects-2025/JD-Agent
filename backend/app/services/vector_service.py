import logging
import asyncio
from typing import List
from pinecone import Pinecone, ServerlessSpec
from langchain_google_genai import GoogleGenerativeAIEmbeddings
from app.core.config import settings

logger = logging.getLogger(__name__)

# Initialize Pinecone
pc = Pinecone(api_key=settings.PINECONE_API_KEY)
index_name = settings.PINECONE_INDEX_NAME

# Ensure index exists
existing_indexes = [idx.name for idx in pc.list_indexes()]
if index_name not in existing_indexes:
    logger.info(f"Creating Pinecone index: {index_name}")
    pc.create_index(
        name=index_name,
        dimension=3072, 
        metric="cosine",
        spec=ServerlessSpec(cloud="aws", region="us-east-1")
    )

index = pc.Index(index_name)

# Initialize Embeddings
embeddings = GoogleGenerativeAIEmbeddings(
    model="models/gemini-embedding-001",
    google_api_key=settings.GEMINI_API_KEY
)

async def index_approved_jd(
    jd_id: str, 
    structured_data: dict, 
    department: str = "General", 
    title_override: str = None,
    experience_level: str = "Mid",
    insights_data: dict = None,
    source: str = "approved_jd"
):
    """Chunk and index an approved JD into Pinecone with rich metadata.
    
    Categories: role_summary, responsibilities, tools, skills, workflow, performance_metrics, projects
    """
    try:
        jd_title = (
            title_override or 
            structured_data.get("job_title") or 
            structured_data.get("role_title") or 
            structured_data.get("title") or 
            (structured_data.get("employee_information", {}) or {}).get("job_title") or
            "Unknown Role"
        )
        
        # 0. Delete existing vectors for this JD to avoid duplicates/stale data
        try:
            index.delete(filter={"jd_id": jd_id})
        except Exception as e:
            logger.warning(f"Failed to delete old vectors for JD {jd_id}: {e}")

        # 1. Prepare base metadata
        chunks = []
        base_meta = {
            "jd_id": jd_id,
            "role": jd_title,
            "dept": department,
            "team": department,  # Default team to department
            "experience_level": experience_level,
            "company": "Pulse Pharma",
            "source": source 
        }
        
        # Helper to append chunks
        def add_chunk(chunk_type: str, text: str, extra_meta: dict = None):
            if not text: return
            meta = {**base_meta, "category": chunk_type, "text": text}
            if extra_meta: meta.update(extra_meta)
            chunk_id = f"{jd_id}_{chunk_type}_{len(chunks)}"
            chunks.append({"id": chunk_id, "text": text, "metadata": meta})

        # role_summary
        if summary := (structured_data.get("role_summary") or structured_data.get("purpose")):
            add_chunk("role_summary", f"Role: {jd_title}. Summary: {summary}")
            
        # responsibilities
        tasks = (structured_data.get("key_responsibilities", []) or 
                 structured_data.get("responsibilities", []) or 
                 structured_data.get("tasks", []))
        if tasks:
            for i, t in enumerate(tasks):
                if not t: continue
                # NEW: Importance Tag (High for first 3, Medium for others)
                importance = "high" if i < 3 else "medium"
                add_chunk("responsibilities", f"Role: {jd_title} Responsibility: {t}", {"importance": importance})
                
                # Check for performance metrics or projects within tasks/responsibilities
                t_lower = str(t).lower()
                if any(k in t_lower for k in ["metric", "kpi", "performance", "target", "sla"]):
                    add_chunk("performance_metrics", f"Role: {jd_title} Metric (Extracted): {t}", {"importance": "high"})
                if any(k in t_lower for k in ["project", "initiative", "implementation", "launch"]):
                    add_chunk("projects", f"Role: {jd_title} Project (Extracted): {t}", {"importance": "medium"})
            
        # tools
        tools = (structured_data.get("tools_and_technologies", []) or 
                 structured_data.get("tools", []))
        if tools:
            add_chunk("tools", f"Role: {jd_title} Tools: {', '.join(tools)}")
            
        # skills
        skills = (structured_data.get("skills", []) or 
                  structured_data.get("technical_skills", []) or 
                  structured_data.get("required_skills", []))
        if skills:
            add_chunk("skills", f"Role: {jd_title} Skills: {', '.join(skills)}")
            
        # performance_metrics (explicit)
        quals = structured_data.get("additional_details", {}) or {}
        if type(quals) is dict and quals.get("performance_metrics"):
            add_chunk("performance_metrics", f"Role: {jd_title} Metrics: {quals.get('performance_metrics')}")
            
        # projects (explicit)
        if type(quals) is dict and quals.get("projects"):
            add_chunk("projects", f"Role: {jd_title} Projects: {quals.get('projects')}")

        # qualifications
        if type(quals) is dict:
            edu = quals.get("education") or structured_data.get("education")
            exp = quals.get("experience") or structured_data.get("experience")
            if edu or exp:
                add_chunk("qualification", f"Role: {jd_title} Education: {edu or 'N/A'} Experience: {exp or 'N/A'}")

        # workflow (extract from insights_data if passed)
        if insights_data and isinstance(insights_data, dict):
            workflows = insights_data.get("workflows", {})
            if workflows and isinstance(workflows, dict):
                for wf_name, wf_data in workflows.items():
                    steps = wf_data.get("steps", [])
                    if steps:
                        flow_str = " → ".join(steps)
                        add_chunk("workflow", f"Role: {jd_title} Workflow ({wf_name}): {flow_str}")

        if not chunks:
            return

        # 2. Upsert
        texts = [c["text"] for c in chunks]
        vector_embeddings = embeddings.embed_documents(texts)
        
        vectors = []
        for i, chunk in enumerate(chunks):
            vectors.append({
                "id": chunk["id"],
                "values": vector_embeddings[i],
                "metadata": chunk["metadata"]
            })
            
        index.upsert(vectors=vectors)
        logger.info(f"Advanced RAG: Indexed JD {jd_id} ({len(chunks)} blocks, source={source})")
        
    except Exception as e:
        logger.error(f"Failed to index JD: {e}")

def estimate_tokens(text: str) -> int:
    return len(text) // 3.5 + 1

async def query_advanced_context(
    role_query: str, 
    block_type: str | List[str], 
    experience_level: str = None,
    department: str = None, 
    top_k: int = 5,
    token_budget: int = 800
) -> List[str]:
    """Retrieve categorized context with metadata filtering support.
    
    Supports querying multiple categories if 'block_type' is a list.
    """
    try:
        # Handle multiple block types
        categories = [block_type] if isinstance(block_type, str) else block_type
        
        # Enhance query string to prioritize role title and improve precision
        query_text = f"Role: {role_query.strip()}. Specifically looking for {categories[0]} and technical environment details."
        query_vec = embeddings.embed_query(query_text)
        
        # Build Pinecone filter
        filter_dict = {}
        if len(categories) == 1:
            filter_dict["category"] = categories[0]
        else:
            filter_dict["category"] = {"$in": categories}
            
        if experience_level:
            filter_dict["experience_level"] = experience_level
        if department:
            filter_dict["dept"] = department
            
        # Prevent ASGI loop block on synchronous embedding call
        import asyncio
        if asyncio.iscoroutinefunction(embeddings.embed_query):
            query_vec = await embeddings.embed_query(query_text)
        else:
            query_vec = embeddings.embed_query(query_text)
        
        # Query Pinecone
        results = index.query(
            vector=query_vec,
            filter=filter_dict,
            top_k=top_k,
            include_metadata=True
        )
        
        # Format results
        contexts = []
        for match in results["matches"]:
            score = match.get("score", 0)
            metadata = match.get("metadata", {})
            text = match.get("document", "")
            
            # Skip low-confidence matches
            if score < 0.3:
                continue
                
            context_entry = {
                "text": text,
                "score": score,
                "category": metadata.get("category", "unknown"),
                "role": metadata.get("role", ""),
                "department": metadata.get("dept", ""),
                "experience_level": metadata.get("experience_level", "")
            }
            contexts.append(context_entry)
        
        return contexts
        
    except Exception as e:
        logger.error(f"Advanced context query failed: {e}")
        return []


async def index_jd_document(
    jd_id: str,
    text: str,
    chunk_type: str,
    metadata: dict
):
    """
    Index a single JD document chunk in Pinecone
    
    Args:
        jd_id: Reference JD ID
        text: Text content to index
        chunk_type: Type of chunk (skills, tools, tasks, etc.)
        metadata: Additional metadata
    """
    try:
        # Generate embedding
        if asyncio.iscoroutinefunction(embeddings.embed_query):
            embedding = await embeddings.embed_query(text)
        else:
            embedding = embeddings.embed_query(text)
        
        # Prepare metadata
        meta = {
            "jd_id": jd_id,
            "chunk_type": chunk_type,
            "text": text[:500],  # Store first 500 chars
            **metadata
        }
        
        # Create vector ID
        vector_id = f"{jd_id}_{chunk_type}_{hash(text) % 10000}"
        
        # Upsert to Pinecone
        index.upsert(
            vectors=[{
                "id": vector_id,
                "values": embedding,
                "metadata": meta
            }]
        )
        
        logger.info(f"Indexed JD chunk: {jd_id} - {chunk_type}")
        
    except Exception as e:
        logger.error(f"Failed to index JD document: {e}")


async def find_similar_jds(
    role_title: str = None,
    department: str = None,
    level: str = None,
    skills: list = None,
    limit: int = 5
) -> list:
    """
    Find similar JDs using vector search
    
    Args:
        role_title: Role to match
        department: Department to match
        level: Seniority level to match
        skills: Skills to match
        limit: Maximum number of results
        
    Returns:
        List of similar JDs with metadata
    """
    try:
        # Build query text from available parameters
        query_parts = []
        if role_title:
            query_parts.append(f"Role: {role_title}")
        if department:
            query_parts.append(f"Department: {department}")
        if level:
            query_parts.append(f"Level: {level}")
        if skills:
            query_parts.append(f"Skills: {', '.join(skills[:5])}")
        
        if not query_parts:
            return []
        
        query_text = ". ".join(query_parts)
        
        # Generate embedding
        if asyncio.iscoroutinefunction(embeddings.embed_query):
            query_embedding = await embeddings.embed_query(query_text)
        else:
            query_embedding = embeddings.embed_query(query_text)
        
        # Build filter
        filter_dict = {}
        if department:
            filter_dict["department"] = department
        if level:
            filter_dict["level"] = level
        
        # Query Pinecone
        results = index.query(
            vector=query_embedding,
            filter=filter_dict if filter_dict else None,
            top_k=limit,
            include_metadata=True
        )
        
        # Group results by JD
        jds = {}
        for match in results["matches"]:
            meta = match.get("metadata", {})
            jd_id = meta.get("jd_id")
            
            if not jd_id:
                continue
            
            if jd_id not in jds:
                jds[jd_id] = {
                    "jd_id": jd_id,
                    "role_title": meta.get("role_title", "Unknown Role"),
                    "department": meta.get("department", ""),
                    "level": meta.get("level", ""),
                    "similarity": match.get("score", 0),
                    "chunks": []
                }
            
            jds[jd_id]["chunks"].append({
                "type": meta.get("chunk_type", ""),
                "text": meta.get("text", "")[:200] + "..." if len(meta.get("text", "")) > 200 else meta.get("text", "")
            })
        
        # Sort by similarity and return
        sorted_jds = sorted(jds.values(), key=lambda x: x["similarity"], reverse=True)
        return sorted_jds[:limit]
        
    except Exception as e:
        logger.error(f"Similar JD search failed: {e}")
        return []


# For backward compatibility
async def query_role_context(role_title: str, block_type: str, department: str = None, top_k: int = 5):
    return await query_advanced_context(role_title, block_type, department=department, top_k=top_k)
