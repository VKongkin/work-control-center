"""File upload and download."""
import json
import mimetypes
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Attachment
from app.models.attachments import MAX_FILE_BYTES

router = APIRouter()

# What an entity_type is allowed to be. Anything else is a typo or an attempt
# to squat on a name the UI does not know how to show.
OWNERS = {"task", "followup", "issue", "meeting", "project", "tool"}

# Browsers frequently send an empty or wrong content type for folder uploads,
# so the extension decides how a file is served back.
EXTRA_TYPES = {
    ".js": "text/javascript",
    ".mjs": "text/javascript",
    ".css": "text/css",
    ".html": "text/html",
    ".htm": "text/html",
    ".json": "application/json",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
    ".woff2": "font/woff2",
    ".md": "text/markdown",
}


def guess_type(path: str, fallback: Optional[str]) -> str:
    dot = path.rfind(".")
    if dot != -1:
        ext = path[dot:].lower()
        if ext in EXTRA_TYPES:
            return EXTRA_TYPES[ext]
        guessed, _ = mimetypes.guess_type(path)
        if guessed:
            return guessed
    return fallback or "application/octet-stream"


def clean_path(raw: str) -> str:
    """Normalise an uploaded path so it cannot escape its own owner."""
    parts = [p for p in raw.replace("\\", "/").split("/") if p not in ("", ".", "..")]
    return "/".join(parts)


def strip_common_root(paths: List[str]) -> List[str]:
    """Drop the folder name the browser prefixes onto a directory upload.

    Picking a folder sends "My Tool/index.html", "My Tool/css/style.css". The
    wrapper directory is an artefact of how it was selected, not part of the
    tool, and leaving it in would break every relative link inside index.html.
    It is only removed when every file shares it and at least one file sits
    below it, so a flat multi-file selection is left alone.
    """
    nested = [p for p in paths if "/" in p]
    if not paths or not nested:
        return paths
    root = paths[0].split("/")[0]
    if all(p.split("/")[0] == root for p in paths):
        return [p[len(root) + 1:] if p.startswith(root + "/") else p for p in paths]
    return paths


class AttachmentSchema(BaseModel):
    id: int
    entity_type: str
    entity_id: int
    filename: str
    path: str
    content_type: str
    size: int
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


@router.get("", response_model=List[AttachmentSchema])
def list_attachments(
    entity_type: str = Query(...),
    entity_id: int = Query(...),
    db: Session = Depends(get_db),
):
    """Files belonging to one record, without their contents."""
    if entity_type not in OWNERS:
        raise HTTPException(status_code=422, detail=f"Unknown entity type: {entity_type}")
    rows = (
        db.query(Attachment)
        .filter(Attachment.entity_type == entity_type, Attachment.entity_id == entity_id)
        .order_by(Attachment.path)
        .all()
    )
    return rows


@router.post("", response_model=List[AttachmentSchema])
async def upload(
    entity_type: str = Form(...),
    entity_id: int = Form(...),
    files: List[UploadFile] = File(...),
    # A JSON array of relative paths, one per file, sent when a whole folder is
    # picked so the structure inside it survives. A JSON string rather than
    # repeated form fields, because multipart list parsing differs between
    # clients and silently mismatches the order.
    paths: Optional[str] = Form(None),
    db: Session = Depends(get_db),
):
    """Attach one or more files to a record."""
    if entity_type not in OWNERS:
        raise HTTPException(status_code=422, detail=f"Unknown entity type: {entity_type}")
    if not files:
        raise HTTPException(status_code=422, detail="No files were sent")

    try:
        relative_paths = json.loads(paths) if paths else []
        if not isinstance(relative_paths, list):
            relative_paths = []
    except json.JSONDecodeError:
        raise HTTPException(status_code=422, detail="paths must be a JSON array of strings")

    # Resolve every path first, so the shared wrapper folder can be spotted
    # across the batch rather than one file at a time.
    resolved = [
        clean_path(
            relative_paths[i]
            if i < len(relative_paths) and relative_paths[i]
            else (f.filename or "file")
        )
        or (f.filename or "file")
        for i, f in enumerate(files)
    ]
    resolved = strip_common_root(resolved)

    saved = []
    for i, upload_file in enumerate(files):
        body = await upload_file.read()
        if len(body) > MAX_FILE_BYTES:
            raise HTTPException(
                status_code=413,
                detail=(
                    f'"{upload_file.filename}" is {len(body) // (1024 * 1024)} MB. '
                    f"The limit is {MAX_FILE_BYTES // (1024 * 1024)} MB per file."
                ),
            )
        if not body:
            continue  # empty placeholder, e.g. .DS_Store stripped by the browser

        path = resolved[i]

        # Re-uploading the same path replaces it, which is what someone
        # re-uploading a corrected tool expects.
        existing = (
            db.query(Attachment)
            .filter(
                Attachment.entity_type == entity_type,
                Attachment.entity_id == entity_id,
                Attachment.path == path,
            )
            .first()
        )
        row = existing or Attachment(entity_type=entity_type, entity_id=entity_id, path=path)
        row.filename = upload_file.filename or path.rsplit("/", 1)[-1]
        row.content_type = guess_type(path, upload_file.content_type)
        row.size = len(body)
        row.data = body
        row.created_at = datetime.utcnow()
        db.add(row)
        saved.append(row)

    if not saved:
        raise HTTPException(status_code=422, detail="Every file sent was empty")

    db.commit()
    for row in saved:
        db.refresh(row)
    return saved


@router.get("/{attachment_id}/download")
def download(attachment_id: int, db: Session = Depends(get_db)):
    row = db.query(Attachment).filter(Attachment.id == attachment_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="File not found")
    return Response(
        content=row.data,
        media_type=row.content_type,
        headers={
            "Content-Disposition": f'attachment; filename="{row.filename}"',
            "Content-Length": str(row.size),
        },
    )


@router.get("/{attachment_id}/inline")
def inline(attachment_id: int, db: Session = Depends(get_db)):
    """Same bytes, shown in the browser rather than downloaded - for previews."""
    row = db.query(Attachment).filter(Attachment.id == attachment_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="File not found")
    return Response(content=row.data, media_type=row.content_type)


@router.delete("/{attachment_id}")
def delete(attachment_id: int, db: Session = Depends(get_db)):
    row = db.query(Attachment).filter(Attachment.id == attachment_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="File not found")
    db.delete(row)
    db.commit()
    return {"message": "File deleted"}
