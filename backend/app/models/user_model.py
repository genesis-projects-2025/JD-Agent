from sqlalchemy import Column, String, Text, DateTime
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.core.database import Base

class Employee(Base):
    __tablename__ = "employees"

    id = Column(String(255), primary_key=True)
    name = Column(Text, nullable=False)
    email = Column(Text, nullable=True)
    department = Column(Text, nullable=True)
    reporting_manager = Column(Text, nullable=True)
    reporting_manager_code = Column(Text, nullable=True)
    role = Column(Text, nullable=True)
    phone_mobile = Column(String(50), nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())

    jd_sessions = relationship("JDSession", back_populates="employee")
    review_comments_given = relationship("JDReviewComment", back_populates="reviewer")

    def __repr__(self):
        return f"<Employee id={self.id} name={self.name}>"
