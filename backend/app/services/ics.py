"""Read a published calendar (.ics) feed.

This is the path that needs no app registration: Outlook can publish a calendar
to a URL and WCC reads it. The trade-off is that an ICS feed hands over the raw
series - a weekly stand-up arrives once, carrying a recurrence rule - so the
occurrences have to be expanded here, which Graph does for us.
"""
import re
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

import requests
from dateutil.rrule import rrulestr

TIMEOUT = 30
MAX_BYTES = 8 * 1024 * 1024
# A malformed or unbounded rule must not be allowed to generate forever.
MAX_OCCURRENCES_PER_SERIES = 400

# Fields an amended occurrence may restate, and the property each comes from.
# Used to tell "the override changed this" from "the override omitted this".
OVERRIDABLE = {
    "title": "SUMMARY",
    "organizer": "ORGANIZER",
    "participants": "ATTENDEE",
    "location": "LOCATION",
    "is_online": "LOCATION",
    "is_cancelled": "STATUS",
}


class IcsError(RuntimeError):
    """A failure worth showing the user verbatim."""


def fetch(url: str) -> str:
    if not url.lower().startswith(("http://", "https://", "webcal://")):
        raise IcsError("The calendar URL must start with https://")
    # Outlook hands out webcal:// links, which are just https by another name.
    if url.lower().startswith("webcal://"):
        url = "https://" + url[len("webcal://"):]

    try:
        r = requests.get(url, timeout=TIMEOUT, stream=True)
    except requests.RequestException as e:
        raise IcsError(f"Could not reach the calendar URL: {e}") from e

    if r.status_code == 404:
        raise IcsError("The calendar URL returned 404. Check it is still published.")
    if r.status_code != 200:
        raise IcsError(f"The calendar URL returned HTTP {r.status_code}.")

    body = r.raw.read(MAX_BYTES + 1, decode_content=True) or b""
    if len(body) > MAX_BYTES:
        raise IcsError("That calendar feed is larger than 8 MB.")

    text = body.decode("utf-8", errors="replace")
    if "BEGIN:VCALENDAR" not in text:
        raise IcsError(
            "That URL did not return a calendar. Make sure you copied the ICS "
            "link and not the web page it sits on."
        )
    return text


def parse(text: str, days_back: int, days_ahead: int) -> List[Dict[str, Any]]:
    """Expand a feed into individual occurrences inside the sync window."""
    from icalendar import Calendar  # imported lazily so import errors surface here

    try:
        cal = Calendar.from_ical(text)
    except Exception as e:  # the library raises a grab-bag of exception types
        raise IcsError(f"That calendar could not be read: {e}") from e

    now = datetime.now(timezone.utc)
    window_start = now - timedelta(days=days_back)
    window_end = now + timedelta(days=days_ahead)

    # An amended single occurrence appears as its own VEVENT carrying
    # RECURRENCE-ID; it must win over the copy the rule would generate.
    overrides: Dict[str, Dict[datetime, Any]] = {}
    masters: List[Any] = []
    singles: List[Any] = []

    for component in cal.walk("VEVENT"):
        uid = str(component.get("UID", "")) or None
        if component.get("RECURRENCE-ID") is not None and uid:
            when = _aware(component.get("RECURRENCE-ID").dt)
            if when:
                overrides.setdefault(uid, {})[when] = component
        elif component.get("RRULE") is not None:
            masters.append(component)
        else:
            singles.append(component)

    out: List[Dict[str, Any]] = []

    for event in singles:
        start = _aware(_value(event, "DTSTART"))
        if start and window_start <= start <= window_end:
            out.append(_flatten(event, start, _aware(_value(event, "DTEND"))))

    for master in masters:
        out.extend(_expand(master, overrides, window_start, window_end))

    # Amended occurrences whose master was filtered out still belong in the list.
    seen = {(e["external_id"]) for e in out}
    for uid, by_time in overrides.items():
        for when, event in by_time.items():
            start = _aware(_value(event, "DTSTART")) or when
            if not (window_start <= start <= window_end):
                continue
            ident = f"{uid}::{start.isoformat()}"
            if ident not in seen:
                out.append(_flatten(event, start, _aware(_value(event, "DTEND")), ident))

    out.sort(key=lambda e: e["meeting_date"] or datetime.min.replace(tzinfo=timezone.utc))
    return out


def _expand(master, overrides, window_start, window_end) -> List[Dict[str, Any]]:
    uid = str(master.get("UID", "")) or None
    start = _aware(_value(master, "DTSTART"))
    if not start:
        return []

    end = _aware(_value(master, "DTEND"))
    duration = (end - start) if end else timedelta(hours=1)

    rule_text = master.get("RRULE").to_ical().decode()
    try:
        rule = rrulestr(f"RRULE:{rule_text}", dtstart=start)
    except (ValueError, TypeError):
        return []

    skip = {d for d in _exdates(master)}
    amended = overrides.get(uid, {})

    results: List[Dict[str, Any]] = []
    for occurrence in rule.between(window_start, window_end, inc=True):
        occurrence = _aware(occurrence)
        if occurrence in skip:
            continue
        if len(results) >= MAX_OCCURRENCES_PER_SERIES:
            break

        override = amended.get(occurrence)
        if override is None:
            results.append(_flatten(master, occurrence, occurrence + duration,
                                    f"{uid}::{occurrence.isoformat()}"))
            continue

        # A single occurrence that was moved or lengthened carries its own
        # DTSTART/DTEND. Use those for the times, but keep the identity keyed on
        # the slot the rule generated (the RECURRENCE-ID) so re-syncing still
        # matches the same row after the meeting is dragged to a new time.
        start_at = _aware(_value(override, "DTSTART")) or occurrence
        end_at = _aware(_value(override, "DTEND")) or (start_at + duration)
        row = _flatten(master, start_at, end_at, f"{uid}::{occurrence.isoformat()}")
        # Outlook usually repeats every property on an override, but not always;
        # anything it left out should keep the series' value rather than blank
        # out - so copy only the fields the override actually declares.
        stated = _flatten(override, start_at, end_at)
        for field, ical_key in OVERRIDABLE.items():
            if override.get(ical_key) is not None:
                row[field] = stated[field]
        results.append(row)
    return results


def _exdates(component) -> List[datetime]:
    raw = component.get("EXDATE")
    if raw is None:
        return []
    entries = raw if isinstance(raw, list) else [raw]
    out = []
    for entry in entries:
        for d in getattr(entry, "dts", []):
            when = _aware(d.dt)
            if when:
                out.append(when)
    return out


def _flatten(event, start, end, ident: Optional[str] = None) -> Dict[str, Any]:
    organizer = event.get("ORGANIZER")
    attendees = event.get("ATTENDEE")
    if attendees is not None and not isinstance(attendees, list):
        attendees = [attendees]

    join = _join_url(event)
    raw_start = event.get("DTSTART")
    return {
        "external_id": ident or str(event.get("UID", "")) or f"ics::{start.isoformat()}",
        "title": str(event.get("SUMMARY", "")) or "(no subject)",
        # Times leave here as aware UTC. Turning them into the calendar owner's
        # wall clock is one step, done once, in calendar_sync.
        "meeting_date": start,
        "ends_at": end,
        # An all-day entry has no time of day to convert; shifting it would drag
        # a holiday onto the evening before.
        "all_day": raw_start is not None and not isinstance(getattr(raw_start, "dt", None), datetime),
        "organizer": _address(organizer),
        "participants": ", ".join(filter(None, (_address(a) for a in (attendees or [])))) or None,
        "location": str(event.get("LOCATION", "")) or None,
        "is_online": bool(join),
        "join_url": join,
        "is_cancelled": str(event.get("STATUS", "")).upper() == "CANCELLED",
    }


# Teams and Zoom both put the join link in the body; Outlook usually also puts
# it in LOCATION. Finding it means the meeting card can offer a Join button.
_JOIN = re.compile(
    r"https?://(?:[\w.-]*\.)?(?:teams\.microsoft\.com|teams\.live\.com|zoom\.us|"
    r"webex\.com|meet\.google\.com|gotomeeting\.com)/[^\s>\"'<]+",
    re.I,
)


def _join_url(event) -> Optional[str]:
    for key in ("LOCATION", "X-MICROSOFT-SKYPETEAMSMEETINGURL", "DESCRIPTION"):
        found = _JOIN.search(str(event.get(key, "")))
        if found:
            # Long links get folded across lines; the unfolding leaves stray
            # escapes that would break the href.
            return found.group(0).replace("\\", "").rstrip(">,.")
    return None


def _address(value) -> Optional[str]:
    """Pull a readable name out of a CAL-ADDRESS, which is usually mailto:..."""
    if value is None:
        return None
    name = None
    try:
        name = value.params.get("CN")
    except AttributeError:
        pass
    text = str(name or value)
    return text.replace("mailto:", "").strip() or None


def _value(component, key):
    field = component.get(key)
    return getattr(field, "dt", None) if field is not None else None


def _aware(value) -> Optional[datetime]:
    """Normalise to UTC. All-day entries arrive as dates, not datetimes."""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc) if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, date):
        return datetime(value.year, value.month, value.day, tzinfo=timezone.utc)
    return None


