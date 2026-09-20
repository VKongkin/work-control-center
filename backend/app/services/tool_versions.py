"""Version history for a tool's files.

A tool is pulled from a repository, edited, pulled again. Without this, each of
those overwrote the last and "it worked this morning" had no answer. With it,
every change leaves a version you can look at, compare and go back to.

  WHY CONTENT-ADDRESSED. The obvious implementation copies every file into
  every version, and a tool with a 2 MB font pulled twenty times costs 40 MB to
  remember almost nothing. Storing bytes under their SHA-256 and pointing
  versions at them means the twentieth pull of an unchanged font costs a row,
  not a copy - so keeping every version is cheap enough to be the default
  rather than something to turn on and then forget to.

  This is not Git and does not pretend to be: no branches, no merges, no
  history rewriting. It answers three questions - what did this look like
  before, what changed, and can I have it back.
"""
import hashlib
import json
from datetime import datetime
from typing import Dict, List, Optional, Tuple

from sqlalchemy.orm import Session

from app.models import Attachment, Tool, ToolBlob, ToolVersion

# Origins, spelled once so a typo cannot invent a fourth kind.
IMPORT = "import"
UPLOAD = "upload"
RESTORE = "restore"


def _digest(blob: bytes) -> str:
    return hashlib.sha256(blob).hexdigest()


def files_of(db: Session, tool_id: int) -> List[Attachment]:
    return (
        db.query(Attachment)
        .filter(Attachment.entity_type == "tool", Attachment.entity_id == tool_id)
        .order_by(Attachment.path)
        .all()
    )


def _store(db: Session, blob: bytes) -> str:
    """Keep these bytes, once. Returns the digest they are filed under."""
    sha = _digest(blob)
    if not db.query(ToolBlob.sha256).filter(ToolBlob.sha256 == sha).first():
        db.add(ToolBlob(sha256=sha, size=len(blob), data=blob))
        db.flush()
    return sha


def snapshot(db: Session, tool: Tool, *, origin: str = UPLOAD,
             note: Optional[str] = None) -> Optional[ToolVersion]:
    """Record what the tool looks like right now.

    Returns None when nothing has changed since the last version. Saving an
    identical version on every upload would bury the three that mattered in a
    list of forty that did not - and the point of a history is to be readable.
    """
    rows = files_of(db, tool.id)
    if not rows:
        return None

    manifest = []
    for row in rows:
        sha = _store(db, row.data)
        manifest.append({"path": row.path, "sha256": sha, "size": row.size})

    latest = current(db, tool.id)
    if latest and _same(json.loads(latest.manifest), manifest) \
            and latest.entry_path == tool.entry_path:
        return None

    version = ToolVersion(
        tool_id=tool.id,
        number=(latest.number + 1) if latest else 1,
        origin=origin,
        note=note,
        source_url=tool.source_url,
        source_ref=tool.source_ref,
        entry_path=tool.entry_path,
        manifest=json.dumps(manifest),
        file_count=len(manifest),
        total_bytes=sum(m["size"] for m in manifest),
        created_at=datetime.utcnow(),
    )
    db.add(version)
    db.flush()
    return version


def _same(a: List[Dict], b: List[Dict]) -> bool:
    return {(m["path"], m["sha256"]) for m in a} == {(m["path"], m["sha256"]) for m in b}


def current(db: Session, tool_id: int) -> Optional[ToolVersion]:
    return (
        db.query(ToolVersion)
        .filter(ToolVersion.tool_id == tool_id)
        .order_by(ToolVersion.number.desc())
        .first()
    )


def history(db: Session, tool_id: int, limit: int = 50) -> List[ToolVersion]:
    return (
        db.query(ToolVersion)
        .filter(ToolVersion.tool_id == tool_id)
        .order_by(ToolVersion.number.desc())
        .limit(limit).all()
    )


def changes(before: Optional[ToolVersion],
            after: ToolVersion) -> Dict[str, List[str]]:
    """Which paths were added, changed or removed between two versions.

    By path and digest rather than by content: a line-level diff of a minified
    bundle tells nobody anything, and the useful question after a pull is
    almost always "which files moved" rather than "which characters".
    """
    new = {m["path"]: m["sha256"] for m in json.loads(after.manifest)}
    old = ({m["path"]: m["sha256"] for m in json.loads(before.manifest)}
           if before else {})
    return {
        "added": sorted(p for p in new if p not in old),
        "changed": sorted(p for p in new if p in old and old[p] != new[p]),
        "removed": sorted(p for p in old if p not in new),
    }


def restore(db: Session, tool: Tool, version: ToolVersion) -> Tuple[int, ToolVersion]:
    """Put the tool's files back to how this version had them.

    Recorded as a new version rather than by deleting what came after. Going
    back is a thing that happened, and a history that quietly loses the version
    you rolled away from is worse than no history: the next question is always
    "what was I running when it broke".
    """
    from app.api.attachments import guess_type

    manifest = json.loads(version.manifest)
    wanted = {m["path"]: m for m in manifest}

    for row in files_of(db, tool.id):
        if row.path not in wanted:
            db.delete(row)
    db.flush()

    for path, entry in wanted.items():
        blob = db.query(ToolBlob).filter(ToolBlob.sha256 == entry["sha256"]).first()
        if not blob:
            # Only reachable if a blob were deleted out from under a version,
            # which nothing does. Skipping beats writing an empty file and
            # calling it restored.
            continue
        row = (
            db.query(Attachment)
            .filter(Attachment.entity_type == "tool",
                    Attachment.entity_id == tool.id,
                    Attachment.path == path)
            .first()
        )
        row = row or Attachment(entity_type="tool", entity_id=tool.id, path=path)
        row.filename = path.rsplit("/", 1)[-1]
        row.content_type = guess_type(path, None)
        row.size = blob.size
        row.data = blob.data
        row.created_at = datetime.utcnow()
        db.add(row)

    if version.entry_path:
        tool.entry_path = version.entry_path
    tool.source_url = version.source_url or tool.source_url
    tool.source_ref = version.source_ref or tool.source_ref
    tool.updated_at = datetime.utcnow()
    db.flush()

    made = snapshot(db, tool, origin=RESTORE,
                    note=f"Restored version {version.number}")
    return len(wanted), made or version


def forget(db: Session, tool_id: int) -> None:
    """Drop a deleted tool's history, and any bytes nothing else refers to."""
    versions = db.query(ToolVersion).filter(ToolVersion.tool_id == tool_id).all()
    mine = {m["sha256"] for v in versions for m in json.loads(v.manifest)}
    for v in versions:
        db.delete(v)
    db.flush()

    # A blob shared with another tool's history has to stay. Checked per
    # digest, because "delete everything this tool referenced" would take the
    # identical file out from under someone else's version.
    if mine:
        still_used = {
            m["sha256"]
            for (blob,) in db.query(ToolVersion.manifest)
                             .filter(ToolVersion.tool_id != tool_id).all()
            for m in json.loads(blob)
        }
        for sha in mine - still_used:
            db.query(ToolBlob).filter(ToolBlob.sha256 == sha).delete(
                synchronize_session=False)
