from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, or_

from database import get_db
from models import Provider
from schemas import ProviderOut, ProviderCreate, ProviderUpdate
from auth import get_current_user
from models import User

router = APIRouter(prefix="/providers", tags=["providers"])


@router.get("", response_model=dict)
async def list_providers(
    page: int = Query(1, ge=1),
    per_page: int = Query(25, ge=1, le=100),
    search: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    q = select(Provider).where(Provider.is_active == True)
    if search:
        term = f"%{search}%"
        q = q.where(or_(
            Provider.first_name.ilike(term),
            Provider.last_name.ilike(term),
            Provider.npi.ilike(term),
            Provider.specialty.ilike(term),
        ))
    total_q = select(func.count()).select_from(Provider).where(Provider.is_active == True)
    total = (await db.execute(total_q)).scalar_one()
    q = q.order_by(Provider.last_name).offset((page - 1) * per_page).limit(per_page)
    result = await db.execute(q)
    return {
        "items": [ProviderOut.model_validate(p) for p in result.scalars().all()],
        "total": total, "page": page, "per_page": per_page,
        "pages": max(1, (total + per_page - 1) // per_page),
    }


@router.post("", response_model=ProviderOut, status_code=201)
async def create_provider(
    body: ProviderCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    provider = Provider(**body.model_dump())
    db.add(provider)
    await db.commit()
    await db.refresh(provider)
    return ProviderOut.model_validate(provider)


@router.get("/{provider_id}", response_model=ProviderOut)
async def get_provider(
    provider_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    result = await db.execute(select(Provider).where(Provider.id == provider_id))
    provider = result.scalar_one_or_none()
    if not provider:
        raise HTTPException(404, "Proveedor no encontrado")
    return ProviderOut.model_validate(provider)


@router.patch("/{provider_id}", response_model=ProviderOut)
async def update_provider(
    provider_id: int,
    body: ProviderUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    result = await db.execute(select(Provider).where(Provider.id == provider_id))
    provider = result.scalar_one_or_none()
    if not provider:
        raise HTTPException(404, "Proveedor no encontrado")
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(provider, field, value)
    await db.commit()
    await db.refresh(provider)
    return ProviderOut.model_validate(provider)
