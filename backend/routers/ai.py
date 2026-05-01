"""
AI-powered features:
- Claim scrubbing (pre-submission quality check)
- Denial analysis + root cause
- Coding assistant (CPT suggestions from description)
- Appeal letter drafting
- Predictive denial risk scoring
"""
import json
import re
from collections import Counter
from datetime import date
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from config import settings
from database import get_db
from models import Claim, ClaimStatus, Denial, ServiceLine, Patient, Provider, Payer, User
from schemas import (
    ScrubRequest, ScrubResponse,
    DenialAnalysisRequest, DenialAnalysisResponse,
    CodingAssistRequest, CodingAssistResponse,
)
from auth import get_current_user
from routers.validation import validate_npi, validate_tax_id

router = APIRouter(prefix="/ai", tags=["ai"])

# ICD-10 format: letter + 2+ digits + optional dot + digits
_ICD10_RE = re.compile(r'^[A-Za-z]\d{2,}(\.\d+)?$')


def get_openai():
    if not settings.OPENAI_API_KEY:
        return None
    from openai import AsyncOpenAI
    return AsyncOpenAI(api_key=settings.OPENAI_API_KEY)


# ── Claim Scrubber ────────────────────────────────────────────────────────────

def _scrub_patient(claim: Claim, issues: list) -> None:
    """Validate patient demographics for 837P."""
    patient = claim.patient
    if not claim.patient_id or not patient:
        issues.append({"type": "error", "field": "patient", "msg_key": "scrub.no_patient", "msg": "No patient assigned"})
        return

    if not (patient.first_name or "").strip():
        issues.append({"type": "error", "field": "patient.first_name", "msg_key": "scrub.patient_no_first_name", "msg": "Patient first name missing"})
    if not (patient.last_name or "").strip():
        issues.append({"type": "error", "field": "patient.last_name", "msg_key": "scrub.patient_no_last_name", "msg": "Patient last name missing"})

    if not patient.dob:
        issues.append({"type": "error", "field": "patient.dob", "msg_key": "scrub.patient_no_dob", "msg": "Patient date of birth missing"})
    elif patient.dob == date(1900, 1, 1):
        issues.append({"type": "error", "field": "patient.dob", "msg_key": "scrub.patient_placeholder_dob", "msg": "Patient DOB is placeholder (1900-01-01) — update with real DOB"})

    # Gender: Not required for PR payers. VistaNet doesn't track it.
    # Removed — was causing unnecessary warnings.

    # Address
    if not (patient.city or "").strip() or not (patient.state or "").strip() or not (patient.zip_code or "").strip():
        issues.append({"type": "warning" if (patient.address_line1 or "").strip() else "error", "field": "patient.address", "msg_key": "scrub.patient_no_address", "msg": "Patient address incomplete — need at least city, state, zip"})

    # Member/insurance ID for this payer
    if claim.payer_id and patient.insurances:
        matching_ins = [ins for ins in patient.insurances if ins.payer_id == claim.payer_id]
        if not matching_ins:
            issues.append({"type": "error", "field": "patient.insurance", "msg_key": "scrub.patient_no_insurance", "msg": "No insurance record found for patient with this payer"})
        elif not (matching_ins[0].member_id or "").strip():
            issues.append({"type": "error", "field": "patient.member_id", "msg_key": "scrub.patient_no_member_id", "msg": "Patient member/insurance ID is blank for this payer"})
    elif claim.payer_id:
        issues.append({"type": "error", "field": "patient.insurance", "msg_key": "scrub.patient_no_insurance", "msg": "No insurance records on file for this patient"})


def _scrub_provider(claim: Claim, issues: list) -> None:
    """Validate provider for 837P."""
    provider = claim.provider
    if not claim.provider_id or not provider:
        issues.append({"type": "error", "field": "provider", "msg_key": "scrub.no_provider", "msg": "No provider assigned"})
        return

    # NPI
    npi = provider.npi or ""
    if not npi.strip():
        issues.append({"type": "error", "field": "provider.npi", "msg_key": "scrub.provider_no_npi", "msg": "Provider NPI is missing"})
    elif not validate_npi(npi):
        issues.append({"type": "error", "field": "provider.npi", "msg_key": "scrub.provider_invalid_npi", "msg": f"Provider NPI '{npi}' fails Luhn validation"})

    # EIN / Tax ID
    ein = provider.ein or ""
    if not ein.strip():
        issues.append({"type": "error", "field": "provider.ein", "msg_key": "scrub.provider_no_ein", "msg": "Provider EIN/Tax ID is missing"})
    elif not validate_tax_id(ein):
        issues.append({"type": "error", "field": "provider.ein", "msg_key": "scrub.provider_invalid_ein", "msg": f"Provider EIN '{ein}' is not valid format (XX-XXXXXXX)"})

    # Taxonomy code
    if not (provider.taxonomy_code or "").strip():
        issues.append({"type": "error", "field": "provider.taxonomy_code", "msg_key": "scrub.provider_no_taxonomy", "msg": "Provider taxonomy code is missing"})

    # Address
    if not (provider.city or "").strip() or not (provider.state or "").strip() or not (provider.zip_code or "").strip():
        issues.append({"type": "error", "field": "provider.address", "msg_key": "scrub.provider_no_address", "msg": "Provider address incomplete — need at least city, state, zip"})


def _scrub_payer(claim: Claim, issues: list) -> None:
    """Validate payer for 837P."""
    payer = claim.payer
    if not claim.payer_id or not payer:
        issues.append({"type": "error", "field": "payer", "msg_key": "scrub.no_payer", "msg": "No payer assigned"})
        return

    if not (payer.payer_id or "").strip():
        issues.append({"type": "error", "field": "payer.payer_id", "msg_key": "scrub.payer_no_id", "msg": "Payer routing ID is missing"})

    sub_method = payer.submission_method
    if not sub_method or (hasattr(sub_method, 'value') and sub_method.value in ("", "none")) or str(sub_method) in ("", "none"):
        issues.append({"type": "error", "field": "payer.submission_method", "msg_key": "scrub.payer_no_submission", "msg": "Payer submission method not set"})


def _scrub_claim_level(claim: Claim, issues: list) -> None:
    """Validate claim-level fields for 837P."""
    dx_codes = claim.diagnosis_codes or []

    # Diagnosis codes — required for procedure claims, optional for materials-only
    cpt_codes = [sl.cpt_code for sl in (claim.service_lines or []) if sl.cpt_code]
    has_procedures = any(c.isdigit() for c in cpt_codes)  # 5-digit CPT = procedure
    has_only_materials = all(c[0:1].isalpha() for c in cpt_codes) if cpt_codes else False
    if not dx_codes and has_procedures:
        issues.append({"type": "error", "field": "diagnosis_codes", "msg_key": "scrub.no_diagnosis", "msg": "No diagnosis codes (required for procedure claims)"})
    elif not dx_codes and has_only_materials:
        issues.append({"type": "info", "field": "diagnosis_codes", "msg_key": "scrub.no_diagnosis_materials", "msg": "No diagnosis codes (optional for materials-only claims)"})
    else:
        for dx in dx_codes:
            if not _ICD10_RE.match(dx):
                issues.append({"type": "error", "field": "diagnosis_codes", "msg_key": "scrub.invalid_dx_format",
                               "msg_params": {"dx": dx}, "msg": f"Diagnosis code '{dx}' is not valid ICD-10 format"})

    # Service date
    if not claim.service_date_from:
        issues.append({"type": "error", "field": "service_date_from", "msg_key": "scrub.no_service_date", "msg": "Service date is missing"})
    else:
        today = date.today()
        if claim.service_date_from > today:
            issues.append({"type": "error", "field": "service_date_from", "msg_key": "scrub.future_service_date", "msg": "Service date is in the future"})

        # Timely filing
        if claim.payer and claim.payer.timely_filing_days:
            days_since = (today - claim.service_date_from).days
            if days_since > claim.payer.timely_filing_days:
                issues.append({"type": "error", "field": "service_date_from", "msg_key": "scrub.timely_filing_exceeded",
                               "msg_params": {"days": days_since, "limit": claim.payer.timely_filing_days},
                               "msg": f"Service date is {days_since} days ago — exceeds payer's {claim.payer.timely_filing_days}-day filing limit"})

    # Place of service
    if not (claim.place_of_service or "").strip():
        issues.append({"type": "warning", "field": "place_of_service", "msg_key": "scrub.no_pos",
                       "msg": "Place of service not set — defaults to '11' (office)"})

    # Total billed
    if claim.total_billed <= 0:
        issues.append({"type": "error", "field": "total_billed", "msg_key": "scrub.zero_total", "msg": "Total billed is $0 — verify service line amounts"})
    elif claim.total_billed < 20:
        issues.append({"type": "warning", "field": "total_billed", "msg_key": "scrub.low_total",
                       "msg": f"Total billed is ${claim.total_billed:.2f} — unusually low, verify amounts"})

    # Total billed vs sum of lines
    if claim.service_lines:
        line_total = sum(sl.billed_amount * (sl.units or 1) for sl in claim.service_lines)
        if abs(claim.total_billed - line_total) > 0.01:
            issues.append({"type": "error", "field": "total_billed", "msg_key": "scrub.total_mismatch",
                           "msg_params": {"total": f"{claim.total_billed:.2f}", "line_total": f"{line_total:.2f}"},
                           "msg": f"Total billed (${claim.total_billed:.2f}) does not match sum of service lines (${line_total:.2f})"})


def _scrub_service_lines(claim: Claim, issues: list) -> None:
    """Validate service lines for 837P."""
    if not claim.service_lines:
        issues.append({"type": "error", "field": "service_lines", "msg_key": "scrub.no_service_lines", "msg": "No service lines"})
        return

    dx_codes = claim.diagnosis_codes or []
    dx_count = len(dx_codes)

    # Track CPT codes per date for duplicate check
    cpt_by_date: Counter = Counter()

    for sl in claim.service_lines:
        ln = sl.line_number

        # CPT code present
        if not (sl.cpt_code or "").strip():
            issues.append({"type": "error", "field": f"line_{ln}", "msg_key": "scrub.line_no_cpt",
                           "msg_params": {"line": ln}, "msg": f"Line {ln}: missing CPT/HCPCS code"})

        # Billed amount
        if sl.billed_amount <= 0:
            issues.append({"type": "error", "field": f"line_{ln}", "msg_key": "scrub.invalid_billed_amount",
                           "msg_params": {"line": ln}, "msg": f"Line {ln}: billed amount must be > $0"})

        # Units
        if (sl.units or 0) < 1:
            issues.append({"type": "error", "field": f"line_{ln}", "msg_key": "scrub.line_no_units",
                           "msg_params": {"line": ln}, "msg": f"Line {ln}: units must be >= 1"})

        # Diagnosis pointers — only required for procedure codes, not materials (V-codes/HCPCS)
        pointers = sl.diagnosis_pointers or []
        is_material = sl.cpt_code and sl.cpt_code[0:1].isalpha()  # V2020, A4000, etc.
        if not pointers and not is_material and dx_codes:
            issues.append({"type": "error", "field": f"line_{ln}", "msg_key": "scrub.no_dx_pointers",
                           "msg_params": {"line": ln, "cpt": sl.cpt_code},
                           "msg": f"Line {ln} ({sl.cpt_code}): no diagnosis pointers"})
        else:
            for ptr in pointers:
                # Pointers are 1-based indices into diagnosis_codes
                if isinstance(ptr, int) and (ptr < 1 or ptr > dx_count):
                    issues.append({"type": "error", "field": f"line_{ln}", "msg_key": "scrub.invalid_dx_pointer",
                                   "msg_params": {"line": ln, "pointer": ptr, "max": dx_count},
                                   "msg": f"Line {ln}: diagnosis pointer {ptr} is out of range (only {dx_count} diagnoses)"})

        # Modifier checks
        mods = [m.strip("-").upper() for m in (sl.modifiers or [])]
        if "LT" in mods and "RT" in mods:
            issues.append({"type": "error", "field": f"line_{ln}", "msg_key": "scrub.lt_rt_conflict",
                           "msg_params": {"line": ln}, "msg": f"Line {ln}: cannot use -LT and -RT together"})
        if "50" in mods and ("LT" in mods or "RT" in mods):
            issues.append({"type": "error", "field": f"line_{ln}", "msg_key": "scrub.mod50_conflict",
                           "msg_params": {"line": ln}, "msg": f"Line {ln}: modifier -50 should not combine with -LT/-RT"})

        # Duplicate CPT on same date
        svc_date = sl.service_date or claim.service_date_from
        if sl.cpt_code:
            key = (sl.cpt_code, str(svc_date))
            cpt_by_date[key] += 1

    # Report duplicate CPTs (warning, not error — some legitimate)
    for (cpt, svc_date_str), count in cpt_by_date.items():
        if count > 1:
            issues.append({"type": "warning", "field": "service_lines", "msg_key": "scrub.duplicate_cpt",
                           "msg_params": {"cpt": cpt, "date": svc_date_str, "count": count},
                           "msg": f"CPT {cpt} appears {count} times on {svc_date_str} — verify this is intentional"})


@router.post("/scrub/{claim_id}", response_model=ScrubResponse)
async def scrub_claim_by_id(
    claim_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Scrub a claim by path parameter (convenience endpoint)."""
    from schemas import ScrubRequest as SR
    return await scrub_claim(SR(claim_id=claim_id), db, current_user)


@router.post("/scrub", response_model=ScrubResponse)
async def scrub_claim(
    body: ScrubRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),  # type: ignore[assignment]
):
    """
    Comprehensive 837P pre-submission scrub.
    Validates patient, provider, payer, claim-level fields, and every service line.
    Score: 100 base, -25 per error, -5 per warning.
    Ready threshold: PERFECT score (zero errors AND zero warnings). Anything less needs review.
    """
    result = await db.execute(
        select(Claim)
        .options(
            selectinload(Claim.patient).selectinload(Patient.insurances),
            selectinload(Claim.provider),
            selectinload(Claim.payer),
            selectinload(Claim.service_lines),
        )
        .where(Claim.id == body.claim_id)
    )
    claim = result.scalar_one_or_none()
    if not claim:
        raise HTTPException(404, "Reclamación no encontrada")

    issues: list[dict] = []
    suggestions: list[str] = []

    # ── Comprehensive rule-based checks ───────────────────────────────────
    _scrub_patient(claim, issues)
    _scrub_provider(claim, issues)
    _scrub_payer(claim, issues)
    _scrub_claim_level(claim, issues)
    _scrub_service_lines(claim, issues)

    # ── Clinical Cross-Checks ──────────────────────────────────────────────
    cpt_codes = [sl.cpt_code for sl in claim.service_lines] if claim.service_lines else []
    dx_codes = claim.diagnosis_codes or []

    # 1. Contact lens materials without contact lens fitting code
    has_cl_materials = any(c.startswith("V25") for c in cpt_codes)  # V2500-V2599
    has_cl_fitting = any(c in ("92310", "92311", "92312", "92313", "92314") for c in cpt_codes)
    if has_cl_materials and not has_cl_fitting:
        issues.append({"type": "warning", "field": "clinical",
            "msg_key": "scrub.cl_no_fitting",
            "msg": "Contact lens materials billed without fitting code (92310-92314)"})

    # 2. Refraction (92015) without refractive diagnosis
    has_refraction = "92015" in cpt_codes
    refractive_dx = any(c.startswith(("H52", "H53", "H54")) for c in dx_codes)
    if has_refraction and not refractive_dx:
        issues.append({"type": "warning", "field": "clinical",
            "msg_key": "scrub.refraction_no_dx",
            "msg": "Refraction (92015) billed but no refractive error diagnosis (H52.x)"})

    # 3. Medical exam (92012/92014) without medical diagnosis
    medical_exam_codes = {"92002", "92004", "92012", "92014"}
    has_medical_exam = bool(medical_exam_codes & set(cpt_codes))
    routine_only_dx = all(c.startswith(("Z01", "Z00")) for c in dx_codes)
    if has_medical_exam and routine_only_dx and len(dx_codes) > 0:
        issues.append({"type": "warning", "field": "clinical",
            "msg_key": "scrub.medical_exam_routine_dx",
            "msg": "Medical exam code used but only routine/preventive diagnoses \u2014 consider adding medical diagnosis"})

    # 4. Comprehensive exam (92004/92014) for follow-up visit
    # Informational — sometimes comprehensive is correct
    if ("92004" in cpt_codes or "92014" in cpt_codes):
        pass  # Future: check patient visit history

    # 5. Glasses sold but no frame/lens V-codes
    has_v2020 = "V2020" in cpt_codes  # Frame
    has_lens = any(c.startswith(("V210", "V220", "V230")) for c in cpt_codes)
    if has_v2020 and not has_lens:
        issues.append({"type": "info", "field": "clinical",
            "msg_key": "scrub.frame_no_lens",
            "msg": "Frame (V2020) billed without lens codes \u2014 verify if lenses were prescribed"})

    # ── Score calculation ─────────────────────────────────────────────────
    errors = [i for i in issues if i["type"] == "error"]
    warnings = [i for i in issues if i["type"] == "warning"]
    score = max(0.0, 100.0 - len(errors) * 25.0 - len(warnings) * 5.0)

    # AI enhancement if OpenAI available (optional, doesn't block)
    client = get_openai()
    if client and claim.service_lines:
        lines_summary = "; ".join(
            f"CPT {sl.cpt_code} (${sl.billed_amount:.2f}, mods: {sl.modifiers})"
            for sl in claim.service_lines
        )
        dx_summary = ", ".join(claim.diagnosis_codes or [])
        prompt = f"""Eres un especialista en codificación médica con experiencia en el mercado de Puerto Rico.
Revisa esta reclamación de salud:
- Diagnósticos: {dx_summary}
- Servicios: {lines_summary}
- Lugar de servicio: {claim.place_of_service}

Identifica problemas potenciales de facturación y sugiere mejoras. Responde en JSON:
{{"additional_issues": [{{"type": "warning"|"error", "msg": "..."}}], "suggestions": ["..."]}}
"""
        try:
            resp = await client.chat.completions.create(
                model=settings.OPENAI_MODEL,
                messages=[{"role": "user", "content": prompt}],
                response_format={"type": "json_object"},
                max_tokens=500,
            )
            ai_data = json.loads(resp.choices[0].message.content)
            issues.extend(ai_data.get("additional_issues", []))
            suggestions.extend(ai_data.get("suggestions", []))
        except Exception:
            pass  # Don't fail if AI is unavailable

    # Persist scrub results
    claim.scrub_score = score
    claim.scrub_issues = issues

    # Auto-advance to ready if scrub passes (score >= 80 AND zero errors)
    if not any(i.get("type") == "error" for i in issues) and not any(i.get("type") == "warning" for i in issues):
        if claim.status == ClaimStatus.DRAFT:
            claim.status = ClaimStatus.READY
            from routers.audit import log_action
            await log_action(db, "claim", body.claim_id, "auto_scrub_ready",
                            claim_id=body.claim_id, old_value="draft", new_value="ready",
                            notes=f"Auto-advanced: scrub score {score}")

    await db.commit()

    return ScrubResponse(claim_id=body.claim_id, score=score, issues=issues, suggestions=suggestions)


# ── Denial Analysis ───────────────────────────────────────────────────────────

@router.post("/denial-analysis", response_model=DenialAnalysisResponse)
async def analyze_denial(
    body: DenialAnalysisRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Analyze a denial and draft an appeal letter."""
    result = await db.execute(
        select(Denial).options(selectinload(Denial.claim)).where(Denial.id == body.denial_id)
    )
    denial = result.scalar_one_or_none()
    if not denial:
        raise HTTPException(404, "Denegación no encontrada")

    client = get_openai()
    if not client:
        return DenialAnalysisResponse(
            denial_id=body.denial_id,
            root_cause="Análisis de IA no disponible (configure OPENAI_API_KEY)",
            recommended_action="Revisar manualmente el código de denegación",
            appeal_probability=0.5,
            appeal_letter_draft=None,
        )

    prompt = f"""Eres un experto en apelaciones de reclamaciones médicas en Puerto Rico.

Denegación:
- Código: {denial.denial_code}
- Razón: {denial.denial_reason}
- CARC: {denial.carc_code or 'N/A'}
- RARC: {denial.rarc_code or 'N/A'}
- Fecha: {denial.denial_date}

Responde en JSON:
{{
  "root_cause": "Causa raíz de la denegación",
  "recommended_action": "Acción recomendada",
  "appeal_probability": 0.0-1.0,
  "appeal_letter_draft": "Carta de apelación completa en español..."
}}
"""
    resp = await client.chat.completions.create(
        model=settings.OPENAI_MODEL,
        messages=[{"role": "user", "content": prompt}],
        response_format={"type": "json_object"},
        max_tokens=1500,
    )
    data = json.loads(resp.choices[0].message.content)

    # Save analysis to denial
    denial.ai_analysis = data
    await db.commit()

    return DenialAnalysisResponse(
        denial_id=body.denial_id,
        root_cause=data.get("root_cause", ""),
        recommended_action=data.get("recommended_action", ""),
        appeal_probability=float(data.get("appeal_probability", 0.5)),
        appeal_letter_draft=data.get("appeal_letter_draft"),
    )


# ── Coding Assistant ──────────────────────────────────────────────────────────

@router.post("/coding-assist", response_model=CodingAssistResponse)
async def coding_assist(
    body: CodingAssistRequest,
    _: User = Depends(get_current_user),
):
    """Suggest CPT codes and modifiers from clinical description."""
    client = get_openai()
    if not client:
        return CodingAssistResponse(
            suggested_cpt_codes=[{"code": "99213", "description": "Office visit, established patient, moderate complexity"}],
            suggested_modifiers=[],
            notes="IA no disponible — sugerencias de demostración",
        )

    dx_context = f"\nDiagnósticos ICD-10: {', '.join(body.icd10_codes)}" if body.icd10_codes else ""
    specialty_context = f"\nEspecialidad: {body.specialty}" if body.specialty else ""

    prompt = f"""Eres un experto en codificación médica (CPC). Dado el siguiente texto clínico, sugiere los códigos CPT más apropiados.{specialty_context}{dx_context}

Descripción del servicio: {body.description}

Responde en JSON:
{{
  "suggested_cpt_codes": [{{"code": "...", "description": "...", "confidence": 0.0-1.0}}],
  "suggested_modifiers": ["-25", "-LT", etc.],
  "notes": "Notas adicionales de codificación..."
}}
"""
    resp = await client.chat.completions.create(
        model=settings.OPENAI_MODEL,
        messages=[{"role": "user", "content": prompt}],
        response_format={"type": "json_object"},
        max_tokens=600,
    )
    data = json.loads(resp.choices[0].message.content)
    return CodingAssistResponse(
        suggested_cpt_codes=data.get("suggested_cpt_codes", []),
        suggested_modifiers=data.get("suggested_modifiers", []),
        notes=data.get("notes", ""),
    )


# ── Denial Risk Scoring ───────────────────────────────────────────────────────

@router.post("/denial-risk/{claim_id}")
async def score_denial_risk(
    claim_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """
    Predict the likelihood this claim will be denied based on
    historical patterns, payer rules, and claim characteristics.
    """
    result = await db.execute(
        select(Claim)
        .options(
            selectinload(Claim.payer),
            selectinload(Claim.service_lines),
        )
        .where(Claim.id == claim_id)
    )
    claim = result.scalar_one_or_none()
    if not claim:
        raise HTTPException(404, "Reclamación no encontrada")

    client = get_openai()
    if not client:
        risk_score = 0.25  # baseline
        claim.denial_risk_score = risk_score
        await db.commit()
        return {"claim_id": claim_id, "denial_risk_score": risk_score, "factors": [], "demo": True}

    lines_summary = "; ".join(
        f"CPT {sl.cpt_code} (${sl.billed_amount:.2f})"
        for sl in claim.service_lines
    )
    prompt = f"""Evalúa el riesgo de denegación para esta reclamación médica en Puerto Rico.

Pagador: {claim.payer.name if claim.payer else 'Desconocido'}
Diagnósticos: {', '.join(claim.diagnosis_codes)}
Servicios: {lines_summary}
Lugar de servicio: {claim.place_of_service}
Total facturado: ${claim.total_billed:.2f}

Responde en JSON:
{{
  "denial_risk_score": 0.0-1.0,
  "factors": [{{"factor": "...", "impact": "high|medium|low"}}],
  "summary": "Resumen del riesgo..."
}}
"""
    resp = await client.chat.completions.create(
        model=settings.OPENAI_MODEL,
        messages=[{"role": "user", "content": prompt}],
        response_format={"type": "json_object"},
        max_tokens=400,
    )
    data = json.loads(resp.choices[0].message.content)
    risk_score = float(data.get("denial_risk_score", 0.3))
    claim.denial_risk_score = risk_score
    await db.commit()
    return {
        "claim_id": claim_id,
        "denial_risk_score": risk_score,
        "factors": data.get("factors", []),
        "summary": data.get("summary", ""),
    }
