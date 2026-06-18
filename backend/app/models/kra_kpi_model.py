# backend/app/models/kra_kpi_model.py
"""
KRA/KPI Session Model — Stores the full multi-step selection state.

Generation Steps:
  kra_selection    → 6–7 KRA suggestions generated, awaiting employee selection (3–5)
  kpi_generation   → KRAs selected, generating KPI suggestions per KRA
  kpi_selection    → KPI suggestions ready, awaiting employee selection (3–5 per KRA)
  weight_adjustment → Final selections made, employee adjusting weights via drag-and-drop
  confirmed        → Weights confirmed, locked

Prerequisites (all three MUST be present before generation starts):
  1. Employee JD (generated)
  2. Manager JD (generated)
  3. Manager KRA/KPI (draft or confirmed)
"""

import uuid
import datetime
from sqlalchemy import String, Text, DateTime, Index
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func
from app.core.database import Base


class KRAKPISession(Base):
    __tablename__ = "kra_kpi_sessions"

    id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )

    # The employee JD session this KRA/KPI is for
    jd_session_id: Mapped[str] = mapped_column(
        String(36), nullable=False, index=True
    )
    employee_id: Mapped[str] = mapped_column(
        String(255), nullable=False, index=True
    )

    # Manager context used during generation
    manager_employee_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    manager_jd_session_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    manager_kra_kpi_session_id: Mapped[str | None] = mapped_column(String(36), nullable=True)

    # ── Step-by-step state ──────────────────────────────────────────────────
    # Generation step: kra_selection | kpi_generation | kpi_selection | weight_adjustment | confirmed
    generation_step: Mapped[str] = mapped_column(
        Text, nullable=False, default="kra_selection"
    )

    # Phase 1: 6–7 KRA suggestions from the LLM (full objects with suggested_weight)
    kra_suggestions: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    # Shape: {"kra_suggestions": [{kra_id, title, description, source_tasks, suggested_weight, manager_impact}]}

    # Employee-selected KRA IDs (3–5 of the suggestions)
    selected_kra_ids: Mapped[list | None] = mapped_column(JSONB, nullable=True)

    # Phase 2: KPI suggestions per selected KRA
    kpi_suggestions: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    # Shape: {"kra_id": {"kra_title": ..., "kpi_suggestions": [...]}, ...}

    # Employee-selected KPI IDs per KRA (3–5 per KRA)
    selected_kpi_ids: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    # Shape: {"kra_id": ["kpi_id_1", "kpi_id_2", ...]}

    # Final confirmed KRA/KPI payload with user-adjusted weights
    kras: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    # Shape: {"kras": [{kra_id, title, description, weight, source_tasks, kpis:[...]}]}

    # Status
    status: Mapped[str] = mapped_column(
        Text, nullable=False, default="draft", index=True
    )
    # draft | confirmed

    generation_model: Mapped[str | None] = mapped_column(Text, nullable=True)
    generation_error: Mapped[str | None] = mapped_column(Text, nullable=True)

    generated_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    confirmed_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        Index("idx_kra_kpi_jd_session", "jd_session_id"),
        Index("idx_kra_kpi_employee", "employee_id"),
        Index("idx_kra_kpi_status", "status"),
    )

    def to_dict(self) -> dict:
        return {
            "id": str(self.id),
            "jd_session_id": self.jd_session_id,
            "employee_id": self.employee_id,
            "manager_employee_id": self.manager_employee_id,
            "manager_jd_session_id": self.manager_jd_session_id,
            "generation_step": self.generation_step,
            "kra_suggestions": self.kra_suggestions,
            "selected_kra_ids": self.selected_kra_ids,
            "kpi_suggestions": self.kpi_suggestions,
            "selected_kpi_ids": self.selected_kpi_ids,
            "kras": self.kras,
            "status": self.status,
            "generation_model": self.generation_model,
            "generation_error": self.generation_error,
            "generated_at": self.generated_at.isoformat() if self.generated_at else None,
            "confirmed_at": self.confirmed_at.isoformat() if self.confirmed_at else None,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }
