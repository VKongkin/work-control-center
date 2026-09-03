"""Tasks API routes"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import or_, and_
from datetime import datetime
from typing import List, Optional
from app.database import get_db
from app.models import Task, Activity
from app.models.tasks import TaskStatus, TaskPriority
from app.models.activity import ActivityAction
from pydantic import BaseModel
from app.partial import make_partial, make_lenient, merge
from app.validation import Name, one_of, PRIORITIES, TASK_STATUSES, Timestamp


class TaskSchema(BaseModel):
    id: Optional[int] = None
    title: Name
    description: Optional[str] = None
    status: str = "INBOX"
    priority: str = "P2_MEDIUM"
    due_date: Timestamp = None
    category_id: Optional[int] = None
    project_id: Optional[int] = None
    system_id: Optional[int] = None
    department_id: Optional[int] = None
    responsible_person_id: Optional[int] = None
    vendor_id: Optional[int] = None
    next_action: Optional[str] = None
    blocked_reason: Optional[str] = None
    notes: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    completed_at: Timestamp = None

    _valid_status = one_of('status', TASK_STATUSES)
    _valid_priority = one_of('priority', PRIORITIES)

    class Config:
        from_attributes = True


TaskSchemaPartial = make_partial(TaskSchema)
TaskSchemaOut = make_lenient(TaskSchema)

router = APIRouter()


@router.get("", response_model=List[TaskSchemaOut])
def get_tasks(
    db: Session = Depends(get_db),
    status: Optional[str] = Query(None),
    priority: Optional[str] = Query(None),
    project_id: Optional[int] = Query(None),
    skip: int = Query(0),
    limit: int = Query(100),
):
    """Get all tasks with optional filtering"""
    query = db.query(Task)

    if status:
        query = query.filter(Task.status == status)
    if priority:
        query = query.filter(Task.priority == priority)
    if project_id:
        query = query.filter(Task.project_id == project_id)

    return query.order_by(Task.created_at.desc()).offset(skip).limit(limit).all()


@router.post("", response_model=TaskSchemaOut)
def create_task(task: TaskSchema, db: Session = Depends(get_db)):
    """Create a new task"""
    db_task = Task(
        title=task.title,
        description=task.description,
        status=task.status,
        priority=task.priority,
        due_date=task.due_date,
        category_id=task.category_id,
        project_id=task.project_id,
        system_id=task.system_id,
        department_id=task.department_id,
        responsible_person_id=task.responsible_person_id,
        vendor_id=task.vendor_id,
        next_action=task.next_action,
        blocked_reason=task.blocked_reason,
        notes=task.notes,
    )
    db.add(db_task)
    db.commit()
    db.refresh(db_task)

    # Log activity
    activity = Activity(
        entity_type="task",
        entity_id=db_task.id,
        action=ActivityAction.CREATED,
        description=f"Task created: {task.title}",
        task_id=db_task.id,
    )
    db.add(activity)
    db.commit()

    return db_task


@router.get("/{task_id}", response_model=TaskSchemaOut)
def get_task(task_id: int, db: Session = Depends(get_db)):
    """Get a specific task"""
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


@router.put("/{task_id}", response_model=TaskSchemaOut)
def update_task(task_id: int, task: TaskSchemaPartial, db: Session = Depends(get_db)):
    """Update a task"""
    db_task = db.query(Task).filter(Task.id == task_id).first()
    if not db_task:
        raise HTTPException(status_code=404, detail="Task not found")

    # Only apply the fields the caller actually sent; keep the rest as stored.
    task = merge(TaskSchema, db_task, task)

    # Track status changes for activity log
    status_changed = db_task.status != task.status
    old_status = db_task.status

    db_task.title = task.title
    db_task.description = task.description
    db_task.status = task.status
    db_task.priority = task.priority
    db_task.due_date = task.due_date
    db_task.category_id = task.category_id
    db_task.project_id = task.project_id
    db_task.system_id = task.system_id
    db_task.department_id = task.department_id
    db_task.responsible_person_id = task.responsible_person_id
    db_task.vendor_id = task.vendor_id
    db_task.next_action = task.next_action
    db_task.blocked_reason = task.blocked_reason
    db_task.notes = task.notes
    db_task.updated_at = datetime.utcnow()

    if task.status == "COMPLETED" and not db_task.completed_at:
        db_task.completed_at = datetime.utcnow()

    db.add(db_task)
    db.commit()

    # Log activity
    if status_changed:
        activity = Activity(
            entity_type="task",
            entity_id=db_task.id,
            action=ActivityAction.STATUS_CHANGED,
            old_value=old_status,
            new_value=task.status,
            task_id=db_task.id,
        )
        db.add(activity)
        db.commit()

    db.refresh(db_task)
    return db_task


@router.delete("/{task_id}")
def delete_task(task_id: int, db: Session = Depends(get_db)):
    """Delete a task (soft delete)"""
    db_task = db.query(Task).filter(Task.id == task_id).first()
    if not db_task:
        raise HTTPException(status_code=404, detail="Task not found")

    db.delete(db_task)
    db.commit()
    return {"message": "Task deleted"}
