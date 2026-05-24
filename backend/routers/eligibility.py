"""
Eligibility Router — Real-Time X12 270/271 via Inmediata SecureTrack

Endpoints:
  POST /eligibility/check              — check patient eligibility (real-time 270→271)
  GET  /eligibility/history/{patient_id} — past eligibility checks for a patient
  GET  /eligibility/{check_id}         — retrieve a single check result
"""
from __future__ import annotations

import logging
from datetime import date
from typing import Optional, Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc
from sqlalchemy.orm import selectinload

from auth import get_current_user
from config import settings
from database import get_db
from edi.securetrack_client import SecureTrackClient
from edi.x12_270 import generate_270
from edi.x12_271 import parse_271_summary
from models import EligibilityCheck, Patient, PatientInsurance, Payer, User

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/eligibility", tags=["eligibility"])


# ── Pydantic schemas ──────────────────────────────────────────────────────────

class EligibilityCheckRequest(BaseModel):
    patient_id: int
    insurance_id: Optional[int] = None          # PatientInsurance.id — use primary if omitted
    payer_id_override: Optional[str] = None     # override payer EDI ID
    service_type_codes: list[str] = ["30"]      # default: health benefit plan coverage
    as_of_date: Optional[date] = None           # inquiry date, defaults to today


class EligibilityCheckResponse(BaseModel):
    id: int
    patient_id: int
    patient_name: Optional[str] = None
    payer_name: Optional[str] = None
    payer_id: Optional[str] = None
    member_id: Optional[str] = None
    status: str
    response_parsed: Optional[dict] = None
    checked_at: str

    class Config:
        from_attributes = True


class EligibilityHistoryResponse(BaseModel):
    checks: list[EligibilityCheckResponse]
    total: int


# ── Helpers ───────────────────────────────────────────────────────────────────

def _check_to_response(check: EligibilityCheck, patient: Patient | None = None) -> EligibilityCheckResponse:
    patient_name = None
    if patient:
        patient_name = f"{patient.first_name} {patient.last_name}".strip()
    elif check.patient:
        patient_name = f"{check.patient.first_name} {check.patient.last_name}".strip()

    return EligibilityCheckResponse(
        id=check.id,
        patient_id=check.patient_id,
        patient_name=patient_name,
        payer_name=check.payer_name,
        payer_id=str(check.payer_id) if check.payer_id is not None else None,
        member_id=check.member_id,
        status=check.status or "unknown",
        response_parsed=check.response_parsed,
        checked_at=check.checked_at.isoformat() if check.checked_at else "",
    )


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/check", response_model=EligibilityCheckResponse, summary="Check patient eligibility via Inmediata SecureTrack")
async def check_eligibility(
    req: EligibilityCheckRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Send a real-time X12 270 eligibility inquiry to Inmediata SecureTrack
    and return the parsed 271 response.

    The result is stored in eligibility_checks for history tracking.
    """
    # ── 1. Load patient ───────────────────────────────────────────────────────
    patient_result = await db.execute(
        select(Patient)
        .options(selectinload(Patient.insurances).selectinload(PatientInsurance.payer))
        .where(Patient.id == req.patient_id)
    )
    patient = patient_result.scalar_one_or_none()
    if not patient:
        raise HTTPException(404, f"Patient {req.patient_id} not found")

    # ── 2. Resolve insurance ──────────────────────────────────────────────────
    insurance: PatientInsurance | None = None
    if req.insurance_id:
        insurance = next((i for i in patient.insurances if i.id == req.insurance_id), None)
        if not insurance:
            raise HTTPException(404, f"Insurance {req.insurance_id} not found for patient {req.patient_id}")
    else:
        # Use primary insurance
        insurance = next((i for i in patient.insurances if i.is_primary), None)
        if not insurance and patient.insurances:
            insurance = patient.insurances[0]

    if not insurance:
        raise HTTPException(400, f"Patient {req.patient_id} has no insurance on file")

    payer: Payer = insurance.payer
    payer_edi_id = req.payer_id_override or payer.inmediata_payer_id or payer.payer_id
    if not payer_edi_id:
        raise HTTPException(400, f"Payer '{payer.name}' has no EDI payer ID configured")

    # ── 3. Build 270 ──────────────────────────────────────────────────────────
    from routers.inmediata import _runtime_config
    submitter_id = _runtime_config.get("submitter_id") or settings.INMEDIATA_SUBMITTER_ID or settings.STEDI_ISA_SENDER_ID or "ANCLMS"

    # Get provider NPI (use first active provider)
    from models import Provider as ProviderModel
    provider_res = await db.execute(select(ProviderModel).where(ProviderModel.is_active == True).limit(1))
    provider = provider_res.scalar_one_or_none()

    try:
        x12_270 = generate_270(
            submitter_id=submitter_id,
            subscriber_last=insurance.subscriber_name.split()[-1] if insurance.subscriber_name else patient.last_name,
            subscriber_first=insurance.subscriber_name.split()[0] if insurance.subscriber_name else patient.first_name,
            subscriber_dob=insurance.subscriber_dob or patient.dob,
            subscriber_gender=patient.gender.value if patient.gender else "",
            member_id=insurance.member_id,
            group_number=insurance.group_number or "",
            payer_id=payer_edi_id,
            payer_name=payer.name,
            provider_npi=provider.npi if provider else "",
            provider_last_name=provider.last_name if provider else "",
            provider_first_name=provider.first_name if provider else "",
            service_type_codes=req.service_type_codes,
            inquiry_date=req.as_of_date or date.today(),
        )
    except Exception as exc:
        logger.exception("Failed to generate 270 for patient %d", req.patient_id)
        raise HTTPException(500, f"Failed to generate 270 EDI: {exc}")

    # ── 4. Call Inmediata SecureTrack ─────────────────────────────────────────
    client = SecureTrackClient()
    if not client.username:
        raise HTTPException(503, "INMEDIATA_WS_USERNAME not configured. Set it in .env to use eligibility.")

    try:
        rt_result = await client.send_realtime(x12_270)
    except Exception as exc:
        logger.exception("SecureTrack SendRealTime failed for patient %d", req.patient_id)
        raise HTTPException(502, f"Inmediata SecureTrack error: {exc}")

    # ── 5. Parse 271 response ─────────────────────────────────────────────────
    parsed: dict[str, Any] = {}
    status = "error"

    if rt_result.success and rt_result.response:
        try:
            parsed = parse_271_summary(rt_result.response)
            status = parsed.get("status", "unknown")
        except Exception as exc:
            logger.warning("271 parse error for patient %d: %s", req.patient_id, exc)
            parsed = {"parse_error": str(exc)}
            status = "unknown"
    else:
        error_msg = rt_result.message or "No response from Inmediata"
        parsed = {"error": error_msg}
        status = "error"

    # ── 6. Store result ───────────────────────────────────────────────────────
    check = EligibilityCheck(
        patient_id=req.patient_id,
        payer_name=payer.name,
        payer_id=payer.id,  # FK to payers table
        member_id=insurance.member_id or "",
        status=status,
        response_raw=rt_result.response,
        response_parsed=parsed,
        checked_by=current_user.id,
    )
    db.add(check)
    await db.commit()
    await db.refresh(check)

    return _check_to_response(check, patient)


@router.get(
    "/history/{patient_id}",
    response_model=EligibilityHistoryResponse,
    summary="Get eligibility check history for a patient",
)
async def get_eligibility_history(
    patient_id: int,
    limit: int = 20,
    offset: int = 0,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Returns past eligibility checks for the given patient, newest first."""
    # Verify patient exists
    patient_result = await db.execute(select(Patient).where(Patient.id == patient_id))
    patient = patient_result.scalar_one_or_none()
    if not patient:
        raise HTTPException(404, f"Patient {patient_id} not found")

    result = await db.execute(
        select(EligibilityCheck)
        .where(EligibilityCheck.patient_id == patient_id)
        .order_by(desc(EligibilityCheck.checked_at))
        .offset(offset)
        .limit(limit)
    )
    checks = result.scalars().all()

    total_result = await db.execute(
        select(EligibilityCheck).where(EligibilityCheck.patient_id == patient_id)
    )
    total = len(total_result.scalars().all())

    return EligibilityHistoryResponse(
        checks=[_check_to_response(c, patient) for c in checks],
        total=total,
    )


@router.get(
    "/{check_id}",
    response_model=EligibilityCheckResponse,
    summary="Get a single eligibility check result",
)
async def get_eligibility_check(
    check_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(EligibilityCheck)
        .options(selectinload(EligibilityCheck.patient))
        .where(EligibilityCheck.id == check_id)
    )
    check = result.scalar_one_or_none()
    if not check:
        raise HTTPException(404, f"Eligibility check {check_id} not found")
    return _check_to_response(check)
