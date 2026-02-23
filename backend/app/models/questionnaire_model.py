from sqlalchemy import Column, String, Text, DateTime, Integer, Index
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.sql import func
import uuid
from app.core.database import Base


def generate_uuid():
    return str(uuid.uuid4())


class Questionnaire(Base):
    __tablename__ = "questionnaires"

    # ── Primary Identity ──────────────────────────────────────────────────────
    id = Column(String(36), primary_key=True, default=generate_uuid)
    # employee_id is the owner — one employee can have MANY JDs (many rows)
    employee_id = Column(String(255), nullable=False, index=True)
    employee_name = Column(String(255), nullable=True)
    title = Column(String(500), nullable=True)
    status = Column(String(50), default="draft")
    version = Column(Integer, default=1, nullable=False)

    # ── JSONB Columns (PostgreSQL — fast, indexable) ──────────────────────────
    # progress, analytics, approval state
    conversation_state = Column(JSONB, nullable=True)

    # employee_role_insights collected by the agent
    responses = Column(JSONB, nullable=True)

    # Full conversation turns: [{role, content, timestamp}]
    # Stored in DB so sessions survive server restarts
    conversation_history = Column(JSONB, nullable=True, default=list)

    # ── JD Output ─────────────────────────────────────────────────────────────
    generated_jd = Column(Text, nullable=True)       # markdown format
    jd_structured = Column(JSONB, nullable=True)     # structured JSON

    # ── Timestamps ───────────────────────────────────────────────────────────
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    # ── Indexes for fast employee-scoped queries ──────────────────────────────
    __table_args__ = (
        # Fetch all JDs for an employee ordered by recency — used in list endpoint
        Index("ix_questionnaire_employee_updated", "employee_id", "updated_at"),
        # Filter by status per employee — used in dashboard stat counts
        Index("ix_questionnaire_employee_status", "employee_id", "status"),
    )

    def __repr__(self):
        return (
            f"<Questionnaire id={self.id} employee={self.employee_id} "
            f"status={self.status} v={self.version} title={self.title!r}>"
        )