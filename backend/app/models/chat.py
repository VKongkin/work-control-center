"""A conversation with the assistant.

Kept in the database rather than in the browser for two reasons. A runbook
question asked at two in the morning is worth finding again the next day, and
the tool calls are an audit trail: this is an assistant that can create tasks
and rewrite runbooks, so what it did has to be inspectable after the fact.
"""
from datetime import datetime

from sqlalchemy import Column, DateTime, Index, Integer, String, Text

from app.database import Base

ROLES = ("user", "assistant", "tool", "system")


class ChatThread(Base):
    __tablename__ = "chat_threads"

    id = Column(Integer, primary_key=True, index=True)
    # Named from the first thing asked, so the list is readable without
    # opening anything.
    title = Column(String(255), nullable=False, default="New conversation")
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id = Column(Integer, primary_key=True, index=True)
    thread_id = Column(Integer, nullable=False)
    role = Column(String(16), nullable=False)
    content = Column(Text, nullable=True)

    # The assistant's requested calls, as the JSON the model produced, and the
    # id a tool result answers. Stored verbatim so a conversation can be
    # replayed to the model exactly as it happened - a paraphrase would change
    # what the model sees on the next turn.
    tool_calls = Column(Text, nullable=True)
    tool_call_id = Column(String(64), nullable=True)
    tool_name = Column(String(64), nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (Index("ix_chat_messages_thread", "thread_id", "id"),)
