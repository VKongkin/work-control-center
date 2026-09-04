"""The one place a calendar becomes meetings.

Both providers - Microsoft Graph and a published ICS feed - hand back the same
shape of dictionary, so everything below this line is provider-agnostic. Two
rules hold, and they are the whole point of this module:

  1. A field you have edited by hand is never overwritten. Every edit records
     the field name on the meeting; sync refreshes everything except those.
  2. Sync never deletes. A meeting that disappears from Outlook is marked
     cancelled, not removed, so your notes and decisions survive it.
"""
import json
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional

from sqlalchemy.orm import Session

from app.models import CalendarConnection, Meeting
from app.services import clock, graph, ics
from app.services.secrets import decrypt

# The fields sync owns. Anything not listed here - notes, decisions, the
# primary contact you attached - belongs to you alone and is never touched.
SYNCED_FIELDS = (
    "title",
    "meeting_date",
    "ends_at",
    "organizer",
    "participants",
    "location",
    "is_online",
    "join_url",
    "is_cancelled",
    "all_day",
)


class SyncError(RuntimeError):
    """Something the user needs to read and act on."""


def edited_fields(meeting: Meeting) -> List[str]:
    """The field names the user has changed by hand on this meeting."""
    raw = getattr(meeting, "locally_edited", None)
    if not raw:
        return []
    try:
        value = json.loads(raw)
    except (TypeError, ValueError):
        return []
    return [f for f in value if isinstance(f, str)] if isinstance(value, list) else []


def record_edits(meeting: Meeting, changed: Iterable[str]) -> None:
    """Remember that these fields were set by hand, so sync leaves them alone."""
    keep = set(edited_fields(meeting)) | {f for f in changed if f in SYNCED_FIELDS}
    meeting.locally_edited = json.dumps(sorted(keep)) if keep else None


def changed_synced_fields(meeting: Meeting, incoming: Dict[str, Any]) -> List[str]:
    """Which of the sync-owned fields a payload would actually alter."""
    out = []
    for field in SYNCED_FIELDS:
        if field not in incoming:
            continue
        if _differs(getattr(meeting, field, None), incoming[field]):
            out.append(field)
    return out


# --------------------------------------------------------------------------
# fetching
# --------------------------------------------------------------------------

def fetch(db: Session, connection: CalendarConnection) -> List[Dict[str, Any]]:
    """Ask the provider for occurrences inside the connection's window."""
    days_back = connection.days_back or 7
    days_ahead = connection.days_ahead or 60

    if connection.provider == "ics":
        if not connection.ics_url:
            raise SyncError("This connection has no calendar URL yet.")
        return ics.parse(ics.fetch(connection.ics_url), days_back, days_ahead)

    if connection.provider == "microsoft":
        if not connection.refresh_token:
            raise SyncError("Not signed in yet. Use Connect to sign in with your work account.")
        token = decrypt(db, connection.refresh_token)
        if not token:
            raise SyncError("The stored sign-in could not be read. Please connect again.")
        try:
            result = graph.access_token(connection.tenant_id, connection.client_id, token)
        except graph.GraphError as e:
            raise SyncError(str(e)) from e

        # Refresh tokens rotate; losing the new one means a needless re-sign-in.
        if result.get("refresh_token") and result["refresh_token"] != token:
            from app.services.secrets import encrypt
            connection.refresh_token = encrypt(db, result["refresh_token"])

        try:
            events = graph.calendar_view(result["access_token"], days_back, days_ahead)
        except graph.GraphError as e:
            raise SyncError(str(e)) from e
        return [graph.to_meeting(e) for e in events]

    raise SyncError(f"Unknown calendar provider: {connection.provider}")


# --------------------------------------------------------------------------
# applying
# --------------------------------------------------------------------------

def localise(connection: CalendarConnection, rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Convert every provider time into the calendar's own wall clock.

    Done in one place, after fetching and before anything is compared or stored,
    so both providers and every later step see the same thing.
    """
    zone = clock.resolve(connection.timezone)
    for row in rows:
        row["all_day"] = bool(row.get("all_day"))
        for field in ("meeting_date", "ends_at"):
            value = row.get(field)
            if value is None:
                continue
            # An all-day entry has no time of day to convert; shifting it would
            # drag a holiday onto the evening before.
            row[field] = (value.replace(tzinfo=None) if row["all_day"]
                          else clock.to_wall(value, zone))
    return rows


def apply(db: Session, connection: CalendarConnection,
          rows: List[Dict[str, Any]]) -> Dict[str, int]:
    """Upsert the fetched occurrences, honouring every hand edit."""
    localise(connection, rows)
    now = datetime.utcnow()
    summary = {"created": 0, "updated": 0, "unchanged": 0, "protected": 0, "cancelled": 0}

    existing = {
        m.external_id: m
        for m in db.query(Meeting).filter(Meeting.connection_id == connection.id).all()
        if m.external_id
    }
    seen = set()

    for row in rows:
        ident = row.get("external_id")
        if not ident:
            continue
        seen.add(ident)
        meeting = existing.get(ident)

        if meeting is None:
            meeting = Meeting(
                source=connection.provider,
                external_id=ident,
                connection_id=connection.id,
                last_synced_at=now,
            )
            for field in SYNCED_FIELDS:
                if field in row:
                    setattr(meeting, field, row[field])
            db.add(meeting)
            summary["created"] += 1
            continue

        protected = set(edited_fields(meeting))
        touched = False
        blocked = False
        for field in SYNCED_FIELDS:
            if field not in row:
                continue
            if field in protected:
                # Rule 1: your version wins, every time, for as long as it stands.
                if _differs(getattr(meeting, field, None), row[field]):
                    blocked = True
                continue
            if _differs(getattr(meeting, field, None), row[field]):
                setattr(meeting, field, row[field])
                touched = True

        meeting.last_synced_at = now
        # "protected" counts separately rather than as a third bucket: a meeting
        # can have its title refreshed and its room left alone in the same pass,
        # and hiding that behind "updated" would lose the one fact worth showing.
        if blocked:
            summary["protected"] += 1
        if touched:
            meeting.updated_at = now
            summary["updated"] += 1
        else:
            summary["unchanged"] += 1

    # Rule 2: gone from Outlook means cancelled, never deleted. Only meetings
    # inside the window we just fetched are considered - anything older simply
    # was not asked for, and must not be mistaken for a deletion.
    # Meeting times are wall clock now, so the window has to be too - comparing
    # them against a UTC "now" would misjudge both edges by the offset.
    now_wall = clock.to_wall(datetime.now(timezone.utc), clock.resolve(connection.timezone))
    window_start = now_wall - timedelta(days=connection.days_back or 7)
    window_end = now_wall + timedelta(days=connection.days_ahead or 60)
    for ident, meeting in existing.items():
        if ident in seen or meeting.is_cancelled:
            continue
        when = meeting.meeting_date
        if not when or not (window_start <= when <= window_end):
            continue
        if "is_cancelled" in edited_fields(meeting):
            continue
        meeting.is_cancelled = True
        meeting.updated_at = now
        summary["cancelled"] += 1

    db.commit()
    return summary


def run(db: Session, connection: CalendarConnection) -> Dict[str, Any]:
    """Fetch and apply, recording the outcome on the connection either way."""
    try:
        rows = fetch(db, connection)
    except (SyncError, ics.IcsError, graph.GraphError) as e:
        connection.status = "error"
        connection.last_error = str(e)
        connection.last_sync_at = datetime.utcnow()
        db.commit()
        return {"ok": False, "error": str(e)}

    summary = apply(db, connection, rows)
    connection.status = "connected"
    connection.last_error = None
    connection.last_sync_at = datetime.utcnow()
    connection.last_sync_summary = json.dumps(summary)
    db.commit()
    return {"ok": True, "summary": summary, "fetched": len(rows)}


def _differs(current: Any, incoming: Any) -> bool:
    """Compare the way the database will store it, not the way it arrived."""
    if isinstance(current, datetime) and isinstance(incoming, datetime):
        # Postgres keeps these naive; a tz-aware incoming value would otherwise
        # look different on every single sync.
        return current.replace(tzinfo=None, microsecond=0) != incoming.replace(
            tzinfo=None, microsecond=0
        )
    if isinstance(current, bool) or isinstance(incoming, bool):
        return bool(current) != bool(incoming)
    if current is None and incoming == "":
        return False
    return current != incoming
