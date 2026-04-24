"""
Audit Trail router — query and write audit log entries.
"""
from datetime import datetime
from typing import Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from database import get_db
from models import AuditLog, User
from auth import get_current_user

router = APIRouter(prefix="/audit", tags=["audit"])


async def log_action(
    db: AsyncSession,
    entity_type: str,
    entity_id: int,
    action: str,
    claim_id: Optional[int] = None,
    old_value: Optional[str] = None,
    new_value: Optional[str] = None,
    user: Optional[User] = None,
    notes: Optional[str] = None,
) -> AuditLog:
    """Helper to create an audit log entry. Call this from other routers."""
    entry = AuditLog(
        entity_type=entity_type,
        entity_id=entity_id,
        claim_id=claim_id,
        action=action,
        old_value=old_value,
        new_value=new_value,
        user_id=user.id if user else None,
        user_email=user.email if user else None,
        notes=notes,
        created_at=datetime.utcnow(),
    )
    db.add(entry)
    return entry


@router.get("/claims/{claim_id}")
async def get_claim_audit_log(
    claim_id: int,
    limit: int = Query(50, le=200),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Get all audit log entries for a claim, newest first."""
    result = await db.execute(
        select(AuditLog)
        .where(AuditLog.claim_id == claim_id)
        .order_by(AuditLog.created_at.desc())
        .limit(limit)
    )
    entries = result.scalars().all()
    return [
        {
            "id": e.id,
            "entity_type": e.entity_type,
            "entity_id": e.entity_id,
            "action": e.action,
            "old_value": e.old_value,
            "new_value": e.new_value,
            "user_email": e.user_email,
            "notes": e.notes,
            "created_at": e.created_at.isoformat(),
        }
        for e in entries
    ]


@router.get("/recent")
async def get_recent_audit_logs(
    limit: int = Query(25, le=100),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Get recent audit log entries across all entities."""
    result = await db.execute(
        select(AuditLog)
        .order_by(AuditLog.created_at.desc())
        .limit(limit)
    )
    entries = result.scalars().all()
    return [
        {
            "id": e.id,
            "entity_type": e.entity_type,
            "entity_id": e.entity_id,
            "claim_id": e.claim_id,
            "action": e.action,
            "old_value": e.old_value,
            "new_value": e.new_value,
            "user_email": e.user_email,
            "notes": e.notes,
            "created_at": e.created_at.isoformat(),
        }
        for e in entries
    ]
