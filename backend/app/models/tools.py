"""A small web tool the user has built and uploaded.

A tool is a folder of files - index.html plus whatever CSS, JS and images it
needs - stored as attachments and served back so the whole thing runs in the
browser exactly as it did on disk.
"""
from sqlalchemy import Column, Integer, String, Text, DateTime, Boolean
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

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
