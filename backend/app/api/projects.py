"""Projects API routes"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from datetime import datetime
from typing import List, Optional
from app.database import get_db
from app.models import Project
from pydantic import BaseModel
from app.partial import make_partial, make_lenient, merge
from app.validation import Name, one_of, PRIORITIES, PROJECT_STATUSES, Timestamp


class ProjectSchema(BaseModel):
    id: Optional[int] = None
    name: Name
    description: Optional[str] = None
    status: str = "PLANNED"
    priority: str = "P2_MEDIUM"
    start_date: Timestamp = None
    target_date: Timestamp = None
    owner: Optional[str] = None
    notes: Optional[str] = None

    _valid_status = one_of('status', PROJECT_STATUSES)
    _valid_priority = one_of('priority', PRIORITIES)

    class Config:
        from_attributes = True


ProjectSchemaPartial = make_partial(ProjectSchema)
ProjectSchemaOut = make_lenient(ProjectSchema)

router = APIRouter()


@router.get("", response_model=List[ProjectSchemaOut])
def get_projects(
    db: Session = Depends(get_db),
    status: Optional[str] = Query(None),
    skip: int = Query(0),
    limit: int = Query(100),
):
    """Get all projects"""
    query = db.query(Project)
    if status:
        query = query.filter(Project.status == status)
    return query.order_by(Project.created_at.desc()).offset(skip).limit(limit).all()


@router.post("", response_model=ProjectSchemaOut)
def create_project(project: ProjectSchema, db: Session = Depends(get_db)):
    """Create a new project"""
    db_project = Project(**project.dict())
    db.add(db_project)
    db.commit()
    db.refresh(db_project)
    return db_project


@router.get("/{project_id}", response_model=ProjectSchemaOut)
def get_project(project_id: int, db: Session = Depends(get_db)):
    """Get a project"""
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


@router.put("/{project_id}", response_model=ProjectSchemaOut)
def update_project(project_id: int, project: ProjectSchemaPartial, db: Session = Depends(get_db)):
    """Update a project"""
    db_project = db.query(Project).filter(Project.id == project_id).first()
    if not db_project:
        raise HTTPException(status_code=404, detail="Project not found")

    # Only apply the fields the caller actually sent; keep the rest as stored.
    project = merge(ProjectSchema, db_project, project)
    
    for key, value in project.dict().items():
        setattr(db_project, key, value)
    db_project.updated_at = datetime.utcnow()
    db.add(db_project)
    db.commit()
    db.refresh(db_project)
    return db_project


@router.delete("/{project_id}")
def delete_project(project_id: int, db: Session = Depends(get_db)):
    """Delete a project"""
    db_project = db.query(Project).filter(Project.id == project_id).first()
    if not db_project:
        raise HTTPException(status_code=404, detail="Project not found")
    db.delete(db_project)
    db.commit()
    return {"message": "Project deleted"}
