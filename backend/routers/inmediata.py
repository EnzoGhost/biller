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
from models import Claim, ClaimStatus, Payment, User

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
            selectinload(Claim.patient).selectinload("insurances"),
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
        submitter_id=settings.INMEDIATA_SUBMITTER_ID or "UNKNOWN",
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
        submitter_id=settings.INMEDIATA_SUBMITTER_ID or "UNKNOWN",
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
    }


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
