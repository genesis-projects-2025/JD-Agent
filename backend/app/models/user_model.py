from sqlalchemy import String, Text, DateTime
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func
import datetime
from app.core.database import Base

class Employee(Base):
    __tablename__ = "employees"

    id: Mapped[str] = mapped_column(String(255), primary_key=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    email: Mapped[str | None] = mapped_column(Text, nullable=True)
    department: Mapped[str | None] = mapped_column(Text, nullable=True)
    reporting_manager: Mapped[str | None] = mapped_column(Text, nullable=True)
    reporting_manager_code: Mapped[str | None] = mapped_column(Text, nullable=True)
    role: Mapped[str | None] = mapped_column(Text, nullable=True)
    phone_mobile: Mapped[str | None] = mapped_column(String(50), nullable=True)

    created_at: Mapped[datetime.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    jd_sessions = relationship("JDSession", back_populates="employee")
    review_comments_given = relationship("JDReviewComment", back_populates="reviewer")

    def __repr__(self):
        return f"<Employee id={self.id} name={self.name}>"
