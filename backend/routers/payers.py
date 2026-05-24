from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, update

from database import get_db
from models import Payer, PayerType, SubmissionMethod
from schemas import PayerOut, PayerCreate
from auth import get_current_user
from models import User

# ── Inmediata required fields per payer ID ────────────────────────────────────
# member_id, group_number, first_name, last_name, dob, gender
INMEDIATA_REQUIRED_FIELDS: dict[str, dict[str, bool]] = {
    "660194027":     {"member_id": True, "group_number": False, "first_name": False, "last_name": False, "dob": True,  "gender": False},
    "00973":         {"member_id": True, "group_number": False, "first_name": True,  "last_name": True,  "dob": True,  "gender": False},
    "660584821":     {"member_id": True, "group_number": False, "first_name": True,  "last_name": True,  "dob": False, "gender": False},
    "660537624":     {"member_id": True, "group_number": False, "first_name": True,  "last_name": True,  "dob": True,  "gender": False},
    "GHP660537624":  {"member_id": True, "group_number": False, "first_name": True,  "last_name": True,  "dob": True,  "gender": False},
    "61101":         {"member_id": True, "group_number": False, "first_name": True,  "last_name": True,  "dob": True,  "gender": False},
    "4600012":       {"member_id": True, "group_number": False, "first_name": True,  "last_name": True,  "dob": True,  "gender": False},
    "660396197P":    {"member_id": True, "group_number": True,  "first_name": False, "last_name": False, "dob": False, "gender": False},
    "660588600":     {"member_id": True, "group_number": False, "first_name": True,  "last_name": True,  "dob": True,  "gender": False},
    "660653763":     {"member_id": True, "group_number": False, "first_name": False, "last_name": False, "dob": True,  "gender": False},
    "660592131":     {"member_id": True, "group_number": False, "first_name": False, "last_name": False, "dob": False, "gender": False},
    "660202379":     {"member_id": True, "group_number": False, "first_name": False, "last_name": False, "dob": True,  "gender": False},
    "660524575":     {"member_id": True, "group_number": False, "first_name": False, "last_name": False, "dob": False, "gender": False},
    "660636242PSG":  {"member_id": True, "group_number": False, "first_name": False, "last_name": False, "dob": True,  "gender": False},
    "660636242":     {"member_id": True, "group_number": True,  "first_name": False, "last_name": False, "dob": False, "gender": False},
    "660178704":     {"member_id": True, "group_number": False, "first_name": False, "last_name": False, "dob": True,  "gender": False},
    "660647362":     {"member_id": True, "group_number": False, "first_name": True,  "last_name": True,  "dob": True,  "gender": False},
    "973MA":         {"member_id": True, "group_number": False, "first_name": False, "last_name": False, "dob": True,  "gender": False},
    "973":           {"member_id": True, "group_number": False, "first_name": False, "last_name": False, "dob": False, "gender": False},
    "62308PR":       {"member_id": True, "group_number": False, "first_name": True,  "last_name": True,  "dob": True,  "gender": False},
    "660436769":     {"member_id": True, "group_number": False, "first_name": True,  "last_name": True,  "dob": True,  "gender": False},
}

router = APIRouter(prefix="/payers", tags=["payers"])


@router.get("", response_model=dict)
async def list_payers(
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=200),
    active_only: bool = True,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    q = select(Payer)
    if active_only:
        q = q.where(Payer.is_active == True)
    total = (await db.execute(
        select(func.count()).select_from(Payer).where(Payer.is_active == True if active_only else True)
    )).scalar_one()
    q = q.order_by(Payer.name).offset((page - 1) * per_page).limit(per_page)
    result = await db.execute(q)
    return {
        "items": [PayerOut.model_validate(p) for p in result.scalars().all()],
        "total": total, "page": page, "per_page": per_page,
        "pages": max(1, (total + per_page - 1) // per_page),
    }


@router.post("", response_model=PayerOut, status_code=201)
async def create_payer(
    body: PayerCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    payer = Payer(**body.model_dump())
    db.add(payer)
    await db.commit()
    await db.refresh(payer)
    return PayerOut.model_validate(payer)


@router.post("/seed-inmediata", summary="One-time seed: populate inmediata_payer_id for known payers and add missing ones")
async def seed_inmediata_payer_ids(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Populates inmediata_payer_id for existing payers and inserts any missing Inmediata payers."""
    # ── Update existing payers by ID ──────────────────────────────────────────
    updates: dict[int, str] = {
        1: "973",
        2: "660396197P",
        3: "660588600",
        4: "660537624",
        5: "61101",
        6: "00973",
        10: "660592131",
        11: "973MA",
        12: "973",
        13: "GHP660537624",
        14: "660653763",
        15: "660636242",
        16: "660636242PSG",
        18: "4600012",
        20: "973",
        21: "973",
        22: "973MA",
    }
    for pid, inmediata_id in updates.items():
        await db.execute(
            update(Payer).where(Payer.id == pid).values(inmediata_payer_id=inmediata_id)
        )

    # ── Add new payers if they don't exist ────────────────────────────────────
    new_payers = [
        {"payer_id": "CIGNAPR",    "name": "Cigna PR",                    "inmediata_payer_id": "62308PR",      "payer_type": PayerType.COMMERCIAL},
        {"payer_id": "DELTAPR",    "name": "Delta Dental PR",              "inmediata_payer_id": "660436769",   "payer_type": PayerType.DENTAL},
        {"payer_id": "AMAESTROS",  "name": "Asociacion de Maestros",       "inmediata_payer_id": "660194027",   "payer_type": PayerType.COMMERCIAL},
        {"payer_id": "FHCPR",      "name": "FHC of PR",                    "inmediata_payer_id": "660584821",   "payer_type": PayerType.COMMERCIAL},
        {"payer_id": "PBUTM",      "name": "Plan de Bienestar UTM",        "inmediata_payer_id": "660202379",   "payer_type": PayerType.COMMERCIAL},
        {"payer_id": "BELLAVISTA", "name": "Plan de Salud Bella Vista",    "inmediata_payer_id": "660524575",   "payer_type": PayerType.COMMERCIAL},
        {"payer_id": "AUXSOCIOS",  "name": "Auxilio Plan de Socios",       "inmediata_payer_id": "660178704",   "payer_type": PayerType.COMMERCIAL},
        {"payer_id": "AUXPLUS",    "name": "Auxilio Salud Plus",           "inmediata_payer_id": "660647362",   "payer_type": PayerType.COMMERCIAL},
    ]
    inserted = 0
    for np in new_payers:
        exists = (await db.execute(select(Payer).where(Payer.payer_id == np["payer_id"]))).scalar_one_or_none()
        if not exists:
            db.add(Payer(
                payer_id=np["payer_id"],
                name=np["name"],
                inmediata_payer_id=np["inmediata_payer_id"],
                payer_type=np["payer_type"],
                submission_method=SubmissionMethod.INMEDIATA,
                is_active=True,
                state="PR",
            ))
            inserted += 1

    await db.commit()
    return {"status": "ok", "updated": len(updates), "inserted": inserted}


@router.get("/eligibility-list", summary="List payers available for Inmediata eligibility checks")
async def get_eligibility_payers(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Returns all active payers that have an Inmediata payer ID, with their required fields."""
    result = await db.execute(
        select(Payer)
        .where(Payer.inmediata_payer_id.isnot(None), Payer.is_active == True)
        .order_by(Payer.name)
    )
    payers = result.scalars().all()
    return [
        {
            "id": p.id,
            "name": p.name,
            "payer_id": p.payer_id,
            "inmediata_payer_id": p.inmediata_payer_id,
            "required_fields": INMEDIATA_REQUIRED_FIELDS.get(p.inmediata_payer_id or "", {}),
        }
        for p in payers
    ]


@router.get("/{payer_id}", response_model=PayerOut)
async def get_payer(
    payer_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    result = await db.execute(select(Payer).where(Payer.id == payer_id))
    payer = result.scalar_one_or_none()
    if not payer:
        raise HTTPException(404, "Pagador no encontrado")
    return PayerOut.model_validate(payer)


@router.patch("/{payer_id}", response_model=PayerOut)
async def update_payer(
    payer_id: int,
    body: PayerCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    result = await db.execute(select(Payer).where(Payer.id == payer_id))
    payer = result.scalar_one_or_none()
    if not payer:
        raise HTTPException(404, "Pagador no encontrado")
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(payer, field, value)
    await db.commit()
    await db.refresh(payer)
    return PayerOut.model_validate(payer)
