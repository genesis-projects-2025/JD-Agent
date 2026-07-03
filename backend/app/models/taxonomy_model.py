from sqlalchemy import String, BigInteger, ForeignKey, DateTime
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func
from app.core.database import Base, SafeVector


class Skill(Base):
    __tablename__ = "skills"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    embedding: Mapped[list[float] | None] = mapped_column(SafeVector(3072), nullable=True)
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class JDSessionSkill(Base):
    __tablename__ = "jd_session_skills"

    session_id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("jd_sessions.id", ondelete="CASCADE"),
        primary_key=True,
    )
    skill_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("skills.id", ondelete="CASCADE"), primary_key=True
    )


class EmployeeSkill(Base):
    __tablename__ = "employee_skills"

    employee_id: Mapped[str] = mapped_column(
        String(255), ForeignKey("employees.id", ondelete="CASCADE"), primary_key=True
    )
    skill_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("skills.id", ondelete="CASCADE"), primary_key=True
    )

    source: Mapped[str] = mapped_column(String(50), default="jd_interview")
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Tool(Base):
    __tablename__ = "tools"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    embedding: Mapped[list[float] | None] = mapped_column(SafeVector(3072), nullable=True)
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class JDSessionTool(Base):
    __tablename__ = "jd_session_tools"

    session_id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("jd_sessions.id", ondelete="CASCADE"),
        primary_key=True,
    )
    tool_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("tools.id", ondelete="CASCADE"), primary_key=True
    )


class EmployeeTool(Base):
    __tablename__ = "employee_tools"

    employee_id: Mapped[str] = mapped_column(
        String(255), ForeignKey("employees.id", ondelete="CASCADE"), primary_key=True
    )
    tool_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("tools.id", ondelete="CASCADE"), primary_key=True
    )

    source: Mapped[str] = mapped_column(String(50), default="jd_interview")
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now())
