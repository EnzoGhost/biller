"""
Wink Patient Documents — Fetch patient document metadata and proxy files
from the Wink sync server's PostgreSQL and B2 storage.
"""
import json
import logging
import os
from concurrent.futures import ThreadPoolExecutor
from functools import partial
from typing import Optional

import psycopg2
import httpx
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import RedirectResponse, Response

from auth import get_current_user
from models import User

logger = logging.getLogger("wink_docs")
router = APIRouter(prefix="/wink", tags=["wink-docs"])

# Sync server connection details
SYNC_DB_HOST = "127.0.0.1"
SYNC_DB_NAME = "wink_sync"
SYNC_DB_USER = "wink"
SYNC_DB_PASS = "wink_sync_2026!"
SYNC_DB_TIMEOUT = 5

SYNC_SERVER_URL = "http://159.65.235.231:3100"
# Clinic ID is now read dynamically from DB via get_paired_clinic_id()

# Thread pool for sync DB queries (psycopg2 is blocking)
_executor = ThreadPoolExecutor(max_workers=3)

# Categories to skip (signatures aren't useful for billing)
# ONLY these categories are relevant for billing claims
# Insurance card and license/ID — nothing else
ALLOWED_CATEGORIES = {
    "insurance_card": "insurance_card",
    "insurance_card_primary": "insurance_card",
    "insurance_card_secondary": "insurance_card",
    "insurance_plan_1": "insurance_card",
    "insurance": "insurance_card",
    "license": "license",
    "license_id": "license",
    "id_license": "license",
}


def _get_sync_connection():
    """Create a connection to the Wink sync server PostgreSQL."""
    return psycopg2.connect(
        host=SYNC_DB_HOST,
        dbname=SYNC_DB_NAME,
        user=SYNC_DB_USER,
        password=SYNC_DB_PASS,
        connect_timeout=SYNC_DB_TIMEOUT,
    )


def _query_patient_docs(wink_patient_id: str) -> list[dict]:
    """Query sync server for patient documents (runs in thread pool)."""
    conn = _get_sync_connection()
    try:
        cur = conn.cursor()
        # Get latest version of each document by row_id — filter by patient_id in SQL
        # Use data->>patient_id to avoid scanning all 65K+ rows
        cur.execute("""
            SELECT DISTINCT ON (row_id) data
            FROM sync_changes
            WHERE table_name = 'patient_documents'
              AND clinic_id = %s
              AND operation != 'DELETE'
              AND data IS NOT NULL
              AND (data->>'patient_id' = %s OR data->>'patient_id' = %s)
            ORDER BY row_id, timestamp DESC
        """, (get_paired_clinic_id(), str(wink_patient_id), str(int(str(wink_patient_id).lstrip('0') or '0'))))

        docs = []
        for (raw_data,) in cur.fetchall():
            data = json.loads(raw_data) if isinstance(raw_data, str) else raw_data
            cat = data.get("category", "other")
            att_type = ALLOWED_CATEGORIES.get(cat)
            if not att_type:
                continue  # Only insurance card + license for billing
            docs.append({
                "id": data.get("id"),
                "filename": data.get("filename"),
                "category": cat,
                "attachment_type": att_type,
                "url": f"/wink/patient-documents/{wink_patient_id}/file/{data.get('id')}",
                "file_size": data.get("file_size"),
            })
        cur.close()
        return docs
    finally:
        conn.close()


def _query_doc_by_id(doc_id: str) -> Optional[dict]:
    """Get a single document record by its ID."""
    conn = _get_sync_connection()
    try:
        cur = conn.cursor()
        cur.execute("""
            SELECT DISTINCT ON (row_id) data
            FROM sync_changes
            WHERE table_name = 'patient_documents'
              AND clinic_id = %s
              AND operation != 'DELETE'
              AND data IS NOT NULL
              AND data::jsonb->>'id' = %s
            ORDER BY row_id, timestamp DESC
            LIMIT 1
        """, (get_paired_clinic_id(), str(doc_id)))
        row = cur.fetchone()
        cur.close()
        if not row:
            return None
        return json.loads(row[0]) if isinstance(row[0], str) else row[0]
    finally:
        conn.close()


def _get_device_token() -> Optional[str]:
    """Get a valid device token from the sync server for authenticated requests."""
    conn = _get_sync_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT device_token FROM devices "
            "WHERE (revoked IS NULL OR revoked = false) "
            "AND token_expires_at > NOW() LIMIT 1"
        )
        row = cur.fetchone()
        cur.close()
        return row[0] if row else None
    finally:
        conn.close()


@router.get("/patient-documents/{wink_patient_id}")
async def get_wink_patient_documents(
    wink_patient_id: str,
    _: User = Depends(get_current_user),
):
    """Fetch patient documents from Wink sync server."""
    import asyncio
    loop = asyncio.get_event_loop()
    try:
        docs = await loop.run_in_executor(
            _executor, partial(_query_patient_docs, wink_patient_id)
        )
        return docs
    except Exception as e:
        logger.error("[wink-docs] Error fetching documents: %s", e)
        return []


@router.get("/patient-documents/{wink_patient_id}/file/{doc_id}")
async def proxy_wink_document(
    wink_patient_id: str,
    doc_id: str,
    token: Optional[str] = None,
    credentials: Optional["HTTPAuthorizationCredentials"] = Depends(lambda: None),
):
    """Proxy a patient document file from B2 via the sync server.
    Accepts JWT via Authorization header OR ?token= query param (for img tags)."""
    import asyncio
    from jose import jwt, JWTError
    from config import settings as app_settings
    # Validate token (header or query param)
    jwt_token = token
    if not jwt_token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        jwt.decode(jwt_token, app_settings.SECRET_KEY, algorithms=["HS256"])
    except (JWTError, Exception):
        raise HTTPException(status_code=401, detail="Invalid token")
    loop = asyncio.get_event_loop()

    # Get the document record to find patient_id and filename
    doc_data = await loop.run_in_executor(
        _executor, partial(_query_doc_by_id, doc_id)
    )
    if not doc_data:
        raise HTTPException(status_code=404, detail="Document not found")

    patient_id = doc_data.get("patient_id")
    filename = doc_data.get("filename")
    if not patient_id or not filename:
        raise HTTPException(status_code=404, detail="Document missing patient_id or filename")

    # Build B2 key from clinic slug + patient_id + filename
    # (file_path may be empty for imported docs — the scraper stores "" to prevent
    # the desktop app from rendering B2 keys as local file paths)
    file_path = doc_data.get("file_path", "")
    if not file_path or not file_path.startswith("clinic-"):
        # Construct from components
        _clinic_id = get_paired_clinic_id()
        _slug = _get_clinic_slug(_clinic_id)
        file_path = f"clinic-{_slug}/patients/{patient_id}/{filename}"
        if not _slug:
            raise HTTPException(status_code=404, detail="Cannot determine clinic slug for B2 path")

    # Build presigned B2 URL directly
    import boto3
    import os as _b2_os
    b2_client = boto3.client(
        "s3",
        endpoint_url=f"https://s3.{_b2_os.environ.get('B2_REGION', 'us-east-005')}.backblazeb2.com",
        aws_access_key_id=_b2_os.environ.get("B2_KEY_ID", ""),
        aws_secret_access_key=_b2_os.environ.get("B2_APP_KEY", ""),
        region_name=_b2_os.environ.get("B2_REGION", "us-east-005"),
    )
    bucket = _b2_os.environ.get("B2_BUCKET", "wink-clinic-cloud")

    try:
        presigned_url = b2_client.generate_presigned_url(
            "get_object",
            Params={"Bucket": bucket, "Key": file_path},
            ExpiresIn=3600,
        )
    except Exception as e:
        logger.error("[wink-docs] B2 presign error: %s", e)
        raise HTTPException(status_code=500, detail="Failed to generate document URL")

    # Fetch the file from B2 and serve
    async with httpx.AsyncClient(timeout=30) as client:
        try:
            file_resp = await client.get(presigned_url, follow_redirects=True)
            if file_resp.status_code != 200:
                return _placeholder_image(f"File not available (HTTP {file_resp.status_code})")

            content_type = file_resp.headers.get("content-type", _guess_content_type(filename))
            return Response(
                content=file_resp.content,
                media_type=content_type,
                headers={"Cache-Control": "private, max-age=3600"},
            )
        except Exception as fetch_err:
            logger.error("[wink-docs] B2 fetch error: %s", fetch_err)
            return _placeholder_image("File temporarily unavailable")


def _guess_content_type(filename: str) -> str:
    """Guess MIME type from filename extension."""
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    types = {
        "jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png",
        "gif": "image/gif", "webp": "image/webp", "pdf": "application/pdf",
        "tiff": "image/tiff", "tif": "image/tiff", "bmp": "image/bmp",
    }
    return types.get(ext, "application/octet-stream")


def _placeholder_image(text: str) -> Response:
    """Return a simple grey placeholder image with text (SVG)."""
    svg = f"""<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300">
      <rect width="400" height="300" fill="#e0e0e0"/>
      <text x="200" y="150" text-anchor="middle" dominant-baseline="middle"
            font-family="sans-serif" font-size="16" fill="#666">{text}</text>
    </svg>"""
    return Response(content=svg.encode(), media_type="image/svg+xml")


# ── Multi-tenant: get paired clinic ID from DB ──────────────────────────
def get_paired_clinic_id() -> str:
    """Read the AngelWink clinic_id from clinic_settings (persisted during pairing).
    Falls back to ANGELWINK_CLINIC_ID env var, then empty string."""
    import sqlite3
    import os
    # Try reading from the same DB the app uses
    from config import settings
    db_url = settings.DATABASE_URL
    if "///" in db_url:
        db_path = db_url.split("///", 1)[1]
    else:
        db_path = "./angelclaims.db"
    try:
        db = sqlite3.connect(db_path)
        row = db.execute("SELECT angelwink_clinic_id FROM clinic_settings WHERE id = 1").fetchone()
        db.close()
        if row and row[0]:
            return row[0]
    except Exception:
        pass
    return os.environ.get("ANGELWINK_CLINIC_ID", "")


def _get_clinic_slug(clinic_id: str) -> str:
    """Get clinic slug from the sync server PostgreSQL."""
    try:
        conn = _get_sync_connection()
        cur = conn.cursor()
        cur.execute("SELECT slug FROM clinics WHERE id = %s::uuid", (clinic_id,))
        row = cur.fetchone()
        cur.close()
        conn.close()
        return row[0] if row else ""
    except Exception:
        return ""
