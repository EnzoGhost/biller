import random
import string
from datetime import datetime, date
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, or_
from sqlalchemy.orm import selectinload

from database import get_db
from models import Claim, ServiceLine, ClaimStatus, Patient, PatientInsurance, Provider, Payer, Denial, AuditLog
from schemas import ClaimOut, ClaimCreate, ClaimUpdate, PaymentOut, PaymentCreate, ServiceLineCreate
from auth import get_current_user
from models import User, Payment
from routers.audit import log_action
from pydantic import BaseModel


class BulkDeleteRequest(BaseModel):
    claim_ids: List[int]

router = APIRouter(prefix="/claims", tags=["claims"])


# ── Push claim status back to Wink sync server ────────────────────────────────

async def push_claim_status_to_wink(claim_id: int, status: str, external_ref: str):
    """Push claim status back to Wink sync server so invoices show billing status."""
    import httpx
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                "http://159.65.235.231:3100/api/sync/claim-status",
                json={
                    "external_ref": external_ref,
                    "claim_status": status,
                    "claim_id": claim_id,
                }
            )
            if resp.status_code == 200:
                print(f"[claims] Pushed status '{status}' to Wink for {external_ref}")
            else:
                print(f"[claims] Wink status push returned {resp.status_code}: {resp.text}")
    except Exception as e:
        print(f"[claims] Failed to push status to Wink: {e}")


async def _maybe_push_wink_status(claim: 'Claim', new_status: str):
    """If claim is from Wink, push the new status."""
    if getattr(claim, 'source', None) == 'wink' and getattr(claim, 'external_ref', None):
        import asyncio
        asyncio.create_task(push_claim_status_to_wink(claim.id, new_status, claim.external_ref))


def generate_claim_number() -> str:
    ts = datetime.utcnow().strftime("%Y%m%d")
    suffix = "".join(random.choices(string.ascii_uppercase + string.digits, k=6))
    return f"CLM-{ts}-{suffix}"


def claim_with_relations():
    return [
        selectinload(Claim.patient).selectinload(Patient.insurances).selectinload(PatientInsurance.payer),
        selectinload(Claim.provider),
        selectinload(Claim.payer),
        selectinload(Claim.service_lines),
    ]


@router.get("", response_model=dict)
async def list_claims(
    page: int = Query(1, ge=1),
    per_page: int = Query(25, ge=1, le=100),
    status: Optional[ClaimStatus] = None,
    payer_id: Optional[int] = None,
    provider_id: Optional[int] = None,
    patient_id: Optional[int] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    search: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    q = select(Claim).options(*claim_with_relations())
    filters = []
    if status:
        filters.append(Claim.status == status)
    if payer_id:
        filters.append(Claim.payer_id == payer_id)
    if provider_id:
        filters.append(Claim.provider_id == provider_id)
    if patient_id:
        filters.append(Claim.patient_id == patient_id)
    if date_from:
        filters.append(Claim.service_date_from >= date_from)
    if date_to:
        filters.append(Claim.service_date_from <= date_to)
    if search:
        search_filter = or_(
            Claim.claim_number.ilike(f"%{search}%"),
            Claim.patient.has(Patient.first_name.ilike(f"%{search}%")),
            Claim.patient.has(Patient.last_name.ilike(f"%{search}%")),
            Claim.payer.has(Payer.name.ilike(f"%{search}%")),
        )
        filters.append(search_filter)
    if filters:
        q = q.where(and_(*filters))

    # Count
    count_q = select(func.count()).select_from(Claim)
    if filters:
        count_q = count_q.where(and_(*filters))
    total_res = await db.execute(count_q)
    total = total_res.scalar_one()

    q = q.order_by(Claim.created_at.desc()).offset((page - 1) * per_page).limit(per_page)
    result = await db.execute(q)
    claims = result.scalars().all()

    return {
        "items": [ClaimOut.model_validate(c) for c in claims],
        "total": total,
        "page": page,
        "per_page": per_page,
        "pages": max(1, (total + per_page - 1) // per_page),
    }


@router.post("", response_model=ClaimOut, status_code=201)
async def create_claim(
    body: ClaimCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    total_billed = sum(sl.billed_amount * sl.units for sl in body.service_lines)
    claim = Claim(
        claim_number=generate_claim_number(),
        patient_id=body.patient_id,
        provider_id=body.provider_id,
        payer_id=body.payer_id,
        service_date_from=body.service_date_from,
        service_date_to=body.service_date_to,
        place_of_service=body.place_of_service,
        diagnosis_codes=body.diagnosis_codes,
        prior_auth_number=body.prior_auth_number,
        referral_number=body.referral_number,
        total_billed=total_billed,
        notes=body.notes,
        status=ClaimStatus.DRAFT,
    )
    db.add(claim)
    await db.flush()

    for i, sl in enumerate(body.service_lines):
        line = ServiceLine(
            claim_id=claim.id,
            line_number=i + 1,
            cpt_code=sl.cpt_code,
            modifiers=sl.modifiers,
            description=sl.description,
            service_date=sl.service_date or body.service_date_from,
            place_of_service=sl.place_of_service,
            units=sl.units,
            billed_amount=sl.billed_amount,
            diagnosis_pointers=sl.diagnosis_pointers,
        )
        db.add(line)

    await db.commit()
    result = await db.execute(
        select(Claim).options(*claim_with_relations()).where(Claim.id == claim.id)
    )
    return ClaimOut.model_validate(result.scalar_one())


@router.get("/{claim_id}", response_model=ClaimOut)
async def get_claim(
    claim_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Claim).options(*claim_with_relations()).where(Claim.id == claim_id)
    )
    claim = result.scalar_one_or_none()
    if not claim:
        raise HTTPException(404, "Reclamación no encontrada")
    return ClaimOut.model_validate(claim)


@router.patch("/{claim_id}", response_model=ClaimOut)
async def update_claim(
    claim_id: int,
    body: ClaimUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(select(Claim).where(Claim.id == claim_id))
    claim = result.scalar_one_or_none()
    if not claim:
        raise HTTPException(404, "Reclamación no encontrada")

    updates = body.model_dump(exclude_none=True)
    old_status = claim.status

    for field, value in updates.items():
        setattr(claim, field, value)

    # Audit status changes
    if "status" in updates and updates["status"] != str(old_status):
        await log_action(
            db, "claim", claim_id, "status_change",
            claim_id=claim_id,
            old_value=str(old_status),
            new_value=updates["status"],
            user=current_user,
        )
        await _maybe_push_wink_status(claim, updates["status"])
    elif updates:
        await log_action(
            db, "claim", claim_id, "updated",
            claim_id=claim_id,
            new_value=str(list(updates.keys())),
            user=current_user,
        )

    await db.commit()
    result = await db.execute(
        select(Claim).options(*claim_with_relations()).where(Claim.id == claim_id)
    )
    return ClaimOut.model_validate(result.scalar_one())


@router.post("/{claim_id}/submit", response_model=ClaimOut)
async def submit_claim(
    claim_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Mark claim as submitted — actual Stedi submission in /stedi/submit."""
    result = await db.execute(
        select(Claim).options(selectinload(Claim.service_lines)).where(Claim.id == claim_id)
    )
    claim = result.scalar_one_or_none()
    if not claim:
        raise HTTPException(404, "Reclamación no encontrada")
    if claim.status not in (ClaimStatus.DRAFT, ClaimStatus.READY):
        raise HTTPException(400, f"No se puede someter una reclamación en estado '{claim.status}'")

    # ── CPT enforcement for outside prescriptions (Ruth safety) ───────────
    # If the claim did NOT originate from Wink, CPT codes are REQUIRED.
    # No CPT = blocked submission. This prevents billing errors on walk-in Rx.
    if claim.source != "wink":
        has_cpt = any(sl.cpt_code for sl in claim.service_lines)
        if not has_cpt:
            raise HTTPException(
                400,
                "Reclamación de receta externa requiere códigos CPT antes de someter. "
                "Añada al menos un código CPT (línea de servicio) para continuar."
            )
    old_status = claim.status
    claim.status = ClaimStatus.SUBMITTED
    claim.date_of_submission = datetime.utcnow()
    await log_action(
        db, "claim", claim_id, "status_change",
        claim_id=claim_id, old_value=str(old_status),
        new_value=ClaimStatus.SUBMITTED, user=current_user,
    )
    await _maybe_push_wink_status(claim, "submitted")
    await db.commit()
    result = await db.execute(
        select(Claim).options(*claim_with_relations()).where(Claim.id == claim_id)
    )
    return ClaimOut.model_validate(result.scalar_one())


@router.post("/{claim_id}/resubmit", response_model=ClaimOut)
async def resubmit_claim(
    claim_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Reset a denied/rejected claim back to ready for resubmission."""
    result = await db.execute(select(Claim).where(Claim.id == claim_id))
    claim = result.scalar_one_or_none()
    if not claim:
        raise HTTPException(404, "Reclamación no encontrada")
    old_status = claim.status
    claim.status = ClaimStatus.READY
    claim.stedi_transaction_id = None
    await log_action(
        db, "claim", claim_id, "resubmit",
        claim_id=claim_id, old_value=str(old_status),
        new_value=ClaimStatus.READY, user=current_user,
        notes="Claim reset for resubmission",
    )
    await _maybe_push_wink_status(claim, "ready")
    await db.commit()
    result = await db.execute(
        select(Claim).options(*claim_with_relations()).where(Claim.id == claim_id)
    )
    return ClaimOut.model_validate(result.scalar_one())


@router.post("/{claim_id}/reopen", response_model=ClaimOut)
async def reopen_claim(
    claim_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Reopen a denied/rejected/void claim as draft for editing and resubmission."""
    result = await db.execute(select(Claim).where(Claim.id == claim_id))
    claim = result.scalar_one_or_none()
    if not claim:
        raise HTTPException(404, "Reclamación no encontrada")
    if claim.status not in (ClaimStatus.DENIED, ClaimStatus.REJECTED, ClaimStatus.VOID):
        raise HTTPException(400, f"No se puede reabrir una reclamación en estado '{claim.status}'")
    old_status = claim.status
    claim.status = ClaimStatus.DRAFT
    claim.stedi_transaction_id = None
    await log_action(
        db, "claim", claim_id, "reopen",
        claim_id=claim_id, old_value=str(old_status),
        new_value=ClaimStatus.DRAFT, user=current_user,
        notes="Claim reopened as draft for editing",
    )
    await _maybe_push_wink_status(claim, "draft")
    await db.commit()
    result = await db.execute(
        select(Claim).options(*claim_with_relations()).where(Claim.id == claim_id)
    )
    return ClaimOut.model_validate(result.scalar_one())


@router.post("/{claim_id}/void", response_model=ClaimOut)
async def void_claim(
    claim_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(select(Claim).where(Claim.id == claim_id))
    claim = result.scalar_one_or_none()
    if not claim:
        raise HTTPException(404, "Reclamación no encontrada")
    old_status = claim.status
    claim.status = ClaimStatus.VOID
    await log_action(
        db, "claim", claim_id, "status_change",
        claim_id=claim_id, old_value=str(old_status),
        new_value=ClaimStatus.VOID, user=current_user,
    )
    await _maybe_push_wink_status(claim, "void")
    await db.commit()
    result = await db.execute(
        select(Claim).options(*claim_with_relations()).where(Claim.id == claim_id)
    )
    return ClaimOut.model_validate(result.scalar_one())


@router.get("/{claim_id}/payments", response_model=List[PaymentOut])
async def get_claim_payments(
    claim_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    result = await db.execute(select(Payment).where(Payment.claim_id == claim_id))
    return [PaymentOut.model_validate(p) for p in result.scalars().all()]


@router.post("/{claim_id}/payments", response_model=PaymentOut, status_code=201)
async def post_payment(
    claim_id: int,
    body: PaymentCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    result = await db.execute(select(Claim).where(Claim.id == claim_id))
    claim = result.scalar_one_or_none()
    if not claim:
        raise HTTPException(404, "Reclamación no encontrada")
    payment = Payment(claim_id=claim_id, **body.model_dump())
    db.add(payment)
    # Update claim financials
    claim.total_paid = (claim.total_paid or 0.0) + body.payment_amount
    claim.patient_responsibility = body.patient_responsibility
    if claim.total_paid >= claim.total_billed * 0.9:
        claim.status = ClaimStatus.PAID
        await _maybe_push_wink_status(claim, "paid")
    await db.commit()
    await db.refresh(payment)
    return PaymentOut.model_validate(payment)


@router.post("/batch-submit", response_model=dict)
async def batch_submit_claims(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Batch submit all ready claims (status=ready). Returns success/failure counts."""
    result = await db.execute(
        select(Claim).options(*claim_with_relations()).where(Claim.status == ClaimStatus.READY)
    )
    ready_claims = result.scalars().all()

    if not ready_claims:
        return {"submitted": 0, "failed": 0, "errors": [], "total": 0}

    submitted = 0
    failed_list = []

    for claim in ready_claims:
        try:
            # ── CPT enforcement for outside prescriptions (Ruth safety) ───
            if claim.source != "wink" and not any(sl.cpt_code for sl in claim.service_lines):
                failed_list.append({
                    "claim_id": claim.id,
                    "claim_number": claim.claim_number,
                    "error": "Receta externa sin códigos CPT — bloqueada",
                })
                continue
            old_status = claim.status
            claim.status = ClaimStatus.SUBMITTED
            claim.date_of_submission = datetime.utcnow()
            await log_action(
                db, "claim", claim.id, "status_change",
                claim_id=claim.id,
                old_value=str(old_status),
                new_value=ClaimStatus.SUBMITTED,
                user=current_user,
                notes="Batch submit",
            )
            submitted += 1
        except Exception as e:
            failed_list.append({"claim_id": claim.id, "claim_number": claim.claim_number, "error": str(e)})

    await db.commit()

    return {
        "submitted": submitted,
        "failed": len(failed_list),
        "errors": failed_list,
        "total": len(ready_claims),
    }


# ── Service Line Update ───────────────────────────────────────────────────────

class ServiceLineUpdate(BaseModel):
    billed_amount: Optional[float] = None
    description: Optional[str] = None
    units: Optional[int] = None
    modifiers: Optional[List[str]] = None


@router.patch("/{claim_id}/service-lines/{line_id}", response_model=dict)
async def update_service_line(
    claim_id: int,
    line_id: int,
    body: ServiceLineUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update a specific service line (e.g. billed_amount). Recalculates claim total."""
    result = await db.execute(
        select(ServiceLine).where(ServiceLine.id == line_id, ServiceLine.claim_id == claim_id)
    )
    sl = result.scalar_one_or_none()
    if not sl:
        raise HTTPException(404, "Línea de servicio no encontrada")

    updates = body.model_dump(exclude_none=True)
    old_billed = sl.billed_amount
    for field, value in updates.items():
        setattr(sl, field, value)

    # Recalculate claim total_billed
    claim_result = await db.execute(
        select(Claim).options(selectinload(Claim.service_lines)).where(Claim.id == claim_id)
    )
    claim = claim_result.scalar_one_or_none()
    if claim:
        claim.total_billed = sum(s.billed_amount * s.units for s in claim.service_lines)

    await log_action(
        db, "service_line", line_id, "billed_amount_updated",
        claim_id=claim_id,
        old_value=f"${old_billed:.2f}",
        new_value=f"${sl.billed_amount:.2f}",
        user=current_user,
        notes=f"CPT {sl.cpt_code} billed amount updated",
    )

    await db.commit()

    return {
        "id": sl.id,
        "cpt_code": sl.cpt_code,
        "billed_amount": sl.billed_amount,
        "claim_total_billed": claim.total_billed if claim else 0,
    }


# ── Delete Endpoints ──────────────────────────────────────────────────────────

async def _delete_claim(db: AsyncSession, claim_id: int) -> None:
    """Delete a claim and all its related records (service_lines, denials, payments, audit_logs)."""
    # Service lines are cascade delete-orphan, but denials/payments/audit need manual cleanup
    await db.execute(select(Denial).where(Denial.claim_id == claim_id))
    denials = (await db.execute(select(Denial).where(Denial.claim_id == claim_id))).scalars().all()
    for d in denials:
        # Delete appeals linked to this denial
        from models import Appeal
        appeals = (await db.execute(select(Appeal).where(Appeal.denial_id == d.id))).scalars().all()
        for a in appeals:
            await db.delete(a)
        await db.delete(d)

    # Delete appeals linked to claim directly
    from models import Appeal
    appeals = (await db.execute(select(Appeal).where(Appeal.claim_id == claim_id))).scalars().all()
    for a in appeals:
        await db.delete(a)

    payments = (await db.execute(select(Payment).where(Payment.claim_id == claim_id))).scalars().all()
    for p in payments:
        await db.delete(p)

    audit_logs = (await db.execute(select(AuditLog).where(AuditLog.claim_id == claim_id))).scalars().all()
    for log in audit_logs:
        await db.delete(log)

    # Delete approval requests
    from models import ApprovalRequest
    approval_reqs = (await db.execute(select(ApprovalRequest).where(ApprovalRequest.claim_id == claim_id))).scalars().all()
    for ar in approval_reqs:
        await db.delete(ar)

    # Now delete the claim itself (service_lines cascade)
    claim = (await db.execute(select(Claim).where(Claim.id == claim_id))).scalar_one_or_none()
    if claim:
        await db.delete(claim)


@router.delete("/{claim_id}", status_code=200)
async def delete_claim(
    claim_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Permanently delete a single claim and all related records."""
    result = await db.execute(select(Claim).where(Claim.id == claim_id))
    claim = result.scalar_one_or_none()
    if not claim:
        raise HTTPException(404, "Reclamación no encontrada")

    claim_number = claim.claim_number
    await _delete_claim(db, claim_id)
    await db.commit()

    return {"deleted": True, "claim_id": claim_id, "claim_number": claim_number}


@router.post("/bulk-delete", status_code=200)
async def bulk_delete_claims(
    body: BulkDeleteRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete multiple claims. Returns count of deleted."""
    if not body.claim_ids:
        return {"deleted": 0, "claim_ids": []}

    deleted_ids = []
    for cid in body.claim_ids:
        result = await db.execute(select(Claim).where(Claim.id == cid))
        claim = result.scalar_one_or_none()
        if claim:
            await _delete_claim(db, cid)
            deleted_ids.append(cid)

    await db.commit()
    return {"deleted": len(deleted_ids), "claim_ids": deleted_ids}


# ── Seed Test Claims ──────────────────────────────────────────────────────────

@router.post("/seed-test-claims", summary="Create 5 test claims with fake data (idempotent)")
async def seed_test_claims(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Create 5 test claims with realistic but fake patient data.
    Idempotent — skips claims that already exist (by claim_number).
    Useful for testing the 837P / Inmediata pipeline.
    """
    TEST_CLAIMS = [
        {
            "claim_number": "CLM-TEST-001",
            "first_name": "JUAN",
            "last_name": "GARCIA RODRIGUEZ",
            "dob": date(1975, 3, 15),
            "gender": "M",
            "payer_id": 1,           # Triple-S Salud
            "member_id": "TSS-TEST-001",
            "group_number": "GRP-001",
            "service_date": date(2026, 5, 20),
            "diagnosis_codes": ["H52.13", "Z00.00"],
            "service_lines": [
                {"cpt_code": "92015", "description": "Refraction", "units": 1, "billed_amount": 75.00, "diag_ptrs": [1, 2]},
                {"cpt_code": "92002", "description": "Ophthalmological exam, new patient", "units": 1, "billed_amount": 125.00, "diag_ptrs": [1, 2]},
            ],
        },
        {
            "claim_number": "CLM-TEST-002",
            "first_name": "MARIA",
            "last_name": "LOPEZ SANTIAGO",
            "dob": date(1988, 7, 22),
            "gender": "F",
            "payer_id": 2,           # MCS Healthcare
            "member_id": "MCS-TEST-002",
            "group_number": "79-TEST01",
            "service_date": date(2026, 5, 19),
            "diagnosis_codes": ["H52.4"],
            "service_lines": [
                {"cpt_code": "92014", "description": "Ophthalmological exam, established", "units": 1, "billed_amount": 100.00, "diag_ptrs": [1]},
                {"cpt_code": "V2020", "description": "Frames", "units": 1, "billed_amount": 85.00, "diag_ptrs": [1]},
                {"cpt_code": "V2300", "description": "Sphere, single vision", "units": 1, "billed_amount": 55.00, "diag_ptrs": [1]},
            ],
        },
        {
            "claim_number": "CLM-TEST-003",
            "first_name": "CARLOS",
            "last_name": "RIVERA NIEVES",
            "dob": date(1960, 11, 3),
            "gender": "M",
            "payer_id": 13,          # First Medical Vital
            "member_id": "FMV-TEST-003",
            "group_number": None,
            "service_date": date(2026, 5, 18),
            "diagnosis_codes": ["H40.11", "H52.1"],
            "service_lines": [
                {"cpt_code": "92015", "description": "Refraction", "units": 1, "billed_amount": 75.00, "diag_ptrs": [1, 2]},
                {"cpt_code": "92250", "description": "Fundus photography", "units": 1, "billed_amount": 95.00, "diag_ptrs": [1]},
                {"cpt_code": "92083", "description": "Visual field exam", "units": 1, "billed_amount": 85.00, "diag_ptrs": [1]},
            ],
        },
        {
            "claim_number": "CLM-TEST-004",
            "first_name": "ANA",
            "last_name": "MARTINEZ COLON",
            "dob": date(1995, 1, 30),
            "gender": "F",
            "payer_id": 11,          # Triple-S Advantage
            "member_id": "TSA-TEST-004",
            "group_number": None,
            "service_date": date(2026, 5, 17),
            "diagnosis_codes": ["H10.10", "H04.12"],
            "service_lines": [
                {"cpt_code": "92012", "description": "Ophthalmological exam, intermediate", "units": 1, "billed_amount": 85.00, "diag_ptrs": [1, 2]},
                {"cpt_code": "92002", "description": "Ophthalmological exam, new patient", "units": 1, "billed_amount": 125.00, "diag_ptrs": [1, 2]},
            ],
        },
        {
            "claim_number": "CLM-TEST-005",
            "first_name": "PEDRO",
            "last_name": "SANTIAGO MORALES",
            "dob": date(1950, 6, 18),
            "gender": "M",
            "payer_id": 6,           # Medicare/Novitas
            "member_id": "MCR-TEST-005",
            "group_number": None,
            "service_date": date(2026, 5, 16),
            "diagnosis_codes": ["H25.811", "H52.4"],
            "service_lines": [
                {"cpt_code": "92014", "description": "Ophthalmological exam, established", "units": 1, "billed_amount": 100.00, "diag_ptrs": [1, 2]},
                {"cpt_code": "76519", "description": "Ophthalmic biometry", "units": 1, "billed_amount": 110.00, "diag_ptrs": [1]},
                {"cpt_code": "92015", "description": "Refraction", "units": 1, "billed_amount": 75.00, "diag_ptrs": [1, 2]},
            ],
        },
    ]

    created = []
    skipped = []

    for tc in TEST_CLAIMS:
        # Idempotency check
        existing = await db.execute(
            select(Claim).where(Claim.claim_number == tc["claim_number"])
        )
        if existing.scalar_one_or_none():
            skipped.append(tc["claim_number"])
            continue

        # Verify payer exists
        payer_res = await db.execute(select(Payer).where(Payer.id == tc["payer_id"]))
        payer = payer_res.scalar_one_or_none()
        if not payer:
            skipped.append(f"{tc['claim_number']} (payer {tc['payer_id']} not found)")
            continue

        # Create or find patient by name + DOB
        pt_res = await db.execute(
            select(Patient).where(
                Patient.first_name == tc["first_name"],
                Patient.last_name == tc["last_name"],
                Patient.dob == tc["dob"],
            ).limit(1)
        )
        patient = pt_res.scalar_one_or_none()
        if not patient:
            patient = Patient(
                first_name=tc["first_name"],
                last_name=tc["last_name"],
                dob=tc["dob"],
                gender=tc["gender"],
                address_line1="123 Test Ave",
                city="San Juan",
                state="PR",
                zip_code="00901",
            )
            db.add(patient)
            await db.flush()

        # Create insurance if not already present for this payer
        ins_res = await db.execute(
            select(PatientInsurance).where(
                PatientInsurance.patient_id == patient.id,
                PatientInsurance.payer_id == tc["payer_id"],
            ).limit(1)
        )
        if not ins_res.scalar_one_or_none():
            ins = PatientInsurance(
                patient_id=patient.id,
                payer_id=tc["payer_id"],
                member_id=tc["member_id"],
                group_number=tc["group_number"],
                is_primary=True,
            )
            db.add(ins)
            await db.flush()

        # Calculate total billed
        total_billed = sum(sl["billed_amount"] for sl in tc["service_lines"])

        # Create the claim
        claim = Claim(
            claim_number=tc["claim_number"],
            patient_id=patient.id,
            provider_id=1,           # Dr. Brenda Cubero
            payer_id=tc["payer_id"],
            status=ClaimStatus.READY,
            service_date_from=tc["service_date"],
            service_date_to=tc["service_date"],
            diagnosis_codes=tc["diagnosis_codes"],
            total_billed=total_billed,
            source="manual",
        )
        db.add(claim)
        await db.flush()

        # Create service lines
        for sl_data in tc["service_lines"]:
            sl = ServiceLine(
                claim_id=claim.id,
                cpt_code=sl_data["cpt_code"],
                description=sl_data["description"],
                units=sl_data["units"],
                billed_amount=sl_data["billed_amount"],
                service_date=tc["service_date"],
                diagnosis_pointers=sl_data["diag_ptrs"],
            )
            db.add(sl)

        created.append(tc["claim_number"])

    await db.commit()
    return {
        "created": created,
        "skipped": skipped,
        "total_created": len(created),
        "total_skipped": len(skipped),
    }
