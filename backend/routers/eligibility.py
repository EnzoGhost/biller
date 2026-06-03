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

class DirectEligibilityRequest(BaseModel):
    """All data inline — used by AngelWink desktop app (no DB lookups)."""
    # Provider info
    provider_npi: str
    provider_first_name: str = ""
    provider_last_name: str = ""
    provider_taxonomy: str = "152W00000X"
    provider_tax_id: str = ""
    # Inmediata creds
    inmediata_username: str
    inmediata_password: str
    inmediata_env: str = "prod"   # "prod" or "prod"
    # Subscriber / patient
    subscriber_first_name: str
    subscriber_last_name: str
    subscriber_dob: str           # YYYY-MM-DD
    subscriber_gender: str = ""   # M or F
    member_id: str
    group_number: str = ""
    # Payer
    payer_name: str
    payer_id: str                 # EDI payer ID
    # Service
    service_type_codes: list[str] = ["AL"]
    # Optional custom endpoint URL (overrides env default)
    inmediata_url: Optional[str] = None


class EligibilityCheckRequest(BaseModel):
    patient_id: int
    insurance_id: Optional[int] = None          # PatientInsurance.id — use primary if omitted
    payer_id_override: Optional[str] = None     # override payer EDI ID
    service_type_codes: list[str] = ["AL", "BV"]  # AL=Other/General, BV=Optometry/Vision (match AngelWink)
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
    response_raw: Optional[str] = None
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
        response_raw=check.response_raw if hasattr(check, 'response_raw') else None,
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
    ws_env = _runtime_config.get("ws_env", "prod")

    # Get provider NPI (use first active provider)
    from models import Provider as ProviderModel
    provider_res = await db.execute(select(ProviderModel).where(ProviderModel.is_active == True).limit(1))
    provider = provider_res.scalar_one_or_none()

    # Parse subscriber name — handle "LAST, FIRST" and "FIRST LAST" formats
    sub_first = patient.first_name or ""
    sub_last = patient.last_name or ""
    if insurance.subscriber_name:
        sn = insurance.subscriber_name.strip()
        if "," in sn:
            # "RIVERA ROSARIO, DENISE" → last="RIVERA ROSARIO", first="DENISE"
            parts = sn.split(",", 1)
            sub_last = parts[0].strip()
            sub_first = parts[1].strip()
        else:
            # "DENISE RIVERA ROSARIO" → first=DENISE, last=RIVERA ROSARIO
            parts = sn.strip().split()
            if len(parts) >= 2:
                sub_first = parts[0]
                sub_last = " ".join(parts[1:])
            elif len(parts) == 1:
                sub_first = parts[0]

    try:
        x12_270 = generate_270(
            submitter_id=submitter_id,
            subscriber_last=sub_last,
            subscriber_first=sub_first,
            subscriber_dob=insurance.subscriber_dob or patient.dob,
            subscriber_gender=patient.gender.value if patient.gender else "",
            member_id=insurance.member_id.replace('-', '') if insurance.member_id else "",
            group_number=insurance.group_number or "",
            payer_id=payer_edi_id,
            payer_name=payer.name,
            provider_npi=provider.npi if provider else "",
            provider_last_name=provider.last_name if provider else "",
            provider_first_name=provider.first_name if provider else "",
            provider_taxonomy=provider.taxonomy_code if provider else "",
            provider_tax_id=provider.ein if provider and provider.ein else "",
            service_type_codes=req.service_type_codes,
            inquiry_date=req.as_of_date or date.today(),
            environment=ws_env,
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

    # Parse 271 response even when error_count > 0 — Inmediata returns valid
    # 271 with AAA rejection codes alongside error_count=1 / message="Unable to Process"
    if rt_result.response:
        try:
            parsed = parse_271_summary(rt_result.response)
            status = parsed.get("status", "unknown")
            # If our parser found errors (AAA codes), include Inmediata's message for context
            if not rt_result.success and rt_result.message and status == "error":
                parsed.setdefault("inmediata_message", rt_result.message)
        except Exception as exc:
            logger.warning("271 parse error for patient %d: %s", req.patient_id, exc)
            parsed = {"parse_error": str(exc)}
            if rt_result.message:
                parsed["inmediata_message"] = rt_result.message
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


@router.post(
    "/check-direct",
    summary="Direct eligibility check — all data inline, no DB lookups",
)
async def check_eligibility_direct(req: DirectEligibilityRequest):
    """
    Real-time X12 270/271 eligibility check using credentials and patient data
    provided inline in the request body.

    Used by the AngelWink desktop app which has its own local SQLite database.
    No auth required — the Inmediata credentials are supplied in the request.
    """
    from datetime import date as _date
    import re

    # ── 1. Build 270 ──────────────────────────────────────────────────────────
    # Parse DOB
    try:
        dob = _date.fromisoformat(req.subscriber_dob) if req.subscriber_dob else None
    except ValueError:
        dob = None

    # submitter_id = the Inmediata username (matches what Inmediata expects)
    submitter_id = req.inmediata_username

    logger.info(
        "[check-direct] payer=%s payer_id=%s member=%s first=%s last=%s dob=%s gender=%s group=%s",
        req.payer_name, req.payer_id, req.member_id,
        req.subscriber_first_name, req.subscriber_last_name,
        req.subscriber_dob, req.subscriber_gender, req.group_number,
    )

    try:
        x12_270 = generate_270(
            submitter_id=submitter_id,
            subscriber_last=req.subscriber_last_name,
            subscriber_first=req.subscriber_first_name,
            subscriber_dob=dob,
            subscriber_gender=req.subscriber_gender,
            member_id=req.member_id,
            group_number=req.group_number,
            payer_id=req.payer_id,
            payer_name=req.payer_name,
            provider_npi=req.provider_npi,
            provider_last_name=req.provider_last_name,
            provider_first_name=req.provider_first_name,
            provider_taxonomy=req.provider_taxonomy,
            provider_tax_id=req.provider_tax_id,
            service_type_codes=req.service_type_codes,
            inquiry_date=_date.today(),
            environment=req.inmediata_env or "prod",
        )
    except Exception as exc:
        logger.exception("check-direct: failed to generate 270")
        raise HTTPException(status_code=500, detail=f"Failed to generate 270 EDI: {exc}")

    # ── 2. Build SecureTrack client with inline creds ─────────────────────────
    # Use the same env for both generate_270 and SecureTrackClient (default "prod" when not specified)
    env = req.inmediata_env.lower() if req.inmediata_env else "prod"
    client = SecureTrackClient(
        username=req.inmediata_username,
        password=req.inmediata_password,
        env=env,
        endpoint_url=req.inmediata_url or None,
    )

    # ── 3. Send 270 ───────────────────────────────────────────────────────────
    try:
        rt_result = await client.send_realtime(x12_270)
    except Exception as exc:
        logger.exception("check-direct: SecureTrack SendRealTime failed")
        raise HTTPException(status_code=502, detail=f"Inmediata SecureTrack error: {exc}")

    # ── 4. Parse 271 ──────────────────────────────────────────────────────────
    parsed: dict[str, Any] = {}
    status = "error"

    # Parse 271 even when error_count > 0 (Inmediata returns valid 271 with AAA codes)
    if rt_result.response:
        try:
            parsed = parse_271_summary(rt_result.response)
            status = parsed.get("status", "unknown")
            if not rt_result.success and rt_result.message and status == "error":
                parsed.setdefault("inmediata_message", rt_result.message)
        except Exception as exc:
            logger.warning("check-direct: 271 parse error: %s", exc)
            parsed = {"parse_error": str(exc), "raw_response": rt_result.response}
            if rt_result.message:
                parsed["inmediata_message"] = rt_result.message
            status = "unknown"
    else:
        error_msg = rt_result.message or "No response from Inmediata"
        parsed = {"error": error_msg}
        status = "error"

    # ── 5. Return structured result ───────────────────────────────────────────
    return {
        "status": status,
        "plan_name": parsed.get("plan_name"),
        # New field names from parse_271_summary
        "effective_date": parsed.get("effective_date"),
        "term_date": parsed.get("term_date"),
        "member_id": parsed.get("member_id"),
        "subscriber_name": parsed.get("subscriber_name"),
        "subscriber_id": parsed.get("subscriber_id"),
        "payer_name": parsed.get("payer_name"),
        "copay": parsed.get("copay", []),
        "deductible": parsed.get("deductible", []),
        "coinsurance": parsed.get("coinsurance", []),
        "out_of_pocket": parsed.get("out_of_pocket", []),
        "covered_services": parsed.get("covered_services", []),
        "non_covered": parsed.get("non_covered", []),
        # Legacy field names (backward compat for old frontends)
        "plan_begin_date": parsed.get("effective_date"),
        "plan_end_date": parsed.get("term_date"),
        "copays": parsed.get("copay", []),
        "deductibles": parsed.get("deductible", []),
        "benefits": parsed.get("benefits", []),
        "group_name": parsed.get("group_name"),
        "group_number": parsed.get("group_number"),
        # Errors
        "error": parsed.get("error") or ('; '.join(parsed.get("errors", [])) if parsed.get("errors") else None),
        "errors": parsed.get("errors", []),
        "raw": parsed,
    }


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
