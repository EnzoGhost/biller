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
from models import FeeScheduleEntry, Payer, User, Claim, ServiceLine, ClaimStatus
from auth import get_current_user, get_current_provider
from models import Provider

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
    provider: Provider = Depends(get_current_provider),
):
    """List fee schedule entries for the current provider."""
    stmt = select(FeeScheduleEntry).options(joinedload(FeeScheduleEntry.payer))
    stmt = stmt.where(
        (FeeScheduleEntry.provider_id == provider.id) | (FeeScheduleEntry.provider_id.is_(None))
    )
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
    provider: Provider = Depends(get_current_provider),
):
    """Add or update a fee schedule entry (upsert by provider_id + payer_id + cpt_code)."""
    # Find existing
    if entry.payer_id is not None:
        stmt = select(FeeScheduleEntry).where(
            FeeScheduleEntry.provider_id == provider.id,
            FeeScheduleEntry.payer_id == entry.payer_id,
            FeeScheduleEntry.cpt_code == entry.cpt_code,
        )
    else:
        stmt = select(FeeScheduleEntry).where(
            FeeScheduleEntry.provider_id == provider.id,
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
        obj = FeeScheduleEntry(**entry.model_dump(), provider_id=provider.id)
        db.add(obj)
        await db.commit()
        await db.refresh(obj)

    # Cascade: update draft claims with $0 billed for this CPT code
    if entry.allowed_amount > 0:
        await _cascade_fee_update(db, entry.cpt_code, entry.allowed_amount)

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


class CascadeResult(BaseModel):
    updated_claims: int = 0
    cpt_code: str = ""
    new_amount: float = 0.0


@router.put("/{cpt_code}", response_model=FeeScheduleOut)
async def upsert_fee_by_cpt(
    cpt_code: str,
    entry: FeeScheduleCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Upsert a fee schedule entry by CPT code (convenience route for inline editing)."""
    entry.cpt_code = cpt_code
    entry.source = entry.source or "learned"
    result = await upsert_fee_schedule(entry, db, _)

    # Cascade: update all claims with this CPT and billed_amount == 0
    cascade = await _cascade_fee_update(db, cpt_code, entry.allowed_amount)

    # Embed cascade info in the response
    result_dict = result.model_dump() if hasattr(result, 'model_dump') else result.__dict__
    result_dict['cascade_updated_claims'] = cascade.updated_claims
    return result_dict


async def _cascade_fee_update(
    db: AsyncSession, cpt_code: str, new_amount: float
) -> CascadeResult:
    """
    Find all claims with a service line matching cpt_code AND billed_amount == 0.
    Update those lines, recalculate totals, re-scrub, and auto-advance if clean.
    """
    from sqlalchemy.orm import selectinload

    # Find service lines with this CPT and zero billed
    stmt = (
        select(ServiceLine)
        .where(
            ServiceLine.cpt_code == cpt_code,
            ServiceLine.billed_amount == 0,
        )
    )
    result = await db.execute(stmt)
    zero_lines = result.scalars().all()

    if not zero_lines:
        return CascadeResult(updated_claims=0, cpt_code=cpt_code, new_amount=new_amount)

    # Get unique claim IDs
    claim_ids = list(set(sl.claim_id for sl in zero_lines))

    # Update the service lines
    for sl in zero_lines:
        sl.billed_amount = new_amount

    await db.flush()

    # Now reload full claims for re-scrub
    from routers.ai import _scrub_patient, _scrub_provider, _scrub_payer, _scrub_claim_level, _scrub_service_lines
    from routers.audit import log_action
    from models import Patient, Provider

    updated_count = 0
    for claim_id in claim_ids:
        claim_result = await db.execute(
            select(Claim)
            .options(
                selectinload(Claim.patient),
                selectinload(Claim.provider),
                selectinload(Claim.payer),
                selectinload(Claim.service_lines),
            )
            .where(Claim.id == claim_id)
        )
        claim = claim_result.scalar_one_or_none()
        if not claim:
            continue

        # Recalculate total_billed
        claim.total_billed = sum(sl.billed_amount * sl.units for sl in claim.service_lines)

        # Re-scrub
        issues: list[dict] = []
        _scrub_patient(claim, issues)
        _scrub_provider(claim, issues)
        _scrub_payer(claim, issues)
        _scrub_claim_level(claim, issues)
        _scrub_service_lines(claim, issues)

        errors = [i for i in issues if i["type"] == "error"]
        warnings = [i for i in issues if i["type"] == "warning"]
        score = max(0.0, 100.0 - len(errors) * 25.0 - len(warnings) * 5.0)

        claim.scrub_score = score
        claim.scrub_issues = issues

        # Auto-advance to READY if clean (0 errors, 0 warnings)
        if len(errors) == 0 and len(warnings) == 0 and claim.status == ClaimStatus.DRAFT:
            claim.status = ClaimStatus.READY
            await log_action(
                db, "claim", claim_id, "fee_cascade_ready",
                claim_id=claim_id, old_value="draft", new_value="ready",
                notes=f"Fee schedule updated for {cpt_code} -> ${new_amount:.2f}. Auto-advanced.",
            )

        updated_count += 1

    await db.commit()
    return CascadeResult(updated_claims=updated_count, cpt_code=cpt_code, new_amount=new_amount)


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
