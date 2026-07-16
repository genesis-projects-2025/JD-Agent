"""
Enrichment and offline pipeline models.

Stores results from offline analysis jobs (automation scoring, summaries,
dependencies, rollups, and logs) for thin online querying.
"""

import uuid
import datetime
from typing import List, Optional
from sqlalchemy import String, Text, DateTime, Numeric, Integer, ForeignKey, Index
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func
from app.core.database import Base


class TaskAutomationScore(Base):
    __tablename__ = "task_automation_scores"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    employee_id: Mapped[str] = mapped_column(String(36), nullable=False)
    department: Mapped[str] = mapped_column(String(255), nullable=False)
    jd_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("jd_sessions.id", ondelete="CASCADE"),
        nullable=False,
    )
    task_text: Mapped[str] = mapped_column(Text, nullable=False)
    automation_score: Mapped[float] = mapped_column(Numeric(3, 2), nullable=False)
    automation_reasoning: Mapped[str] = mapped_column(Text, nullable=False)
    suggested_tooling: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    category: Mapped[str] = mapped_column(String(50), nullable=False)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Index for fast grouping by department and sorting by score
    __table_args__ = (
        Index("idx_task_auto_dept_score", "department", "automation_score"),
        Index("idx_task_auto_emp_id", "employee_id"),
    )


class EmployeeWorkSummary(Base):
    __tablename__ = "employee_work_summary"

    employee_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    department: Mapped[str] = mapped_column(String(255), nullable=False)
    summary_text: Mapped[str] = mapped_column(Text, nullable=False)
    top_tools: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    last_updated: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class DepartmentDependency(Base):
    __tablename__ = "department_dependencies"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    from_department: Mapped[str] = mapped_column(String(255), nullable=False)
    to_department: Mapped[str] = mapped_column(String(255), nullable=False)
    dependency_type: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    evidence_task_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("task_automation_scores.id", ondelete="SET NULL"),
        nullable=True,
    )
    confidence: Mapped[float] = mapped_column(Numeric(3, 2), nullable=False)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class DepartmentRollupMetric(Base):
    __tablename__ = "department_rollup_metrics"

    department: Mapped[str] = mapped_column(String(255), primary_key=True)
    avg_automation_score: Mapped[float] = mapped_column(Numeric(3, 2), nullable=False)
    pct_tasks_high_automation_manual: Mapped[float] = mapped_column(
        Numeric(5, 2), nullable=False
    )
    overdue_kra_pct: Mapped[float] = mapped_column(Numeric(5, 2), nullable=False)
    draft_stuck_count: Mapped[int] = mapped_column(Integer, nullable=False)
    headcount: Mapped[int] = mapped_column(Integer, nullable=False)
    cross_dept_dependency_count: Mapped[int] = mapped_column(Integer, nullable=False)
    computed_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class BottleneckInsight(Base):
    __tablename__ = "bottleneck_insights"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    department: Mapped[str] = mapped_column(
        String(255),
        ForeignKey("department_rollup_metrics.department", ondelete="CASCADE"),
        nullable=False,
    )
    insight_text: Mapped[str] = mapped_column(Text, nullable=False)
    severity: Mapped[str] = mapped_column(String(50), nullable=False)
    evidence: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    computed_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class QueryLog(Base):
    __tablename__ = "query_logs"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    query: Mapped[str] = mapped_column(Text, nullable=False)
    query_type: Mapped[str] = mapped_column(String(50), nullable=False)
    answer: Mapped[str] = mapped_column(Text, nullable=False)
    admin_feedback: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    admin_notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    __table_args__ = (
        Index("idx_query_logs_feedback_neg", "admin_feedback", postgresql_where=(admin_feedback == "negative")),
    )
