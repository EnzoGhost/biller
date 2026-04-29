"""
AI-powered features:
- Claim scrubbing (pre-submission quality check)
- Denial analysis + root cause
- Coding assistant (CPT suggestions from description)
- Appeal letter drafting
- Predictive denial risk scoring
"""
import json
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from config import settings
from database import get_db
from models import Claim, ClaimStatus, Denial, ServiceLine, User
from schemas import (
    ScrubRequest, ScrubResponse,
    DenialAnalysisRequest, DenialAnalysisResponse,
    CodingAssistRequest, CodingAssistResponse,
)
from auth import get_current_user

router = APIRouter(prefix="/ai", tags=["ai"])


def get_openai():
    if not settings.OPENAI_API_KEY:
        return None
    from openai import AsyncOpenAI
    return AsyncOpenAI(api_key=settings.OPENAI_API_KEY)


# ── Claim Scrubber ────────────────────────────────────────────────────────────

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
    _: User = Depends(get_current_user),
):
    """
    Analyze a claim for common billing errors before submission.
    Checks: missing dx pointers, invalid modifier combos, duplicate dates, etc.
    """
    result = await db.execute(
        select(Claim)
        .options(selectinload(Claim.service_lines), selectinload(Claim.payer))
        .where(Claim.id == body.claim_id)
    )
    claim = result.scalar_one_or_none()
    if not claim:
        raise HTTPException(404, "Reclamación no encontrada")

    issues = []
    suggestions = []

    # Rule-based checks (always run, no API key needed)
    if not claim.diagnosis_codes:
        issues.append({"type": "error", "field": "diagnosis_codes", "msg_key": "scrub.no_diagnosis", "msg": "No diagnosis codes"})
    if not claim.service_lines:
        issues.append({"type": "error", "field": "service_lines", "msg_key": "scrub.no_service_lines", "msg": "No service lines"})
    for sl in claim.service_lines:
        if not sl.diagnosis_pointers:
            issues.append({
                "type": "warning", "field": f"line_{sl.line_number}",
                "msg_key": "scrub.no_dx_pointers",
                "msg_params": {"line": sl.line_number, "cpt": sl.cpt_code},
                "msg": f"Line {sl.line_number} ({sl.cpt_code}): no diagnosis pointers"
            })
        if sl.billed_amount <= 0:
            issues.append({
                "type": "error", "field": f"line_{sl.line_number}",
                "msg_key": "scrub.invalid_billed_amount",
                "msg_params": {"line": sl.line_number},
                "msg": f"Line {sl.line_number}: invalid billed amount"
            })
        # Modifier checks
        mods = [m.strip("-").upper() for m in sl.modifiers]
        if "LT" in mods and "RT" in mods:
            issues.append({
                "type": "error", "field": f"line_{sl.line_number}",
                "msg_key": "scrub.lt_rt_conflict",
                "msg_params": {"line": sl.line_number},
                "msg": f"Line {sl.line_number}: cannot use -LT and -RT together"
            })
        if "50" in mods and ("LT" in mods or "RT" in mods):
            issues.append({
                "type": "warning", "field": f"line_{sl.line_number}",
                "msg_key": "scrub.mod50_conflict",
                "msg_params": {"line": sl.line_number},
                "msg": f"Line {sl.line_number}: modifier -50 should not combine with -LT/-RT"
            })

    if not claim.provider_id:
        issues.append({"type": "error", "field": "provider", "msg": "Sin proveedor asignado"})

    errors = [i for i in issues if i["type"] == "error"]
    warnings = [i for i in issues if i["type"] == "warning"]
    score = max(0.0, 100.0 - len(errors) * 20.0 - len(warnings) * 5.0)

    # AI enhancement if OpenAI available
    client = get_openai()
    if client and claim.service_lines:
        lines_summary = "; ".join(
            f"CPT {sl.cpt_code} (${sl.billed_amount:.2f}, mods: {sl.modifiers})"
            for sl in claim.service_lines
        )
        dx_summary = ", ".join(claim.diagnosis_codes)
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

    # Auto-advance to ready if scrub passes
    if score >= 80 and not any(i.get("type") == "error" for i in issues):
        if claim.status == ClaimStatus.DRAFT:
            claim.status = ClaimStatus.READY
            from routers.audit import log_action
            await log_action(db, "claim", body.claim_id,  "auto_scrub_ready",
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
