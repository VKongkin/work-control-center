"""Systems API routes"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from datetime import datetime
from typing import List, Optional
from app.database import get_db
from app.models import System
from pydantic import BaseModel
from app.partial import make_partial, make_lenient, merge
from app.validation import Name, one_of


class SystemSchema(BaseModel):
    id: Optional[int] = None
    name: Name
    description: Optional[str] = None
    environment: Optional[str] = None
    owner: Optional[str] = None
    notes: Optional[str] = None
    active: bool = True

    class Config:
        from_attributes = True


SystemSchemaPartial = make_partial(SystemSchema)
SystemSchemaOut = make_lenient(SystemSchema)

router = APIRouter()


@router.get("", response_model=List[SystemSchemaOut])
def get_systems(
    db: Session = Depends(get_db),
    skip: int = Query(0),
    limit: int = Query(100),
    include_inactive: bool = Query(False),
):
    """Get all systems"""
    # Deleting here archives rather than destroys, so history that points at
    # this record stays intact. Archived rows are hidden unless asked for.
    query = db.query(System)
    if not include_inactive:
        query = query.filter(System.active == True)
    return query.order_by(System.name).offset(skip).limit(limit).all()


@router.post("", response_model=SystemSchemaOut)
def create_system(system: SystemSchema, db: Session = Depends(get_db)):
    """Create a new system"""
    db_system = System(**system.dict())
    db.add(db_system)
    db.commit()
    db.refresh(db_system)
    return db_system


@router.get("/{system_id}", response_model=SystemSchemaOut)
def get_system(system_id: int, db: Session = Depends(get_db)):
    """Get a system"""
    system = db.query(System).filter(System.id == system_id).first()
    if not system:
        raise HTTPException(status_code=404, detail="System not found")
    return system


@router.put("/{system_id}", response_model=SystemSchemaOut)
def update_system(system_id: int, system: SystemSchemaPartial, db: Session = Depends(get_db)):
    """Update a system"""
    db_system = db.query(System).filter(System.id == system_id).first()
    if not db_system:
        raise HTTPException(status_code=404, detail="System not found")

    # Only apply the fields the caller actually sent; keep the rest as stored.
    system = merge(SystemSchema, db_system, system)
    for key, value in system.dict().items():
        setattr(db_system, key, value)
    db_system.updated_at = datetime.utcnow()
    db.add(db_system)
    db.commit()
    db.refresh(db_system)
    return db_system


@router.delete("/{system_id}")
def delete_system(system_id: int, db: Session = Depends(get_db)):
    """Archive: hidden from lists, but kept so linked history survives."""
    db_system = db.query(System).filter(System.id == system_id).first()
    if not db_system:
        raise HTTPException(status_code=404, detail="System not found")
    db_system.active = False
    db.add(db_system)
    db.commit()
    return {"message": "System archived"}
