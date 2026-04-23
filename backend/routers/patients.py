from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, or_
from sqlalchemy.orm import selectinload

from database import get_db
from models import Patient, PatientInsurance
from schemas import PatientOut, PatientCreate, PatientUpdate
from auth import get_current_user
from models import User

router = APIRouter(prefix="/patients", tags=["patients"])


def patient_options():
    return [selectinload(Patient.insurances).selectinload(PatientInsurance.payer)]


@router.get("", response_model=dict)
async def list_patients(
    page: int = Query(1, ge=1),
    per_page: int = Query(25, ge=1, le=100),
    search: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    q = select(Patient).options(*patient_options()).where(Patient.is_active == True)
    if search:
        term = f"%{search}%"
        q = q.where(or_(
            Patient.first_name.ilike(term),
            Patient.last_name.ilike(term),
            Patient.mrn.ilike(term),
        ))
    count_q = select(func.count()).select_from(Patient).where(Patient.is_active == True)
    if search:
        term = f"%{search}%"
        count_q = count_q.where(or_(
            Patient.first_name.ilike(term),
            Patient.last_name.ilike(term),
            Patient.mrn.ilike(term),
        ))
    total = (await db.execute(count_q)).scalar_one()
    q = q.order_by(Patient.last_name).offset((page - 1) * per_page).limit(per_page)
    result = await db.execute(q)
    patients = result.scalars().all()
    return {
        "items": [PatientOut.model_validate(p) for p in patients],
        "total": total,
        "page": page,
        "per_page": per_page,
        "pages": max(1, (total + per_page - 1) // per_page),
    }


@router.post("", response_model=PatientOut, status_code=201)
async def create_patient(
    body: PatientCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    # Auto-generate MRN
    count = (await db.execute(select(func.count()).select_from(Patient))).scalar_one()
    mrn = f"PR{str(count + 1).zfill(6)}"
    patient = Patient(
        mrn=mrn,
        first_name=body.first_name,
        last_name=body.last_name,
        dob=body.dob,
        gender=body.gender,
        ssn_last4=body.ssn_last4,
        phone=body.phone,
        email=body.email,
        address_line1=body.address_line1,
        address_line2=body.address_line2,
        city=body.city,
        state=body.state,
        zip_code=body.zip_code,
    )
    db.add(patient)
    await db.flush()
    for ins in body.insurances:
        pi = PatientInsurance(patient_id=patient.id, **ins.model_dump())
        db.add(pi)
    await db.commit()
    result = await db.execute(
        select(Patient).options(*patient_options()).where(Patient.id == patient.id)
    )
    return PatientOut.model_validate(result.scalar_one())


@router.get("/{patient_id}", response_model=PatientOut)
async def get_patient(
    patient_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Patient).options(*patient_options()).where(Patient.id == patient_id)
    )
    patient = result.scalar_one_or_none()
    if not patient:
        raise HTTPException(404, "Paciente no encontrado")
    return PatientOut.model_validate(patient)


@router.patch("/{patient_id}", response_model=PatientOut)
async def update_patient(
    patient_id: int,
    body: PatientUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    result = await db.execute(select(Patient).where(Patient.id == patient_id))
    patient = result.scalar_one_or_none()
    if not patient:
        raise HTTPException(404, "Paciente no encontrado")
    for field, value in body.model_dump(exclude_none=True, exclude={"insurances"}).items():
        setattr(patient, field, value)
    await db.commit()
    result = await db.execute(
        select(Patient).options(*patient_options()).where(Patient.id == patient_id)
    )
    return PatientOut.model_validate(result.scalar_one())


@router.delete("/{patient_id}", status_code=204)
async def deactivate_patient(
    patient_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    result = await db.execute(select(Patient).where(Patient.id == patient_id))
    patient = result.scalar_one_or_none()
    if not patient:
        raise HTTPException(404, "Paciente no encontrado")
    patient.is_active = False
    await db.commit()
