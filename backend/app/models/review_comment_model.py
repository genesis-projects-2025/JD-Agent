# app/models/review_comment_model.py
from sqlalchemy import Column, String, Text, DateTime, Boolean, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import uuid

from app.core.database import Base


class JDReviewComment(Base):
    __tablename__ = "jd_review_comments"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    jd_session_id = Column(
        UUID(as_uuid=True),
        ForeignKey("jd_sessions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    reviewer_id = Column(
        String(255),
        ForeignKey("employees.id", ondelete="CASCADE"),
        nullable=False,
    )
    target_role = Column(
        String(50),
        nullable=False,
    )  # "employee" | "manager"
    action = Column(
        String(50),
        nullable=False,
    )  # "rejected" | "approved" | "revision_requested"
    comment = Column(Text, nullable=True)
    is_read = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    jd_session = relationship("JDSession", back_populates="review_comments")
    reviewer = relationship("Employee", back_populates="review_comments_given")
