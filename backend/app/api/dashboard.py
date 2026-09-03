"""Dashboard API routes"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from datetime import datetime, timedelta
from app.database import get_db
from app.models import Task, FollowUp, Issue, Activity
from app.models.tasks import TaskStatus, TaskPriority
from app.models.followups import FollowUpStatus
from app.models.issues import IssueStatus, IssueSeverity
from pydantic import BaseModel
from typing import Optional


class DashboardStats(BaseModel):
    critical: int
    followups_due: int
    overdue: int
    today: int
    in_progress: int
    blocked: int
    forgotten: int
    total_tasks: int
    completed_today: int


class DashboardData(BaseModel):
    stats: DashboardStats
    recent_tasks: list
    recent_followups: list
    critical_items: list
    overdue_items: list


router = APIRouter()


@router.get("/dashboard", response_model=DashboardData)
def get_dashboard(db: Session = Depends(get_db)):
    """Get dashboard with key metrics"""
    today = datetime.utcnow().date()
    tomorrow = today + timedelta(days=1)
    five_days_ago = datetime.utcnow() - timedelta(days=5)

    # Count critical tasks
    critical_tasks = db.query(Task).filter(
        Task.priority == TaskPriority.P0_CRITICAL,
        Task.status != TaskStatus.COMPLETED,
        Task.status != TaskStatus.CANCELLED
    ).count()

    # Count follow-ups due
    followups_due = db.query(FollowUp).filter(
        FollowUp.follow_up_date <= tomorrow,
        FollowUp.status != FollowUpStatus.RECEIVED
    ).count()

    # Count overdue items
    overdue_tasks = db.query(Task).filter(
        Task.due_date < today,
        Task.status != TaskStatus.COMPLETED,
        Task.status != TaskStatus.CANCELLED
    ).count()

    # Count items due today
    today_tasks = db.query(Task).filter(
        Task.due_date >= today,
        Task.due_date < tomorrow,
        Task.status != TaskStatus.COMPLETED
    ).count()

    # Count in progress
    in_progress = db.query(Task).filter(
        Task.status == TaskStatus.IN_PROGRESS
    ).count()

    # Count blocked
    blocked = db.query(Task).filter(
        Task.status == TaskStatus.BLOCKED
    ).count()

    # Find forgotten items (no activity for 5+ days)
    forgotten = db.query(Task).filter(
        Task.last_activity_at < five_days_ago,
        Task.status != TaskStatus.COMPLETED,
        Task.status != TaskStatus.CANCELLED
    ).count()

    # Count total open tasks
    total_tasks = db.query(Task).filter(
        Task.status != TaskStatus.COMPLETED,
        Task.status != TaskStatus.CANCELLED
    ).count()

    # Count completed today
    completed_today = db.query(Task).filter(
        Task.completed_at >= datetime.combine(today, datetime.min.time()),
        Task.completed_at < datetime.combine(tomorrow, datetime.min.time())
    ).count()

    # Recent tasks
    recent_tasks = db.query(Task).order_by(Task.created_at.desc()).limit(10).all()

    # Recent follow-ups
    recent_followups = db.query(FollowUp).order_by(FollowUp.follow_up_date).limit(10).all()

    # Critical items
    critical_items = db.query(Task).filter(
        Task.priority == TaskPriority.P0_CRITICAL,
        Task.status != TaskStatus.COMPLETED
    ).limit(10).all()

    # Overdue items
    overdue_items = db.query(Task).filter(
        Task.due_date < today,
        Task.status != TaskStatus.COMPLETED
    ).order_by(Task.due_date).limit(10).all()

    stats = DashboardStats(
        critical=critical_tasks,
        followups_due=followups_due,
        overdue=overdue_tasks,
        today=today_tasks,
        in_progress=in_progress,
        blocked=blocked,
        forgotten=forgotten,
        total_tasks=total_tasks,
        completed_today=completed_today
    )

    return DashboardData(
        stats=stats,
        recent_tasks=[{
            "id": t.id,
            "title": t.title,
            "status": t.status,
            "priority": t.priority,
            "due_date": t.due_date
        } for t in recent_tasks],
        recent_followups=[{
            "id": fu.id,
            "title": fu.title,
            "status": fu.status,
            "follow_up_date": fu.follow_up_date
        } for fu in recent_followups],
        critical_items=[{
            "id": c.id,
            "title": c.title,
            "priority": c.priority,
            "status": c.status
        } for c in critical_items],
        overdue_items=[{
            "id": o.id,
            "title": o.title,
            "due_date": o.due_date,
            "priority": o.priority
        } for o in overdue_items]
    )
