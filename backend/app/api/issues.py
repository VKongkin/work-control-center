"""Issues API routes"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import case
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

# Severity is a string column, so "worst first" has to be spelled out rather
# than left to alphabetical order, which would put CRITICAL after... nothing,
# but HIGH before LOW before MEDIUM.
SEVERITY_ORDER = case(
    {"CRITICAL": 0, "HIGH": 1, "MEDIUM": 2, "LOW": 3},
    value=Issue.severity,
    else_=9,
)


@router.get("", response_model=List[IssueSchemaOut])
def get_issues(
    db: Session = Depends(get_db),
    status: Optional[str] = Query(None),
    severity: Optional[str] = Query(None),
    system_id: Optional[int] = Query(None),
    skip: int = Query(0),
    limit: int = Query(100),
):
    """Get all issues, narrowed by the things the page actually filters on."""
    query = db.query(Issue)
    if status:
        query = query.filter(Issue.status == status)
    if severity:
        query = query.filter(Issue.severity == severity)
    if system_id:
        query = query.filter(Issue.system_id == system_id)
    # Worst first, then newest. The page groups by severity anyway, but an
    # unfiltered read of this endpoint should still lead with what matters.
    return (
        query.order_by(SEVERITY_ORDER, Issue.created_at.desc())
        .offset(skip).limit(limit).all()
    )


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
