# backend/app/models/reference_jd_model.py
"""
Reference JD Model - Stores processed JD PDFs for AI reference
"""
from sqlalchemy import Column, String, JSON, Boolean, TIMESTAMP, Integer, Text, ForeignKey
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.core.database import Base

class ReferenceJD(Base):
    __tablename__ = "reference_jds"
    
    id = Column(String(36), primary_key=True, index=True)
    employee_id = Column(String(50), index=True)
    employee_name = Column(String(100))
    department = Column(String(100), index=True)
    role_title = Column(String(100), index=True)
    level = Column(String(50), index=True)  # Junior, Mid, Senior, Lead, Head
    
    # Structured JD data (matches your existing JD schema)
    structured_data = Column(JSON)
    
    # File storage
    pdf_path = Column(String(500))
    pdf_filename = Column(String(255))
    
    # Processing status
    processing_status = Column(String(20), default="pending")  # pending, processing, processed, reviewed, published
    processing_error = Column(Text)
    
    # Metadata
    uploaded_by = Column(String(36))
    uploaded_at = Column(TIMESTAMP, server_default=func.now())
    published_at = Column(TIMESTAMP, nullable=True)
    
    # Versioning
    is_active = Column(Boolean, default=True)
    version = Column(Integer, default=1)
    
    def to_dict(self):
        return {
            "id": self.id,
            "employee_id": self.employee_id,
            "employee_name": self.employee_name,
            "department": self.department,
            "role_title": self.role_title,
            "level": self.level,
            "structured_data": self.structured_data,
            "pdf_filename": self.pdf_filename,
            "processing_status": self.processing_status,
            "uploaded_by": self.uploaded_by,
            "uploaded_at": self.uploaded_at.isoformat() if self.uploaded_at else None,
            "published_at": self.published_at.isoformat() if self.published_at else None,
        }
