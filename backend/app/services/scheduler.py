"""Sync connected calendars on their own, in the background.

Runs inside the API process rather than as a separate container or a cron
entry, so `docker compose up` is still the whole story - nothing extra to
install, schedule or remember when moving the app to another machine.

Three things keep it well behaved:

  * It wakes on a short tick and asks which calendars are due, rather than
    sleeping for the interval. A container that restarts mid-interval therefore
    picks up where it left off instead of resetting everyone's clock.
  * Syncing blocks - it makes HTTP calls and talks to the database - so each run
    goes to a worker thread and never stalls the API serving requests.
  * A Postgres advisory lock means only one process ever syncs a given
    connection, so running more than one worker cannot double-write.
"""
import asyncio
import logging
import os
from typing import List, Optional

from sqlalchemy import text

from app.database import SessionLocal
from app.models import CalendarConnection
from app.services import calendar_sync

log = logging.getLogger("wcc.scheduler")

# How often to look for work. Short enough that a 5-minute interval means
# roughly 5 minutes, cheap enough to be irrelevant - one indexed query.
TICK_SECONDS = int(os.getenv("WCC_SYNC_TICK_SECONDS", "60"))

# Namespace for the advisory locks, so they cannot collide with anything else
# that might one day take a lock in this database.
LOCK_NAMESPACE = 0x7743_4331  # "wCC1"

_task: Optional[asyncio.Task] = None


def enabled() -> bool:
    """Automatic syncing can be turned off wholesale for a given deployment."""
    return os.getenv("WCC_AUTO_SYNC", "1").strip().lower() not in ("0", "false", "no", "off")


async def start() -> None:
    global _task
    if _task is not None and not _task.done():
        return
    if not enabled():
        log.info("Calendar auto-sync disabled by WCC_AUTO_SYNC")
        return
    _task = asyncio.create_task(_loop(), name="wcc-calendar-sync")
    log.info("Calendar auto-sync started (checking every %ss)", TICK_SECONDS)


async def stop() -> None:
    global _task
    if _task is None:
        return
    _task.cancel()
    try:
        await _task
    except asyncio.CancelledError:
        pass
    except Exception:  # pragma: no cover - shutdown is best effort
        pass
    _task = None


async def _loop() -> None:
    # A moment's grace so the first tick does not race the table creation and
    # seeding that startup is still finishing.
    await asyncio.sleep(5)
    while True:
        try:
            await asyncio.to_thread(run_due_now)
        except asyncio.CancelledError:
            raise
        except Exception:
            # A scheduler that dies on one bad tick is worse than one that logs
            # and tries again; the connection's own error is already recorded.
            log.exception("Calendar auto-sync tick failed")
        await asyncio.sleep(TICK_SECONDS)


def due_connections(db) -> List[CalendarConnection]:
    return [
        c for c in db.query(CalendarConnection).order_by(CalendarConnection.id).all()
        if calendar_sync.is_due(c)
    ]


def run_due_now() -> List[dict]:
    """One tick: sync every calendar that is due. Blocking; call in a thread."""
    results: List[dict] = []
    db = SessionLocal()
    try:
        for connection in due_connections(db):
            if not _claim(db, connection.id):
                continue  # another process is already on it
            try:
                outcome = calendar_sync.run(db, connection)
                results.append({"id": connection.id, **outcome})
                if outcome.get("ok"):
                    summary = outcome.get("summary", {})
                    if any(summary.get(k) for k in ("created", "updated", "cancelled")):
                        log.info("Auto-synced %s: %s", connection.display_name, summary)
                else:
                    log.warning("Auto-sync failed for %s: %s",
                                connection.display_name, outcome.get("error"))
            finally:
                _release(db, connection.id)
    finally:
        db.close()
    return results


def _claim(db, connection_id: int) -> bool:
    """Take a session-scoped advisory lock for this connection, if free.

    Advisory locks are used rather than a column on the row because Postgres
    drops them when the connection goes away - so a process killed mid-sync
    leaves nothing stuck, which a "syncing = true" flag would.
    """
    try:
        got = db.execute(
            text("SELECT pg_try_advisory_lock(:ns, :id)"),
            {"ns": LOCK_NAMESPACE, "id": connection_id},
        ).scalar()
        return bool(got)
    except Exception:
        # SQLite and friends have no advisory locks. Single-process is the
        # normal deployment, so proceeding is the right default there.
        db.rollback()
        return True


def _release(db, connection_id: int) -> None:
    try:
        db.execute(
            text("SELECT pg_advisory_unlock(:ns, :id)"),
            {"ns": LOCK_NAMESPACE, "id": connection_id},
        )
        db.commit()
    except Exception:
        db.rollback()
