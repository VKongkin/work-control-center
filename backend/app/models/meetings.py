"""Meeting model"""
from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from datetime import datetime
from app.database import Base


class Meeting(Base):
    __tablename__ = "meetings"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(255), nullable=False)
    meeting_date = Column(DateTime, nullable=True)
    participants = Column(Text, nullable=True)  # CSV or JSON format
    notes = Column(Text, nullable=True)
    decisions = Column(Text, nullable=True)
    primary_contact_id = Column(Integer, ForeignKey("people.id"), nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    primary_contact = relationship("Person", back_populates="meetings")
    activities = relationship("Activity", back_populates="meeting", cascade="all, delete-orphan")
