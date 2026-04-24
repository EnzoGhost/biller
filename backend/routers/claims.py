import random
import string
from datetime import datetime
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_
from sqlalchemy.orm import selectinload

from database import get_db
from models import Claim, ServiceLine, ClaimStatus, Patient, Provider, Payer
from schemas import ClaimOut, ClaimCreate, ClaimUpdate, PaymentOut, PaymentCreate, ServiceLineCreate
from auth import get_current_user
from models import User, Payment
from routers.audit import log_action

router = APIRouter(prefix="/claims", tags=["claims"])


def generate_claim_number() -> str:
    ts = datetime.utcnow().strftime("%Y%m%d")
    suffix = "".join(random.choices(string.ascii_uppercase + string.digits, k=6))
    return f"CLM-{ts}-{suffix}"


def claim_with_relations():
    return [
        selectinload(Claim.patient).selectinload(Patient.insurances),
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
    result = await db.execute(select(Claim).where(Claim.id == claim_id))
    claim = result.scalar_one_or_none()
    if not claim:
        raise HTTPException(404, "Reclamación no encontrada")
    if claim.status not in (ClaimStatus.DRAFT, ClaimStatus.READY):
        raise HTTPException(400, f"No se puede someter una reclamación en estado '{claim.status}'")
    old_status = claim.status
    claim.status = ClaimStatus.SUBMITTED
    claim.date_of_submission = datetime.utcnow()
    await log_action(
        db, "claim", claim_id, "status_change",
        claim_id=claim_id, old_value=str(old_status),
        new_value=ClaimStatus.SUBMITTED, user=current_user,
    )
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
