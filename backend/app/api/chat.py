"""The chat page's back end: a model, the WCC tools, and the loop between them.

This is the same capability the MCP endpoint offers, reached a different way.
`app/api/agent.py` publishes the tools *for someone else's* assistant - Copilot
Studio, VS Code, LM Studio. This module runs the loop itself, so the chat inside
WCC needs no client, no MCP configuration and no key pasted in every morning.

Both read the same `agent.TOOLS`. That is the point: a tool added once is
available in both places and cannot drift, and the guarantee that matters most -
no tool returns a password - holds here for exactly the same structural reason
it holds there. This module does not import the vault either.

The loop runs on the server, not in the browser, because the model's key must
not be in a page anyone can read and the tools are server-side anyway.
"""
import json
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api import agent
from app.database import get_db
from app.models import ChatMessage, ChatThread
from app.services import llm

router = APIRouter()

# How many times the model may call tools before answering. A model that has
# not finished after this many rounds is looping, and the honest thing is to
# stop and say so rather than bill somebody for the next fifty.
MAX_ROUNDS = 6

SYSTEM_PROMPT = """You are the assistant inside Work Control Center (WCC), a \
middleware engineer's own system. It holds their runbooks, install guides, \
notes, tasks and server inventory.

Use the tools rather than answering from memory. Anything they ask to note, \
track or remember becomes a task. Search the knowledge base before saying you \
do not know, and before writing a new article - if one already covers the \
topic, append to it rather than creating a near-duplicate.

Get ids from a list tool before updating anything; never invent one. Resolve \
relative dates yourself and send YYYY-MM-DD.

Answer in markdown, briefly. When you have used a tool, say plainly what you \
changed - this person needs to know what happened to their data.

Passwords are deliberately unavailable to you. If asked for one, use \
list_servers and say which vault holds it."""


# ------------------------------------------------------------------ schemas

class ThreadOut(BaseModel):
    id: int
    title: str
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class Ask(BaseModel):
    message: str


# -------------------------------------------------------------------- tools

def openai_tools() -> List[Dict[str, Any]]:
    """The same tools the MCP endpoint lists, in function-calling shape."""
    return [
        {
            "type": "function",
            "function": {
                "name": t["name"],
                "description": t["description"],
                "parameters": t["inputSchema"],
            },
        }
        for t in agent.TOOLS
    ]


def run_tool(db: Session, name: str, arguments: str) -> str:
    """Execute one call and return what the model should see.

    Every failure comes back as readable text rather than an exception, for the
    same reason it does over MCP: a model that receives an error it can read
    corrects itself, and one that receives a transport failure stops.
    """
    try:
        args = json.loads(arguments) if arguments else {}
        if not isinstance(args, dict):
            raise ValueError("arguments must be a JSON object")
    except (json.JSONDecodeError, ValueError) as e:
        return f"Could not read the arguments for {name}: {e}. Send valid JSON."

    try:
        return json.dumps(agent._run(db, name, args), default=str)[:12000]
    except Exception as e:                      # noqa: BLE001 - see docstring
        db.rollback()
        return f"ERROR: {agent._explain(name, e)}"


# ------------------------------------------------------------------ storage

def _row(m: ChatMessage) -> Dict[str, Any]:
    out: Dict[str, Any] = {
        "id": m.id, "role": m.role, "content": m.content,
        "created_at": m.created_at, "tool_name": m.tool_name,
    }
    if m.tool_calls:
        try:
            out["tool_calls"] = json.loads(m.tool_calls)
        except json.JSONDecodeError:
            out["tool_calls"] = None
    return out


def _for_model(rows: List[ChatMessage]) -> List[Dict[str, Any]]:
    """Replay the stored conversation in the shape the model expects."""
    msgs: List[Dict[str, Any]] = [{"role": "system", "content": SYSTEM_PROMPT}]
    for m in rows:
        if m.role == "tool":
            msgs.append({"role": "tool", "tool_call_id": m.tool_call_id,
                         "name": m.tool_name, "content": m.content or ""})
        elif m.role == "assistant" and m.tool_calls:
            msgs.append({"role": "assistant", "content": m.content or None,
                         "tool_calls": json.loads(m.tool_calls)})
        else:
            msgs.append({"role": m.role, "content": m.content or ""})
    return msgs


def _thread(db: Session, thread_id: int) -> ChatThread:
    row = db.query(ChatThread).filter(ChatThread.id == thread_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return row


# ------------------------------------------------------------------- routes

@router.get("/status")
def chat_status():
    """Whether the chat can work, and what it would talk to."""
    s = llm.status()
    s["tools"] = [t["name"] for t in agent.TOOLS]
    s["secrets_included"] = False
    return s


@router.get("/threads", response_model=List[ThreadOut])
def list_threads(db: Session = Depends(get_db), limit: int = Query(50)):
    return (db.query(ChatThread)
            .order_by(ChatThread.updated_at.desc())
            .limit(min(limit, 200)).all())


@router.post("/threads", response_model=ThreadOut)
def create_thread(db: Session = Depends(get_db)):
    row = ChatThread()
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.get("/threads/{thread_id}/messages")
def thread_messages(thread_id: int, db: Session = Depends(get_db)):
    _thread(db, thread_id)
    rows = (db.query(ChatMessage)
            .filter(ChatMessage.thread_id == thread_id)
            .order_by(ChatMessage.id).all())
    return [_row(m) for m in rows]


@router.delete("/threads/{thread_id}")
def delete_thread(thread_id: int, db: Session = Depends(get_db)):
    _thread(db, thread_id)
    db.query(ChatMessage).filter(ChatMessage.thread_id == thread_id).delete(
        synchronize_session=False)
    db.query(ChatThread).filter(ChatThread.id == thread_id).delete(
        synchronize_session=False)
    db.commit()
    return {"message": "Conversation deleted"}


@router.post("/threads/{thread_id}/messages")
async def send(thread_id: int, ask: Ask, db: Session = Depends(get_db)):
    """Ask, let the model use tools, and answer.

    Not streamed. Streaming a *tool-using* turn means inventing a protocol for
    "this is a partial tool call", and the visible pause is the model thinking,
    not the transport - so the honest version is to wait and return the whole
    turn, including what it did along the way.
    """
    thread = _thread(db, thread_id)
    text = (ask.message or "").strip()
    if not text:
        raise HTTPException(status_code=422, detail="There is no question in that.")
    if not llm.configured():
        raise HTTPException(status_code=503, detail=llm.status()["detail"])

    def store(role: str, content: Optional[str], *, tool_calls=None,
              tool_call_id=None, tool_name=None) -> ChatMessage:
        m = ChatMessage(
            thread_id=thread_id, role=role, content=content,
            tool_calls=json.dumps(tool_calls) if tool_calls else None,
            tool_call_id=tool_call_id, tool_name=tool_name,
        )
        db.add(m)
        db.flush()
        return m

    produced: List[Dict[str, Any]] = []

    # The question is part of the turn that comes back. The browser has shown it
    # optimistically already, but it needs the stored row - its real id and
    # timestamp - to replace that with, or the question vanishes the moment the
    # answer arrives.
    asked = store("user", text)
    # The first question names the conversation, so the list reads without
    # opening anything.
    if thread.title == "New conversation":
        thread.title = (text[:80] + "…") if len(text) > 80 else text
    thread.updated_at = datetime.utcnow()
    db.commit()
    produced.append(_row(asked))

    tools = openai_tools()

    for round_no in range(MAX_ROUNDS):
        history = (db.query(ChatMessage)
                   .filter(ChatMessage.thread_id == thread_id)
                   .order_by(ChatMessage.id).all())
        try:
            reply = await llm.complete(_for_model(history), tools=tools)
        except llm.LLMUnavailable as e:
            db.rollback()
            raise HTTPException(status_code=502, detail=str(e))

        calls = reply.get("tool_calls") or []
        content = reply.get("content")

        row = store("assistant", content, tool_calls=calls or None)
        db.commit()
        produced.append(_row(row))

        if not calls:
            break

        for call in calls:
            fn = (call.get("function") or {})
            name = fn.get("name") or "?"
            result = run_tool(db, name, fn.get("arguments") or "{}")
            trow = store("tool", result, tool_call_id=call.get("id"), tool_name=name)
            db.commit()
            produced.append(_row(trow))
    else:
        row = store(
            "assistant",
            f"I stopped after {MAX_ROUNDS} rounds of tool calls without reaching an "
            f"answer. The conversation above shows what I tried — it is usually "
            f"worth asking again more specifically.",
        )
        db.commit()
        produced.append(_row(row))

    thread.updated_at = datetime.utcnow()
    db.commit()
    return {"thread": {"id": thread.id, "title": thread.title}, "messages": produced}
