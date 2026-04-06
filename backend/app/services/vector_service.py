import logging
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
        skills = (structured_data.get("required_skills", []) or 
                  structured_data.get("skills", []))
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
            
        results = index.query(
            vector=query_vec,
            top_k=top_k,
            include_metadata=True,
            filter=filter_dict
        )
        
        examples = []
        current_tokens = 0
        # Increased threshold to 0.5 to avoid cross-role pollution (e.g. Accountant tools for Devs)
        for res in sorted(results["matches"], key=lambda x: x["score"], reverse=True):
            if res["score"] > 0.5:
                text = res["metadata"]["text"]
                tokens = estimate_tokens(text)
                if current_tokens + tokens <= token_budget:
                    examples.append(text)
                    current_tokens += tokens
        
        return examples
        
    except Exception as e:
        logger.error(f"Advanced RAG query failed: {e}")
        return []

# For backward compatibility
async def query_role_context(role_title: str, block_type: str, department: str = None, top_k: int = 5):
    return await query_advanced_context(role_title, block_type, department=department, top_k=top_k)
