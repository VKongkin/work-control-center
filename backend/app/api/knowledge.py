"""Knowledge: notes, runbooks, install guides.

Search is the whole point of this table - a runbook you cannot find is the same
as one you never wrote - so the list endpoint takes a free-text query across
everything a human would half-remember: the title, the summary, the body and
the tags.
"""
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from pydantic import BaseModel
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Attachment, KnowledgeArticle
from app.models.attachments import MAX_FILE_BYTES
from app.models.knowledge import KINDS, STATUSES
from app.services import docx_import
from app.partial import make_lenient, make_partial, merge
from app.validation import Name, Timestamp, one_of

router = APIRouter()

ENVIRONMENTS = ("DC", "DR", "UAT", "SIT", "DEV", "ALL")


class ArticleSchema(BaseModel):
    id: Optional[int] = None
    title: Name
    kind: str = "NOTE"
    status: str = "DRAFT"
    summary: Optional[str] = None
    body: Optional[str] = None
    tags: Optional[str] = None
    system_id: Optional[int] = None
    project_id: Optional[int] = None
    department_id: Optional[int] = None
    vendor_id: Optional[int] = None
    category_id: Optional[int] = None
    server_id: Optional[int] = None
    environment: Optional[str] = None
    last_verified_at: Timestamp = None
    pinned: Optional[bool] = False

    _kind_is_known = one_of("kind", list(KINDS))
    _status_is_known = one_of("status", list(STATUSES))
    _environment_is_known = one_of("environment", list(ENVIRONMENTS))

    class Config:
        from_attributes = True


class ArticleOut(ArticleSchema):
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


ArticlePartial = make_partial(ArticleSchema)
ArticleOutLenient = make_lenient(ArticleOut)


# The columns a free-text search looks in. Shared with the agent interface so
# "find the runbook about websphere restart" behaves the same either way.
SEARCHABLE = (
    KnowledgeArticle.title,
    KnowledgeArticle.summary,
    KnowledgeArticle.body,
    KnowledgeArticle.tags,
)


def text_filter(query, needle: str):
    """Every word must appear somewhere; the words need not be adjacent.

    Matching the phrase literally would mean "websphere restart" finds nothing
    in an article titled "Restart WebSphere on DC" - which is how people
    actually half-remember things, and how an agent will phrase it.
    """
    for word in (needle or "").split():
        like = f"%{word}%"
        query = query.filter(or_(*[column.ilike(like) for column in SEARCHABLE]))
    return query


@router.get("", response_model=List[ArticleOutLenient])
def list_articles(
    db: Session = Depends(get_db),
    skip: int = Query(0),
    limit: int = Query(100),
    kind: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    environment: Optional[str] = Query(None),
    system_id: Optional[int] = Query(None),
    server_id: Optional[int] = Query(None),
    tag: Optional[str] = Query(None),
    q: Optional[str] = Query(None, description="Free text across title, summary, body and tags"),
):
    query = db.query(KnowledgeArticle)
    if kind:
        query = query.filter(KnowledgeArticle.kind == kind)
    if status:
        query = query.filter(KnowledgeArticle.status == status)
    if environment:
        # A runbook marked ALL applies to whichever environment is being asked
        # about, so it must not be filtered out by naming one.
        query = query.filter(
            or_(KnowledgeArticle.environment == environment,
                KnowledgeArticle.environment == "ALL")
        )
    if system_id:
        query = query.filter(KnowledgeArticle.system_id == system_id)
    if server_id:
        query = query.filter(KnowledgeArticle.server_id == server_id)
    if tag:
        query = query.filter(KnowledgeArticle.tags.ilike(f"%{tag.strip()}%"))
    if q:
        query = text_filter(query, q)

    return (
        query.order_by(KnowledgeArticle.pinned.desc(), KnowledgeArticle.updated_at.desc())
        .offset(skip).limit(limit).all()
    )


@router.post("", response_model=ArticleOutLenient)
def create_article(payload: ArticleSchema, db: Session = Depends(get_db)):
    row = KnowledgeArticle(**payload.dict(exclude={"id"}))
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.get("/{article_id}", response_model=ArticleOutLenient)
def get_article(article_id: int, db: Session = Depends(get_db)):
    row = db.query(KnowledgeArticle).filter(KnowledgeArticle.id == article_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Article not found")
    return row


@router.put("/{article_id}", response_model=ArticleOutLenient)
def update_article(article_id: int, payload: ArticlePartial, db: Session = Depends(get_db)):
    row = db.query(KnowledgeArticle).filter(KnowledgeArticle.id == article_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Article not found")
    merged = merge(ArticleSchema, row, payload)
    for key, value in merged.dict(exclude={"id"}).items():
        setattr(row, key, value)
    row.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(row)
    return row


@router.post("/{article_id}/verified", response_model=ArticleOutLenient)
def mark_verified(article_id: int, db: Session = Depends(get_db)):
    """Record that this runbook was followed and still works."""
    row = db.query(KnowledgeArticle).filter(KnowledgeArticle.id == article_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Article not found")
    row.last_verified_at = datetime.utcnow()
    db.commit()
    db.refresh(row)
    return row


@router.delete("/{article_id}")
def delete_article(article_id: int, db: Session = Depends(get_db)):
    row = db.query(KnowledgeArticle).filter(KnowledgeArticle.id == article_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Article not found")
    # The files go with it. An article's attachments include every image pasted
    # into its body, so leaving them behind fills the database with blobs
    # nothing references and no page can show.
    db.query(Attachment).filter(
        Attachment.entity_type == "knowledge", Attachment.entity_id == article_id
    ).delete(synchronize_session=False)
    db.delete(row)
    db.commit()
    return {"message": "Article deleted"}


@router.get("/meta/tags", response_model=List[str])
def known_tags(db: Session = Depends(get_db)):
    """Every tag in use, so the editor can suggest rather than invite typos."""
    seen: set = set()
    for (raw,) in db.query(KnowledgeArticle.tags).filter(KnowledgeArticle.tags.isnot(None)):
        for part in (raw or "").split(","):
            cleaned = part.strip()
            if cleaned:
                seen.add(cleaned)
    return sorted(seen, key=str.lower)


# ------------------------------------------------------------ Word documents

DOCX_TYPES = (
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/msword",
)


def _store(db: Session, article_id: int, filename: str, content_type: str,
           blob: bytes) -> Attachment:
    row = Attachment(
        entity_type="knowledge", entity_id=article_id,
        filename=filename, path=filename,
        content_type=content_type, size=len(blob), data=blob,
    )
    db.add(row)
    db.flush()          # an id, so the markdown can point at it
    return row


@router.post("/import/docx")
async def import_docx(
    file: UploadFile = File(...),
    article_id: Optional[int] = Form(None),
    db: Session = Depends(get_db),
):
    """Convert a Word document into an article.

    With `article_id` the converted text is appended to that article; without
    one a new article is created, titled from the document's own first heading.

    Either way the article exists *before* any image is written, which is what
    keeps this simple: every image is an attachment with a real owner, so there
    is no orphan to reclaim later and no draft state to get stuck in.
    """
    name = (file.filename or "document.docx").strip()
    if not name.lower().endswith((".docx", ".doc")):
        raise HTTPException(
            status_code=422,
            detail=f"{name} is not a Word document. Only .docx can be converted - "
                   f"an older .doc has to be re-saved as .docx first.",
        )

    blob = await file.read()
    if not blob:
        raise HTTPException(status_code=422, detail="That file is empty.")
    if len(blob) > MAX_FILE_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"{name} is {len(blob) // (1024 * 1024)} MB. The limit is "
                   f"{MAX_FILE_BYTES // (1024 * 1024)} MB.",
        )
    if name.lower().endswith(".doc"):
        raise HTTPException(
            status_code=422,
            detail="This is the old binary .doc format, which cannot be read. "
                   "Open it in Word and Save As .docx, then import that.",
        )

    article = None
    if article_id is not None:
        article = db.query(KnowledgeArticle).filter(
            KnowledgeArticle.id == article_id).first()
        if not article:
            raise HTTPException(status_code=404, detail="Article not found")

    if article is None:
        # Created before conversion so images have an owner from the first
        # byte. Titled provisionally; renamed below once the document has told
        # us what it calls itself.
        article = KnowledgeArticle(
            title=name.rsplit(".", 1)[0][:255] or "Imported document",
            kind="GUIDE", status="DRAFT",
        )
        db.add(article)
        db.flush()
        created = True
    else:
        created = False

    stem = name.rsplit(".", 1)[0][:60]

    def save_image(content_type: str, data: bytes, index: int):
        ext = {"image/png": "png", "image/jpeg": "jpg", "image/gif": "gif",
               "image/bmp": "bmp", "image/tiff": "tif", "image/x-emf": "emf",
               "image/x-wmf": "wmf"}.get(content_type, "bin")
        # EMF and WMF are Word's vector formats and no browser renders them.
        # Keeping them as attachments is still right - the content is not lost -
        # but pointing an <img> at one would draw a broken icon in the runbook.
        if ext in ("emf", "wmf", "bin"):
            _store(db, article.id, f"{stem}-figure-{index}.{ext}", content_type, data)
            return None
        row = _store(db, article.id, f"{stem}-figure-{index}.{ext}", content_type, data)
        return f"/api/attachments/{row.id}/inline"

    try:
        out = docx_import.convert(blob, save_image)
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=422,
            detail=f"{name} could not be read as a Word document: "
                   f"{type(e).__name__}. If it opens in Word, try Save As .docx.",
        )

    # The original, kept beside the text it produced. Formatting nobody wants to
    # lose, and provenance for "this is the vendor's own guide".
    _store(db, article.id, name, DOCX_TYPES[0], blob)

    markdown = out["markdown"]
    if created and out.get("title"):
        article.title = out["title"]
        # The heading that became the title should not also open the body.
        markdown = docx_import.strip_leading_heading(markdown, out["title"])
    article.body = (f"{article.body}\n\n{markdown}"
                    if article.body else markdown)
    article.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(article)

    return {
        "article": {c.name: getattr(article, c.name) for c in article.__table__.columns},
        "created": created,
        "images": len(out["images"]),
        "images_skipped": sum(1 for i in out["images"] if not i["url"]),
        "warnings": out["warnings"][:10],
    }
