"""
Claim Follow-Up Queue
Shows claims that need attention:
- Submitted but no response after X days (default 14)
- Partially paid (balance remaining)
- Denied but not yet appealed
- Prior auth expiring soon
"""
from datetime import date, timedelta
from typing import List, Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, or_
from sqlalchemy.orm import selectinload
from pydantic import BaseModel

from database import get_db
from models import Claim, ClaimStatus, PriorAuth, PriorAuthStatus, User
from auth import get_current_user

router = APIRouter(prefix="/followup", tags=["followup"])


class FollowUpItem(BaseModel):
    claim_id: int
    claim_number: str
    status: str
    patient_name: str
    payer_name: str
    service_date: str
    total_billed: float
    total_paid: float
    balance: float
    days_since_submission: Optional[int]
    reason: str
    priority: str  # high / medium / low
    actions: List[str]

    class Config:
        from_attributes = True


@router.get("/", response_model=List[FollowUpItem])
async def get_followup_queue(
    days_without_response: int = Query(14, description="Days submitted without response"),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """
    Return all claims that need follow-up attention.
    """
    today = date.today()
    cutoff_date = today - timedelta(days=days_without_response)
    items: List[FollowUpItem] = []
    seen_ids: set = set()

    # ── 1. Submitted but no response after X days ──────────────────────────
    result = await db.execute(
        select(Claim)
        .options(selectinload(Claim.patient), selectinload(Claim.payer))
        .where(
            Claim.status.in_([ClaimStatus.SUBMITTED, ClaimStatus.ACCEPTED]),
            Claim.date_of_submission != None,
            Claim.date_of_submission <= cutoff_date,
        )
    )
    for claim in result.scalars().all():
        days = (today - claim.date_of_submission.date()).days if claim.date_of_submission else None
        items.append(_make_item(
            claim=claim,
            reason=f"Submitted {days} days ago — no payment received",
            priority="high" if days and days > 30 else "medium",
            actions=["Check Status", "Call Payer", "Resubmit"],
        ))
        seen_ids.add(claim.id)

    # ── 2. Partially paid (balance > $0) ──────────────────────────────────
    result = await db.execute(
        select(Claim)
        .options(selectinload(Claim.patient), selectinload(Claim.payer))
        .where(
            Claim.status == ClaimStatus.PAID,
            Claim.total_billed > Claim.total_paid + Claim.patient_responsibility,
        )
    )
    for claim in result.scalars().all():
        if claim.id in seen_ids:
            continue
        balance = claim.total_billed - claim.total_paid - claim.patient_responsibility - claim.adjustment_amount
        if balance > 0.50:  # threshold to ignore rounding errors
            items.append(_make_item(
                claim=claim,
                reason=f"Partially paid — ${balance:.2f} balance remaining",
                priority="medium",
                actions=["Check Status", "Appeal", "Call Payer"],
            ))
            seen_ids.add(claim.id)

    # ── 3. Denied but not yet appealed ────────────────────────────────────
    result = await db.execute(
        select(Claim)
        .options(selectinload(Claim.patient), selectinload(Claim.payer), selectinload(Claim.appeals))
        .where(Claim.status == ClaimStatus.DENIED)
    )
    for claim in result.scalars().all():
        if claim.id in seen_ids:
            continue
        has_appeal = bool(claim.appeals)
        if not has_appeal:
            items.append(_make_item(
                claim=claim,
                reason="Denied — no appeal filed",
                priority="high",
                actions=["Appeal", "Check Status", "Resubmit"],
            ))
            seen_ids.add(claim.id)

    # ── 4. Prior auth expiring soon (next 14 days) ────────────────────────
    expiry_cutoff = today + timedelta(days=14)
    pa_result = await db.execute(
        select(PriorAuth)
        .where(
            PriorAuth.expiry_date <= expiry_cutoff,
            PriorAuth.expiry_date >= today,
            PriorAuth.status == PriorAuthStatus.APPROVED,
            PriorAuth.claim_id != None,
        )
    )
    pa_claim_ids = {pa.claim_id for pa in pa_result.scalars().all() if pa.claim_id}

    if pa_claim_ids:
        result = await db.execute(
            select(Claim)
            .options(selectinload(Claim.patient), selectinload(Claim.payer))
            .where(Claim.id.in_(pa_claim_ids))
        )
        for claim in result.scalars().all():
            if claim.id in seen_ids:
                continue
            items.append(_make_item(
                claim=claim,
                reason="Prior auth expiring within 14 days",
                priority="high",
                actions=["Renew Auth", "Submit Claim", "Call Payer"],
            ))
            seen_ids.add(claim.id)

    # ── 5. Draft claims older than 30 days ────────────────────────────────
    old_draft_cutoff = today - timedelta(days=30)
    result = await db.execute(
        select(Claim)
        .options(selectinload(Claim.patient), selectinload(Claim.payer))
        .where(
            Claim.status == ClaimStatus.DRAFT,
            Claim.created_at <= old_draft_cutoff,
        )
    )
    for claim in result.scalars().all():
        if claim.id in seen_ids:
            continue
        days = (today - claim.created_at.date()).days
        items.append(_make_item(
            claim=claim,
            reason=f"Draft claim sitting for {days} days — needs submission",
            priority="medium",
            actions=["Review", "Submit", "Void"],
        ))
        seen_ids.add(claim.id)

    # Sort: high priority first, then by days (most urgent first)
    priority_order = {"high": 0, "medium": 1, "low": 2}
    items.sort(key=lambda x: (priority_order.get(x.priority, 2), x.service_date), reverse=False)

    return items


def _make_item(
    claim: Claim,
    reason: str,
    priority: str,
    actions: List[str],
) -> FollowUpItem:
    patient_name = (
        f"{claim.patient.first_name} {claim.patient.last_name}"
        if claim.patient
        else f"Patient #{claim.patient_id}"
    )
    payer_name = claim.payer.name if claim.payer else f"Payer #{claim.payer_id}"
    days_since = None
    if claim.date_of_submission:
        days_since = (date.today() - claim.date_of_submission.date()).days

    balance = max(0.0, claim.total_billed - claim.total_paid - claim.patient_responsibility - claim.adjustment_amount)

    return FollowUpItem(
        claim_id=claim.id,
        claim_number=claim.claim_number,
        status=claim.status,
        patient_name=patient_name,
        payer_name=payer_name,
        service_date=str(claim.service_date_from),
        total_billed=claim.total_billed,
        total_paid=claim.total_paid,
        balance=balance,
        days_since_submission=days_since,
        reason=reason,
        priority=priority,
        actions=actions,
    )


@router.get("/stats")
async def get_followup_stats(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Quick summary counts for the follow-up badge."""
    today = date.today()
    cutoff = today - timedelta(days=14)

    no_response = await db.execute(
        select(Claim.id).where(
            Claim.status.in_([ClaimStatus.SUBMITTED, ClaimStatus.ACCEPTED]),
            Claim.date_of_submission != None,
            Claim.date_of_submission <= cutoff,
        )
    )
    denied_no_appeal = await db.execute(
        select(Claim.id)
        .outerjoin(Claim.appeals)
        .where(Claim.status == ClaimStatus.DENIED)
        .group_by(Claim.id)
    )

    return {
        "no_response": len(no_response.all()),
        "denied_no_appeal": len(denied_no_appeal.all()),
        "total": len(no_response.all()) + len(denied_no_appeal.all()),
    }
