"""Servers, their accounts, and the guarded path to a stored password.

Three rules hold throughout this module:

  1. No read endpoint ever returns a password. `secret_ciphertext` is stripped
     from every response; the only way to a plaintext is POST /reveal, which is
     a deliberate act that writes an audit row before it answers.
  2. The inventory works with no vault key at all. Hostnames, account names,
     whether an account is AD or local, and where the real credential lives are
     not secrets and must never be held hostage to a missing key.
  3. Nothing here is reachable from the agent interface. That is enforced in
     app/api/agent.py by not mounting these routes, not by a flag here.
"""
import re
from datetime import datetime
from typing import List, Optional
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import SecretAccess, Server, ServerAccount
from app.models.servers import ACCOUNT_TYPES, ENVIRONMENTS
from app.partial import make_lenient, make_partial, merge
from app.services import vault
from app.validation import Name, Timestamp, one_of

router = APIRouter()


# ----------------------------------------------------------------- schemas

class ServerSchema(BaseModel):
    id: Optional[int] = None
    name: Name
    hostname: Optional[str] = None
    ip_address: Optional[str] = None
    environment: str = "DC"
    os: Optional[str] = None
    role: Optional[str] = None
    ssh_port: Optional[int] = None
    rdp_port: Optional[int] = None
    system_id: Optional[int] = None
    department_id: Optional[int] = None
    vendor_id: Optional[int] = None
    owner_person_id: Optional[int] = None
    paired_server_id: Optional[int] = None
    notes: Optional[str] = None
    active: Optional[bool] = True

    _environment_is_known = one_of("environment", list(ENVIRONMENTS))

    class Config:
        from_attributes = True


class ServerOut(ServerSchema):
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class AccountSchema(BaseModel):
    id: Optional[int] = None
    server_id: Optional[int] = None
    username: Name
    account_type: str = "LOCAL"
    purpose: Optional[str] = None
    vault_location: Optional[str] = None
    last_rotated_at: Timestamp = None
    rotation_days: Optional[int] = None
    notes: Optional[str] = None
    active: Optional[bool] = True

    _type_is_known = one_of("account_type", list(ACCOUNT_TYPES))

    class Config:
        from_attributes = True


class AccountOut(AccountSchema):
    """What a read returns. There is no password field here, by design."""
    has_secret: Optional[bool] = False
    secret_readable: Optional[bool] = True
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class SecretBody(BaseModel):
    secret: Optional[str] = None


ServerPartial = make_partial(ServerSchema)
ServerOutLenient = make_lenient(ServerOut)
AccountPartial = make_partial(AccountSchema)
AccountOutLenient = make_lenient(AccountOut)


def _present(account: ServerAccount) -> dict:
    """Shape an account for the API, with the ciphertext removed entirely.

    Removed rather than nulled: a field that is sometimes a password and
    sometimes null is one refactor away from being returned by accident.
    """
    data = {c.name: getattr(account, c.name) for c in account.__table__.columns}
    stored = data.pop("secret_ciphertext", None)
    data["has_secret"] = bool(stored)
    # Says whether a reveal would work right now, so the UI can explain a
    # locked vault before the user clicks and gets an error.
    data["secret_readable"] = bool(stored) and vault.configured()
    return data


def _log(db: Session, account_id: int, action: str, detail: str = "") -> None:
    db.add(SecretAccess(account_id=account_id, action=action, detail=detail[:500]))


def _get_server(db: Session, server_id: int) -> Server:
    row = db.query(Server).filter(Server.id == server_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Server not found")
    return row


def _get_account(db: Session, account_id: int) -> ServerAccount:
    row = db.query(ServerAccount).filter(ServerAccount.id == account_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Account not found")
    return row


# ----------------------------------------------------------------- servers

@router.get("", response_model=List[ServerOutLenient])
def list_servers(
    db: Session = Depends(get_db),
    skip: int = Query(0),
    limit: int = Query(200),
    environment: Optional[str] = Query(None),
    system_id: Optional[int] = Query(None),
    include_inactive: bool = Query(False),
    q: Optional[str] = Query(None, description="Free text across name, hostname, IP and role"),
):
    query = db.query(Server)
    if not include_inactive:
        query = query.filter(Server.active.is_(True))
    if environment:
        query = query.filter(Server.environment == environment)
    if system_id:
        query = query.filter(Server.system_id == system_id)
    for word in (q or "").split():
        like = f"%{word}%"
        query = query.filter(
            or_(Server.name.ilike(like), Server.hostname.ilike(like),
                Server.ip_address.ilike(like), Server.role.ilike(like),
                Server.notes.ilike(like))
        )
    return query.order_by(Server.environment, Server.name).offset(skip).limit(limit).all()


@router.post("", response_model=ServerOutLenient)
def create_server(payload: ServerSchema, db: Session = Depends(get_db)):
    row = Server(**payload.dict(exclude={"id"}))
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.get("/vault-status")
def vault_status():
    """Whether passwords can be stored and read at all on this install."""
    return {
        "configured": vault.configured(),
        "env_var": vault.ENV_KEY,
        "detail": (
            "Passwords can be stored and revealed."
            if vault.configured()
            else "No vault key is set, so passwords cannot be stored. Everything "
                 "else about a server and its accounts works without one."
        ),
    }


@router.get("/{server_id}", response_model=ServerOutLenient)
def get_server(server_id: int, db: Session = Depends(get_db)):
    return _get_server(db, server_id)


@router.put("/{server_id}", response_model=ServerOutLenient)
def update_server(server_id: int, payload: ServerPartial, db: Session = Depends(get_db)):
    row = _get_server(db, server_id)
    merged = merge(ServerSchema, row, payload)
    for key, value in merged.dict(exclude={"id"}).items():
        setattr(row, key, value)
    row.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(row)
    return row


@router.delete("/{server_id}")
def delete_server(server_id: int, db: Session = Depends(get_db)):
    """Remove a server and the accounts recorded on it.

    The access log is kept. It refers to accounts that no longer exist, which
    is exactly the situation where someone will want to read it.
    """
    row = _get_server(db, server_id)
    accounts = db.query(ServerAccount).filter(ServerAccount.server_id == server_id).all()
    for account in accounts:
        db.delete(account)
    db.delete(row)
    db.commit()
    return {"message": "Server deleted", "accounts_removed": len(accounts)}


# ---------------------------------------------------------------- accounts

@router.get("/{server_id}/accounts", response_model=List[AccountOutLenient])
def list_accounts(server_id: int, db: Session = Depends(get_db),
                  include_inactive: bool = Query(False)):
    _get_server(db, server_id)
    query = db.query(ServerAccount).filter(ServerAccount.server_id == server_id)
    if not include_inactive:
        query = query.filter(ServerAccount.active.is_(True))
    rows = query.order_by(ServerAccount.account_type, ServerAccount.username).all()
    return [_present(a) for a in rows]


@router.post("/{server_id}/accounts", response_model=AccountOutLenient)
def create_account(server_id: int, payload: AccountSchema, db: Session = Depends(get_db)):
    _get_server(db, server_id)
    row = ServerAccount(**payload.dict(exclude={"id", "server_id"}), server_id=server_id)
    db.add(row)
    db.commit()
    db.refresh(row)
    return _present(row)


@router.put("/accounts/{account_id}", response_model=AccountOutLenient)
def update_account(account_id: int, payload: AccountPartial, db: Session = Depends(get_db)):
    row = _get_account(db, account_id)
    merged = merge(AccountSchema, row, payload)
    for key, value in merged.dict(exclude={"id", "server_id"}).items():
        setattr(row, key, value)
    row.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(row)
    return _present(row)


@router.delete("/accounts/{account_id}")
def delete_account(account_id: int, db: Session = Depends(get_db)):
    row = _get_account(db, account_id)
    if row.secret_ciphertext:
        _log(db, account_id, "CLEAR", "account deleted")
    db.delete(row)
    db.commit()
    return {"message": "Account deleted"}


# ------------------------------------------------------------------ secret

@router.put("/accounts/{account_id}/secret", response_model=AccountOutLenient)
def set_secret(account_id: int, body: SecretBody, db: Session = Depends(get_db)):
    """Store or clear the password for this account.

    Separate from the account's own update endpoint so that editing a username
    can never carry a password along with it by accident.
    """
    row = _get_account(db, account_id)

    if not body.secret:
        if row.secret_ciphertext:
            _log(db, account_id, "CLEAR", "cleared by user")
        row.secret_ciphertext = None
        row.updated_at = datetime.utcnow()
        db.commit()
        db.refresh(row)
        return _present(row)

    try:
        row.secret_ciphertext = vault.encrypt(body.secret)
    except vault.VaultLocked as e:
        _log(db, account_id, "DENIED", "no vault key configured")
        db.commit()
        raise HTTPException(status_code=409, detail=str(e))

    row.last_rotated_at = datetime.utcnow()
    row.updated_at = datetime.utcnow()
    _log(db, account_id, "SET", "password stored")
    db.commit()
    db.refresh(row)
    return _present(row)


@router.post("/accounts/{account_id}/reveal")
def reveal_secret(account_id: int, db: Session = Depends(get_db),
                  reason: Optional[str] = Query(None, description="Why, for the log")):
    """Return the plaintext password, and record that it happened.

    The log row is written whatever the outcome, including failures: an attempt
    to read a credential is worth knowing about even when it did not succeed.
    """
    row = _get_account(db, account_id)

    if not row.secret_ciphertext:
        raise HTTPException(
            status_code=404,
            detail="No password is stored for this account. Its vault location says "
                   "where the real credential lives.",
        )

    try:
        secret = vault.decrypt(row.secret_ciphertext)
    except vault.VaultLocked as e:
        _log(db, account_id, "DENIED", str(e)[:200])
        db.commit()
        raise HTTPException(status_code=409, detail=str(e))

    _log(db, account_id, "REVEAL", (reason or "no reason given")[:200])
    db.commit()
    return {"username": row.username, "secret": secret, "revealed_at": datetime.utcnow()}


@router.get("/accounts/{account_id}/access-log")
def access_log(account_id: int, db: Session = Depends(get_db), limit: int = Query(50)):
    _get_account(db, account_id)
    rows = (
        db.query(SecretAccess)
        .filter(SecretAccess.account_id == account_id)
        .order_by(SecretAccess.at.desc())
        .limit(limit).all()
    )
    return [
        {"id": r.id, "action": r.action, "at": r.at, "detail": r.detail}
        for r in rows
    ]


# ---------------------------------------------------------------- connecting
#
# What is and is not possible here, because the limits drive the design:
#
#   * An .rdp file cannot carry a password. Windows stores it as a DPAPI blob
#     encrypted to one user on one machine, so nothing generated on a server
#     could ever decrypt there. Microsoft did that deliberately.
#   * A password *can* go in an sftp:// URL, and it must not. A URL the browser
#     navigates to is written to history, and a bank credential in browser
#     history is exactly the thing the vault exists to avoid.
#
# So the password travels through the clipboard: one paste, and nothing written
# to disk or history. The launch itself carries host, port and username, which
# is the tedious part anyway.

CONNECT_METHODS = {
    "rdp":   {"label": "Remote Desktop", "default_port": 3389, "port_field": "rdp_port"},
    "sftp":  {"label": "WinSCP",         "default_port": 22,   "port_field": "ssh_port"},
    "ssh":   {"label": "MobaXterm",      "default_port": 22,   "port_field": "ssh_port"},
}


def _safe_filename(raw: str) -> str:
    """A download name that survives Windows. Backslashes are the usual culprit,
    since a domain account is written BANK\\svc_app and that is a path."""
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "-", raw).strip("-")
    return (cleaned or "connection")[:80]


def _rdp_file(host: str, port: int, username: str) -> str:
    """A minimal .rdp. Only the lines that change anything are included."""
    address = host if port == 3389 else f"{host}:{port}"
    return "\r\n".join([
        f"full address:s:{address}",
        f"username:s:{username}",
        "prompt for credentials:i:1",
        "screen mode id:i:2",
        "authentication level:i:2",
        "redirectclipboard:i:1",
        "",
    ])


@router.post("/accounts/{account_id}/connect")
def connect(account_id: int, method: str = Query(...), db: Session = Depends(get_db)):
    """Everything a client needs to open this account, and the password to paste.

    Audited exactly like a reveal, because that is what it is: the plaintext
    leaves the building either way, and a log that recorded only the careful
    route would be worse than no log at all.
    """
    method = (method or "").lower().strip()
    spec = CONNECT_METHODS.get(method)
    if not spec:
        raise HTTPException(
            status_code=422,
            detail=f"method must be one of: {', '.join(CONNECT_METHODS)}",
        )

    account = _get_account(db, account_id)
    server = db.query(Server).filter(Server.id == account.server_id).first()
    if not server:
        raise HTTPException(status_code=404, detail="That account's server is gone.")

    host = (server.hostname or server.ip_address or "").strip()
    if not host:
        raise HTTPException(
            status_code=422,
            detail=f"{server.name} has neither a hostname nor an IP address, so there "
                   f"is nothing to connect to. Add one and try again.",
        )

    port = getattr(server, spec["port_field"], None) or spec["default_port"]
    explicit = port != spec["default_port"]

    secret = None
    secret_error = None
    if account.secret_ciphertext:
        try:
            secret = vault.decrypt(account.secret_ciphertext)
        except vault.VaultLocked as e:
            # Not fatal: the link is still worth having without the password.
            secret_error = str(e)
            _log(db, account_id, "DENIED", f"connect with {method}: {str(e)[:150]}")

    if method == "rdp":
        launch = {
            "kind": "file",
            "filename": _safe_filename(f"{server.name}-{account.username}") + ".rdp",
            "content": _rdp_file(host, port, account.username),
            "mime": "application/x-rdp",
        }
    else:
        # No credentials in the URI. The username is fine - it is not the
        # secret - but it has to be encoded: a domain account is written
        # BANK\svc_app, and a raw backslash in the userinfo is not a legal URI.
        user = quote(account.username, safe="")
        authority = f"{user}@{host}" + (f":{port}" if explicit else "")
        launch = {"kind": "uri", "value": f"{method}://{authority}/"}

    if secret:
        _log(db, account_id, "LAUNCH", f"opened with {spec['label']}")
        db.commit()

    return {
        "method": method,
        "label": spec["label"],
        "host": host,
        "port": port,
        "port_is_default": not explicit,
        "username": account.username,
        "secret": secret,
        "secret_error": secret_error,
        "launch": launch,
        # Shown in the UI and copyable, for anyone who would rather type it.
        "command": _command(method, host, port, explicit, account.username),
    }


def _command(method: str, host: str, port: int, explicit: bool, user: str) -> str:
    if method == "rdp":
        return f"mstsc /v:{host}:{port}" if explicit else f"mstsc /v:{host}"
    if method == "sftp":
        tail = f":{port}" if explicit else ""
        return f'winscp.exe "sftp://{user}@{host}{tail}/"'
    tail = f" -p {port}" if explicit else ""
    return f"ssh {user}@{host}{tail}"
