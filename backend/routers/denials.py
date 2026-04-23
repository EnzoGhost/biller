from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from database import get_db
from models import Denial, Appeal, Claim, ClaimStatus
from schemas import DenialOut, DenialCreate, AppealOut, AppealCreate
from auth import get_current_user
from models import User

router = APIRouter(tags=["denials & appeals"])


# ── Denials ───────────────────────────────────────────────────────────────────

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
