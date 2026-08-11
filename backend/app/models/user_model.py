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
    _department: Mapped[str | None] = mapped_column("department", Text, nullable=True)
    _reporting_manager: Mapped[str | None] = mapped_column("reporting_manager", Text, nullable=True)
    reporting_manager_code: Mapped[str | None] = mapped_column(Text, nullable=True)
    _role: Mapped[str | None] = mapped_column("role", Text, nullable=True)
    phone_mobile: Mapped[str | None] = mapped_column(String(50), nullable=True)

    created_at: Mapped[datetime.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    jd_sessions = relationship("JDSession", back_populates="employee")
    review_comments_given = relationship("JDReviewComment", back_populates="reviewer")

    organogram_record = relationship(
        "Organogram",
        primaryjoin="foreign(Employee.id) == remote(Organogram.code)",
        uselist=False,
        lazy="joined",
        viewonly=True,
    )

    @property
    def department(self) -> str | None:
        if self.organogram_record and self.organogram_record.department:
            return self.organogram_record.department
        return self._department

    @department.setter
    def department(self, value):
        self._department = value

    @property
    def role(self) -> str | None:
        if self.organogram_record and self.organogram_record.designation:
            return self.organogram_record.designation
        return self._role

    @role.setter
    def role(self, value):
        self._role = value

    @property
    def reporting_manager(self) -> str | None:
        if self.organogram_record and self.organogram_record.reporting_manager:
            return self.organogram_record.reporting_manager
        return self._reporting_manager

    @reporting_manager.setter
    def reporting_manager(self, value):
        self._reporting_manager = value

    def __repr__(self):
        return f"<Employee id={self.id} name={self.name}>"


class Organogram(Base):
    __tablename__ = "organogram"

    code: Mapped[str] = mapped_column(String(255), primary_key=True)
    employee_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    designation: Mapped[str | None] = mapped_column(Text, nullable=True)
    reporting_manager: Mapped[str | None] = mapped_column(Text, nullable=True)
    reporting_manager_code: Mapped[str | None] = mapped_column(Text, nullable=True)
    department: Mapped[str | None] = mapped_column(Text, nullable=True)
    location: Mapped[str | None] = mapped_column(Text, nullable=True)
    joblevel: Mapped[str | None] = mapped_column(Text, nullable=True)

    def __repr__(self):
        return f"<Organogram code={self.code} name={self.employee_name}>"
