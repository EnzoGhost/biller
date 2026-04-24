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


# ── Wink Push Endpoint (Wink calls this directly) ────────────────────────────────

from typing import List
from pydantic import BaseModel


class WinkInsurancePayload(BaseModel):
    payer_name: Optional[str] = None
    payer_id_string: Optional[str] = None  # e.g. "TSS-123456"
    member_id: Optional[str] = None
    group_number: Optional[str] = None
    prior_auth_number: Optional[str] = None
    is_primary: bool = True


class WinkServiceLinePayload(BaseModel):
    cpt_code: str
    units: int = 1
    amount: float = 0.0
    modifiers: List[str] = []
    description: Optional[str] = None


class WinkEncounterPayload(BaseModel):
    """Full encounter from Wink when Ruth clicks 'Send to Biller'."""
    # Patient
    patient_first_name: str
    patient_last_name: str
    patient_dob: str  # ISO date string
    patient_gender: Optional[str] = None
    patient_phone: Optional[str] = None
    patient_email: Optional[str] = None
    patient_address: Optional[str] = None
    patient_city: Optional[str] = None
    patient_state: Optional[str] = "PR"
    patient_zip: Optional[str] = None
    wink_patient_id: Optional[str] = None
    # Exam / Encounter
    encounter_date: str  # ISO date string
    place_of_service: str = "11"
    # Clinical data
    diagnoses: List[str] = []  # ICD-10 codes
    procedures: List[WinkServiceLinePayload] = []
    # Insurance
    insurance: Optional[WinkInsurancePayload] = None
    prior_auth_number: Optional[str] = None
    # Provider
    provider_npi: Optional[str] = None
    provider_id: Optional[int] = None
    # Identifiers
    wink_encounter_id: Optional[str] = None
    notes: Optional[str] = None


@router.post("/wink/encounter")
async def receive_wink_encounter(
    payload: WinkEncounterPayload,
    db: AsyncSession = Depends(get_db),
    # Note: authentication may use API key header in production
    # For now using same JWT auth
    _: User = Depends(get_current_user),
):
    """
    Receive a full encounter from Wink's 'Send to Biller' integration.
    - Auto-creates patient if not exists (matches by first+last+DOB)
    - Auto-creates claim in 'draft' status with all service lines
    - Auto-detects routing (Envolve vs Stedi vs Inmediata)
    - Auto-runs validation scrub
    - Auto-advances to 'ready' if validation passes
    - Returns claim ID, validation results, and routing suggestion
    """
    import json as _json
    import random, string as _string
    from datetime import datetime
    from routers.validation import validate_claim

    errors = []

    # ── 1. Parse dates ───────────────────────────────────────────────────────────
    try:
        dob = date.fromisoformat(payload.patient_dob[:10])
    except (ValueError, TypeError):
        dob = date(1970, 1, 1)
        errors.append("Invalid patient_dob — defaulted to 1970-01-01")

    try:
        svc_date = date.fromisoformat(payload.encounter_date[:10])
    except (ValueError, TypeError):
        svc_date = date.today()
        errors.append("Invalid encounter_date — defaulted to today")

    # ── 2. Find or create patient ─────────────────────────────────────────────────
    patient = None

    # Try by wink_patient_id first
    if payload.wink_patient_id:
        res = await db.execute(
            select(Patient).where(Patient.wink_patient_id == payload.wink_patient_id)
        )
        patient = res.scalar_one_or_none()

    # Then by name + DOB
    if not patient:
        res = await db.execute(
            select(Patient).where(
                Patient.first_name.ilike(payload.patient_first_name),
                Patient.last_name.ilike(payload.patient_last_name),
                Patient.dob == dob,
            )
        )
        patient = res.scalar_one_or_none()

    if not patient:
        gender_str = (payload.patient_gender or "").lower()
        gender = Gender.M if gender_str == "male" else (Gender.F if gender_str == "female" else Gender.U)
        patient = Patient(
            wink_patient_id=payload.wink_patient_id,
            first_name=payload.patient_first_name,
            last_name=payload.patient_last_name,
            dob=dob,
            gender=gender,
            phone=payload.patient_phone,
            email=payload.patient_email,
            address_line1=payload.patient_address,
            city=payload.patient_city or "Manatí",
            state=payload.patient_state or "PR",
            zip_code=payload.patient_zip,
        )
        db.add(patient)
        await db.flush()

    # ── 3. Resolve provider ────────────────────────────────────────────────────────────
    from models import Provider as ProviderModel

    provider_id = payload.provider_id
    if not provider_id and payload.provider_npi:
        prov_res = await db.execute(
            select(ProviderModel).where(ProviderModel.npi == payload.provider_npi)
        )
        prov = prov_res.scalar_one_or_none()
        if prov:
            provider_id = prov.id

    if not provider_id:
        # Default to first active provider
        prov_res = await db.execute(
            select(ProviderModel).where(ProviderModel.is_active == True).limit(1)
        )
        prov = prov_res.scalar_one_or_none()
        if prov:
            provider_id = prov.id
        else:
            errors.append("No provider found — claim created without provider")
            provider_id = 1  # fallback

    # ── 4. Resolve payer & detect routing ────────────────────────────────────────
    from models import Payer as PayerModel, SubmissionMethod
    from routers.validation import VISION_CPT_CODES, MEDICAL_EYE_DX_PREFIXES

    payer_id = None
    routing_suggestion = None

    if payload.insurance:
        # Try to match payer by name
        payer_name = payload.insurance.payer_name or ""
        payer_res = await db.execute(
            select(PayerModel).where(
                PayerModel.name.ilike(f"%{payer_name}%"),
                PayerModel.is_active == True,
            ).limit(1)
        )
        payer = payer_res.scalar_one_or_none()
        if payer:
            payer_id = payer.id

        # Create patient insurance record if member_id provided
        if payer_id and payload.insurance.member_id:
            ins = PatientInsurance(
                patient_id=patient.id,
                payer_id=payer_id,
                member_id=payload.insurance.member_id,
                group_number=payload.insurance.group_number,
                is_primary=payload.insurance.is_primary,
            )
            db.add(ins)

    # Auto-detect routing based on CPT codes and diagnoses
    cpt_codes = [p.cpt_code for p in payload.procedures]
    dx_codes = payload.diagnoses

    has_vision_cpts = any(c in VISION_CPT_CODES for c in cpt_codes)
    has_medical_dx = any(
        any(dx.startswith(pfx) for pfx in MEDICAL_EYE_DX_PREFIXES)
        for dx in dx_codes
    )

    if has_vision_cpts and not has_medical_dx:
        routing_suggestion = "envolve"
    elif has_medical_dx:
        routing_suggestion = "medical_bypass"
    else:
        # Route to Stedi or Inmediata based on payer
        if payer_id:
            payer_res2 = await db.execute(select(PayerModel).where(PayerModel.id == payer_id))
            p2 = payer_res2.scalar_one_or_none()
            if p2:
                routing_suggestion = (
                    "stedi" if p2.submission_method == SubmissionMethod.STEDI else "inmediata"
                )
        if not routing_suggestion:
            routing_suggestion = "inmediata"  # default for PR

    # ── 5. Skip duplicate check ───────────────────────────────────────────────────
    if payload.wink_encounter_id:
        dup_res = await db.execute(
            select(Claim).where(
                Claim.source == "wink",
                Claim.external_ref == f"enc_{payload.wink_encounter_id}",
            )
        )
        dup = dup_res.scalar_one_or_none()
        if dup:
            return {
                "claim_id": dup.id,
                "claim_number": dup.claim_number,
                "status": "already_imported",
                "routing": routing_suggestion,
                "validation": None,
                "errors": [f"Encounter {payload.wink_encounter_id} already imported as {dup.claim_number}"],
            }

    # ── 6. Create claim ────────────────────────────────────────────────────────────
    ts = datetime.utcnow().strftime("%Y%m%d")
    suffix = "".join(random.choices(_string.ascii_uppercase + _string.digits, k=6))
    total_billed = sum(p.amount * p.units for p in payload.procedures)

    claim = Claim(
        claim_number=f"CLM-{ts}-{suffix}",
        patient_id=patient.id,
        provider_id=provider_id,
        payer_id=payer_id or 1,
        service_date_from=svc_date,
        service_date_to=svc_date,
        diagnosis_codes=dx_codes,
        total_billed=total_billed,
        prior_auth_number=payload.prior_auth_number or (
            payload.insurance.prior_auth_number if payload.insurance else None
        ),
        status=ClaimStatus.DRAFT,
        source="wink",
        external_ref=f"enc_{payload.wink_encounter_id}" if payload.wink_encounter_id else None,
        place_of_service=payload.place_of_service,
        notes=payload.notes,
    )
    db.add(claim)
    await db.flush()

    for i, proc in enumerate(payload.procedures, start=1):
        sl = ServiceLine(
            claim_id=claim.id,
            line_number=i,
            cpt_code=proc.cpt_code,
            description=proc.description,
            modifiers=proc.modifiers,
            service_date=svc_date,
            units=proc.units,
            billed_amount=proc.amount,
            diagnosis_pointers=[j + 1 for j in range(min(len(dx_codes), 4))] if dx_codes else [],
        )
        db.add(sl)

    await db.commit()

    # ── 7. Auto-validate ────────────────────────────────────────────────────────────
    validation_result = await validate_claim(claim.id, db)

    # ── 8. Auto-advance to 'ready' if validation passes ────────────────────────────
    if validation_result.get("is_valid") and not errors:
        from sqlalchemy import update
        await db.execute(
            update(Claim).where(Claim.id == claim.id).values(status=ClaimStatus.READY)
        )
        await db.commit()
        final_status = "ready"
    else:
        final_status = "draft"

    return {
        "claim_id": claim.id,
        "claim_number": claim.claim_number,
        "status": final_status,
        "routing": routing_suggestion,
        "validation": validation_result,
        "errors": errors,
    }


# ── Wink Integration (pull from local SQLite) ───────────────────────────────────────────

def _wink_conn():
    """Open a read-only connection to the Wink (iris) SQLite database."""
    if not settings.WINK_DB_PATH:
        raise HTTPException(400, "WINK_DB_PATH no configurado. Configure la ruta a la base de datos de Wink.")
    try:
        conn = sqlite3.connect(f"file:{settings.WINK_DB_PATH}?mode=ro", uri=True)
    except sqlite3.OperationalError:
        # Fall back to normal (not URI-mode) if path has no read-only flag support
        conn = sqlite3.connect(settings.WINK_DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


@router.post("/wink", response_model=ImportResult)
async def import_from_wink(
    provider_id: int,
    default_payer_id: Optional[int] = None,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """
    Pull patients from Wink's iris.db SQLite database.
    Maps Wink patient schema to Biller patients, skips duplicates by wink_patient_id.
    Also imports patient insurance data when available.
    """
    imported = 0
    skipped = 0
    errors = []
    claim_ids: list[int] = []

    try:
        conn = _wink_conn()
        cursor = conn.cursor()

        # iris.db patients schema:
        # id, first_name, last_name, date_of_birth, gender (male/female/other),
        # phone, mobile, email, address, city, state, zip, record_number,
        # insurance_provider, insurance_id, insurance_group, active
        try:
            cursor.execute("""
                SELECT p.id,
                       p.first_name, p.last_name,
                       p.date_of_birth, p.gender,
                       p.phone, p.mobile, p.email,
                       p.address, p.city, p.state, p.zip,
                       p.record_number,
                       p.insurance_provider, p.insurance_id, p.insurance_group
                FROM patients p
                WHERE p.active = 1
                LIMIT 500
            """)
            wink_patients = cursor.fetchall()
        except sqlite3.OperationalError as e:
            raise HTTPException(500, f"Error leyendo tabla patients de Wink DB: {e}")

        # Pre-load existing patient insurance enrollments from patient_insurance table
        try:
            cursor.execute("""
                SELECT pi.patient_id, ip.name AS plan_name, pi.member_id, pi.is_primary
                FROM patient_insurance pi
                JOIN insurance_plans ip ON ip.id = pi.insurance_plan_id
                WHERE pi.is_primary = 1
            """)
            wink_ins_rows = cursor.fetchall()
            wink_insurance_map: dict[int, sqlite3.Row] = {}
            for row in wink_ins_rows:
                pid = row["patient_id"]
                if pid not in wink_insurance_map:
                    wink_insurance_map[pid] = row
        except sqlite3.OperationalError:
            wink_insurance_map = {}

        for wp in wink_patients:
            # Skip if already imported
            existing = await db.execute(
                select(Patient).where(Patient.wink_patient_id == str(wp["id"]))
            )
            if existing.scalar_one_or_none():
                skipped += 1
                continue

            try:
                raw_dob = wp["date_of_birth"]
                if raw_dob:
                    try:
                        dob = date.fromisoformat(raw_dob[:10])
                    except ValueError:
                        dob = date(1970, 1, 1)
                else:
                    dob = date(1970, 1, 1)

                gender_str = (wp["gender"] or "").lower()
                gender = Gender.M if gender_str == "male" else (Gender.F if gender_str == "female" else Gender.U)

                patient = Patient(
                    wink_patient_id=str(wp["id"]),
                    mrn=wp["record_number"],
                    first_name=wp["first_name"] or "",
                    last_name=wp["last_name"] or "",
                    dob=dob,
                    gender=gender,
                    phone=wp["phone"] or wp["mobile"],
                    email=wp["email"],
                    address_line1=wp["address"],
                    city=wp["city"] or "San Juan",
                    state=wp["state"] or "PR",
                    zip_code=wp["zip"],
                )
                db.add(patient)
                await db.flush()

                # Insurance: prefer payer from patient_insurance join, fall back to inline fields
                if default_payer_id:
                    wink_ins = wink_insurance_map.get(wp["id"])
                    member_id = (wink_ins["member_id"] if wink_ins and wink_ins["member_id"] else None) \
                                or wp["insurance_id"] \
                                or f"WINK-{wp['id']}"
                    ins = PatientInsurance(
                        patient_id=patient.id,
                        payer_id=default_payer_id,
                        member_id=member_id,
                        group_number=wp["insurance_group"],
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


@router.post("/wink/encounters", response_model=ImportResult)
async def import_wink_encounters(
    provider_id: int,
    payer_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """
    Import completed/signed exam encounters from Wink (iris.db) as DRAFT claims.
    Skips encounters already imported (tracked via Claim.external_ref = 'enc_{id}').
    Maps diagnosis_a-d to ICD-10 codes and procedures_cpt to CPT service lines.
    """
    import json as _json
    import random, string
    from datetime import datetime

    imported = 0
    skipped = 0
    errors = []
    claim_ids: list[int] = []

    try:
        conn = _wink_conn()
        cursor = conn.cursor()

        try:
            cursor.execute("""
                SELECT ee.id, ee.patient_id, ee.encounter_date, ee.status,
                       ee.diagnosis_a, ee.diagnosis_b, ee.diagnosis_c, ee.diagnosis_d,
                       ee.procedures_cpt, ee.assessment, ee.plan
                FROM exam_encounters ee
                WHERE ee.status IN ('completed', 'signed')
                ORDER BY ee.encounter_date DESC
                LIMIT 500
            """)
            encounters = cursor.fetchall()
        except sqlite3.OperationalError as e:
            raise HTTPException(500, f"Error leyendo exam_encounters de Wink DB: {e}")

        conn.close()

        for enc in encounters:
            enc_ref = f"enc_{enc['id']}"

            # Skip if already imported
            existing = await db.execute(
                select(Claim).where(
                    Claim.source == "wink",
                    Claim.external_ref == enc_ref,
                )
            )
            if existing.scalar_one_or_none():
                skipped += 1
                continue

            # Find matching biller patient by wink_patient_id
            patient_result = await db.execute(
                select(Patient).where(Patient.wink_patient_id == str(enc["patient_id"]))
            )
            patient = patient_result.scalar_one_or_none()
            if not patient:
                errors.append(f"Encuentro {enc['id']}: paciente Wink {enc['patient_id']} no importado aún")
                skipped += 1
                continue

            try:
                # Service date
                raw_date = enc["encounter_date"]
                try:
                    svc_date = date.fromisoformat(raw_date[:10]) if raw_date else date.today()
                except ValueError:
                    svc_date = date.today()

                # Diagnosis codes (ICD-10)
                dx_codes = [
                    c for c in [
                        enc["diagnosis_a"], enc["diagnosis_b"],
                        enc["diagnosis_c"], enc["diagnosis_d"],
                    ] if c
                ]

                # CPT procedures — stored as JSON array string or plain text
                cpt_list: list[dict] = []
                raw_cpt = enc["procedures_cpt"]
                if raw_cpt:
                    try:
                        parsed = _json.loads(raw_cpt)
                        if isinstance(parsed, list):
                            cpt_list = parsed
                    except (_json.JSONDecodeError, TypeError):
                        # Plain comma-separated CPT codes
                        for code in raw_cpt.split(","):
                            code = code.strip()
                            if code:
                                cpt_list.append({"code": code, "units": 1, "amount": 0.0})

                # Default to a comprehensive eye exam if no CPT codes present
                if not cpt_list:
                    cpt_list = [{"code": "92014", "units": 1, "amount": 0.0}]

                total_billed = sum(float(c.get("amount", 0) or 0) for c in cpt_list)

                ts = datetime.utcnow().strftime("%Y%m%d")
                suffix = "".join(random.choices(string.ascii_uppercase + string.digits, k=6))

                claim = Claim(
                    claim_number=f"CLM-{ts}-{suffix}",
                    patient_id=patient.id,
                    provider_id=provider_id,
                    payer_id=payer_id,
                    service_date_from=svc_date,
                    service_date_to=svc_date,
                    diagnosis_codes=dx_codes,
                    total_billed=total_billed,
                    status=ClaimStatus.DRAFT,
                    source="wink",
                    external_ref=enc_ref,
                    place_of_service="11",
                )
                db.add(claim)
                await db.flush()

                for i, cpt_item in enumerate(cpt_list, start=1):
                    code = cpt_item.get("code") or "92014"
                    units = int(cpt_item.get("units") or 1)
                    amount = float(cpt_item.get("amount") or 0.0)
                    sl = ServiceLine(
                        claim_id=claim.id,
                        line_number=i,
                        cpt_code=code,
                        service_date=svc_date,
                        units=units,
                        billed_amount=amount,
                        diagnosis_pointers=[1] if dx_codes else [],
                    )
                    db.add(sl)

                claim_ids.append(claim.id)
                imported += 1
            except Exception as e:
                errors.append(f"Encuentro {enc['id']}: {e}")
                skipped += 1

        await db.commit()

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Error importando encuentros: {e}")

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
