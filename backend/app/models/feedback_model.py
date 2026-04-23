from sqlalchemy import String, Integer, DateTime, ForeignKey, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func
import uuid
import datetime

from app.core.database import Base

class Feedback(Base):
    __tablename__ = "feedbacks"

    id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    employee_id: Mapped[str] = mapped_column(String(255), ForeignKey("employees.id", ondelete="CASCADE"), nullable=False)
    jd_session_id: Mapped[UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("jd_sessions.id", ondelete="SET NULL"), nullable=True)
    
    category: Mapped[str] = mapped_column(String(50), nullable=False) # e.g. "Bug", "Feature", "General"
    rating: Mapped[int | None] = mapped_column(Integer, nullable=True) # 1-5 scale
    message: Mapped[str] = mapped_column(Text, nullable=False)
    
    status: Mapped[str] = mapped_column(String(50), default="unread") # 'unread', 'reviewed', 'resolved'
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
