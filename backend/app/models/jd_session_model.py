# app/models/jd_session_model.py
# PERFORMANCE: Added composite indexes on hot query columns

from sqlalchemy import (
    String,
    Text,
    DateTime,
    Integer,
    Index,
    ForeignKey,
    BigInteger,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func
import uuid
import datetime
from app.core.database import Base


class JDSession(Base):
    __tablename__ = "jd_sessions"

    id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    employee_id: Mapped[str] = mapped_column(
        String(255), ForeignKey("employees.id"), nullable=False, index=True
    )

    title: Mapped[str | None] = mapped_column(Text, nullable=True)
    department: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(Text, nullable=False, default="collecting", index=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    jd_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    jd_structured: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    insights: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    conversation_state: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    reviewed_by: Mapped[str | None] = mapped_column(Text, nullable=True)
    reviewer_comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    reviewed_at: Mapped[datetime.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    created_at: Mapped[datetime.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    employee = relationship("Employee", back_populates="jd_sessions")
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
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now())

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
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    session = relationship("JDSession", back_populates="versions")
