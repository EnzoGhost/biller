"""
Wink Patient Documents — Fetch patient document metadata and proxy files
from the Wink sync server's PostgreSQL and B2 storage.
"""
import json
import logging
from concurrent.futures import ThreadPoolExecutor
from functools import partial
from typing import Optional

import psycopg2
import httpx
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import RedirectResponse

from auth import get_current_user
from models import User

logger = logging.getLogger("wink_docs")
router = APIRouter(prefix="/wink", tags=["wink-docs"])

# Sync server connection details
SYNC_DB_HOST = "159.65.235.231"
SYNC_DB_NAME = "wink_sync"
SYNC_DB_USER = "wink"
SYNC_DB_PASS = "wink_sync_2026!"
SYNC_DB_TIMEOUT = 5

SYNC_SERVER_URL = "http://159.65.235.231:3100"
WINK_CLINIC_ID = "1a905d29-0a9a-42b3-8bc3-83c0ceb9acba"

# Thread pool for sync DB queries (psycopg2 is blocking)
_executor = ThreadPoolExecutor(max_workers=3)

# Categories to skip (signatures aren't useful for billing)
SKIP_CATEGORIES = {"signature"}

# Map Wink categories to display-friendly attachment types
CATEGORY_MAP = {
    "insurance_card": "insurance_card",
    "insurance_plan_1": "insurance_card",
    "insurance": "insurance_card",
    "license": "license",
    "id_license": "license",
    "photo": "photo",
    "other": "other",
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
        # Get latest version of each document by row_id
        cur.execute("""
            SELECT DISTINCT ON (row_id) data
            FROM sync_changes
            WHERE table_name = 'patient_documents'
              AND clinic_id = %s
              AND operation != 'DELETE'
              AND data IS NOT NULL
            ORDER BY row_id, timestamp DESC
        """, (WINK_CLINIC_ID,))

        docs = []
        for (raw_data,) in cur.fetchall():
            data = json.loads(raw_data) if isinstance(raw_data, str) else raw_data
            if str(data.get("patient_id")) != str(wink_patient_id):
                continue
            cat = data.get("category", "other")
            if cat in SKIP_CATEGORIES:
                continue
            att_type = CATEGORY_MAP.get(cat, "other")
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
        """, (WINK_CLINIC_ID, str(doc_id)))
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
    _: User = Depends(get_current_user),
):
    """Proxy a patient document file from B2 via the sync server."""
    import asyncio
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

    # Get a device token for sync server auth
    device_token = await loop.run_in_executor(_executor, _get_device_token)
    if not device_token:
        raise HTTPException(status_code=503, detail="No valid device token for sync server")

    # Request presigned B2 URL from the sync server
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(
            f"{SYNC_SERVER_URL}/api/sync/documents/cloud/{patient_id}/{filename}",
            headers={"X-Device-Token": device_token},
        )
        if resp.status_code != 200:
            raise HTTPException(
                status_code=resp.status_code,
                detail="Failed to get document from sync server",
            )

        result = resp.json()
        url = result.get("url")
        if url:
            return RedirectResponse(url)

        raise HTTPException(status_code=404, detail="Document URL not found in sync server response")
