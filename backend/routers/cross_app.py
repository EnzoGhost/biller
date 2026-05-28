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
from models import (
    ApprovalRequest, Claim, ClaimStatus, Patient, Provider,
    Payer, ServiceLine, PatientInsurance, Gender
)
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
    Convert a claim_request message from AngelWink into a DRAFT claim.
    Mirrors the logic from /api/import/wink/encounter.
    """
    import random, string as _string
    from datetime import date as _date

    try:
        # ── Patient ──────────────────────────────────────────────────────────
        patient_data = payload.get("patient", {})
        patient_id_wink = str(patient_data.get("id", ""))
        patient_name = patient_data.get("name", "")
        name_parts = patient_name.strip().split(" ", 2)
        first_name = name_parts[0] if len(name_parts) > 0 else "Unknown"
        last_name = name_parts[1] if len(name_parts) > 1 else "Unknown"

        patient = None
        if patient_id_wink:
            res = await db.execute(
                select(Patient).where(Patient.angelwink_patient_id == patient_id_wink)
            )
            patient = res.scalar_one_or_none()

        if not patient:
            patient = Patient(
                angelwink_patient_id=patient_id_wink or None,
                first_name=first_name,
                last_name=last_name,
                dob=_date(1970, 1, 1),
            )
            db.add(patient)
            await db.flush()

        # ── Service date ─────────────────────────────────────────────────────
        raw_date = payload.get("date", "")
        try:
            svc_date = _date.fromisoformat(raw_date[:10])
        except (ValueError, TypeError):
            svc_date = _date.today()

        # ── Provider (use first active) ───────────────────────────────────────
        prov_res = await db.execute(
            select(Provider).where(Provider.is_active == True).limit(1)
        )
        provider = prov_res.scalar_one_or_none()
        provider_id = provider.id if provider else 1

        # ── Payer ─────────────────────────────────────────────────────────────
        payer_id: Optional[int] = None
        ins_name = payload.get("insurance")
        if ins_name:
            payer_res = await db.execute(
                select(Payer).where(
                    Payer.name.ilike(f"%{ins_name}%"),
                    Payer.is_active == True,
                ).limit(1)
            )
            p = payer_res.scalar_one_or_none()
            if p:
                payer_id = p.id

        # ── Diagnoses ─────────────────────────────────────────────────────────
        dx_codes = payload.get("diagnosis_codes", [])
        if isinstance(dx_codes, str):
            try:
                dx_codes = json.loads(dx_codes)
            except Exception:
                dx_codes = []

        # ── Claim ─────────────────────────────────────────────────────────────
        ts = datetime.utcnow().strftime("%Y%m%d")
        suffix = "".join(random.choices(_string.ascii_uppercase + _string.digits, k=6))
        total_billed = float(payload.get("total", 0.0))

        external_ref = f"wink_inv_{payload.get('invoice_number', '')}" if payload.get("invoice_number") else None

        # Duplicate check
        if external_ref:
            dup_res = await db.execute(
                select(Claim).where(Claim.external_ref == external_ref)
            )
            dup = dup_res.scalar_one_or_none()
            if dup:
                logger.info("[cross_app] Duplicate claim_request for %s — skipping", external_ref)
                return dup.id

        claim = Claim(
            claim_number=f"CLM-{ts}-{suffix}",
            patient_id=patient.id,
            provider_id=provider_id,
            payer_id=payer_id or 1,
            service_date_from=svc_date,
            service_date_to=svc_date,
            diagnosis_codes=dx_codes,
            total_billed=total_billed,
            prior_auth_number=payload.get("prior_auth"),
            status=ClaimStatus.DRAFT,
            source="wink_relay",
            external_ref=external_ref,
        )
        db.add(claim)
        await db.flush()

        # ── Service lines ─────────────────────────────────────────────────────
        cpt_codes = payload.get("cpt_codes", [])
        for i, cpt in enumerate(cpt_codes):
            if not cpt.get("code"):
                continue
            mods = cpt.get("modifiers", [])
            sl = ServiceLine(
                claim_id=claim.id,
                cpt_code=cpt["code"],
                description=cpt.get("description"),
                units=1,
                amount=0.0,
                modifiers=mods,
                diagnosis_pointers=[0] if dx_codes else [],
                line_order=i + 1,
            )
            db.add(sl)

        await db.commit()
        logger.info("[cross_app] Created DRAFT claim %s from relay claim_request", claim.claim_number)
        return claim.id

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
        # Patient display name
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
    """Background task that polls the sync server relay every 30 seconds for new messages."""
    import asyncio
    import httpx

    logger.info("[cross_app] Background relay polling started (every 30s)")
    while True:
        try:
            await asyncio.sleep(30)
            token = _get_device_token()
            if not token:
                continue

            sync_url = "https://api.angelwink.app"
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.get(
                    f"{sync_url}/api/cross-app/pending",
                    params={"target_app": "angelclaims"},
                    headers={"X-Device-Token": token},
                )
                if resp.status_code != 200:
                    continue
                messages = resp.json()
                if not isinstance(messages, list):
                    messages = messages.get("messages", [])

                for msg in messages:
                    msg_type = msg.get("message_type", "")
                    payload = msg.get("payload", {})
                    msg_id = msg.get("id")

                    try:
                        if msg_type == "claim_request":
                            await _process_claim_request(payload)
                        elif msg_type == "dx_approval_response":
                            await _process_approval_response(payload)
                        else:
                            logger.info("[cross_app] Unknown message type: %s", msg_type)

                        # Acknowledge
                        if msg_id:
                            await client.post(
                                f"{sync_url}/api/cross-app/{msg_id}/ack",
                                headers={"X-Device-Token": token},
                            )
                    except Exception as e:
                        logger.warning("[cross_app] Error processing message %s: %s", msg_id, e)

                if messages:
                    logger.info("[cross_app] Processed %d relay messages", len(messages))

        except asyncio.CancelledError:
            logger.info("[cross_app] Background polling stopped")
            break
        except Exception as e:
            logger.warning("[cross_app] Background poll error: %s", e)
            await asyncio.sleep(10)


async def _process_claim_request(payload: dict):
    """Process an incoming claim_request from the relay."""
    from database import AsyncSessionLocal
    from models import Claim, Patient, Payer
    from sqlalchemy import select
    import random, string

    async with AsyncSessionLocal() as db:
        # Dedup by invoice number
        inv_num = payload.get("invoice_number", "")
        external_ref = f"wink_inv_{inv_num}"
        existing = await db.execute(
            select(Claim).where(Claim.source == "wink", Claim.external_ref == external_ref)
        )
        if existing.scalar_one_or_none():
            logger.info("[cross_app] Claim already exists for invoice %s, skipping", inv_num)
            return

        # Find or create patient
        patient_data = payload.get("patient", {})
        patient_name = patient_data.get("name", "Unknown")
        record_number = patient_data.get("record_number")
        
        patient = None
        if record_number:
            result = await db.execute(select(Patient).where(Patient.angelwink_patient_id == record_number))
            patient = result.scalar_one_or_none()
        
        if not patient:
            # Search by name
            name_parts = patient_name.split()
            if len(name_parts) >= 2:
                result = await db.execute(
                    select(Patient).where(
                        Patient.first_name.ilike(name_parts[0]),
                        Patient.last_name.ilike(name_parts[-1])
                    )
                )
                patient = result.scalar_one_or_none()

        if not patient:
            from datetime import date as _date
            name_parts = patient_name.split()
            try:
                patient_dob = _date.fromisoformat(patient_data.get('dob', '1900-01-01')[:10])
            except (ValueError, TypeError):
                patient_dob = _date(1900, 1, 1)
            patient = Patient(
                first_name=name_parts[0] if name_parts else patient_name,
                last_name=name_parts[-1] if len(name_parts) > 1 else "",
                angelwink_patient_id=record_number,
                dob=patient_dob,
            )
            db.add(patient)
            await db.flush()

        # Create claim
        from datetime import date
        claim_num = f"WK-{''.join(random.choices(string.digits, k=6))}"
        try:
            svc_date = date.fromisoformat(payload.get("date", "")[:10])
        except (ValueError, TypeError):
            svc_date = date.today()

        # Find payer by name
        insurance_name = payload.get("insurance", "")
        payer = None
        if insurance_name:
            result = await db.execute(select(Payer).where(Payer.name.ilike(f"%{insurance_name}%")))
            payer = result.scalar_one_or_none()

        claim = Claim(
            claim_number=claim_num,
            patient_id=patient.id,
            payer_id=payer.id if payer else None,
            service_date_from=svc_date,
            service_date_to=svc_date,
            status="draft",
            external_ref=external_ref,
            place_of_service=payload.get("place_of_service", "11"),
            diagnosis_codes=payload.get("diagnosis_codes", []),
        )
        db.add(claim)
        await db.commit()
        logger.info("[cross_app] Created claim %s for invoice %s (patient: %s)", claim_num, inv_num, patient_name)


async def _process_approval_response(payload: dict):
    """Process a DX approval response from a doctor in AngelWink."""
    logger.info("[cross_app] DX approval response: %s", payload)
    # TODO: Update claim DX codes and notify Ruth
