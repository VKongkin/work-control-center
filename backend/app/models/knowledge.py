"""Things worth writing down: notes, runbooks, install guides.

One table rather than three, because a runbook and a note you took while
learning something differ only in how finished they are, and splitting them
would mean deciding which one a half-written procedure is before you can save
it. `kind` says what it grew into; nothing stops it changing.
"""
from sqlalchemy import Boolean, Column, DateTime, Index, Integer, String, Text
from datetime import datetime
from app.database import Base

KINDS = ("NOTE", "RUNBOOK", "GUIDE", "REFERENCE")
STATUSES = ("DRAFT", "PUBLISHED", "ARCHIVED")


class KnowledgeArticle(Base):
    __tablename__ = "knowledge_articles"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(255), nullable=False)
    kind = Column(String(16), nullable=False, default="NOTE")
    status = Column(String(16), nullable=False, default="DRAFT")

    summary = Column(String(500), nullable=True)
    body = Column(Text, nullable=True)  # markdown

    # Comma-separated, kept simple on purpose: a tag table would mean managing
    # tags before writing anything down, which is how notes stop being written.
    tags = Column(String(500), nullable=True)

    # What it is about. All optional - a note is worth keeping even when you do
    # not yet know which system it belongs to.
    system_id = Column(Integer, nullable=True)
    project_id = Column(Integer, nullable=True)
    department_id = Column(Integer, nullable=True)
    vendor_id = Column(Integer, nullable=True)
    category_id = Column(Integer, nullable=True)
    server_id = Column(Integer, nullable=True)

    # For a runbook: which environment it applies to, and when it was last
    # proven to work. A runbook nobody has run in two years is a rumour.
    environment = Column(String(16), nullable=True)  # DC | DR | UAT | DEV | ALL
    last_verified_at = Column(DateTime, nullable=True)

    pinned = Column(Boolean, default=False)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        Index("ix_knowledge_kind", "kind", "status"),
    )
