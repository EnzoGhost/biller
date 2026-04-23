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


STEDI_PAYERS_BASE = "https://healthcare.us.stedi.com/2024-04-01"

# Known PR payer stediIds for filtering (populated from API discovery)
PR_PAYER_STEDI_IDS = {
    "VMJBW",  # Triple-S Salud (Commercial and Medicaid)
    "FMGTK",  # Triple-S Salud (Medicare Advantage)
    "OLFKO",  # MCS
    "FMKIY",  # First Medical Health Plan
    "HMWME",  # First Medical Puerto Rico Government Health Plan (VITAL)
    "GZMSV",  # Humana Puerto Rico
    "KXVQE",  # Medicare Puerto Rico Part B
    "WGJSF",  # Medicare Puerto Rico Part A
    "QBHCS",  # FHC of Puerto Rico
    "WSXQY",  # Envolve Vision of Puerto Rico
    "OKALU",  # APS Healthcare Puerto Rico Inc
    "TQMVS",  # Delta Dental of Puerto Rico
    "BHGVK",  # Asociacion de Maestros Puerto Rico
    "EYDBY",  # Therapy Network of Puerto Rico
    "DCURP",  # MMM
    "BSURE",  # MMM Healthcare
    "QPDZX",  # MMM Multi Health
}


def stedi_headers() -> dict:
    return {
        "Authorization": f"Key {settings.STEDI_API_KEY}",
        "Content-Type": "application/json",
    }


# ── Payer Directory ───────────────────────────────────────────────────────────

@router.get("/payers")
async def list_stedi_payers(
    query: str = "",
    eligibility_only: bool = False,
    _: User = Depends(get_current_user),
):
    """
    Fetch payer list from Stedi. Optionally filter by name query or
    eligibility support. Proxies Stedi's payer directory.
    """
    async with httpx.AsyncClient(timeout=30.0) as client:
        if query:
            resp = await client.get(
                f"{STEDI_PAYERS_BASE}/payers/search",
                headers=stedi_headers(),
                params={"query": query, "pageSize": 50},
            )
        else:
            resp = await client.get(
                f"{STEDI_PAYERS_BASE}/payers",
                headers=stedi_headers(),
                params={"pageSize": 100},
            )

    if resp.status_code != 200:
        raise HTTPException(502, f"Error de Stedi: {resp.text}")

    raw = resp.json()
    # Search endpoint wraps each result in {"payer": {...}}, list endpoint does not
    items = raw.get("items", [])
    payers = [item.get("payer", item) for item in items]

    if eligibility_only:
        payers = [
            p for p in payers
            if p.get("transactionSupport", {}).get("eligibilityCheck") == "SUPPORTED"
        ]

    return {"items": payers, "total": len(payers)}


@router.get("/payers/pr")
async def list_pr_payers(
    _: User = Depends(get_current_user),
):
    """
    Returns Puerto Rico payers available in Stedi's network.
    Combines operatingStates=PR filter with known PR-specific payer IDs.
    """
    pr_payers = []
    seen_ids: set = set()

    # Search terms that surface PR payers
    pr_queries = ["Triple-S", "MCS Puerto Rico", "First Medical", "MMM", "Humana Puerto Rico", "Puerto Rico"]

    async with httpx.AsyncClient(timeout=30.0) as client:
        for q in pr_queries:
            try:
                resp = await client.get(
                    f"{STEDI_PAYERS_BASE}/payers/search",
                    headers=stedi_headers(),
                    params={"query": q, "pageSize": 25},
                )
                if resp.status_code != 200:
                    continue
                items = resp.json().get("items", [])
                for item in items:
                    p = item.get("payer", item)
                    stedi_id = p.get("stediId")
                    if not stedi_id or stedi_id in seen_ids:
                        continue
                    states = p.get("operatingStates", [])
                    # Include if operating in PR or in our known PR payer set
                    if "PR" in states or stedi_id in PR_PAYER_STEDI_IDS:
                        seen_ids.add(stedi_id)
                        pr_payers.append(p)
            except Exception:
                continue

    # Sort: eligibility-supported first, then by name
    def sort_key(p):
        elig = p.get("transactionSupport", {}).get("eligibilityCheck", "")
        return (0 if elig == "SUPPORTED" else 1, p.get("displayName", ""))

    pr_payers.sort(key=sort_key)
    return {"items": pr_payers, "total": len(pr_payers)}


# ── Eligibility ───────────────────────────────────────────────────────────────

@router.post("/eligibility", response_model=EligibilityResponse)
async def check_eligibility(
    body: EligibilityRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """
    Real-time eligibility check via Stedi 270/271.
    Looks up the payer in the DB to get the Stedi trading partner ID,
    then calls Stedi's eligibility API.
    """
    # Resolve the trading partner ID from the DB payer
    from models import Payer as PayerModel
    payer_result = await db.execute(select(PayerModel).where(PayerModel.id == body.payer_id))
    db_payer = payer_result.scalar_one_or_none()

    # Use stedi_payer_id if set, otherwise fall back to payer_id string
    trading_partner_id = (
        (db_payer.stedi_payer_id or db_payer.payer_id)
        if db_payer
        else str(body.payer_id)
    )
    payer_display_name = db_payer.name if db_payer else ""

    if not settings.STEDI_API_KEY:
        # Return mock response in dev mode
        return EligibilityResponse(
            is_eligible=True,
            payer_name=payer_display_name or "Triple-S Salud (DEMO)",
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

    import uuid
    control_number = str(uuid.uuid4().int)[:9].zfill(9)

    payload = {
        "controlNumber": control_number,
        "tradingPartnerServiceId": trading_partner_id,
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
            f"{STEDI_BASE}/change-healthcare/eligibility/v2",
            headers=stedi_headers(),
            json=payload,
        )

    if resp.status_code not in (200, 201):
        # Stedi returns structured error objects — surface them helpfully
        try:
            err = resp.json()
            detail = err.get("message") or err.get("error") or resp.text
        except Exception:
            detail = resp.text
        raise HTTPException(502, f"Error de Stedi: {detail}")

    data = resp.json()

    # Parse 271 response — benefitsInformation has typed benefit entries
    benefits = data.get("benefitsInformation", [])

    def find_benefit_amount(code: str) -> float | None:
        """Find benefit amount by service type code."""
        for b in benefits:
            if b.get("code") == code:
                amt = b.get("benefitAmount")
                if amt is not None:
                    try:
                        return float(amt)
                    except (ValueError, TypeError):
                        pass
        return None

    # Plan status codes: 1=Active, 6=Inactive
    plan_statuses = data.get("planStatus", [])
    is_active = any(s.get("statusCode") == "1" for s in plan_statuses) if plan_statuses else False

    # Coverage dates from planStatus
    coverage_start = None
    coverage_end = None
    for ps in plan_statuses:
        dates = ps.get("planDetails", {})
        if dates.get("policyEffectiveDate"):
            try:
                from datetime import datetime
                coverage_start = datetime.strptime(dates["policyEffectiveDate"], "%Y%m%d").date()
            except (ValueError, KeyError):
                pass
        if dates.get("policyExpirationDate"):
            try:
                from datetime import datetime
                coverage_end = datetime.strptime(dates["policyExpirationDate"], "%Y%m%d").date()
            except (ValueError, KeyError):
                pass

    return EligibilityResponse(
        is_eligible=is_active,
        payer_name=data.get("payer", {}).get("name", "") or payer_display_name,
        member_id=body.member_id,
        coverage_start=coverage_start,
        coverage_end=coverage_end,
        copay=find_benefit_amount("B"),        # B = Co-Payment
        deductible=find_benefit_amount("C"),   # C = Deductible
        deductible_met=find_benefit_amount("CB"),
        out_of_pocket_max=find_benefit_amount("G"),  # G = Out of Pocket (Stop Loss)
        out_of_pocket_met=find_benefit_amount("GB"),
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
