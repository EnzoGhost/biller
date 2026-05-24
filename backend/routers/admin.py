"""
Super Admin API — /api/admin/*
Separate from regular user auth. Requires is_super_admin=True on the User record.
"""
from datetime import datetime, timedelta
from typing import Optional, List
from jose import JWTError, jwt
import bcrypt

from fastapi import APIRouter, Depends, HTTPException, status, Response
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, text
from sqlalchemy.orm import selectinload
from pydantic import BaseModel

from config import settings
from database import get_db
from models import User, Organization, Provider, Claim, SubscriptionTier, OrgUser, OrgRole, UserRole

router = APIRouter(prefix="/admin", tags=["admin"])

ALGORITHM = "HS256"
ADMIN_TOKEN_EXPIRE_HOURS = 24
ADMIN_SECRET_SUFFIX = "_super_admin_v1"
bearer_scheme = HTTPBearer(auto_error=False)


# ── Token helpers ─────────────────────────────────────────────────────────────

def _create_admin_token(user_id: int, email: str) -> str:
    payload = {
        "sub": str(user_id),
        "email": email,
        "super_admin": True,
        "exp": datetime.utcnow() + timedelta(hours=ADMIN_TOKEN_EXPIRE_HOURS),
    }
    return jwt.encode(payload, settings.SECRET_KEY + ADMIN_SECRET_SUFFIX, algorithm=ALGORITHM)


async def _get_admin_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    if not credentials:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(
            credentials.credentials,
            settings.SECRET_KEY + ADMIN_SECRET_SUFFIX,
            algorithms=[ALGORITHM],
        )
        if not payload.get("super_admin"):
            raise HTTPException(status_code=403, detail="Not a super admin token")
        user_id = int(payload["sub"])
    except (JWTError, KeyError, ValueError):
        raise HTTPException(status_code=401, detail="Invalid admin token")

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user or not user.is_active or not user.is_super_admin:
        raise HTTPException(status_code=403, detail="Super admin access denied")
    return user


# ── Schemas ───────────────────────────────────────────────────────────────────

class AdminLoginRequest(BaseModel):
    email: str
    password: str


class AdminLoginResponse(BaseModel):
    token: str
    email: str


class OrgCreate(BaseModel):
    name: str
    slug: Optional[str] = None
    subscription_tier: SubscriptionTier = SubscriptionTier.FREE


class OrgUpdate(BaseModel):
    name: Optional[str] = None
    is_active: Optional[bool] = None
    notes: Optional[str] = None


class SubscriptionUpdate(BaseModel):
    tier: SubscriptionTier
    expires_at: Optional[str] = None  # ISO datetime string or None


class UserCreate(BaseModel):
    email: str
    full_name: str
    password: str
    role: str = "admin"
    organization_id: Optional[int] = None


class UserUpdate(BaseModel):
    full_name: Optional[str] = None
    is_active: Optional[bool] = None
    role: Optional[str] = None
    organization_id: Optional[int] = None


class ResetPasswordRequest(BaseModel):
    new_password: str


# ── Auth ──────────────────────────────────────────────────────────────────────

@router.post("/login", response_model=AdminLoginResponse)
async def admin_login(body: AdminLoginRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.email == body.email))
    user = result.scalar_one_or_none()
    if not user or not user.is_super_admin or not user.is_active:
        raise HTTPException(status_code=401, detail="Invalid credentials or not a super admin")
    if not bcrypt.checkpw(body.password.encode(), user.hashed_password.encode()):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    token = _create_admin_token(user.id, user.email)
    return AdminLoginResponse(token=token, email=user.email)


@router.post("/logout")
async def admin_logout(_: User = Depends(_get_admin_user)):
    return {"ok": True}


# ── Dashboard ─────────────────────────────────────────────────────────────────

@router.get("/dashboard")
async def admin_dashboard(
    _: User = Depends(_get_admin_user),
    db: AsyncSession = Depends(get_db),
):
    total_orgs = (await db.execute(select(func.count()).select_from(Organization))).scalar() or 0
    total_users = (await db.execute(select(func.count()).select_from(User).where(User.is_super_admin == False))).scalar() or 0
    total_providers = (await db.execute(select(func.count()).select_from(Provider))).scalar() or 0
    total_claims = (await db.execute(select(func.count()).select_from(Claim))).scalar() or 0

    # Claims submitted in last 7 days
    cutoff = datetime.utcnow() - timedelta(days=7)
    recent_claims = (
        await db.execute(
            select(func.count()).select_from(Claim).where(Claim.created_at >= cutoff)
        )
    ).scalar() or 0

    # Recent users (last 7 days)
    recent_users = (
        await db.execute(
            select(func.count()).select_from(User).where(
                User.created_at >= cutoff, User.is_super_admin == False
            )
        )
    ).scalar() or 0

    # Active orgs
    active_orgs = (
        await db.execute(select(func.count()).select_from(Organization).where(Organization.is_active == True))
    ).scalar() or 0

    return {
        "total_organizations": total_orgs,
        "active_organizations": active_orgs,
        "total_users": total_users,
        "total_providers": total_providers,
        "total_claims": total_claims,
        "recent_claims_7d": recent_claims,
        "recent_users_7d": recent_users,
    }


# ── Organizations ─────────────────────────────────────────────────────────────

@router.get("/organizations")
async def list_organizations(
    _: User = Depends(_get_admin_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Organization).order_by(Organization.created_at.desc()))
    orgs = result.scalars().all()

    out = []
    for org in orgs:
        user_count = (
            await db.execute(
                select(func.count()).select_from(OrgUser).where(
                    OrgUser.organization_id == org.id
                )
            )
        ).scalar() or 0
        provider_count = (
            await db.execute(
                select(func.count()).select_from(Provider).where(
                    Provider.organization_id == org.id
                )
            )
        ).scalar() or 0
        out.append({
            "id": org.id,
            "name": org.name,
            "slug": org.slug,
            "subscription_tier": org.subscription_tier,
            "subscription_expires_at": org.subscription_expires_at.isoformat() if org.subscription_expires_at else None,
            "is_active": org.is_active,
            "notes": org.notes,
            "user_count": user_count,
            "provider_count": provider_count,
            "created_at": org.created_at.isoformat(),
        })
    return {"organizations": out}


@router.post("/organizations", status_code=201)
async def create_organization(
    body: OrgCreate,
    _: User = Depends(_get_admin_user),
    db: AsyncSession = Depends(get_db),
):
    slug = body.slug or body.name.lower().replace(" ", "-").replace("_", "-")
    org = Organization(
        name=body.name,
        slug=slug,
        subscription_tier=body.subscription_tier or 'free',
        subscription_status='trial',
        max_providers=5,
        is_active=True,
    )
    db.add(org)
    await db.commit()
    await db.refresh(org)
    return {
        "id": org.id,
        "name": org.name,
        "slug": org.slug,
        "subscription_tier": org.subscription_tier,
        "is_active": org.is_active,
        "created_at": org.created_at.isoformat(),
    }


@router.get("/organizations/{org_id}")
async def get_organization(
    org_id: int,
    _: User = Depends(_get_admin_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Organization).where(Organization.id == org_id))
    org = result.scalar_one_or_none()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    users_result = await db.execute(
        select(User).join(OrgUser, OrgUser.user_id == User.id).where(
            OrgUser.organization_id == org_id, User.is_super_admin == False
        )
    )
    users = users_result.scalars().all()

    return {
        "id": org.id,
        "name": org.name,
        "slug": org.slug,
        "subscription_tier": org.subscription_tier,
        "subscription_expires_at": org.subscription_expires_at.isoformat() if org.subscription_expires_at else None,
        "is_active": org.is_active,
        "notes": org.notes,
        "stripe_customer_id": org.stripe_customer_id,
        "created_at": org.created_at.isoformat(),
        "updated_at": org.updated_at.isoformat(),
        "users": [
            {
                "id": u.id,
                "email": u.email,
                "full_name": u.full_name,
                "role": u.role,
                "is_active": u.is_active,
                "created_at": u.created_at.isoformat(),
            }
            for u in users
        ],
    }


@router.patch("/organizations/{org_id}")
async def update_organization(
    org_id: int,
    body: OrgUpdate,
    _: User = Depends(_get_admin_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Organization).where(Organization.id == org_id))
    org = result.scalar_one_or_none()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    if body.name is not None:
        org.name = body.name
    if body.is_active is not None:
        org.is_active = body.is_active
    if body.notes is not None:
        org.notes = body.notes
    org.updated_at = datetime.utcnow()

    await db.commit()
    await db.refresh(org)
    return {"id": org.id, "name": org.name, "is_active": org.is_active, "notes": org.notes}


@router.patch("/organizations/{org_id}/subscription")
async def update_subscription(
    org_id: int,
    body: SubscriptionUpdate,
    _: User = Depends(_get_admin_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Organization).where(Organization.id == org_id))
    org = result.scalar_one_or_none()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    org.subscription_tier = body.tier
    if body.expires_at:
        org.subscription_expires_at = datetime.fromisoformat(body.expires_at.replace("Z", "+00:00"))
    else:
        org.subscription_expires_at = None
    org.updated_at = datetime.utcnow()

    await db.commit()
    await db.refresh(org)
    return {
        "id": org.id,
        "subscription_tier": org.subscription_tier,
        "subscription_expires_at": org.subscription_expires_at.isoformat() if org.subscription_expires_at else None,
    }


# ── Users ─────────────────────────────────────────────────────────────────────

@router.get("/users")
async def list_users(
    _: User = Depends(_get_admin_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(User)
        .where(User.is_super_admin == False)
        .options(selectinload(User.org_memberships))
        .order_by(User.created_at.desc())
    )
    users = result.scalars().all()
    return {
        "users": [
            {
                "id": u.id,
                "email": u.email,
                "full_name": u.full_name,
                "role": u.role.value if hasattr(u.role, 'value') else u.role,
                "is_active": u.is_active,
                "organization_id": u.org_memberships[0].organization_id if u.org_memberships else None,
                "created_at": u.created_at.isoformat(),
            }
            for u in users
        ]
    }


@router.post("/users", status_code=201)
async def create_user(
    body: UserCreate,
    _: User = Depends(_get_admin_user),
    db: AsyncSession = Depends(get_db),
):
    # Check email uniqueness
    existing = await db.execute(select(User).where(User.email == body.email))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Email already in use")

    hashed = bcrypt.hashpw(body.password.encode(), bcrypt.gensalt()).decode()
    try:
        role_enum = UserRole(body.role) if body.role else UserRole.BILLER
    except ValueError:
        role_enum = UserRole.BILLER
    user = User(
        email=body.email,
        full_name=body.full_name,
        hashed_password=hashed,
        role=role_enum,
        is_active=True,
        is_super_admin=False,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    # If organization_id provided, add membership
    if body.organization_id:
        # Map User role to OrgUser role
        org_role = OrgRole.ADMIN if role_enum == UserRole.ADMIN else (
            OrgRole.VIEWER if role_enum == UserRole.VIEWER else OrgRole.BILLER
        )
        org_membership = OrgUser(
            organization_id=body.organization_id,
            user_id=user.id,
            role=org_role,
            accepted_at=datetime.utcnow(),  # Admin-created users are immediately active
        )
        db.add(org_membership)
        await db.commit()
    return {
        "id": user.id,
        "email": user.email,
        "full_name": user.full_name,
        "role": user.role.value if hasattr(user.role, 'value') else user.role,
        "organization_id": body.organization_id,
        "created_at": user.created_at.isoformat(),
    }


@router.patch("/users/{user_id}")
async def update_user(
    user_id: int,
    body: UserUpdate,
    admin: User = Depends(_get_admin_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.is_super_admin:
        raise HTTPException(status_code=403, detail="Cannot modify super admin via this endpoint")

    if body.full_name is not None:
        user.full_name = body.full_name
    if body.is_active is not None:
        user.is_active = body.is_active
    if body.role is not None:
        try:
            user.role = UserRole(body.role)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Invalid role: {body.role}")
    if body.organization_id is not None:
        # Update via OrgUser junction table
        existing_membership = await db.execute(
            select(OrgUser).where(OrgUser.user_id == user_id)
        )
        membership = existing_membership.scalar_one_or_none()
        if membership:
            membership.organization_id = body.organization_id
        else:
            db.add(OrgUser(organization_id=body.organization_id, user_id=user_id, role=OrgRole.BILLER))
    user.updated_at = datetime.utcnow()

    await db.commit()
    await db.refresh(user)
    return {
        "id": user.id,
        "email": user.email,
        "full_name": user.full_name,
        "role": user.role,
        "is_active": user.is_active,
        "organization_id": body.organization_id,
    }


@router.post("/users/{user_id}/reset-password")
async def reset_password(
    user_id: int,
    body: ResetPasswordRequest,
    _: User = Depends(_get_admin_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.is_super_admin:
        raise HTTPException(status_code=403, detail="Cannot reset super admin password via this endpoint")

    user.hashed_password = bcrypt.hashpw(body.new_password.encode(), bcrypt.gensalt()).decode()
    user.updated_at = datetime.utcnow()
    await db.commit()
    return {"ok": True}


# ── Providers ─────────────────────────────────────────────────────────────────

@router.get("/providers")
async def list_providers(
    _: User = Depends(_get_admin_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Provider).where(Provider.is_active == True).order_by(Provider.last_name)
    )
    providers = result.scalars().all()

    out = []
    for p in providers:
        claim_count = (
            await db.execute(
                select(func.count()).select_from(Claim).where(Claim.provider_id == p.id)
            )
        ).scalar() or 0
        out.append({
            "id": p.id,
            "npi": p.npi,
            "full_name": f"{p.first_name} {p.last_name}",
            "specialty": p.specialty,
            "city": p.city,
            "state": p.state,
            "is_active": p.is_active,
            "claim_count": claim_count,
            "created_at": p.created_at.isoformat(),
        })
    return {"providers": out}


@router.delete("/providers/{provider_id}", status_code=204)
async def delete_provider(
    provider_id: int,
    _: User = Depends(_get_admin_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Provider).where(Provider.id == provider_id))
    provider = result.scalar_one_or_none()
    if not provider:
        raise HTTPException(status_code=404, detail="Provider not found")
    # Soft delete
    provider.is_active = False
    await db.commit()
    return Response(status_code=204)
