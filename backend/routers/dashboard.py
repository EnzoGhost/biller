from datetime import datetime, date
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from database import get_db
from models import Claim, ClaimStatus, Denial, Appeal, User
from auth import get_current_user

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("/stats")
async def get_stats(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Dashboard KPIs: claims by status, MTD revenue, collection rate, top denials."""
    now = datetime.utcnow()
    month_start = date(now.year, now.month, 1)

    # Claims by status
    status_result = await db.execute(
        select(Claim.status, func.count(Claim.id)).group_by(Claim.status)
    )
    claims_by_status = {row[0]: row[1] for row in status_result.fetchall()}
    total_claims = sum(claims_by_status.values())

    # MTD financials
    mtd_result = await db.execute(
        select(
            func.coalesce(func.sum(Claim.total_billed), 0.0),
            func.coalesce(func.sum(Claim.total_paid), 0.0),
        ).where(Claim.service_date_from >= month_start)
    )
    billed_mtd, paid_mtd = mtd_result.one()

    collection_rate = (paid_mtd / billed_mtd * 100) if billed_mtd > 0 else 0.0

    # Pending appeals
    appeals_result = await db.execute(
        select(func.count(Appeal.id)).where(Appeal.status == "pending")
    )
    pending_appeals = appeals_result.scalar_one()

    # Top denial reasons
    denial_result = await db.execute(
        select(Denial.denial_reason, func.count(Denial.id))
        .group_by(Denial.denial_reason)
        .order_by(func.count(Denial.id).desc())
        .limit(5)
    )
    top_denials = [
        {"reason": row[0], "count": row[1]} for row in denial_result.fetchall()
    ]

    # Recent claims (last 10)
    recent_result = await db.execute(
        select(Claim)
        .order_by(Claim.created_at.desc())
        .limit(10)
    )
    recent_claims = [
        {
            "id": c.id,
            "claim_number": c.claim_number,
            "status": c.status,
            "total_billed": c.total_billed,
            "service_date_from": c.service_date_from.isoformat() if c.service_date_from else None,
        }
        for c in recent_result.scalars().all()
    ]

    return {
        "total_claims": total_claims,
        "claims_by_status": claims_by_status,
        "total_billed_mtd": float(billed_mtd),
        "total_paid_mtd": float(paid_mtd),
        "collection_rate": round(collection_rate, 1),
        "pending_appeals": pending_appeals,
        "top_denial_reasons": top_denials,
        "recent_claims": recent_claims,
    }
