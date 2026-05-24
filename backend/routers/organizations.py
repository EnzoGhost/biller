"""Organizations router — CRUD, member management, invite users."""
import re
from datetime import datetime
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from database import get_db
from models import Organization, OrgUser, OrgRole, User, Provider, SubscriptionTier, SubscriptionStatus
from auth import get_current_user, get_current_org, require_org_admin
from schemas import UserOut

router = APIRouter(prefix="/organizations", tags=["organizations"])


# ── Schemas ──────────────────────────────────────────────────────────────────

class OrgCreate(BaseModel):
    name: str
    slug: Optional[str] = None


class OrgUpdate(BaseModel):
    name: Optional[str] = None
    slug: Optional[str] = None


class OrgOut(BaseModel):
    id: int
    name: str
    slug: str
    subscription_tier: str
    subscription_status: str
    max_providers: int
    created_at: datetime
    member_count: int = 0
    provider_count: int = 0

    class Config:
        from_attributes = True


class MemberOut(BaseModel):
    id: int
    user_id: int
    email: str
    full_name: str
    role: str
    invited_at: datetime
    accepted_at: Optional[datetime] = None


class InviteMemberRequest(BaseModel):
    email: str
    role: OrgRole = OrgRole.BILLER


class UpdateMemberRoleRequest(BaseModel):
    role: OrgRole


def _slugify(name: str) -> str:
    """Convert name to URL-safe slug."""
    slug = name.lower().strip()
    slug = re.sub(r"[^a-z0-9]+", "-", slug)
    slug = slug.strip("-")
    return slug[:100]


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("", response_model=List[OrgOut])
async def list_my_orgs(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List all organizations the current user belongs to."""
    result = await db.execute(
        select(OrgUser)
        .options(selectinload(OrgUser.organization))
        .where(OrgUser.user_id == current_user.id)
    )
    memberships = result.scalars().all()

    out = []
    for m in memberships:
        if not m.organization:
            continue
        org = m.organization

        # Count members
        member_count = (await db.execute(
            select(OrgUser).where(OrgUser.organization_id == org.id)
        )).scalars().all()

        # Count providers
        provider_count = (await db.execute(
            select(Provider).where(Provider.organization_id == org.id, Provider.is_active == True)
        )).scalars().all()

        out.append(OrgOut(
            id=org.id, name=org.name, slug=org.slug,
            subscription_tier=org.subscription_tier.value,
            subscription_status=org.subscription_status.value,
            max_providers=org.max_providers,
            created_at=org.created_at,
            member_count=len(member_count),
            provider_count=len(provider_count),
        ))
    return out


@router.post("", response_model=OrgOut, status_code=201)
async def create_org(
    body: OrgCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create a new organization. Creator becomes admin."""
    slug = body.slug or _slugify(body.name)

    # Ensure slug uniqueness
    existing = await db.execute(select(Organization).where(Organization.slug == slug))
    if existing.scalar_one_or_none():
        slug = f"{slug}-{int(datetime.utcnow().timestamp())}"

    org = Organization(
        name=body.name,
        slug=slug,
        subscription_tier=SubscriptionTier.FREE,
        subscription_status=SubscriptionStatus.TRIAL,
    )
    db.add(org)
    await db.flush()

    membership = OrgUser(
        organization_id=org.id,
        user_id=current_user.id,
        role=OrgRole.ADMIN,
        accepted_at=datetime.utcnow(),
    )
    db.add(membership)
    await db.commit()
    await db.refresh(org)

    return OrgOut(
        id=org.id, name=org.name, slug=org.slug,
        subscription_tier=org.subscription_tier.value,
        subscription_status=org.subscription_status.value,
        max_providers=org.max_providers,
        created_at=org.created_at,
        member_count=1, provider_count=0,
    )


@router.get("/{org_id}", response_model=OrgOut)
async def get_org(
    org_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get org details. User must be a member."""
    result = await db.execute(
        select(OrgUser).where(OrgUser.organization_id == org_id, OrgUser.user_id == current_user.id)
    )
    if not result.scalar_one_or_none():
        raise HTTPException(403, "Not a member of this organization")

    result = await db.execute(select(Organization).where(Organization.id == org_id))
    org = result.scalar_one_or_none()
    if not org:
        raise HTTPException(404, "Organization not found")

    member_count = len((await db.execute(select(OrgUser).where(OrgUser.organization_id == org_id))).scalars().all())
    provider_count = len((await db.execute(select(Provider).where(Provider.organization_id == org_id))).scalars().all())

    return OrgOut(
        id=org.id, name=org.name, slug=org.slug,
        subscription_tier=org.subscription_tier.value,
        subscription_status=org.subscription_status.value,
        max_providers=org.max_providers,
        created_at=org.created_at,
        member_count=member_count, provider_count=provider_count,
    )


@router.patch("/{org_id}", response_model=OrgOut)
async def update_org(
    org_id: int,
    body: OrgUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update org. Admin only."""
    result = await db.execute(
        select(OrgUser).where(OrgUser.organization_id == org_id, OrgUser.user_id == current_user.id)
    )
    membership = result.scalar_one_or_none()
    if not membership or membership.role != OrgRole.ADMIN:
        raise HTTPException(403, "Admin access required")

    result = await db.execute(select(Organization).where(Organization.id == org_id))
    org = result.scalar_one_or_none()
    if not org:
        raise HTTPException(404, "Organization not found")

    if body.name:
        org.name = body.name
    if body.slug:
        org.slug = body.slug

    await db.commit()
    await db.refresh(org)

    return OrgOut(
        id=org.id, name=org.name, slug=org.slug,
        subscription_tier=org.subscription_tier.value,
        subscription_status=org.subscription_status.value,
        max_providers=org.max_providers,
        created_at=org.created_at,
    )


@router.get("/{org_id}/members", response_model=List[MemberOut])
async def list_members(
    org_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List org members. User must be a member."""
    result = await db.execute(
        select(OrgUser).where(OrgUser.organization_id == org_id, OrgUser.user_id == current_user.id)
    )
    if not result.scalar_one_or_none():
        raise HTTPException(403, "Not a member of this organization")

    result = await db.execute(
        select(OrgUser)
        .options(selectinload(OrgUser.user))
        .where(OrgUser.organization_id == org_id)
    )
    memberships = result.scalars().all()

    return [
        MemberOut(
            id=m.id,
            user_id=m.user_id,
            email=m.user.email if m.user else "",
            full_name=m.user.full_name if m.user else "",
            role=m.role.value,
            invited_at=m.invited_at,
            accepted_at=m.accepted_at,
        )
        for m in memberships
    ]


@router.post("/{org_id}/members/invite")
async def invite_member(
    org_id: int,
    body: InviteMemberRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Invite a user (by email) to the org. Admin only."""
    result = await db.execute(
        select(OrgUser).where(OrgUser.organization_id == org_id, OrgUser.user_id == current_user.id)
    )
    membership = result.scalar_one_or_none()
    if not membership or membership.role != OrgRole.ADMIN:
        raise HTTPException(403, "Admin access required")

    # Find user by email
    result = await db.execute(select(User).where(User.email == body.email))
    target_user = result.scalar_one_or_none()
    if not target_user:
        raise HTTPException(404, "User with that email not found")

    # Check not already a member
    result = await db.execute(
        select(OrgUser).where(OrgUser.organization_id == org_id, OrgUser.user_id == target_user.id)
    )
    if result.scalar_one_or_none():
        raise HTTPException(409, "User is already a member of this organization")

    new_membership = OrgUser(
        organization_id=org_id,
        user_id=target_user.id,
        role=body.role,
        accepted_at=datetime.utcnow(),  # auto-accept for now
    )
    db.add(new_membership)
    await db.commit()
    return {"message": f"{target_user.full_name} added to organization"}


@router.patch("/{org_id}/members/{user_id}")
async def update_member_role(
    org_id: int,
    user_id: int,
    body: UpdateMemberRoleRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update a member's role. Admin only."""
    result = await db.execute(
        select(OrgUser).where(OrgUser.organization_id == org_id, OrgUser.user_id == current_user.id)
    )
    membership = result.scalar_one_or_none()
    if not membership or membership.role != OrgRole.ADMIN:
        raise HTTPException(403, "Admin access required")

    result = await db.execute(
        select(OrgUser).where(OrgUser.organization_id == org_id, OrgUser.user_id == user_id)
    )
    target = result.scalar_one_or_none()
    if not target:
        raise HTTPException(404, "Member not found")

    target.role = body.role
    await db.commit()
    return {"message": "Role updated"}


@router.delete("/{org_id}/members/{user_id}", status_code=204)
async def remove_member(
    org_id: int,
    user_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Remove a member from the org. Admin only, can't remove yourself."""
    result = await db.execute(
        select(OrgUser).where(OrgUser.organization_id == org_id, OrgUser.user_id == current_user.id)
    )
    membership = result.scalar_one_or_none()
    if not membership or membership.role != OrgRole.ADMIN:
        raise HTTPException(403, "Admin access required")

    if user_id == current_user.id:
        raise HTTPException(400, "Cannot remove yourself from the organization")

    result = await db.execute(
        select(OrgUser).where(OrgUser.organization_id == org_id, OrgUser.user_id == user_id)
    )
    target = result.scalar_one_or_none()
    if not target:
        raise HTTPException(404, "Member not found")

    await db.delete(target)
    await db.commit()
