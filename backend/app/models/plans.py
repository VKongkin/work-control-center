"""A plan for one day: where the hours actually go.

The diary says what you have agreed to attend. It does not say what you
intend to *do*, and those are different questions - a day with two meetings in
it still has six hours that get spent on something, and by six o'clock nobody
can say on what. So this is deliberately not the calendar. It is the other
half: eight hours divided into named blocks, each with a theme, so the day has
a shape before it starts and an account of itself afterwards.

  WHY MINUTES. A block is stored as two integers, minutes since midnight. A
  plan is arithmetic - does it add up to the working day, do two blocks
  overlap, how much went to the go-live - and doing that arithmetic on
  timestamps means dragging a timezone through every comparison for no gain.
  The plan's date carries the day; the blocks carry the shape of it. A plan
  made for Tuesday reads the same in Phnom Penh and in London, which is right,
  because it is a plan about somebody's Tuesday, not an instant in time.
"""
from sqlalchemy import Column, Integer, String, Text, Date, DateTime, Boolean, Index
from datetime import datetime
from app.database import Base

# What a block is. A plan made only of WORK is a plan that will not survive
# contact with the afternoon, so the breaks are first-class rather than
# something you leave gaps for.
KINDS = ("WORK", "BREAK", "LUNCH", "BUFFER", "MEETING")

# The working day, when nobody has said otherwise.
DEFAULT_START = 8 * 60          # 08:00
DEFAULT_END = 17 * 60           # 17:00


class DayPlan(Base):
    """One day's intentions. At most one per date - a second would just be a
    disagreement with the first about the same eight hours."""
    __tablename__ = "day_plans"

    id = Column(Integer, primary_key=True, index=True)
    plan_date = Column(Date, nullable=False, unique=True, index=True)

    title = Column(String(255), nullable=True)
    notes = Column(Text, nullable=True)

    # The window the day is measured against, so "two hours unplanned" means
    # something to someone who starts at seven.
    day_start = Column(Integer, nullable=False, default=DEFAULT_START)
    day_end = Column(Integer, nullable=False, default=DEFAULT_END)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class PlanBlock(Base):
    """One stretch of the day, and what it is for."""
    __tablename__ = "plan_blocks"

    id = Column(Integer, primary_key=True, index=True)
    plan_id = Column(Integer, nullable=False)

    # Minutes since midnight. end is exclusive, so 09:00-10:30 and 10:30-11:00
    # sit next to each other rather than fighting over 10:30.
    start_minute = Column(Integer, nullable=False, default=DEFAULT_START)
    end_minute = Column(Integer, nullable=False, default=DEFAULT_START + 60)

    kind = Column(String(16), nullable=False, default="WORK")
    title = Column(String(255), nullable=False)
    # The long version: what you will actually be doing in there. The thing
    # that makes a plan reviewable rather than a list of nouns.
    activity = Column(Text, nullable=True)

    # Free text, and free text on purpose. "VDA go-live" is not a project in
    # the Projects sense and forcing it to be one would mean creating a record
    # before you are allowed to plan an hour. The breakdown groups on it.
    theme = Column(String(120), nullable=True)

    # When this block is time set aside for a task that already exists. Ticking
    # the block can then finish the task, rather than leaving two places to
    # keep in step.
    task_id = Column(Integer, nullable=True)
    # When it mirrors something already in the diary.
    meeting_id = Column(Integer, nullable=True)

    done = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        Index("ix_plan_blocks_plan", "plan_id", "start_minute"),
    )
