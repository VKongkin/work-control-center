"""Vendor model"""
from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, Boolean
from sqlalchemy.orm import relationship
from datetime import datetime
from app.database import Base


class Vendor(Base):
    __tablename__ = "vendors"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False, unique=True)
    type = Column(String(255), nullable=True)
    primary_contact_id = Column(Integer, ForeignKey("people.id"), nullable=True)
    email = Column(String(255), nullable=True)
    phone = Column(String(20), nullable=True)
    notes = Column(Text, nullable=True)
    active = Column(Boolean, default=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    people = relationship("Person", back_populates="vendor", foreign_keys="Person.vendor_id")
    primary_contact = relationship("Person", foreign_keys=[primary_contact_id], post_update=True)
    tasks = relationship("Task", back_populates="vendor")
    followups = relationship("FollowUp", back_populates="vendor")
    issues = relationship("Issue", back_populates="vendor")
