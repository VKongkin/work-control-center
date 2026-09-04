"""Meeting model.

A meeting either originates here or mirrors one from a connected calendar.
That distinction drives two rules: a mirrored meeting cannot be deleted from
WCC (it would reappear on the next sync, or worse, look deleted while still in
Outlook), and any field the user edits by hand is recorded so future syncs
leave it alone.
"""
from sqlalchemy import Column, Integer, String, Text, DateTime, Boolean, ForeignKey, Index
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

    # ---- where this meeting came from -------------------------------------
    # "WCC" for one created here, otherwise the provider that supplied it.
    source = Column(String(16), nullable=False, default="WCC")
    # The provider's own id for the occurrence, used to match on re-sync.
    external_id = Column(String(512), nullable=True)
    connection_id = Column(Integer, nullable=True)

    # ---- calendar detail, only populated for synced meetings ---------------
    ends_at = Column(DateTime, nullable=True)
    organizer = Column(String(255), nullable=True)
    location = Column(String(512), nullable=True)
    is_online = Column(Boolean, default=False)
    # An all-day entry has no time of day. Kept as a fact rather than inferred
    # from a midnight timestamp, so converting between timezones can leave it
    # alone instead of dragging a holiday onto the evening before.
    all_day = Column(Boolean, default=False)
    join_url = Column(Text, nullable=True)
    is_cancelled = Column(Boolean, default=False)
    last_synced_at = Column(DateTime, nullable=True)

    # JSON array of field names the user has edited by hand. Sync refreshes
    # everything except these, so a correction is never silently reverted.
    locally_edited = Column(Text, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    primary_contact = relationship("Person", back_populates="meetings")
    activities = relationship("Activity", back_populates="meeting", cascade="all, delete-orphan")

    __table_args__ = (
        Index("ix_meetings_external", "connection_id", "external_id"),
    )
