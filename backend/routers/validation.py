"""
Claim Validation Rules Engine
Pre-submission checks: NPI, Tax ID, CPT/ICD-10 compatibility, timely filing, duplicates, prior auth, etc.
"""
from datetime import date, timedelta
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from sqlalchemy.orm import selectinload

from database import get_db
from models import Claim, Payer, User, ClaimStatus
from auth import get_current_user

router = APIRouter(prefix="/validation", tags=["validation"])


# ── NPI Luhn Check ────────────────────────────────────────────────────────────

def validate_npi(npi: str) -> bool:
    """NPI is a 10-digit number using Luhn algorithm (ISO 7812)."""
    if not npi or not npi.isdigit() or len(npi) != 10:
        return False
    # Prepend 80840 per CMS NPI standard for Luhn check
    padded = "80840" + npi
    total = 0
    for i, ch in enumerate(reversed(padded)):
        n = int(ch)
        if i % 2 == 1:
            n *= 2
            if n > 9:
                n -= 9
        total += n
    return total % 10 == 0


def validate_tax_id(ein: Optional[str]) -> bool:
    """EIN format: XX-XXXXXXX (9 digits, optional hyphen)."""
    if not ein:
        return False
    clean = ein.replace("-", "").replace(" ", "")
    return clean.isdigit() and len(clean) == 9


# ── CPT/ICD-10 Compatibility Rules ───────────────────────────────────────────

# CPT codes that require specific ICD-10 patterns
CPT_ICD_RULES: dict[str, dict] = {
    "92015": {
        "desc": "Refraction (92015) requires a refractive diagnosis (H52.x, Z01.0x)",
        "required_prefixes": ["H52", "Z01.0"],
        "severity": "warning",
    },
    "92310": {
        "desc": "Contact lens fitting (92310) requires keratoconus or refractive dx",
        "required_prefixes": ["H52", "H18.6", "Z97.3"],
        "severity": "warning",
    },
    "92326": {
        "desc": "Contact lens modification (92326) requires existing contact lens dx",
        "required_prefixes": ["H52", "Z97.3"],
        "severity": "info",
    },
    "92250": {
        "desc": "Fundus photography (92250) typically requires retinal pathology dx",
        "recommended_prefixes": ["H35", "H36", "E11.3", "E13.3"],
        "severity": "info",
    },
    "92083": {
        "desc": "Visual field testing (92083) typically requires glaucoma or neuro dx",
        "recommended_prefixes": ["H40", "H47", "G91"],
        "severity": "info",
    },
    "92004": {
        "desc": "New patient comprehensive exam requires new patient — verify E&M code",
        "severity": "info",
    },
    "99213": {
        "desc": "Office visit — verify appropriate E&M level for documentation",
        "severity": "info",
    },
    "99214": {
        "desc": "Moderate complexity E&M — ensure documentation supports this level",
        "severity": "info",
    },
}

# Prior auth required CPT/payer combos (payer_id prefix → CPT codes)
PRIOR_AUTH_RULES: dict[str, list[str]] = {
    "MEDICARE": ["92015", "92083", "92250", "92310"],
    "MMM": ["92015", "92310", "92250", "92083", "99215"],
    "TSS": ["92310", "92250", "92083"],
    "MCS": ["92310", "92083"],
    "ASES": ["92004", "92014", "92015", "92250", "92083", "92310"],
}

# Vision CPT codes that route to Envolve
VISION_CPT_CODES = {"92015", "92310", "92326", "92002", "92004", "92012", "92014"}

# Medical eye exam CPT codes (bypass Envolve for medical billing)
MEDICAL_EYE_CPT = {"92250", "92083", "92133", "92134", "92228", "92229"}

# Medical diagnoses that should bypass vision carve-out
MEDICAL_EYE_DX_PREFIXES = [
    "E11.3", "E13.3", "E10.3",  # Diabetic retinopathy
    "H40",  # Glaucoma
    "H35",  # Retinal disorders
    "H47",  # Optic nerve
    "G91",  # Hydrocephalus (neuro-ophthalmic)
    "H30",  # Chorioretinal inflammation
    "H31",  # Chorioretinal disorders
]

ENVOLVE_PAYER_ID = "56190"


def check_envolve_routing(cpt_codes: list[str], dx_codes: list[str], payer_id_str: str) -> dict:
    """Determine if a claim should route to Envolve or bypass for medical billing."""
    is_envolve_payer = payer_id_str == ENVOLVE_PAYER_ID
    has_vision_cpts = any(c in VISION_CPT_CODES for c in cpt_codes)
    has_medical_cpts = any(c in MEDICAL_EYE_CPT for c in cpt_codes)
    has_medical_dx = any(
        any(dx.startswith(prefix) for prefix in MEDICAL_EYE_DX_PREFIXES)
        for dx in dx_codes
    )

    result: dict = {
        "is_envolve_payer": is_envolve_payer,
        "route": "standard",
        "suggestion": None,
        "envolve_applicable": False,
    }

    if has_vision_cpts and not has_medical_dx:
        result["envolve_applicable"] = True
        result["route"] = "envolve"
        result["suggestion"] = "Vision CPT codes detected. Route through Envolve/Availity (Payer ID 56190)."

    if has_medical_dx:
        result["route"] = "medical_bypass"
        result["suggestion"] = (
            "Medical eye diagnosis detected (diabetic retinopathy, glaucoma, etc.). "
            "Consider billing directly to medical insurance for higher reimbursement. "
            "Bypass Envolve to avoid the ~35% TPA fee."
        )

    if has_medical_cpts and not has_medical_dx:
        result["route"] = "standard"
        result["suggestion"] = "Diagnostic procedures — verify medical necessity documentation."

    return result


# ── Main Validation Function ──────────────────────────────────────────────────

async def validate_claim(claim_id: int, db: AsyncSession) -> dict:
    """Run all validation rules against a claim. Returns issues list."""
    result = await db.execute(
        select(Claim)
        .options(
            selectinload(Claim.patient),
            selectinload(Claim.provider),
            selectinload(Claim.payer),
            selectinload(Claim.service_lines),
        )
        .where(Claim.id == claim_id)
    )
    claim = result.scalar_one_or_none()
    if not claim:
        return {"claim_id": claim_id, "issues": [], "valid": False, "error": "Claim not found"}

    issues = []
    cpt_codes = [sl.cpt_code for sl in claim.service_lines]
    dx_codes = claim.diagnosis_codes or []

    # ── NPI ───────────────────────────────────────────────────────────────────
    if claim.provider:
        if not validate_npi(claim.provider.npi or ""):
            issues.append({
                "severity": "error",
                "code": "INVALID_NPI",
                "field": "provider.npi",
                "message_key": "validation.msg.invalid_npi",
                "message_params": {"npi": claim.provider.npi},
                "message": f"NPI '{claim.provider.npi}' falla la validación Luhn. Verifique el número.",
            })

    # ── Tax ID ────────────────────────────────────────────────────────────────
    if claim.provider:
        if not validate_tax_id(claim.provider.ein):
            issues.append({
                "severity": "warning",
                "code": "MISSING_TAX_ID",
                "field": "provider.ein",
                "message_key": "validation.msg.missing_tax_id",
                "message": "EIN/Tax ID faltante o formato incorrecto (debe ser XX-XXXXXXX).",
            })

    # ── Required Fields ───────────────────────────────────────────────────────
    if not cpt_codes:
        issues.append({
            "severity": "error",
            "code": "NO_SERVICE_LINES",
            "field": "service_lines",
            "message_key": "validation.msg.no_service_lines",
            "message": "La reclamación no tiene líneas de servicio (CPT codes).",
        })

    if not dx_codes:
        issues.append({
            "severity": "error",
            "code": "NO_DIAGNOSIS",
            "field": "diagnosis_codes",
            "message_key": "validation.msg.no_diagnosis",
            "message": "La reclamación no tiene códigos de diagnóstico (ICD-10).",
        })

    if not claim.patient_id:
        issues.append({
            "severity": "error",
            "code": "NO_PATIENT",
            "field": "patient_id",
            "message_key": "validation.msg.no_patient",
            "message": "No hay paciente asignado a esta reclamación.",
        })

    if claim.total_billed <= 0:
        issues.append({
            "severity": "error",
            "code": "ZERO_BILLED",
            "field": "total_billed",
            "message_key": "validation.msg.zero_billed",
            "message": "El monto facturado es $0. Verifique las líneas de servicio.",
        })

    # ── CPT/ICD-10 Compatibility ──────────────────────────────────────────────
    for cpt in cpt_codes:
        rule = CPT_ICD_RULES.get(cpt)
        if rule:
            required = rule.get("required_prefixes", [])
            if required:
                has_required = any(
                    any(dx.startswith(pfx) for pfx in required)
                    for dx in dx_codes
                )
                if not has_required:
                    issues.append({
                        "severity": rule["severity"],
                        "code": f"CPT_DX_MISMATCH_{cpt}",
                        "field": "diagnosis_codes",
                        "message_key": f"validation.msg.cpt_{cpt.lower()}_dx",
                        "message_params": {"cpt": cpt},
                        "message": rule["desc"],
                    })

    # ── Timely Filing ─────────────────────────────────────────────────────────
    if claim.payer and claim.service_date_from:
        today = date.today()
        days_since = (today - claim.service_date_from).days
        filing_limit = claim.payer.timely_filing_days or 90

        if days_since > filing_limit:
            issues.append({
                "severity": "error",
                "code": "TIMELY_FILING_EXCEEDED",
                "field": "service_date_from",
                "message_key": "validation.msg.timely_filing_exceeded",
                "message_params": {"days": days_since, "payer": claim.payer.name, "limit": filing_limit},
                "message": (
                    f"Han pasado {days_since} días desde la fecha de servicio. "
                    f"El límite de {claim.payer.name} es {filing_limit} días. "
                    "Esta reclamación puede ser denegada por presentación tardía."
                ),
            })
        elif days_since > (filing_limit * 0.8):
            issues.append({
                "severity": "warning",
                "code": "TIMELY_FILING_WARNING",
                "field": "service_date_from",
                "message_key": "validation.msg.timely_filing_warning",
                "message_params": {"days": days_since, "limit": filing_limit, "remaining": filing_limit - days_since},
                "message": (
                    f"Advertencia: {days_since} días desde la fecha de servicio. "
                    f"El límite es {filing_limit} días — quedan {filing_limit - days_since} días."
                ),
            })

    # ── Duplicate Detection ───────────────────────────────────────────────────
    if claim.patient_id and claim.payer_id and claim.service_date_from:
        dup_result = await db.execute(
            select(Claim).where(
                and_(
                    Claim.patient_id == claim.patient_id,
                    Claim.payer_id == claim.payer_id,
                    Claim.service_date_from == claim.service_date_from,
                    Claim.id != claim.id,
                    Claim.status.notin_([ClaimStatus.VOID]),
                )
            )
        )
        duplicates = dup_result.scalars().all()
        if duplicates:
            dup_nums = ", ".join(d.claim_number for d in duplicates[:3])
            issues.append({
                "severity": "warning",
                "code": "POSSIBLE_DUPLICATE",
                "field": "claim",
                "message_key": "validation.msg.possible_duplicate",
                "message_params": {"claims": dup_nums},
                "message": (
                    f"Posible reclamación duplicada detectada: {dup_nums}. "
                    "Mismo paciente, pagador y fecha de servicio."
                ),
            })

    # ── Prior Auth ────────────────────────────────────────────────────────────
    if claim.payer:
        payer_id_str = claim.payer.payer_id
        pa_cpts = PRIOR_AUTH_RULES.get(payer_id_str, [])
        for cpt in cpt_codes:
            if cpt in pa_cpts and not claim.prior_auth_number:
                issues.append({
                    "severity": "warning",
                    "code": f"PRIOR_AUTH_REQUIRED_{cpt}",
                    "field": "prior_auth_number",
                    "message_key": "validation.msg.prior_auth_required",
                    "message_params": {"cpt": cpt, "payer": claim.payer.name},
                    "message": (
                        f"CPT {cpt} puede requerir autorización previa de {claim.payer.name}. "
                        "Verifique si hay auth y añádala antes de someter."
                    ),
                })

    # ── Envolve Routing ───────────────────────────────────────────────────────
    envolve = check_envolve_routing(
        cpt_codes,
        dx_codes,
        claim.payer.stedi_payer_id or "" if claim.payer else "",
    )

    # ── Summary ───────────────────────────────────────────────────────────────
    errors = [i for i in issues if i["severity"] == "error"]
    warnings = [i for i in issues if i["severity"] == "warning"]
    infos = [i for i in issues if i["severity"] == "info"]
    is_valid = len(errors) == 0

    return {
        "claim_id": claim_id,
        "is_valid": is_valid,
        "error_count": len(errors),
        "warning_count": len(warnings),
        "info_count": len(infos),
        "issues": issues,
        "envolve_routing": envolve,
    }


# ── API Endpoint ──────────────────────────────────────────────────────────────

@router.post("/claims/{claim_id}")
async def validate_claim_endpoint(
    claim_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Run all validation rules against a claim before submission."""
    result = await validate_claim(claim_id, db)
    if "error" in result:
        raise HTTPException(404, result["error"])
    return result


@router.post("/claims/{claim_id}/envolve-routing")
async def get_envolve_routing(
    claim_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Check if a claim should route through Envolve vs direct billing."""
    claim_result = await db.execute(
        select(Claim)
        .options(selectinload(Claim.payer), selectinload(Claim.service_lines))
        .where(Claim.id == claim_id)
    )
    claim = claim_result.scalar_one_or_none()
    if not claim:
        raise HTTPException(404, "Claim not found")

    cpt_codes = [sl.cpt_code for sl in claim.service_lines]
    dx_codes = claim.diagnosis_codes or []
    payer_stedi_id = claim.payer.stedi_payer_id if claim.payer else ""

    return check_envolve_routing(cpt_codes, dx_codes, payer_stedi_id or "")
