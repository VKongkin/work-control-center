"""Meetings API routes.

Meetings arrive two ways: created here, or synced from a connected calendar.
Both are editable. Only the ones created here can be deleted - a meeting pulled
from Outlook is a record of something that was really in your diary, and sync
would only bring it straight back anyway.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from datetime import datetime
from typing import List, Optional
from app.database import get_db
from app.models import Meeting
from pydantic import BaseModel
from app.partial import make_partial, make_lenient, merge
from app.services.calendar_sync import SYNCED_FIELDS, edited_fields, record_edits
from app.validation import Name, Timestamp


class MeetingSchema(BaseModel):
    id: Optional[int] = None
    title: Name
    meeting_date: Timestamp = None
    participants: Optional[str] = None
    notes: Optional[str] = None
    decisions: Optional[str] = None
    primary_contact_id: Optional[int] = None

    # Calendar detail. Editable by hand - a correction here is remembered and
    # never reverted by a later sync.
    ends_at: Timestamp = None
    organizer: Optional[str] = None
    location: Optional[str] = None
    is_online: Optional[bool] = False
    join_url: Optional[str] = None
    is_cancelled: Optional[bool] = False

    class Config:
        from_attributes = True


class MeetingOut(MeetingSchema):
    """Adds the read-only provenance the UI needs to decide what to show."""
    source: Optional[str] = "WCC"
    external_id: Optional[str] = None
    connection_id: Optional[int] = None
    last_synced_at: Optional[datetime] = None
    locally_edited: Optional[List[str]] = None


MeetingSchemaPartial = make_partial(MeetingSchema)
MeetingSchemaOut = make_lenient(MeetingOut)

router = APIRouter()


def _present(meeting: Meeting) -> dict:
    """Shape a row for the API, turning the stored JSON string into a list."""
    data = {c.name: getattr(meeting, c.name) for c in meeting.__table__.columns}
    data["locally_edited"] = edited_fields(meeting)
    return data


@router.get("", response_model=List[MeetingSchemaOut])
def get_meetings(
    db: Session = Depends(get_db),
    skip: int = Query(0),
    limit: int = Query(100),
    source: Optional[str] = Query(None, description="WCC, microsoft or ics"),
    include_cancelled: bool = Query(True),
):
    """Get all meetings"""
    query = db.query(Meeting)
    if source:
        query = query.filter(Meeting.source == source)
    if not include_cancelled:
        query = query.filter((Meeting.is_cancelled == False) | (Meeting.is_cancelled.is_(None)))  # noqa: E712
    rows = query.order_by(Meeting.meeting_date.desc()).offset(skip).limit(limit).all()
    return [_present(m) for m in rows]


@router.post("", response_model=MeetingSchemaOut)
def create_meeting(meeting: MeetingSchema, db: Session = Depends(get_db)):
    """Create a new meeting"""
    db_meeting = Meeting(**meeting.dict(exclude={"id"}), source="WCC")
    db.add(db_meeting)
    db.commit()
    db.refresh(db_meeting)
    return _present(db_meeting)


@router.get("/{meeting_id}", response_model=MeetingSchemaOut)
def get_meeting(meeting_id: int, db: Session = Depends(get_db)):
    """Get a meeting"""
    meeting = db.query(Meeting).filter(Meeting.id == meeting_id).first()
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    return _present(meeting)


@router.put("/{meeting_id}", response_model=MeetingSchemaOut)
def update_meeting(meeting_id: int, meeting: MeetingSchemaPartial, db: Session = Depends(get_db)):
    """Update a meeting.

    Any calendar field changed by hand is recorded, and every future sync then
    leaves that field alone. Correcting a garbled room name once should not mean
    correcting it again after every refresh.
    """
    db_meeting = db.query(Meeting).filter(Meeting.id == meeting_id).first()
    if not db_meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")

    sent = meeting.dict(exclude_unset=True)

    # Only apply the fields the caller actually sent; keep the rest as stored.
    merged = merge(MeetingSchema, db_meeting, meeting)
    values = merged.dict(exclude={"id"})

    changed_by_hand = [
        field for field in SYNCED_FIELDS
        if field in sent and getattr(db_meeting, field, None) != values.get(field)
    ]

    for key, value in values.items():
        setattr(db_meeting, key, value)
    if db_meeting.source and db_meeting.source != "WCC" and changed_by_hand:
        record_edits(db_meeting, changed_by_hand)
    db_meeting.updated_at = datetime.utcnow()
    db.add(db_meeting)
    db.commit()
    db.refresh(db_meeting)
    return _present(db_meeting)


@router.post("/{meeting_id}/unlock", response_model=MeetingSchemaOut)
def resume_syncing_field(meeting_id: int, field: str = Query(..., description="Field to release"),
                         db: Session = Depends(get_db)):
    """Let a field track the calendar again, undoing a hand edit's protection."""
    db_meeting = db.query(Meeting).filter(Meeting.id == meeting_id).first()
    if not db_meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    if field not in SYNCED_FIELDS:
        raise HTTPException(
            status_code=422,
            detail=f"Only calendar fields can be released: {', '.join(SYNCED_FIELDS)}",
        )
    remaining = [f for f in edited_fields(db_meeting) if f != field]
    import json
    db_meeting.locally_edited = json.dumps(remaining) if remaining else None
    db.commit()
    db.refresh(db_meeting)
    return _present(db_meeting)


@router.delete("/{meeting_id}")
def delete_meeting(meeting_id: int, db: Session = Depends(get_db)):
    """Delete a meeting created here. Synced meetings are refused."""
    db_meeting = db.query(Meeting).filter(Meeting.id == meeting_id).first()
    if not db_meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")

    if db_meeting.source and db_meeting.source != "WCC":
        raise HTTPException(
            status_code=409,
            detail="This meeting came from your connected calendar, so it cannot be "
                   "deleted here - the next sync would bring it straight back. "
                   "Cancel or decline it in Outlook, or disconnect the calendar to "
                   "take ownership of its meetings.",
        )

    db.delete(db_meeting)
    db.commit()
    return {"message": "Meeting deleted"}
