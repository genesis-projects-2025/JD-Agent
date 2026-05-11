# backend/app/services/pdf_processor.py
"""
PDF Processing Service - Extract text and metadata from PDF files
"""
import fitz  # PyMuPDF
import io
import logging
from typing import Dict, Any

logger = logging.getLogger(__name__)

class PDFProcessor:
    """Extract text and metadata from PDF files"""
    
    @staticmethod
    def extract_text(pdf_bytes: bytes) -> str:
        """
        Extract text from PDF bytes using PyMuPDF
        
        Args:
            pdf_bytes: Raw PDF file bytes
            
        Returns:
            Extracted text as string
            
        Raises:
            Exception: If PDF extraction fails
        """
        try:
            # Open PDF from bytes
            pdf_document = fitz.open(stream=pdf_bytes, filetype="pdf")
            text = ""
            
            # Extract text from each page
            for page_num in range(pdf_document.page_count):
                page = pdf_document[page_num]
                page_text = page.get_text()
                if page_text:
                    text += page_text + "\n"
                else:
                    logger.warning(f"No text extracted from page {page_num}")
            
            pdf_document.close()
            
            if not text.strip():
                raise Exception("No text could be extracted from PDF")
            
            logger.info(f"Extracted {len(text)} characters from PDF using PyMuPDF")
            return text
            
        except Exception as e:
            logger.error(f"PDF extraction failed: {str(e)}")
            raise Exception(f"PDF extraction failed: {str(e)}")
    
    @staticmethod
    def extract_metadata(pdf_bytes: bytes) -> Dict[str, Any]:
        """
        Extract PDF metadata using PyMuPDF
        
        Args:
            pdf_bytes: Raw PDF file bytes
            
        Returns:
            Dictionary with metadata
        """
        try:
            # Open PDF from bytes
            pdf_document = fitz.open(stream=pdf_bytes, filetype="pdf")
            
            # Get metadata
            metadata = pdf_document.metadata
            if not metadata:
                metadata = {}
                
            num_pages = pdf_document.page_count
            pdf_document.close()
            
            return {
                "num_pages": num_pages,
                "metadata": metadata
            }
        except Exception as e:
            logger.error(f"Metadata extraction failed: {str(e)}")
            return {"num_pages": 0, "metadata": {}, "error": str(e)}
    
    @staticmethod
    def validate_pdf(pdf_bytes: bytes) -> tuple[bool, str]:
        """
        Validate PDF file using PyMuPDF
        
        Args:
            pdf_bytes: Raw PDF file bytes
            
        Returns:
            Tuple of (is_valid, error_message)
        """
        # Check minimum size
        if len(pdf_bytes) < 100:
            return False, "PDF file is too small"
        
        # Check PDF header
        if not pdf_bytes.startswith(b'%PDF'):
            return False, "Not a valid PDF file"
        
        # Try to read
        try:
            pdf_document = fitz.open(stream=pdf_bytes, filetype="pdf")
            if pdf_document.page_count == 0:
                pdf_document.close()
                return False, "PDF has no pages"
            pdf_document.close()
        except Exception as e:
            return False, f"Invalid PDF: {str(e)}"
        
        return True, "Valid PDF"
