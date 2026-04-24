"""
Claim Templates / Superbill Profiles
Pre-configured claim templates for common visit types at Visual Zone Optical.
"""
from datetime import datetime
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel

from database import get_db
from models import ClaimTemplate, User
from auth import get_current_user

router = APIRouter(prefix="/templates", tags=["templates"])


# ── Default templates ─────────────────────────────────────────────────────────

DEFAULT_TEMPLATES = [
    {
        "name": "Comprehensive Eye Exam",
        "description": "Annual comprehensive eye exam — routine",
        "cpt_codes": [
            {"code": "92014", "desc": "Established patient eye exam", "units": 1, "amount": 180.00},
            {"code": "92015", "desc": "Refraction", "units": 1, "amount": 45.00},
        ],
        "diagnosis_codes": ["Z01.01", "H52.10"],
        "place_of_service": "11",
    },
    {
        "name": "Contact Lens Fitting",
        "description": "Contact lens fitting with comprehensive exam",
        "cpt_codes": [
            {"code": "92014", "desc": "Established patient eye exam", "units": 1, "amount": 180.00},
            {"code": "92310", "desc": "Contact lens fitting, both eyes", "units": 1, "amount": 85.00},
        ],
        "diagnosis_codes": ["H52.10", "Z97.3"],
        "place_of_service": "11",
    },
    {
        "name": "Diabetic Eye Exam",
        "description": "Diabetic retinal exam with fundus photography",
        "cpt_codes": [
            {"code": "92014", "desc": "Established patient eye exam", "units": 1, "amount": 180.00},
            {"code": "92250", "desc": "Fundus photography with interpretation", "units": 1, "amount": 95.00},
        ],
        "diagnosis_codes": ["E11.3519", "E11.9"],
        "place_of_service": "11",
    },
    {
        "name": "Glaucoma Follow-up",
        "description": "Glaucoma monitoring with visual field and OCT",
        "cpt_codes": [
            {"code": "92014", "desc": "Established patient eye exam", "units": 1, "amount": 180.00},
            {"code": "92083", "desc": "Visual field exam, extended", "units": 1, "amount": 125.00},
            {"code": "92134", "desc": "OCT — glaucoma", "units": 1, "amount": 95.00},
        ],
        "diagnosis_codes": ["H40.1110", "H40.1210"],
        "place_of_service": "11",
    },
    {
        "name": "Medical Eye Exam",
        "description": "E&M office visit for medical eye conditions",
        "cpt_codes": [
            {"code": "99213", "desc": "Office visit, established, low complexity", "units": 1, "amount": 150.00},
        ],
        "diagnosis_codes": [],
        "place_of_service": "11",
    },
    {
        "name": "New Patient Eye Exam",
        "description": "Comprehensive exam for new patient",
        "cpt_codes": [
            {"code": "92004", "desc": "New patient comprehensive eye exam", "units": 1, "amount": 220.00},
            {"code": "92015", "desc": "Refraction", "units": 1, "amount": 45.00},
        ],
        "diagnosis_codes": ["Z01.01"],
        "place_of_service": "11",
    },
]


# ── Pydantic schemas ──────────────────────────────────────────────────────────

class CPTCodeItem(BaseModel):
    code: str
    desc: str = ""
    units: int = 1
    amount: float = 0.0


class TemplateCreate(BaseModel):
    name: str
    description: Optional[str] = None
    cpt_codes: List[CPTCodeItem] = []
    diagnosis_codes: List[str] = []
    place_of_service: str = "11"


class TemplateUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    cpt_codes: Optional[List[CPTCodeItem]] = None
    diagnosis_codes: Optional[List[str]] = None
    place_of_service: Optional[str] = None
    is_active: Optional[bool] = None


class TemplateOut(BaseModel):
    id: int
    name: str
    description: Optional[str]
    cpt_codes: list
    diagnosis_codes: list
    place_of_service: str
    is_active: bool
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


# ── Seed helper ───────────────────────────────────────────────────────────────

async def seed_default_templates(db: AsyncSession) -> None:
    """Insert default templates if the table is empty."""
    result = await db.execute(select(ClaimTemplate).limit(1))
    if result.scalar_one_or_none() is not None:
        return  # Already seeded

    for tmpl in DEFAULT_TEMPLATES:
        t = ClaimTemplate(
            name=tmpl["name"],
            description=tmpl["description"],
            cpt_codes=[c for c in tmpl["cpt_codes"]],
            diagnosis_codes=tmpl["diagnosis_codes"],
            place_of_service=tmpl["place_of_service"],
        )
        db.add(t)
    await db.commit()


# ── API Endpoints ─────────────────────────────────────────────────────────────

@router.get("/", response_model=List[TemplateOut])
async def list_templates(
    active_only: bool = True,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """List all claim templates."""
    await seed_default_templates(db)
    q = select(ClaimTemplate)
    if active_only:
        q = q.where(ClaimTemplate.is_active == True)
    result = await db.execute(q.order_by(ClaimTemplate.name))
    return result.scalars().all()


@router.get("/{template_id}", response_model=TemplateOut)
async def get_template(
    template_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    result = await db.execute(select(ClaimTemplate).where(ClaimTemplate.id == template_id))
    t = result.scalar_one_or_none()
    if not t:
        raise HTTPException(404, "Template not found")
    return t


@router.post("/", response_model=TemplateOut, status_code=201)
async def create_template(
    body: TemplateCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    t = ClaimTemplate(
        name=body.name,
        description=body.description,
        cpt_codes=[c.model_dump() for c in body.cpt_codes],
        diagnosis_codes=body.diagnosis_codes,
        place_of_service=body.place_of_service,
    )
    db.add(t)
    await db.commit()
    await db.refresh(t)
    return t


@router.patch("/{template_id}", response_model=TemplateOut)
async def update_template(
    template_id: int,
    body: TemplateUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    result = await db.execute(select(ClaimTemplate).where(ClaimTemplate.id == template_id))
    t = result.scalar_one_or_none()
    if not t:
        raise HTTPException(404, "Template not found")

    if body.name is not None:
        t.name = body.name
    if body.description is not None:
        t.description = body.description
    if body.cpt_codes is not None:
        t.cpt_codes = [c.model_dump() for c in body.cpt_codes]
    if body.diagnosis_codes is not None:
        t.diagnosis_codes = body.diagnosis_codes
    if body.place_of_service is not None:
        t.place_of_service = body.place_of_service
    if body.is_active is not None:
        t.is_active = body.is_active

    await db.commit()
    await db.refresh(t)
    return t


@router.delete("/{template_id}", status_code=204)
async def delete_template(
    template_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    result = await db.execute(select(ClaimTemplate).where(ClaimTemplate.id == template_id))
    t = result.scalar_one_or_none()
    if not t:
        raise HTTPException(404, "Template not found")
    t.is_active = False  # Soft delete
    await db.commit()
