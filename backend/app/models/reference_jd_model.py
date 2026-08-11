# backend/app/models/reference_jd_model.py
"""
Reference JD Model - Stores processed JD PDFs for AI reference
"""

from sqlalchemy import Column, String, JSON, Boolean, TIMESTAMP, Integer, Text, DateTime
from sqlalchemy.sql import func
from app.core.database import Base


class ReferenceJD(Base):
    __tablename__ = "reference_jds"

    id = Column(String(36), primary_key=True, index=True)
    employee_id = Column(String(50), index=True)
    _employee_name = Column("employee_name", String(100))
    _department = Column("department", String(100), index=True)
    _role_title = Column("role_title", String(100), index=True)
    level = Column(String(50), index=True)  # Junior, Mid, Senior, Lead, Head

    from sqlalchemy.orm import relationship
    organogram_record = relationship(
        "Organogram",
        primaryjoin="foreign(ReferenceJD.employee_id) == remote(Organogram.code)",
        uselist=False,
        lazy="joined",
        viewonly=True,
    )

    @property
    def role_title(self) -> str | None:
        if self.organogram_record and self.organogram_record.designation:
            return self.organogram_record.designation
        return self._role_title

    @role_title.setter
    def role_title(self, value):
        self._role_title = value

    @property
    def department(self) -> str | None:
        if self.organogram_record and self.organogram_record.department:
            return self.organogram_record.department
        return self._department

    @department.setter
    def department(self, value):
        self._department = value

    @property
    def employee_name(self) -> str | None:
        if self.organogram_record and self.organogram_record.employee_name:
            return self.organogram_record.employee_name
        return self._employee_name

    @employee_name.setter
    def employee_name(self, value):
        self._employee_name = value

    # Structured JD data (matches your existing JD schema)
    structured_data = Column(JSON)

    # File storage
    pdf_path = Column(String(500))
    pdf_filename = Column(String(255))

    # Processing status
    processing_status = Column(
        String(20), default="pending"
    )  # pending, processing, processed, reviewed, published
    processing_error = Column(Text)

    # Metadata
    uploaded_by = Column(String(36))
    uploaded_at = Column(DateTime(timezone=True), server_default=func.now())
    published_at = Column(DateTime(timezone=True), nullable=True)

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
            "published_at": self.published_at.isoformat()
            if self.published_at
            else None,
        }
