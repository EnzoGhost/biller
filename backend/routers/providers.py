"""Providers router — scoped to organization. Also manages per-provider credentials."""
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, or_
from sqlalchemy.orm import selectinload
from datetime import datetime

from database import get_db
from models import Provider, OrgUser, OrgRole, ProviderCredential, ProviderSettings, CredentialType, Organization
from schemas import ProviderOut, ProviderCreate, ProviderUpdate
from auth import get_current_user, _decode_token
from models import User
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from config import encrypt_value, decrypt_value

bearer_scheme = HTTPBearer(auto_error=False)
router = APIRouter(prefix="/providers", tags=["providers"])


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _get_user_org_id(
    credentials: Optional[HTTPAuthorizationCredentials],
    current_user: User,
) -> Optional[int]:
    """Extract org_id from JWT if present."""
    if not credentials:
        return None
    payload = _decode_token(credentials.credentials)
    return payload.get("org_id")


async def _assert_org_member(db: AsyncSession, org_id: int, user_id: int, require_admin: bool = False):
    result = await db.execute(
        select(OrgUser).where(OrgUser.organization_id == org_id, OrgUser.user_id == user_id)
    )
    m = result.scalar_one_or_none()
    if not m:
        raise HTTPException(403, "Not a member of this organization")
    if require_admin and m.role != OrgRole.ADMIN:
        raise HTTPException(403, "Admin access required")
    return m


# ── Provider CRUD ─────────────────────────────────────────────────────────────

@router.get("", response_model=dict)
async def list_providers(
    page: int = Query(1, ge=1),
    per_page: int = Query(25, ge=1, le=100),
    search: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
    current_user: User = Depends(get_current_user),
):
    org_id = await _get_user_org_id(credentials, current_user)

    q = select(Provider).where(Provider.is_active == True)
    count_q = select(func.count()).select_from(Provider).where(Provider.is_active == True)

    # Scope to org if available
    if org_id:
        q = q.where(Provider.organization_id == int(org_id))
        count_q = count_q.where(Provider.organization_id == int(org_id))

    if search:
        term = f"%{search}%"
        cond = or_(
            Provider.first_name.ilike(term),
            Provider.last_name.ilike(term),
            Provider.npi.ilike(term),
            Provider.specialty.ilike(term),
        )
        q = q.where(cond)
        count_q = count_q.where(cond)

    total = (await db.execute(count_q)).scalar_one()
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
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
    current_user: User = Depends(get_current_user),
):
    org_id = await _get_user_org_id(credentials, current_user)
    if org_id:
        await _assert_org_member(db, int(org_id), current_user.id, require_admin=False)

    provider = Provider(**body.model_dump(), organization_id=int(org_id) if org_id else None)
    db.add(provider)
    await db.flush()

    # Create default provider settings
    ps = ProviderSettings(provider_id=provider.id)
    db.add(ps)

    await db.commit()
    await db.refresh(provider)
    return ProviderOut.model_validate(provider)


@router.get("/{provider_id}", response_model=ProviderOut)
async def get_provider(
    provider_id: int,
    db: AsyncSession = Depends(get_db),
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(select(Provider).where(Provider.id == provider_id))
    provider = result.scalar_one_or_none()
    if not provider:
        raise HTTPException(404, "Proveedor no encontrado")

    org_id = await _get_user_org_id(credentials, current_user)
    if org_id and provider.organization_id and provider.organization_id != int(org_id):
        raise HTTPException(403, "Provider not in your organization")

    return ProviderOut.model_validate(provider)


@router.patch("/{provider_id}", response_model=ProviderOut)
async def update_provider(
    provider_id: int,
    body: ProviderUpdate,
    db: AsyncSession = Depends(get_db),
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(select(Provider).where(Provider.id == provider_id))
    provider = result.scalar_one_or_none()
    if not provider:
        raise HTTPException(404, "Proveedor no encontrado")

    org_id = await _get_user_org_id(credentials, current_user)
    if org_id and provider.organization_id and provider.organization_id != int(org_id):
        raise HTTPException(403, "Provider not in your organization")

    for field, value in body.model_dump(exclude_none=True).items():
        setattr(provider, field, value)
    await db.commit()
    await db.refresh(provider)
    return ProviderOut.model_validate(provider)


# ── Provider Settings ─────────────────────────────────────────────────────────

class ProviderSettingsOut(BaseModel):
    id: int
    provider_id: int
    clinic_name: Optional[str] = None
    address_line1: Optional[str] = None
    city: Optional[str] = None
    state: str = "PR"
    phone: Optional[str] = None
    tax_id: Optional[str] = None
    npi_org: Optional[str] = None
    payer_enrollments: list = []
    setup_complete: bool = False
    angelwink_clinic_id: Optional[str] = None

    class Config:
        from_attributes = True


class ProviderSettingsUpdate(BaseModel):
    clinic_name: Optional[str] = None
    address_line1: Optional[str] = None
    address_line2: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    zip_code: Optional[str] = None
    phone: Optional[str] = None
    tax_id: Optional[str] = None
    npi_org: Optional[str] = None
    payer_enrollments: Optional[list] = None
    setup_complete: Optional[bool] = None
    angelwink_clinic_id: Optional[str] = None


@router.get("/{provider_id}/settings", response_model=ProviderSettingsOut)
async def get_provider_settings(
    provider_id: int,
    db: AsyncSession = Depends(get_db),
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(select(ProviderSettings).where(ProviderSettings.provider_id == provider_id))
    ps = result.scalar_one_or_none()
    if not ps:
        # Auto-create
        ps = ProviderSettings(provider_id=provider_id)
        db.add(ps)
        await db.commit()
        await db.refresh(ps)
    return ProviderSettingsOut.model_validate(ps)


@router.put("/{provider_id}/settings", response_model=ProviderSettingsOut)
async def update_provider_settings(
    provider_id: int,
    body: ProviderSettingsUpdate,
    db: AsyncSession = Depends(get_db),
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(select(ProviderSettings).where(ProviderSettings.provider_id == provider_id))
    ps = result.scalar_one_or_none()
    if not ps:
        ps = ProviderSettings(provider_id=provider_id)
        db.add(ps)
        await db.flush()

    for field, value in body.model_dump(exclude_none=True).items():
        setattr(ps, field, value)

    await db.commit()
    await db.refresh(ps)
    return ProviderSettingsOut.model_validate(ps)


# ── Provider Credentials ──────────────────────────────────────────────────────

class CredentialOut(BaseModel):
    id: int
    credential_type: str
    url: Optional[str] = None
    username: Optional[str] = None
    has_password: bool = False
    extra_json: Optional[dict] = None

    class Config:
        from_attributes = True


class CredentialUpsert(BaseModel):
    credential_type: CredentialType
    url: Optional[str] = None
    username: Optional[str] = None
    password: Optional[str] = None  # plaintext; will be encrypted
    extra_json: Optional[dict] = None


@router.get("/{provider_id}/credentials", response_model=List[CredentialOut])
async def list_credentials(
    provider_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(ProviderCredential).where(ProviderCredential.provider_id == provider_id)
    )
    creds = result.scalars().all()
    return [
        CredentialOut(
            id=c.id,
            credential_type=c.credential_type.value,
            url=c.url,
            username=c.username,
            has_password=bool(c.password_encrypted),
            extra_json=c.extra_json,
        )
        for c in creds
    ]


@router.put("/{provider_id}/credentials/{cred_type}", response_model=CredentialOut)
async def upsert_credential(
    provider_id: int,
    cred_type: CredentialType,
    body: CredentialUpsert,
    db: AsyncSession = Depends(get_db),
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
    current_user: User = Depends(get_current_user),
):
    """Create or update a credential for a provider."""
    result = await db.execute(
        select(ProviderCredential).where(
            ProviderCredential.provider_id == provider_id,
            ProviderCredential.credential_type == cred_type,
        )
    )
    cred = result.scalar_one_or_none()

    if not cred:
        cred = ProviderCredential(provider_id=provider_id, credential_type=cred_type)
        db.add(cred)

    if body.url is not None:
        cred.url = body.url
    if body.username is not None:
        cred.username = body.username
    if body.password:
        cred.password_encrypted = encrypt_value(body.password)
    if body.extra_json is not None:
        cred.extra_json = body.extra_json

    await db.commit()
    await db.refresh(cred)
    return CredentialOut(
        id=cred.id,
        credential_type=cred.credential_type.value,
        url=cred.url,
        username=cred.username,
        has_password=bool(cred.password_encrypted),
        extra_json=cred.extra_json,
    )


@router.delete("/{provider_id}/credentials/{cred_type}", status_code=204)
async def delete_credential(
    provider_id: int,
    cred_type: CredentialType,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(ProviderCredential).where(
            ProviderCredential.provider_id == provider_id,
            ProviderCredential.credential_type == cred_type,
        )
    )
    cred = result.scalar_one_or_none()
    if cred:
        await db.delete(cred)
        await db.commit()


@router.delete("/{provider_id}", status_code=204)
async def delete_provider(
    provider_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Soft-delete a provider (sets is_active=False)."""
    result = await db.execute(select(Provider).where(Provider.id == provider_id))
    provider = result.scalar_one_or_none()
    if not provider:
        raise HTTPException(404, "Provider not found")
    provider.is_active = False
    await db.commit()
