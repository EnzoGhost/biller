"""
Insurance Portal credentials management.
Stores credentials for iVision, Envolve, Triple-S, and InnovaMD portals.
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import Optional

from database import get_db
from models import ClinicSettings
from auth import get_current_user
from config import encrypt_value, decrypt_value

router = APIRouter(prefix="/portals", tags=["portals"])

PORTAL_IDS = {"ivision", "envolve", "triples", "innovamd"}


class PortalConfigIn(BaseModel):
    url: Optional[str] = None
    username: Optional[str] = None
    password: Optional[str] = None  # None means "don't change"


def _get_portal_fields(portal_id: str) -> tuple[str, str, str]:
    """Returns (url_col, username_col, password_col) for a portal."""
    return (
        f"{portal_id}_url",
        f"{portal_id}_username",
        f"{portal_id}_password",
    )


def _portal_config_dict(settings: ClinicSettings, portal_id: str) -> dict:
    url_col, user_col, pass_col = _get_portal_fields(portal_id)
    url = getattr(settings, url_col, None)
    username = getattr(settings, user_col, None)
    raw_password = getattr(settings, pass_col, None)
    connected = bool(username and raw_password)
    return {
        "portal_id": portal_id,
        "url": url or "",
        "username": username or "",
        "password_masked": "••••••••" if connected else "",
        "connected": connected,
    }


async def _get_or_create_settings(db: AsyncSession) -> ClinicSettings:
    result = await db.execute(select(ClinicSettings).limit(1))
    settings = result.scalar_one_or_none()
    if not settings:
        settings = ClinicSettings()
        db.add(settings)
        await db.flush()
    return settings


@router.get("/config")
async def get_portals_config(
    db: AsyncSession = Depends(get_db),
    _user=Depends(get_current_user),
):
    """Return all portal configs (passwords masked)."""
    result = await db.execute(select(ClinicSettings).limit(1))
    settings = result.scalar_one_or_none()
    if not settings:
        # Return defaults
        return {p: {"portal_id": p, "url": "", "username": "", "password_masked": "", "connected": False}
                for p in PORTAL_IDS}
    return {p: _portal_config_dict(settings, p) for p in PORTAL_IDS}


@router.post("/{portal_id}/config")
async def save_portal_config(
    portal_id: str,
    body: PortalConfigIn,
    db: AsyncSession = Depends(get_db),
    _user=Depends(get_current_user),
):
    """Save portal config. Only updates password if a non-empty value is provided."""
    if portal_id not in PORTAL_IDS:
        raise HTTPException(status_code=404, detail=f"Unknown portal: {portal_id}")

    settings = await _get_or_create_settings(db)
    url_col, user_col, pass_col = _get_portal_fields(portal_id)

    if body.url is not None:
        setattr(settings, url_col, body.url)
    if body.username is not None:
        setattr(settings, user_col, body.username)
    if body.password:  # Only update if non-empty
        setattr(settings, pass_col, encrypt_value(body.password))

    await db.commit()
    await db.refresh(settings)
    return _portal_config_dict(settings, portal_id)


@router.post("/{portal_id}/disconnect")
async def disconnect_portal(
    portal_id: str,
    db: AsyncSession = Depends(get_db),
    _user=Depends(get_current_user),
):
    """Clear portal credentials."""
    if portal_id not in PORTAL_IDS:
        raise HTTPException(status_code=404, detail=f"Unknown portal: {portal_id}")

    settings = await _get_or_create_settings(db)
    url_col, user_col, pass_col = _get_portal_fields(portal_id)

    setattr(settings, user_col, None)
    setattr(settings, pass_col, None)
    # Keep URL since it's a default

    await db.commit()
    return {"ok": True, "portal_id": portal_id}
