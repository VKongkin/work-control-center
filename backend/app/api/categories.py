"""Categories API routes"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from datetime import datetime
from typing import List, Optional
from app.database import get_db
from app.models import Category
from pydantic import BaseModel
from app.partial import make_partial, make_lenient, merge
from app.validation import Name, one_of, Timestamp


class CategorySchema(BaseModel):
    id: Optional[int] = None
    name: Name
    description: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


CategorySchemaPartial = make_partial(CategorySchema)
CategorySchemaOut = make_lenient(CategorySchema)

router = APIRouter()


@router.get("", response_model=List[CategorySchemaOut])
def get_categories(db: Session = Depends(get_db), skip: int = Query(0), limit: int = Query(100)):
    """Get all categories"""
    return db.query(Category).order_by(Category.name).offset(skip).limit(limit).all()


@router.post("", response_model=CategorySchemaOut)
def create_category(category: CategorySchema, db: Session = Depends(get_db)):
    """Create a new category"""
    db_category = Category(name=category.name, description=category.description)
    db.add(db_category)
    db.commit()
    db.refresh(db_category)
    return db_category


@router.get("/{category_id}", response_model=CategorySchemaOut)
def get_category(category_id: int, db: Session = Depends(get_db)):
    """Get a specific category"""
    category = db.query(Category).filter(Category.id == category_id).first()
    if not category:
        raise HTTPException(status_code=404, detail="Category not found")
    return category


@router.put("/{category_id}", response_model=CategorySchemaOut)
def update_category(category_id: int, category: CategorySchemaPartial, db: Session = Depends(get_db)):
    """Update a category"""
    db_category = db.query(Category).filter(Category.id == category_id).first()
    if not db_category:
        raise HTTPException(status_code=404, detail="Category not found")

    # Only apply the fields the caller actually sent; keep the rest as stored.
    category = merge(CategorySchema, db_category, category)

    db_category.name = category.name
    db_category.description = category.description
    db_category.updated_at = datetime.utcnow()
    db.add(db_category)
    db.commit()
    db.refresh(db_category)
    return db_category


@router.delete("/{category_id}")
def delete_category(category_id: int, db: Session = Depends(get_db)):
    """Delete a category"""
    db_category = db.query(Category).filter(Category.id == category_id).first()
    if not db_category:
        raise HTTPException(status_code=404, detail="Category not found")
    db.delete(db_category)
    db.commit()
    return {"message": "Category deleted"}
