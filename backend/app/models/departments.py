"""Department model"""
from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, Boolean
from sqlalchemy.orm import relationship
from datetime import datetime
from app.database import Base


class Department(Base):
    __tablename__ = "departments"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False, unique=True)
    description = Column(Text, nullable=True)
    contact_person_id = Column(Integer, ForeignKey("people.id"), nullable=True)
    notes = Column(Text, nullable=True)
    active = Column(Boolean, default=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    people = relationship("Person", back_populates="department", foreign_keys="Person.department_id")
    contact_person = relationship("Person", foreign_keys=[contact_person_id], post_update=True)
    tasks = relationship("Task", back_populates="department", cascade="all, delete-orphan")
    followups = relationship("FollowUp", back_populates="department")
    issues = relationship("Issue", back_populates="department")
