"""
Availity clearinghouse integration for Envolve Vision claims.
Envolve Vision (MMM/Humana PR vision benefits) uses Availity as their clearinghouse.
Payer ID: 56190

Availity uses OAuth2 client_credentials for auth, then standard REST endpoints
for 837P claim submission, 276/277 claim status, and 270/271 eligibility.

Docs: https://developer.availity.com/
"""
import httpx
from datetime import date, datetime
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from pydantic import BaseModel

from config import settings
from database import get_db
from models import Claim, ClaimStatus, EligibilityCheck, User
from auth import get_current_user
from routers.audit import log_action

router = APIRouter(prefix="/availity", tags=["availity"])

AVAILITY_BASE = settings.AVAILITY_BASE_URL
ENVOLVE_PAYER_ID = "56190"


# ── Pydantic schemas ──────────────────────────────────────────────────────────

class EnvolveEligibilityRequest(BaseModel):
    member_id: str
    patient_first_name: str
    patient_last_name: str
    patient_dob: date
    payer_id: Optional[int] = None  # DB payer ID (optional)
    service_type_code: str = "30"   # 30 = Vision


class AvailityClaimSubmitResponse(BaseModel):
    status: str
    availity_transaction_id: Optional[str] = None
    message: Optional[str] = None
    demo: bool = False


class AvailityStatusResponse(BaseModel):
    claim_id: int
    status: str
    availity_status: Optional[str] = None
    availity_transaction_id: Optional[str] = None
    message: Optional[str] = None
    demo: bool = False


# ── OAuth2 token helper ───────────────────────────────────────────────────────

async def _get_availity_token() -> str:
    """
    Obtain OAuth2 bearer token from Availity.
    Uses client_credentials grant with AVAILITY_CLIENT_ID and AVAILITY_CLIENT_SECRET.
    """
    if not settings.AVAILITY_CLIENT_ID or not settings.AVAILITY_CLIENT_SECRET:
        raise HTTPException(
            400,
            "Availity credentials not configured. Set AVAILITY_CLIENT_ID and "
            "AVAILITY_CLIENT_SECRET in .env to enable Envolve submission."
        )

    token_url = f"{AVAILITY_BASE}/availity/v1/token"
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.post(
            token_url,
            data={
                "grant_type": "client_credentials",
                "client_id": settings.AVAILITY_CLIENT_ID,
                "client_secret": settings.AVAILITY_CLIENT_SECRET,
                "scope": "hipaa",
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        if resp.status_code != 200:
            raise HTTPException(502, f"Availity auth error: {resp.text}")
        return resp.json()["access_token"]


# ── Submit claim to Availity (Envolve/56190) ─────────────────────────────────

@router.post("/submit/{claim_id}", response_model=AvailityClaimSubmitResponse)
async def submit_claim_to_availity(
    claim_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Submit a claim to Availity for Envolve Vision processing.
    Builds an X12 837P-compatible payload and posts via Availity REST API.
    """
    result = await db.execute(
        select(Claim)
        .options(
            selectinload(Claim.patient),
            selectinload(Claim.provider),
            selectinload(Claim.payer),
            selectinload(Claim.service_lines),
        )
        .where(Claim.id == claim_id)
    )
    claim = result.scalar_one_or_none()
    if not claim:
        raise HTTPException(404, "Claim not found")

    if claim.status not in (ClaimStatus.DRAFT, ClaimStatus.READY):
        raise HTTPException(400, f"Cannot submit claim in status '{claim.status}'")

    # ── Demo/dev mode ──────────────────────────────────────────────────────
    if not settings.AVAILITY_CLIENT_ID:
        transaction_id = f"AVAILITY-DEV-{claim_id:08d}"
        old_status = claim.status
        claim.status = ClaimStatus.SUBMITTED
        claim.date_of_submission = datetime.utcnow()
        claim.clearinghouse_ref = transaction_id
        await log_action(
            db, "claim", claim_id, "submitted_availity",
            claim_id=claim_id,
            old_value=str(old_status),
            new_value=f"submitted (demo) tx={transaction_id}",
            user=current_user,
        )
        await db.commit()
        return AvailityClaimSubmitResponse(
            status="submitted",
            availity_transaction_id=transaction_id,
            message="Demo mode — claim marked submitted (no real transmission)",
            demo=True,
        )

    # ── Build payload ──────────────────────────────────────────────────────
    service_lines = []
    for sl in claim.service_lines:
        svc_date = (sl.service_date or claim.service_date_from).strftime("%Y%m%d")
        service_lines.append({
            "serviceDate": svc_date,
            "procedureCode": sl.cpt_code,
            "procedureModifiers": sl.modifiers or [],
            "diagnosisCodePointers": sl.diagnosis_pointers or [1],
            "lineItemChargeAmount": str(sl.billed_amount),
            "serviceUnitCount": str(sl.units),
            "placeOfServiceCode": sl.place_of_service or "11",
        })

    payload = {
        "payerId": ENVOLVE_PAYER_ID,
        "controlNumber": str(claim_id).zfill(9),
        "submitter": {
            "organizationName": "Visual Zone Optical",
            "taxId": claim.provider.ein or "" if claim.provider else "",
            "npi": claim.provider.npi if claim.provider else "",
        },
        "subscriber": {
            "firstName": claim.patient.first_name if claim.patient else "",
            "lastName": claim.patient.last_name if claim.patient else "",
            "dateOfBirth": claim.patient.dob.strftime("%Y%m%d") if claim.patient else "",
            "memberId": "",  # populated from patient insurance
        },
        "claim": {
            "patientControlNumber": claim.claim_number,
            "totalClaimChargeAmount": str(claim.total_billed),
            "placeOfServiceCode": claim.place_of_service or "11",
            "diagnosisCodes": claim.diagnosis_codes or [],
            "priorAuthorizationNumber": claim.prior_auth_number or "",
            "serviceLines": service_lines,
        },
    }

    token = await _get_availity_token()
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }

    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            f"{AVAILITY_BASE}/availity/v1/claims",
            headers=headers,
            json=payload,
        )
        if resp.status_code not in (200, 201, 202):
            detail = resp.text
            try:
                detail = resp.json().get("message", detail)
            except Exception:
                pass
            raise HTTPException(502, f"Availity error: {detail}")
        data = resp.json()

    transaction_id = data.get("transactionId") or data.get("id") or ""
    old_status = claim.status
    claim.status = ClaimStatus.SUBMITTED
    claim.date_of_submission = datetime.utcnow()
    claim.clearinghouse_ref = transaction_id

    await log_action(
        db, "claim", claim_id, "submitted_availity",
        claim_id=claim_id,
        old_value=str(old_status),
        new_value=f"submitted tx={transaction_id}",
        user=current_user,
    )
    await db.commit()

    return AvailityClaimSubmitResponse(
        status="submitted",
        availity_transaction_id=transaction_id,
        message="Claim submitted to Availity for Envolve Vision processing",
        demo=False,
    )


# ── Get claim status from Availity ────────────────────────────────────────────

@router.get("/status/{claim_id}", response_model=AvailityStatusResponse)
async def get_availity_claim_status(
    claim_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """
    Check claim status with Availity (276/277 equivalent via REST).
    """
    result = await db.execute(select(Claim).where(Claim.id == claim_id))
    claim = result.scalar_one_or_none()
    if not claim:
        raise HTTPException(404, "Claim not found")

    if not claim.clearinghouse_ref:
        raise HTTPException(400, "This claim has no Availity transaction ID")

    if not settings.AVAILITY_CLIENT_ID:
        return AvailityStatusResponse(
            claim_id=claim_id,
            status=claim.status,
            availity_status="DEMO",
            availity_transaction_id=claim.clearinghouse_ref,
            demo=True,
        )

    token = await _get_availity_token()
    headers = {"Authorization": f"Bearer {token}"}

    async with httpx.AsyncClient(timeout=20.0) as client:
        resp = await client.get(
            f"{AVAILITY_BASE}/availity/v1/claims/{claim.clearinghouse_ref}",
            headers=headers,
        )
        if resp.status_code != 200:
            raise HTTPException(502, f"Availity status error: {resp.text}")
        data = resp.json()

    availity_status = data.get("status") or data.get("claimStatus") or "UNKNOWN"

    # Map Availity status codes to internal status
    status_map = {
        "ACCEPTED": ClaimStatus.ACCEPTED,
        "REJECTED": ClaimStatus.REJECTED,
        "PAID": ClaimStatus.PAID,
        "DENIED": ClaimStatus.DENIED,
        "FINALIZED": ClaimStatus.PAID,
    }
    mapped = status_map.get(availity_status.upper())
    if mapped and claim.status != mapped:
        claim.status = mapped
        await db.commit()

    return AvailityStatusResponse(
        claim_id=claim_id,
        status=claim.status,
        availity_status=availity_status,
        availity_transaction_id=claim.clearinghouse_ref,
        demo=False,
    )


# ── Envolve Vision Eligibility ────────────────────────────────────────────────

@router.post("/eligibility")
async def check_envolve_eligibility(
    body: EnvolveEligibilityRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """
    Check Envolve Vision eligibility via Availity 270/271 REST.
    Returns vision benefit details: copay, frequency, covered services.
    """
    if not settings.AVAILITY_CLIENT_ID:
        # Demo response for dev mode
        result = {
            "is_eligible": True,
            "payer_name": "Envolve Vision (DEMO)",
            "member_id": body.member_id,
            "plan_type": "Vision",
            "copay_exam": 10.0,
            "copay_materials": 25.0,
            "frames_allowance": 150.0,
            "contacts_allowance": 130.0,
            "exam_frequency": "1 per year",
            "materials_frequency": "1 per year",
            "coverage_start": None,
            "coverage_end": None,
            "raw_response": {"demo": True},
        }

        # Store in DB
        check = EligibilityCheck(
            payer_id=body.payer_id,
            member_id=body.member_id,
            patient_first_name=body.patient_first_name,
            patient_last_name=body.patient_last_name,
            is_eligible=True,
            payer_name="Envolve Vision (DEMO)",
            raw_response=result,
        )
        db.add(check)
        await db.commit()
        return result

    token = await _get_availity_token()
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }

    payload = {
        "payerId": ENVOLVE_PAYER_ID,
        "serviceTypeCodes": [body.service_type_code],
        "subscriber": {
            "memberId": body.member_id,
            "firstName": body.patient_first_name,
            "lastName": body.patient_last_name,
            "dateOfBirth": body.patient_dob.strftime("%Y%m%d"),
        },
        "provider": {
            "npi": "",  # populated from clinic settings
            "organizationName": "Visual Zone Optical",
        },
    }

    async with httpx.AsyncClient(timeout=20.0) as client:
        resp = await client.post(
            f"{AVAILITY_BASE}/availity/v1/eligibility",
            headers=headers,
            json=payload,
        )
        if resp.status_code not in (200, 201):
            raise HTTPException(502, f"Availity eligibility error: {resp.text}")
        data = resp.json()

    # Parse response
    is_eligible = data.get("eligible", False)
    benefits = data.get("benefits", [])

    def find_benefit(name: str) -> Optional[float]:
        for b in benefits:
            if name.lower() in b.get("type", "").lower():
                try:
                    return float(b.get("amount", 0))
                except (TypeError, ValueError):
                    pass
        return None

    result = {
        "is_eligible": is_eligible,
        "payer_name": "Envolve Vision",
        "member_id": body.member_id,
        "plan_type": "Vision",
        "copay_exam": find_benefit("copay") or find_benefit("exam"),
        "copay_materials": find_benefit("materials"),
        "frames_allowance": find_benefit("frames"),
        "contacts_allowance": find_benefit("contact"),
        "coverage_start": data.get("coverageStartDate"),
        "coverage_end": data.get("coverageEndDate"),
        "raw_response": data,
    }

    check = EligibilityCheck(
        payer_id=body.payer_id,
        member_id=body.member_id,
        patient_first_name=body.patient_first_name,
        patient_last_name=body.patient_last_name,
        is_eligible=is_eligible,
        payer_name="Envolve Vision",
        raw_response=data,
    )
    db.add(check)
    await db.commit()

    return result
