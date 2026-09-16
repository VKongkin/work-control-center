"""The interface an AI agent talks to - Microsoft Copilot, or anything else.

Two shapes over one set of operations: an MCP server at `/api/agent/mcp` and an
OpenAPI document at `/api/agent/openapi.json` describing the same operations as
plain REST. Copilot can consume either; which one to use depends on how the
endpoint ends up being published, and that decision can be made later without
changing anything here.

**Secrets are not reachable from this module, and that is structural.** There is
no tool that returns a password, because nothing here imports the vault and no
route mounted under this router touches `secret_ciphertext`. Adding one would
mean writing new code, not flipping a flag - which is the point. Anything sent
to an agent may end up in a third party's prompt logs, and a bank's server
passwords must never be in that set.

Account *names* are a softer case: useful to be asked about, but still
reconnaissance. They are off unless WCC_AGENT_EXPOSE_ACCOUNTS says otherwise.
"""
import json
import os
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import KnowledgeArticle, Server, Task
from app.models.knowledge import KINDS

router = APIRouter()

PROTOCOL_VERSION = "2025-06-18"
SERVER_NAME = "work-control-center"
SERVER_VERSION = "1.0.0"


# --------------------------------------------------------------------- auth

def _expected_key() -> str:
    return os.getenv("WCC_AGENT_KEY", "").strip()


def agent_enabled() -> bool:
    """Off until a key is set. An unauthenticated write API is not a default."""
    return bool(_expected_key())


def require_key(
    x_api_key: Optional[str] = Header(None, alias="X-API-Key"),
    authorization: Optional[str] = Header(None),
) -> None:
    expected = _expected_key()
    if not expected:
        raise HTTPException(
            status_code=503,
            detail="The agent interface is switched off. Set WCC_AGENT_KEY in the "
                   "environment to enable it.",
        )
    supplied = x_api_key
    if not supplied and authorization and authorization.lower().startswith("bearer "):
        supplied = authorization[7:].strip()
    # Compared in constant time: a key that can be guessed a character at a
    # time from response timings is not much of a key.
    import hmac
    if not supplied or not hmac.compare_digest(supplied, expected):
        raise HTTPException(status_code=401, detail="Bad or missing API key.")


def expose_accounts() -> bool:
    return os.getenv("WCC_AGENT_EXPOSE_ACCOUNTS", "0").strip().lower() in ("1", "true", "yes", "on")


# ---------------------------------------------------------------- the tools
#
# Each returns plain data. They are shared by the REST routes and the MCP
# handler so the two can never drift apart.

def _article(row: KnowledgeArticle, body: bool = True) -> Dict[str, Any]:
    out = {
        "id": row.id, "title": row.title, "kind": row.kind, "status": row.status,
        "summary": row.summary, "tags": row.tags, "environment": row.environment,
        "last_verified_at": row.last_verified_at.isoformat() if row.last_verified_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }
    if body:
        out["body"] = row.body
    return out


def search_knowledge(db: Session, query: str = "", kind: Optional[str] = None,
                     environment: Optional[str] = None, limit: int = 20) -> Dict[str, Any]:
    q = db.query(KnowledgeArticle)
    if kind:
        q = q.filter(KnowledgeArticle.kind == kind.upper())
    if environment:
        q = q.filter(or_(KnowledgeArticle.environment == environment.upper(),
                         KnowledgeArticle.environment == "ALL"))
    if query:
        # Same word-by-word matching the page uses, so an agent asking for
        # "websphere restart" finds "Restart WebSphere on DC".
        from app.api.knowledge import text_filter
        q = text_filter(q, query)
    rows = q.order_by(KnowledgeArticle.updated_at.desc()).limit(min(limit, 50)).all()
    # Summaries only: a search that returned twenty full runbooks would fill the
    # agent's context with text nobody asked for.
    return {"count": len(rows), "results": [_article(r, body=False) for r in rows]}


def get_knowledge(db: Session, id: int) -> Dict[str, Any]:
    row = db.query(KnowledgeArticle).filter(KnowledgeArticle.id == id).first()
    if not row:
        raise LookupError(f"No article with id {id}")
    return _article(row)


def create_knowledge(db: Session, title: str, body: Optional[str] = None,
                     kind: str = "NOTE", summary: Optional[str] = None,
                     tags: Optional[str] = None, environment: Optional[str] = None,
                     status: str = "DRAFT") -> Dict[str, Any]:
    if not (title or "").strip():
        raise ValueError("A title is required.")
    kind = (kind or "NOTE").upper()
    if kind not in KINDS:
        raise ValueError(f"kind must be one of: {', '.join(KINDS)}")
    row = KnowledgeArticle(
        title=title.strip(), body=body, kind=kind, summary=summary, tags=tags,
        environment=(environment or None) and environment.upper(), status=status.upper(),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _article(row)


def update_knowledge(db: Session, id: int, title: Optional[str] = None,
                     body: Optional[str] = None, summary: Optional[str] = None,
                     tags: Optional[str] = None, kind: Optional[str] = None,
                     status: Optional[str] = None,
                     append: Optional[str] = None) -> Dict[str, Any]:
    row = db.query(KnowledgeArticle).filter(KnowledgeArticle.id == id).first()
    if not row:
        raise LookupError(f"No article with id {id}")
    if title is not None:
        row.title = title
    if summary is not None:
        row.summary = summary
    if tags is not None:
        row.tags = tags
    if kind is not None:
        row.kind = kind.upper()
    if status is not None:
        row.status = status.upper()
    if body is not None:
        row.body = body
    # Appending is offered separately because an agent asked to "add a step to
    # this runbook" will otherwise rewrite the whole document from memory and
    # quietly lose whatever it did not think to repeat.
    if append:
        row.body = f"{row.body}\n\n{append}" if row.body else append
    row.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(row)
    return _article(row)


def _task(row: Task) -> Dict[str, Any]:
    return {
        "id": row.id, "title": row.title, "status": row.status, "priority": row.priority,
        "due_date": row.due_date.isoformat() if row.due_date else None,
        "next_action": row.next_action, "blocked_reason": row.blocked_reason,
        "description": row.description,
    }


def list_tasks(db: Session, status: Optional[str] = None, priority: Optional[str] = None,
               overdue_only: bool = False, query: str = "", limit: int = 25) -> Dict[str, Any]:
    q = db.query(Task)
    if status:
        q = q.filter(Task.status == status.upper())
    if priority:
        q = q.filter(Task.priority == priority.upper())
    if overdue_only:
        q = q.filter(Task.due_date < datetime.utcnow(),
                     ~Task.status.in_(["COMPLETED", "CANCELLED"]))
    for word in (query or "").split():
        like = f"%{word}%"
        q = q.filter(or_(Task.title.ilike(like), Task.description.ilike(like)))
    rows = q.order_by(Task.due_date.asc().nullslast()).limit(min(limit, 100)).all()
    return {"count": len(rows), "results": [_task(r) for r in rows]}


def create_task(db: Session, title: str, priority: str = "P2_MEDIUM",
                due_date: Optional[str] = None, description: Optional[str] = None,
                status: str = "INBOX") -> Dict[str, Any]:
    if not (title or "").strip():
        raise ValueError("A title is required.")
    due = None
    if due_date:
        try:
            due = datetime.fromisoformat(due_date.replace("Z", ""))
        except ValueError:
            raise ValueError("due_date must look like 2026-09-30 or 2026-09-30T14:00")
    row = Task(title=title.strip(), priority=priority.upper(), status=status.upper(),
               due_date=due, description=description)
    db.add(row)
    db.commit()
    db.refresh(row)
    return _task(row)


def update_task(db: Session, id: int, status: Optional[str] = None,
                priority: Optional[str] = None, due_date: Optional[str] = None,
                next_action: Optional[str] = None) -> Dict[str, Any]:
    row = db.query(Task).filter(Task.id == id).first()
    if not row:
        raise LookupError(f"No task with id {id}")
    if status:
        row.status = status.upper()
    if priority:
        row.priority = priority.upper()
    if next_action is not None:
        row.next_action = next_action
    if due_date is not None:
        row.due_date = datetime.fromisoformat(due_date.replace("Z", "")) if due_date else None
    row.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(row)
    return _task(row)


def list_servers(db: Session, environment: Optional[str] = None,
                 query: str = "", limit: int = 50) -> Dict[str, Any]:
    """Inventory only. No accounts unless explicitly switched on, never secrets."""
    q = db.query(Server).filter(Server.active.is_(True))
    if environment:
        q = q.filter(Server.environment == environment.upper())
    for word in (query or "").split():
        like = f"%{word}%"
        q = q.filter(or_(Server.name.ilike(like), Server.hostname.ilike(like),
                         Server.role.ilike(like), Server.ip_address.ilike(like)))
    rows = q.order_by(Server.environment, Server.name).limit(min(limit, 200)).all()

    out = []
    for r in rows:
        entry = {
            "id": r.id, "name": r.name, "hostname": r.hostname,
            "environment": r.environment, "os": r.os, "role": r.role,
            "notes": r.notes,
        }
        if expose_accounts():
            from app.models import ServerAccount
            accounts = (
                db.query(ServerAccount)
                .filter(ServerAccount.server_id == r.id, ServerAccount.active.is_(True)).all()
            )
            # Username, type and where the real credential lives. Never the
            # password, and the ciphertext is not read at all.
            entry["accounts"] = [
                {"username": a.username, "type": a.account_type,
                 "purpose": a.purpose, "credential_held_in": a.vault_location}
                for a in accounts
            ]
        out.append(entry)
    return {"count": len(out), "results": out, "accounts_included": expose_accounts()}


TOOLS: List[Dict[str, Any]] = [
    {
        "name": "search_knowledge",
        "description": "Search saved notes, runbooks, install guides and reference material "
                       "by free text. Returns summaries; call get_knowledge for the full text.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Words to look for"},
                "kind": {"type": "string", "enum": list(KINDS)},
                "environment": {"type": "string", "enum": ["DC", "DR", "UAT", "SIT", "DEV", "ALL"]},
                "limit": {"type": "integer", "default": 20},
            },
        },
        "handler": search_knowledge,
    },
    {
        "name": "get_knowledge",
        "description": "Read one note or runbook in full, including its body.",
        "inputSchema": {
            "type": "object",
            "properties": {"id": {"type": "integer"}},
            "required": ["id"],
        },
        "handler": get_knowledge,
    },
    {
        "name": "create_knowledge",
        "description": "Save a new note, runbook, guide or reference entry.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "title": {"type": "string"},
                "body": {"type": "string", "description": "Markdown"},
                "kind": {"type": "string", "enum": list(KINDS), "default": "NOTE"},
                "summary": {"type": "string"},
                "tags": {"type": "string", "description": "Comma separated"},
                "environment": {"type": "string", "enum": ["DC", "DR", "UAT", "SIT", "DEV", "ALL"]},
                "status": {"type": "string", "enum": ["DRAFT", "PUBLISHED"], "default": "DRAFT"},
            },
            "required": ["title"],
        },
        "handler": create_knowledge,
    },
    {
        "name": "update_knowledge",
        "description": "Change a note or runbook. Use `append` to add to the end of the body "
                       "without rewriting what is already there.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "id": {"type": "integer"},
                "title": {"type": "string"},
                "body": {"type": "string", "description": "Replaces the whole body"},
                "append": {"type": "string", "description": "Added to the end of the body"},
                "summary": {"type": "string"},
                "tags": {"type": "string"},
                "kind": {"type": "string", "enum": list(KINDS)},
                "status": {"type": "string", "enum": ["DRAFT", "PUBLISHED", "ARCHIVED"]},
            },
            "required": ["id"],
        },
        "handler": update_knowledge,
    },
    {
        "name": "list_tasks",
        "description": "List work items, optionally only the overdue ones.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "status": {"type": "string"},
                "priority": {"type": "string"},
                "overdue_only": {"type": "boolean", "default": False},
                "query": {"type": "string"},
                "limit": {"type": "integer", "default": 25},
            },
        },
        "handler": list_tasks,
    },
    {
        "name": "create_task",
        "description": "Add a work item.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "title": {"type": "string"},
                "priority": {"type": "string",
                             "enum": ["P0_CRITICAL", "P1_HIGH", "P2_MEDIUM", "P3_LOW"]},
                "due_date": {"type": "string", "description": "2026-09-30 or 2026-09-30T14:00"},
                "description": {"type": "string"},
                "status": {"type": "string"},
            },
            "required": ["title"],
        },
        "handler": create_task,
    },
    {
        "name": "update_task",
        "description": "Change a work item's status, priority, due date or next action.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "id": {"type": "integer"},
                "status": {"type": "string"},
                "priority": {"type": "string"},
                "due_date": {"type": "string"},
                "next_action": {"type": "string"},
            },
            "required": ["id"],
        },
        "handler": update_task,
    },
    {
        "name": "list_servers",
        "description": "Look up servers in the inventory: hostname, environment (DC or DR), "
                       "operating system and what runs on them. Passwords are never returned "
                       "by this or any other tool.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "environment": {"type": "string", "enum": ["DC", "DR", "UAT", "SIT", "DEV"]},
                "query": {"type": "string"},
                "limit": {"type": "integer", "default": 50},
            },
        },
        "handler": list_servers,
    },
]

BY_NAME = {t["name"]: t for t in TOOLS}


def _run(db: Session, name: str, args: Dict[str, Any]) -> Dict[str, Any]:
    tool = BY_NAME.get(name)
    if not tool:
        raise LookupError(f"No tool named {name}")
    allowed = set(tool["inputSchema"].get("properties", {}))
    clean = {k: v for k, v in (args or {}).items() if k in allowed}
    return tool["handler"](db, **clean)


# ----------------------------------------------------------------- MCP over HTTP

def _result(request_id: Any, payload: Dict[str, Any]) -> Dict[str, Any]:
    return {"jsonrpc": "2.0", "id": request_id, "result": payload}


def _error(request_id: Any, code: int, message: str) -> Dict[str, Any]:
    return {"jsonrpc": "2.0", "id": request_id, "error": {"code": code, "message": message}}


@router.post("/mcp", dependencies=[Depends(require_key)])
async def mcp(request: Request, db: Session = Depends(get_db)):
    """A minimal MCP server over streamable HTTP.

    Hand-rolled rather than pulled from a library: the surface needed is three
    methods, and a dependency that reaches the outside of a bank's network is a
    conversation nobody wants to have over four handlers.
    """
    try:
        message = await request.json()
    except Exception:
        return _error(None, -32700, "Parse error")

    # A batch is legal JSON-RPC; answer each part in turn.
    if isinstance(message, list):
        return [await _dispatch(m, db) for m in message]
    return await _dispatch(message, db)


async def _dispatch(message: Dict[str, Any], db: Session) -> Any:
    request_id = message.get("id")
    method = message.get("method")
    params = message.get("params") or {}

    if method == "initialize":
        return _result(request_id, {
            "protocolVersion": PROTOCOL_VERSION,
            "capabilities": {"tools": {"listChanged": False}},
            "serverInfo": {"name": SERVER_NAME, "version": SERVER_VERSION},
            "instructions": (
                "Work Control Center holds this engineer's notes, runbooks, install "
                "guides, work items and server inventory. Search before answering from "
                "memory. Passwords are deliberately not available through this "
                "interface; if asked for one, say where the credential is held instead."
            ),
        })

    if method in ("notifications/initialized", "initialized"):
        return None  # a notification has no reply

    if method == "ping":
        return _result(request_id, {})

    if method == "tools/list":
        return _result(request_id, {
            "tools": [
                {"name": t["name"], "description": t["description"],
                 "inputSchema": t["inputSchema"]}
                for t in TOOLS
            ]
        })

    if method == "tools/call":
        name = params.get("name")
        try:
            data = _run(db, name, params.get("arguments") or {})
        except LookupError as e:
            return _result(request_id, {
                "content": [{"type": "text", "text": str(e)}], "isError": True})
        except (ValueError, TypeError) as e:
            return _result(request_id, {
                "content": [{"type": "text", "text": str(e)}], "isError": True})
        return _result(request_id, {
            "content": [{"type": "text", "text": json.dumps(data, default=str)}],
            "structuredContent": data,
            "isError": False,
        })

    return _error(request_id, -32601, f"Method not found: {method}")


# --------------------------------------------------------- REST + OpenAPI

@router.post("/tools/{name}", dependencies=[Depends(require_key)])
def call_tool(name: str, body: Optional[Dict[str, Any]] = None, db: Session = Depends(get_db)):
    """The same operations as plain REST, for an OpenAPI-based plugin."""
    try:
        return _run(db, name, body or {})
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except (ValueError, TypeError) as e:
        raise HTTPException(status_code=422, detail=str(e))


@router.get("/openapi.json")
def agent_openapi(request: Request):
    """A hand-written OpenAPI document covering exactly the agent operations.

    Not FastAPI's generated one: that describes the whole application, including
    every route that touches a credential. An agent should be handed a map of
    where it may go, not the map of everywhere.
    """
    base = str(request.base_url).rstrip("/")
    paths: Dict[str, Any] = {}
    for tool in TOOLS:
        paths[f"/api/agent/tools/{tool['name']}"] = {
            "post": {
                "operationId": tool["name"],
                "summary": tool["description"],
                "requestBody": {
                    "required": bool(tool["inputSchema"].get("required")),
                    "content": {"application/json": {"schema": tool["inputSchema"]}},
                },
                "responses": {
                    "200": {
                        "description": "Result",
                        "content": {"application/json": {"schema": {"type": "object"}}},
                    }
                },
            }
        }
    return {
        "openapi": "3.0.3",
        "info": {
            "title": "Work Control Center — agent interface",
            "version": SERVER_VERSION,
            "description": (
                "Notes, runbooks, work items and server inventory. Passwords are not "
                "exposed by any operation in this document."
            ),
        },
        "servers": [{"url": base}],
        "components": {
            "securitySchemes": {
                "apiKey": {"type": "apiKey", "in": "header", "name": "X-API-Key"}
            }
        },
        "security": [{"apiKey": []}],
        "paths": paths,
    }


@router.get("/status")
def agent_status():
    """Whether the interface is on, and what it will and will not hand over."""
    return {
        "enabled": agent_enabled(),
        "protocol_version": PROTOCOL_VERSION,
        "tools": [t["name"] for t in TOOLS],
        "accounts_included": expose_accounts(),
        "secrets_included": False,
        "detail": (
            "Enabled. Point an MCP client at /api/agent/mcp, or use "
            "/api/agent/openapi.json as an API plugin."
            if agent_enabled()
            else "Switched off. Set WCC_AGENT_KEY to enable it."
        ),
    }
