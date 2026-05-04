"""
Approval Requests — Bridge between SometeoPR (biller) and Wink (clinic desktop).
Stores approval requests locally and optionally forwards to sync server.
"""
from datetime import datetime
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel

from database import get_db
from models import ApprovalRequest, Claim
from auth import get_current_user
from models import User


router = APIRouter(prefix="/approvals", tags=["approvals"])


class ApprovalCreate(BaseModel):
    claim_id: int
    patient_id: Optional[int] = None
    request_type: str  # dx_change, code_suggestion, fix_pointer
    requested_by: Optional[str] = None
    details: Optional[str] = None
    suggested_codes: Optional[list] = None
    current_code: Optional[str] = None


class ApprovalUpdate(BaseModel):
    status: str  # approved, rejected
    reviewed_by: Optional[str] = None


class ApprovalOut(BaseModel):
    id: int
    claim_id: int
    patient_id: Optional[int]
    request_type: str
    requested_by: Optional[str]
    details: Optional[str]
    suggested_codes: Optional[list]
    current_code: Optional[str]
    status: str
    reviewed_by: Optional[str]
    reviewed_at: Optional[datetime]
    created_at: datetime

    class Config:
        from_attributes = True


@router.get("/claims/{claim_id}", response_model=List[ApprovalOut])
async def list_approvals(
    claim_id: int,
    status: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    query = select(ApprovalRequest).where(ApprovalRequest.claim_id == claim_id)
    if status:
        query = query.where(ApprovalRequest.status == status)
    query = query.order_by(ApprovalRequest.created_at.desc())
    result = await db.execute(query)
    return result.scalars().all()


@router.post("/", response_model=ApprovalOut)
async def create_approval(
    body: ApprovalCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    # Verify claim exists
    claim = await db.get(Claim, body.claim_id)
    if not claim:
        raise HTTPException(status_code=404, detail="Claim not found")

    approval = ApprovalRequest(
        claim_id=body.claim_id,
        patient_id=body.patient_id or claim.patient_id,
        request_type=body.request_type,
        requested_by=body.requested_by or user.email,
        details=body.details,
        suggested_codes=body.suggested_codes,
        current_code=body.current_code,
        status="pending",
    )
    db.add(approval)
    await db.commit()
    await db.refresh(approval)

    # Forward to Wink sync server so the doctor gets notified
    import httpx
    try:
        WINK_CLINIC_ID = "1a905d29-0a9a-42b3-8bc3-83c0ceb9acba"
        # Get patient name + wink_patient_id for Wink-side display
        patient_name = None
        wink_patient_id = None
        if claim.patient_id:
            from sqlalchemy import select as sa_select
            from models import Patient
            p_result = await db.execute(sa_select(Patient).where(Patient.id == claim.patient_id))
            patient = p_result.scalar_one_or_none()
            if patient:
                patient_name = f"{patient.first_name} {patient.last_name}"
                wink_patient_id = patient.wink_patient_id
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                "http://159.65.235.231:3100/api/sync/approval-bridge",
                json={
                    "clinic_id": WINK_CLINIC_ID,
                        "patient_id": wink_patient_id or str(approval.patient_id) if approval.patient_id else None,
                        "patient_name": patient_name,
                        "claim_id": approval.claim_id,
                        "request_type": approval.request_type,
                        "requested_by": approval.requested_by,
                        "details": approval.details,
                        "suggested_codes": approval.suggested_codes,
                        "current_code": approval.current_code,
                    }
                )
            if resp.status_code == 200:
                print(f"[approvals] Forwarded to Wink sync server")
            else:
                print(f"[approvals] Sync server returned {resp.status_code}: {resp.text}")
    except Exception as e:
        print(f"[approvals] Failed to forward to sync server: {e}")

    return approval


WINK_SYNC_SERVER = "http://159.65.235.231:3100"


@router.get("/sync-status/{claim_id}")
async def check_approval_sync_status(
    claim_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Check if any approvals for this claim were responded to on the sync server."""
    import httpx
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                f"{WINK_SYNC_SERVER}/api/sync/approval-bridge/status",
                params={"claim_id": claim_id},
            )
            if resp.status_code == 200:
                data = resp.json()
                approvals = data.get("approvals", [])
                updated = False
                for a in approvals:
                    if a.get("status") in ("approved", "rejected"):
                        # Find matching local pending approvals
                        result = await db.execute(
                            select(ApprovalRequest).where(
                                ApprovalRequest.claim_id == claim_id,
                                ApprovalRequest.status == "pending",
                            )
                        )
                        for local_a in result.scalars().all():
                            if local_a.request_type == a.get("request_type"):
                                local_a.status = a["status"]
                                local_a.reviewed_by = a.get("reviewed_by")
                                local_a.reviewed_at = datetime.utcnow()
                                updated = True
                if updated:
                    await db.commit()
                return {"synced": True, "updated": updated, "approvals": approvals}
    except Exception as e:
        print(f"[approvals] sync status check failed: {e}")
    return {"synced": False, "updated": False, "approvals": []}


@router.get("/recent", response_model=List[ApprovalOut])
async def recent_approvals(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Return recent non-pending approval requests for the notification bell."""
    query = (
        select(ApprovalRequest)
        .where(ApprovalRequest.status != "pending")
        .order_by(ApprovalRequest.reviewed_at.desc())
        .limit(20)
    )
    result = await db.execute(query)
    return result.scalars().all()


@router.patch("/{approval_id}", response_model=ApprovalOut)
async def update_approval(
    approval_id: int,
    body: ApprovalUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    approval = await db.get(ApprovalRequest, approval_id)
    if not approval:
        raise HTTPException(status_code=404, detail="Approval not found")

    if body.status not in ("approved", "rejected"):
        raise HTTPException(status_code=400, detail="Status must be approved or rejected")

    approval.status = body.status
    approval.reviewed_by = body.reviewed_by or user.email
    approval.reviewed_at = datetime.utcnow()

    await db.commit()
    await db.refresh(approval)

    # ── Auto-scrub + auto-sort on approval ────────────────────────────────
    if body.status == "approved" and approval.suggested_codes:
        try:
            from sqlalchemy.orm import selectinload
            from models import Patient, ServiceLine, Payer

            # Load the claim with relationships
            claim_result = await db.execute(
                select(Claim)
                .options(
                    selectinload(Claim.patient).selectinload(Patient.insurances),
                    selectinload(Claim.provider),
                    selectinload(Claim.payer),
                    selectinload(Claim.service_lines),
                )
                .where(Claim.id == approval.claim_id)
            )
            claim = claim_result.scalar_one_or_none()

            if claim:
                # 1. Apply suggested codes to diagnosis_codes
                current_codes = list(claim.diagnosis_codes or [])
                changed = False

                # If current_code is set, replace it; otherwise add
                if approval.current_code and approval.current_code in current_codes:
                    idx = current_codes.index(approval.current_code)
                    for i, new_code in enumerate(approval.suggested_codes):
                        if i == 0:
                            current_codes[idx] = new_code
                        elif new_code not in current_codes:
                            current_codes.append(new_code)
                    changed = True
                else:
                    for code in approval.suggested_codes:
                        if code not in current_codes:
                            current_codes.append(code)
                            changed = True

                if changed:
                    claim.diagnosis_codes = current_codes
                    await db.commit()

                # 2. Check if any remaining pending approvals for this claim
                pending_result = await db.execute(
                    select(ApprovalRequest).where(
                        ApprovalRequest.claim_id == approval.claim_id,
                        ApprovalRequest.status == "pending",
                    )
                )
                pending = pending_result.scalars().all()

                if not pending:
                    # 3. Re-run scrub
                    from routers.ai import _scrub_patient, _scrub_provider, _scrub_payer, _scrub_claim_level, _scrub_service_lines
                    from models import ClaimStatus

                    issues: list[dict] = []
                    _scrub_patient(claim, issues)
                    _scrub_provider(claim, issues)
                    _scrub_payer(claim, issues)
                    _scrub_claim_level(claim, issues)
                    _scrub_service_lines(claim, issues)

                    errors = [i for i in issues if i["type"] == "error"]
                    warnings = [i for i in issues if i["type"] == "warning"]
                    score = max(0.0, 100.0 - len(errors) * 25.0 - len(warnings) * 5.0)

                    claim.scrub_score = score
                    claim.scrub_issues = issues

                    # 4. If scrub passes (no errors, no warnings), auto-advance to READY
                    if not errors and not warnings:
                        if claim.status in (ClaimStatus.DRAFT, "draft"):
                            claim.status = ClaimStatus.READY
                            from routers.audit import log_action
                            await log_action(
                                db, "claim", approval.claim_id, "auto_approval_ready",
                                claim_id=approval.claim_id,
                                old_value="draft", new_value="ready",
                                notes=f"Auto-advanced after approval #{approval_id}: scrub score {score}",
                            )

                    await db.commit()
        except Exception as e:
            print(f"[approvals] Auto-scrub after approval failed: {e}")
            import traceback
            traceback.print_exc()

    return approval
