from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from database import get_db
from models import Denial, Appeal, Claim, ClaimStatus
from schemas import DenialOut, DenialCreate, AppealOut, AppealCreate
from auth import get_current_user
from models import User

router = APIRouter(tags=["denials & appeals"])


# ── Global Denials List ───────────────────────────────────────────────────────

@router.get("/denials", response_model=dict)
async def list_all_denials(
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=200),
    is_resolved: Optional[bool] = None,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    q = select(Denial)
    if is_resolved is not None:
        q = q.where(Denial.is_resolved == is_resolved)

    count_q = select(func.count()).select_from(Denial)
    if is_resolved is not None:
        count_q = count_q.where(Denial.is_resolved == is_resolved)
    total = (await db.execute(count_q)).scalar_one()

    q = q.order_by(Denial.created_at.desc()).offset((page - 1) * per_page).limit(per_page)
    result = await db.execute(q)
    items = [DenialOut.model_validate(d) for d in result.scalars().all()]
    return {
        "items": items,
        "total": total,
        "page": page,
        "per_page": per_page,
        "pages": max(1, (total + per_page - 1) // per_page),
    }


@router.patch("/denials/{denial_id}", response_model=DenialOut)
async def update_denial(
    denial_id: int,
    body: dict,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    result = await db.execute(select(Denial).where(Denial.id == denial_id))
    denial = result.scalar_one_or_none()
    if not denial:
        raise HTTPException(404, "Denegación no encontrada")
    for field, value in body.items():
        if hasattr(denial, field):
            setattr(denial, field, value)
    await db.commit()
    await db.refresh(denial)
    return DenialOut.model_validate(denial)


# ── Per-Claim Denials ─────────────────────────────────────────────────────────

@router.get("/claims/{claim_id}/denials", response_model=list[DenialOut])
async def list_denials(
    claim_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    result = await db.execute(select(Denial).where(Denial.claim_id == claim_id))
    return [DenialOut.model_validate(d) for d in result.scalars().all()]


@router.post("/claims/{claim_id}/denials", response_model=DenialOut, status_code=201)
async def add_denial(
    claim_id: int,
    body: DenialCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    result = await db.execute(select(Claim).where(Claim.id == claim_id))
    claim = result.scalar_one_or_none()
    if not claim:
        raise HTTPException(404, "Reclamación no encontrada")
    denial = Denial(claim_id=claim_id, **body.model_dump())
    db.add(denial)
    claim.status = ClaimStatus.DENIED
    await db.commit()
    await db.refresh(denial)
    return DenialOut.model_validate(denial)


# ── Appeals ───────────────────────────────────────────────────────────────────

@router.get("/claims/{claim_id}/appeals", response_model=list[AppealOut])
async def list_appeals(
    claim_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    result = await db.execute(select(Appeal).where(Appeal.claim_id == claim_id))
    return [AppealOut.model_validate(a) for a in result.scalars().all()]


@router.post("/claims/{claim_id}/appeals", response_model=AppealOut, status_code=201)
async def create_appeal(
    claim_id: int,
    body: AppealCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    result = await db.execute(select(Claim).where(Claim.id == claim_id))
    claim = result.scalar_one_or_none()
    if not claim:
        raise HTTPException(404, "Reclamación no encontrada")
    appeal = Appeal(claim_id=claim_id, **body.model_dump())
    db.add(appeal)
    claim.status = ClaimStatus.APPEALED
    await db.commit()
    await db.refresh(appeal)
    return AppealOut.model_validate(appeal)


@router.patch("/appeals/{appeal_id}", response_model=AppealOut)
async def update_appeal(
    appeal_id: int,
    body: dict,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    result = await db.execute(select(Appeal).where(Appeal.id == appeal_id))
    appeal = result.scalar_one_or_none()
    if not appeal:
        raise HTTPException(404, "Apelación no encontrada")
    for field, value in body.items():
        if hasattr(appeal, field):
            setattr(appeal, field, value)
    await db.commit()
    await db.refresh(appeal)
    return AppealOut.model_validate(appeal)
