"""
Brain Agent Session & Conversation Turn models.

Stores persistent admin conversation sessions and their turn history
for the Admin Brain Agent, following the same pattern as KRAKPISession
and KRAKPIConversationTurn.
"""

import uuid
import datetime
from sqlalchemy import String, Text, DateTime, Index, BigInteger, Integer, ForeignKey
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func
from app.core.database import Base


class BrainAgentSession(Base):
    __tablename__ = "brain_agent_sessions"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    title: Mapped[str] = mapped_column(String(255), nullable=True)
    admin_user: Mapped[str] = mapped_column(String(100), nullable=False)
    entity_context: Mapped[dict] = mapped_column(JSONB, nullable=True, default=dict)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationship to conversation turns
    conversation_turns = relationship(
        "BrainAgentConversationTurn",
        back_populates="session",
        cascade="all, delete-orphan",
        order_by="BrainAgentConversationTurn.turn_index",
    )

    def to_dict(self):
        return {
            "id": str(self.id),
            "title": self.title,
            "admin_user": self.admin_user,
            "entity_context": self.entity_context,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }


class BrainAgentConversationTurn(Base):
    __tablename__ = "brain_agent_conversation_turns"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("brain_agent_sessions.id", ondelete="CASCADE"),
        nullable=False,
    )
    turn_index: Mapped[int] = mapped_column(Integer, nullable=False)
    role: Mapped[str] = mapped_column(Text, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    tool_calls: Mapped[dict] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    # Relationship back to session
    session = relationship("BrainAgentSession", back_populates="conversation_turns")

    __table_args__ = (
        Index("ix_brain_agent_turns_session_index", "session_id", "turn_index"),
    )

    def to_dict(self):
        return {
            "id": self.id,
            "session_id": str(self.session_id),
            "turn_index": self.turn_index,
            "role": self.role,
            "content": self.content,
            "tool_calls": self.tool_calls,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }
