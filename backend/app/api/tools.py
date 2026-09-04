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
