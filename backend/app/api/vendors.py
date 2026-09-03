"""Vendors API routes"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from datetime import datetime
from typing import List, Optional
from app.database import get_db
from app.models import Vendor
from pydantic import BaseModel
from app.partial import make_partial, make_lenient, merge
from app.validation import Name, one_of


class VendorSchema(BaseModel):
    id: Optional[int] = None
    name: Name
    type: Optional[str] = None
    primary_contact_id: Optional[int] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    notes: Optional[str] = None
    active: bool = True

    class Config:
        from_attributes = True


VendorSchemaPartial = make_partial(VendorSchema)
VendorSchemaOut = make_lenient(VendorSchema)

router = APIRouter()


@router.get("", response_model=List[VendorSchemaOut])
def get_vendors(
    db: Session = Depends(get_db),
    skip: int = Query(0),
    limit: int = Query(100),
    include_inactive: bool = Query(False),
):
    """Get all vendors"""
    # Deleting here archives rather than destroys, so history that points at
    # this record stays intact. Archived rows are hidden unless asked for.
    query = db.query(Vendor)
    if not include_inactive:
        query = query.filter(Vendor.active == True)
    return query.order_by(Vendor.name).offset(skip).limit(limit).all()


@router.post("", response_model=VendorSchemaOut)
def create_vendor(vendor: VendorSchema, db: Session = Depends(get_db)):
    """Create a new vendor"""
    db_vendor = Vendor(**vendor.dict())
    db.add(db_vendor)
    db.commit()
    db.refresh(db_vendor)
    return db_vendor


@router.get("/{vendor_id}", response_model=VendorSchemaOut)
def get_vendor(vendor_id: int, db: Session = Depends(get_db)):
    """Get a vendor"""
    vendor = db.query(Vendor).filter(Vendor.id == vendor_id).first()
    if not vendor:
        raise HTTPException(status_code=404, detail="Vendor not found")
    return vendor


@router.put("/{vendor_id}", response_model=VendorSchemaOut)
def update_vendor(vendor_id: int, vendor: VendorSchemaPartial, db: Session = Depends(get_db)):
    """Update a vendor"""
    db_vendor = db.query(Vendor).filter(Vendor.id == vendor_id).first()
    if not db_vendor:
        raise HTTPException(status_code=404, detail="Vendor not found")

    # Only apply the fields the caller actually sent; keep the rest as stored.
    vendor = merge(VendorSchema, db_vendor, vendor)
    for key, value in vendor.dict().items():
        setattr(db_vendor, key, value)
    db_vendor.updated_at = datetime.utcnow()
    db.add(db_vendor)
    db.commit()
    db.refresh(db_vendor)
    return db_vendor


@router.delete("/{vendor_id}")
def delete_vendor(vendor_id: int, db: Session = Depends(get_db)):
    """Archive: hidden from lists, but kept so linked history survives."""
    db_vendor = db.query(Vendor).filter(Vendor.id == vendor_id).first()
    if not db_vendor:
        raise HTTPException(status_code=404, detail="Vendor not found")
    db_vendor.active = False
    db.add(db_vendor)
    db.commit()
    return {"message": "Vendor archived"}
