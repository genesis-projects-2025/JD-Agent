from sqlalchemy import Column, String, Integer, DateTime, ForeignKey, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
import uuid

from app.core.database import Base

class Feedback(Base):
    __tablename__ = "feedbacks"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    employee_id = Column(String(255), ForeignKey("employees.id", ondelete="CASCADE"), nullable=False)
    jd_session_id = Column(UUID(as_uuid=True), ForeignKey("jd_sessions.id", ondelete="SET NULL"), nullable=True)
    
    category = Column(String(50), nullable=False) # e.g. "Bug", "Feature", "General"
    rating = Column(Integer, nullable=True) # 1-5 scale
    message = Column(Text, nullable=False)
    
    status = Column(String(50), default="unread") # 'unread', 'reviewed', 'resolved'
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
