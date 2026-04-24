"""
Clinic / Provider Setup Wizard
First-time setup: clinic info, providers, payer enrollments, clearinghouse credentials.
"""
from datetime import datetime
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel

from database import get_db
from models import ClinicSettings, User
from auth import get_current_user

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
