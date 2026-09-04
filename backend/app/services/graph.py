"""Microsoft Graph calendar access via the device code flow.

Device code is the right fit here: WCC runs on localhost with no public
redirect URI, and the sign-in happens in the user's own browser against their
company's login page, so conditional access and MFA behave normally. The app
registration only needs the delegated Calendars.Read scope.
"""
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

import requests

AUTH_HOST = "https://login.microsoftonline.com"
GRAPH = "https://graph.microsoft.com/v1.0"
SCOPE = "offline_access Calendars.Read User.Read"
TIMEOUT = 30


class GraphError(RuntimeError):
    """A failure worth showing the user verbatim."""


def _authority(tenant_id: str) -> str:
    return f"{AUTH_HOST}/{tenant_id or 'organizations'}"


def start_device_code(tenant_id: str, client_id: str) -> Dict[str, Any]:
    """Ask Microsoft for a code the user types at microsoft.com/devicelogin."""
    r = requests.post(
        f"{_authority(tenant_id)}/oauth2/v2.0/devicecode",
        data={"client_id": client_id, "scope": SCOPE},
        timeout=TIMEOUT,
    )
    if r.status_code != 200:
        raise GraphError(_explain(r))
    return r.json()


def poll_device_code(tenant_id: str, client_id: str, device_code: str) -> Dict[str, Any]:
    """Check whether the user has finished signing in.

    Returns {"pending": True} while they have not, rather than raising, so the
    UI can poll without treating the normal waiting state as a failure.
    """
    r = requests.post(
        f"{_authority(tenant_id)}/oauth2/v2.0/token",
        data={
            "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
            "client_id": client_id,
            "device_code": device_code,
        },
        timeout=TIMEOUT,
    )
    if r.status_code == 200:
        return r.json()

    body = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
    error = body.get("error", "")
    if error in ("authorization_pending", "slow_down"):
        return {"pending": True, "slow_down": error == "slow_down"}
    if error == "expired_token":
        raise GraphError("The sign-in code expired. Start again.")
    if error == "authorization_declined":
        raise GraphError("Sign-in was declined.")
    raise GraphError(_explain(r))


def access_token(tenant_id: str, client_id: str, refresh_token: str) -> Dict[str, Any]:
    r = requests.post(
        f"{_authority(tenant_id)}/oauth2/v2.0/token",
        data={
            "grant_type": "refresh_token",
            "client_id": client_id,
            "refresh_token": refresh_token,
            "scope": SCOPE,
        },
        timeout=TIMEOUT,
    )
    if r.status_code != 200:
        raise GraphError(_explain(r))
    return r.json()


def whoami(token: str) -> Optional[str]:
    r = requests.get(f"{GRAPH}/me", headers=_auth(token), timeout=TIMEOUT)
    if r.status_code != 200:
        return None
    body = r.json()
    return body.get("mail") or body.get("userPrincipalName")


def calendar_view(token: str, days_back: int, days_ahead: int) -> List[Dict[str, Any]]:
    """Occurrences between two dates.

    calendarView is used rather than /events because Graph expands recurring
    series into individual occurrences for us - otherwise every weekly stand-up
    would arrive as a single master event with a recurrence rule to interpret.
    """
    now = datetime.now(timezone.utc)
    start = (now - timedelta(days=days_back)).isoformat()
    end = (now + timedelta(days=days_ahead)).isoformat()

    url = (
        f"{GRAPH}/me/calendarView"
        f"?startDateTime={start}&endDateTime={end}"
        "&$select=id,subject,start,end,isAllDay,organizer,attendees,location,"
        "isOnlineMeeting,onlineMeeting,bodyPreview,isCancelled,seriesMasterId"
        "&$orderby=start/dateTime&$top=200"
    )
    headers = {**_auth(token), "Prefer": 'outlook.timezone="UTC"'}

    events: List[Dict[str, Any]] = []
    # Graph pages large calendars; follow the links until they run out.
    while url and len(events) < 2000:
        r = requests.get(url, headers=headers, timeout=TIMEOUT)
        if r.status_code != 200:
            raise GraphError(_explain(r))
        body = r.json()
        events.extend(body.get("value", []))
        url = body.get("@odata.nextLink")
    return events


def to_meeting(event: Dict[str, Any]) -> Dict[str, Any]:
    """Flatten one Graph event into the fields a meeting record holds."""
    attendees = [
        a.get("emailAddress", {}).get("name") or a.get("emailAddress", {}).get("address")
        for a in event.get("attendees", [])
    ]
    online = event.get("onlineMeeting") or {}
    return {
        "external_id": event.get("id"),
        "title": event.get("subject") or "(no subject)",
        # Aware UTC; calendar_sync converts to the calendar owner's wall clock.
        "meeting_date": _parse(event.get("start")),
        "ends_at": _parse(event.get("end")),
        "all_day": bool(event.get("isAllDay")),
        "organizer": (event.get("organizer") or {}).get("emailAddress", {}).get("name"),
        "participants": ", ".join([a for a in attendees if a]) or None,
        "location": (event.get("location") or {}).get("displayName") or None,
        "is_online": bool(event.get("isOnlineMeeting")),
        "join_url": online.get("joinUrl"),
        "is_cancelled": bool(event.get("isCancelled")),
    }


def _parse(slot: Optional[Dict[str, Any]]) -> Optional[datetime]:
    if not slot or not slot.get("dateTime"):
        return None
    raw = slot["dateTime"]
    if raw.endswith("Z"):
        raw = raw[:-1]
    # Graph returns more precision than Postgres keeps; trim to microseconds.
    if "." in raw:
        head, frac = raw.split(".", 1)
        raw = f"{head}.{frac[:6]}"
    try:
        parsed = datetime.fromisoformat(raw)
    except ValueError:
        return None
    # The request asks for UTC (Prefer: outlook.timezone), but Graph states that
    # only in a sibling field - so the offset is attached here rather than left
    # implicit for the next reader to guess at.
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _auth(token: str) -> Dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _explain(r: requests.Response) -> str:
    """Turn a Microsoft error into something actionable."""
    try:
        body = r.json()
    except ValueError:
        return f"Microsoft returned HTTP {r.status_code}."

    desc = body.get("error_description") or (body.get("error") or {}).get("message")
    code = body.get("error") if isinstance(body.get("error"), str) else None

    if code == "invalid_client" or (desc and "AADSTS7000" in desc):
        return ("Microsoft did not recognise the Client ID, or the app registration "
                "is not set up for device code sign-in. Enable 'Allow public client "
                "flows' on the registration.")
    if desc and "AADSTS50020" in desc:
        return "That account is not in the tenant this app is registered against."
    if desc and "AADSTS65001" in desc:
        return "Consent has not been granted for Calendars.Read on this app."
    if r.status_code == 403:
        return "Access denied by Microsoft. The app likely lacks the Calendars.Read permission."
    return desc or f"Microsoft returned HTTP {r.status_code}."
