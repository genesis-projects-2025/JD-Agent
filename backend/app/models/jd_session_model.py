from sqlalchemy import Column, String, Text, DateTime, Integer, Index, ForeignKey, BigInteger, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import uuid
from app.core.database import Base


class JDSession(Base):
    __tablename__ = "jd_sessions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    employee_id = Column(String(255), ForeignKey("employees.id"), nullable=False, index=True)

    title = Column(Text, nullable=True)
    department = Column(Text, nullable=True)
    status = Column(Text, nullable=False, default="collecting", index=True)
    version = Column(Integer, nullable=False, default=1)

    jd_text = Column(Text, nullable=True)
    jd_structured = Column(JSONB, nullable=True)

    insights = Column(JSONB, nullable=True)
    conversation_state = Column(JSONB, nullable=True)

    reviewed_by = Column(Text, nullable=True)
    reviewer_comment = Column(Text, nullable=True)
    reviewed_at = Column(DateTime(timezone=True), nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    employee = relationship("Employee", back_populates="jd_sessions")
    conversation_turns = relationship("ConversationTurn", back_populates="session", cascade="all, delete-orphan", order_by="ConversationTurn.turn_index")
    versions = relationship("JDVersion", back_populates="session", cascade="all, delete-orphan")


class ConversationTurn(Base):
    __tablename__ = "conversation_turns"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    session_id = Column(UUID(as_uuid=True), ForeignKey("jd_sessions.id", ondelete="CASCADE"), nullable=False)
    turn_index = Column(Integer, nullable=False)
    role = Column(Text, nullable=False)
    content = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    session = relationship("JDSession", back_populates="conversation_turns")

    __table_args__ = (
        UniqueConstraint('session_id', 'turn_index', name='uq_session_turn'),
        Index('idx_turns_session', 'session_id', 'turn_index'),
    )


class JDVersion(Base):
    __tablename__ = "jd_versions"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    session_id = Column(UUID(as_uuid=True), ForeignKey("jd_sessions.id", ondelete="CASCADE"), nullable=False)
    version = Column(Integer, nullable=False)
    jd_text = Column(Text, nullable=False)
    jd_structured = Column(JSONB, nullable=True)
    created_by = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    session = relationship("JDSession", back_populates="versions")
