from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from typing import List, Optional

from database import get_db
from models import User, Organization, OrgUser, Provider, OrgRole
from schemas import LoginRequest, TokenResponse, UserOut, UserCreate
from auth import verify_password, hash_password, create_access_token, get_current_user, _decode_token
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

bearer_scheme = HTTPBearer(auto_error=False)
router = APIRouter(prefix="/auth", tags=["auth"])


class OrgOut(BaseModel):
    id: int
    name: str
    slug: str
    role: str
    subscription_tier: str
    subscription_status: str

    class Config:
        from_attributes = True


class ProviderShort(BaseModel):
    id: int
    npi: str
    first_name: str
    last_name: str
    specialty: Optional[str] = None

    class Config:
        from_attributes = True


class SelectOrgRequest(BaseModel):
    org_id: int


class SelectProviderRequest(BaseModel):
    provider_id: int


class TokenResponseMulti(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut
    organizations: List[OrgOut] = []
    current_org: Optional[OrgOut] = None
    current_provider: Optional[ProviderShort] = None


@router.post("/login", response_model=TokenResponseMulti)
async def login(body: LoginRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.email == body.email))
    user = result.scalar_one_or_none()
    if not user or not verify_password(body.password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Credenciales inválidas")
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cuenta desactivada")

    # Load user's organizations
    result = await db.execute(
        select(OrgUser)
        .options(selectinload(OrgUser.organization))
        .where(OrgUser.user_id == user.id)
    )
    memberships = result.scalars().all()

    orgs = [
        OrgOut(
            id=m.organization.id,
            name=m.organization.name,
            slug=m.organization.slug,
            role=m.role.value,
            subscription_tier=m.organization.subscription_tier.value,
            subscription_status=m.organization.subscription_status.value,
        )
        for m in memberships
        if m.organization
    ]

    # Auto-select if only one org
    org_id = orgs[0].id if len(orgs) == 1 else None
    provider_id = None
    current_provider = None
    current_org = None

    if org_id:
        current_org = orgs[0]
        # Auto-select first provider in the org
        result = await db.execute(
            select(Provider).where(
                Provider.organization_id == org_id,
                Provider.is_active == True,
            ).limit(1)
        )
        provider = result.scalar_one_or_none()
        if provider:
            provider_id = provider.id
            current_provider = ProviderShort.model_validate(provider)

    token = create_access_token(
        {"sub": str(user.id)},
        org_id=org_id,
        provider_id=provider_id,
    )
    return TokenResponseMulti(
        access_token=token,
        user=UserOut.model_validate(user),
        organizations=orgs,
        current_org=current_org,
        current_provider=current_provider,
    )


@router.post("/select-org", response_model=TokenResponseMulti)
async def select_org(
    body: SelectOrgRequest,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Switch to a different organization. Returns new token with org_id set."""
    result = await db.execute(
        select(OrgUser)
        .options(selectinload(OrgUser.organization))
        .where(OrgUser.user_id == current_user.id, OrgUser.organization_id == body.org_id)
    )
    membership = result.scalar_one_or_none()
    if not membership:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not a member of this organization")

    org = membership.organization

    # Auto-select first provider
    result = await db.execute(
        select(Provider).where(
            Provider.organization_id == org.id,
            Provider.is_active == True,
        ).limit(1)
    )
    provider = result.scalar_one_or_none()
    provider_id = provider.id if provider else None

    token = create_access_token(
        {"sub": str(current_user.id)},
        org_id=org.id,
        provider_id=provider_id,
    )

    # Reload all orgs for response
    all_memberships = (await db.execute(
        select(OrgUser).options(selectinload(OrgUser.organization)).where(OrgUser.user_id == current_user.id)
    )).scalars().all()
    orgs = [
        OrgOut(
            id=m.organization.id, name=m.organization.name, slug=m.organization.slug,
            role=m.role.value, subscription_tier=m.organization.subscription_tier.value,
            subscription_status=m.organization.subscription_status.value,
        )
        for m in all_memberships if m.organization
    ]

    return TokenResponseMulti(
        access_token=token,
        user=UserOut.model_validate(current_user),
        organizations=orgs,
        current_org=OrgOut(
            id=org.id, name=org.name, slug=org.slug,
            role=membership.role.value,
            subscription_tier=org.subscription_tier.value,
            subscription_status=org.subscription_status.value,
        ),
        current_provider=ProviderShort.model_validate(provider) if provider else None,
    )


@router.post("/select-provider", response_model=TokenResponseMulti)
async def select_provider(
    body: SelectProviderRequest,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Switch to a different provider within the current org. Returns new token."""
    if not credentials:
        raise HTTPException(status_code=401, detail="Not authenticated")

    payload = _decode_token(credentials.credentials)
    org_id = payload.get("org_id")

    result = await db.execute(
        select(Provider).where(
            Provider.id == body.provider_id,
            Provider.is_active == True,
        )
    )
    provider = result.scalar_one_or_none()
    if not provider:
        raise HTTPException(status_code=404, detail="Provider not found")

    # Verify provider belongs to org
    if org_id and provider.organization_id and provider.organization_id != int(org_id):
        raise HTTPException(status_code=403, detail="Provider does not belong to your organization")

    token = create_access_token(
        {"sub": str(current_user.id)},
        org_id=org_id,
        provider_id=provider.id,
    )

    # Load orgs
    all_memberships = (await db.execute(
        select(OrgUser).options(selectinload(OrgUser.organization)).where(OrgUser.user_id == current_user.id)
    )).scalars().all()
    orgs = [
        OrgOut(
            id=m.organization.id, name=m.organization.name, slug=m.organization.slug,
            role=m.role.value, subscription_tier=m.organization.subscription_tier.value,
            subscription_status=m.organization.subscription_status.value,
        )
        for m in all_memberships if m.organization
    ]

    current_org_out = None
    if org_id:
        org_result = await db.execute(select(Organization).where(Organization.id == int(org_id)))
        org = org_result.scalar_one_or_none()
        if org:
            membership_result = await db.execute(
                select(OrgUser).where(OrgUser.organization_id == org.id, OrgUser.user_id == current_user.id)
            )
            mem = membership_result.scalar_one_or_none()
            current_org_out = OrgOut(
                id=org.id, name=org.name, slug=org.slug,
                role=mem.role.value if mem else "viewer",
                subscription_tier=org.subscription_tier.value,
                subscription_status=org.subscription_status.value,
            )

    return TokenResponseMulti(
        access_token=token,
        user=UserOut.model_validate(current_user),
        organizations=orgs,
        current_org=current_org_out,
        current_provider=ProviderShort.model_validate(provider),
    )


@router.get("/me", response_model=TokenResponseMulti)
async def me(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get current user, orgs, and active provider from token."""
    payload = _decode_token(credentials.credentials) if credentials else {}
    org_id = payload.get("org_id")
    provider_id = payload.get("provider_id")

    all_memberships = (await db.execute(
        select(OrgUser).options(selectinload(OrgUser.organization)).where(OrgUser.user_id == current_user.id)
    )).scalars().all()
    orgs = [
        OrgOut(
            id=m.organization.id, name=m.organization.name, slug=m.organization.slug,
            role=m.role.value, subscription_tier=m.organization.subscription_tier.value,
            subscription_status=m.organization.subscription_status.value,
        )
        for m in all_memberships if m.organization
    ]

    current_org_out = None
    if org_id:
        for o in orgs:
            if o.id == int(org_id):
                current_org_out = o
                break

    current_provider_out = None
    if provider_id:
        result = await db.execute(select(Provider).where(Provider.id == int(provider_id)))
        prov = result.scalar_one_or_none()
        if prov:
            current_provider_out = ProviderShort.model_validate(prov)

    # Re-issue same token (just return what we have)
    return TokenResponseMulti(
        access_token=credentials.credentials if credentials else "",
        user=UserOut.model_validate(current_user),
        organizations=orgs,
        current_org=current_org_out,
        current_provider=current_provider_out,
    )


@router.patch("/me/language", response_model=UserOut)
async def update_language(
    body: dict,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    lang = body.get("language", "en")
    if lang not in ("en", "es"):
        raise HTTPException(status_code=400, detail="language must be 'en' or 'es'")
    current_user.language = lang
    await db.commit()
    await db.refresh(current_user)
    return UserOut.model_validate(current_user)


@router.post("/register", response_model=UserOut, status_code=201)
async def register(body: UserCreate, db: AsyncSession = Depends(get_db)):
    existing = await db.execute(select(User).where(User.email == body.email))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Email ya registrado")
    user = User(
        email=body.email,
        full_name=body.full_name,
        hashed_password=hash_password(body.password),
        role=body.role,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return UserOut.model_validate(user)
