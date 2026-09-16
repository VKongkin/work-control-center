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

from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import KnowledgeArticle, Server, Task
from app.models.knowledge import KINDS
from app.models.knowledge import STATUSES as ARTICLE_STATUSES
from app.models.servers import ENVIRONMENTS
from app.models.tasks import TaskPriority, TaskStatus

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


# ------------------------------------------------------- speaking model-ese
#
# A model writes what a person would write. Asked to raise an urgent task it
# sends priority "high", not "P1_HIGH", and it invents "TODO" for a status
# because that is what every other tracker calls it. Rejecting those is
# technically correct and practically useless: the tool call fails, and a
# failed tool call is where an agent stops.
#
# So: accept the obvious synonyms, and when a value really is unrecognisable,
# say what the allowed ones are in the error itself, because that error text is
# the only thing the model gets to read before trying again.

TASK_PRIORITIES = tuple(p.value for p in TaskPriority)
TASK_STATUSES = tuple(s.value for s in TaskStatus)

PRIORITY_ALIASES = {
    "critical": "P0_CRITICAL", "urgent": "P0_CRITICAL", "highest": "P0_CRITICAL",
    "p0": "P0_CRITICAL", "blocker": "P0_CRITICAL",
    "high": "P1_HIGH", "p1": "P1_HIGH", "important": "P1_HIGH",
    "medium": "P2_MEDIUM", "normal": "P2_MEDIUM", "moderate": "P2_MEDIUM",
    "p2": "P2_MEDIUM", "default": "P2_MEDIUM",
    "low": "P3_LOW", "p3": "P3_LOW", "minor": "P3_LOW", "lowest": "P3_LOW",
}

TASK_STATUS_ALIASES = {
    "todo": "INBOX", "to do": "INBOX", "new": "INBOX", "backlog": "INBOX",
    "open": "PENDING", "not started": "PENDING", "planned": "PENDING",
    "in progress": "IN_PROGRESS", "inprogress": "IN_PROGRESS", "doing": "IN_PROGRESS",
    "started": "IN_PROGRESS", "active": "IN_PROGRESS", "wip": "IN_PROGRESS",
    "blocked": "BLOCKED", "waiting": "BLOCKED", "on hold": "BLOCKED", "stuck": "BLOCKED",
    "done": "COMPLETED", "complete": "COMPLETED", "completed": "COMPLETED",
    "finished": "COMPLETED", "closed": "COMPLETED", "resolved": "COMPLETED",
    "cancelled": "CANCELLED", "canceled": "CANCELLED", "abandoned": "CANCELLED",
    "wont do": "CANCELLED", "won't do": "CANCELLED",
}

ARTICLE_KIND_ALIASES = {
    "runbook": "RUNBOOK", "run book": "RUNBOOK", "procedure": "RUNBOOK",
    "sop": "RUNBOOK", "playbook": "RUNBOOK",
    "guide": "GUIDE", "install guide": "GUIDE", "installation": "GUIDE",
    "how-to": "GUIDE", "howto": "GUIDE", "tutorial": "GUIDE",
    "note": "NOTE", "notes": "NOTE", "memo": "NOTE",
    "reference": "REFERENCE", "ref": "REFERENCE", "cheatsheet": "REFERENCE",
    "cheat sheet": "REFERENCE",
}

ARTICLE_STATUS_ALIASES = {
    "draft": "DRAFT", "wip": "DRAFT", "in progress": "DRAFT",
    "published": "PUBLISHED", "public": "PUBLISHED", "live": "PUBLISHED",
    "final": "PUBLISHED", "done": "PUBLISHED",
    "archived": "ARCHIVED", "old": "ARCHIVED", "retired": "ARCHIVED",
}


def _parse_date(value: Optional[str]) -> Optional[datetime]:
    """Accept the date formats a model reaches for, and name the good one if not.

    A model will happily write "next Friday" - it cannot be talked out of it in
    a schema description, so the error has to be the thing that teaches it.
    """
    if not value:
        return None
    raw = str(value).strip()
    for form in (raw, raw.replace("Z", ""), raw.replace(" ", "T"), raw[:10]):
        try:
            return datetime.fromisoformat(form)
        except (ValueError, TypeError):
            continue
    raise ValueError(
        f"due_date was {raw!r}, which is not a date this understands. Use "
        f"YYYY-MM-DD or YYYY-MM-DDTHH:MM - for example 2026-09-30 or "
        f"2026-09-30T14:00. Work out the actual calendar date first; relative "
        f"wording like 'next Friday' cannot be stored."
    )


def coerce(value: Optional[str], field: str, valid: tuple,
           aliases: Optional[Dict[str, str]] = None) -> Optional[str]:
    """Map what the model wrote onto what the database accepts, or explain."""
    if value is None or value == "":
        return None
    raw = str(value).strip()
    squashed = raw.upper().replace(" ", "_").replace("-", "_")
    if squashed in valid:
        return squashed
    key = raw.lower().replace("_", " ").strip()
    if aliases:
        if key in aliases:
            return aliases[key]
        if key.replace(" ", "") in aliases:
            return aliases[key.replace(" ", "")]
    raise ValueError(
        f"{field} was {raw!r}, which is not one of: {', '.join(valid)}. "
        f"Call the tool again with one of those."
    )


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
        q = q.filter(KnowledgeArticle.kind == coerce(kind, "kind", KINDS, ARTICLE_KIND_ALIASES))
    if environment:
        env = coerce(environment, "environment", ENVIRONMENTS + ("ALL",))
        q = q.filter(or_(KnowledgeArticle.environment == env,
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
    kind = coerce(kind, "kind", KINDS, ARTICLE_KIND_ALIASES) or "NOTE"
    status = coerce(status, "status", ARTICLE_STATUSES, ARTICLE_STATUS_ALIASES) or "DRAFT"
    environment = coerce(environment, "environment", ENVIRONMENTS + ("ALL",))
    row = KnowledgeArticle(
        title=title.strip(), body=body, kind=kind, summary=summary, tags=tags,
        environment=environment, status=status,
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
        row.kind = coerce(kind, "kind", KINDS, ARTICLE_KIND_ALIASES)
    if status is not None:
        row.status = coerce(status, "status", ARTICLE_STATUSES, ARTICLE_STATUS_ALIASES)
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
        q = q.filter(Task.status == coerce(status, "status", TASK_STATUSES, TASK_STATUS_ALIASES))
    if priority:
        q = q.filter(Task.priority == coerce(priority, "priority", TASK_PRIORITIES, PRIORITY_ALIASES))
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
    priority = coerce(priority, "priority", TASK_PRIORITIES, PRIORITY_ALIASES) or "P2_MEDIUM"
    status = coerce(status, "status", TASK_STATUSES, TASK_STATUS_ALIASES) or "INBOX"
    due = _parse_date(due_date)
    row = Task(title=title.strip(), priority=priority, status=status,
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
        row.status = coerce(status, "status", TASK_STATUSES, TASK_STATUS_ALIASES)
    if priority:
        row.priority = coerce(priority, "priority", TASK_PRIORITIES, PRIORITY_ALIASES)
    if next_action is not None:
        row.next_action = next_action
    if due_date is not None:
        row.due_date = _parse_date(due_date)
    row.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(row)
    return _task(row)


def list_servers(db: Session, environment: Optional[str] = None,
                 query: str = "", limit: int = 50) -> Dict[str, Any]:
    """Inventory only. No accounts unless explicitly switched on, never secrets."""
    q = db.query(Server).filter(Server.active.is_(True))
    if environment:
        q = q.filter(Server.environment == coerce(environment, "environment", ENVIRONMENTS))
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
        "description": (
            "List the user's work items, newest due first. Use this to answer "
            "'what am I working on', to find something that is late, and to get "
            "a task's id before calling update_task."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "status": {"type": "string", "enum": list(TASK_STATUSES)},
                "priority": {"type": "string", "enum": list(TASK_PRIORITIES)},
                "overdue_only": {"type": "boolean", "default": False},
                "query": {"type": "string",
                          "description": "Words to match in the title or description, "
                                         "in any order."},
                "limit": {"type": "integer", "default": 25},
            },
            "additionalProperties": False,
        },
        "handler": list_tasks,
    },
    {
        "name": "create_task",
        "description": (
            "Add a work item to the user's task list. Use this whenever they ask "
            "for something to be noted, tracked, remembered or raised as a task. "
            "New items land in the INBOX to be triaged. Returns the created task "
            "including its id."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "title": {"type": "string",
                          "description": "What needs doing, in one line. Required."},
                "priority": {"type": "string", "enum": list(TASK_PRIORITIES),
                             "default": "P2_MEDIUM",
                             "description": "Plain words like 'high' or 'urgent' are understood."},
                "due_date": {"type": "string",
                             "description": "YYYY-MM-DD or YYYY-MM-DDTHH:MM. Resolve "
                                            "relative dates to a real date first; "
                                            "'next Friday' is not accepted."},
                "description": {"type": "string", "description": "Any detail worth keeping."},
                "status": {"type": "string", "enum": list(TASK_STATUSES),
                           "default": "INBOX"},
            },
            "required": ["title"],
            "additionalProperties": False,
        },
        "handler": create_task,
    },
    {
        "name": "update_task",
        "description": (
            "Change an existing work item's status, priority, due date or next "
            "action. Get the id from list_tasks first - do not guess it."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "id": {"type": "integer",
                       "description": "The task's id, as returned by list_tasks."},
                "status": {"type": "string", "enum": list(TASK_STATUSES)},
                "priority": {"type": "string", "enum": list(TASK_PRIORITIES)},
                "due_date": {"type": "string",
                             "description": "YYYY-MM-DD or YYYY-MM-DDTHH:MM."},
                "next_action": {"type": "string",
                                "description": "The single next physical step."},
            },
            "required": ["id"],
            "additionalProperties": False,
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


def _explain(name: str, exc: Exception) -> str:
    """Turn an exception into something a model can act on.

    Two failures are worth rewriting by hand. A missing argument arrives as a
    Python TypeError naming a "required positional argument", which tells a
    model nothing about the tool it just called. And anything unforeseen would
    otherwise reach the client as a stack-trace-shaped string or, worse, a bare
    500 - so it gets a sentence that at least says which tool failed and what
    the tool accepts.
    """
    if isinstance(exc, (ValueError, LookupError)):
        return str(exc)

    tool = BY_NAME.get(name)
    fields = list((tool or {}).get("inputSchema", {}).get("properties", {}))
    required = list((tool or {}).get("inputSchema", {}).get("required", []))

    if isinstance(exc, TypeError) and "required positional argument" in str(exc):
        missing = str(exc).split("argument:")[-1].strip().strip("'\"")
        return (
            f"{name} needs {missing}, and it was not supplied. "
            f"Required: {', '.join(required) or 'none'}. "
            f"Accepted: {', '.join(fields) or 'none'}."
        )

    return (
        f"{name} could not complete: {type(exc).__name__}: {str(exc)[:300]}. "
        f"It accepts: {', '.join(fields) or 'none'}."
    )


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
        replies = [r for r in [await _dispatch(m, db) for m in message] if r is not None]
    else:
        replies = await _dispatch(message, db)

    # A notification - `notifications/initialized`, which every client sends
    # immediately after the handshake - has no reply at all. Streamable HTTP
    # says answer it with 202 and an empty body; returning `null` with a 200
    # looks like a malformed response to a strict client and can fail the
    # connection before the first tool call.
    if replies is None or replies == []:
        return Response(status_code=202)
    return replies


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
                "guides, work items and server inventory.\n\n"
                "Use it rather than answering from memory:\n"
                "- Anything to note, track, remember or raise becomes a task via "
                "create_task. Only `title` is required. New tasks land in INBOX.\n"
                "- Before update_task, call list_tasks to get the real id. Never "
                "invent one.\n"
                "- Before writing a new article, search_knowledge first - if one "
                "already covers it, use update_knowledge with `append` rather than "
                "creating a duplicate or rewriting the whole body.\n"
                "- Resolve relative dates ('next Friday') to a real YYYY-MM-DD "
                "before sending them. Dates are not parsed from words.\n"
                "- Plain words for priority and status ('high', 'done') are "
                "understood and normalised.\n\n"
                "If a tool call comes back with isError, the message says what was "
                "wrong and what the accepted values are. Read it and call the tool "
                "again with corrections - do not abandon the task.\n\n"
                "Passwords are deliberately not available through this interface. "
                "If asked for one, say which vault holds it instead."
            ),
        })

    if method in ("notifications/initialized", "initialized"):
        return None  # a notification has no reply

    # Not advertised in capabilities, but clients probe for them anyway. An
    # empty list is a truthful answer and keeps their logs clean; an error here
    # reads like a broken server.
    if method == "resources/list":
        return _result(request_id, {"resources": []})
    if method == "resources/templates/list":
        return _result(request_id, {"resourceTemplates": []})
    if method == "prompts/list":
        return _result(request_id, {"prompts": []})

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
        except Exception as e:
            # Every failure from a tool comes back as an isError *result*, never
            # as a JSON-RPC error and never as a 500. This is the difference
            # between an agent that reads the message and tries again, and one
            # that receives an unparsable transport failure and stops dead.
            db.rollback()
            return _result(request_id, {
                "content": [{"type": "text", "text": _explain(name, e)}],
                "isError": True,
            })
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
        raise HTTPException(status_code=404, detail=_explain(name, e))
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=422, detail=_explain(name, e))


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
