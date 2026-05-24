"""
Prior Authorization Tracking
Tracks prior auth requests, approvals, and auto-populates into claims.
"""
from datetime import date, datetime
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel

from database import get_db
from models import PriorAuth, PriorAuthStatus, Claim, User, Provider
from auth import get_current_user, get_current_provider

router = APIRouter(prefix="/prior-auth", tags=["prior_auth"])


# ── Pydantic schemas ──────────────────────────────────────────────────────────

class PriorAuthCreate(BaseModel):
    claim_id: Optional[int] = None
    payer_id: Optional[int] = None
    payer_name: Optional[str] = None
    auth_number: Optional[str] = None
    cpt_codes: List[str] = []
    status: PriorAuthStatus = PriorAuthStatus.PENDING
    requested_date: Optional[date] = None
    approved_date: Optional[date] = None
    expiry_date: Optional[date] = None
    notes: Optional[str] = None


class PriorAuthUpdate(BaseModel):
    auth_number: Optional[str] = None
    status: Optional[PriorAuthStatus] = None
    approved_date: Optional[date] = None
    expiry_date: Optional[date] = None
    notes: Optional[str] = None


class PriorAuthOut(BaseModel):
    id: int
    claim_id: Optional[int]
    payer_id: Optional[int]
    payer_name: Optional[str]
    auth_number: Optional[str]
    cpt_codes: list
    status: PriorAuthStatus
    requested_date: Optional[date]
    approved_date: Optional[date]
    expiry_date: Optional[date]
    notes: Optional[str]
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/", response_model=List[PriorAuthOut])
async def list_prior_auths(
    claim_id: Optional[int] = None,
    status: Optional[PriorAuthStatus] = None,
    expiring_soon: bool = False,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
    provider: Provider = Depends(get_current_provider),
):
    """List prior auths with optional filters, scoped to current provider."""
    q = select(PriorAuth).where(
        (PriorAuth.provider_id == provider.id) | (PriorAuth.provider_id.is_(None))
    )
    if claim_id:
        q = q.where(PriorAuth.claim_id == claim_id)
    if status:
        q = q.where(PriorAuth.status == status)
    if expiring_soon:
        from datetime import timedelta
        cutoff = date.today() + timedelta(days=14)
        q = q.where(
            PriorAuth.expiry_date <= cutoff,
            PriorAuth.status == PriorAuthStatus.APPROVED,
        )
    result = await db.execute(q.order_by(PriorAuth.created_at.desc()))
    return result.scalars().all()


@router.get("/claims/{claim_id}", response_model=List[PriorAuthOut])
async def get_claim_prior_auths(
    claim_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Get all prior auths for a specific claim."""
    result = await db.execute(
        select(PriorAuth)
        .where(PriorAuth.claim_id == claim_id)
        .order_by(PriorAuth.created_at.desc())
    )
    return result.scalars().all()


@router.post("/", response_model=PriorAuthOut, status_code=201)
async def create_prior_auth(
    body: PriorAuthCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Create a new prior auth record."""
    pa = PriorAuth(
        claim_id=body.claim_id,
        payer_id=body.payer_id,
        payer_name=body.payer_name,
        auth_number=body.auth_number,
        cpt_codes=body.cpt_codes,
        status=body.status,
        requested_date=body.requested_date or date.today(),
        approved_date=body.approved_date,
        expiry_date=body.expiry_date,
        notes=body.notes,
    )
    db.add(pa)

    # If auth number provided and claim_id given, auto-populate claim
    if body.claim_id and body.auth_number:
        claim_result = await db.execute(select(Claim).where(Claim.id == body.claim_id))
        claim = claim_result.scalar_one_or_none()
        if claim and not claim.prior_auth_number:
            claim.prior_auth_number = body.auth_number

    await db.commit()
    await db.refresh(pa)
    return pa


@router.patch("/{pa_id}", response_model=PriorAuthOut)
async def update_prior_auth(
    pa_id: int,
    body: PriorAuthUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Update a prior auth record."""
    result = await db.execute(select(PriorAuth).where(PriorAuth.id == pa_id))
    pa = result.scalar_one_or_none()
    if not pa:
        raise HTTPException(404, "Prior auth not found")

    if body.auth_number is not None:
        pa.auth_number = body.auth_number
        # Auto-populate into linked claim
        if pa.claim_id:
            claim_result = await db.execute(select(Claim).where(Claim.id == pa.claim_id))
            claim = claim_result.scalar_one_or_none()
            if claim:
                claim.prior_auth_number = body.auth_number

    if body.status is not None:
        pa.status = body.status
    if body.approved_date is not None:
        pa.approved_date = body.approved_date
    if body.expiry_date is not None:
        pa.expiry_date = body.expiry_date
    if body.notes is not None:
        pa.notes = body.notes

    await db.commit()
    await db.refresh(pa)
    return pa


@router.delete("/{pa_id}", status_code=204)
async def delete_prior_auth(
    pa_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    result = await db.execute(select(PriorAuth).where(PriorAuth.id == pa_id))
    pa = result.scalar_one_or_none()
    if not pa:
        raise HTTPException(404, "Prior auth not found")
    await db.delete(pa)
    await db.commit()
