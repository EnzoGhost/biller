"""
Data import endpoints:
- AngelWink (iris) patient/encounter import
- Generic superbill CSV import
"""
import csv
import io
import sqlite3
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, UploadFile, File, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, text

from config import settings
from database import get_db
from models import Patient, Provider, Payer, Claim, ServiceLine, PatientInsurance, ClaimStatus, Gender
from schemas import ImportResult
from auth import get_current_user
from models import User

router = APIRouter(prefix="/import", tags=["import"])


# ── AngelWink Push Endpoint (AngelWink calls this directly) ────────────────────────────────

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
    """Full encounter from AngelWink when Ruth clicks 'Send to Biller'."""
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
async def receive_angelwink_encounter(
    payload: WinkEncounterPayload,
    db: AsyncSession = Depends(get_db),
    # Note: authentication may use API key header in production
    # For now using same JWT auth
    _: User = Depends(get_current_user),
):
    """
    Receive a full encounter from AngelWink's 'Send to Biller' integration.
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
                if p2.submission_method == SubmissionMethod.STEDI:
                    routing_suggestion = "stedi"
                elif p2.submission_method == SubmissionMethod.INMEDIATA:
                    routing_suggestion = "inmediata"
                else:
                    routing_suggestion = "manual"  # unknown payer — needs manual routing
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

    # ── 8. Run full scrub, persist results, auto-advance only if ZERO warnings+errors ──
    try:
        from routers.ai import _scrub_patient, _scrub_provider, _scrub_payer, _scrub_claim_level, _scrub_service_lines
        from sqlalchemy.orm import selectinload as _sil_scrub
        # Re-query claim with eager loading to avoid lazy-load crashes in async context
        _fresh_result = await db.execute(
            select(Claim)
            .options(
                _sil_scrub(Claim.patient).selectinload(Patient.insurances),
                _sil_scrub(Claim.provider),
                _sil_scrub(Claim.payer),
                _sil_scrub(Claim.service_lines),
            )
            .where(Claim.id == claim.id)
        )
        fresh_claim = _fresh_result.scalar_one_or_none()
        if not fresh_claim:
            final_status = "draft"
        else:
            scrub_issues = []
            _scrub_patient(fresh_claim, scrub_issues)
            _scrub_provider(fresh_claim, scrub_issues)
            _scrub_payer(fresh_claim, scrub_issues)
            _scrub_claim_level(fresh_claim, scrub_issues)
            _scrub_service_lines(fresh_claim, scrub_issues)
            err_count = sum(1 for i in scrub_issues if i.get('type') == 'error')
            warn_count = sum(1 for i in scrub_issues if i.get('type') == 'warning')
            scrub_score = max(0, 100 - err_count * 25 - warn_count * 5)
            from sqlalchemy import update as sql_update
            await db.execute(sql_update(Claim).where(Claim.id == fresh_claim.id).values(
                scrub_score=scrub_score, scrub_issues=scrub_issues
            ))
            if err_count == 0 and warn_count == 0:
                await db.execute(sql_update(Claim).where(Claim.id == fresh_claim.id).values(status=ClaimStatus.READY))
                final_status = "ready"
            else:
                final_status = "draft"
            await db.commit()
    except Exception:
        import traceback; traceback.print_exc()
        final_status = "draft"

    return {
        "claim_id": claim.id,
        "claim_number": claim.claim_number,
        "status": final_status,
        "routing": routing_suggestion,
        "validation": validation_result,
        "errors": errors,
    }


# ── AngelWink Integration (pull from local SQLite) ───────────────────────────────────────────

def _angelwink_conn():
    """Open a read-only connection to the AngelWink (iris) SQLite database."""
    if not settings.ANGELWINK_DB_PATH:
        raise HTTPException(400, "ANGELWINK_DB_PATH no configurado. Configure la ruta a la base de datos de AngelWink.")
    try:
        conn = sqlite3.connect(f"file:{settings.ANGELWINK_DB_PATH}?mode=ro", uri=True)
    except sqlite3.OperationalError:
        # Fall back to normal (not URI-mode) if path has no read-only flag support
        conn = sqlite3.connect(settings.ANGELWINK_DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


@router.post("/wink", response_model=ImportResult)
async def import_from_angelwink(
    provider_id: int,
    default_payer_id: Optional[int] = None,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """
    Pull patients from AngelWink's iris.db SQLite database.
    Maps AngelWink patient schema to Biller patients, skips duplicates by wink_patient_id.
    Also imports patient insurance data when available.
    """
    imported = 0
    skipped = 0
    errors = []
    claim_ids: list[int] = []

    try:
        conn = _angelwink_conn()
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
            angelwink_patients = cursor.fetchall()
        except sqlite3.OperationalError as e:
            raise HTTPException(500, f"Error leyendo tabla patients de AngelWink DB: {e}")

        # Pre-load existing patient insurance enrollments from patient_insurance table
        try:
            cursor.execute("""
                SELECT pi.patient_id, ip.name AS plan_name, pi.member_id, pi.is_primary
                FROM patient_insurance pi
                JOIN insurance_plans ip ON ip.id = pi.insurance_plan_id
                WHERE pi.is_primary = 1
            """)
            angelwink_ins_rows = cursor.fetchall()
            angelwink_insurance_map: dict[int, sqlite3.Row] = {}
            for row in angelwink_ins_rows:
                pid = row["patient_id"]
                if pid not in angelwink_insurance_map:
                    angelwink_insurance_map[pid] = row
        except sqlite3.OperationalError:
            angelwink_insurance_map = {}

        for wp in angelwink_patients:
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
                # Only create insurance if there is a REAL member_id — never use fake WINK- IDs
                if default_payer_id:
                    angelwink_ins = angelwink_insurance_map.get(wp["id"])
                    real_member_id = (angelwink_ins["member_id"] if angelwink_ins and angelwink_ins["member_id"] else None) \
                                     or wp["insurance_id"] or None
                    if real_member_id:
                        ins = PatientInsurance(
                            patient_id=patient.id,
                            payer_id=default_payer_id,
                            member_id=real_member_id,
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
async def import_angelwink_encounters(
    provider_id: int,
    payer_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """
    Import completed/signed exam encounters from AngelWink (iris.db) as DRAFT claims.
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
        conn = _angelwink_conn()
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
            raise HTTPException(500, f"Error leyendo exam_encounters de AngelWink DB: {e}")

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
                errors.append(f"Encuentro {enc['id']}: paciente AngelWink {enc['patient_id']} no importado aún")
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
                    code = cpt_item.get("code") or ""  # empty = needs manual CPT assignment
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

        # Auto-scrub all newly created claims
        from routers.ai import scrub_claim as _scrub_claim
        from schemas import ScrubRequest as _ScrubReq

        for cid in claim_ids:
            try:
                await _scrub_claim(_ScrubReq(claim_id=cid), db, None)  # type: ignore[arg-type]
            except Exception:
                pass  # best-effort scrub

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Error importando encuentros: {e}")

    return ImportResult(imported=imported, skipped=skipped, errors=errors, claims_created=claim_ids)


# ── AngelWink Invoice Import (PostgreSQL sync server) ────────────────────────────

import asyncio

ANGELWINK_PG_DSN = "dbname=wink_sync user=wink password=wink_sync_2026! host=localhost port=5432"


async def _query_angelwink_pg(query: str, params: tuple = ()):
    """Run a query against the AngelWink sync PostgreSQL database."""
    import psycopg2
    import psycopg2.extras
    loop = asyncio.get_event_loop()

    def _run():
        conn = psycopg2.connect(ANGELWINK_PG_DSN)
        conn.set_client_encoding('UTF8')
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(query, params)
        rows = cur.fetchall()
        cur.close()
        conn.close()
        return rows
    return await loop.run_in_executor(None, _run)


async def _resolve_payer_from_angelwink(
    insurance_provider: Optional[str],
    wink_patient_id: str,
    clinic_id: str,
    default_payer_id: int,
    db: AsyncSession,
) -> tuple[Optional[int], Optional[str], Optional[str]]:
    """
    Resolve the correct AngelClaims payer_id for an AngelWink patient.

    Strategy:
    1. Try patient_insurance from AngelWink sync server for plan name
    2. Try insurance_provider from synced_patients
    3. Match against AngelClaims payers table (exact → partial → fallback)

    Returns (payer_id, match_source, group_number) where match_source describes how it matched.
    """
    from models import Payer as PayerModel

    candidate_names: list[str] = []

    # 1. Query AngelWink sync server's patient_insurance table for this patient
    try:
        angelwink_ins_rows = await _query_angelwink_pg("""
            WITH pi AS (
                SELECT DISTINCT ON (row_id) data
                FROM sync_changes
                WHERE clinic_id = %s AND table_name = 'patient_insurance'
                  AND operation != 'DELETE' AND data IS NOT NULL
                  AND (data->>'patient_id')::int = %s
                  AND (data->>'is_primary')::text IN ('1', 'true')
                ORDER BY row_id, timestamp DESC
            ),
            plans AS (
                SELECT DISTINCT ON (row_id) data
                FROM sync_changes
                WHERE clinic_id = %s AND table_name = 'insurance_plans'
                  AND operation != 'DELETE' AND data IS NOT NULL
                ORDER BY row_id, timestamp DESC
            )
            SELECT
                pl.data->>'name' AS plan_name,
                pl.data->>'name' AS insurance_company,
                pi.data->>'member_id' AS member_id,
                pi.data->>'group_number' AS group_number
            FROM pi
            LEFT JOIN plans pl ON (pl.data->>'id')::int = (pi.data->>'insurance_plan_id')::int
            LIMIT 1
        """, (clinic_id, int(wink_patient_id), clinic_id))
        if angelwink_ins_rows:
            row = angelwink_ins_rows[0]
            if row.get("insurance_company"):
                candidate_names.append(row["insurance_company"])
            if row.get("plan_name"):
                candidate_names.append(row["plan_name"])
            # Capture group_number from the insurance record
            _angelwink_group_number = row.get("group_number") or None
        else:
            _angelwink_group_number = None
    except Exception:
        _angelwink_group_number = None
        pass  # Table may not exist yet; fall through

    # 2. Use insurance_provider from synced_patients (already in the invoice query)
    if insurance_provider:
        candidate_names.append(insurance_provider)

    # 3. Try to match each candidate against AngelClaims payers table
    for name in candidate_names:
        if not name or not name.strip():
            continue
        clean_name = name.strip()

        # Exact match (case-insensitive)
        res = await db.execute(
            select(PayerModel).where(
                PayerModel.name.ilike(clean_name),
                PayerModel.is_active == True,
            ).limit(1)
        )
        payer = res.scalar_one_or_none()
        if payer:
            return payer.id, f"exact:{clean_name}", _angelwink_group_number

        # Partial match (ILIKE %name%)
        res = await db.execute(
            select(PayerModel).where(
                PayerModel.name.ilike(f"%{clean_name}%"),
                PayerModel.is_active == True,
            ).limit(1)
        )
        payer = res.scalar_one_or_none()
        if payer:
            return payer.id, f"partial:{clean_name}→{payer.name}", _angelwink_group_number

        # Reverse partial: payer name contained in insurance_provider string
        all_payers_res = await db.execute(
            select(PayerModel).where(PayerModel.is_active == True)
        )
        all_payers = all_payers_res.scalars().all()
        for p in all_payers:
            if p.name.lower() in clean_name.lower():
                return p.id, f"reverse:{clean_name}→{p.name}", _angelwink_group_number

    # 4. Auto-create payer if we know the insurance name
    if candidate_names:
        # Use the first non-empty candidate name to create a new payer
        new_name = candidate_names[0].strip()
        if new_name:
            import random, string as _s
            suffix = ''.join(random.choices(_s.ascii_uppercase + _s.digits, k=4))
            new_payer = PayerModel(
                name=new_name,
                payer_id=f"AUTO-{suffix}",
                is_active=True,
            )
            db.add(new_payer)
            await db.flush()
            return new_payer.id, f"auto_created:{new_name}", _angelwink_group_number

    # 5. No insurance data at all — patient is uninsured
    return None, "uninsured", None


@router.post("/angelwink-invoices", response_model=ImportResult)
async def import_angelwink_invoices(
    date_from: str,
    date_to: str,
    provider_id: int = 1,
    default_payer_id: int = 1,
    clinic_id: str = None,  # from paired clinic; falls back to ANGELWINK_CLINIC_ID env var
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """
    Import invoices from the AngelWink sync server (PostgreSQL sync_changes) for a date range.
    Creates claims with service lines, auto-scrubs, auto-advances if clean.
    Resolves each patient's actual payer from AngelWink insurance data.
    """
    import json as _json
    import os as _os
    import random, string
    from datetime import datetime
    from routers.fee_schedule import get_fee_amount as _get_fee

    # Use the paired clinic ID from the frontend; fall back to provider_settings, then clinic_settings, then env var
    if not clinic_id:
        try:
            from models import ProviderSettings
            ps_result = await db.execute(
                select(ProviderSettings).where(ProviderSettings.provider_id == provider_id).limit(1)
            )
            ps = ps_result.scalar_one_or_none()
            if ps and ps.angelwink_clinic_id:
                clinic_id = ps.angelwink_clinic_id
        except Exception:
            pass
    if not clinic_id:
        try:
            _settings = await db.execute(text("SELECT angelwink_clinic_id FROM clinic_settings WHERE id = 1"))
            _row = _settings.fetchone()
            clinic_id = _row[0] if _row and _row[0] else None
        except Exception:
            pass
    if not clinic_id:
        clinic_id = _os.environ.get("ANGELWINK_CLINIC_ID", "")
    # Self-heal: if frontend sends a clinic_id, persist it for future use (both provider_settings and clinic_settings)
    if clinic_id:
        try:
            from models import ProviderSettings
            ps_result = await db.execute(
                select(ProviderSettings).where(ProviderSettings.provider_id == provider_id).limit(1)
            )
            ps = ps_result.scalar_one_or_none()
            if ps:
                await db.execute(text(
                    "UPDATE provider_settings SET angelwink_clinic_id = :cid WHERE provider_id = :pid"
                ), {"cid": clinic_id, "pid": provider_id})
            await db.execute(text("UPDATE clinic_settings SET angelwink_clinic_id = :cid WHERE id = 1"), {"cid": clinic_id})
            await db.commit()
        except Exception:
            pass

    imported = 0
    skipped = 0
    errors_list: list[str] = []
    claim_ids: list[int] = []
    uninsured_skipped = 0
    uninsured_patients_list: list[dict] = []

    # Cache payer resolution per patient to avoid repeated DB queries
    _payer_cache: dict[str, tuple[Optional[int], Optional[str], Optional[str]]] = {}

    try:
        # Query invoices joined with patients from AngelWink sync PostgreSQL
        invoices = await _query_angelwink_pg("""
            WITH inv AS (
                SELECT DISTINCT ON (row_id) row_id, data
                FROM sync_changes
                WHERE clinic_id = %s AND table_name = 'invoices'
                  AND operation != 'DELETE' AND data IS NOT NULL
                ORDER BY row_id, timestamp DESC
            ),
            pat AS (
                SELECT DISTINCT ON (row_id) row_id, data
                FROM sync_changes
                WHERE clinic_id = %s AND table_name = 'patients'
                  AND operation != 'DELETE' AND data IS NOT NULL
                ORDER BY row_id, timestamp DESC
            )
            SELECT
                (i.data->>'id')::int AS id,
                (i.data->>'patient_id')::int AS patient_id,
                i.data->>'date' AS invoice_date,
                i.data->>'status' AS status,
                i.data->>'diagnosis_codes' AS diagnosis_codes,
                (i.data->>'total')::numeric AS total,
                i.data->>'place_of_service' AS place_of_service,
                i.data->>'prior_auth_number' AS prior_auth_number,
                p.data->>'first_name' AS first_name,
                p.data->>'last_name' AS last_name,
                p.data->>'middle_name' AS middle_name,
                p.data->>'last_name_2' AS last_name_2,
                p.data->>'date_of_birth' AS date_of_birth,
                p.data->>'gender' AS gender,
                p.data->>'phone' AS phone,
                p.data->>'address' AS address,
                p.data->>'city' AS city,
                p.data->>'state' AS state,
                p.data->>'zip' AS zip,
                p.data->>'insurance_provider' AS insurance_provider,
                p.data->>'insurance_id' AS insurance_id,
                p.data->>'record_number' AS record_number
            FROM inv i
            JOIN pat p ON (p.data->>'id')::int = (i.data->>'patient_id')::int
            WHERE i.data->>'date' >= %s AND i.data->>'date' <= %s
            ORDER BY i.data->>'date' DESC
            LIMIT 500
        """, (clinic_id, clinic_id, date_from, date_to))

        for inv in invoices:
            inv_id = inv["id"]
            enc_ref = f"inv_{inv_id}"

            # Skip duplicates — scoped by provider to allow different orgs to import same data
            existing = await db.execute(
                select(Claim).where(
                    Claim.source == "wink",
                    Claim.external_ref == enc_ref,
                    Claim.provider_id == provider_id,
                )
            )
            if existing.scalar_one_or_none():
                skipped += 1
                continue

            # Find or create patient in AngelClaims
            wink_patient_id = str(inv["patient_id"])
            record_number = inv.get("record_number") or ""
            # Try multiple lookup strategies: wink_patient_id (with/without leading zeros) + MRN
            patient = None
            # Sequential lookups: exact wink_id, zero-padded, then by MRN
            for col, val in [
                (Patient.wink_patient_id, wink_patient_id),
                (Patient.wink_patient_id, wink_patient_id.zfill(7)),
                (Patient.mrn, record_number),
                (Patient.mrn, wink_patient_id.zfill(7)),
            ]:
                if not val:
                    continue
                result = await db.execute(select(Patient).where(col == val).limit(1))
                patient = result.scalars().first()
                if patient:
                    if patient.wink_patient_id != wink_patient_id:
                        patient.wink_patient_id = wink_patient_id
                    # Always update last name with combined last_name + last_name_2
                    ln1 = inv.get("last_name") or ""
                    ln2 = inv.get("last_name_2") or ""
                    combined = (ln1 + (" " + ln2 if ln2 else "")).strip()
                    if combined and patient.last_name != combined:
                        patient.last_name = combined
                    break

            if not patient:
                # Auto-create patient from synced_patients data
                try:
                    raw_dob = inv["date_of_birth"]
                    dob = date.fromisoformat(raw_dob[:10]) if raw_dob else date(1970, 1, 1)
                except (ValueError, TypeError):
                    dob = date(1970, 1, 1)

                gender_str = (inv["gender"] or "").lower()
                gender = Gender.M if gender_str == "male" else (Gender.F if gender_str == "female" else Gender.U)

                # Combine both last names (e.g. "SANCHEZ" + "CRUZ" -> "SANCHEZ CRUZ")
                last_name_1 = inv["last_name"] or ""
                last_name_2 = inv.get("last_name_2") or ""
                combined_last_name = (last_name_1 + (" " + last_name_2 if last_name_2 else "")).strip()

                patient = Patient(
                    wink_patient_id=wink_patient_id,
                    mrn=inv["record_number"],
                    first_name=inv["first_name"] or "",
                    last_name=combined_last_name,
                    dob=dob,
                    gender=gender,
                    phone=inv["phone"],
                    address_line1=inv["address"],
                    city=inv["city"] or "San Juan",
                    state=inv["state"] or "PR",
                    zip_code=inv["zip"],
                )
                db.add(patient)
                await db.flush()

            # Resolve the ACTUAL payer for this patient from AngelWink data
            if wink_patient_id in _payer_cache:
                resolved_payer_id, match_source, insurance_group_number = _payer_cache[wink_patient_id]
            else:
                resolved_payer_id, match_source, insurance_group_number = await _resolve_payer_from_angelwink(
                    insurance_provider=inv.get("insurance_provider"),
                    wink_patient_id=wink_patient_id,
                    clinic_id=clinic_id,
                    default_payer_id=default_payer_id,
                    db=db,
                )
                _payer_cache[wink_patient_id] = (resolved_payer_id, match_source, insurance_group_number)

            # Never skip uninsured patients — they may have insurance cards in documents
            # that will be extracted during the scrub workflow.
            # If no payer resolved, use a placeholder "Unresolved" payer.
            if resolved_payer_id is None:
                unresolved = await db.execute(
                    select(Payer).where(Payer.name == "UNRESOLVED - CHECK DOCUMENTS").limit(1)
                )
                unresolved_payer = unresolved.scalar_one_or_none()
                if not unresolved_payer:
                    unresolved_payer = Payer(
                        name="UNRESOLVED - CHECK DOCUMENTS",
                        payer_id="UNRESOLVED",
                        payer_type="medical",
                    )
                    db.add(unresolved_payer)
                    await db.flush()
                resolved_payer_id = unresolved_payer.id
                match_source = "unresolved"

            # Ensure patient has insurance record for the RESOLVED payer
            # Only create if there is a REAL member_id — never use fake IDs
            real_member_id = inv.get("insurance_id") or None
            existing_ins = await db.execute(
                select(PatientInsurance).where(
                    PatientInsurance.patient_id == patient.id,
                    PatientInsurance.payer_id == resolved_payer_id,
                ).limit(1)
            )
            if not existing_ins.scalars().first():
                if real_member_id:
                    ins = PatientInsurance(
                        patient_id=patient.id,
                        payer_id=resolved_payer_id,
                        member_id=real_member_id,
                        group_number=insurance_group_number,
                        is_primary=True,
                    )
                    db.add(ins)
            else:
                # Update existing insurance record's member_id/group_number if we have better data
                if real_member_id:
                    existing_ins_obj = await db.execute(
                        select(PatientInsurance).where(
                            PatientInsurance.patient_id == patient.id,
                            PatientInsurance.payer_id == resolved_payer_id,
                        ).limit(1)
                    )
                    ins_record = existing_ins_obj.scalars().first()
                    if ins_record and ins_record.member_id and ins_record.member_id.startswith("WINK-"):
                        ins_record.member_id = real_member_id
                    # Update group_number if we now have it and existing doesn't
                    if ins_record and insurance_group_number and not ins_record.group_number:
                        ins_record.group_number = insurance_group_number

            try:
                # Parse invoice date
                raw_date = inv["invoice_date"]
                try:
                    svc_date = date.fromisoformat(raw_date[:10]) if raw_date else date.today()
                except ValueError:
                    svc_date = date.today()

                # Parse diagnosis codes
                dx_codes: list[str] = []
                raw_dx = inv["diagnosis_codes"]
                if raw_dx:
                    try:
                        parsed_dx = _json.loads(raw_dx) if isinstance(raw_dx, str) else raw_dx
                        if isinstance(parsed_dx, list):
                            dx_codes = [str(d) for d in parsed_dx if d]
                        elif isinstance(parsed_dx, str):
                            dx_codes = [c.strip() for c in parsed_dx.split(",") if c.strip()]
                    except (_json.JSONDecodeError, TypeError):
                        # Try comma-separated
                        dx_codes = [c.strip() for c in str(raw_dx).split(",") if c.strip()]

                # Get service line items from synced_invoice_items
                items = await _query_angelwink_pg("""
                    SELECT DISTINCT ON (row_id)
                        data->>'cpt_code' AS cpt_code,
                        data->>'description' AS description,
                        (data->>'quantity')::int AS quantity,
                        (data->>'unit_price')::numeric AS unit_price,
                        data->>'modifiers' AS modifiers,
                        data->>'diagnosis_pointer' AS diagnosis_pointer,
                        COALESCE(data->>'category', 'service') AS category
                    FROM sync_changes
                    WHERE clinic_id = %s AND table_name = 'invoice_items'
                      AND operation != 'DELETE' AND data IS NOT NULL
                      AND (data->>'invoice_id')::int = %s
                    ORDER BY row_id, timestamp DESC
                """, (clinic_id, inv_id))

                # Separate billing items (procedures+materials) from sale items
                cpt_list: list[dict] = []  # for billing service lines
                sale_items_data: list[dict] = []  # for Patient Sale display
                for item in items:
                    cat = item.get("category", "service")
                    if cat == "sale_item":
                        # Sale items go to Patient Sale section only
                        sale_items_data.append({
                            "name": item["description"],
                            "amount": float(item["unit_price"] or 0) * int(item["quantity"] or 1),
                        })
                        continue

                    # Procedures and materials → billing service lines
                    mods = []
                    if item["modifiers"]:
                        try:
                            mods = _json.loads(item["modifiers"]) if isinstance(item["modifiers"], str) else item["modifiers"]
                        except (_json.JSONDecodeError, TypeError):
                            pass
                    ptrs = []
                    if item["diagnosis_pointer"]:
                        try:
                            ptrs = _json.loads(item["diagnosis_pointer"]) if isinstance(item["diagnosis_pointer"], str) else item["diagnosis_pointer"]
                        except (_json.JSONDecodeError, TypeError):
                            pass
                    code = item["cpt_code"] or ""
                    if code:  # only add items that have actual CPT codes
                        cpt_list.append({
                            "code": code,
                            "description": item["description"],
                            "units": int(item["quantity"] or 1),
                            "amount": float(item["unit_price"] or 0),
                            "modifiers": mods if isinstance(mods, list) else [],
                            "diagnosis_pointers": ptrs if (isinstance(ptrs, list) and ptrs) else (list(range(1, len(dx_codes) + 1)) if dx_codes else []),
                        })

                if not cpt_list:
                    cpt_list = [{"code": "", "units": 1, "amount": 0.0, "description": "No procedures found"}]  # flagged for review

                # Apply fee schedule: look up proper billed amount for each CPT code.
                # AngelWink stores $0 unit_price for insurance-covered items, so we must
                # pull the correct rate from our fee schedule instead.
                for cpt_item in cpt_list:
                    code = cpt_item.get("code")
                    if code:
                        fs_amount, _fs_src = await _get_fee(db, code, resolved_payer_id)
                        original_price = float(cpt_item.get("amount") or 0)
                        if fs_amount > 0:
                            cpt_item["amount"] = fs_amount
                        elif original_price > 0:
                            cpt_item["amount"] = original_price
                        # else leave as 0 — scrub will flag it

                # sale_items_data was already built above from 'sale_item' category items
                # If empty (old data without categories), build from all items as fallback
                if not sale_items_data:
                    sale_items_data = [
                        {
                            "name": (item.get("description") or item.get("cpt_code") or "Item"),
                            "amount": float(item.get("unit_price") or 0) * int(item.get("quantity") or 1),
                        }
                        for item in items
                        if (item.get("description") or item.get("cpt_code"))
                    ] or None

                total_billed = sum(float(c.get("amount", 0) or 0) * int(c.get("units", 1) or 1) for c in cpt_list)

                ts = datetime.utcnow().strftime("%Y%m%d")
                suffix = "".join(random.choices(string.ascii_uppercase + string.digits, k=6))

                claim = Claim(
                    claim_number=f"CLM-{ts}-{suffix}",
                    patient_id=patient.id,
                    provider_id=provider_id,
                    payer_id=resolved_payer_id,
                    service_date_from=svc_date,
                    service_date_to=svc_date,
                    diagnosis_codes=dx_codes,
                    total_billed=total_billed,
                    status=ClaimStatus.DRAFT,
                    source="wink",
                    external_ref=enc_ref,
                    place_of_service=inv["place_of_service"] or "11",
                    prior_auth_number=inv["prior_auth_number"],
                    sale_items=sale_items_data,
                )
                db.add(claim)
                await db.flush()

                for i, cpt_item in enumerate(cpt_list, start=1):
                    code = cpt_item.get("code") or ""  # empty = needs manual CPT assignment
                    units = int(cpt_item.get("units") or 1)
                    amount = float(cpt_item.get("amount") or 0.0)
                    mods = cpt_item.get("modifiers", [])
                    ptrs = cpt_item.get("diagnosis_pointers", [1] if dx_codes else [])
                    sl = ServiceLine(
                        claim_id=claim.id,
                        line_number=i,
                        cpt_code=code,
                        description=cpt_item.get("description"),
                        modifiers=mods if isinstance(mods, list) else [],
                        service_date=svc_date,
                        units=units,
                        billed_amount=amount,
                        diagnosis_pointers=ptrs if isinstance(ptrs, list) else [],
                    )
                    db.add(sl)

                claim_ids.append(claim.id)
                imported += 1
            except Exception as e:
                errors_list.append(f"Invoice {inv_id}: {e}")
                skipped += 1

        await db.commit()

        # Auto-scrub + auto-advance newly created claims
        try:
            from routers.ai import _scrub_patient, _scrub_provider, _scrub_payer, _scrub_claim_level, _scrub_service_lines
            from sqlalchemy.orm import selectinload as _sil
            from sqlalchemy import update as sql_update

            for cid in claim_ids:
                try:
                    _fresh_result = await db.execute(
                        select(Claim)
                        .options(
                            _sil(Claim.patient).selectinload(Patient.insurances),
                            _sil(Claim.provider),
                            _sil(Claim.payer),
                            _sil(Claim.service_lines),
                        )
                        .where(Claim.id == cid)
                    )
                    fresh_claim = _fresh_result.scalar_one_or_none()
                    if not fresh_claim:
                        continue
                    scrub_issues = []
                    _scrub_patient(fresh_claim, scrub_issues)
                    _scrub_provider(fresh_claim, scrub_issues)
                    _scrub_payer(fresh_claim, scrub_issues)
                    _scrub_claim_level(fresh_claim, scrub_issues)
                    _scrub_service_lines(fresh_claim, scrub_issues)
                    err_count = sum(1 for i in scrub_issues if i.get('type') == 'error')
                    warn_count = sum(1 for i in scrub_issues if i.get('type') == 'warning')
                    scrub_score = max(0, 100 - err_count * 25 - warn_count * 5)
                    await db.execute(sql_update(Claim).where(Claim.id == cid).values(
                        scrub_score=scrub_score, scrub_issues=scrub_issues
                    ))
                    if err_count == 0 and warn_count == 0:
                        await db.execute(sql_update(Claim).where(Claim.id == cid).values(status=ClaimStatus.READY))
                except Exception:
                    pass  # best-effort scrub
            await db.commit()
        except Exception:
            import traceback; traceback.print_exc()

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Error importando facturas de AngelWink: {e}")

    return ImportResult(
        imported=imported,
        skipped=skipped,
        errors=errors_list,
        claims_created=claim_ids,
        uninsured_skipped=uninsured_skipped,
        uninsured_patients=uninsured_patients_list,
    )


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


# ── AngelWink Invoice Push (direct invoice payload from AngelWink desktop) ────

class InvoicePatientPayload(BaseModel):
    id: Optional[int] = None
    name: str = ""


class InvoiceCptCodePayload(BaseModel):
    code: str
    description: Optional[str] = None
    modifiers: List[str] = []


class InvoiceImportPayload(BaseModel):
    """Invoice payload sent directly from AngelWink's InvoiceDetailModal."""
    invoice_number: str
    patient: InvoicePatientPayload
    date: str  # ISO date
    total: float
    balance: float = 0.0
    status: str = "pending"
    diagnosis_codes: List[str] = []
    cpt_codes: List[InvoiceCptCodePayload] = []
    insurance: Optional[str] = None
    place_of_service: str = "11"
    prior_auth: Optional[str] = None
    referring_provider: Optional[str] = None


@router.post("/invoice")
async def import_invoice(
    payload: InvoiceImportPayload,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """
    Receive a single invoice directly from AngelWink's 'Send to Biller' button.
    Creates a DRAFT claim visible in the AngelClaims dashboard.
    Returns { ok: true, claim_id: int, claim_number: str }.
    """
    import random
    import string as _string
    from datetime import datetime

    errors = []

    # Validate required fields
    if not payload.invoice_number:
        raise HTTPException(400, "invoice_number is required")
    if not payload.patient.name:
        raise HTTPException(400, "patient.name is required")

    # Parse date
    try:
        svc_date = date.fromisoformat(payload.date[:10])
    except (ValueError, TypeError):
        svc_date = date.today()
        errors.append("Invalid date - defaulted to today")

    # Duplicate check by invoice_number (stored in external_ref)
    enc_ref = f"wink_inv_{payload.invoice_number}"
    existing = await db.execute(
        select(Claim).where(
            Claim.source == "wink",
            Claim.external_ref == enc_ref,
        )
    )
    dup = existing.scalar_one_or_none()
    if dup:
        return {"ok": True, "claim_id": dup.id, "claim_number": dup.claim_number, "status": "already_imported"}

    # Find or create patient
    patient = None
    if payload.patient.id:
        res = await db.execute(
            select(Patient).where(Patient.wink_patient_id == str(payload.patient.id))
        )
        patient = res.scalar_one_or_none()

    if not patient and payload.patient.name:
        name_parts = payload.patient.name.strip().split()
        if len(name_parts) >= 2:
            first = name_parts[0]
            last = " ".join(name_parts[1:])
            res = await db.execute(
                select(Patient).where(
                    Patient.first_name.ilike(first),
                    Patient.last_name.ilike(f"%{last}%"),
                ).limit(1)
            )
            patient = res.scalar_one_or_none()

    if not patient:
        name_parts = payload.patient.name.strip().split()
        first = name_parts[0] if name_parts else payload.patient.name
        last = " ".join(name_parts[1:]) if len(name_parts) > 1 else ""
        patient = Patient(
            wink_patient_id=str(payload.patient.id) if payload.patient.id else None,
            first_name=first,
            last_name=last,
            dob=date(1970, 1, 1),
            gender=Gender.U,
            state="PR",
        )
        db.add(patient)
        await db.flush()

    # Resolve payer
    payer_id = None
    if payload.insurance:
        from models import Payer as PayerModel
        res = await db.execute(
            select(PayerModel).where(
                PayerModel.name.ilike(f"%{payload.insurance}%"),
                PayerModel.is_active == True,
            ).limit(1)
        )
        payer = res.scalar_one_or_none()
        if payer:
            payer_id = payer.id

    # Resolve provider (default first active)
    from models import Provider as ProviderModel
    prov_res = await db.execute(
        select(ProviderModel).where(ProviderModel.is_active == True).limit(1)
    )
    prov = prov_res.scalar_one_or_none()
    provider_id = prov.id if prov else 1

    ts = datetime.utcnow().strftime("%Y%m%d")
    suffix = "".join(random.choices(_string.ascii_uppercase + _string.digits, k=6))

    claim = Claim(
        claim_number=f"CLM-{ts}-{suffix}",
        patient_id=patient.id,
        provider_id=provider_id,
        payer_id=payer_id or 1,
        service_date_from=svc_date,
        service_date_to=svc_date,
        diagnosis_codes=payload.diagnosis_codes,
        total_billed=payload.total,
        prior_auth_number=payload.prior_auth,
        place_of_service=payload.place_of_service,
        status=ClaimStatus.DRAFT,
        source="wink",
        external_ref=enc_ref,
        notes=f"Imported from AngelWink invoice {payload.invoice_number}",
    )
    db.add(claim)
    await db.flush()

    for i, cpt in enumerate(payload.cpt_codes, start=1):
        sl = ServiceLine(
            claim_id=claim.id,
            line_number=i,
            cpt_code=cpt.code,
            description=cpt.description,
            modifiers=cpt.modifiers,
            service_date=svc_date,
            units=1,
            billed_amount=0.0,
            diagnosis_pointers=list(range(1, len(payload.diagnosis_codes) + 1)) if payload.diagnosis_codes else [],
        )
        db.add(sl)

    await db.commit()

    # Best-effort auto-scrub
    try:
        from routers.ai import _scrub_patient, _scrub_provider, _scrub_payer, _scrub_claim_level, _scrub_service_lines
        from sqlalchemy.orm import selectinload as _sil
        from sqlalchemy import update as sql_update
        _fresh_result = await db.execute(
            select(Claim)
            .options(
                _sil(Claim.patient).selectinload(Patient.insurances),
                _sil(Claim.provider),
                _sil(Claim.payer),
                _sil(Claim.service_lines),
            )
            .where(Claim.id == claim.id)
        )
        fresh_claim = _fresh_result.scalar_one_or_none()
        if fresh_claim:
            scrub_issues = []
            _scrub_patient(fresh_claim, scrub_issues)
            _scrub_provider(fresh_claim, scrub_issues)
            _scrub_payer(fresh_claim, scrub_issues)
            _scrub_claim_level(fresh_claim, scrub_issues)
            _scrub_service_lines(fresh_claim, scrub_issues)
            err_count = sum(1 for x in scrub_issues if x.get("type") == "error")
            warn_count = sum(1 for x in scrub_issues if x.get("type") == "warning")
            scrub_score = max(0, 100 - err_count * 25 - warn_count * 5)
            await db.execute(sql_update(Claim).where(Claim.id == claim.id).values(
                scrub_score=scrub_score, scrub_issues=scrub_issues
            ))
            await db.commit()
    except Exception:
        pass

    return {
        "ok": True,
        "claim_id": claim.id,
        "claim_number": claim.claim_number,
        "status": "imported",
        "errors": errors,
    }


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
