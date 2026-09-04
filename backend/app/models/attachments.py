"""Uploaded file.

One table backs every kind of upload - files attached to a task, and the files
that make up a tool - because they are the same problem: bytes with a name and
an owner. Contents live in the database rather than on a volume so that a single
pg_dump captures them; restoring a backup on another machine brings the files.
"""
from sqlalchemy import Column, Integer, String, DateTime, LargeBinary, Index
from datetime import datetime
from app.database import Base

# Per-file ceiling. Large enough for screenshots, specs and the odd PDF; small
# enough that the database stays comfortable to dump and restore.
MAX_FILE_BYTES = 10 * 1024 * 1024


class Attachment(Base):
    __tablename__ = "attachments"

    id = Column(Integer, primary_key=True, index=True)

    # What this file belongs to, e.g. ("task", 12) or ("tool", 3).
    entity_type = Column(String(32), nullable=False)
    entity_id = Column(Integer, nullable=False)

    filename = Column(String(255), nullable=False)
    # Position within an uploaded folder, e.g. "css/style.css". Equal to the
    # filename for a single file. This is what makes relative links inside a
    # tool resolve the way they did on disk.
    path = Column(String(512), nullable=False)

    content_type = Column(String(128), nullable=False, default="application/octet-stream")
    size = Column(Integer, nullable=False, default=0)
    data = Column(LargeBinary, nullable=False)

    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        Index("ix_attachments_owner", "entity_type", "entity_id"),
    )
