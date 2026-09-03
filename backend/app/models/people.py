"""Person model"""
from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, Boolean
from sqlalchemy.orm import relationship
from datetime import datetime
from app.database import Base


class Person(Base):
    __tablename__ = "people"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    email = Column(String(255), nullable=True)
    phone = Column(String(20), nullable=True)
    role = Column(String(255), nullable=True)

    department_id = Column(Integer, ForeignKey("departments.id"), nullable=True)
    vendor_id = Column(Integer, ForeignKey("vendors.id"), nullable=True)

    notes = Column(Text, nullable=True)
    active = Column(Boolean, default=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    department = relationship("Department", back_populates="people", foreign_keys=[department_id])
    vendor = relationship("Vendor", back_populates="people", foreign_keys=[vendor_id])
    responsible_tasks = relationship("Task", back_populates="responsible_person", foreign_keys="Task.responsible_person_id")
    followups = relationship("FollowUp", back_populates="person")
    issues = relationship("Issue", back_populates="responsible_person")
    meetings = relationship("Meeting", back_populates="primary_contact")
