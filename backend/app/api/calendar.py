"""Calendar connections: set one up, sign in, sync.

Two providers are offered because the one that works depends on what your IT
department allows. Microsoft Graph is the better experience but needs an app
registration in the company tenant; a published ICS URL needs nothing from
anybody, and you can set it up yourself in Outlook in about a minute.
"""
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import CalendarConnection, Meeting
from app.partial import make_lenient, make_partial, merge
from app.services import calendar_sync, graph, ics
from app.services.secrets import encrypt
from app.validation import Name, one_of

router = APIRouter()

PROVIDERS = ("microsoft", "ics")


class ConnectionSchema(BaseModel):
    id: Optional[int] = None
    provider: str = "ics"
    display_name: Name = "My work calendar"
    tenant_id: Optional[str] = None
    client_id: Optional[str] = None
    ics_url: Optional[str] = None
    days_back: Optional[int] = 7
    days_ahead: Optional[int] = 60
    enabled: Optional[bool] = True

    _provider_is_known = one_of("provider", list(PROVIDERS))

    class Config:
        from_attributes = True


class ConnectionOut(BaseModel):
    """What the UI is shown. The refresh token is deliberately not in here."""
    id: int
    provider: str
    display_name: Optional[str] = None
    tenant_id: Optional[str] = None
    client_id: Optional[str] = None
    account: Optional[str] = None
    ics_url: Optional[str] = None
    days_back: Optional[int] = None
    days_ahead: Optional[int] = None
    enabled: Optional[bool] = None
    status: Optional[str] = None
    last_error: Optional[str] = None
    last_sync_at: Optional[datetime] = None
    last_sync_summary: Optional[str] = None

    class Config:
        from_attributes = True


ConnectionPartial = make_partial(ConnectionSchema)
ConnectionOutLenient = make_lenient(ConnectionOut)


class PollBody(BaseModel):
    device_code: str


def _validate(payload: ConnectionSchema) -> None:
    if payload.provider == "microsoft" and not (payload.tenant_id and payload.client_id):
        raise HTTPException(
            status_code=422,
            detail="A Microsoft connection needs the tenant ID and the client ID of an "
                   "app registration in your company's Entra ID.",
        )
    if payload.provider == "ics" and not payload.ics_url:
        raise HTTPException(
            status_code=422,
            detail="Paste the published calendar (.ics) URL from Outlook.",
        )


def _get(db: Session, connection_id: int) -> CalendarConnection:
    row = db.query(CalendarConnection).filter(CalendarConnection.id == connection_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Calendar connection not found")
    return row


@router.get("/connections", response_model=List[ConnectionOutLenient])
def list_connections(db: Session = Depends(get_db)):
    return db.query(CalendarConnection).order_by(CalendarConnection.id).all()


@router.post("/connections", response_model=ConnectionOutLenient)
def create_connection(payload: ConnectionSchema, db: Session = Depends(get_db)):
    _validate(payload)
    row = CalendarConnection(**payload.dict(exclude={"id"}))
    row.status = "not_connected"
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.get("/connections/{connection_id}", response_model=ConnectionOutLenient)
def get_connection(connection_id: int, db: Session = Depends(get_db)):
    return _get(db, connection_id)


@router.put("/connections/{connection_id}", response_model=ConnectionOutLenient)
def update_connection(connection_id: int, payload: ConnectionPartial,
                      db: Session = Depends(get_db)):
    row = _get(db, connection_id)
    full = merge(ConnectionSchema, row, payload)
    _validate(full)

    # Pointing a Microsoft connection at a different app or tenant invalidates
    # the sign-in that was granted for the old one.
    if full.provider == "microsoft" and (
        full.tenant_id != row.tenant_id or full.client_id != row.client_id
    ):
        row.refresh_token = None
        row.account = None
        row.status = "not_connected"

    for key, value in full.dict(exclude={"id"}).items():
        setattr(row, key, value)
    row.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(row)
    return row


@router.delete("/connections/{connection_id}")
def delete_connection(connection_id: int, db: Session = Depends(get_db)):
    """Disconnect, and hand the meetings it brought in back to you.

    Removing a connection must never remove meetings - the notes and decisions
    on them are yours. But leaving them marked as synced would strand them:
    synced meetings cannot be deleted, and nothing would ever update them again.
    So they become ordinary WCC meetings, fully under your control.
    """
    row = _get(db, connection_id)
    adopted = (
        db.query(Meeting)
        .filter(Meeting.connection_id == connection_id)
        .update(
            {
                Meeting.source: "WCC",
                Meeting.connection_id: None,
                Meeting.external_id: None,
                Meeting.locally_edited: None,
            },
            synchronize_session=False,
        )
    )
    db.delete(row)
    db.commit()
    return {
        "message": "Calendar disconnected",
        "meetings_kept": adopted,
        "detail": f"{adopted} synced meeting(s) were kept and are now yours to edit or delete.",
    }


# ---------------------------------------------------------------------------
# Microsoft sign-in (device code)
# ---------------------------------------------------------------------------

@router.post("/connections/{connection_id}/connect/device")
def begin_device_sign_in(connection_id: int, db: Session = Depends(get_db)):
    """Start the sign-in. Returns the code to type at microsoft.com/devicelogin.

    Device code flow is used deliberately: the app never sees your password,
    needs no client secret, and works on a locked-down work laptop where a
    redirect URI back to localhost would be awkward to register.
    """
    row = _get(db, connection_id)
    if row.provider != "microsoft":
        raise HTTPException(status_code=400, detail="Only Microsoft connections need sign-in.")
    try:
        result = graph.start_device_code(row.tenant_id, row.client_id)
    except graph.GraphError as e:
        row.status = "error"
        row.last_error = str(e)
        db.commit()
        raise HTTPException(status_code=400, detail=str(e))
    return {
        "device_code": result.get("device_code"),
        "user_code": result.get("user_code"),
        "verification_uri": result.get("verification_uri", "https://microsoft.com/devicelogin"),
        "expires_in": result.get("expires_in", 900),
        "interval": result.get("interval", 5),
        "message": result.get("message"),
    }


@router.post("/connections/{connection_id}/connect/poll")
def finish_device_sign_in(connection_id: int, body: PollBody, db: Session = Depends(get_db)):
    """Called every few seconds until the user finishes signing in."""
    row = _get(db, connection_id)
    if row.provider != "microsoft":
        raise HTTPException(status_code=400, detail="Only Microsoft connections need sign-in.")
    try:
        result = graph.poll_device_code(row.tenant_id, row.client_id, body.device_code)
    except graph.GraphError as e:
        row.status = "error"
        row.last_error = str(e)
        db.commit()
        raise HTTPException(status_code=400, detail=str(e))

    if result.get("pending"):
        return {"pending": True, "slow_down": bool(result.get("slow_down"))}

    token = result.get("refresh_token")
    if not token:
        raise HTTPException(
            status_code=400,
            detail="Microsoft did not return a refresh token. Add the offline_access "
                   "permission to the app registration and try again.",
        )

    row.refresh_token = encrypt(db, token)
    row.account = graph.whoami(result.get("access_token", "")) or row.account
    row.status = "connected"
    row.last_error = None
    db.commit()
    db.refresh(row)
    return {"pending": False, "connected": True, "account": row.account}


@router.post("/connections/{connection_id}/disconnect", response_model=ConnectionOutLenient)
def sign_out(connection_id: int, db: Session = Depends(get_db)):
    """Forget the stored sign-in without removing the connection or meetings."""
    row = _get(db, connection_id)
    row.refresh_token = None
    row.account = None
    row.status = "not_connected"
    row.last_error = None
    db.commit()
    db.refresh(row)
    return row


# ---------------------------------------------------------------------------
# syncing
# ---------------------------------------------------------------------------

@router.post("/connections/{connection_id}/test")
def test_connection(connection_id: int, db: Session = Depends(get_db)):
    """Fetch without writing anything, so a URL can be checked before trusting it."""
    row = _get(db, connection_id)
    try:
        rows = calendar_sync.fetch(db, row)
    except (calendar_sync.SyncError, ics.IcsError, graph.GraphError) as e:
        raise HTTPException(status_code=400, detail=str(e))
    upcoming = [r["title"] for r in rows[:5]]
    return {"ok": True, "found": len(rows), "sample": upcoming}


@router.post("/connections/{connection_id}/sync")
def sync_connection(connection_id: int, db: Session = Depends(get_db)):
    row = _get(db, connection_id)
    result = calendar_sync.run(db, row)
    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result.get("error", "Sync failed"))
    return result


@router.post("/sync")
def sync_all(db: Session = Depends(get_db)):
    """Sync every enabled connection. One failure does not stop the others."""
    rows = db.query(CalendarConnection).filter(CalendarConnection.enabled == True).all()  # noqa: E712
    results = []
    for row in rows:
        outcome = calendar_sync.run(db, row)
        results.append({"id": row.id, "display_name": row.display_name, **outcome})
    ok = [r for r in results if r.get("ok")]
    return {
        "connections": len(rows),
        "succeeded": len(ok),
        "failed": len(results) - len(ok),
        "results": results,
    }
