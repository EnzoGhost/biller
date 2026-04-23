"""
Stedi clearinghouse integration.
Handles: claim submission, eligibility checks, claim status queries.
Docs: https://www.stedi.com/app/edi-platform/
"""
import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from config import settings
from database import get_db
from models import Claim, ClaimStatus
from schemas import EligibilityRequest, EligibilityResponse
from auth import get_current_user
from models import User

router = APIRouter(prefix="/stedi", tags=["stedi"])

STEDI_BASE = "https://healthcare.us.stedi.com/2024-04-01"


def stedi_headers():
    return {
        "Authorization": f"Key {settings.STEDI_API_KEY}",
        "Content-Type": "application/json",
    }


# ── Eligibility ───────────────────────────────────────────────────────────────

@router.post("/eligibility", response_model=EligibilityResponse)
async def check_eligibility(
    body: EligibilityRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """
    Real-time eligibility check via Stedi 270/271.
    Returns coverage info for the patient/payer combination.
    """
    if not settings.STEDI_API_KEY:
        # Return mock response in dev mode
        return EligibilityResponse(
            is_eligible=True,
            payer_name="Triple-S Salud (DEMO)",
            member_id=body.member_id,
            coverage_start=body.service_date,
            coverage_end=None,
            copay=20.0,
            deductible=500.0,
            deductible_met=120.0,
            out_of_pocket_max=3000.0,
            out_of_pocket_met=250.0,
            raw_response={"demo": True},
        )

    payload = {
        "controlNumber": "123456789",
        "tradingPartnerServiceId": body.payer_id,
        "provider": {
            "organizationName": "Biller Clinic",
            "npi": "1234567890",
        },
        "subscriber": {
            "memberId": body.member_id,
            "firstName": body.patient_first_name,
            "lastName": body.patient_last_name,
            "dateOfBirth": body.patient_dob.strftime("%Y%m%d"),
        },
        "encounter": {
            "serviceTypeCodes": [body.service_type_code],
        },
    }

    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            f"{STEDI_BASE}/eligibility",
            headers=stedi_headers(),
            json=payload,
        )
        if resp.status_code != 200:
            raise HTTPException(502, f"Error de Stedi: {resp.text}")
        data = resp.json()

    # Parse 271 response
    benefits = data.get("benefitsInformation", [])
    copay = next((b.get("benefitAmount") for b in benefits if b.get("code") == "B"), None)
    deductible = next((b.get("benefitAmount") for b in benefits if b.get("code") == "C"), None)

    return EligibilityResponse(
        is_eligible=data.get("planStatus", [{}])[0].get("statusCode") == "1",
        payer_name=data.get("payer", {}).get("name", ""),
        member_id=body.member_id,
        coverage_start=None,
        coverage_end=None,
        copay=float(copay) if copay else None,
        deductible=float(deductible) if deductible else None,
        deductible_met=None,
        out_of_pocket_max=None,
        out_of_pocket_met=None,
        raw_response=data,
    )


# ── Claim Submission ──────────────────────────────────────────────────────────

@router.post("/submit/{claim_id}")
async def submit_claim_to_stedi(
    claim_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Submit a claim to Stedi for electronic processing (837P)."""
    from sqlalchemy.orm import selectinload
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
        raise HTTPException(404, "Reclamación no encontrada")

    if not settings.STEDI_API_KEY:
        # Simulate submission in dev
        claim.stedi_transaction_id = f"STEDI-DEV-{claim_id:08d}"
        claim.status = ClaimStatus.SUBMITTED
        from datetime import datetime
        claim.date_of_submission = datetime.utcnow()
        await db.commit()
        return {"status": "submitted", "transaction_id": claim.stedi_transaction_id, "demo": True}

    # Build 837P payload
    service_lines = [
        {
            "serviceDate": sl.service_date.strftime("%Y%m%d") if sl.service_date else claim.service_date_from.strftime("%Y%m%d"),
            "professionalService": {
                "procedureCode": sl.cpt_code,
                "procedureModifiers": sl.modifiers,
                "diagnosisCodePointers": sl.diagnosis_pointers,
                "lineItemChargeAmount": str(sl.billed_amount),
                "serviceUnitCount": str(sl.units),
                "placeOfServiceCode": sl.place_of_service,
            },
        }
        for sl in claim.service_lines
    ]

    payload = {
        "controlNumber": str(claim_id).zfill(9),
        "tradingPartnerServiceId": claim.payer.stedi_payer_id or claim.payer.payer_id,
        "submitter": {
            "organizationName": "Medical Biller PR",
            "contactInformation": {"name": "Billing Dept", "phoneNumber": "7875550100"},
        },
        "receiver": {"organizationName": claim.payer.name},
        "subscriber": {
            "memberId": "",  # pulled from patient insurance
            "firstName": claim.patient.first_name,
            "lastName": claim.patient.last_name,
            "gender": claim.patient.gender,
            "dateOfBirth": claim.patient.dob.strftime("%Y%m%d"),
            "address": {
                "address1": claim.patient.address_line1 or "",
                "city": claim.patient.city or "San Juan",
                "state": "PR",
                "postalCode": claim.patient.zip_code or "00901",
            },
        },
        "billing": {
            "npi": claim.provider.npi,
            "firstName": claim.provider.first_name,
            "lastName": claim.provider.last_name,
            "taxId": claim.provider.ein or "",
            "address": {
                "address1": claim.provider.address_line1 or "",
                "city": claim.provider.city or "San Juan",
                "state": "PR",
                "postalCode": claim.provider.zip_code or "00901",
            },
        },
        "claimInformation": {
            "claimFilingCode": "CI",
            "patientControlNumber": claim.claim_number,
            "claimChargeAmount": str(claim.total_billed),
            "placeOfServiceCode": claim.place_of_service,
            "claimFrequencyCode": "1",
            "signatureIndicator": "Y",
            "planParticipationCode": "A",
            "benefitsAssignmentCertificationIndicator": "Y",
            "releaseInformationCode": "Y",
            "diagnosisCodes": claim.diagnosis_codes,
            "serviceLines": service_lines,
        },
    }

    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            f"{STEDI_BASE}/professional/claims",
            headers=stedi_headers(),
            json=payload,
        )
        if resp.status_code not in (200, 201):
            raise HTTPException(502, f"Error de Stedi: {resp.text}")
        data = resp.json()

    claim.stedi_transaction_id = data.get("transactionSetControlNumber", "")
    claim.status = ClaimStatus.SUBMITTED
    from datetime import datetime
    claim.date_of_submission = datetime.utcnow()
    await db.commit()
    return {"status": "submitted", "transaction_id": claim.stedi_transaction_id}


# ── Claim Status ──────────────────────────────────────────────────────────────

@router.get("/status/{claim_id}")
async def get_claim_status(
    claim_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Query Stedi for current claim status (276/277)."""
    result = await db.execute(select(Claim).where(Claim.id == claim_id))
    claim = result.scalar_one_or_none()
    if not claim:
        raise HTTPException(404, "Reclamación no encontrada")
    if not claim.stedi_transaction_id:
        raise HTTPException(400, "Esta reclamación no tiene ID de transacción de Stedi")

    if not settings.STEDI_API_KEY:
        return {"status": claim.status, "demo": True}

    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.get(
            f"{STEDI_BASE}/professional/claims/{claim.stedi_transaction_id}/status",
            headers=stedi_headers(),
        )
        if resp.status_code != 200:
            raise HTTPException(502, f"Error de Stedi: {resp.text}")
        return resp.json()


# ── Webhook (async status updates from Stedi) ─────────────────────────────────

@router.post("/webhook")
async def stedi_webhook(request: Request, db: AsyncSession = Depends(get_db)):
    """
    Receive async claim status updates from Stedi.
    Stedi posts events here when claim status changes (accepted, rejected, etc.)
    Configure in Stedi dashboard: Settings → Webhooks
    """
    body = await request.json()

    transaction_id = body.get("transactionSetControlNumber") or body.get("controlNumber")
    new_status = body.get("status", "").lower()

    if transaction_id:
        result = await db.execute(
            select(Claim).where(Claim.stedi_transaction_id == transaction_id)
        )
        claim = result.scalar_one_or_none()
        if claim:
            status_map = {
                "accepted": ClaimStatus.ACCEPTED,
                "rejected": ClaimStatus.REJECTED,
                "paid": ClaimStatus.PAID,
                "denied": ClaimStatus.DENIED,
            }
            if new_status in status_map:
                claim.status = status_map[new_status]
                await db.commit()

    return {"received": True}
