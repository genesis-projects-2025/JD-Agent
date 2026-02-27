from sqlalchemy import Column, String, Integer, BigInteger, ForeignKey, DateTime
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.core.database import Base

class Skill(Base):
    __tablename__ = "skills"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    name = Column(String(255), unique=True, index=True, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

class JDSessionSkill(Base):
    __tablename__ = "jd_session_skills"
    
    session_id = Column(UUID(as_uuid=True), ForeignKey("jd_sessions.id", ondelete="CASCADE"), primary_key=True)
    skill_id = Column(BigInteger, ForeignKey("skills.id", ondelete="CASCADE"), primary_key=True)

class EmployeeSkill(Base):
    __tablename__ = "employee_skills"
    
    employee_id = Column(String(255), ForeignKey("employees.id", ondelete="CASCADE"), primary_key=True)
    skill_id = Column(BigInteger, ForeignKey("skills.id", ondelete="CASCADE"), primary_key=True)
    
    source = Column(String(50), default="jd_interview")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
