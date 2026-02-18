# app/models/questionnaire_model.py
from sqlalchemy import Column, String, Text, DateTime
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.sql import func
import uuid
from app.core.database import Base


def generate_uuid():
    return str(uuid.uuid4())


class Questionnaire(Base):
    __tablename__ = "questionnaires"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    employee_id = Column(String(255), nullable=False)
    employee_name = Column(String(255), nullable=True)
    status = Column(String(50), default="in_progress")

    # PostgreSQL JSONB — faster and indexable vs plain JSON
    conversation_state = Column(JSONB, nullable=True)   # progress, analytics, approval
    responses = Column(JSONB, nullable=True)             # employee_role_insights
    generated_jd = Column(Text, nullable=True)           # jd_text_format (markdown)
    jd_structured = Column(JSONB, nullable=True)         # jd_structured_data

    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, onupdate=func.now())

    def __repr__(self):
        return f"<Questionnaire id={self.id} employee={self.employee_id} status={self.status}>"