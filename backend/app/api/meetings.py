"""Meetings API routes"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from datetime import datetime
from typing import List, Optional
from app.database import get_db
from app.models import Meeting
from pydantic import BaseModel
from app.partial import make_partial, make_lenient, merge
from app.validation import Name, one_of, Timestamp


class MeetingSchema(BaseModel):
    id: Optional[int] = None
    title: Name
    meeting_date: Timestamp = None
    participants: Optional[str] = None
    notes: Optional[str] = None
    decisions: Optional[str] = None
    primary_contact_id: Optional[int] = None

    class Config:
        from_attributes = True


MeetingSchemaPartial = make_partial(MeetingSchema)
MeetingSchemaOut = make_lenient(MeetingSchema)

router = APIRouter()


@router.get("", response_model=List[MeetingSchemaOut])
def get_meetings(db: Session = Depends(get_db), skip: int = Query(0), limit: int = Query(100)):
    """Get all meetings"""
    return db.query(Meeting).order_by(Meeting.meeting_date.desc()).offset(skip).limit(limit).all()


@router.post("", response_model=MeetingSchemaOut)
def create_meeting(meeting: MeetingSchema, db: Session = Depends(get_db)):
    """Create a new meeting"""
    db_meeting = Meeting(**meeting.dict())
    db.add(db_meeting)
    db.commit()
    db.refresh(db_meeting)
    return db_meeting


@router.get("/{meeting_id}", response_model=MeetingSchemaOut)
def get_meeting(meeting_id: int, db: Session = Depends(get_db)):
    """Get a meeting"""
    meeting = db.query(Meeting).filter(Meeting.id == meeting_id).first()
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    return meeting


@router.put("/{meeting_id}", response_model=MeetingSchemaOut)
def update_meeting(meeting_id: int, meeting: MeetingSchemaPartial, db: Session = Depends(get_db)):
    """Update a meeting"""
    db_meeting = db.query(Meeting).filter(Meeting.id == meeting_id).first()
    if not db_meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")

    # Only apply the fields the caller actually sent; keep the rest as stored.
    meeting = merge(MeetingSchema, db_meeting, meeting)
    for key, value in meeting.dict().items():
        setattr(db_meeting, key, value)
    db_meeting.updated_at = datetime.utcnow()
    db.add(db_meeting)
    db.commit()
    db.refresh(db_meeting)
    return db_meeting


@router.delete("/{meeting_id}")
def delete_meeting(meeting_id: int, db: Session = Depends(get_db)):
    """Delete a meeting"""
    db_meeting = db.query(Meeting).filter(Meeting.id == meeting_id).first()
    if not db_meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    db.delete(db_meeting)
    db.commit()
    return {"message": "Meeting deleted"}
