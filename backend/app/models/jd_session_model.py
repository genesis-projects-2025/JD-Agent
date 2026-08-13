# app/models/jd_session_model.py
# PERFORMANCE: Added composite indexes on hot query columns
# FIX: title/department converted from plain @property to hybrid_property so they
# work both on instances (session.title) AND inside SQL filters (JDSession.title == x).
# Plain @property broke queries like func.lower(JDSession.title) because accessing a
# property on the CLASS (not an instance) returns the raw property object, which
# asyncpg then tried to bind as a literal query parameter -> DataError.

from sqlalchemy import (
    String,
    Text,
    DateTime,
    Integer,
    Index,
    ForeignKey,
    BigInteger,
    UniqueConstraint,
    select,
    func as sa_func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.ext.hybrid import hybrid_property
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func
import uuid
import datetime
from app.core.database import Base

# NOTE: adjust this import path to match wherever your Organogram model actually lives.
# Used only inside the .expression side of the hybrid properties below.
from app.models.user_model import Organogram


class JDSession(Base):
    __tablename__ = "jd_sessions"

    id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    employee_id: Mapped[str] = mapped_column(
        String(255), ForeignKey("employees.id"), nullable=False, index=True
    )
    source_reference_jd_id: Mapped[str | None] = mapped_column(
        String(36), nullable=True, index=True
    )

    _title: Mapped[str | None] = mapped_column("title", Text, nullable=True)
    _department: Mapped[str | None] = mapped_column("department", Text, nullable=True)
    status: Mapped[str] = mapped_column(
        Text, nullable=False, default="collecting", index=True
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    jd_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    jd_structured: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    insights: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    conversation_state: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    reviewed_by: Mapped[str | None] = mapped_column(Text, nullable=True)
    reviewer_comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    sent_to_manager_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    sent_to_hr_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    # Relationships
    employee = relationship("Employee", back_populates="jd_sessions")
    organogram_record = relationship(
        "Organogram",
        primaryjoin="foreign(JDSession.employee_id) == remote(Organogram.code)",
        uselist=False,
        lazy="joined",
        viewonly=True,
        overlaps="employee",
    )

    # ------------------------------------------------------------------
    # title: hybrid_property
    #   - instance access (session.title)      -> Python getter below
    #   - class access in queries (JDSession.title == x) -> .expression below
    # ------------------------------------------------------------------
    @hybrid_property
    def title(self) -> str | None:
        if self.organogram_record and self.organogram_record.designation:
            return self.organogram_record.designation
        return self._title

    @title.setter
    def title(self, value):
        self._title = value

    @title.expression
    def title(cls):
        # Mirrors the Python getter: prefer organogram designation, fall back to _title.
        return func.coalesce(
            select(Organogram.designation)
            .where(Organogram.code == cls.employee_id)
            .correlate(cls)
            .scalar_subquery(),
            cls._title,
        )

    # ------------------------------------------------------------------
    # department: hybrid_property (same pattern as title)
    # ------------------------------------------------------------------
    @hybrid_property
    def department(self) -> str | None:
        if self.organogram_record and self.organogram_record.department:
            return self.organogram_record.department
        return self._department

    @department.setter
    def department(self, value):
        self._department = value

    @department.expression
    def department(cls):
        return func.coalesce(
            select(Organogram.department)
            .where(Organogram.code == cls.employee_id)
            .correlate(cls)
            .scalar_subquery(),
            cls._department,
        )

    conversation_turns = relationship(
        "ConversationTurn",
        back_populates="session",
        cascade="all, delete-orphan",
        order_by="ConversationTurn.turn_index",
    )
    versions = relationship(
        "JDVersion", back_populates="session", cascade="all, delete-orphan"
    )
    review_comments = relationship(
        "JDReviewComment",
        back_populates="jd_session",
        cascade="all, delete-orphan",
        order_by="JDReviewComment.created_at.desc()",
    )

    __table_args__ = (
        # Sidebar query: employee's JDs ordered by date
        Index("idx_jd_employee_updated", "employee_id", "updated_at"),
        # HR / Manager queue filters
        Index("idx_jd_status_updated", "status", "updated_at"),
        # Manager view: reports + status filter
        Index("idx_jd_employee_status", "employee_id", "status"),
        Index(
            "uq_jd_sessions_source_reference_jd_id",
            "source_reference_jd_id",
            unique=True,
            postgresql_where=source_reference_jd_id.isnot(None),
        ),
    )


class ConversationTurn(Base):
    __tablename__ = "conversation_turns"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    session_id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("jd_sessions.id", ondelete="CASCADE"),
        nullable=False,
    )
    turn_index: Mapped[int] = mapped_column(Integer, nullable=False)
    role: Mapped[str] = mapped_column(Text, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    session = relationship("JDSession", back_populates="conversation_turns")

    __table_args__ = (
        UniqueConstraint("session_id", "turn_index", name="uq_session_turn"),
        Index("idx_turns_session", "session_id", "turn_index"),
    )


class JDVersion(Base):
    __tablename__ = "jd_versions"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    session_id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("jd_sessions.id", ondelete="CASCADE"),
        nullable=False,
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    jd_text: Mapped[str] = mapped_column(Text, nullable=False)
    jd_structured: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_by: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    session = relationship("JDSession", back_populates="versions")
