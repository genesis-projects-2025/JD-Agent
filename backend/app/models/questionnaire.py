from sqlalchemy import Column, String, Text, DateTime
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.sql import func
import uuid
from app.core.database import Base

class Questionnaire(Base):
    __tablename__ = "questionnaires"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    employee_id = Column(String, nullable=False)
    status = Column(String, default="in_progress")
    conversation_state = Column(JSONB, nullable=True)
    responses = Column(JSONB, nullable=True)
    generated_jd = Column(Text, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
