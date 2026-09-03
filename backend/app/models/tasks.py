"""Task model"""
from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, Enum as SQLEnum
from sqlalchemy.orm import relationship
from datetime import datetime
import enum
from app.database import Base


class TaskStatus(str, enum.Enum):
    INBOX = "INBOX"
    PENDING = "PENDING"
    IN_PROGRESS = "IN_PROGRESS"
    BLOCKED = "BLOCKED"
    COMPLETED = "COMPLETED"
    CANCELLED = "CANCELLED"


class TaskPriority(str, enum.Enum):
    P0_CRITICAL = "P0_CRITICAL"
    P1_HIGH = "P1_HIGH"
    P2_MEDIUM = "P2_MEDIUM"
    P3_LOW = "P3_LOW"


class Task(Base):
    __tablename__ = "tasks"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    status = Column(SQLEnum(TaskStatus), default=TaskStatus.INBOX)
    priority = Column(SQLEnum(TaskPriority), default=TaskPriority.P2_MEDIUM)

    due_date = Column(DateTime, nullable=True)
    category_id = Column(Integer, ForeignKey("categories.id"), nullable=True)
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=True)
    system_id = Column(Integer, ForeignKey("systems.id"), nullable=True)
    department_id = Column(Integer, ForeignKey("departments.id"), nullable=True)
    responsible_person_id = Column(Integer, ForeignKey("people.id"), nullable=True)
    vendor_id = Column(Integer, ForeignKey("vendors.id"), nullable=True)

    next_action = Column(Text, nullable=True)
    blocked_reason = Column(Text, nullable=True)
    notes = Column(Text, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    completed_at = Column(DateTime, nullable=True)
    last_activity_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    project = relationship("Project", back_populates="tasks")
    system = relationship("System", back_populates="tasks")
    department = relationship("Department", back_populates="tasks")
    responsible_person = relationship("Person", back_populates="responsible_tasks", foreign_keys=[responsible_person_id])
    vendor = relationship("Vendor", back_populates="tasks")
    category = relationship("Category", back_populates="tasks")
    activities = relationship("Activity", back_populates="task", cascade="all, delete-orphan")
    followups = relationship("FollowUp", back_populates="task")
