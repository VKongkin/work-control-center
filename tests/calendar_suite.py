"""Calendar sync suite: ICS end-to-end, Microsoft against a mock.

The Microsoft path cannot be exercised for real from here - it needs an app
registration in the company's Entra ID - so the Graph responses are mocked at
the module boundary. Everything below that boundary is the real code path the
work laptop will run: the same sync engine, the same edit protection, the same
delete guard.
"""
import json
import os
import sys
import threading
import http.server
import socketserver
from datetime import datetime, timedelta, timezone

import requests

API = os.getenv("WCC_API", "http://127.0.0.1:8012")
FEED_PORT = int(os.getenv("WCC_FEED_PORT", "4899"))

passed = failed = 0
failures = []


def check(name, condition, detail=""):
    global passed, failed
    if condition:
        passed += 1
        print(f"  \033[32mPASS\033[0m {name}")
    else:
        failed += 1
        failures.append(f"{name} :: {detail}")
        print(f"  \033[31mFAIL\033[0m {name}  {detail}")


def section(title):
    print(f"\n\033[1m{title}\033[0m")


# ---------------------------------------------------------------------------
# a calendar feed we control
# ---------------------------------------------------------------------------

BASE = (datetime.now(timezone.utc) + timedelta(days=2)).replace(
    hour=9, minute=0, second=0, microsecond=0
)


def z(dt):
    return dt.strftime("%Y%m%dT%H%M%SZ")


def build_feed(*, title="Weekly Change Board", location="Room 4.02",
               include_once_off=True, extra=""):
    once = ""
    if include_once_off:
        once = f"""BEGIN:VEVENT
UID:onceoff@wcc-test
SUMMARY:Vendor catch-up
DTSTART:{z(BASE + timedelta(days=1))}
DTEND:{z(BASE + timedelta(days=1, hours=1))}
LOCATION:{location}
ORGANIZER;CN=Alice Chan:mailto:alice@bank.com
ATTENDEE;CN=Bob Lee:mailto:bob@bank.com
END:VEVENT
"""
    return f"""BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//WCC test//EN
BEGIN:VEVENT
UID:series@wcc-test
SUMMARY:{title}
DTSTART:{z(BASE)}
DTEND:{z(BASE + timedelta(hours=1))}
RRULE:FREQ=WEEKLY;COUNT=4
LOCATION:Microsoft Teams Meeting
DESCRIPTION:Join https://teams.microsoft.com/l/meetup-join/19%3atest/0
ORGANIZER;CN=Alice Chan:mailto:alice@bank.com
END:VEVENT
{once}{extra}END:VCALENDAR
"""


FEED = {"body": build_feed()}


class FeedHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/notacalendar":
            body = b"<html>not a calendar</html>"
            self.send_response(200)
        elif self.path == "/missing":
            body = b"nope"
            self.send_response(404)
        else:
            body = FEED["body"].encode()
            self.send_response(200)
        self.send_header("Content-Type", "text/calendar")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *a):
        pass


def start_feed():
    socketserver.TCPServer.allow_reuse_address = True
    server = socketserver.ThreadingTCPServer(("127.0.0.1", FEED_PORT), FeedHandler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


FEED_URL = f"http://127.0.0.1:{FEED_PORT}/calendar.ics"


# ---------------------------------------------------------------------------

def api(method, path, **kw):
    return requests.request(method, f"{API}{path}", timeout=30, **kw)


def cleanup():
    """Remove anything a previous run left behind."""
    for c in api("GET", "/api/calendar/connections").json():
        if str(c.get("display_name", "")).startswith("TEST "):
            api("DELETE", f"/api/calendar/connections/{c['id']}")
    for m in api("GET", "/api/meetings", params={"limit": 500}).json():
        if str(m.get("title", "")).startswith(("Weekly Change Board", "Vendor catch-up",
                                               "Renamed by hand", "TEST ", "Board (renamed upstream)")):
            api("DELETE", f"/api/meetings/{m['id']}")


def meetings_for(connection_id):
    rows = api("GET", "/api/meetings", params={"limit": 500}).json()
    return [m for m in rows if m.get("connection_id") == connection_id]


def run():
    start_feed()
    cleanup()

    # -- validation ---------------------------------------------------------
    section("Connection validation")
    r = api("POST", "/api/calendar/connections",
            json={"provider": "ics", "display_name": "TEST no url"})
    check("ICS connection without a URL is refused", r.status_code == 422, r.text[:120])

    r = api("POST", "/api/calendar/connections",
            json={"provider": "microsoft", "display_name": "TEST no ids"})
    check("Microsoft connection without tenant/client is refused", r.status_code == 422,
          r.text[:120])

    r = api("POST", "/api/calendar/connections",
            json={"provider": "carrier-pigeon", "display_name": "TEST bad",
                  "ics_url": FEED_URL})
    check("Unknown provider is refused", r.status_code in (400, 422), r.text[:120])

    # -- create + test ------------------------------------------------------
    section("ICS connection")
    r = api("POST", "/api/calendar/connections",
            json={"provider": "ics", "display_name": "TEST work calendar",
                  "ics_url": FEED_URL, "days_back": 7, "days_ahead": 60})
    check("Create ICS connection", r.status_code == 200, r.text[:200])
    conn = r.json()
    cid = conn["id"]
    check("Starts as not connected", conn["status"] == "not_connected", conn.get("status"))

    r = api("POST", f"/api/calendar/connections/{cid}/test")
    check("Test fetch succeeds", r.status_code == 200 and r.json().get("found", 0) >= 4,
          r.text[:200])

    bad = api("POST", "/api/calendar/connections",
              json={"provider": "ics", "display_name": "TEST html url",
                    "ics_url": f"http://127.0.0.1:{FEED_PORT}/notacalendar"}).json()
    r = api("POST", f"/api/calendar/connections/{bad['id']}/test")
    check("A web page instead of a feed gives a readable error",
          r.status_code == 400 and "calendar" in r.json().get("detail", "").lower(),
          r.text[:160])

    miss = api("POST", "/api/calendar/connections",
               json={"provider": "ics", "display_name": "TEST 404 url",
                     "ics_url": f"http://127.0.0.1:{FEED_PORT}/missing"}).json()
    r = api("POST", f"/api/calendar/connections/{miss['id']}/test")
    check("A dead URL gives a readable error",
          r.status_code == 400 and "404" in r.json().get("detail", ""), r.text[:160])
    api("DELETE", f"/api/calendar/connections/{bad['id']}")
    api("DELETE", f"/api/calendar/connections/{miss['id']}")

    # -- first sync ---------------------------------------------------------
    section("First sync")
    r = api("POST", f"/api/calendar/connections/{cid}/sync")
    check("Sync succeeds", r.status_code == 200, r.text[:200])
    summary = r.json()["summary"]
    check("Creates one meeting per occurrence", summary["created"] == 5,
          f"created={summary}")
    check("Nothing updated on a first sync", summary["updated"] == 0, str(summary))

    rows = meetings_for(cid)
    check("Meetings are linked to the connection", len(rows) == 5, f"{len(rows)}")
    check("Marked as coming from the feed", all(m["source"] == "ics" for m in rows),
          str({m["source"] for m in rows}))
    check("Each occurrence has its own external id",
          len({m["external_id"] for m in rows}) == 5)

    board = sorted([m for m in rows if m["title"] == "Weekly Change Board"],
                   key=lambda m: m["meeting_date"])
    check("Recurring series expanded into four dates", len(board) == 4, str(len(board)))
    check("End times captured", all(m["ends_at"] for m in board))
    check("Teams link picked out of the body",
          board[0]["join_url"] and "teams.microsoft.com" in board[0]["join_url"],
          str(board[0].get("join_url")))
    check("Marked as an online meeting", board[0]["is_online"] is True)
    check("Organizer resolved to a name", board[0]["organizer"] == "Alice Chan",
          str(board[0].get("organizer")))

    once = [m for m in rows if m["title"] == "Vendor catch-up"][0]
    check("Attendees captured", once["participants"] == "Bob Lee",
          str(once.get("participants")))
    check("Room captured", once["location"] == "Room 4.02", str(once.get("location")))

    # -- idempotence --------------------------------------------------------
    section("Syncing again changes nothing")
    r = api("POST", f"/api/calendar/connections/{cid}/sync")
    summary = r.json()["summary"]
    check("No duplicates created", summary["created"] == 0, str(summary))
    check("Nothing reported as updated", summary["updated"] == 0, str(summary))
    check("All five seen as unchanged", summary["unchanged"] == 5, str(summary))
    check("Still five meetings", len(meetings_for(cid)) == 5)

    # -- notes survive ------------------------------------------------------
    section("Your own fields are untouched by sync")
    target = once
    api("PUT", f"/api/meetings/{target['id']}",
        json={"notes": "Ask about the Q4 licence renewal",
              "decisions": "Escalate if no reply by Friday"})
    api("POST", f"/api/calendar/connections/{cid}/sync")
    after = api("GET", f"/api/meetings/{target['id']}").json()
    check("Notes survive a sync", after["notes"] == "Ask about the Q4 licence renewal",
          str(after.get("notes")))
    check("Decisions survive a sync", after["decisions"] == "Escalate if no reply by Friday")
    check("Editing notes does not lock a calendar field",
          after["locally_edited"] == [], str(after["locally_edited"]))

    # -- edit protection ----------------------------------------------------
    section("A hand edit is never overwritten")
    edited = board[0]
    r = api("PUT", f"/api/meetings/{edited['id']}", json={"location": "Room 9.01 (moved)"})
    check("Editing a synced field succeeds", r.status_code == 200, r.text[:160])
    check("The edit is remembered", r.json()["locally_edited"] == ["location"],
          str(r.json().get("locally_edited")))

    # upstream now changes both the title and the room
    FEED["body"] = build_feed(title="Board (renamed upstream)", location="Room 5.00")
    r = api("POST", f"/api/calendar/connections/{cid}/sync")
    summary = r.json()["summary"]
    after = api("GET", f"/api/meetings/{edited['id']}").json()
    check("Your room name is kept", after["location"] == "Room 9.01 (moved)",
          str(after.get("location")))
    check("The untouched title still tracks the calendar",
          after["title"] == "Board (renamed upstream)", str(after.get("title")))
    check("The protected field is reported", summary["protected"] == 1, str(summary))
    check("The unprotected fields still counted as updated", summary["updated"] == 5,
          str(summary))

    # a second sync must not keep re-reporting the same protection as an update
    r2 = api("POST", f"/api/calendar/connections/{cid}/sync").json()["summary"]
    check("A settled sync reports no further updates", r2["updated"] == 0, str(r2))

    # -- releasing a field --------------------------------------------------
    section("Releasing a field lets it track the calendar again")
    r = api("POST", f"/api/meetings/{edited['id']}/unlock", params={"field": "location"})
    check("Unlock succeeds", r.status_code == 200, r.text[:160])
    check("Protection cleared", r.json()["locally_edited"] == [],
          str(r.json().get("locally_edited")))
    api("POST", f"/api/calendar/connections/{cid}/sync")
    after = api("GET", f"/api/meetings/{edited['id']}").json()
    # The series carries its own LOCATION - it is the once-off event whose room
    # the feed parameterises - so the value that returns is the series' own.
    check("The calendar value comes back", after["location"] == "Microsoft Teams Meeting",
          str(after.get("location")))
    r = api("POST", f"/api/meetings/{edited['id']}/unlock", params={"field": "notes"})
    check("Unlocking a field sync does not own is refused", r.status_code in (400, 422),
          r.text[:120])

    # -- delete guard -------------------------------------------------------
    section("Deleting")
    r = api("DELETE", f"/api/meetings/{edited['id']}")
    check("A synced meeting cannot be deleted", r.status_code == 409, r.text[:160])
    check("The refusal explains what to do instead",
          "outlook" in r.json().get("detail", "").lower(), r.text[:200])
    check("It is still there", api("GET", f"/api/meetings/{edited['id']}").status_code == 200)

    made = api("POST", "/api/meetings",
               json={"title": "TEST created here", "meeting_date": "2026-10-01"}).json()
    check("A meeting created here is marked WCC", made["source"] == "WCC", str(made))
    check("...and can be deleted",
          api("DELETE", f"/api/meetings/{made['id']}").status_code == 200)

    # -- disappearing upstream ---------------------------------------------
    section("A meeting removed from Outlook")
    FEED["body"] = build_feed(title="Board (renamed upstream)", location="Room 5.00",
                              include_once_off=False)
    r = api("POST", f"/api/calendar/connections/{cid}/sync")
    check("Reported as cancelled, not deleted", r.json()["summary"]["cancelled"] == 1,
          str(r.json()["summary"]))
    gone = api("GET", f"/api/meetings/{target['id']}")
    check("The record still exists", gone.status_code == 200)
    check("Marked cancelled", gone.json()["is_cancelled"] is True)
    check("Its notes are still there", gone.json()["notes"] == "Ask about the Q4 licence renewal")
    check("Still five meetings, none removed", len(meetings_for(cid)) == 5)

    r = api("GET", "/api/meetings", params={"limit": 500, "include_cancelled": "false"})
    check("Cancelled ones can be filtered out",
          not any(m["id"] == target["id"] for m in r.json()))

    r = api("POST", f"/api/calendar/connections/{cid}/sync")
    check("Cancelling is not re-reported on the next sync",
          r.json()["summary"]["cancelled"] == 0, str(r.json()["summary"]))

    # -- disconnect ---------------------------------------------------------
    section("Disconnecting hands the meetings back")
    r = api("DELETE", f"/api/calendar/connections/{cid}")
    check("Disconnect succeeds", r.status_code == 200, r.text[:160])
    check("It reports how many meetings it kept", r.json()["meetings_kept"] == 5,
          r.text[:160])
    still = api("GET", f"/api/meetings/{edited['id']}").json()
    check("The meeting survived", still["id"] == edited["id"])
    check("It now belongs to you", still["source"] == "WCC", str(still.get("source")))
    check("...so it can finally be deleted",
          api("DELETE", f"/api/meetings/{edited['id']}").status_code == 200)
    for m in api("GET", "/api/meetings", params={"limit": 500}).json():
        if str(m.get("title", "")).startswith(("Board (renamed", "Vendor catch-up")):
            api("DELETE", f"/api/meetings/{m['id']}")

    # -- microsoft path (mocked) -------------------------------------------
    section("Microsoft path (mocked Graph)")
    r = api("POST", "/api/calendar/connections",
            json={"provider": "microsoft", "display_name": "TEST outlook",
                  "tenant_id": "contoso.onmicrosoft.com",
                  "client_id": "11111111-2222-3333-4444-555555555555"})
    check("Create Microsoft connection", r.status_code == 200, r.text[:200])
    mid = r.json()["id"]
    check("Secrets are never returned to the browser",
          "refresh_token" not in r.json(), str(list(r.json().keys())))

    r = api("POST", f"/api/calendar/connections/{mid}/sync")
    check("Syncing before sign-in explains itself",
          r.status_code == 400 and "sign" in r.json().get("detail", "").lower(),
          r.text[:160])

    r = api("POST", f"/api/calendar/connections/{cid}/connect/device")
    check("Device sign-in is refused for an ICS connection", r.status_code in (400, 404),
          r.text[:120])
    api("DELETE", f"/api/calendar/connections/{mid}")

    print(f"\n\033[1mCalendar suite: {passed} passed, {failed} failed\033[0m")
    for f in failures:
        print(f"  - {f}")
    return failed


if __name__ == "__main__":
    sys.exit(1 if run() else 0)
