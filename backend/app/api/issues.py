"""Issues API routes"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from datetime import datetime
from typing import List, Optional
from app.database import get_db
from app.models import Issue
from pydantic import BaseModel
from app.partial import make_partial, make_lenient, merge
from app.validation import Name, one_of, ISSUE_SEVERITIES, ISSUE_STATUSES, Timestamp


class IssueSchema(BaseModel):
    id: Optional[int] = None
    title: Name
    description: Optional[str] = None
    severity: str = "MEDIUM"
    status: str = "OPEN"
    system_id: Optional[int] = None
    project_id: Optional[int] = None
    responsible_person_id: Optional[int] = None
    vendor_id: Optional[int] = None
    department_id: Optional[int] = None
    detected_at: Timestamp = None
    resolved_at: Timestamp = None
    root_cause: Optional[str] = None
    resolution: Optional[str] = None
    notes: Optional[str] = None

    _valid_severity = one_of('severity', ISSUE_SEVERITIES)
    _valid_status = one_of('status', ISSUE_STATUSES)

    class Config:
        from_attributes = True


IssueSchemaPartial = make_partial(IssueSchema)
IssueSchemaOut = make_lenient(IssueSchema)

router = APIRouter()


@router.get("", response_model=List[IssueSchemaOut])
def get_issues(db: Session = Depends(get_db), status: Optional[str] = Query(None), skip: int = Query(0), limit: int = Query(100)):
    """Get all issues"""
    query = db.query(Issue)
    if status:
        query = query.filter(Issue.status == status)
    return query.order_by(Issue.created_at.desc()).offset(skip).limit(limit).all()


@router.post("", response_model=IssueSchemaOut)
def create_issue(issue: IssueSchema, db: Session = Depends(get_db)):
    """Create a new issue"""
    db_issue = Issue(**issue.dict())
    db.add(db_issue)
    db.commit()
    db.refresh(db_issue)
    return db_issue


@router.get("/{issue_id}", response_model=IssueSchemaOut)
def get_issue(issue_id: int, db: Session = Depends(get_db)):
    """Get an issue"""
    issue = db.query(Issue).filter(Issue.id == issue_id).first()
    if not issue:
        raise HTTPException(status_code=404, detail="Issue not found")
    return issue


@router.put("/{issue_id}", response_model=IssueSchemaOut)
def update_issue(issue_id: int, issue: IssueSchemaPartial, db: Session = Depends(get_db)):
    """Update an issue"""
    db_issue = db.query(Issue).filter(Issue.id == issue_id).first()
    if not db_issue:
        raise HTTPException(status_code=404, detail="Issue not found")

    # Only apply the fields the caller actually sent; keep the rest as stored.
    issue = merge(IssueSchema, db_issue, issue)
    for key, value in issue.dict().items():
        setattr(db_issue, key, value)
    db_issue.updated_at = datetime.utcnow()
    if issue.status == "RESOLVED" and not db_issue.resolved_at:
        db_issue.resolved_at = datetime.utcnow()
    db.add(db_issue)
    db.commit()
    db.refresh(db_issue)
    return db_issue


@router.delete("/{issue_id}")
def delete_issue(issue_id: int, db: Session = Depends(get_db)):
    """Delete an issue"""
    db_issue = db.query(Issue).filter(Issue.id == issue_id).first()
    if not db_issue:
        raise HTTPException(status_code=404, detail="Issue not found")
    db.delete(db_issue)
    db.commit()
    return {"message": "Issue deleted"}
