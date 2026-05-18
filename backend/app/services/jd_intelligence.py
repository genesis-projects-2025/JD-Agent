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
    Process and structure JD PDFs using AI (Gemini 2.5 Flash)
    """

    def __init__(self):
        """Initialize LLM with Gemini 2.5 flash"""
        self.llm = ChatGoogleGenerativeAI(
            google_api_key=settings.GEMINI_API_KEY,
            model="gemini-2.5-flash",
            temperature=0.2,  # Low temperature for consistency
            max_output_tokens=4096,  # Increased for better completeness
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
        Main processing pipeline for PDF or DOCX:
        1. Validate file
        2. Extract text (format-specific)
        3. Parse into structured JD using Gemini 2.5 Flash
        4. Generate vector embeddings
        5. Return structured data

        REPLACES: process_jd_pdf() — now supports both formats

        Args:
            file_bytes: Raw file bytes
            filename: Original filename
            file_type: "pdf" or "docx"
            uploaded_by: Admin user ID who uploaded
            employee_id: Optional employee ID
            employee_name: Optional employee name

        Returns:
            Dictionary with processed JD data
        """
        try:
            file_type_lower = file_type.lower()

            # Step 1: Validate file (format-specific)
            logger.info(f"Validating {file_type_lower.upper()}: {filename}")

            if file_type_lower == "pdf":
                is_valid, error_msg = PDFProcessor.validate_pdf(file_bytes)
            elif file_type_lower == "docx":
                is_valid, error_msg = DOCXProcessor.validate_docx(file_bytes)
            else:
                raise Exception(f"Unsupported file type: {file_type}")

            if not is_valid:
                raise Exception(f"File validation failed: {error_msg}")

            # Step 2: Extract text (format-specific)
            logger.info(f"Extracting text from: {filename}")

            if file_type_lower == "pdf":
                text = PDFProcessor.extract_text(file_bytes)
                metadata = PDFProcessor.extract_metadata(file_bytes)
            elif file_type_lower == "docx":
                # Use table-aware extractor for multi-page DOCX with structure preservation
                try:
                    # pyrefly: ignore [bad-argument-type]
                    extraction_result = await extract_docx_complete(file_bytes)
                    if extraction_result["success"]:
                        # Use structured data from table extractor for better parsing
                        structured_preview = extraction_result["data"]
                        # Convert structured data to text for AI processing, preserving structure
                        text = self._convert_structured_to_text(structured_preview)
                        metadata = {
                            "num_pages": extraction_result.get(
                                "table_count", 0
                            ),  # Approximate
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
                        # Fallback to standard processor if table extraction fails
                        logger.warning(
                            f"[DOCX] Table extraction failed: {extraction_result.get('error')}. Falling back to standard extraction."
                        )
                        text = DOCXProcessor.extract_text(file_bytes)
                        metadata = DOCXProcessor.extract_metadata(file_bytes)
                        metadata["extraction_method"] = "standard_fallback"
                except Exception as e:
                    # Fallback to standard processor on any exception
                    logger.warning(
                        f"[DOCX] Table extractor error: {str(e)}. Falling back to standard extraction."
                    )
                    text = DOCXProcessor.extract_text(file_bytes)
                    metadata = DOCXProcessor.extract_metadata(file_bytes)
                    metadata["extraction_method"] = "standard_fallback"
            else:
                raise Exception(f"Unsupported file type: {file_type}")

            # Step 3: Parse with Gemini 2.5 Flash (same for both formats)
            logger.info(f"Parsing JD with Gemini 2.5 Flash: {filename}")
            structured_jd = await self._parse_jd_text(text, employee_name)

            # Add employee info if provided
            if employee_id:
                structured_jd["employee_id"] = employee_id
            if employee_name and not structured_jd.get("employee_name"):
                structured_jd["employee_name"] = employee_name

            # Generate ID
            jd_id = str(uuid.uuid4())

            # Step 4: Create vector embeddings (same for both formats)
            logger.info(f"Creating vector embeddings for: {filename}")
            await self._create_embeddings(jd_id, structured_jd)

            logger.info(f"Successfully processed {file_type_lower.upper()}: {filename}")

            return {
                "id": jd_id,
                "employee_id": employee_id,
                "employee_name": employee_name or structured_jd.get("employee_name"),
                "structured_data": structured_jd,
                "pdf_filename": filename,  # Keep same key for backward compatibility
                "file_type": file_type_lower,  # ← NEW: track the format
                "num_pages": metadata.get("num_pages", 0),
                "processing_status": "processed",
                "uploaded_by": uploaded_by,
                "uploaded_at": datetime.now(timezone.utc).isoformat(),
                "text_length": len(text),
            }

        except Exception as e:
            logger.error(f"JD processing failed for {filename}: {str(e)}")
            raise Exception(f"JD processing failed: {str(e)}")

    # BACKWARD COMPATIBILITY: Keep old method name, delegate to new one
    async def process_jd_pdf(
        self,
        pdf_bytes: bytes,
        filename: str,
        uploaded_by: str,
        employee_id: Optional[str] = None,
        employee_name: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        LEGACY METHOD: Kept for backward compatibility.
        Delegates to process_jd_document() with file_type="pdf"
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
        Extract partial data from malformed JSON response
        """
        logger.warning("Attempting to extract partial data from malformed JSON")

        # Initialize with defaults
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
            # Try to extract key-value pairs using regex
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

            # Extract purpose (may be truncated)
            match = re.search(r'"purpose"\s*:\s*"([^"]+)"', content)
            if match:
                structured_data["purpose"] = match.group(1)

            # Try to parse as much JSON as possible
            # Find the last complete object
            brace_count = 0
            last_complete = 0
            for i, char in enumerate(content):
                if char == "{":
                    brace_count += 1
                elif char == "}":
                    brace_count -= 1
                    if brace_count == 0:
                        last_complete = i + 1

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
        """Convert structured data from table extractor to text for AI processing"""
        text_parts = []
        
        # Add key-value pairs from structured data in a clean format
        for key, value in structured_data.items():
            if not key.startswith("_") and value:
                if isinstance(value, list):
                    if value:  # Only add if list is not empty
                        text_parts.append(f"{key}: {', '.join(value)}")
                elif isinstance(value, dict):
                    if value:  # Only add if dict is not empty
                        # Flatten the dictionary for cleaner text
                        dict_items = []
                        for dict_key, dict_value in value.items():
                            if dict_value:  # Only add non-empty values
                                dict_items.append(f"{dict_key}: {dict_value}")
                        if dict_items:
                            text_parts.append(f"{key}: {', '.join(dict_items)}")
                else:
                    text_parts.append(f"{key}: {value}")
        
        # Add raw data (critical for fields that weren't mapped explicitly)
        if "_raw_data" in structured_data:
            raw_data = structured_data["_raw_data"]
            if "tables" in raw_data and raw_data["tables"]:
                text_parts.append("\n--- FULL TABLE DATA ---")
                for table in raw_data["tables"]:
                    for row in table.get("content", []):
                        # Join non-empty cells
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
        Parse raw JD text into structured format using Gemini 2.5 Pro

        Args:
            text: Raw JD text
            employee_name: Optional employee name for context

        Returns:
            Structured JD data matching your schema
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
        3. level: Seniority level - choose from: ["Junior", "Mid", "Senior", "Lead", "Head", "Director", "VP"]
        4. purpose: Main purpose/mission of the role (50-150 words, be concise)
        5. tasks: List of ALL key responsibilities EXACTLY as they appear in the text (do not summarize or limit the count, include every single point)
        6. priority_tasks: Top 3-5 most critical tasks (subset of tasks)
        7. skills: ALL Technical and domain skills required EXACTLY as they appear (do not summarize or limit the count, include every single point)
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
        Create vector embeddings for JD sections to enable semantic search

        Args:
            jd_id: Reference JD ID
            structured_jd: Structured JD data
        """
        try:
            # Create chunks for different sections
            chunks = []

            # Role summary chunk
            if structured_jd.get("role_title") and structured_jd.get("purpose"):
                chunks.append(
                    {
                        "text": f"Role: {structured_jd['role_title']}. Purpose: {structured_jd['purpose'][:500]}",
                        "type": "role_summary",
                        "weight": 1.0,
                    }
                )

            # Skills chunk
            if structured_jd.get("skills"):
                chunks.append(
                    {
                        "text": "Skills: " + ", ".join(structured_jd["skills"][:20]),
                        "type": "skills",
                        "weight": 0.9,
                    }
                )

            # Tools chunk
            if structured_jd.get("tools"):
                chunks.append(
                    {
                        "text": "Tools: " + ", ".join(structured_jd["tools"]),
                        "type": "tools",
                        "weight": 0.8,
                    }
                )

            # Technologies chunk
            if structured_jd.get("technologies"):
                chunks.append(
                    {
                        "text": "Technologies: "
                        + ", ".join(structured_jd["technologies"]),
                        "type": "technologies",
                        "weight": 0.8,
                    }
                )

            # Tasks chunk (top 5)
            if structured_jd.get("tasks"):
                top_tasks = structured_jd["tasks"][:5]
                chunks.append(
                    {
                        "text": "Key Tasks: " + "; ".join(top_tasks),
                        "type": "tasks",
                        "weight": 0.9,
                    }
                )

            # Priority tasks chunk
            if structured_jd.get("priority_tasks"):
                chunks.append(
                    {
                        "text": "Critical Tasks: "
                        + "; ".join(structured_jd["priority_tasks"]),
                        "type": "priority_tasks",
                        "weight": 1.0,
                    }
                )

            # Qualifications chunk
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
        Find similar JDs using vector search

        Args:
            role_title: Role to match
            department: Department to match
            level: Seniority level to match
            skills: Skills to match
            limit: Maximum number of results

        Returns:
            List of similar JDs
        """
        return await find_similar_jds(
            role_title=role_title,
            department=department,
            level=level,
            skills=skills,
            limit=limit,
        )
