"""
Payments router — full payment posting workflow.
Manual payments, batch ERA posting, refunds, adjustments.
"""
from datetime import datetime, date
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from database import get_db
from models import Payment, Claim, ClaimStatus, User
from schemas import PaymentOut, PaymentCreate
from auth import get_current_user
from routers.audit import log_action

router = APIRouter(prefix="/payments", tags=["payments"])


# ── Schemas ───────────────────────────────────────────────────────────────────

class BatchPaymentItem(BaseModel):
    claim_id: int
    payment_amount: float
    adjustment_amount: float = 0.0
    patient_responsibility: float = 0.0
    denial_code: Optional[str] = None
    denial_reason: Optional[str] = None


class BatchPaymentRequest(BaseModel):
    check_number: Optional[str] = None
    check_date: Optional[date] = None
    payment_method: str = "eft"
    payer_name: Optional[str] = None
    notes: Optional[str] = None
    items: List[BatchPaymentItem]


class RefundRequest(BaseModel):
    refund_amount: float
    reason: str
    notes: Optional[str] = None


class PaymentSummary(BaseModel):
    total_payments: int
    total_amount: float
    total_adjustments: float
    total_patient_responsibility: float


# ── List Payments ─────────────────────────────────────────────────────────────

@router.get("", response_model=dict)
async def list_payments(
    page: int = Query(1, ge=1),
    per_page: int = Query(25, ge=1, le=100),
    claim_id: Optional[int] = None,
    payment_method: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """List all payments, optionally filtered by claim."""
    q = select(Payment)
    if claim_id:
        q = q.where(Payment.claim_id == claim_id)
    if payment_method:
        q = q.where(Payment.payment_method == payment_method)

    count_q = select(func.count()).select_from(Payment)
    if claim_id:
        count_q = count_q.where(Payment.claim_id == claim_id)
    total_res = await db.execute(count_q)
    total = total_res.scalar_one()

    q = q.order_by(Payment.posted_at.desc()).offset((page - 1) * per_page).limit(per_page)
    result = await db.execute(q)
    payments = result.scalars().all()

    return {
        "items": [PaymentOut.model_validate(p) for p in payments],
        "total": total,
        "page": page,
        "per_page": per_page,
        "pages": max(1, (total + per_page - 1) // per_page),
    }


@router.get("/summary")
async def get_payment_summary(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
) -> dict:
    """Aggregate payment statistics."""
    result = await db.execute(
        select(
            func.count(Payment.id),
            func.coalesce(func.sum(Payment.payment_amount), 0.0),
            func.coalesce(func.sum(Payment.adjustment_amount), 0.0),
            func.coalesce(func.sum(Payment.patient_responsibility), 0.0),
        )
    )
    count, total, adjustments, patient_resp = result.one()
    return {
        "total_payments": int(count),
        "total_amount": round(float(total), 2),
        "total_adjustments": round(float(adjustments), 2),
        "total_patient_responsibility": round(float(patient_resp), 2),
    }


# ── Single Payment ────────────────────────────────────────────────────────────

@router.get("/{payment_id}", response_model=PaymentOut)
async def get_payment(
    payment_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    result = await db.execute(select(Payment).where(Payment.id == payment_id))
    p = result.scalar_one_or_none()
    if not p:
        raise HTTPException(404, "Payment not found")
    return PaymentOut.model_validate(p)


@router.post("/claims/{claim_id}", response_model=PaymentOut, status_code=201)
async def post_payment(
    claim_id: int,
    body: PaymentCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Post a manual payment to a claim."""
    claim_res = await db.execute(select(Claim).where(Claim.id == claim_id))
    claim = claim_res.scalar_one_or_none()
    if not claim:
        raise HTTPException(404, "Claim not found")

    payment = Payment(
        claim_id=claim_id,
        check_number=body.check_number,
        check_date=body.check_date,
        payment_amount=body.payment_amount,
        adjustment_amount=body.adjustment_amount,
        patient_responsibility=body.patient_responsibility,
        payment_method=body.payment_method,
        eob_data=body.eob_data,
        notes=body.notes,
        posted_at=datetime.utcnow(),
    )
    db.add(payment)

    # Update claim financials
    old_paid = claim.total_paid or 0.0
    claim.total_paid = old_paid + body.payment_amount
    claim.patient_responsibility = body.patient_responsibility
    if body.adjustment_amount:
        claim.adjustment_amount = (claim.adjustment_amount or 0.0) + body.adjustment_amount

    # Auto-mark as paid if sufficiently covered
    if claim.total_paid >= claim.total_billed * 0.9:
        old_status = claim.status
        claim.status = ClaimStatus.PAID
        await log_action(
            db, "claim", claim_id, "status_change",
            claim_id=claim_id,
            old_value=str(old_status),
            new_value=ClaimStatus.PAID,
            user=current_user,
            notes=f"Auto-paid after payment posted: ${body.payment_amount:.2f}",
        )

    await log_action(
        db, "payment", claim_id, "payment_posted",
        claim_id=claim_id,
        new_value=f"${body.payment_amount:.2f} via {body.payment_method}",
        user=current_user,
        notes=f"Check: {body.check_number or 'EFT'} | Patient Resp: ${body.patient_responsibility:.2f}",
    )

    await db.commit()
    await db.refresh(payment)
    return PaymentOut.model_validate(payment)


# ── Batch Payment (ERA) ───────────────────────────────────────────────────────

@router.post("/batch", status_code=201)
async def post_batch_payments(
    body: BatchPaymentRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Post a batch of payments from one ERA (835) — one check covering multiple claims."""
    results = []
    errors = []

    for item in body.items:
        try:
            claim_res = await db.execute(select(Claim).where(Claim.id == item.claim_id))
            claim = claim_res.scalar_one_or_none()
            if not claim:
                errors.append({"claim_id": item.claim_id, "error": "Claim not found"})
                continue

            payment = Payment(
                claim_id=item.claim_id,
                check_number=body.check_number,
                check_date=body.check_date,
                payment_amount=item.payment_amount,
                adjustment_amount=item.adjustment_amount,
                patient_responsibility=item.patient_responsibility,
                payment_method=body.payment_method,
                eob_data={
                    "payer_name": body.payer_name,
                    "denial_code": item.denial_code,
                    "denial_reason": item.denial_reason,
                    "batch_posted": True,
                },
                notes=body.notes,
                posted_at=datetime.utcnow(),
            )
            db.add(payment)

            old_paid = claim.total_paid or 0.0
            claim.total_paid = old_paid + item.payment_amount
            claim.patient_responsibility = item.patient_responsibility
            if item.adjustment_amount:
                claim.adjustment_amount = (claim.adjustment_amount or 0.0) + item.adjustment_amount

            # Handle denial
            if item.denial_code and item.payment_amount == 0:
                from models import Denial
                denial = Denial(
                    claim_id=item.claim_id,
                    denial_code=item.denial_code,
                    denial_reason=item.denial_reason or item.denial_code,
                    denial_date=body.check_date or date.today(),
                    carc_code=item.denial_code,
                )
                db.add(denial)
                old_status = claim.status
                claim.status = ClaimStatus.DENIED
                await log_action(
                    db, "claim", item.claim_id, "status_change",
                    claim_id=item.claim_id,
                    old_value=str(old_status),
                    new_value=ClaimStatus.DENIED,
                    user=current_user,
                    notes=f"Denied via batch ERA: {item.denial_code} - {item.denial_reason}",
                )
            elif claim.total_paid >= claim.total_billed * 0.9:
                old_status = claim.status
                claim.status = ClaimStatus.PAID
                await log_action(
                    db, "claim", item.claim_id, "status_change",
                    claim_id=item.claim_id,
                    old_value=str(old_status),
                    new_value=ClaimStatus.PAID,
                    user=current_user,
                    notes=f"Paid via batch ERA: ${item.payment_amount:.2f}",
                )

            await log_action(
                db, "payment", item.claim_id, "batch_payment_posted",
                claim_id=item.claim_id,
                new_value=f"${item.payment_amount:.2f}",
                user=current_user,
                notes=f"Batch check {body.check_number or 'EFT'} from {body.payer_name or 'payer'}",
            )

            await db.flush()
            results.append({"claim_id": item.claim_id, "payment_amount": item.payment_amount, "status": "posted"})

        except Exception as e:
            errors.append({"claim_id": item.claim_id, "error": str(e)})

    await db.commit()
    return {
        "posted": len(results),
        "errors": len(errors),
        "results": results,
        "error_details": errors,
    }


# ── Refund ────────────────────────────────────────────────────────────────────

@router.post("/{payment_id}/refund", status_code=201)
async def create_refund(
    payment_id: int,
    body: RefundRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Post a refund/reversal for an existing payment."""
    pmt_res = await db.execute(select(Payment).where(Payment.id == payment_id))
    original = pmt_res.scalar_one_or_none()
    if not original:
        raise HTTPException(404, "Payment not found")

    if body.refund_amount > original.payment_amount:
        raise HTTPException(400, "Refund amount exceeds original payment")

    refund = Payment(
        claim_id=original.claim_id,
        check_number=f"REFUND-{original.check_number or payment_id}",
        payment_amount=-body.refund_amount,
        adjustment_amount=0.0,
        patient_responsibility=0.0,
        payment_method=original.payment_method,
        notes=f"Refund for payment #{payment_id}: {body.reason}. {body.notes or ''}",
        posted_at=datetime.utcnow(),
    )
    db.add(refund)

    # Update claim
    claim_res = await db.execute(select(Claim).where(Claim.id == original.claim_id))
    claim = claim_res.scalar_one_or_none()
    if claim:
        claim.total_paid = max(0.0, (claim.total_paid or 0.0) - body.refund_amount)
        if claim.status == ClaimStatus.PAID and claim.total_paid < claim.total_billed * 0.9:
            claim.status = ClaimStatus.ACCEPTED

    await log_action(
        db, "payment", payment_id, "refund_posted",
        claim_id=original.claim_id,
        old_value=str(original.payment_amount),
        new_value=f"-{body.refund_amount}",
        user=current_user,
        notes=f"Reason: {body.reason}",
    )

    await db.commit()
    await db.refresh(refund)
    return {"refund_payment_id": refund.id, "refund_amount": body.refund_amount}


# ── Delete ────────────────────────────────────────────────────────────────────

@router.delete("/{payment_id}", status_code=204)
async def delete_payment(
    payment_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete/void a payment (e.g. posted in error)."""
    pmt_res = await db.execute(select(Payment).where(Payment.id == payment_id))
    pmt = pmt_res.scalar_one_or_none()
    if not pmt:
        raise HTTPException(404, "Payment not found")

    # Reverse the claim amount
    claim_res = await db.execute(select(Claim).where(Claim.id == pmt.claim_id))
    claim = claim_res.scalar_one_or_none()
    if claim and pmt.payment_amount > 0:
        claim.total_paid = max(0.0, (claim.total_paid or 0.0) - pmt.payment_amount)

    await log_action(
        db, "payment", payment_id, "payment_voided",
        claim_id=pmt.claim_id,
        old_value=str(pmt.payment_amount),
        user=current_user,
        notes="Payment voided/deleted",
    )

    await db.delete(pmt)
    await db.commit()
