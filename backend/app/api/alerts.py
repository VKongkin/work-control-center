"""Alerts API routes"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from datetime import datetime, timedelta
from app.database import get_db
from app.models import Task, FollowUp, Issue, Activity
from app.models.tasks import TaskStatus, TaskPriority
from app.models.followups import FollowUpStatus
from pydantic import BaseModel
from typing import List, Optional


class Alert(BaseModel):
    id: str
    type: str
    title: str
    description: str
    severity: str  # critical, high, medium, low
    entity_id: int
    entity_type: str
    created_at: datetime


router = APIRouter()


@router.get("", response_model=List[Alert])
def get_alerts(db: Session = Depends(get_db)):
    """Get all active alerts"""
    alerts = []
    today = datetime.utcnow().date()
    five_days_ago = datetime.utcnow() - timedelta(days=5)
    three_days_ago = datetime.utcnow() - timedelta(days=3)

    # Overdue tasks
    overdue_tasks = db.query(Task).filter(
        Task.due_date < today,
        Task.status != TaskStatus.COMPLETED,
        Task.status != TaskStatus.CANCELLED
    ).all()

    for task in overdue_tasks:
        alerts.append(Alert(
            id=f"overdue_task_{task.id}",
            type="OVERDUE_TASK",
            title=f"Task overdue: {task.title}",
            description=f"Task '{task.title}' was due on {task.due_date.date()}",
            severity="high",
            entity_id=task.id,
            entity_type="task",
            created_at=task.created_at
        ))

    # Follow-ups that need chasing.
    #
    # Three separate things can be wrong, and only the middle one used to raise
    # anything - so a supplier blowing past the date they promised produced no
    # alert at all, which is the single most important signal on this page.
    # A row can trip more than one rule, so the worst one wins and each
    # follow-up appears once.
    open_followups = db.query(FollowUp).filter(
        FollowUp.status.notin_([FollowUpStatus.RECEIVED, FollowUpStatus.CANCELLED])
    ).all()

    followup_alerts: dict[int, Alert] = {}
    rank = {"critical": 0, "high": 1, "medium": 2, "low": 3}

    def raise_followup(fu, kind, title, description, severity):
        existing = followup_alerts.get(fu.id)
        if existing and rank[existing.severity] <= rank[severity]:
            return
        followup_alerts[fu.id] = Alert(
            id=f"followup_{kind.lower()}_{fu.id}",
            type=kind,
            title=title,
            description=description,
            severity=severity,
            entity_id=fu.id,
            entity_type="followup",
            created_at=fu.created_at,
        )

    for fu in open_followups:
        # Someone missed a date they gave you.
        if fu.expected_date and fu.expected_date.date() < today:
            raise_followup(
                fu, "FOLLOW_UP_OVERDUE",
                f"Overdue: {fu.title}",
                f"'{fu.title}' was expected by {fu.expected_date.date()} and has not arrived",
                "high",
            )
        # Or you have already flagged it as late by hand.
        elif fu.status == FollowUpStatus.OVERDUE:
            raise_followup(
                fu, "FOLLOW_UP_OVERDUE",
                f"Overdue: {fu.title}",
                f"'{fu.title}' is marked overdue",
                "high",
            )
        # Or today is the day you planned to chase it.
        if fu.follow_up_date and fu.follow_up_date.date() <= today:
            raise_followup(
                fu, "FOLLOW_UP_DUE",
                f"Follow-up needed: {fu.title}",
                f"'{fu.title}' was due to be chased on {fu.follow_up_date.date()}",
                "medium",
            )

    alerts.extend(followup_alerts.values())

    # Forgotten tasks (no activity for 5+ days)
    forgotten_tasks = db.query(Task).filter(
        Task.last_activity_at < five_days_ago,
        Task.status != TaskStatus.COMPLETED,
        Task.status != TaskStatus.CANCELLED
    ).all()

    for task in forgotten_tasks:
        alerts.append(Alert(
            id=f"forgotten_task_{task.id}",
            type="TASK_STALE",
            title=f"Forgotten task: {task.title}",
            description=f"Task '{task.title}' hasn't been updated in 5+ days",
            severity="medium",
            entity_id=task.id,
            entity_type="task",
            created_at=task.last_activity_at
        ))

    # Critical tasks
    # A cancelled task is not still critical, so it must be excluded here too.
    critical_tasks = db.query(Task).filter(
        Task.priority == TaskPriority.P0_CRITICAL,
        Task.status.notin_([TaskStatus.COMPLETED, TaskStatus.CANCELLED])
    ).all()

    for task in critical_tasks:
        alerts.append(Alert(
            id=f"critical_task_{task.id}",
            type="CRITICAL_TASK",
            title=f"Critical task: {task.title}",
            description=f"Task '{task.title}' is marked as critical",
            severity="critical",
            entity_id=task.id,
            entity_type="task",
            created_at=task.created_at
        ))

    # Blocked tasks for too long
    blocked_long = db.query(Task).filter(
        Task.status == TaskStatus.BLOCKED,
        Task.last_activity_at < three_days_ago
    ).all()

    for task in blocked_long:
        alerts.append(Alert(
            id=f"blocked_long_{task.id}",
            type="TASK_BLOCKED_TOO_LONG",
            title=f"Task blocked too long: {task.title}",
            description=f"Task '{task.title}' has been blocked for 3+ days",
            severity="medium",
            entity_id=task.id,
            entity_type="task",
            created_at=task.last_activity_at
        ))

    return sorted(alerts, key=lambda x: x.created_at, reverse=True)
