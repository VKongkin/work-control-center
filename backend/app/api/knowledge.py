"""Knowledge: notes, runbooks, install guides.

Search is the whole point of this table - a runbook you cannot find is the same
as one you never wrote - so the list endpoint takes a free-text query across
everything a human would half-remember: the title, the summary, the body and
the tags.
"""
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import KnowledgeArticle
from app.models.knowledge import KINDS, STATUSES
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
