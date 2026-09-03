"""Departments API routes"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from datetime import datetime
from typing import List, Optional
from app.database import get_db
from app.models import Department
from pydantic import BaseModel
from app.partial import make_partial, make_lenient, merge
from app.validation import Name, one_of


class DepartmentSchema(BaseModel):
    id: Optional[int] = None
    name: Name
    description: Optional[str] = None
    contact_person_id: Optional[int] = None
    notes: Optional[str] = None
    active: bool = True

    class Config:
        from_attributes = True


DepartmentSchemaPartial = make_partial(DepartmentSchema)
DepartmentSchemaOut = make_lenient(DepartmentSchema)

router = APIRouter()


@router.get("", response_model=List[DepartmentSchemaOut])
def get_departments(
    db: Session = Depends(get_db),
    skip: int = Query(0),
    limit: int = Query(100),
    include_inactive: bool = Query(False),
):
    """Get all departments"""
    # Deleting here archives rather than destroys, so history that points at
    # this record stays intact. Archived rows are hidden unless asked for.
    query = db.query(Department)
    if not include_inactive:
        query = query.filter(Department.active == True)
    return query.order_by(Department.name).offset(skip).limit(limit).all()


@router.post("", response_model=DepartmentSchemaOut)
def create_department(dept: DepartmentSchema, db: Session = Depends(get_db)):
    """Create a new department"""
    db_dept = Department(**dept.dict())
    db.add(db_dept)
    db.commit()
    db.refresh(db_dept)
    return db_dept


@router.get("/{dept_id}", response_model=DepartmentSchemaOut)
def get_department(dept_id: int, db: Session = Depends(get_db)):
    """Get a department"""
    dept = db.query(Department).filter(Department.id == dept_id).first()
    if not dept:
        raise HTTPException(status_code=404, detail="Department not found")
    return dept


@router.put("/{dept_id}", response_model=DepartmentSchemaOut)
def update_department(dept_id: int, dept: DepartmentSchemaPartial, db: Session = Depends(get_db)):
    """Update a department"""
    db_dept = db.query(Department).filter(Department.id == dept_id).first()
    if not db_dept:
        raise HTTPException(status_code=404, detail="Department not found")

    # Only apply the fields the caller actually sent; keep the rest as stored.
    dept = merge(DepartmentSchema, db_dept, dept)
    for key, value in dept.dict().items():
        setattr(db_dept, key, value)
    db_dept.updated_at = datetime.utcnow()
    db.add(db_dept)
    db.commit()
    db.refresh(db_dept)
    return db_dept


@router.delete("/{dept_id}")
def delete_department(dept_id: int, db: Session = Depends(get_db)):
    """Archive: hidden from lists, but kept so linked history survives."""
    db_dept = db.query(Department).filter(Department.id == dept_id).first()
    if not db_dept:
        raise HTTPException(status_code=404, detail="Department not found")
    db_dept.active = False
    db.add(db_dept)
    db.commit()
    return {"message": "Department archived"}
