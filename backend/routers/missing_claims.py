"""
Missing Claims Detector — find patients with insurance who had services
but no corresponding claim was submitted in the given date range.
"""
from datetime import date, datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, not_, exists
from sqlalchemy.orm import selectinload

from database import get_db
from models import (
    Claim, ClaimStatus, Patient, PatientInsurance, Payer, ServiceLine,
)
from auth import get_current_user
from models import User

router = APIRouter(prefix="/missing-claims", tags=["missing-claims"])

# ── Lost Revenue Audit ─────────────────────────────────────────────────────────

WINK_PG_DSN = "dbname=wink_sync user=wink password=wink_sync_2026! host=localhost port=5432"


async def _pg_query(query: str, params: tuple = ()):
    """Run a blocking psycopg2 query in a thread executor."""
    import asyncio
    import psycopg2
    import psycopg2.extras

    loop = asyncio.get_event_loop()

    def _run():
        conn = psycopg2.connect(WINK_PG_DSN)
        conn.set_client_encoding('UTF8')
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(query, params)
        rows = cur.fetchall()
        cur.close()
        conn.close()
        return rows

    return await loop.run_in_executor(None, _run)


class LostRevenueAuditRequest(BaseModel):
    date_from: str  # ISO YYYY-MM-DD
    date_to: str    # ISO YYYY-MM-DD


class LostRevenueEntry(BaseModel):
    invoice_number: Optional[str]
    date: Optional[str]
    patient_id: Optional[str]
    patient_name: str
    plan_amount: float
    total: float
    attended_by: Optional[str]
    payer: Optional[str]


class LostRevenueAuditResponse(BaseModel):
    date_from: str
    date_to: str
    flagged_count: int
    total_lost: float
    flagged: list[LostRevenueEntry]


@router.post("/audit/lost-revenue", response_model=LostRevenueAuditResponse)
async def audit_lost_revenue(
    req: LostRevenueAuditRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """
    Find invoices where insurance was supposed to pay (plan/insurance_adjustment > 0)
    but no CPT codes were entered, meaning the claim was likely never submitted.
    Queries the AngelWink sync server PostgreSQL directly.
    """
    from sqlalchemy import text as sa_text
    import os

    # Resolve clinic_id from DB setting, then env var
    clinic_id: Optional[str] = None
    try:
        _row = (await db.execute(sa_text("SELECT angelwink_clinic_id FROM clinic_settings WHERE id = 1"))).fetchone()
        clinic_id = _row[0] if _row and _row[0] else None
    except Exception:
        pass
    if not clinic_id:
        clinic_id = os.environ.get("ANGELWINK_CLINIC_ID", "")
    if not clinic_id:
        raise HTTPException(status_code=400, detail="No clinic paired. Go to Settings → Connections and connect AngelWink first.")

    date_from = req.date_from
    date_to = req.date_to

    # 1. Get invoices with insurance_adjustment > 0 in the date range
    invoices = await _pg_query("""
        SELECT DISTINCT ON (row_id) data
        FROM sync_changes
        WHERE clinic_id = %s AND table_name = 'invoices'
          AND operation != 'DELETE' AND data IS NOT NULL
          AND data->>'date' >= %s AND data->>'date' <= %s
          AND (data->>'insurance_adjustment') IS NOT NULL
          AND (data->>'insurance_adjustment') != ''
          AND (data->>'insurance_adjustment')::float > 0
        ORDER BY row_id, timestamp DESC
    """, (clinic_id, date_from, date_to))

    if not invoices:
        return LostRevenueAuditResponse(
            date_from=date_from,
            date_to=date_to,
            flagged_count=0,
            total_lost=0.0,
            flagged=[],
        )

    # 2. For each invoice, check if it has any CPT codes in invoice_items
    invoice_ids = [str(row["data"].get("id", "")) for row in invoices if row["data"].get("id")]

    # Batch-fetch invoice items with CPT codes for all invoice IDs
    cpt_invoice_ids: set[str] = set()
    if invoice_ids:
        items_with_cpt = await _pg_query("""
            SELECT DISTINCT ON (row_id) data->>'invoice_id' AS invoice_id
            FROM sync_changes
            WHERE clinic_id = %s AND table_name = 'invoice_items'
              AND operation != 'DELETE' AND data IS NOT NULL
              AND data->>'invoice_id' = ANY(%s)
              AND data->>'cpt_code' IS NOT NULL
              AND data->>'cpt_code' != ''
            ORDER BY row_id, timestamp DESC
        """, (clinic_id, invoice_ids))
        cpt_invoice_ids = {str(row["invoice_id"]) for row in items_with_cpt if row.get("invoice_id")}

    # 3. Collect patient IDs we need to resolve names for
    flagged_invoices = []
    for row in invoices:
        inv = row["data"]
        inv_id = str(inv.get("id", ""))
        if inv_id in cpt_invoice_ids:
            continue  # Has CPT codes → was submitted, skip
        plan_amount = float(inv.get("insurance_adjustment") or 0)
        if plan_amount <= 0:
            continue
        flagged_invoices.append(inv)

    if not flagged_invoices:
        return LostRevenueAuditResponse(
            date_from=date_from,
            date_to=date_to,
            flagged_count=0,
            total_lost=0.0,
            flagged=[],
        )

    # 4. Batch-fetch patient names
    patient_ids = list({str(inv.get("patient_id", "")) for inv in flagged_invoices if inv.get("patient_id")})
    patients_rows = await _pg_query("""
        SELECT DISTINCT ON (row_id)
            data->>'id' AS id,
            data->>'first_name' AS first_name,
            data->>'last_name' AS last_name,
            data->>'last_name_2' AS last_name_2
        FROM sync_changes
        WHERE clinic_id = %s AND table_name = 'patients'
          AND operation != 'DELETE' AND data IS NOT NULL
          AND data->>'id' = ANY(%s)
        ORDER BY row_id, timestamp DESC
    """, (clinic_id, patient_ids))

    patient_map: dict[str, str] = {}
    for p in patients_rows:
        pid = str(p.get("id", ""))
        name = " ".join(filter(None, [p.get("first_name"), p.get("last_name"), p.get("last_name_2")])).strip()
        patient_map[pid] = name or "Unknown"

    # 5. Build result
    flagged: list[LostRevenueEntry] = []
    total_lost = 0.0
    for inv in flagged_invoices:
        plan_amount = float(inv.get("insurance_adjustment") or 0)
        pid = str(inv.get("patient_id", ""))
        flagged.append(LostRevenueEntry(
            invoice_number=inv.get("invoice_number") or inv.get("id"),
            date=inv.get("date"),
            patient_id=pid,
            patient_name=patient_map.get(pid, "Unknown"),
            plan_amount=plan_amount,
            total=float(inv.get("total") or 0),
            attended_by=inv.get("attended_by") or "",
            payer=inv.get("insurance_plan") or inv.get("insurance_provider") or "",
        ))
        total_lost += plan_amount

    flagged.sort(key=lambda x: x.date or "", reverse=True)

    return LostRevenueAuditResponse(
        date_from=date_from,
        date_to=date_to,
        flagged_count=len(flagged),
        total_lost=round(total_lost, 2),
        flagged=flagged,
    )


class DetectRequest(BaseModel):
    date_from: str   # YYYY-MM-DD
    date_to: str     # YYYY-MM-DD


class InsuranceInfo(BaseModel):
    payer_name: str
    member_id: str
    is_primary: bool


class MissingClaimEntry(BaseModel):
    claim_id: int
    claim_number: str
    status: str
    patient_id: int
    patient_name: str
    service_date: str
    total_billed: float
    source: str
    insurance: list[InsuranceInfo]
    sale_items: Optional[list] = None


class DetectResponse(BaseModel):
    date_from: str
    date_to: str
    total_found: int
    entries: list[MissingClaimEntry]


@router.post("/detect", response_model=DetectResponse)
async def detect_missing_claims(
    req: DetectRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """
    Find claims that are in draft/ready status (not submitted or paid) in the
    date range for patients who have insurance on file.

    These represent potential missed billing opportunities — services were
    performed and imported but claims were never submitted to the payer.
    """
    try:
        from_date = date.fromisoformat(req.date_from)
        to_date = date.fromisoformat(req.date_to)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"Invalid date format: {e}")

    if from_date > to_date:
        raise HTTPException(status_code=400, detail="date_from must be <= date_to")

    # Find claims in the date range that are draft/ready and the patient has insurance
    q = (
        select(Claim)
        .options(
            selectinload(Claim.patient).selectinload(Patient.insurances).selectinload(PatientInsurance.payer),
            selectinload(Claim.service_lines),
        )
        .where(
            and_(
                Claim.service_date_from >= from_date,
                Claim.service_date_from <= to_date,
                Claim.status.in_([ClaimStatus.DRAFT, ClaimStatus.READY]),
            )
        )
        .order_by(Claim.service_date_from.desc())
    )

    result = await db.execute(q)
    claims = result.scalars().all()

    entries: list[MissingClaimEntry] = []
    for claim in claims:
        patient = claim.patient
        if not patient:
            continue

        # Only include patients with active insurance on file
        active_insurance = [
            ins for ins in (patient.insurances or [])
            if not ins.termination_date or ins.termination_date >= from_date
        ]
        if not active_insurance:
            continue

        insurance_info = [
            InsuranceInfo(
                payer_name=ins.payer.name if ins.payer else "Unknown",
                member_id=ins.member_id or "",
                is_primary=ins.is_primary,
            )
            for ins in active_insurance
        ]

        entries.append(
            MissingClaimEntry(
                claim_id=claim.id,
                claim_number=claim.claim_number,
                status=claim.status.value,
                patient_id=patient.id,
                patient_name=f"{patient.first_name} {patient.last_name}".strip(),
                service_date=claim.service_date_from.isoformat() if claim.service_date_from else "",
                total_billed=claim.total_billed or 0.0,
                source=claim.source or "manual",
                insurance=insurance_info,
                sale_items=claim.sale_items or [],
            )
        )

    return DetectResponse(
        date_from=req.date_from,
        date_to=req.date_to,
        total_found=len(entries),
        entries=entries,
    )
