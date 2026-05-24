"""
Clinic / Provider Setup Wizard
First-time setup: clinic info, providers, payer enrollments, clearinghouse credentials.
Join-code pairing for external clinic connections.
"""
import random
import string
from datetime import datetime, timedelta
from typing import Dict, List, Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel

from database import get_db
from models import ClinicSettings, User
from auth import get_current_user

# ── In-memory join-code store (code -> {clinic_name, expires_at, angelwink_clinic_id}) ──
_join_codes: Dict[str, dict] = {}

import os as _os
# Default AngelWink clinic ID (from the sync server) — override with ANGELWINK_CLINIC_ID env var
# Clinic ID now stored in clinic_settings.angelwink_clinic_id (set during pairing)


def _clean_expired_codes():
    """Remove expired codes from the store."""
    now = datetime.utcnow()
    expired = [k for k, v in _join_codes.items() if v["expires_at"] < now]
    for k in expired:
        del _join_codes[k]


def _generate_code(length: int = 6) -> str:
    """Generate a human-friendly join code (no confusing chars)."""
    alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"  # excludes 0/O, 1/I/L
    return ''.join(random.choices(alphabet, k=length))

router = APIRouter(prefix="/clinic", tags=["clinic"])


# ── Pydantic schemas ──────────────────────────────────────────────────────────

class PayerEnrollment(BaseModel):
    payer_id: str
    payer_name: str
    enrolled_date: Optional[str] = None
    notes: Optional[str] = None


class ClinicSettingsCreate(BaseModel):
    clinic_name: Optional[str] = None
    address_line1: Optional[str] = None
    address_line2: Optional[str] = None
    city: Optional[str] = None
    state: str = "PR"
    zip_code: Optional[str] = None
    phone: Optional[str] = None
    tax_id: Optional[str] = None
    npi_org: Optional[str] = None
    payer_enrollments: List[PayerEnrollment] = []
    inmediata_sftp_host: Optional[str] = None
    inmediata_sftp_user: Optional[str] = None
    stedi_api_key: Optional[str] = None
    availity_client_id: Optional[str] = None
    availity_client_secret: Optional[str] = None
    setup_complete: bool = False


class ClinicSettingsOut(BaseModel):
    id: int
    clinic_name: Optional[str]
    address_line1: Optional[str]
    address_line2: Optional[str]
    city: Optional[str]
    state: str
    zip_code: Optional[str]
    phone: Optional[str]
    tax_id: Optional[str]
    npi_org: Optional[str]
    payer_enrollments: list
    # Credentials — masked in output
    has_inmediata: bool
    has_stedi: bool
    has_availity: bool
    setup_complete: bool
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _get_or_create_settings(db: AsyncSession) -> ClinicSettings:
    result = await db.execute(select(ClinicSettings).limit(1))
    settings_row = result.scalar_one_or_none()
    if not settings_row:
        settings_row = ClinicSettings()
        db.add(settings_row)
        await db.flush()
    return settings_row


def _to_out(s: ClinicSettings) -> dict:
    return {
        "id": s.id,
        "clinic_name": s.clinic_name,
        "address_line1": s.address_line1,
        "address_line2": s.address_line2,
        "city": s.city,
        "state": s.state,
        "zip_code": s.zip_code,
        "phone": s.phone,
        "tax_id": s.tax_id,
        "npi_org": s.npi_org,
        "payer_enrollments": s.payer_enrollments or [],
        "has_inmediata": bool(s.inmediata_sftp_user),
        "has_stedi": bool(s.stedi_api_key),
        "has_availity": bool(s.availity_client_id),
        "setup_complete": s.setup_complete,
        "created_at": s.created_at,
        "updated_at": s.updated_at,
    }


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/settings")
async def get_clinic_settings(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Get current clinic settings. Creates default record if none exists."""
    s = await _get_or_create_settings(db)
    await db.commit()
    return _to_out(s)


@router.put("/settings")
async def upsert_clinic_settings(
    body: ClinicSettingsCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Create or update clinic settings (upsert). Marks wizard complete if body.setup_complete=True."""
    s = await _get_or_create_settings(db)

    if body.clinic_name is not None:
        s.clinic_name = body.clinic_name
    if body.address_line1 is not None:
        s.address_line1 = body.address_line1
    if body.address_line2 is not None:
        s.address_line2 = body.address_line2
    if body.city is not None:
        s.city = body.city
    s.state = body.state
    if body.zip_code is not None:
        s.zip_code = body.zip_code
    if body.phone is not None:
        s.phone = body.phone
    if body.tax_id is not None:
        s.tax_id = body.tax_id
    if body.npi_org is not None:
        s.npi_org = body.npi_org
    if body.payer_enrollments:
        s.payer_enrollments = [e.model_dump() for e in body.payer_enrollments]
    if body.inmediata_sftp_host is not None:
        s.inmediata_sftp_host = body.inmediata_sftp_host
    if body.inmediata_sftp_user is not None:
        s.inmediata_sftp_user = body.inmediata_sftp_user
    # Only update API keys if non-empty (avoid wiping creds)
    if body.stedi_api_key:
        s.stedi_api_key = body.stedi_api_key
    if body.availity_client_id:
        s.availity_client_id = body.availity_client_id
    if body.availity_client_secret:
        s.availity_client_secret = body.availity_client_secret
    if body.setup_complete:
        s.setup_complete = True

    await db.commit()
    await db.refresh(s)
    return _to_out(s)


@router.post("/settings/complete")
async def mark_setup_complete(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Mark the setup wizard as complete."""
    s = await _get_or_create_settings(db)
    s.setup_complete = True
    await db.commit()
    return {"setup_complete": True}


@router.post("/config")
async def save_clinic_config(
    body: dict,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """
    Simple config save from Settings page.
    Saves clinic info and optionally updates the default provider's name.
    """
    from models import Provider

    s = await _get_or_create_settings(db)

    if body.get("clinic_name"):
        s.clinic_name = body["clinic_name"]
    if body.get("npi"):
        s.npi_org = body["npi"]
    if body.get("tax_id"):
        s.tax_id = body["tax_id"]
    if body.get("address"):
        s.address_line1 = body["address"]
    if body.get("phone"):
        s.phone = body["phone"]

    # Update default provider name if provided
    provider_name = body.get("provider_name", "").strip()
    if provider_name:
        result = await db.execute(
            select(Provider).where(Provider.is_active == True).limit(1)
        )
        provider = result.scalar_one_or_none()
        if provider:
            parts = provider_name.split(" ", 1)
            provider.first_name = parts[0]
            provider.last_name = parts[1] if len(parts) > 1 else ""

    await db.commit()
    return {"status": "saved"}


@router.get("/config")
async def get_clinic_config(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Get current clinic info + default provider name for the settings page."""
    from models import Provider

    s = await _get_or_create_settings(db)
    result = await db.execute(
        select(Provider).where(Provider.is_active == True).limit(1)
    )
    provider = result.scalar_one_or_none()
    provider_name = ""
    if provider:
        provider_name = f"{provider.first_name or ''} {provider.last_name or ''}".strip()

    await db.commit()
    return {
        "clinic_name": s.clinic_name or "",
        "npi": s.npi_org or "",
        "tax_id": s.tax_id or "",
        "address": s.address_line1 or "",
        "phone": s.phone or "",
        "provider_name": provider_name,
    }


@router.get("/settings/wizard-status")
async def get_wizard_status(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """
    Returns whether the setup wizard needs to be shown.
    Wizard shows if setup_complete=False or clinic_name is empty.
    """
    s = await _get_or_create_settings(db)
    await db.commit()
    needs_setup = not s.setup_complete or not s.clinic_name
    return {
        "needs_setup": needs_setup,
        "setup_complete": s.setup_complete,
        "has_clinic_name": bool(s.clinic_name),
        "has_tax_id": bool(s.tax_id),
        "has_npi": bool(s.npi_org),
        "has_clearinghouse": bool(s.stedi_api_key or s.inmediata_sftp_user),
    }


# ── Join Code Endpoints ───────────────────────────────────────────────────────

@router.post("/join-codes/generate")
async def generate_join_code(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """
    Admin-only: generate a 6-char join code that expires in 5 minutes.
    Used for pairing external clinic systems (e.g. Wink).
    """
    if user.role not in ("admin", "owner"):
        raise HTTPException(status_code=403, detail="Admin access required")

    _clean_expired_codes()

    s = await _get_or_create_settings(db)
    await db.commit()

    code = _generate_code()
    expires_at = datetime.utcnow() + timedelta(minutes=5)
    _join_codes[code] = {
        "clinic_name": s.clinic_name or "Unnamed Clinic",
        "angelwink_clinic_id": "",
        "expires_at": expires_at,
        "created_by": user.id,
    }

    return {
        "code": code,
        "expires_at": expires_at.isoformat(),
        "expires_in": 300,
    }


@router.post("/join-codes/verify")
async def verify_join_code(body: dict, db: AsyncSession = Depends(get_db)):
    """
    Verify a join code by checking the AngelWink sync server.
    The code was generated in AngelWink and stored on the sync server's PostgreSQL.
    On success, stores the clinic_id in clinic_settings for multi-tenant support.
    No auth required — the code IS the auth.
    """
    import requests as _requests
    code = body.get("code", "").upper().strip()
    if not code:
        raise HTTPException(status_code=400, detail="Code is required")

    # First try the Wink sync server (where the code actually lives)
    try:
        resp = _requests.post(
            "http://localhost:3100/api/sync/join-codes/verify",
            json={"code": code},
            timeout=5,
        )
        if resp.ok:
            data = resp.json()
            if data.get("clinic_id"):
                # Persist the paired clinic ID in clinic_settings
                try:
                    from sqlalchemy import text
                    await db.execute(text(
                        "UPDATE clinic_settings SET angelwink_clinic_id = :cid WHERE id = 1"
                    ), {"cid": data["clinic_id"]})
                    await db.commit()
                except Exception:
                    pass
                return {
                    "valid": True,
                    "clinic_name": data.get("name", "AngelAngelWink Clinic"),
                    "angelwink_clinic_id": data["clinic_id"],
                }
            else:
                return {"valid": False, "message": data.get("error", "Invalid or expired code")}
        else:
            error_data = resp.json() if resp.headers.get('content-type', '').startswith('application/json') else {}
            return {"valid": False, "message": error_data.get("error", "Invalid or expired code")}
    except Exception as e:
        pass  # Fall through to local check

    # Fallback: check SometeoPR's own join codes (for SometeoPR-generated codes)
    _clean_expired_codes()
    entry = _join_codes.get(code)
    if not entry:
        return {"valid": False, "message": "Invalid or expired code"}
    if entry["expires_at"] < datetime.utcnow():
        del _join_codes[code]
        return {"valid": False, "message": "Code expired"}
    clinic_name = entry["clinic_name"]
    angelwink_clinic_id = entry.get("angelwink_clinic_id", "")
    del _join_codes[code]

    return {
        "valid": True,
        "clinic_name": clinic_name,
        "angelwink_clinic_id": angelwink_clinic_id,
    }
