"""Turning a provider's UTC into the wall clock you actually work by.

Outlook hands over meeting times in UTC. Stored raw, a 10:30 meeting in Phnom
Penh reads as 03:30, because everywhere else in WCC a stored timestamp means
local wall time - that is what a date picker puts in and what the browser reads
back out. So provider times are converted once, here, on the way in.

Storing wall time rather than UTC is a deliberate choice. The rest of the app
already works that way, and switching the whole database to UTC would mean
shifting every existing task due date and follow-up date - values sitting at
midnight, which a shift would drag onto the previous day. The cost is that these
timestamps are anchored to one zone rather than travelling with you, which for a
work diary is what you want anyway.
"""
import os
from datetime import datetime, timezone
from typing import Optional

try:
    from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
except ImportError:  # pragma: no cover - Python < 3.9
    ZoneInfo = None  # type: ignore
    ZoneInfoNotFoundError = Exception  # type: ignore

DEFAULT_ENV = "WCC_TIMEZONE"


def resolve(name: Optional[str]) -> timezone:
    """The zone to use, falling back through the env to UTC.

    An unknown name must not take the sync down with it - a typo in a setting is
    not a reason to lose a day's meetings - so it degrades to UTC, which is what
    the provider gave us and therefore no worse than not converting at all.
    """
    for candidate in (name, os.getenv(DEFAULT_ENV)):
        if not candidate:
            continue
        if candidate.upper() == "UTC":
            return timezone.utc
        if ZoneInfo is None:
            continue
        try:
            return ZoneInfo(candidate)  # type: ignore[return-value]
        except (ZoneInfoNotFoundError, ValueError, KeyError):
            continue
    return timezone.utc


def is_known(name: Optional[str]) -> bool:
    """Whether this zone name can actually be loaded on this machine."""
    if not name:
        return False
    if name.upper() == "UTC":
        return True
    if ZoneInfo is None:
        return False
    try:
        ZoneInfo(name)
        return True
    except (ZoneInfoNotFoundError, ValueError, KeyError):
        return False


def to_wall(value: Optional[datetime], zone) -> Optional[datetime]:
    """An aware (or assumed-UTC) instant -> naive wall time in `zone`."""
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(zone).replace(tzinfo=None)


def reinterpret(value: Optional[datetime], old_zone, new_zone) -> Optional[datetime]:
    """Re-read a stored wall time as if it had always been in `new_zone`.

    Used when a calendar's timezone setting changes: the stored number was
    `old_zone`'s wall clock, so it is anchored back to a real instant and then
    read again in the new zone. Going through the instant is what makes this
    correct across a daylight-saving boundary, where the offset is not constant.
    """
    if value is None:
        return None
    return value.replace(tzinfo=old_zone).astimezone(new_zone).replace(tzinfo=None)
