"""
AI Scanner — OpenAI Vision API processing for scanned images.

Endpoints:
  POST /scanner/process/fee-schedule  — Extract CPT codes + payer rates
  POST /scanner/process/inventory     — Extract inventory items
  POST /scanner/process/eligibility   — Extract insurance card info
"""

import json
import logging
import re
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from config import settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/scanner/process", tags=["scanner-ai"])


# ─── Request / Response models ─────────────────────────────────────────────

class ProcessRequest(BaseModel):
    images: list[str]  # list of base64 data URLs


class FeeScheduleEntry(BaseModel):
    code: str
    description: str = ""
    rates: dict[str, float] = {}

    @classmethod
    def __get_validators__(cls):
        yield cls._validate

    @staticmethod
    def _validate(v):
        return v

    class Config:
        # Allow string amounts like "$23.00" to be parsed as float
        pass

    def __init__(self, **data):
        # Clean rate values: "$23.00" -> 23.0, "N/A" -> 0.0
        if "rates" in data and isinstance(data["rates"], dict):
            cleaned = {}
            for k, v in data["rates"].items():
                if isinstance(v, (int, float)):
                    cleaned[k] = float(v)
                elif isinstance(v, str):
                    try:
                        cleaned[k] = float(v.replace("$", "").replace(",", "").strip())
                    except (ValueError, TypeError):
                        cleaned[k] = 0.0
                else:
                    cleaned[k] = 0.0
            data["rates"] = cleaned
        super().__init__(**data)


class FeeScheduleResponse(BaseModel):
    entries: list[FeeScheduleEntry]
    raw: Optional[str] = None


class InventoryItem(BaseModel):
    name: str
    sku: Optional[str] = None
    brand: Optional[str] = None
    price: Optional[float] = None
    quantity: Optional[int] = None
    supplier: Optional[str] = None
    category: Optional[str] = None


class InventoryResponse(BaseModel):
    items: list[InventoryItem]
    raw: Optional[str] = None


class EligibilityInfo(BaseModel):
    payer_name: str = ""
    plan_type: Optional[str] = None
    member_id: str = ""
    group_number: Optional[str] = None
    subscriber_name: Optional[str] = None
    effective_date: Optional[str] = None
    copay: Optional[str] = None
    phone: Optional[str] = None


class EligibilityResponse(BaseModel):
    info: EligibilityInfo
    raw: Optional[str] = None


# ─── OpenAI helper ─────────────────────────────────────────────────────────

def _get_openai():
    if not settings.OPENAI_API_KEY:
        raise HTTPException(status_code=503, detail="OpenAI API key not configured")
    from openai import AsyncOpenAI
    return AsyncOpenAI(api_key=settings.OPENAI_API_KEY)


def _image_content(images: list[str]) -> list[dict]:
    """Build OpenAI vision content blocks from base64 images."""
    blocks = []
    for img in images:
        # Ensure it's a data URL
        if not img.startswith("data:"):
            img = f"data:image/jpeg;base64,{img}"
        blocks.append({
            "type": "image_url",
            "image_url": {"url": img, "detail": "high"},
        })
    return blocks


def _extract_json(text: str) -> str:
    """Strip markdown code fences and extract JSON."""
    text = text.strip()
    # Remove ```json ... ``` or ``` ... ```
    match = re.search(r"```(?:json)?\s*([\s\S]+?)```", text)
    if match:
        return match.group(1).strip()
    return text


# ─── Endpoints ─────────────────────────────────────────────────────────────

@router.post("/fee-schedule", response_model=FeeScheduleResponse)
async def process_fee_schedule(body: ProcessRequest):
    """Extract CPT codes and payer rates from fee schedule image(s)."""
    if not body.images:
        raise HTTPException(status_code=400, detail="No images provided")

    client = _get_openai()

    prompt = (
        "Extract all CPT/HCPCS codes and their associated rates from this fee schedule image. "
        "Return a JSON array where each item has: "
        '{ "code": "string", "description": "string", "rates": { "payer_name": rate_as_number } }. '
        "If you can identify payer names in column headers, use those. "
        'Otherwise use generic column names like "Column 1", "Column 2", etc. '
        "Return ONLY the JSON array, no other text."
    )

    content = [{"type": "text", "text": prompt}] + _image_content(body.images)

    try:
        response = await client.chat.completions.create(
            model=settings.OPENAI_MODEL or "gpt-4o",
            messages=[{"role": "user", "content": content}],
            max_tokens=4000,
        )
        raw = response.choices[0].message.content or ""
        logger.info(f"[ai_scanner] fee-schedule raw response length={len(raw)}")

        parsed = json.loads(_extract_json(raw))
        entries = [FeeScheduleEntry(**item) for item in parsed]
        return FeeScheduleResponse(entries=entries, raw=raw)

    except json.JSONDecodeError as e:
        logger.error(f"[ai_scanner] JSON parse error: {e}, raw={raw[:500]}")
        raise HTTPException(status_code=422, detail=f"AI returned unparseable JSON: {str(e)}")
    except Exception as e:
        logger.error(f"[ai_scanner] OpenAI error: {e}")
        raise HTTPException(status_code=502, detail=f"AI processing failed: {str(e)}")


@router.post("/inventory", response_model=InventoryResponse)
async def process_inventory(body: ProcessRequest):
    """Extract inventory items from image(s)."""
    if not body.images:
        raise HTTPException(status_code=400, detail="No images provided")

    client = _get_openai()

    prompt = (
        "Extract all inventory items from this image. "
        "Return a JSON array where each item has: "
        '{ "name": "string", "sku": "string or null", "brand": "string or null", '
        '"price": number or null, "quantity": number or null, '
        '"supplier": "string or null", "category": "string or null" }. '
        "Return ONLY the JSON array, no other text."
    )

    content = [{"type": "text", "text": prompt}] + _image_content(body.images)

    try:
        response = await client.chat.completions.create(
            model=settings.OPENAI_MODEL or "gpt-4o",
            messages=[{"role": "user", "content": content}],
            max_tokens=4000,
        )
        raw = response.choices[0].message.content or ""
        parsed = json.loads(_extract_json(raw))
        items = [InventoryItem(**item) for item in parsed]
        return InventoryResponse(items=items, raw=raw)

    except json.JSONDecodeError as e:
        raise HTTPException(status_code=422, detail=f"AI returned unparseable JSON: {str(e)}")
    except Exception as e:
        logger.error(f"[ai_scanner] inventory error: {e}")
        raise HTTPException(status_code=502, detail=f"AI processing failed: {str(e)}")


@router.post("/eligibility", response_model=EligibilityResponse)
async def process_eligibility(body: ProcessRequest):
    """Extract insurance card info from image(s)."""
    if not body.images:
        raise HTTPException(status_code=400, detail="No images provided")

    client = _get_openai()

    prompt = (
        "Extract insurance information from this Puerto Rico health insurance card image. "
        "CRITICAL for payer_name: Look carefully for plan type indicators like 'Vital', 'GHP', "
        "'Reforma', 'Advantage', 'Medicare', 'Classicare' logos or text ANYWHERE on the card "
        "(including watermarks, corner logos, and the ASES government logo which indicates Vital/Reforma). "
        "Include the plan type in payer_name. Examples: "
        "- Card says 'First Medical' with Vital/ASES logo → payer_name='First Medical Vital' "
        "- Card says 'Triple-S' with 'Vital' → payer_name='Triple S Vital' "
        "- Card says 'MCS' with 'Classicare' → payer_name='MCS Classicare' "
        "- Card says 'MMM' with 'Vital' → payer_name='MMM Vital' "
        "- Card says 'Triple-S' with 'Advantage' → payer_name='Triple S Advantage' "
        "- Plain 'First Medical' without Vital/ASES → payer_name='First Medical' "
        "For subscriber_name, always return as FIRST_NAME LAST_NAME format "
        "(given name first, family name last). Never return as LAST, FIRST format. "
        "For member_id, extract the full ID including any letter prefixes (like MPI number). "
        "Return JSON: "
        '{ "payer_name": "string", "plan_type": "string or null", '
        '"member_id": "string", "group_number": "string or null", '
        '"subscriber_name": "string or null", "effective_date": "YYYY-MM-DD or null", '
        '"copay": "string or null", "phone": "string or null" }. '
        "Return ONLY the JSON object, no other text."
    )

    content = [{"type": "text", "text": prompt}] + _image_content(body.images)

    try:
        response = await client.chat.completions.create(
            model=settings.OPENAI_MODEL or "gpt-4o",
            messages=[{"role": "user", "content": content}],
            max_tokens=1000,
        )
        raw = response.choices[0].message.content or ""
        parsed = json.loads(_extract_json(raw))
        info = EligibilityInfo(**parsed)
        # Normalize subscriber name to FIRST LAST format (in case AI still returns LAST, FIRST)
        if info.subscriber_name and ',' in info.subscriber_name:
            parts = info.subscriber_name.split(',', 1)
            last_part = parts[0].strip()
            first_part = parts[1].strip()
            info.subscriber_name = f"{first_part} {last_part}"
        return EligibilityResponse(info=info, raw=raw)

    except json.JSONDecodeError as e:
        raise HTTPException(status_code=422, detail=f"AI returned unparseable JSON: {str(e)}")
    except Exception as e:
        logger.error(f"[ai_scanner] eligibility error: {e}")
        raise HTTPException(status_code=502, detail=f"AI processing failed: {str(e)}")
