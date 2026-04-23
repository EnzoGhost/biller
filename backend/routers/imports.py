"""
Data import endpoints:
- Wink (iris) patient/encounter import
- Generic superbill CSV import
"""
import csv
import io
import sqlite3
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, UploadFile, File, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from config import settings
from database import get_db
from models import Patient, Provider, Payer, Claim, ServiceLine, PatientInsurance, ClaimStatus, Gender
from schemas import ImportResult
from auth import get_current_user
from models import User

router = APIRouter(prefix="/import", tags=["import"])


# ── Wink Integration ──────────────────────────────────────────────────────────

@router.post("/wink", response_model=ImportResult)
async def import_from_wink(
    provider_id: int,
    default_payer_id: Optional[int] = None,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """
    Pull patients and encounters from Wink's SQLite database.
    Creates patients and DRAFT claims in Biller.
    """
    if not settings.WINK_DB_PATH:
        raise HTTPException(400, "WINK_DB_PATH no configurado. Configure la ruta a la base de datos de Wink.")

    imported = 0
    skipped = 0
    errors = []
    claim_ids = []

    try:
        conn = sqlite3.connect(settings.WINK_DB_PATH)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()

        # Try to fetch patients from Wink
        try:
            cursor.execute("""
                SELECT p.id, p.first_name, p.last_name, p.dob, p.gender,
                       p.phone, p.email, p.address, p.city, p.zip_code
                FROM patients p
                WHERE p.is_active = 1
                LIMIT 500
            """)
            wink_patients = cursor.fetchall()
        except sqlite3.OperationalError as e:
            raise HTTPException(500, f"Error leyendo Wink DB: {e}")

        for wp in wink_patients:
            # Check if patient already imported
            existing = await db.execute(
                select(Patient).where(Patient.wink_patient_id == str(wp["id"]))
            )
            if existing.scalar_one_or_none():
                skipped += 1
                continue

            try:
                dob = date.fromisoformat(wp["dob"]) if wp["dob"] else date(1970, 1, 1)
                gender_map = {"M": Gender.M, "F": Gender.F}
                gender = gender_map.get((wp["gender"] or "").upper(), Gender.U)

                patient = Patient(
                    wink_patient_id=str(wp["id"]),
                    first_name=wp["first_name"] or "",
                    last_name=wp["last_name"] or "",
                    dob=dob,
                    gender=gender,
                    phone=wp["phone"],
                    email=wp["email"],
                    address_line1=wp["address"],
                    city=wp["city"] or "San Juan",
                    state="PR",
                    zip_code=wp["zip_code"],
                )
                db.add(patient)
                await db.flush()

                # Add default insurance if payer specified
                if default_payer_id:
                    ins = PatientInsurance(
                        patient_id=patient.id,
                        payer_id=default_payer_id,
                        member_id=f"WINK-{wp['id']}",
                        is_primary=True,
                    )
                    db.add(ins)

                imported += 1
            except Exception as e:
                errors.append(f"Paciente {wp['id']}: {e}")
                skipped += 1

        conn.close()
        await db.commit()

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Error de importación: {e}")

    return ImportResult(imported=imported, skipped=skipped, errors=errors, claims_created=claim_ids)


# ── Superbill CSV Import ──────────────────────────────────────────────────────

REQUIRED_COLS = {"patient_last_name", "patient_first_name", "dob", "service_date", "cpt_code", "billed_amount"}

@router.post("/superbill", response_model=ImportResult)
async def import_superbill_csv(
    file: UploadFile = File(...),
    provider_id: int = 1,
    default_payer_id: Optional[int] = None,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """
    Import claims from a superbill CSV file.

    Expected columns (case-insensitive):
    patient_last_name, patient_first_name, dob, service_date, cpt_code,
    billed_amount, [icd10_1, icd10_2, icd10_3, icd10_4],
    [modifier_1, modifier_2], [units], [payer_id], [member_id], [diagnosis_codes]
    """
    if not file.filename.endswith(".csv"):
        raise HTTPException(400, "Solo se aceptan archivos .csv")

    content = await file.read()
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = content.decode("latin-1")

    reader = csv.DictReader(io.StringIO(text))
    # Normalize column names
    fieldnames = [f.strip().lower().replace(" ", "_") for f in (reader.fieldnames or [])]

    missing = REQUIRED_COLS - set(fieldnames)
    if missing:
        raise HTTPException(400, f"Columnas requeridas faltantes: {missing}")

    imported = 0
    skipped = 0
    errors = []
    claim_ids = []

    for i, row in enumerate(reader):
        # Normalize keys
        row = {k.strip().lower().replace(" ", "_"): v.strip() for k, v in row.items()}
        line_num = i + 2

        try:
            dob = date.fromisoformat(row["dob"])
            svc_date = date.fromisoformat(row["service_date"])
        except ValueError as e:
            errors.append(f"Línea {line_num}: fecha inválida — {e}")
            skipped += 1
            continue

        try:
            billed = float(row["billed_amount"])
        except ValueError:
            errors.append(f"Línea {line_num}: monto_facturado inválido")
            skipped += 1
            continue

        # Find or create patient
        existing = await db.execute(
            select(Patient).where(
                Patient.last_name.ilike(row["patient_last_name"]),
                Patient.first_name.ilike(row["patient_first_name"]),
                Patient.dob == dob,
            )
        )
        patient = existing.scalar_one_or_none()
        if not patient:
            patient = Patient(
                first_name=row["patient_first_name"],
                last_name=row["patient_last_name"],
                dob=dob,
                gender=Gender.U,
                state="PR",
            )
            db.add(patient)
            await db.flush()

            # Add insurance from CSV if available
            payer_id = int(row.get("payer_id") or 0) or default_payer_id
            if payer_id:
                ins = PatientInsurance(
                    patient_id=patient.id,
                    payer_id=payer_id,
                    member_id=row.get("member_id") or f"CSV-{i}",
                    is_primary=True,
                )
                db.add(ins)

        # Build diagnosis codes
        dx_codes = []
        for j in range(1, 5):
            dx = row.get(f"icd10_{j}", "").strip()
            if dx:
                dx_codes.append(dx)
        if not dx_codes and row.get("diagnosis_codes"):
            dx_codes = [c.strip() for c in row["diagnosis_codes"].split(",") if c.strip()]

        # Build modifiers
        modifiers = []
        for j in range(1, 3):
            mod = row.get(f"modifier_{j}", "").strip()
            if mod:
                modifiers.append(mod)

        payer_id = int(row.get("payer_id") or 0) or default_payer_id
        if not payer_id:
            errors.append(f"Línea {line_num}: sin payer_id — reclamación omitida")
            skipped += 1
            continue

        units = int(row.get("units") or 1)

        import random, string
        from datetime import datetime
        ts = datetime.utcnow().strftime("%Y%m%d")
        suffix = "".join(random.choices(string.ascii_uppercase + string.digits, k=6))

        claim = Claim(
            claim_number=f"CLM-{ts}-{suffix}",
            patient_id=patient.id,
            provider_id=provider_id,
            payer_id=payer_id,
            service_date_from=svc_date,
            diagnosis_codes=dx_codes,
            total_billed=billed * units,
            status=ClaimStatus.DRAFT,
            source="csv",
        )
        db.add(claim)
        await db.flush()

        sl = ServiceLine(
            claim_id=claim.id,
            line_number=1,
            cpt_code=row["cpt_code"],
            modifiers=modifiers,
            service_date=svc_date,
            units=units,
            billed_amount=billed,
            diagnosis_pointers=[1] if dx_codes else [],
        )
        db.add(sl)
        claim_ids.append(claim.id)
        imported += 1

    await db.commit()
    return ImportResult(imported=imported, skipped=skipped, errors=errors, claims_created=claim_ids)


# ── Download CSV Template ─────────────────────────────────────────────────────

@router.get("/template")
async def download_template():
    """Return a sample superbill CSV template."""
    from fastapi.responses import Response
    template = (
        "patient_last_name,patient_first_name,dob,service_date,cpt_code,billed_amount,"
        "icd10_1,icd10_2,modifier_1,modifier_2,units,payer_id,member_id\n"
        "Rivera,Carlos,1978-06-15,2025-03-10,99213,150.00,J06.9,,,,1,1,TSS-987654321\n"
        "Martínez,Ana,1990-11-22,2025-03-10,99214,200.00,E11.9,I10,-25,,1,2,MCS-123456789\n"
        "González,Luis,1965-03-01,2025-03-11,93000,95.00,I10,,,,,3,MMM-456789012\n"
        "Ortiz,María,2000-08-30,2025-03-11,97110,85.00,M54.5,,-LT,,2,1,TSS-111222333\n"
    )
    return Response(
        content=template,
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=superbill_template.csv"},
    )
