"""A small web tool the user has built and uploaded.

A tool is a folder of files - index.html plus whatever CSS, JS and images it
needs - stored as attachments and served back so the whole thing runs in the
browser exactly as it did on disk.

Two things sit alongside it. Where it came from, so a tool imported from a
repository can be pulled again without retyping the link; and every version it
has ever had, so "it worked yesterday" is a question with an answer.
"""
from sqlalchemy import (
    Column, Integer, String, Text, DateTime, Boolean, LargeBinary, Index,
)
from datetime import datetime
from app.database import Base


class Tool(Base):
    __tablename__ = "tools"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False, unique=True)
    description = Column(Text, nullable=True)

    # Which uploaded file opens when the tool is launched.
    entry_path = Column(String(512), nullable=False, default="index.html")

    # Pinned tools get a shortcut in the sidebar.
    pinned = Column(Boolean, default=False)

    # Where this came from, when it came from a repository. Kept so that
    # pulling again is one click rather than finding the link a second time,
    # and so the tool can say out loud which branch it is running.
    source_url = Column(String(1024), nullable=True)
    source_ref = Column(String(255), nullable=True)
    source_subdir = Column(String(512), nullable=True)
    imported_at = Column(DateTime, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class ToolBlob(Base):
    """One file's bytes, stored once however many versions contain it.

    Tools are pulled repeatedly and change a line at a time, so versioning them
    by copying every file each time would store the same unchanged image forty
    times over. Addressing content by its SHA-256 means a version costs only
    what actually changed - which is what makes keeping every version
    affordable enough to do by default.
    """
    __tablename__ = "tool_blobs"

    sha256 = Column(String(64), primary_key=True)
    size = Column(Integer, nullable=False, default=0)
    data = Column(LargeBinary, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class ToolVersion(Base):
    """What a tool looked like at one moment, and how it got that way."""
    __tablename__ = "tool_versions"

    id = Column(Integer, primary_key=True, index=True)
    tool_id = Column(Integer, nullable=False)

    # 1, 2, 3 within this tool. What a person refers to; the id is plumbing.
    number = Column(Integer, nullable=False, default=1)

    # "import" | "upload" | "restore" - how this version came about.
    origin = Column(String(16), nullable=False, default="upload")
    note = Column(Text, nullable=True)

    # Where it came from, frozen at the time. The tool's own source_url can
    # change; what this version was built from cannot.
    source_url = Column(String(1024), nullable=True)
    source_ref = Column(String(255), nullable=True)
    entry_path = Column(String(512), nullable=True)

    # [{"path": ..., "sha256": ..., "size": ...}], as JSON text. A table of
    # rows would be tidier in the abstract and worse here: this list is only
    # ever read whole, written whole, and compared against another one.
    manifest = Column(Text, nullable=False, default="[]")

    file_count = Column(Integer, nullable=False, default=0)
    total_bytes = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        Index("ix_tool_versions_tool", "tool_id", "number"),
    )
