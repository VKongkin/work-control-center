"""Search API routes"""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import or_
from app.database import get_db
from app.models import Task, FollowUp, Issue, Project, Person, Department, Vendor, System, Meeting
from pydantic import BaseModel
from typing import List, Optional


class SearchResult(BaseModel):
    id: int
    type: str
    title: str
    description: Optional[str] = None
    priority: Optional[str] = None
    status: Optional[str] = None


router = APIRouter()


@router.get("", response_model=List[SearchResult])
def search(q: str = Query(..., min_length=1), db: Session = Depends(get_db), limit: int = Query(50)):
    """Global search across all entities"""
    results = []
    search_term = f"%{q}%"

    # Search tasks
    tasks = db.query(Task).filter(
        or_(
            Task.title.ilike(search_term),
            Task.description.ilike(search_term),
            Task.notes.ilike(search_term)
        )
    ).limit(limit).all()

    for task in tasks:
        results.append(SearchResult(
            id=task.id,
            type="task",
            title=task.title,
            description=task.description,
            priority=task.priority,
            status=task.status
        ))

    # Search follow-ups
    followups = db.query(FollowUp).filter(
        or_(
            FollowUp.title.ilike(search_term),
            FollowUp.description.ilike(search_term),
            FollowUp.notes.ilike(search_term)
        )
    ).limit(limit).all()

    for fu in followups:
        results.append(SearchResult(
            id=fu.id,
            type="followup",
            title=fu.title,
            description=fu.description,
            status=fu.status
        ))

    # Search issues
    issues = db.query(Issue).filter(
        or_(
            Issue.title.ilike(search_term),
            Issue.description.ilike(search_term)
        )
    ).limit(limit).all()

    for issue in issues:
        results.append(SearchResult(
            id=issue.id,
            type="issue",
            title=issue.title,
            description=issue.description,
            status=issue.status
        ))

    # Search projects
    projects = db.query(Project).filter(
        or_(
            Project.name.ilike(search_term),
            Project.description.ilike(search_term)
        )
    ).limit(limit).all()

    for project in projects:
        results.append(SearchResult(
            id=project.id,
            type="project",
            title=project.name,
            description=project.description,
            status=project.status
        ))

    # Search people
    people = db.query(Person).filter(
        or_(
            Person.name.ilike(search_term),
            Person.email.ilike(search_term)
        )
    ).limit(limit).all()

    for person in people:
        results.append(SearchResult(
            id=person.id,
            type="person",
            title=person.name
        ))

    return results[:limit]
