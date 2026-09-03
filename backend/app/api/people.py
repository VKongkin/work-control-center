"""People API routes"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from datetime import datetime
from typing import List, Optional
from app.database import get_db
from app.models import Person
from pydantic import BaseModel
from app.partial import make_partial, make_lenient, merge
from app.validation import Name, one_of


class PersonSchema(BaseModel):
    id: Optional[int] = None
    name: Name
    email: Optional[str] = None
    phone: Optional[str] = None
    role: Optional[str] = None
    department_id: Optional[int] = None
    vendor_id: Optional[int] = None
    notes: Optional[str] = None
    active: bool = True

    class Config:
        from_attributes = True


PersonSchemaPartial = make_partial(PersonSchema)
PersonSchemaOut = make_lenient(PersonSchema)

router = APIRouter()


@router.get("", response_model=List[PersonSchemaOut])
def get_people(
    db: Session = Depends(get_db),
    skip: int = Query(0),
    limit: int = Query(100),
    include_inactive: bool = Query(False),
):
    """Get all people"""
    # Deleting here archives rather than destroys, so history that points at
    # this record stays intact. Archived rows are hidden unless asked for.
    query = db.query(Person)
    if not include_inactive:
        query = query.filter(Person.active == True)
    return query.order_by(Person.name).offset(skip).limit(limit).all()


@router.post("", response_model=PersonSchemaOut)
def create_person(person: PersonSchema, db: Session = Depends(get_db)):
    """Create a new person"""
    db_person = Person(**person.dict())
    db.add(db_person)
    db.commit()
    db.refresh(db_person)
    return db_person


@router.get("/{person_id}", response_model=PersonSchemaOut)
def get_person(person_id: int, db: Session = Depends(get_db)):
    """Get a person"""
    person = db.query(Person).filter(Person.id == person_id).first()
    if not person:
        raise HTTPException(status_code=404, detail="Person not found")
    return person


@router.put("/{person_id}", response_model=PersonSchemaOut)
def update_person(person_id: int, person: PersonSchemaPartial, db: Session = Depends(get_db)):
    """Update a person"""
    db_person = db.query(Person).filter(Person.id == person_id).first()
    if not db_person:
        raise HTTPException(status_code=404, detail="Person not found")

    # Only apply the fields the caller actually sent; keep the rest as stored.
    person = merge(PersonSchema, db_person, person)
    for key, value in person.dict().items():
        setattr(db_person, key, value)
    db_person.updated_at = datetime.utcnow()
    db.add(db_person)
    db.commit()
    db.refresh(db_person)
    return db_person


@router.delete("/{person_id}")
def delete_person(person_id: int, db: Session = Depends(get_db)):
    """Delete a person"""
    db_person = db.query(Person).filter(Person.id == person_id).first()
    if not db_person:
        raise HTTPException(status_code=404, detail="Person not found")
    db_person.active = False
    db.add(db_person)
    db.commit()
    return {"message": "Person archived"}
