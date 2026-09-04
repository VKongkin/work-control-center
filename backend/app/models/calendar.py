"""A connected calendar and how to reach it.

Two providers, one sync engine. Microsoft Graph gives richer data and near-live
refresh but needs an app registration in the company tenant; a published ICS URL
needs no registration at all, which matters when IT will not approve one.
"""
from sqlalchemy import Column, Integer, String, Text, DateTime, Boolean
from datetime import datetime
from app.database import Base

PROVIDERS = ("microsoft", "ics")


class CalendarConnection(Base):
    __tablename__ = "calendar_connections"

    id = Column(Integer, primary_key=True, index=True)
    provider = Column(String(16), nullable=False)
    display_name = Column(String(255), nullable=False)

    # Microsoft: which tenant and app registration to authenticate against.
    tenant_id = Column(String(128), nullable=True)
    client_id = Column(String(128), nullable=True)
    # The signed-in mailbox, filled in after a successful sign-in.
    account = Column(String(255), nullable=True)
    # Encrypted at rest - see app.services.secrets.
    refresh_token = Column(Text, nullable=True)

    # ICS: the published calendar URL.
    ics_url = Column(Text, nullable=True)

    # The zone whose wall clock these meetings should read in. Providers hand
    # over UTC; a 10:30 meeting in Phnom Penh arrives as 03:30, and stored raw
    # it would show as 03:30. IANA name, e.g. "Asia/Phnom_Penh".
    timezone = Column(String(64), nullable=True)

    # How far either side of today to sync. Meetings outside this window are
    # left alone rather than deleted, so old records keep their notes.
    days_back = Column(Integer, default=7)
    days_ahead = Column(Integer, default=60)

    enabled = Column(Boolean, default=True)
    status = Column(String(32), default="not_connected")  # not_connected|connected|error
    last_error = Column(Text, nullable=True)
    last_sync_at = Column(DateTime, nullable=True)
    last_sync_summary = Column(Text, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class AppSecret(Base):
    """Key material the app generates for itself, so tokens are never stored raw."""
    __tablename__ = "app_secrets"

    key = Column(String(64), primary_key=True)
    value = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
