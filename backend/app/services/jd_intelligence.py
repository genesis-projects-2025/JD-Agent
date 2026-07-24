import json
import uuid
import logging
from datetime import datetime, timezone
from typing import Dict, Any, Optional, List
from pydantic import BaseModel, Field
from app.services.docx_extractor import DOCXTableExtractor, extract_docx_complete
from app.services.pdf_processor import PDFProcessor
from app.services.docx_processor import DOCXProcessor
from app.services.vector_service import index_jd_document, find_similar_jds
from app.core.config import settings
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.prompts import ChatPromptTemplate

logger = logging.getLogger(__name__)


# Pydantic models for structured JD output
class Qualifications(BaseModel):
    education: str = Field(default="")
    experience_years: str = Field(default="")
    certifications: List[str] = Field(default_factory=list)


class WorkingRelationships(BaseModel):
    reports_to: str = Field(default="")
    team_size: str = Field(default="")
    stakeholders: List[str] = Field(default_factory=list)


class JDStructuredData(BaseModel):
    role_title: str = Field(default="")
    department: str = Field(default="")
    level: str = Field(default="Mid")
    purpose: str = Field(default="")
    tasks: List[str] = Field(default_factory=list)
    priority_tasks: List[str] = Field(default_factory=list)
    skills: List[str] = Field(default_factory=list)
    tools: List[str] = Field(default_factory=list)
    technologies: List[str] = Field(default_factory=list)
    qualifications: Qualifications = Field(default_factory=Qualifications)
    working_relationships: WorkingRelationships = Field(
        default_factory=WorkingRelationships
    )


class JDIntelligenceService:
    """
    JDIntelligenceService orchestrates the end-to-end processing pipeline for reference 
    Job Description (JD) documents (PDF and DOCX formats). It validates the file, extracts the 
    raw text using format-specific processors, parses and structures the text into a standardized 
    JSON schema using Gemini 2.5 Flash, and generates semantic vector chunks for future searchability.
    """

    def __init__(self):
        """
        Initializes the JDIntelligenceService.
        Sets up the LangChain client for Gemini 2.5 Flash (gemini-2.5-flash) 
        with a low temperature (0.2) to maintain factual consistency and formatting accuracy.
        """
        self.llm = ChatGoogleGenerativeAI(
            google_api_key=settings.GEMINI_API_KEY,
            model="gemini-2.5-flash",
            temperature=0.2,  # Low temperature for consistency
            max_output_tokens=1500,
        )
        logger.info("JD Intelligence Service initialized with Gemini 2.5 flash")

    async def process_jd_document(
        self,
        file_bytes: bytes,
        filename: str,
        file_type: str,  # "pdf" or "docx"
        uploaded_by: str,
        employee_id: Optional[str] = None,
        employee_name: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Orchestrates the entire document ingestion pipeline:
        1. File Validation: Checks if the PDF or DOCX format is valid.
        2. Text Extraction: Performs table-aware parsing for DOCX or standard text extraction for PDF.
        3. Structured Parsing: Uses Gemini 2.5 Flash to organize text into a schema (JDStructuredData).
        4. Vector Indexing: Creates semantic segments of the structured data for vector search.
        5. Return Metadata: Packages the parsed data and metadata into a final response.

        Args:
            file_bytes: Raw bytes of the uploaded file.
            filename: Original name of the file.
            file_type: File extension string, either "pdf" or "docx".
            uploaded_by: ID/role of the administrator uploading the file.
            employee_id: Optional identifier of the associated employee.
            employee_name: Optional name of the associated employee.

        Returns:
            A dictionary containing the parsed 'structured_data', file metadata (e.g., character count,
            page count), file type, processing status, and indexing info.
        """
        try:
            file_type_lower = file_type.lower()

            # Step 1: Validate file structure using format-specific rules
            logger.info(f"Validating {file_type_lower.upper()}: {filename}")

            if file_type_lower == "pdf":
                is_valid, error_msg = PDFProcessor.validate_pdf(file_bytes)
            elif file_type_lower == "docx":
                is_valid, error_msg = DOCXProcessor.validate_docx(file_bytes)
            else:
                raise Exception(f"Unsupported file type: {file_type}")

            if not is_valid:
                raise Exception(f"File validation failed: {error_msg}")

            # Step 2: Extract content text and document metadata
            logger.info(f"Extracting text from: {filename}")

            if file_type_lower == "pdf":
                text = PDFProcessor.extract_text(file_bytes)
                metadata = PDFProcessor.extract_metadata(file_bytes)
            elif file_type_lower == "docx":
                # Attempt advanced extraction that preserves layout structures and tabular rows
                try:
                    # pyrefly: ignore [bad-argument-type]
                    extraction_result = await extract_docx_complete(file_bytes)
                    if extraction_result["success"]:
                        # Convert parsed tables and paragraphs into a consolidated structured text block
                        structured_preview = extraction_result["data"]
                        text = self._convert_structured_to_text(structured_preview)
                        metadata = {
                            "num_pages": extraction_result.get(
                                "table_count", 0
                            ),  # Approximate representation
                            "char_count": extraction_result.get("char_count", 0),
                            "table_count": extraction_result.get("table_count", 0),
                            "paragraph_count": extraction_result.get(
                                "paragraph_count", 0
                            ),
                            "extraction_method": "table_aware",
                        }
                        logger.info(
                            f"[DOCX] Using table-aware extraction: {extraction_result.get('char_count', 0)} chars from {extraction_result.get('table_count', 0)} tables"
                        )
                    else:
                        # Fallback to standard paragraph paragraph/run scanner
                        logger.warning(
                            f"[DOCX] Table extraction failed: {extraction_result.get('error')}. Falling back to standard extraction."
                        )
                        text = DOCXProcessor.extract_text(file_bytes)
                        metadata = DOCXProcessor.extract_metadata(file_bytes)
                        metadata["extraction_method"] = "standard_fallback"
                except Exception as e:
                    # Generic fallback in case of XML parse errors or other failures in advance parser
                    logger.warning(
                        f"[DOCX] Table extractor error: {str(e)}. Falling back to standard extraction."
                    )
                    text = DOCXProcessor.extract_text(file_bytes)
                    metadata = DOCXProcessor.extract_metadata(file_bytes)
                    metadata["extraction_method"] = "standard_fallback"
            else:
                raise Exception(f"Unsupported file type: {file_type}")

            # Step 3: Parse extracted text into standard schema using LLM
            logger.info(f"Parsing JD with Gemini 2.5 Flash: {filename}")
            structured_jd = await self._parse_jd_text(text, employee_name)

            # Enrich the parsed result with employee identifiers if present
            if employee_id:
                structured_jd["employee_id"] = employee_id
            if employee_name and not structured_jd.get("employee_name"):
                structured_jd["employee_name"] = employee_name

            # Generate a new unique ID for referencing this JD session/record
            jd_id = str(uuid.uuid4())

            # Step 4: Index segments into Vector DB for semantic lookup
            logger.info(f"Creating vector embeddings for: {filename}")
            await self._create_embeddings(jd_id, structured_jd)

            logger.info(f"Successfully processed {file_type_lower.upper()}: {filename}")

            return {
                "id": jd_id,
                "employee_id": employee_id,
                "employee_name": employee_name or structured_jd.get("employee_name"),
                "structured_data": structured_jd,
                "pdf_filename": filename,  # Retained key for backward compatibility
                "file_type": file_type_lower,
                "num_pages": metadata.get("num_pages", 0),
                "processing_status": "processed",
                "uploaded_by": uploaded_by,
                "uploaded_at": datetime.now(timezone.utc).isoformat(),
                "text_length": len(text),
            }

        except Exception as e:
            logger.error(f"JD processing failed for {filename}: {str(e)}")
            raise Exception(f"JD processing failed: {str(e)}")

    async def process_jd_pdf(
        self,
        pdf_bytes: bytes,
        filename: str,
        uploaded_by: str,
        employee_id: Optional[str] = None,
        employee_name: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        LEGACY METHOD: Maintained to avoid breaking older API consumers.
        Delegates straight to process_jd_document() with file_type set to "pdf".
        """
        logger.warning(
            "process_jd_pdf() is deprecated. Use process_jd_document() instead."
        )
        return await self.process_jd_document(
            file_bytes=pdf_bytes,
            filename=filename,
            file_type="pdf",
            uploaded_by=uploaded_by,
            employee_id=employee_id,
            employee_name=employee_name,
        )

    def _extract_partial_data(self, content: str) -> Dict[str, Any]:
        """
        Fallback parser to recover data from malformed or truncated LLM output.
        Uses regex patterns to scan the response for critical keys (e.g. role_title, department, 
        level, purpose) and attempts to find/parse the last valid matching braces to retrieve 
        partial JSON structures.

        Args:
            content: Raw text returned by the LLM (which failed to decode normally).

        Returns:
            A dictionary containing as many parsed fields as could be successfully extracted, 
            using default values for any missing parts.
        """
        logger.warning("Attempting to extract partial data from malformed JSON")

        # Initialize structured dictionary with default safe values
        structured_data = {
            "role_title": "Unknown Role",
            "department": "Unknown",
            "level": "Mid",
            "purpose": "",
            "tasks": [],
            "priority_tasks": [],
            "skills": [],
            "tools": [],
            "technologies": [],
            "qualifications": {
                "education": "",
                "experience_years": "",
                "certifications": [],
            },
            "working_relationships": {
                "reports_to": "",
                "team_size": "",
                "stakeholders": [],
            },
        }

        try:
            # 1. Regex scanning for top-level string fields in case the response is heavily truncated
            import re

            # Extract role_title
            match = re.search(r'"role_title"\s*:\s*"([^"]+)"', content)
            if match:
                structured_data["role_title"] = match.group(1)

            # Extract department
            match = re.search(r'"department"\s*:\s*"([^"]+)"', content)
            if match:
                structured_data["department"] = match.group(1)

            # Extract level
            match = re.search(r'"level"\s*:\s*"([^"]+)"', content)
            if match:
                structured_data["level"] = match.group(1)

            # Extract purpose
            match = re.search(r'"purpose"\s*:\s*"([^"]+)"', content)
            if match:
                structured_data["purpose"] = match.group(1)

            # 2. Bracket counter scan: find the last index where parentheses are fully balanced
            brace_count = 0
            last_complete = 0
            for i, char in enumerate(content):
                if char == "{":
                    brace_count += 1
                elif char == "}":
                    brace_count -= 1
                    if brace_count == 0:
                        last_complete = i + 1

            # If a balanced JSON subset is found, parse and merge it
            if last_complete > 0:
                try:
                    partial_json = content[:last_complete]
                    partial_data = json.loads(partial_json)
                    structured_data.update(partial_data)
                except:
                    pass

            logger.info(
                f"Extracted partial data for role: {structured_data['role_title']}"
            )

        except Exception as e:
            logger.error(f"Failed to extract partial data: {e}")

        return structured_data

    def _convert_structured_to_text(self, structured_data: dict) -> str:
        """
        Converts the rich dictionary extracted by the table-aware docx parser back 
        into a clean, unified plain text representation. This formatted text acts 
        as context input to the LLM.

        Args:
            structured_data: Dict returned by extract_docx_complete containing 
                             categorized items and raw paragraph/table fields.

        Returns:
            A single formatted string with key-value headers, table row segments, 
            and paragraph text.
        """
        text_parts = []
        
        # 1. Append key-value attributes (excluding internal keys starting with '_')
        for key, value in structured_data.items():
            if not key.startswith("_") and value:
                if isinstance(value, list):
                    if value:  # Only append non-empty lists
                        text_parts.append(f"{key}:\n  - " + "\n  - ".join(str(v) for v in value))
                elif isinstance(value, dict):
                    if value:  # Flatten nested dictionaries for cleaner reading
                        dict_items = []
                        for dict_key, dict_value in value.items():
                            if dict_value:
                                dict_items.append(f"{dict_key}: {dict_value}")
                        if dict_items:
                            text_parts.append(f"{key}: {', '.join(dict_items)}")
                else:
                    text_parts.append(f"{key}: {value}")
        
        # 2. Append tables and paragraphs stored in '_raw_data' to preserve full context
        if "_raw_data" in structured_data:
            raw_data = structured_data["_raw_data"]
            if "tables" in raw_data and raw_data["tables"]:
                text_parts.append("\n--- FULL TABLE DATA ---")
                for table in raw_data["tables"]:
                    for row in table.get("content", []):
                        # Join non-empty cell strings with pipe separators
                        cells = [str(cell).replace('\n', ' ').strip() for cell in row if str(cell).strip()]
                        if cells:
                            text_parts.append(" | ".join(cells))
                            
            if "paragraphs" in raw_data and raw_data["paragraphs"]:
                text_parts.append("\n--- PARAGRAPH TEXT ---")
                for para in raw_data["paragraphs"]:
                    text_parts.append(para.get("text", ""))
                    
        return "\n".join(text_parts)

    async def _parse_jd_text(
        self, text: str, employee_name: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Parses raw unstructured text into structured JD dictionary fields.
        Delegates processing to self._parse_jd_text_fallback().

        Args:
            text: Unified text representation of the document.
            employee_name: Optional name of the employee for contextual relevance.

        Returns:
            A dictionary conforming to the JDStructuredData schema.
        """
        return await self._parse_jd_text_fallback(text, employee_name)

    async def _parse_jd_text_fallback(
        self, text: str, employee_name: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Fallback method using original LangChain approach
        """
        # Truncate if too long (Gemini has context limits)
        max_chars = 50000
        if len(text) > max_chars:
            text = text[:max_chars] + "\n... [TRUNCATED]"
            logger.warning(f"JD text truncated to {max_chars} characters")

        context = f"Employee: {employee_name}\n" if employee_name else ""

        prompt = ChatPromptTemplate.from_template("""
        You are an expert HR analyst and organizational designer. 
        Extract the following information from this job description and return it as structured JSON.
        {context}
        JOB DESCRIPTION:
        {text}
        EXTRACT THE FOLLOWING FIELDS:
        1. role_title: Job title/position (e.g., "Senior Software Engineer", "Marketing Manager")
        2. department: Department or function (e.g., "Engineering", "Marketing", "Sales")
        3. level: Seniority level - choose from: ["Junior", "Mid", "Senior", "Lead", "Head", "Director", "VP","Level 1", "Level 2", "Level 3", "Level 4", "Level 5"]
        4. purpose: Main purpose/mission of the role (50-150 words, be concise)
        5. tasks: List of ALL key responsibilities EXACTLY as they appear in the text (do not summarize or limit the count, include every single point)
        6. priority_tasks: Top 3-5 most critical tasks (subset of tasks)
        7. skills: ALL Technical and domain skills required EXACTLY as they appear (do not summarize or limit the count, include every single point but make sure they are relevant to the role and not generic soft skills)
        8. tools: Software, platforms, tools used (list of 3-10 items)
        9. technologies: Frameworks, languages, tech stack (list of 3-10 items)
        10. qualifications: EXACTLY as they appear in the text, DO NOT summarize
            - education: Required education level (extract full exact text)
            - experience_years: Years of experience (extract full exact text, do not shorten)
            - certifications: Professional certifications (list, can be empty)
        11. working_relationships: Key stakeholders and reporting structure
            - reports_to: Who this role reports to
            - team_size: Size of team they manage (if any)
            - stakeholders: Key internal and external stakeholders (list ALL exactly as they appear, e.g., "Internal: All Departments", "External: Auditors")
        
        IMPORTANT RULES:
        - Return ONLY valid JSON, no explanations or markdown
        - Use proper JSON formatting with correct quotes and commas
        - Be specific and professional in descriptions
        - If information is not in the JD, use null or empty values
        - Extract exactly what's in the JD, don't hallucinate
        
        JSON FORMAT:
        {{
            "role_title": "string",
            "department": "string",
            "level": "string",
            "purpose": "string",
            "tasks": ["string", ...],
            "priority_tasks": ["string", ...],
            "skills": ["string", ...],
            "tools": ["string", ...],
            "technologies": ["string", ...],
            "qualifications": {{
                "education": "string",
                "experience_years": "string",
                "certifications": ["string", ...]
            }},
            "working_relationships": {{
                "reports_to": "string",
                "team_size": "string",
                "stakeholders": ["string", ...]
            }}
        }}
        """)

        messages = await self.llm.ainvoke(
            prompt.format_messages(context=context, text=text)
        )

        # Parse JSON from response
        content = getattr(messages, "content", str(messages)).strip()
        try:
            # Clean up if wrapped in code blocks
            if "```json" in content:
                content = content.split("```json")[1].split("```")[0].strip()
            elif "```" in content:
                content = content.split("```")[1].strip()

            # Remove any leading/trailing whitespace
            content = content.strip()

            # Try to fix truncated JSON strings
            # Count opening and closing braces
            open_braces = content.count("{")
            close_braces = content.count("}")

            # If we have unclosed braces, try to close them
            if open_braces > close_braces:
                content = content + "}" * (open_braces - close_braces)

            # Try to fix truncated strings (unclosed quotes)
            # Count quotes
            quotes = content.count('"')
            if quotes % 2 != 0:
                # Odd number of quotes means unclosed string
                # Find last opening quote that doesn't have a closing quote
                # Simple fix: add closing quote at end
                content = content + '"'

            # Parse JSON
            structured_data = json.loads(content)

            # Normalize alias fields to ensure compatibility with all UI viewers
            tasks_list = structured_data.get("tasks") or structured_data.get("responsibilities") or structured_data.get("key_responsibilities") or []
            structured_data["tasks"] = tasks_list
            structured_data["responsibilities"] = tasks_list

            if "qualifications" not in structured_data or not isinstance(structured_data["qualifications"], dict):
                structured_data["qualifications"] = {}
            qual = structured_data["qualifications"]
            exp = qual.get("experience_years") or qual.get("experience") or structured_data.get("experience") or ""
            qual["experience"] = exp
            qual["experience_years"] = exp

            if "working_relationships" not in structured_data or not isinstance(structured_data["working_relationships"], dict):
                structured_data["working_relationships"] = {}
            wr = structured_data["working_relationships"]
            reports = wr.get("reports_to") or wr.get("reporting_to") or structured_data.get("reports_to") or ""
            wr["reports_to"] = reports
            wr["reporting_to"] = reports

            # Validate required fields
            required_fields = ["role_title", "department", "level", "purpose"]
            for field in required_fields:
                if field not in structured_data or not structured_data[field]:
                    logger.warning(f"Missing or empty required field: {field}")

            return structured_data

        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse JSON from LLM response: {str(e)}")
            logger.error(f"LLM response content: {content}")
            # Try to extract partial data
            try:
                return self._extract_partial_data(content)
            except:
                raise Exception(f"Failed to parse JD structure: {str(e)}")
        except Exception as e:
            logger.error(f"Unexpected error parsing JD: {str(e)}")
            raise

    async def _create_embeddings(self, jd_id: str, structured_jd: Dict[str, Any]):
        """
        Creates semantic chunks of the structured JD data and indexes them into the 
        Vector Database to facilitate search queries matching skills, roles, or tools.

        Args:
            jd_id: Reference identifier of the processed JD record.
            structured_jd: The fully parsed JD dictionary.
        """
        try:
            # Categorize the structured fields into separate chunks with relative relevance weights
            chunks = []

            # Chunk 1: Role Summary (Weight: 1.0)
            if structured_jd.get("role_title") and structured_jd.get("purpose"):
                chunks.append(
                    {
                        "text": f"Role: {structured_jd['role_title']}. Purpose: {structured_jd['purpose'][:500]}",
                        "type": "role_summary",
                        "weight": 1.0,
                    }
                )

            # Chunk 2: Core Skills (Weight: 0.9)
            if structured_jd.get("skills"):
                chunks.append(
                    {
                        "text": "Skills: " + ", ".join(structured_jd["skills"][:20]),
                        "type": "skills",
                        "weight": 0.9,
                    }
                )

            # Chunk 3: Software & Platforms (Weight: 0.8)
            if structured_jd.get("tools"):
                chunks.append(
                    {
                        "text": "Tools: " + ", ".join(structured_jd["tools"]),
                        "type": "tools",
                        "weight": 0.8,
                    }
                )

            # Chunk 4: Programming/Technical Stack (Weight: 0.8)
            if structured_jd.get("technologies"):
                chunks.append(
                    {
                        "text": "Technologies: "
                        + ", ".join(structured_jd["technologies"]),
                        "type": "technologies",
                        "weight": 0.8,
                    }
                )

            # Chunk 5: Key Responsibilities (Weight: 0.9)
            if structured_jd.get("tasks"):
                top_tasks = structured_jd["tasks"][:5]
                chunks.append(
                    {
                        "text": "Key Tasks: " + "; ".join(top_tasks),
                        "type": "tasks",
                        "weight": 0.9,
                    }
                )

            # Chunk 6: Critical Priority Tasks (Weight: 1.0)
            if structured_jd.get("priority_tasks"):
                chunks.append(
                    {
                        "text": "Critical Tasks: "
                        + "; ".join(structured_jd["priority_tasks"]),
                        "type": "priority_tasks",
                        "weight": 1.0,
                    }
                )

            # Chunk 7: Academic Background & Experience (Weight: 0.7)
            if structured_jd.get("qualifications"):
                qual = structured_jd["qualifications"]
                qual_text = []
                if qual.get("education"):
                    qual_text.append(f"Education: {qual['education']}")
                if qual.get("experience_years"):
                    qual_text.append(f"Experience: {qual['experience_years']}")
                if qual.get("certifications"):
                    qual_text.append(
                        f"Certifications: {', '.join(qual['certifications'])}"
                    )

                if qual_text:
                    chunks.append(
                        {
                            "text": "; ".join(qual_text),
                            "type": "qualifications",
                            "weight": 0.7,
                        }
                    )

            # Index each chunk
            for chunk in chunks:
                await index_jd_document(
                    jd_id=jd_id,
                    text=chunk["text"],
                    chunk_type=chunk["type"],
                    metadata={
                        "role_title": structured_jd.get("role_title"),
                        "department": structured_jd.get("department"),
                        "experience_level": structured_jd.get("level"),
                        "source": "reference_jd_upload",
                        "weight": chunk["weight"],
                    },
                )

            logger.info(f"Created {len(chunks)} vector embeddings for JD {jd_id}")

        except Exception as e:
            logger.error(f"Failed to create embeddings for JD {jd_id}: {str(e)}")
            # Don't raise - embeddings are optional for basic functionality

    async def find_similar_jds(
        self,
        role_title: Optional[str] = None,
        department: Optional[str] = None,
        level: Optional[str] = None,
        skills: Optional[list] = None,
        limit: int = 5,
    ) -> list:
        """
        Executes a vector search to locate similar JDs in the repository based on 
        supplied filters (skills, title, level, department).

        Args:
            role_title: Optional filter for matching job title.
            department: Optional filter for matching department.
            level: Optional filter for matching seniority level.
            skills: Optional list of skills to match against.
            limit: Maximum result limit for query (defaults to 5).

        Returns:
            A list of matching/similar reference JD objects retrieved from Vector DB.
        """
        return await find_similar_jds(
            role_title=role_title,
            department=department,
            level=level,
            skills=skills,
            limit=limit,
        )
