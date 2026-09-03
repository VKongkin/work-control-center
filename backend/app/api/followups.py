"""Follow-ups API routes"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from datetime import datetime
from typing import List, Optional
from app.database import get_db
from app.models import FollowUp, Activity
from app.models.activity import ActivityAction
from pydantic import BaseModel
from app.partial import make_partial, make_lenient, merge
from app.validation import Name, one_of, FOLLOWUP_STATUSES, WAITING_FOR_TYPES, Timestamp


class FollowUpSchema(BaseModel):
    id: Optional[int] = None
    title: Name
    description: Optional[str] = None
    status: str = "WAITING"
    waiting_for_type: str
    person_id: Optional[int] = None
    department_id: Optional[int] = None
    vendor_id: Optional[int] = None
    task_id: Optional[int] = None
    requested_date: Timestamp = None
    expected_date: Timestamp = None
    follow_up_date: Timestamp = None
    last_contact_date: Timestamp = None
    next_action: Optional[str] = None
    notes: Optional[str] = None

    _valid_status = one_of('status', FOLLOWUP_STATUSES)
    _valid_waiting_for_type = one_of('waiting_for_type', WAITING_FOR_TYPES)

    class Config:
        from_attributes = True


FollowUpSchemaPartial = make_partial(FollowUpSchema)
FollowUpSchemaOut = make_lenient(FollowUpSchema)

router = APIRouter()


@router.get("", response_model=List[FollowUpSchemaOut])
def get_followups(
    db: Session = Depends(get_db),
    status: Optional[str] = Query(None),
    skip: int = Query(0),
    limit: int = Query(100),
):
    """Get all follow-ups"""
    query = db.query(FollowUp)
    if status:
        query = query.filter(FollowUp.status == status)
    return query.order_by(FollowUp.follow_up_date).offset(skip).limit(limit).all()


@router.post("", response_model=FollowUpSchemaOut)
def create_followup(fu: FollowUpSchema, db: Session = Depends(get_db)):
    """Create a new follow-up"""
    db_fu = FollowUp(
        title=fu.title,
        description=fu.description,
        status=fu.status,
        waiting_for_type=fu.waiting_for_type,
        person_id=fu.person_id,
        department_id=fu.department_id,
        vendor_id=fu.vendor_id,
        task_id=fu.task_id,
        requested_date=fu.requested_date,
        expected_date=fu.expected_date,
        follow_up_date=fu.follow_up_date,
        last_contact_date=fu.last_contact_date,
        next_action=fu.next_action,
        notes=fu.notes,
    )
    db.add(db_fu)
    db.commit()
    db.refresh(db_fu)

    activity = Activity(
        entity_type="followup",
        entity_id=db_fu.id,
        action=ActivityAction.CREATED,
        description=f"Follow-up created: {fu.title}",
        followup_id=db_fu.id,
    )
    db.add(activity)
    db.commit()

    return db_fu


@router.get("/{followup_id}", response_model=FollowUpSchemaOut)
def get_followup(followup_id: int, db: Session = Depends(get_db)):
    """Get a follow-up"""
    fu = db.query(FollowUp).filter(FollowUp.id == followup_id).first()
    if not fu:
        raise HTTPException(status_code=404, detail="Follow-up not found")
    return fu


@router.put("/{followup_id}", response_model=FollowUpSchemaOut)
def update_followup(followup_id: int, fu: FollowUpSchemaPartial, db: Session = Depends(get_db)):
    """Update a follow-up"""
    db_fu = db.query(FollowUp).filter(FollowUp.id == followup_id).first()
    if not db_fu:
        raise HTTPException(status_code=404, detail="Follow-up not found")

    # Only apply the fields the caller actually sent; keep the rest as stored.
    fu = merge(FollowUpSchema, db_fu, fu)

    # This used to assign a hand-written subset, which silently dropped
    # waiting_for_type and all three relations - so reassigning a follow-up from
    # a person to a vendor returned 200 and changed nothing. Copying every field
    # keeps the endpoint honest as the schema grows.
    for key, value in fu.model_dump(exclude={"id", "created_at", "updated_at"}).items():
        setattr(db_fu, key, value)

    # last_contact_date was previously stamped with "now" on every single save,
    # so renaming a follow-up falsely recorded that you had chased it. It is
    # ordinary data: it changes only when the caller says so.
    db_fu.updated_at = datetime.utcnow()

    db.add(db_fu)
    db.commit()
    db.refresh(db_fu)
    return db_fu


@router.delete("/{followup_id}")
def delete_followup(followup_id: int, db: Session = Depends(get_db)):
    """Delete a follow-up"""
    db_fu = db.query(FollowUp).filter(FollowUp.id == followup_id).first()
    if not db_fu:
        raise HTTPException(status_code=404, detail="Follow-up not found")
    db.delete(db_fu)
    db.commit()
    return {"message": "Follow-up deleted"}
