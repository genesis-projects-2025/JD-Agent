# app/models/token_log_model.py

from sqlalchemy import (
    String,
    Text,
    DateTime,
    Integer,
    Float,
    Boolean,
    Index,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func
import uuid
import datetime
from app.core.database import Base


class LLMTokenLog(Base):
    """Stores granular LLM invocation metadata for real-time admin evaluation and cost observability."""
    __tablename__ = "llm_token_logs"

    id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    trace_id: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    session_id: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    employee_id: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    employee_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    
    agent_name: Mapped[str] = mapped_column(String(100), nullable=False, default="InterviewEngine", index=True)
    span_name: Mapped[str] = mapped_column(String(100), nullable=False, default="question_generation", index=True)
    call_type: Mapped[str] = mapped_column(String(100), nullable=False, default="question_gen", index=True)
    model_name: Mapped[str] = mapped_column(String(100), nullable=False, default="gemini-2.5-flash", index=True)
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="success", index=True)
    
    prompt_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    completion_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    
    cost_usd: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    cost_inr: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    latency_ms: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    is_anomaly: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, index=True)
    
    user_message_snippet: Mapped[str | None] = mapped_column(Text, nullable=True)
    prompt_preview: Mapped[str | None] = mapped_column(Text, nullable=True)
    response_preview: Mapped[str | None] = mapped_column(Text, nullable=True)
    full_prompt: Mapped[str | None] = mapped_column(Text, nullable=True)
    full_response: Mapped[str | None] = mapped_column(Text, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )

    __table_args__ = (
        Index("idx_token_logs_session_created", "session_id", "created_at"),
        Index("idx_token_logs_trace_created", "trace_id", "created_at"),
        Index("idx_token_logs_created_agent", "created_at", "agent_name"),
        Index("idx_token_logs_anomaly", "is_anomaly", "created_at"),
    )
