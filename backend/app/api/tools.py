"""Tools: small web apps the user has built, uploaded and can run in place."""
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Attachment, Tool
from app.partial import make_partial, make_lenient, merge
from app.services import repo_import
from app.validation import Name

router = APIRouter()


class ToolSchema(BaseModel):
    id: Optional[int] = None
    name: Name
    description: Optional[str] = None
    entry_path: Optional[str] = "index.html"
    pinned: bool = False
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


ToolSchemaPartial = make_partial(ToolSchema)
ToolSchemaOut = make_lenient(ToolSchema)


def files_of(db: Session, tool_id: int):
    return (
        db.query(Attachment)
        .filter(Attachment.entity_type == "tool", Attachment.entity_id == tool_id)
        .order_by(Attachment.path)
        .all()
    )


@router.get("", response_model=List[ToolSchemaOut])
def get_tools(db: Session = Depends(get_db), skip: int = Query(0), limit: int = Query(100)):
    return db.query(Tool).order_by(Tool.name).offset(skip).limit(limit).all()


@router.post("", response_model=ToolSchemaOut)
def create_tool(tool: ToolSchema, db: Session = Depends(get_db)):
    row = Tool(
        name=tool.name,
        description=tool.description,
        entry_path=tool.entry_path or "index.html",
        pinned=bool(tool.pinned),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.get("/{tool_id}", response_model=ToolSchemaOut)
def get_tool(tool_id: int, db: Session = Depends(get_db)):
    row = db.query(Tool).filter(Tool.id == tool_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Tool not found")
    return row


@router.put("/{tool_id}", response_model=ToolSchemaOut)
def update_tool(tool_id: int, tool: ToolSchemaPartial, db: Session = Depends(get_db)):
    row = db.query(Tool).filter(Tool.id == tool_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Tool not found")

    tool = merge(ToolSchema, row, tool)
    for key, value in tool.model_dump(exclude={"id", "created_at", "updated_at"}).items():
        setattr(row, key, value)
    row.updated_at = datetime.utcnow()
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.delete("/{tool_id}")
def delete_tool(tool_id: int, db: Session = Depends(get_db)):
    row = db.query(Tool).filter(Tool.id == tool_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Tool not found")
    # The files belong to the tool, so they go with it.
    for f in files_of(db, tool_id):
        db.delete(f)
    db.delete(row)
    db.commit()
    return {"message": "Tool deleted"}


# ------------------------------------------------------------------ importing

class ImportBody(BaseModel):
    url: str
    # Which tool to fill. Left out, a new one is created and named after what
    # the link points at.
    tool_id: Optional[int] = None
    name: Optional[str] = None
    # An import normally replaces the tool's files, because a tool is one
    # folder and a half-updated folder is worse than either version of it.
    replace: bool = True


@router.get("/import/status")
def import_status():
    """Whether importing from a link is switched on, and from where."""
    return repo_import.status()


@router.post("/import")
def import_from_link(body: ImportBody, db: Session = Depends(get_db)):
    """Build a tool out of a repository link.

    Refusals come back as 422 with a sentence rather than a 500: every way this
    fails - a host that is not allowed, a branch that is not there, a repository
    with no HTML in it - is something the person pasting the link can fix, and
    they can only fix it if they are told which one it was.
    """
    try:
        result = repo_import.import_link(body.url)
    except repo_import.ImportRefused as e:
        # 503 for "the feature is off", because that is the server's state and
        # not a bad request; 422 for everything else, which is the link.
        code = 503 if not repo_import.configured() else 422
        raise HTTPException(status_code=code, detail=str(e))

    if body.tool_id is not None:
        tool = db.query(Tool).filter(Tool.id == body.tool_id).first()
        if not tool:
            raise HTTPException(status_code=404, detail="Tool not found")
    else:
        name = (body.name or result.name).strip()[:255] or "Imported tool"
        # Names are unique, so a second import of the same repository becomes
        # "thing (2)" rather than a constraint violation nobody can read.
        base, n = name, 2
        while db.query(Tool).filter(Tool.name == name).first():
            name = f"{base} ({n})"
            n += 1
        tool = Tool(name=name, description=f"Imported from {result.source_url}")
        db.add(tool)
        db.flush()

    if body.replace:
        for row in files_of(db, tool.id):
            db.delete(row)
        db.flush()

    from app.api.attachments import guess_type

    written = []
    for path, blob in result.files:
        existing = (
            db.query(Attachment)
            .filter(
                Attachment.entity_type == "tool",
                Attachment.entity_id == tool.id,
                Attachment.path == path,
            )
            .first()
        )
        row = existing or Attachment(entity_type="tool", entity_id=tool.id, path=path)
        row.filename = path.rsplit("/", 1)[-1]
        row.content_type = guess_type(path, None)
        row.size = len(blob)
        row.data = blob
        row.created_at = datetime.utcnow()
        db.add(row)
        written.append(path)

    # Point the tool at whatever actually opens it, so an import is runnable
    # without a second trip to the settings.
    html = [p for p in written if p.lower().endswith((".html", ".htm"))]
    root = [p for p in html if "/" not in p]
    index = ([p for p in root if p.lower() in ("index.html", "index.htm")]
             or root or html)
    if index:
        tool.entry_path = index[0]
    tool.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(tool)

    return {
        "tool": {"id": tool.id, "name": tool.name, "description": tool.description,
                 "entry_path": tool.entry_path, "pinned": bool(tool.pinned)},
        "imported": len(written),
        "bytes": sum(len(b) for _, b in result.files),
        "entry_path": tool.entry_path,
        "runnable": bool(index),
        "ref": result.ref,
        "source_url": result.source_url,
        "skipped": result.skipped,
        "files": sorted(written)[:50],
    }


@router.get("/{tool_id}/manifest")
def manifest(tool_id: int, db: Session = Depends(get_db)):
    """What a tool is made of, and whether it can actually run."""
    row = db.query(Tool).filter(Tool.id == tool_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Tool not found")

    files = files_of(db, tool_id)
    paths = [f.path for f in files]

    # If the recorded entry is missing, fall back to any HTML at the root, then
    # any HTML at all, so a folder using home.html still opens.
    entry = row.entry_path if row.entry_path in paths else None
    if entry is None:
        html = [p for p in paths if p.lower().endswith((".html", ".htm"))]
        root_html = [p for p in html if "/" not in p]
        entry = (root_html or html or [None])[0]

    return {
        "id": row.id,
        "name": row.name,
        "entry_path": entry,
        "runnable": entry is not None,
        "file_count": len(files),
        "total_bytes": sum(f.size for f in files),
        "files": [
            {"id": f.id, "path": f.path, "content_type": f.content_type, "size": f.size}
            for f in files
        ],
    }


@router.get("/{tool_id}/serve/{path:path}")
def serve(tool_id: int, path: str, db: Session = Depends(get_db)):
    """Serve one file of a tool so the browser can run the whole folder.

    The page is rendered inside a sandboxed iframe with no same-origin
    privileges, so a tool cannot reach this app's API or storage. The headers
    here are belt and braces for anyone opening the URL directly.
    """
    row = (
        db.query(Attachment)
        .filter(
            Attachment.entity_type == "tool",
            Attachment.entity_id == tool_id,
            Attachment.path == path,
        )
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail=f"{path} is not part of this tool")

    return Response(
        content=row.data,
        media_type=row.content_type,
        headers={
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
        },
    )
