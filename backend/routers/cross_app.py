"""
Cross-app relay router for AngelClaims.

Polls the sync-server relay at /api/cross-app/* for messages from AngelWink,
and sends messages to AngelWink (DX approval requests, etc.).

Message types:
  claim_request        — AngelWink → AngelClaims  (invoice to import as DRAFT claim)
  dx_approval_request  — AngelClaims → AngelWink  (ask doctor to approve DX codes)
  dx_approval_response — AngelWink → AngelClaims  (doctor's answer)
"""
import json
import logging
from typing import Optional, List
from datetime import datetime

import httpx
from fastapi import APIRouter, Depends, BackgroundTasks, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, text
from pydantic import BaseModel

from database import get_db
from models import ApprovalRequest, Claim, Patient
from auth import get_current_user
from models import User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/cross-app", tags=["cross_app"])

# ── Sync-server helpers ──────────────────────────────────────────────────────

def _get_sync_server_url() -> str:
    import os
    return os.environ.get("SYNC_SERVER_URL", "http://159.65.235.231:3100")


def _get_device_token() -> Optional[str]:
    """Get a valid device token from the local sync DB."""
    import psycopg2
    import os
    dsn = os.environ.get("SYNC_DB_DSN") or os.environ.get("DATABASE_URL")
    if not dsn:
        # Try reading from angelwink_docs pattern
        try:
            from routers.angelwink_docs import _get_device_token as _aw_token
            return _aw_token()
        except Exception:
            return None
    try:
        conn = psycopg2.connect(dsn)
        cur = conn.cursor()
        cur.execute(
            "SELECT device_token FROM devices "
            "WHERE (revoked IS NULL OR revoked = false) "
            "AND token_expires_at > NOW() LIMIT 1"
        )
        row = cur.fetchone()
        cur.close()
        conn.close()
        return row[0] if row else None
    except Exception as e:
        logger.warning("[cross_app] Could not get device token: %s", e)
        return None


async def _relay_get(path: str) -> Optional[list]:
    """GET from the sync-server relay."""
    base = _get_sync_server_url()
    token = _get_device_token()
    headers = {"X-Device-Token": token} if token else {}
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(f"{base}{path}", headers=headers)
            if not resp.is_success:
                logger.warning("[cross_app] relay GET %s -> %s", path, resp.status_code)
                return None
            data = resp.json()
            return data if isinstance(data, list) else data.get("messages", [])
    except Exception as e:
        logger.warning("[cross_app] relay GET error: %s", e)
        return None


async def _relay_post(path: str, body: dict) -> bool:
    """POST to the sync-server relay."""
    base = _get_sync_server_url()
    token = _get_device_token()
    headers = {"Content-Type": "application/json"}
    if token:
        headers["X-Device-Token"] = token
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(f"{base}{path}", json=body, headers=headers)
            return resp.is_success
    except Exception as e:
        logger.warning("[cross_app] relay POST error: %s", e)
        return False


async def _ack_message(msg_id: int) -> None:
    await _relay_post(f"/api/cross-app/{msg_id}/ack", {})


# ── Models ────────────────────────────────────────────────────────────────────

class DxApprovalRequestBody(BaseModel):
    claim_id: int
    patient_id: Optional[int] = None
    patient_name: Optional[str] = None
    suggested_codes: List[str] = []
    details: Optional[str] = None
    provider_id: Optional[int] = None


class PollResult(BaseModel):
    processed: int
    errors: List[str]


# ── Incoming claim_request processing ────────────────────────────────────────

async def _process_claim_request(payload: dict, db: AsyncSession) -> Optional[int]:
    """
    Convert a claim_request relay message from AngelWink into a DRAFT claim.

    New simplified flow: payload only needs {invoice_number, patient_id, clinic_id}.
    Delegates to _import_single_invoice (same code path as batch import) so that
    relay-created claims are identical to manually imported ones.
    """
    try:
        # Extract the minimal fields from the simplified relay payload
        invoice_number = payload.get("invoice_number") or payload.get("invoice_id")
        if not invoice_number:
            logger.warning("[cross_app] claim_request missing invoice_number — skipping")
            return None

        # invoice_number is the numeric invoice ID on the sync server
        try:
            invoice_id = int(invoice_number)
        except (ValueError, TypeError):
            logger.warning("[cross_app] claim_request invoice_number not numeric: %s", invoice_number)
            return None

        clinic_id = str(payload.get("clinic_id") or "")

        # Get provider_id and default_payer_id from org settings
        provider_id = 1
        default_payer_id = 1
        try:
            from models import ProviderSettings
            ps_res = await db.execute(
                select(ProviderSettings).where(ProviderSettings.angelwink_pairing_key.isnot(None)).limit(1)
            )
            ps = ps_res.scalar_one_or_none()
            if ps:
                provider_id = ps.provider_id or 1
                if not clinic_id and ps.angelwink_clinic_id:
                    clinic_id = ps.angelwink_clinic_id
        except Exception as e:
            logger.warning("[cross_app] Could not read ProviderSettings: %s", e)

        if not clinic_id:
            # Fall back to env var
            import os
            clinic_id = os.environ.get("ANGELWINK_CLINIC_ID", "")

        if not clinic_id:
            logger.warning("[cross_app] No clinic_id available for claim_request (invoice %s)", invoice_id)
            return None

        # Use the existing import infrastructure — same logic as batch import
        from routers.imports import _import_single_invoice
        claim_id = await _import_single_invoice(
            invoice_id=invoice_id,
            clinic_id=clinic_id,
            provider_id=provider_id,
            default_payer_id=default_payer_id,
            db=db,
        )

        if claim_id:
            logger.info("[cross_app] Imported invoice %s as claim_id=%s (clinic=%s)",
                        invoice_id, claim_id, clinic_id)
        else:
            logger.info("[cross_app] Invoice %s already imported or not found", invoice_id)

        return claim_id

    except Exception as e:
        await db.rollback()
        logger.error("[cross_app] _process_claim_request error: %s", e, exc_info=True)
        return None


async def _process_dx_approval_response(payload: dict, db: AsyncSession) -> None:
    """
    Handle a dx_approval_response from AngelWink:
    - Update approval_request status
    - Apply approved DX codes to the claim
    - Create a notification for Ruth (as a DB record in audit_logs or similar)
    """
    try:
        approval_id = payload.get("approval_id")
        status = payload.get("status")  # 'approved' or 'rejected'
        reviewed_by = payload.get("reviewed_by", "Doctor")
        approved_codes: List[str] = payload.get("approved_codes") or []

        if not approval_id or not status:
            return

        approval_res = await db.execute(
            select(ApprovalRequest).where(ApprovalRequest.id == approval_id)
        )
        approval = approval_res.scalar_one_or_none()
        if not approval:
            logger.warning("[cross_app] dx_approval_response: approval %s not found", approval_id)
            return

        # Update status
        approval.status = status
        approval.reviewed_by = reviewed_by
        approval.reviewed_at = datetime.utcnow()

        if status == "approved" and approved_codes:
            # Apply approved DX codes to the claim
            claim_res = await db.execute(
                select(Claim).where(Claim.id == approval.claim_id)
            )
            claim = claim_res.scalar_one_or_none()
            if claim:
                existing_dx = list(claim.diagnosis_codes or [])
                merged = list(dict.fromkeys(existing_dx + approved_codes))  # deduplicate, preserve order
                claim.diagnosis_codes = merged

        await db.commit()

        # Log a notification for Ruth via audit_log (visible in dashboard)
        patient_name = f"Patient #{approval.patient_id}" if approval.patient_id else "unknown patient"
        codes_str = ", ".join(approved_codes) if approved_codes else "no codes"

        if status == "approved":
            msg = f"Dr. {reviewed_by} approved {codes_str} for {patient_name} — you can now submit this claim."
        else:
            msg = f"Dr. {reviewed_by} rejected DX approval for {patient_name}."

        await db.execute(
            text(
                "INSERT INTO audit_logs (entity_type, entity_id, action, performed_by, details, created_at) "
                "VALUES ('approval_response', :eid, :action, 'system', :details, NOW())"
            ),
            {
                "eid": approval_id,
                "action": f"dx_{status}",
                "details": msg,
            },
        )
        await db.commit()
        logger.info("[cross_app] Processed dx_approval_response for approval %s: %s", approval_id, status)

    except Exception as e:
        await db.rollback()
        logger.error("[cross_app] _process_dx_approval_response error: %s", e, exc_info=True)


# ── Background poller ─────────────────────────────────────────────────────────

async def _run_poll(db: AsyncSession) -> PollResult:
    """Poll the relay and process all pending messages for AngelClaims."""
    messages = await _relay_get("/api/cross-app/pending?target_app=angelclaims")
    if messages is None:
        return PollResult(processed=0, errors=["Relay unreachable"])

    processed = 0
    errors: List[str] = []

    for msg in messages:
        msg_id = msg.get("id")
        msg_type = msg.get("message_type")
        payload = msg.get("payload", {})

        try:
            if msg_type == "claim_request":
                claim_id = await _process_claim_request(payload, db)
                if claim_id:
                    processed += 1
                else:
                    errors.append(f"msg {msg_id}: claim_request processing returned None")

            elif msg_type == "dx_approval_response":
                await _process_dx_approval_response(payload, db)
                processed += 1

            else:
                logger.info("[cross_app] Unknown message type '%s' — acking and ignoring", msg_type)
                processed += 1

            # Acknowledge the message so the relay doesn't re-deliver
            if msg_id:
                await _ack_message(msg_id)

        except Exception as e:
            err_msg = f"msg {msg_id} ({msg_type}): {e}"
            logger.error("[cross_app] Error processing: %s", err_msg, exc_info=True)
            errors.append(err_msg)

    return PollResult(processed=processed, errors=errors)


# ── Routes ────────────────────────────────────────────────────────────────────

@router.post("/poll", response_model=PollResult)
async def poll_cross_app_messages(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """
    Manually trigger a poll of the sync-server relay for pending cross-app messages.
    Processes claim_request and dx_approval_response messages.
    """
    return await _run_poll(db)


@router.post("/send-dx-approval", status_code=202)
async def send_dx_approval_request(
    body: DxApprovalRequestBody,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """
    Send a dx_approval_request to AngelWink via the sync-server relay.
    Ruth calls this when she identifies missing DX codes on a claim.
    """
    # Persist locally first
    approval = ApprovalRequest(
        claim_id=body.claim_id,
        patient_id=body.patient_id,
        request_type="dx_change",
        details=body.details,
        suggested_codes=body.suggested_codes,
        status="pending",
    )
    db.add(approval)
    await db.commit()
    await db.refresh(approval)

    # Resolve patient name for display in AngelWink
    patient_name = body.patient_name
    if not patient_name and body.patient_id:
        pat_res = await db.execute(
            select(Patient).where(Patient.id == body.patient_id)
        )
        pat = pat_res.scalar_one_or_none()
        if pat:
            patient_name = f"{pat.first_name} {pat.last_name}".strip()

    relay_payload = {
        "approval_id": approval.id,
        "patient_id": body.patient_id,
        "patient_name": patient_name,
        "suggested_codes": body.suggested_codes,
        "details": body.details,
        "provider_id": body.provider_id,
    }

    sent = await _relay_post("/api/cross-app/send", {
        "message_type": "dx_approval_request",
        "target_app": "angelwink",
        "payload": relay_payload,
    })

    return {
        "approval_id": approval.id,
        "relay_sent": sent,
        "message": "DX approval request queued" + ("" if sent else " (relay offline — will retry on next poll)"),
    }


@router.get("/status")
async def cross_app_status(_: User = Depends(get_current_user)):
    """Check relay connectivity and device token availability."""
    token = _get_device_token()
    base = _get_sync_server_url()
    reachable = False
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            r = await client.get(f"{base}/health")
            reachable = r.is_success
    except Exception:
        pass
    return {
        "relay_url": base,
        "relay_reachable": reachable,
        "device_token_available": bool(token),
    }


# ── Background Relay Polling ──────────────────────────────────────────────────

async def poll_relay_background():
    """Background task that polls the sync server relay every 30 seconds for new messages.
    Uses a proper DB session and the canonical _run_poll function — no duplicate logic.
    """
    import asyncio
    from database import AsyncSessionLocal

    logger.info("[cross_app] Background relay polling started (every 30s)")
    while True:
        try:
            await asyncio.sleep(30)
            token = _get_device_token()
            if not token:
                continue

            async with AsyncSessionLocal() as db:
                result = await _run_poll(db)
                if result.processed > 0 or result.errors:
                    logger.info("[cross_app] Background poll: processed=%d errors=%d",
                              result.processed, len(result.errors))

        except asyncio.CancelledError:
            logger.info("[cross_app] Background polling stopped")
            break
        except Exception as e:
            logger.warning("[cross_app] Background poll error: %s", e)
            await asyncio.sleep(10)
