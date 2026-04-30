"""
Fee Schedule API — manage CPT/HCPCS rates per payer with Medicare baseline fallback.
"""
from typing import Optional
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from database import get_db
from models import FeeScheduleEntry, Payer, User
from auth import get_current_user

router = APIRouter(prefix="/fee-schedule", tags=["fee-schedule"])


# ── Schemas ──────────────────────────────────────────────────────────────────

class FeeScheduleOut(BaseModel):
    id: int
    payer_id: Optional[int] = None
    payer_name: Optional[str] = None
    cpt_code: str
    description: Optional[str] = None
    allowed_amount: float
    category: Optional[str] = None
    source: str
    effective_date: Optional[date] = None
    notes: Optional[str] = None

    class Config:
        from_attributes = True


class FeeScheduleCreate(BaseModel):
    payer_id: Optional[int] = None
    cpt_code: str
    description: Optional[str] = None
    allowed_amount: float = 0.0
    category: Optional[str] = None
    source: str = "manual"
    effective_date: Optional[date] = None
    notes: Optional[str] = None


class FeeScheduleLookupOut(BaseModel):
    cpt_code: str
    payer_id: Optional[int] = None
    allowed_amount: float
    source: str  # "payer-specific" or "medicare-baseline" or "not-found"


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.get("", response_model=list[FeeScheduleOut])
async def list_fee_schedule(
    payer_id: Optional[int] = Query(None),
    category: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """List all fee schedule entries, optionally filtered by payer_id and/or category."""
    stmt = select(FeeScheduleEntry).options(joinedload(FeeScheduleEntry.payer))

    if payer_id is not None:
        stmt = stmt.where(FeeScheduleEntry.payer_id == payer_id)
    if category:
        stmt = stmt.where(FeeScheduleEntry.category == category)

    stmt = stmt.order_by(FeeScheduleEntry.cpt_code, FeeScheduleEntry.payer_id)
    result = await db.execute(stmt)
    entries = result.unique().scalars().all()

    return [
        FeeScheduleOut(
            id=e.id,
            payer_id=e.payer_id,
            payer_name=e.payer.name if e.payer else None,
            cpt_code=e.cpt_code,
            description=e.description,
            allowed_amount=e.allowed_amount,
            category=e.category,
            source=e.source,
            effective_date=e.effective_date,
            notes=e.notes,
        )
        for e in entries
    ]


@router.get("/lookup", response_model=FeeScheduleLookupOut)
async def lookup_fee(
    cpt_code: str = Query(...),
    payer_id: Optional[int] = Query(None),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """
    Look up allowed amount for a specific CPT+payer combo.
    Falls back to Medicare baseline if no payer-specific rate exists.
    """
    amount, source = await get_fee_amount(db, cpt_code, payer_id)
    return FeeScheduleLookupOut(
        cpt_code=cpt_code,
        payer_id=payer_id,
        allowed_amount=amount,
        source=source,
    )


@router.post("", response_model=FeeScheduleOut)
async def upsert_fee_schedule(
    entry: FeeScheduleCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Add or update a fee schedule entry (upsert by payer_id + cpt_code)."""
    # Find existing
    if entry.payer_id is not None:
        stmt = select(FeeScheduleEntry).where(
            FeeScheduleEntry.payer_id == entry.payer_id,
            FeeScheduleEntry.cpt_code == entry.cpt_code,
        )
    else:
        stmt = select(FeeScheduleEntry).where(
            FeeScheduleEntry.payer_id.is_(None),
            FeeScheduleEntry.cpt_code == entry.cpt_code,
        )

    result = await db.execute(stmt)
    existing = result.scalar_one_or_none()

    if existing:
        existing.description = entry.description or existing.description
        existing.allowed_amount = entry.allowed_amount
        existing.category = entry.category or existing.category
        existing.source = entry.source
        existing.effective_date = entry.effective_date
        existing.notes = entry.notes
        await db.commit()
        await db.refresh(existing)
        obj = existing
    else:
        obj = FeeScheduleEntry(**entry.model_dump())
        db.add(obj)
        await db.commit()
        await db.refresh(obj)

    # Load payer relationship
    payer_name = None
    if obj.payer_id:
        payer_result = await db.execute(select(Payer).where(Payer.id == obj.payer_id))
        payer = payer_result.scalar_one_or_none()
        payer_name = payer.name if payer else None

    return FeeScheduleOut(
        id=obj.id,
        payer_id=obj.payer_id,
        payer_name=payer_name,
        cpt_code=obj.cpt_code,
        description=obj.description,
        allowed_amount=obj.allowed_amount,
        category=obj.category,
        source=obj.source,
        effective_date=obj.effective_date,
        notes=obj.notes,
    )


@router.delete("/{entry_id}")
async def delete_fee_schedule(
    entry_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Delete a fee schedule entry."""
    result = await db.execute(
        select(FeeScheduleEntry).where(FeeScheduleEntry.id == entry_id)
    )
    entry = result.scalar_one_or_none()
    if not entry:
        raise HTTPException(status_code=404, detail="Fee schedule entry not found")

    await db.delete(entry)
    await db.commit()
    return {"ok": True, "deleted_id": entry_id}


# ── Helper (also used by vistanet.py) ────────────────────────────────────────

async def get_fee_amount(db: AsyncSession, cpt_code: str, payer_id: int | None = None) -> tuple[float, str]:
    """
    Look up fee schedule: payer-specific first, then Medicare baseline.
    Returns (amount, source_label).
    """
    if payer_id:
        result = await db.execute(
            select(FeeScheduleEntry.allowed_amount).where(
                FeeScheduleEntry.cpt_code == cpt_code,
                FeeScheduleEntry.payer_id == payer_id,
            )
        )
        row = result.scalar_one_or_none()
        if row is not None:
            return (row, "payer-specific")

    # Fall back to Medicare baseline (payer_id IS NULL)
    result = await db.execute(
        select(FeeScheduleEntry.allowed_amount).where(
            FeeScheduleEntry.cpt_code == cpt_code,
            FeeScheduleEntry.payer_id.is_(None),
        )
    )
    row = result.scalar_one_or_none()
    if row is not None:
        return (row, "medicare-baseline")

    return (0.0, "not-found")
