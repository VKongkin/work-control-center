"""Follow-up model"""
from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, Enum as SQLEnum
from sqlalchemy.orm import relationship
from datetime import datetime
import enum
from app.database import Base


class FollowUpStatus(str, enum.Enum):
    WAITING = "WAITING"
    FOLLOW_UP_DUE = "FOLLOW_UP_DUE"
    OVERDUE = "OVERDUE"
    RECEIVED = "RECEIVED"
    CANCELLED = "CANCELLED"


class WaitingForType(str, enum.Enum):
    PERSON = "PERSON"
    DEPARTMENT = "DEPARTMENT"
    VENDOR = "VENDOR"


class FollowUp(Base):
    __tablename__ = "followups"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    status = Column(SQLEnum(FollowUpStatus), default=FollowUpStatus.WAITING)
    waiting_for_type = Column(SQLEnum(WaitingForType), nullable=False)

    person_id = Column(Integer, ForeignKey("people.id"), nullable=True)
    department_id = Column(Integer, ForeignKey("departments.id"), nullable=True)
    vendor_id = Column(Integer, ForeignKey("vendors.id"), nullable=True)
    task_id = Column(Integer, ForeignKey("tasks.id"), nullable=True)

    requested_date = Column(DateTime, nullable=True)
    expected_date = Column(DateTime, nullable=True)
    follow_up_date = Column(DateTime, nullable=True)
    last_contact_date = Column(DateTime, nullable=True)

    next_action = Column(Text, nullable=True)
    notes = Column(Text, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    completed_at = Column(DateTime, nullable=True)

    # Relationships
    person = relationship("Person", back_populates="followups")
    department = relationship("Department", back_populates="followups")
    vendor = relationship("Vendor", back_populates="followups")
    task = relationship("Task", back_populates="followups")
    activities = relationship("Activity", back_populates="followup", cascade="all, delete-orphan")
