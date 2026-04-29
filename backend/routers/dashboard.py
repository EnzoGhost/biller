from datetime import datetime, date, timedelta
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, case

from database import get_db
from models import Claim, ClaimStatus, Denial, Appeal, User, Payer, Payment, Patient
from auth import get_current_user

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("/work-queue")
async def get_work_queue(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Work queue: claims grouped by status for the dashboard."""
    today = date.today()
    seven_days_ago = today - timedelta(days=7)
    today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)

    async def fetch_claims(statuses: list, limit: int = 50, order_desc: bool = False):
        q = (
            select(Claim)
            .where(Claim.status.in_(statuses))
        )
        if order_desc:
            q = q.order_by(Claim.updated_at.desc())
        else:
            q = q.order_by(Claim.created_at.desc())
        q = q.limit(limit)
        result = await db.execute(q)
        claims = result.scalars().all()
        out = []
        for c in claims:
            patient_name = ""
            if c.patient_id:
                p_res = await db.execute(select(Patient).where(Patient.id == c.patient_id))
                p = p_res.scalar_one_or_none()
                if p:
                    patient_name = f"{p.first_name} {p.last_name}"
            payer_name = ""
            if c.payer_id:
                pay_res = await db.execute(select(Payer).where(Payer.id == c.payer_id))
                pay = pay_res.scalar_one_or_none()
                if pay:
                    payer_name = pay.name
            days_aging = (today - c.service_date_from).days if c.service_date_from else 0
            out.append({
                "id": c.id,
                "claim_number": c.claim_number,
                "status": c.status,
                "patient_name": patient_name,
                "payer_name": payer_name,
                "service_date_from": c.service_date_from.isoformat() if c.service_date_from else None,
                "total_billed": c.total_billed,
                "total_paid": c.total_paid,
                "days_aging": days_aging,
                "date_of_submission": c.date_of_submission.isoformat() if c.date_of_submission else None,
                "source": c.source,
                "notes": c.notes,
            })
        return out

    new_claims = await fetch_claims([ClaimStatus.DRAFT])
    ready_claims = await fetch_claims([ClaimStatus.READY])
    submitted_claims = await fetch_claims([ClaimStatus.SUBMITTED, ClaimStatus.ACCEPTED])
    attention_claims = await fetch_claims([ClaimStatus.DENIED, ClaimStatus.REJECTED])

    for ac in attention_claims:
        denial_res = await db.execute(
            select(Denial)
            .where(Denial.claim_id == ac["id"])
            .order_by(Denial.created_at.desc())
            .limit(1)
        )
        denial = denial_res.scalar_one_or_none()
        ac["denial_reason"] = denial.denial_reason if denial else None
        ac["denial_code"] = denial.denial_code if denial else None

    paid_q = (
        select(Claim)
        .where(Claim.status == ClaimStatus.PAID)
        .where(Claim.updated_at >= datetime.combine(seven_days_ago, datetime.min.time()))
        .order_by(Claim.updated_at.desc())
        .limit(20)
    )
    paid_result = await db.execute(paid_q)
    paid_raw = paid_result.scalars().all()
    paid_claims = []
    for c in paid_raw:
        patient_name = ""
        if c.patient_id:
            p_res = await db.execute(select(Patient).where(Patient.id == c.patient_id))
            p = p_res.scalar_one_or_none()
            if p:
                patient_name = f"{p.first_name} {p.last_name}"
        payer_name = ""
        if c.payer_id:
            pay_res = await db.execute(select(Payer).where(Payer.id == c.payer_id))
            pay = pay_res.scalar_one_or_none()
            if pay:
                payer_name = pay.name
        paid_claims.append({
            "id": c.id,
            "claim_number": c.claim_number,
            "status": c.status,
            "patient_name": patient_name,
            "payer_name": payer_name,
            "service_date_from": c.service_date_from.isoformat() if c.service_date_from else None,
            "total_billed": c.total_billed,
            "total_paid": c.total_paid,
            "days_aging": 0,
            "date_of_submission": c.date_of_submission.isoformat() if c.date_of_submission else None,
            "source": c.source,
            "notes": c.notes,
        })

    new_today_res = await db.execute(
        select(func.count(Claim.id))
        .where(Claim.created_at >= today_start)
        .where(Claim.status == ClaimStatus.DRAFT)
    )
    new_today = new_today_res.scalar_one() or 0

    return {
        "new": new_claims,
        "ready": ready_claims,
        "submitted": submitted_claims,
        "attention": attention_claims,
        "paid": paid_claims,
        "counts": {
            "new_today": new_today,
            "ready": len(ready_claims),
            "attention": len(attention_claims),
        },
    }


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
        select(Denial.denial_code, Denial.denial_reason, func.count(Denial.id))
        .group_by(Denial.denial_code, Denial.denial_reason)
        .order_by(func.count(Denial.id).desc())
        .limit(5)
    )
    top_denials = [
        {"denial_code": row[0], "reason": row[1], "count": row[2]}
        for row in denial_result.fetchall()
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

    # ── Today's submissions ─────────────────────────────────────────────────
    today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    today_res = await db.execute(
        select(func.count(Claim.id))
        .where(Claim.date_of_submission >= today_start)
    )
    submitted_today = today_res.scalar_one() or 0

    # ── Claims requiring attention ──────────────────────────────────────────
    thirty_days_ago = date.today() - timedelta(days=30)
    attention_result = await db.execute(
        select(Claim)
        .where(
            Claim.status.in_([
                ClaimStatus.DENIED, ClaimStatus.REJECTED,
                ClaimStatus.SUBMITTED, ClaimStatus.ACCEPTED,
            ])
        )
        .order_by(Claim.service_date_from.asc())
        .limit(10)
    )
    attention_claims_raw = attention_result.scalars().all()
    attention_claims = []
    for c in attention_claims_raw:
        days_old = (date.today() - c.service_date_from).days if c.service_date_from else 0
        if c.status in (ClaimStatus.DENIED, ClaimStatus.REJECTED) or days_old > 30:
            # Get actual denial reason
            denial_res = await db.execute(
                select(Denial).where(Denial.claim_id == c.id).order_by(Denial.created_at.desc()).limit(1)
            )
            denial = denial_res.scalar_one_or_none()

            attention_claims.append({
                "id": c.id,
                "claim_number": c.claim_number,
                "status": c.status,
                "total_billed": c.total_billed,
                "service_date_from": c.service_date_from.isoformat() if c.service_date_from else None,
                "days_old": days_old,
                "reason_key": (
                    "attention.denied_needs_appeal" if c.status == ClaimStatus.DENIED
                    else "attention.rejected_needs_correction" if c.status == ClaimStatus.REJECTED
                    else "attention.aging_follow_up"
                ),
                "reason_params": {"days": days_old} if c.status not in (ClaimStatus.DENIED, ClaimStatus.REJECTED) else {},
                "denial_reason": denial.denial_reason if denial else None,
                "denial_code": denial.denial_code if denial else None,
            })

    # ── Weekly trends (last 8 weeks) ────────────────────────────────────────
    weekly_trends = []
    for i in range(7, -1, -1):
        week_end = date.today() - timedelta(weeks=i)
        week_start = week_end - timedelta(days=6)
        w_res = await db.execute(
            select(
                func.count(Claim.id),
                func.coalesce(func.sum(Claim.total_billed), 0.0),
                func.coalesce(func.sum(Claim.total_paid), 0.0),
            )
            .where(
                and_(
                    Claim.service_date_from >= week_start,
                    Claim.service_date_from <= week_end,
                )
            )
        )
        w_count, w_billed, w_paid = w_res.one()
        weekly_trends.append({
            "week": week_start.strftime("%m/%d"),
            "claims": int(w_count),
            "billed": round(float(w_billed), 2),
            "paid": round(float(w_paid), 2),
        })

    # ── Payer performance (days to pay, denial rate) ─────────────────────────
    payer_perf_rows = await db.execute(
        select(
            Payer.id, Payer.name,
            func.count(Claim.id).label("total"),
            func.sum(
                case((Claim.status == ClaimStatus.DENIED, 1), else_=0)
            ).label("denied"),
            func.coalesce(func.sum(Claim.total_paid), 0.0).label("paid"),
            func.coalesce(func.sum(Claim.total_billed), 0.0).label("billed"),
        )
        .join(Claim, Payer.id == Claim.payer_id)
        .group_by(Payer.id, Payer.name)
        .having(func.count(Claim.id) > 0)
        .limit(10)
    )
    payer_performance = []
    for row in payer_perf_rows.fetchall():
        pid, pname, total, denied, paid, billed = row
        denial_rate = round((denied or 0) / total * 100, 1) if total > 0 else 0.0
        coll_rate = round(float(paid) / float(billed) * 100, 1) if float(billed) > 0 else 0.0
        payer_performance.append({
            "payer_id": pid,
            "payer_name": pname,
            "total_claims": total,
            "denial_rate": denial_rate,
            "collection_rate": coll_rate,
        })

    return {
        "total_claims": total_claims,
        "claims_by_status": claims_by_status,
        "total_billed_mtd": float(billed_mtd),
        "total_paid_mtd": float(paid_mtd),
        "collection_rate": round(collection_rate, 1),
        "pending_appeals": pending_appeals,
        "top_denial_reasons": top_denials,
        "recent_claims": recent_claims,
        "submitted_today": submitted_today,
        "attention_claims": attention_claims,
        "weekly_trends": weekly_trends,
        "payer_performance": payer_performance,
    }


@router.get("/reports")
async def get_reports(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Reporting data: claims by payer, revenue by month, denial rates, aging, avg days."""
    today = date.today()

    # ── Claims by payer ─────────────────────────────────────────────────────
    payer_rows = await db.execute(
        select(
            Payer.name,
            func.count(Claim.id).label("count"),
            func.coalesce(func.sum(Claim.total_billed), 0.0).label("billed"),
            func.coalesce(func.sum(Claim.total_paid), 0.0).label("paid"),
        )
        .join(Payer, Claim.payer_id == Payer.id)
        .group_by(Payer.id, Payer.name)
        .order_by(func.count(Claim.id).desc())
    )
    claims_by_payer = [
        {"payer": r[0], "claims": r[1], "billed": round(float(r[2]), 2), "paid": round(float(r[3]), 2)}
        for r in payer_rows.fetchall()
    ]

    # ── Revenue by month ────────────────────────────────────────────────────
    rev_rows = await db.execute(
        select(
            func.strftime("%Y-%m", Claim.service_date_from).label("month"),
            func.coalesce(func.sum(Claim.total_billed), 0.0).label("billed"),
            func.coalesce(func.sum(Claim.total_paid), 0.0).label("paid"),
            func.count(Claim.id).label("count"),
        )
        .where(Claim.status != ClaimStatus.VOID)
        .where(Claim.service_date_from != None)  # noqa: E711
        .group_by(func.strftime("%Y-%m", Claim.service_date_from))
        .order_by(func.strftime("%Y-%m", Claim.service_date_from).desc())
        .limit(12)
    )
    revenue_by_month = [
        {"month": r[0], "billed": round(float(r[1]), 2), "paid": round(float(r[2]), 2), "count": r[3]}
        for r in rev_rows.fetchall()
    ]
    revenue_by_month.reverse()

    # ── Denial rate by payer ────────────────────────────────────────────────
    total_rows = await db.execute(
        select(Payer.id, Payer.name, func.count(Claim.id).label("total"))
        .join(Payer, Claim.payer_id == Payer.id)
        .group_by(Payer.id, Payer.name)
    )
    total_map = {r[0]: (r[1], r[2]) for r in total_rows.fetchall()}  # payer_id -> (name, total)

    denied_rows = await db.execute(
        select(Payer.id, func.count(Claim.id).label("denied"))
        .join(Payer, Claim.payer_id == Payer.id)
        .where(Claim.status == ClaimStatus.DENIED)
        .group_by(Payer.id)
    )
    denied_map = {r[0]: r[1] for r in denied_rows.fetchall()}

    denial_rate_by_payer = []
    for payer_id, (payer_name, total) in total_map.items():
        denied = denied_map.get(payer_id, 0)
        denial_rate_by_payer.append({
            "payer": payer_name,
            "denied": denied,
            "total": total,
            "rate": round(denied / total * 100, 1) if total > 0 else 0.0,
        })
    denial_rate_by_payer.sort(key=lambda x: x["rate"], reverse=True)

    # ── Aging report ────────────────────────────────────────────────────────
    aging_buckets = {"0_30": (0, 0.0), "31_60": (0, 0.0), "61_90": (0, 0.0),
                     "91_120": (0, 0.0), "over_120": (0, 0.0)}

    unpaid_rows = await db.execute(
        select(Claim.service_date_from, (Claim.total_billed - Claim.total_paid).label("balance"))
        .where(Claim.status.in_([
            ClaimStatus.SUBMITTED, ClaimStatus.ACCEPTED, ClaimStatus.REJECTED,
            ClaimStatus.DENIED, ClaimStatus.DRAFT, ClaimStatus.READY
        ]))
        .where(Claim.service_date_from != None)  # noqa: E711
    )
    for svc_date, balance in unpaid_rows.fetchall():
        if isinstance(svc_date, str):
            svc_date = datetime.strptime(svc_date, "%Y-%m-%d").date()
        bal = float(balance) if balance else 0.0
        days = (today - svc_date).days
        if days <= 30:
            k = "0_30"
        elif days <= 60:
            k = "31_60"
        elif days <= 90:
            k = "61_90"
        elif days <= 120:
            k = "91_120"
        else:
            k = "over_120"
        c, a = aging_buckets[k]
        aging_buckets[k] = (c + 1, a + bal)

    aging = [
        {"bucket": "0-30",   "count": aging_buckets["0_30"][0],    "amount": round(aging_buckets["0_30"][1], 2)},
        {"bucket": "31-60",  "count": aging_buckets["31_60"][0],   "amount": round(aging_buckets["31_60"][1], 2)},
        {"bucket": "61-90",  "count": aging_buckets["61_90"][0],   "amount": round(aging_buckets["61_90"][1], 2)},
        {"bucket": "91-120", "count": aging_buckets["91_120"][0],  "amount": round(aging_buckets["91_120"][1], 2)},
        {"bucket": "120+",   "count": aging_buckets["over_120"][0],"amount": round(aging_buckets["over_120"][1], 2)},
    ]

    # ── Average days to payment ─────────────────────────────────────────────
    paid_rows = await db.execute(
        select(Claim.service_date_from, Claim.updated_at)
        .where(Claim.status == ClaimStatus.PAID)
        .where(Claim.service_date_from != None)  # noqa: E711
        .limit(200)
    )
    days_list = []
    for svc_date, updated_at in paid_rows.fetchall():
        if svc_date and updated_at:
            if isinstance(svc_date, str):
                svc_date = datetime.strptime(svc_date, "%Y-%m-%d").date()
            paid_date = updated_at.date() if hasattr(updated_at, "date") else updated_at
            days_list.append((paid_date - svc_date).days)

    avg_days = round(sum(days_list) / len(days_list), 1) if days_list else 0.0

    return {
        "claims_by_payer":       claims_by_payer,
        "revenue_by_month":      revenue_by_month,
        "denial_rate_by_payer":  denial_rate_by_payer,
        "aging":                 aging,
        "avg_days_to_payment":   avg_days,
    }
