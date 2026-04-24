from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from database import get_db
from models import Payer
from schemas import PayerOut, PayerCreate
from auth import get_current_user
from models import User

router = APIRouter(prefix="/payers", tags=["payers"])


@router.get("", response_model=dict)
async def list_payers(
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=200),
    active_only: bool = True,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    q = select(Payer)
    if active_only:
        q = q.where(Payer.is_active == True)
    total = (await db.execute(
        select(func.count()).select_from(Payer).where(Payer.is_active == True if active_only else True)
    )).scalar_one()
    q = q.order_by(Payer.name).offset((page - 1) * per_page).limit(per_page)
    result = await db.execute(q)
    return {
        "items": [PayerOut.from_orm_with_reforma(p) for p in result.scalars().all()],
        "total": total, "page": page, "per_page": per_page,
        "pages": max(1, (total + per_page - 1) // per_page),
    }


@router.post("", response_model=PayerOut, status_code=201)
async def create_payer(
    body: PayerCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    payer = Payer(**body.model_dump())
    db.add(payer)
    await db.commit()
    await db.refresh(payer)
    return PayerOut.model_validate(payer)


@router.get("/{payer_id}", response_model=PayerOut)
async def get_payer(
    payer_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    result = await db.execute(select(Payer).where(Payer.id == payer_id))
    payer = result.scalar_one_or_none()
    if not payer:
        raise HTTPException(404, "Pagador no encontrado")
    return PayerOut.model_validate(payer)


@router.patch("/{payer_id}", response_model=PayerOut)
async def update_payer(
    payer_id: int,
    body: PayerCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    result = await db.execute(select(Payer).where(Payer.id == payer_id))
    payer = result.scalar_one_or_none()
    if not payer:
        raise HTTPException(404, "Pagador no encontrado")
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(payer, field, value)
    await db.commit()
    await db.refresh(payer)
    return PayerOut.model_validate(payer)
