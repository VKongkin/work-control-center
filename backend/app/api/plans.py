"""The day plan: blocks of time, what they are for, and whether they add up.

Separate from the diary on purpose. `/api/meetings` is what you have agreed to
attend; this is what you intend to do with the rest. They meet in exactly one
place - `seed` reads the day's meetings so a plan is built *around* them rather
than on top of them, which is the only way the two stay honest about the same
eight hours.

Everything derived is derived here rather than stored: the breakdown by theme,
the overlaps, the time left unplanned. A stored total is a total that goes
wrong the moment somebody drags a block, and these are cheap to compute.
"""
from datetime import date, datetime, timedelta
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import DayPlan, Meeting, PlanBlock, Task
from app.models.plans import DEFAULT_END, DEFAULT_START, KINDS
from app.models.tasks import TaskStatus

router = APIRouter()

# Kinds that are not work. Counted separately in the breakdown, because a day
# that is 20% breaks is a sustainable day and a day that is 20% "miscellaneous"
# is a day nobody can explain.
REST = {"BREAK", "LUNCH"}


# ------------------------------------------------------------------- schemas

def _hhmm(minute: int) -> str:
    return f"{minute // 60:02d}:{minute % 60:02d}"


def _minute(value) -> int:
    """Accept 525, "08:45" or "8:45". People type a clock, machines send a number."""
    if isinstance(value, int):
        return value
    text = str(value).strip()
    if ":" in text:
        h, _, m = text.partition(":")
        try:
            return int(h) * 60 + int(m)
        except ValueError:
            raise HTTPException(status_code=422, detail=f"{value!r} is not a time of day.")
    try:
        return int(text)
    except ValueError:
        raise HTTPException(status_code=422, detail=f"{value!r} is not a time of day.")


class BlockIn(BaseModel):
    start: object = Field(..., description='Minutes since midnight, or "08:30"')
    end: object = Field(..., description='Minutes since midnight, or "10:00"')
    kind: str = "WORK"
    title: str
    activity: Optional[str] = None
    theme: Optional[str] = None
    task_id: Optional[int] = None
    meeting_id: Optional[int] = None
    done: bool = False


class BlockPatch(BaseModel):
    start: Optional[object] = None
    end: Optional[object] = None
    kind: Optional[str] = None
    title: Optional[str] = None
    activity: Optional[str] = None
    theme: Optional[str] = None
    task_id: Optional[int] = None
    done: Optional[bool] = None


class PlanIn(BaseModel):
    plan_date: date
    title: Optional[str] = None
    notes: Optional[str] = None
    day_start: object = DEFAULT_START
    day_end: object = DEFAULT_END
    blocks: Optional[List[BlockIn]] = None


class PlanPatch(BaseModel):
    title: Optional[str] = None
    notes: Optional[str] = None
    day_start: Optional[object] = None
    day_end: Optional[object] = None


# ------------------------------------------------------------------- helpers

def _check_window(start: int, end: int, what: str = "block") -> None:
    if not (0 <= start < 24 * 60) or not (0 < end <= 24 * 60):
        raise HTTPException(status_code=422,
                            detail=f"A {what} has to sit inside the day, 00:00 to 24:00.")
    if end <= start:
        raise HTTPException(
            status_code=422,
            detail=f"{_hhmm(start)}–{_hhmm(end)} ends before it starts.")


def _plan(db: Session, plan_id: int) -> DayPlan:
    row = db.query(DayPlan).filter(DayPlan.id == plan_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="No plan for that day")
    return row


def _blocks(db: Session, plan_id: int) -> List[PlanBlock]:
    return (db.query(PlanBlock)
            .filter(PlanBlock.plan_id == plan_id)
            .order_by(PlanBlock.start_minute, PlanBlock.id).all())


def overlaps(blocks: List[PlanBlock]) -> List[Dict]:
    """Pairs of blocks claiming the same minutes.

    Not refused on the way in. Two things really can be booked over each other
    while a day is being rearranged, and refusing the edit would mean the only
    way to move a block is to delete it first. Reported instead, so the page
    can say so and the person can decide.
    """
    out = []
    ordered = sorted(blocks, key=lambda b: (b.start_minute, b.id))
    for i, a in enumerate(ordered):
        for b in ordered[i + 1:]:
            if b.start_minute >= a.end_minute:
                break
            out.append({
                "a": {"id": a.id, "title": a.title,
                      "from": _hhmm(a.start_minute), "to": _hhmm(a.end_minute)},
                "b": {"id": b.id, "title": b.title,
                      "from": _hhmm(b.start_minute), "to": _hhmm(b.end_minute)},
                "minutes": min(a.end_minute, b.end_minute) - b.start_minute,
            })
    return out


def gaps(plan: DayPlan, blocks: List[PlanBlock]) -> List[Dict]:
    """Stretches of the working day nothing is planned for.

    The useful question is not "is the plan full" - it is "where did the two
    unaccounted hours go". Gaps under five minutes are not reported: the
    difference between a plan ending at 16:58 and one ending at 17:00 is not
    worth a warning.
    """
    out, cursor = [], plan.day_start
    for b in sorted(blocks, key=lambda b: b.start_minute):
        if b.start_minute > cursor and b.start_minute - cursor >= 5:
            out.append({"from": _hhmm(cursor), "to": _hhmm(b.start_minute),
                        "minutes": b.start_minute - cursor})
        cursor = max(cursor, b.end_minute)
    if plan.day_end > cursor and plan.day_end - cursor >= 5:
        out.append({"from": _hhmm(cursor), "to": _hhmm(plan.day_end),
                    "minutes": plan.day_end - cursor})
    return out


def breakdown(blocks: List[PlanBlock]) -> List[Dict]:
    """Where the hours go, biggest first.

    Grouped by theme, falling back to the block's own title - so a plan where
    nobody filled in a theme still produces a useful answer rather than one
    bucket called "(none)".
    """
    totals: Dict[str, Dict] = {}
    for b in blocks:
        if b.kind in REST:
            continue
        key = (b.theme or b.title or "Unthemed").strip()
        slot = totals.setdefault(key, {"theme": key, "minutes": 0, "blocks": 0, "done": 0})
        slot["minutes"] += b.end_minute - b.start_minute
        slot["blocks"] += 1
        slot["done"] += 1 if b.done else 0
    rows = sorted(totals.values(), key=lambda r: (-r["minutes"], r["theme"]))
    for r in rows:
        r["hours"] = round(r["minutes"] / 60, 2)
    return rows


def _block_out(b: PlanBlock) -> Dict:
    return {
        "id": b.id, "plan_id": b.plan_id,
        "start": b.start_minute, "end": b.end_minute,
        "from": _hhmm(b.start_minute), "to": _hhmm(b.end_minute),
        "minutes": b.end_minute - b.start_minute,
        "kind": b.kind, "title": b.title, "activity": b.activity,
        "theme": b.theme, "task_id": b.task_id, "meeting_id": b.meeting_id,
        "done": bool(b.done),
    }


def _plan_out(db: Session, plan: DayPlan) -> Dict:
    rows = _blocks(db, plan.id)
    worked = sum(b.end_minute - b.start_minute for b in rows if b.kind not in REST)
    rested = sum(b.end_minute - b.start_minute for b in rows if b.kind in REST)
    return {
        "id": plan.id,
        "plan_date": plan.plan_date,
        "title": plan.title,
        "notes": plan.notes,
        "day_start": plan.day_start, "day_end": plan.day_end,
        "from": _hhmm(plan.day_start), "to": _hhmm(plan.day_end),
        "day_minutes": plan.day_end - plan.day_start,
        "planned_minutes": worked + rested,
        "work_minutes": worked,
        "rest_minutes": rested,
        "unplanned_minutes": sum(g["minutes"] for g in gaps(plan, rows)),
        "done_minutes": sum(b.end_minute - b.start_minute
                            for b in rows if b.done and b.kind not in REST),
        "blocks": [_block_out(b) for b in rows],
        "breakdown": breakdown(rows),
        "overlaps": overlaps(rows),
        "gaps": gaps(plan, rows),
        "created_at": plan.created_at, "updated_at": plan.updated_at,
    }


# -------------------------------------------------------------------- routes

@router.get("")
def list_plans(db: Session = Depends(get_db), limit: int = Query(30),
               since: Optional[date] = Query(None)):
    """Recent days, newest first - a short history of how time was meant to go."""
    q = db.query(DayPlan)
    if since:
        q = q.filter(DayPlan.plan_date >= since)
    rows = q.order_by(DayPlan.plan_date.desc()).limit(min(limit, 200)).all()
    return [_plan_out(db, p) for p in rows]


@router.get("/day/{on}")
def plan_for_day(on: date, db: Session = Depends(get_db)):
    """The plan for a date, or a 404 saying there is not one yet."""
    row = db.query(DayPlan).filter(DayPlan.plan_date == on).first()
    if not row:
        raise HTTPException(status_code=404,
                            detail=f"No plan for {on.isoformat()} yet.")
    return _plan_out(db, row)


@router.post("")
def create_plan(body: PlanIn, db: Session = Depends(get_db)):
    existing = db.query(DayPlan).filter(DayPlan.plan_date == body.plan_date).first()
    if existing:
        raise HTTPException(
            status_code=409,
            detail=f"{body.plan_date.isoformat()} already has a plan. Open it rather "
                   f"than starting a second one for the same day.")

    start, end = _minute(body.day_start), _minute(body.day_end)
    _check_window(start, end, "working day")

    plan = DayPlan(plan_date=body.plan_date, title=body.title, notes=body.notes,
                   day_start=start, day_end=end)
    db.add(plan)
    db.flush()
    for b in (body.blocks or []):
        db.add(_new_block(plan.id, b))
    db.commit()
    db.refresh(plan)
    return _plan_out(db, plan)


def _new_block(plan_id: int, b: BlockIn) -> PlanBlock:
    start, end = _minute(b.start), _minute(b.end)
    _check_window(start, end)
    kind = (b.kind or "WORK").upper()
    if kind not in KINDS:
        raise HTTPException(status_code=422,
                            detail=f"{b.kind} is not a kind of block. One of: {', '.join(KINDS)}.")
    return PlanBlock(plan_id=plan_id, start_minute=start, end_minute=end, kind=kind,
                     title=b.title, activity=b.activity, theme=b.theme,
                     task_id=b.task_id, meeting_id=b.meeting_id, done=bool(b.done))


@router.patch("/{plan_id}")
def update_plan(plan_id: int, body: PlanPatch, db: Session = Depends(get_db)):
    plan = _plan(db, plan_id)
    if body.title is not None:
        plan.title = body.title
    if body.notes is not None:
        plan.notes = body.notes
    if body.day_start is not None:
        plan.day_start = _minute(body.day_start)
    if body.day_end is not None:
        plan.day_end = _minute(body.day_end)
    _check_window(plan.day_start, plan.day_end, "working day")
    plan.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(plan)
    return _plan_out(db, plan)


@router.delete("/{plan_id}")
def delete_plan(plan_id: int, db: Session = Depends(get_db)):
    plan = _plan(db, plan_id)
    db.query(PlanBlock).filter(PlanBlock.plan_id == plan_id).delete(
        synchronize_session=False)
    db.delete(plan)
    db.commit()
    return {"message": "Plan deleted"}


# -------------------------------------------------------------------- blocks

@router.post("/{plan_id}/blocks")
def add_block(plan_id: int, body: BlockIn, db: Session = Depends(get_db)):
    plan = _plan(db, plan_id)
    if body.task_id and not db.query(Task.id).filter(Task.id == body.task_id).first():
        raise HTTPException(status_code=422, detail="That task does not exist.")
    db.add(_new_block(plan.id, body))
    plan.updated_at = datetime.utcnow()
    db.commit()
    return _plan_out(db, plan)


@router.patch("/blocks/{block_id}")
def update_block(block_id: int, body: BlockPatch, db: Session = Depends(get_db)):
    """Edit one block, and finish its task when it is ticked.

    A block made from a task is a promise about that task. Ticking it here and
    leaving the task open would mean two lists disagreeing by the end of the
    week, and the one people stop trusting is always the planner.
    """
    row = db.query(PlanBlock).filter(PlanBlock.id == block_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Block not found")

    if body.start is not None:
        row.start_minute = _minute(body.start)
    if body.end is not None:
        row.end_minute = _minute(body.end)
    _check_window(row.start_minute, row.end_minute)

    if body.kind is not None:
        kind = body.kind.upper()
        if kind not in KINDS:
            raise HTTPException(status_code=422,
                                detail=f"{body.kind} is not a kind of block.")
        row.kind = kind
    for field in ("title", "activity", "theme"):
        value = getattr(body, field)
        if value is not None:
            setattr(row, field, value)
    if body.task_id is not None:
        row.task_id = body.task_id or None

    finished = None
    if body.done is not None:
        row.done = bool(body.done)
        if row.done and row.task_id:
            task = db.query(Task).filter(Task.id == row.task_id).first()
            if task and task.status != TaskStatus.COMPLETED:
                task.status = TaskStatus.COMPLETED
                task.completed_at = datetime.utcnow()
                finished = {"id": task.id, "title": task.title}

    row.updated_at = datetime.utcnow()
    db.commit()
    plan = _plan(db, row.plan_id)
    out = _plan_out(db, plan)
    out["completed_task"] = finished
    return out


@router.delete("/blocks/{block_id}")
def delete_block(block_id: int, db: Session = Depends(get_db)):
    row = db.query(PlanBlock).filter(PlanBlock.id == block_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Block not found")
    plan_id = row.plan_id
    db.delete(row)
    db.commit()
    return _plan_out(db, _plan(db, plan_id))


# ----------------------------------------------------------- building a day

@router.post("/seed")
def seed(on: date = Query(..., description="The day to start"),
         day_start: object = Query(DEFAULT_START),
         day_end: object = Query(DEFAULT_END),
         include_meetings: bool = Query(True),
         db: Session = Depends(get_db)):
    """Start a day with the things already decided in it.

    A blank timetable is the wrong starting point, because the day is not
    blank: there are meetings in the diary and a lunch hour that happens
    whether it is written down or not. Seeding puts those in first, so what is
    left on screen is the time genuinely available - which is the number worth
    planning against.
    """
    if db.query(DayPlan).filter(DayPlan.plan_date == on).first():
        raise HTTPException(
            status_code=409,
            detail=f"{on.isoformat()} already has a plan. Delete it first if you "
                   f"want to start over.")

    start, end = _minute(day_start), _minute(day_end)
    _check_window(start, end, "working day")

    plan = DayPlan(plan_date=on, day_start=start, day_end=end)
    db.add(plan)
    db.flush()

    made = []
    if include_meetings:
        begin = datetime.combine(on, datetime.min.time())
        rows = (db.query(Meeting)
                .filter(Meeting.meeting_date >= begin,
                        Meeting.meeting_date < begin + timedelta(days=1))
                .order_by(Meeting.meeting_date).all())
        for m in rows:
            if getattr(m, "all_day", False):
                continue                      # a whole-day entry is not a slot
            m_start = m.meeting_date.hour * 60 + m.meeting_date.minute
            m_end = (m.ends_at.hour * 60 + m.ends_at.minute) if m.ends_at else m_start + 30
            if m_end <= m_start:
                m_end = m_start + 30          # a zero-length meeting still takes a slot
            block = PlanBlock(plan_id=plan.id, start_minute=m_start, end_minute=m_end,
                              kind="MEETING", title=m.title, theme="Meetings",
                              activity=m.location or None, meeting_id=m.id)
            db.add(block)
            made.append(block)

    # Lunch, unless a meeting already owns that hour - in which case the person
    # has a worse problem than an unwritten lunch break.
    lunch_start, lunch_end = 12 * 60, 13 * 60
    if start <= lunch_start and end >= lunch_end and not any(
            b.start_minute < lunch_end and lunch_start < b.end_minute for b in made):
        db.add(PlanBlock(plan_id=plan.id, start_minute=lunch_start, end_minute=lunch_end,
                         kind="LUNCH", title="Lunch"))

    db.commit()
    db.refresh(plan)
    return _plan_out(db, plan)


@router.post("/{plan_id}/copy")
def copy_plan(plan_id: int, to: date = Query(...), db: Session = Depends(get_db)):
    """Copy a day's shape onto another date.

    Most days have the same skeleton - the same start, the same breaks, the
    same standing commitments - and rebuilding it every morning is the reason
    planners get abandoned by Wednesday. Ticks do not come along: a copy is a
    plan for a day that has not happened.
    """
    source = _plan(db, plan_id)
    if db.query(DayPlan).filter(DayPlan.plan_date == to).first():
        raise HTTPException(status_code=409,
                            detail=f"{to.isoformat()} already has a plan.")

    fresh = DayPlan(plan_date=to, title=source.title, notes=source.notes,
                    day_start=source.day_start, day_end=source.day_end)
    db.add(fresh)
    db.flush()
    for b in _blocks(db, source.id):
        db.add(PlanBlock(plan_id=fresh.id, start_minute=b.start_minute,
                         end_minute=b.end_minute, kind=b.kind, title=b.title,
                         activity=b.activity, theme=b.theme,
                         # The task and the meeting belonged to that day.
                         task_id=None, meeting_id=None, done=False))
    db.commit()
    db.refresh(fresh)
    return _plan_out(db, fresh)


@router.get("/{plan_id}/export")
def export(plan_id: int, db: Session = Depends(get_db)):
    """The plan as text you can paste somewhere else.

    Two shapes, because they answer different questions: the timetable is for
    reading back at the end of the day, and the checklist is what goes into
    Outlook or a status note. Both are plain text, which is the only format
    that survives being pasted into a chat window.
    """
    plan = _plan(db, plan_id)
    rows = _blocks(db, plan.id)

    timetable = [f"Plan for {plan.plan_date.isoformat()}"
                 f"{' — ' + plan.title if plan.title else ''}", ""]
    for b in rows:
        line = f"{_hhmm(b.start_minute)}–{_hhmm(b.end_minute)}  {b.title}"
        timetable.append(line)
        if b.activity:
            timetable.append(f"{' ' * 14}{b.activity}")

    summary = ["", "Where the time goes"]
    for r in breakdown(rows):
        summary.append(f"  {r['theme']} — {r['hours']}h")

    checklist = [f"{'[x]' if b.done else '[ ]'} {b.title}"
                 for b in rows if b.kind not in REST]

    return {
        "timetable": "\n".join(timetable + summary),
        "checklist": "\n".join(checklist),
        "markdown": "\n".join(
            [f"# {plan.plan_date.isoformat()}", "", "| Time | Task | Activity |",
             "|---|---|---|"]
            + [f"| {_hhmm(b.start_minute)}–{_hhmm(b.end_minute)} | {b.title} | "
               f"{(b.activity or '').replace('|', '/')} |" for b in rows]),
    }


@router.get("/suggest/tasks")
def suggest(on: Optional[date] = Query(None), limit: int = Query(12),
            db: Session = Depends(get_db)):
    """Tasks worth putting in a day, most pressing first.

    Overdue before due-today before the rest, and priority inside that. The
    planner should not make you go and look up what is urgent - that is the
    part of the morning it exists to remove.
    """
    today = on or date.today()
    live = [TaskStatus.INBOX, TaskStatus.PENDING, TaskStatus.IN_PROGRESS,
            TaskStatus.BLOCKED]
    rows = (db.query(Task).filter(Task.status.in_(live)).limit(500).all())

    order = {"P0_CRITICAL": 0, "P1_HIGH": 1, "P2_MEDIUM": 2, "P3_LOW": 3}

    def rank(t: Task):
        due = t.due_date.date() if t.due_date else None
        when = 0 if (due and due < today) else 1 if (due and due == today) else 2
        return (when, order.get(getattr(t.priority, "value", t.priority), 9),
                due or date.max)

    return [{
        "id": t.id, "title": t.title,
        "priority": getattr(t.priority, "value", t.priority),
        "status": getattr(t.status, "value", t.status),
        "due_date": t.due_date.date() if t.due_date else None,
        "overdue": bool(t.due_date and t.due_date.date() < today),
        "next_action": t.next_action,
    } for t in sorted(rows, key=rank)[:max(1, min(limit, 50))]]
