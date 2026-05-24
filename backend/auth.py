"""Session-based auth with JWT tokens. Multi-tenant: org_id + provider_id in context."""
from datetime import datetime, timedelta
from typing import Optional
from jose import JWTError, jwt
import bcrypt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from config import settings
from database import get_db
from models import User, Organization, OrgUser, Provider, OrgRole

ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 12  # 12 hours

bearer_scheme = HTTPBearer(auto_error=False)


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode('utf-8'), hashed.encode('utf-8'))


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')


def create_access_token(
    data: dict,
    expires_delta: Optional[timedelta] = None,
    org_id: Optional[int] = None,
    provider_id: Optional[int] = None,
) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + (expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    to_encode.update({"exp": expire})
    if org_id is not None:
        to_encode["org_id"] = org_id
    if provider_id is not None:
        to_encode["provider_id"] = provider_id
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=ALGORITHM)


def _decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, settings.SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")


async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    if not credentials:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    payload = _decode_token(credentials.credentials)
    user_id: int = payload.get("sub")
    if user_id is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    result = await db.execute(select(User).where(User.id == int(user_id)))
    user = result.scalar_one_or_none()
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found or inactive")
    return user


async def get_current_user_optional(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> Optional[User]:
    if not credentials:
        return None
    try:
        return await get_current_user(credentials, db)
    except HTTPException:
        return None


async def get_current_org(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Organization:
    """Extract org from JWT and verify user belongs to it."""
    if not credentials:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    payload = _decode_token(credentials.credentials)
    org_id = payload.get("org_id")
    if org_id is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No organization selected. Call /auth/select-org first."
        )

    # Verify user belongs to org
    result = await db.execute(
        select(OrgUser).where(
            OrgUser.organization_id == int(org_id),
            OrgUser.user_id == current_user.id,
        )
    )
    membership = result.scalar_one_or_none()
    if not membership:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied to this organization")

    result = await db.execute(select(Organization).where(Organization.id == int(org_id)))
    org = result.scalar_one_or_none()
    if not org:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organization not found")
    return org


async def get_current_provider(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Provider:
    """Extract provider from JWT and verify it belongs to the user's org."""
    if not credentials:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    payload = _decode_token(credentials.credentials)
    provider_id = payload.get("provider_id")

    if provider_id is None:
        # Fallback: use org's first provider
        org_id = payload.get("org_id")
        if org_id:
            result = await db.execute(
                select(Provider).where(
                    Provider.organization_id == int(org_id),
                    Provider.is_active == True,
                ).limit(1)
            )
            provider = result.scalar_one_or_none()
            if provider:
                return provider

        # No fallback to random providers — orgs must have their own providers
        # This prevents data leaking between organizations
        provider = None
        if provider:
            return provider

        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No provider selected. Call /auth/select-provider first."
        )

    # Verify provider belongs to user's org
    result = await db.execute(
        select(Provider).where(
            Provider.id == int(provider_id),
            Provider.is_active == True,
        )
    )
    provider = result.scalar_one_or_none()
    if not provider:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Provider not found")

    org_id = payload.get("org_id")
    if org_id and provider.organization_id and provider.organization_id != int(org_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Provider does not belong to your organization")

    return provider


async def get_current_provider_optional(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> Optional[Provider]:
    """Like get_current_provider but returns None instead of raising."""
    if not credentials:
        return None
    try:
        payload = _decode_token(credentials.credentials)
        provider_id = payload.get("provider_id")
        if provider_id is None:
            return None
        async with db as session:
            result = await session.execute(
                select(Provider).where(Provider.id == int(provider_id), Provider.is_active == True)
            )
            return result.scalar_one_or_none()
    except Exception:
        return None


async def require_org_admin(
    current_user: User = Depends(get_current_user),
    org: Organization = Depends(get_current_org),
    db: AsyncSession = Depends(get_db),
) -> tuple[User, Organization]:
    """Require user to be an admin of the current org."""
    result = await db.execute(
        select(OrgUser).where(
            OrgUser.organization_id == org.id,
            OrgUser.user_id == current_user.id,
        )
    )
    membership = result.scalar_one_or_none()
    if not membership or membership.role != OrgRole.ADMIN:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    return current_user, org
