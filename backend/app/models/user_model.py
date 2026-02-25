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

    created_at = Column(DateTime(timezone=True), server_default=func.now())

    jd_sessions = relationship("JDSession", back_populates="employee")

    def __repr__(self):
        return f"<Employee id={self.id} name={self.name}>"
