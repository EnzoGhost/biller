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
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                "http://159.65.235.231:3100/api/sync/approval-bridge",
                json={
                    "clinic_id": WINK_CLINIC_ID,
                        "patient_id": str(approval.patient_id) if approval.patient_id else None,
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
    return approval
