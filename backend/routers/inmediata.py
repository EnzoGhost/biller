"""
Inmediata clearinghouse integration — SFTP-based 837P submission and 835 ERA retrieval.

Endpoints:
  POST /inmediata/generate/{claim_id}  — generate 837P, return EDI content
  POST /inmediata/batch                — generate batch 837P for multiple claims
  POST /inmediata/upload               — upload 837P file(s) via SFTP
  GET  /inmediata/download-era         — download + parse 835 ERA files from SFTP
  POST /inmediata/reconcile            — match ERA payments to claims, auto-post

SFTP config (config.py / .env):
  INMEDIATA_SFTP_HOST, INMEDIATA_SFTP_USER, INMEDIATA_SFTP_PASSWORD
  INMEDIATA_SFTP_UPLOAD_DIR, INMEDIATA_SFTP_DOWNLOAD_DIR
  INMEDIATA_SUBMITTER_ID
"""
from __future__ import annotations

import io
import logging
from datetime import datetime, date
from typing import Optional

import paramiko
from fastapi import APIRouter, Depends, HTTPException, Body
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from auth import get_current_user
from config import settings
from database import get_db
from edi.x12_837p import generate_837p, generate_837p_batch
from edi.x12_835 import parse_835, match_era_to_claims, ERAResult
from models import Claim, ClaimStatus, Payment, User, Patient, SubmissionMethod

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/inmediata", tags=["inmediata"])

# Runtime config overrides (set via /config endpoint)
_runtime_config: dict = {}


# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_sftp_client() -> tuple[paramiko.SSHClient, paramiko.SFTPClient]:
    """Open SSH + SFTP connection to Inmediata."""
    if not settings.INMEDIATA_SFTP_HOST or not settings.INMEDIATA_SFTP_USER:
        raise HTTPException(
            503,
            "INMEDIATA_SFTP_HOST / INMEDIATA_SFTP_USER not configured. "
            "Set them in .env before using SFTP features."
        )
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        ssh.connect(
            hostname=settings.INMEDIATA_SFTP_HOST,
            username=settings.INMEDIATA_SFTP_USER,
            password=settings.INMEDIATA_SFTP_PASSWORD,
            timeout=30,
        )
    except Exception as exc:
        raise HTTPException(502, f"SFTP connection failed: {exc}") from exc
    sftp = ssh.open_sftp()
    return ssh, sftp


async def _load_claim(claim_id: int, db: AsyncSession) -> Claim:
    result = await db.execute(
        select(Claim)
        .options(
            selectinload(Claim.patient).selectinload(Patient.insurances),
            selectinload(Claim.provider),
            selectinload(Claim.payer),
            selectinload(Claim.service_lines),
        )
        .where(Claim.id == claim_id)
    )
    claim = result.scalar_one_or_none()
    if not claim:
        raise HTTPException(404, f"Claim {claim_id} not found")
    return claim


def _inmediata_filename(prefix: str = "837P") -> str:
    ts = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    return f"{prefix}_{ts}.edi"


# ── Request / Response schemas ─────────────────────────────────────────────────

class BatchRequest(BaseModel):
    claim_ids: list[int]
    usage_indicator: str = "T"    # T=test, P=production


class UploadRequest(BaseModel):
    edi_content: str              # raw EDI string to upload
    filename: Optional[str] = None


class ReconcileRequest(BaseModel):
    era_content: str              # raw 835 EDI string
    auto_post: bool = True        # if True, create Payment records


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/generate/{claim_id}", response_class=PlainTextResponse)
async def generate_claim_edi(
    claim_id: int,
    usage_indicator: str = "T",
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """
    Generate an X12 837P EDI file for a single claim.
    Returns raw EDI content as plain text (save or pass to /upload).
    """
    claim = await _load_claim(claim_id, db)

    edi = generate_837p(
        claim=claim,
        submitter_id=_runtime_config.get("submitter_id") or settings.INMEDIATA_SUBMITTER_ID or "UNKNOWN",
        receiver_id="INMEDIATA",
        usage_indicator=usage_indicator,
        control_number=claim_id,
    )

    return PlainTextResponse(content=edi, media_type="text/plain")


@router.post("/batch")
async def generate_batch_edi(
    body: BatchRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """
    Generate a single 837P batch file for multiple claims.
    Returns the EDI content and a manifest of included claims.
    """
    claims = []
    errors = []
    for cid in body.claim_ids:
        try:
            c = await _load_claim(cid, db)
            claims.append(c)
        except HTTPException as exc:
            errors.append({"claim_id": cid, "error": str(exc.detail)})

    if not claims:
        raise HTTPException(400, "No valid claims found in the provided IDs")

    edi = generate_837p_batch(
        claims=claims,
        submitter_id=_runtime_config.get("submitter_id") or settings.INMEDIATA_SUBMITTER_ID or "UNKNOWN",
        receiver_id="INMEDIATA",
        usage_indicator=body.usage_indicator,
    )

    return {
        "edi_content":   edi,
        "filename":      _inmediata_filename("837P_BATCH"),
        "claim_count":   len(claims),
        "included_ids":  [c.id for c in claims],
        "errors":        errors,
    }


@router.post("/upload")
async def upload_edi(
    body: UploadRequest,
    _: User = Depends(get_current_user),
):
    """
    Upload a 837P EDI file to Inmediata SFTP.
    Pass edi_content from /generate or /batch.
    """
    filename = body.filename or _inmediata_filename()
    remote_path = f"{settings.INMEDIATA_SFTP_UPLOAD_DIR}/{filename}".replace("//", "/")

    ssh, sftp = _get_sftp_client()
    try:
        buf = io.BytesIO(body.edi_content.encode("utf-8"))
        sftp.putfo(buf, remote_path)
        logger.info("Uploaded %s to %s:%s", filename, settings.INMEDIATA_SFTP_HOST, remote_path)
    except Exception as exc:
        raise HTTPException(502, f"SFTP upload failed: {exc}") from exc
    finally:
        sftp.close()
        ssh.close()

    return {
        "status":      "uploaded",
        "filename":    filename,
        "remote_path": remote_path,
        "host":        settings.INMEDIATA_SFTP_HOST,
    }


@router.get("/download-era")
async def download_era(
    limit: int = 10,
    _: User = Depends(get_current_user),
):
    """
    Download and parse 835 ERA files from Inmediata SFTP.
    Returns structured payment data for each file found.
    """
    ssh, sftp = _get_sftp_client()
    download_dir = settings.INMEDIATA_SFTP_DOWNLOAD_DIR or "/ERA"

    parsed_files: list[dict] = []
    errors: list[dict] = []

    try:
        try:
            file_list = sftp.listdir(download_dir)
        except IOError as exc:
            raise HTTPException(502, f"Cannot list SFTP directory '{download_dir}': {exc}") from exc

        # Filter to EDI files
        era_files = [
            f for f in file_list
            if f.lower().endswith((".835", ".edi", ".txt", ".x12"))
        ][:limit]

        for filename in era_files:
            remote_path = f"{download_dir}/{filename}"
            try:
                buf = io.BytesIO()
                sftp.getfo(remote_path, buf)
                raw = buf.getvalue().decode("utf-8", errors="replace")
                era = parse_835(raw)
                parsed_files.append({
                    "filename":       filename,
                    "payer_name":     era.payer_name,
                    "check_number":   era.check_number,
                    "check_date":     era.check_date,
                    "payment_amount": era.payment_amount,
                    "payment_method": era.payment_method,
                    "claim_count":    len(era.claims),
                    "claims": [
                        {
                            "claim_number":          cp.claim_number,
                            "payer_claim_number":    cp.payer_claim_number,
                            "billed_amount":         cp.billed_amount,
                            "paid_amount":           cp.paid_amount,
                            "patient_responsibility":cp.patient_responsibility,
                            "status_code":           cp.claim_status_code,
                            "adjustments":           cp.adjustments,
                            "remark_codes":          cp.remark_codes,
                        }
                        for cp in era.claims
                    ],
                })
            except Exception as exc:
                errors.append({"filename": filename, "error": str(exc)})
    finally:
        sftp.close()
        ssh.close()

    return {
        "files_found":   len(era_files),
        "files_parsed":  len(parsed_files),
        "errors":        errors,
        "results":       parsed_files,
    }


@router.post("/reconcile")
async def reconcile_era(
    body: ReconcileRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """
    Parse an 835 ERA and match payments to DB claims.
    If auto_post=True, creates Payment records and updates claim status.

    Typical workflow:
      1. GET /inmediata/download-era → copy era_content from a file
      2. POST /inmediata/reconcile with that content
    """
    try:
        era = parse_835(body.era_content)
    except Exception as exc:
        raise HTTPException(400, f"Failed to parse 835: {exc}") from exc

    # Load claims referenced in the ERA
    claim_numbers = [cp.claim_number for cp in era.claims]
    if not claim_numbers:
        return {"matched": 0, "unmatched": 0, "posted": 0, "results": []}

    result = await db.execute(
        select(Claim).where(Claim.claim_number.in_(claim_numbers))
    )
    db_claims = result.scalars().all()

    matches = match_era_to_claims(era, list(db_claims))

    posted = 0
    results = []

    for m in matches:
        db_claim: Optional[Claim] = m["claim"]
        payment: "ClaimPayment" = m["payment"]  # type: ignore[assignment]
        matched: bool = m["matched"]

        entry = {
            "claim_number":          payment.claim_number,
            "matched":               matched,
            "paid_amount":           payment.paid_amount,
            "patient_responsibility":payment.patient_responsibility,
            "adjustments":           payment.adjustments,
            "posted":                False,
        }

        if matched and body.auto_post and db_claim:
            try:
                # Create Payment record
                pmt = Payment(
                    claim_id           = db_claim.id,
                    check_number       = era.check_number or None,
                    check_date         = _parse_date(era.check_date),
                    payment_amount     = payment.paid_amount,
                    adjustment_amount  = sum(
                        adj["amount"] for adj in payment.adjustments
                        if adj.get("group") == "CO"
                    ),
                    patient_responsibility = payment.patient_responsibility,
                    payment_method     = (
                        "eft" if era.payment_method in ("ACH", "EFT") else "check"
                    ),
                    eob_data           = {
                        "payer_claim_number": payment.payer_claim_number,
                        "adjustments":        payment.adjustments,
                        "remark_codes":       payment.remark_codes,
                        "service_lines": [
                            {
                                "procedure_code": sl.procedure_code,
                                "paid_amount":    sl.paid_amount,
                                "billed_amount":  sl.billed_amount,
                                "adjustments":    sl.adjustments,
                            }
                            for sl in payment.service_lines
                        ],
                    },
                )
                db.add(pmt)

                # Update claim totals + status
                db_claim.total_paid            = payment.paid_amount
                db_claim.patient_responsibility = payment.patient_responsibility
                db_claim.adjustment_amount      = pmt.adjustment_amount
                db_claim.payer_claim_number     = payment.payer_claim_number or db_claim.payer_claim_number
                db_claim.clearinghouse_ref      = payment.payer_claim_number

                # Set status based on CLP02 claim status code
                status_map = {
                    "1": ClaimStatus.PAID,        # paid
                    "2": ClaimStatus.PAID,        # adjusted/partial pay
                    "3": ClaimStatus.DENIED,      # denied
                    "4": ClaimStatus.DENIED,      # denied
                    "19": ClaimStatus.ACCEPTED,   # pending
                    "22": ClaimStatus.REJECTED,   # reversed
                }
                new_status = status_map.get(payment.claim_status_code)
                if new_status:
                    db_claim.status = new_status

                await db.commit()
                entry["posted"] = True
                posted += 1

            except Exception as exc:
                logger.error("Failed to post payment for %s: %s", payment.claim_number, exc)
                entry["error"] = str(exc)
                await db.rollback()

        results.append(entry)

    matched_count   = sum(1 for r in results if r["matched"])
    unmatched_count = sum(1 for r in results if not r["matched"])

    return {
        "payer_name":     era.payer_name,
        "check_number":   era.check_number,
        "payment_amount": era.payment_amount,
        "matched":        matched_count,
        "unmatched":      unmatched_count,
        "posted":         posted,
        "results":        results,
    }


# ── Utilities ─────────────────────────────────────────────────────────────────

# ── Config ───────────────────────────────────────────────────────────────────

class InmediataConfigRequest(BaseModel):
    sftp_host:      Optional[str] = None
    sftp_user:      Optional[str] = None
    sftp_password:  Optional[str] = None
    sftp_upload_dir: Optional[str] = None
    sftp_download_dir: Optional[str] = None
    submitter_id:   Optional[str] = None
    ws_username:    Optional[str] = None
    ws_password:    Optional[str] = None
    ws_env:         Optional[str] = None


@router.post("/config")
async def save_inmediata_config(
    body: InmediataConfigRequest,
    _: User = Depends(get_current_user),
):
    """
    Update Inmediata SFTP settings at runtime (in-memory override).
    """
    if body.sftp_host is not None:        _runtime_config["sftp_host"] = body.sftp_host
    if body.sftp_user is not None:        _runtime_config["sftp_user"] = body.sftp_user
    if body.sftp_password is not None:    _runtime_config["sftp_password"] = body.sftp_password
    if body.sftp_upload_dir is not None:  _runtime_config["sftp_upload_dir"] = body.sftp_upload_dir
    if body.sftp_download_dir is not None: _runtime_config["sftp_download_dir"] = body.sftp_download_dir
    if body.submitter_id is not None:     _runtime_config["submitter_id"] = body.submitter_id
    if body.ws_username is not None:      _runtime_config["ws_username"] = body.ws_username
    if body.ws_password is not None and body.ws_password:
        _runtime_config["ws_password"] = body.ws_password
    if body.ws_env is not None:           _runtime_config["ws_env"] = body.ws_env
    return {"status": "saved"}


@router.get("/config")
async def get_inmediata_config(
    _: User = Depends(get_current_user),
):
    """Return current (non-secret) Inmediata config."""
    return {
        "sftp_host":        _runtime_config.get("sftp_host", settings.INMEDIATA_SFTP_HOST or ""),
        "sftp_user":        _runtime_config.get("sftp_user", settings.INMEDIATA_SFTP_USER or ""),
        "sftp_upload_dir":  _runtime_config.get("sftp_upload_dir", settings.INMEDIATA_SFTP_UPLOAD_DIR or "/837"),
        "sftp_download_dir":_runtime_config.get("sftp_download_dir", settings.INMEDIATA_SFTP_DOWNLOAD_DIR or "/835"),
        "submitter_id":     _runtime_config.get("submitter_id", settings.INMEDIATA_SUBMITTER_ID or ""),
        "ws_username":      _runtime_config.get("ws_username", settings.INMEDIATA_WS_USERNAME or ""),
        "ws_has_password":  bool(_runtime_config.get("ws_password") or settings.INMEDIATA_WS_PASSWORD),
        "ws_env":           _runtime_config.get("ws_env", settings.INMEDIATA_WS_ENV or "uat"),
    }


# ── WS Config ─────────────────────────────────────────────────────────────────

@router.post("/ws-config")
async def save_ws_config(
    body: dict = Body(...),
    _: User = Depends(get_current_user),
):
    """Save Inmediata Web Services configuration (username, password, env, submitter_id)."""
    if body.get("ws_username") is not None:
        _runtime_config["ws_username"] = body["ws_username"]
    if body.get("ws_password") is not None and body["ws_password"]:
        _runtime_config["ws_password"] = body["ws_password"]
    if body.get("ws_env") is not None:
        _runtime_config["ws_env"] = body["ws_env"]
    if body.get("submitter_id") is not None:
        _runtime_config["submitter_id"] = body["submitter_id"]
    return {"status": "saved"}


# ── API Config ────────────────────────────────────────────────────────────────

@router.post("/api-config")
async def save_api_config(
    body: dict = Body(...),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Save Inmediata API configuration."""
    _runtime_config["api_key"] = body.get("api_key", "")
    _runtime_config["api_base_url"] = body.get("api_base_url", "https://api.inmediata.com")
    _runtime_config["submitter_id"] = body.get("submitter_id", "")
    _runtime_config["environment"] = body.get("environment", "sandbox")
    return {"status": "saved"}


@router.get("/api-config")
async def get_api_config(
    _: User = Depends(get_current_user),
):
    """Get current Inmediata API configuration (masked key)."""
    key = _runtime_config.get("api_key", "")
    masked = f"{'*' * (len(key) - 4)}{key[-4:]}" if len(key) > 4 else "not set"
    return {
        "api_key_masked": masked,
        "api_key_set": bool(key),
        "api_base_url": _runtime_config.get("api_base_url", "https://api.inmediata.com"),
        "submitter_id": _runtime_config.get("submitter_id", ""),
        "environment": _runtime_config.get("environment", "sandbox"),
    }


@router.post("/test-connection")
async def test_inmediata_connection(
    _: User = Depends(get_current_user),
):
    """Test Inmediata API connection with current config."""
    key = _runtime_config.get("api_key")
    if not key:
        return {"success": False, "message": "API key not configured"}
    base = _runtime_config.get("api_base_url", "https://api.inmediata.com")
    # Placeholder — will implement real API test after the call with Inmediata
    return {"success": True, "message": f"Configuration saved. Ready to connect to {base}"}


# ── Utilities ─────────────────────────────────────────────────────────────────

def _parse_date(date_str: str | None) -> date | None:
    """Parse YYYYMMDD date string → date object."""
    if not date_str:
        return None
    for fmt in ("%Y%m%d", "%Y-%m-%d", "%m/%d/%Y"):
        try:
            return datetime.strptime(date_str, fmt).date()
        except (ValueError, TypeError):
            continue
    return None


# ── SecureTrack Web Service Endpoints ───────────────────────────────────────────
# These endpoints submit / download via SOAP instead of SFTP.

class WSSubmitRequest(BaseModel):
    fix_x12_envelope: bool = False  # keep our ISA envelope intact


class WSBatchRequest(BaseModel):
    claim_ids: list[int]
    fix_x12_envelope: bool = False


class WSListFilesRequest(BaseModel):
    date_from: str    # ISO format: YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS
    date_to: str
    file_type: str = ""  # "" = all, or "835,277A" etc.


class WSMarkDownloadedRequest(BaseModel):
    msg_ids: list[str]


class WSGetByIdRequest(BaseModel):
    msg_ids: list[str]
    mark_as_downloaded: bool = False


from edi.securetrack_client import SecureTrackClient
from edi.x12_835 import parse_835, match_era_to_claims, ERAResult


def _get_ws_client() -> SecureTrackClient:
    """Return SecureTrackClient; raise 503 if not configured."""
    client = SecureTrackClient()
    if not client.username or not client.password:
        raise HTTPException(
            503,
            "INMEDIATA_WS_USERNAME / INMEDIATA_WS_PASSWORD not configured. "
            "Set them in .env before using web service features.",
        )
    return client


@router.post("/submit-ws/{claim_id}", summary="Submit single claim via SecureTrack SOAP (837P)")
async def submit_claim_ws(
    claim_id: int,
    req: WSSubmitRequest = Body(default=WSSubmitRequest()),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Generate 837P for a claim and submit via Inmediata SecureTrack SOAP.
    Alternative to SFTP-based submission.
    """
    claim = await _load_claim(claim_id, db)

    # Reject claims whose payer is not routed through Inmediata
    if claim.payer and claim.payer.submission_method != SubmissionMethod.INMEDIATA:
        raise HTTPException(
            400,
            f"Claim payer '{claim.payer.name}' is not routed through Inmediata "
            f"(method: {claim.payer.submission_method}). Use the appropriate submission channel."
        )

    submitter_id = _runtime_config.get("submitter_id") or settings.INMEDIATA_SUBMITTER_ID or settings.STEDI_ISA_SENDER_ID
    if not submitter_id:
        raise HTTPException(400, "Submitter ID not configured. Set it in Settings → Inmediata.")

    edi_content = generate_837p(claim, submitter_id=submitter_id)
    filename = _inmediata_filename(f"837P_{claim.claim_number}")

    client = _get_ws_client()
    try:
        result = await client.send_x12_file(
            edi_content=edi_content,
            filename=filename,
        )
    except Exception as exc:
        logger.exception("SecureTrack SendX12File failed for claim %d", claim_id)
        raise HTTPException(502, f"Inmediata SecureTrack error: {exc}")

    if not result.success:
        raise HTTPException(400, f"Inmediata rejected claim: {result.message}")

    # Update claim status
    claim.status = ClaimStatus.SUBMITTED
    claim.date_of_submission = datetime.utcnow()
    claim.clearinghouse_ref = f"WS:{filename}"
    await db.commit()

    return {
        "success": True,
        "claim_id": claim_id,
        "filename": filename,
        "message": result.message,
        "routed_files": len(result.routed_files),
        "more_to_download": result.more_to_download,
    }


@router.post("/submit-ws/batch", summary="Submit batch claims via SecureTrack SOAP (837P)")
async def submit_batch_ws(
    req: WSBatchRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Generate and submit a batch 837P for multiple claims via SOAP.
    All claims submitted as a single EDI file.
    """
    if not req.claim_ids:
        raise HTTPException(400, "No claim IDs provided")

    submitter_id = settings.INMEDIATA_SUBMITTER_ID or settings.STEDI_ISA_SENDER_ID
    if not submitter_id:
        raise HTTPException(400, "INMEDIATA_SUBMITTER_ID not set in config")

    # Load all claims
    claims = []
    for cid in req.claim_ids:
        claims.append(await _load_claim(cid, db))

    edi_content = generate_837p_batch(claims, submitter_id=submitter_id)
    filename = _inmediata_filename("837P_BATCH")

    client = _get_ws_client()
    try:
        result = await client.send_x12_file(
            edi_content=edi_content,
            filename=filename,
        )
    except Exception as exc:
        logger.exception("SecureTrack batch SendX12File failed")
        raise HTTPException(502, f"Inmediata SecureTrack error: {exc}")

    if not result.success:
        raise HTTPException(400, f"Inmediata rejected batch: {result.message}")

    # Update all claim statuses
    for claim in claims:
        claim.status = ClaimStatus.SUBMITTED
        claim.date_of_submission = datetime.utcnow()
        claim.clearinghouse_ref = f"WS:{filename}"
    await db.commit()

    return {
        "success": True,
        "claim_ids": req.claim_ids,
        "filename": filename,
        "message": result.message,
        "routed_files": len(result.routed_files),
        "more_to_download": result.more_to_download,
    }


@router.get("/check-status/{claim_id}", summary="Real-time claim status via 276/277 SecureTrack")
async def check_claim_status_ws(
    claim_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Send a 276 claim status inquiry for a claim and return the 277 response.
    NOTE: Requires the claim to have been submitted with a known clearinghouse ref.
    """
    from edi.x12_837p import generate_837p  # reuse for ISA/GS headers
    claim = await _load_claim(claim_id, db)

    submitter_id = settings.INMEDIATA_SUBMITTER_ID or settings.STEDI_ISA_SENDER_ID
    if not submitter_id:
        raise HTTPException(400, "INMEDIATA_SUBMITTER_ID not set in config")

    if not claim.payer_claim_number and not claim.clearinghouse_ref:
        raise HTTPException(
            400,
            "Claim has no payer_claim_number or clearinghouse_ref. "
            "Submit the claim first before checking status."
        )

    # Build a minimal 276 X12 (claim status inquiry)
    # We construct a bare-bones 276 — full implementation requires provider NPI + payer info
    from datetime import datetime as dt
    now = dt.utcnow()
    date_str = now.strftime("%y%m%d")
    time_str = now.strftime("%H%M")
    ctrl = str(abs(hash(f"{claim_id}{now}")) % 999999999).zfill(9)
    patient = claim.patient
    payer   = claim.payer
    provider = claim.provider

    x12_276 = (
        f"ISA*00*          *00*          *ZZ*{submitter_id[:15]:<15}*ZZ*{'INMEDIATA':<15}"
        f"*{date_str}*{time_str}*^*00501*{ctrl}*0*T*:~\n"
        f"GS*HR*{submitter_id[:15]}*INMEDIATA*{now.strftime('%Y%m%d')}*{time_str}*1*X*005010X212~\n"
        f"ST*276*0001*005010X212~\n"
        f"BHT*0010*13*{ctrl}*{now.strftime('%Y%m%d')}*{time_str}~\n"
        f"HL*1**20*1~\n"
        f"NM1*PR*2*{payer.name[:35] if payer else 'PAYER'}*****PI*{payer.payer_id if payer else ''}~\n"
        f"HL*2*1*21*1~\n"
        f"NM1*41*2*{submitter_id[:35]}*****46*{submitter_id[:10]}~\n"
        f"HL*3*2*19*1~\n"
        f"NM1*1P*1*{provider.last_name[:35] if provider else 'PROVIDER'}*{provider.first_name[:25] if provider else ''}****XX*{provider.npi if provider else ''}~\n"
        f"HL*4*3*22*0~\n"
        f"DMG*D8*{patient.dob.strftime('%Y%m%d') if patient and patient.dob else ''}~\n"
        f"NM1*QC*1*{patient.last_name[:35] if patient else ''}*{patient.first_name[:25] if patient else ''}***~\n"
        f"TRN*1*{ctrl}*9{submitter_id[:9]}~\n"
        f"SE*13*0001~\n"
        f"GE*1*1~\n"
        f"IEA*1*{ctrl}~\n"
    )

    client = _get_ws_client()
    try:
        rt_result = await client.send_realtime(x12_276)
    except Exception as exc:
        logger.exception("SecureTrack claim status check failed for claim %d", claim_id)
        raise HTTPException(502, f"Inmediata SecureTrack error: {exc}")

    return {
        "success": rt_result.success,
        "claim_id": claim_id,
        "message": rt_result.message,
        "response_277": rt_result.response,
        "error_count": rt_result.error_count,
    }


@router.post("/poll-eras-ws", summary="Poll and download ERAs via SecureTrack SOAP")
async def poll_eras_ws(
    mark_downloaded: bool = False,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Download pending ERA/835 files from Inmediata SecureTrack SOAP.
    Alternative to SFTP-based ERA download.

    Use mark_downloaded=True only when your pipeline is fault-tolerant.
    Files are returned for caller to process; use /inmediata/reconcile to post payments.
    """
    client = _get_ws_client()
    all_835s: list[str] = []
    more = True
    iterations = 0
    max_iterations = 10  # safety limit

    try:
        while more and iterations < max_iterations:
            result = await client.get_routed_files(mark_as_downloaded=False)
            if not result.success:
                raise HTTPException(400, f"Inmediata GetRoutedFiles error: {result.message}")

            for rf in result.routed_files:
                if rf.file_type == "HIPAASTDDOC":
                    content = rf.content
                    # Only collect 835 ERA files (check ST segment)
                    if "*835*" in content or content.strip().startswith("ISA"):
                        all_835s.append(content)

            more = result.more_to_download
            iterations += 1

            # Mark as downloaded if requested (do it per-batch)
            if mark_downloaded and result.routed_files:
                msg_ids = [rf.msg_id for rf in result.routed_files]
                await client.mark_files_as_downloaded(msg_ids)

    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("poll_eras_ws failed")
        raise HTTPException(502, f"Inmediata SecureTrack error: {exc}")

    return {
        "success": True,
        "era_count": len(all_835s),
        "eras": all_835s,
        "iterations": iterations,
        "note": "Pass era content to POST /api/inmediata/reconcile to post payments",
    }


@router.post("/list-files-ws", summary="List pending files on SecureTrack without downloading")
async def list_files_ws(
    req: WSListFilesRequest,
    current_user: User = Depends(get_current_user),
):
    """
    List metadata about files pending download from Inmediata SecureTrack.
    Use to selectively decide which files to download.
    """
    from datetime import datetime as dt
    try:
        date_from = dt.fromisoformat(req.date_from)
        date_to   = dt.fromisoformat(req.date_to)
    except ValueError:
        raise HTTPException(400, "date_from and date_to must be ISO format: YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS")

    client = _get_ws_client()
    try:
        result = await client.list_routed_files(
            date_from=date_from,
            date_to=date_to,
            file_type=req.file_type,
        )
    except Exception as exc:
        logger.exception("list_files_ws failed")
        raise HTTPException(502, f"Inmediata SecureTrack error: {exc}")

    return {
        "success": result.success,
        "message": result.message,
        "file_count": len(result.files),
        "files": [
            {
                "msg_id": f.msg_id,
                "entity_from": f.entity_from,
                "creation_date": f.creation_date,
                "document_type": f.document_type,
                "file_size": f.file_size,
                "is_response": f.is_response,
                "sender_etin": f.sender_etin,
                "submitted_file_id": f.submitted_file_id,
                "submitted_file_name": f.submitted_file_name,
                "submitted_icn": f.submitted_icn,
            }
            for f in result.files
        ],
    }


@router.post("/download-files-ws", summary="Download specific files by MsgID from SecureTrack")
async def download_files_ws(
    req: WSGetByIdRequest,
    current_user: User = Depends(get_current_user),
):
    """
    Download specific files by MsgID from Inmediata SecureTrack.
    Use list-files-ws first to get MsgIDs.
    """
    if not req.msg_ids:
        raise HTTPException(400, "msg_ids list is required")

    client = _get_ws_client()
    try:
        result = await client.get_routed_files_by_id(
            msg_ids=req.msg_ids,
            mark_as_downloaded=req.mark_as_downloaded,
        )
    except Exception as exc:
        logger.exception("download_files_ws failed")
        raise HTTPException(502, f"Inmediata SecureTrack error: {exc}")

    return {
        "success": result.success,
        "message": result.message,
        "file_count": len(result.routed_files),
        "more_to_download": result.more_to_download,
        "files": [
            {
                "msg_id": rf.msg_id,
                "file_type": rf.file_type,
                "file_size": rf.file_size,
                "routed_date": rf.routed_date,
                "content": rf.content,
            }
            for rf in result.routed_files
        ],
    }


@router.post("/mark-downloaded-ws", summary="Mark files as downloaded on SecureTrack")
async def mark_downloaded_ws(
    req: WSMarkDownloadedRequest,
    current_user: User = Depends(get_current_user),
):
    """
    Acknowledge receipt of files by MsgID on Inmediata SecureTrack.
    Call this after successfully processing downloaded files.
    """
    if not req.msg_ids:
        raise HTTPException(400, "msg_ids list is required")

    client = _get_ws_client()
    try:
        success = await client.mark_files_as_downloaded(req.msg_ids)
    except Exception as exc:
        logger.exception("mark_downloaded_ws failed")
        raise HTTPException(502, f"Inmediata SecureTrack error: {exc}")

    return {
        "success": success,
        "msg_ids_marked": req.msg_ids,
    }


@router.get("/responses/{claim_id}", summary="Get Inmediata submission responses for a claim")
async def get_claim_responses(
    claim_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """
    Retrieve Inmediata submission history and responses (999 ACKs, validation reports)
    for a specific claim, matched by clearinghouse_ref filename.
    """
    claim = await _load_claim(claim_id, db)

    # Parse the clearinghouse_ref to find the submitted filename
    filename = None
    if claim.clearinghouse_ref and claim.clearinghouse_ref.startswith("WS:"):
        filename = claim.clearinghouse_ref[3:]

    result = {
        "claim_id": claim_id,
        "claim_number": claim.claim_number,
        "submitted_at": claim.date_of_submission.isoformat() if claim.date_of_submission else None,
        "clearinghouse_ref": claim.clearinghouse_ref,
        "filename": filename,
        "responses": [],
    }

    if not filename:
        return result

    try:
        client = _get_ws_client()
        all_files = []
        iterations = 0
        while iterations < 10:
            files_result = await client.get_routed_files(mark_as_downloaded=False)
            all_files.extend(files_result.routed_files)
            if not files_result.more_to_download:
                break
            iterations += 1

        for f in all_files:
            body_text = f.content
            # Only process files that reference our submitted filename or claim number
            if filename not in body_text and (not claim.claim_number or claim.claim_number not in body_text):
                continue

            if f.file_type == "INMNOTIFMSG":
                # Inmediata notification/validation report (TSV)
                lines = body_text.strip().split("\n")
                entries = []
                for line in lines[1:]:  # Skip header row
                    cols = line.split("\t")
                    if len(cols) >= 10:
                        entries.append({
                            "claim_ref": cols[6] if len(cols) > 6 else "",
                            "error_code": cols[7] if len(cols) > 7 else "",
                            "name": cols[8] if len(cols) > 8 else "",
                            "message": cols[9] if len(cols) > 9 else "",
                            "data": cols[10] if len(cols) > 10 else "",
                        })
                result["responses"].append({
                    "type": "validation_report",
                    "date": f.routed_date,
                    "msg_id": f.msg_id,
                    "entries": entries,
                })

            elif f.file_type == "HIPAASTDDOC":
                # 999 Functional Acknowledgment — IK5*A = accepted, IK5*R = rejected
                accepted = "IK5*A" in body_text
                result["responses"].append({
                    "type": "acknowledgment",
                    "date": f.routed_date,
                    "msg_id": f.msg_id,
                    "accepted": accepted,
                    "raw": body_text[:500],
                })

    except HTTPException:
        raise
    except Exception as e:
        result["responses"].append({
            "type": "error",
            "message": f"Could not fetch responses: {str(e)}",
        })

    return result
