"""Activity/Audit model"""
from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, Enum as SQLEnum
from sqlalchemy.orm import relationship
from datetime import datetime
import enum
from app.database import Base


class ActivityAction(str, enum.Enum):
    CREATED = "CREATED"
    UPDATED = "UPDATED"
    STATUS_CHANGED = "STATUS_CHANGED"
    PRIORITY_CHANGED = "PRIORITY_CHANGED"
    ASSIGNED = "ASSIGNED"
    COMMENTED = "COMMENTED"
    DELETED = "DELETED"


class Activity(Base):
    __tablename__ = "activities"

    id = Column(Integer, primary_key=True, index=True)
    entity_type = Column(String(50), nullable=False)  # task, followup, issue, etc.
    entity_id = Column(Integer, nullable=False)
    action = Column(SQLEnum(ActivityAction), nullable=False)
    old_value = Column(Text, nullable=True)
    new_value = Column(Text, nullable=True)
    description = Column(Text, nullable=True)

    task_id = Column(Integer, ForeignKey("tasks.id"), nullable=True)
    followup_id = Column(Integer, ForeignKey("followups.id"), nullable=True)
    issue_id = Column(Integer, ForeignKey("issues.id"), nullable=True)
    meeting_id = Column(Integer, ForeignKey("meetings.id"), nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow, index=True)

    # Relationships
    task = relationship("Task", back_populates="activities")
    followup = relationship("FollowUp", back_populates="activities")
    issue = relationship("Issue", back_populates="activities")
    meeting = relationship("Meeting", back_populates="activities")
