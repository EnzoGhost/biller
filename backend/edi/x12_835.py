"""
X12 835 ERA (Electronic Remittance Advice) Parser
HIPAA 5010 (005010X221A1)

Parses incoming 835 files from payers/clearinghouses and returns
structured payment data for auto-posting.

Usage:
    from edi.x12_835 import parse_835
    result = parse_835(raw_edi_string)
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Optional


# ── Data models ───────────────────────────────────────────────────────────────

@dataclass
class ServiceLinePayment:
    """Payment detail for a single service line."""
    procedure_code: str
    modifiers: list[str]
    billed_amount: float
    paid_amount: float
    allowed_amount: float
    # CAS adjustments at service line level
    adjustments: list[dict]         # [{"group": "CO", "code": "45", "amount": 10.00}]
    # Original service date
    service_date: Optional[str]     # YYYYMMDD


@dataclass
class ClaimPayment:
    """Payment detail for a single claim from the 835."""
    # Identifiers
    claim_number: str               # CLP01 — patient control number
    payer_claim_number: str         # CLP07 — payer's internal claim ICN
    # Amounts
    billed_amount: float            # CLP03
    paid_amount: float              # CLP04
    patient_responsibility: float   # CLP05
    # Status
    claim_status_code: str          # CLP02: 1=paid, 2=adjusted, 3=denied, 4=denied
    # Adjustments (CARC/RARC)
    adjustments: list[dict]         # [{"group": "CO", "code": "45", "amount": 10.00}]
    # Service lines
    service_lines: list[ServiceLinePayment] = field(default_factory=list)
    # Remarks
    remark_codes: list[str] = field(default_factory=list)
    # Dates
    check_date: Optional[str] = None
    service_date: Optional[str] = None


@dataclass
class ERAResult:
    """Full parsed result from a single 835 file."""
    # Payer info
    payer_name: str
    payer_id: str
    # Payee info
    payee_name: str
    payee_npi: str
    # Check/EFT info
    check_number: str
    check_date: str
    payment_amount: float           # BPR02
    payment_method: str             # BPR04: CHK=check, ACH=EFT
    # Claims
    claims: list[ClaimPayment] = field(default_factory=list)
    # Raw segments for debugging
    raw_segments: list[list[str]] = field(default_factory=list)


# ── Parser ────────────────────────────────────────────────────────────────────

class X12835Parser:
    """
    Parse X12 835 ERA files into structured ClaimPayment objects.

    Handles:
    - BPR: payment info (check #, amount, method)
    - TRN: trace number
    - REF: references
    - DTM: dates
    - N1/N3/N4: payer and payee name/address loops
    - CLP: claim payment
    - CAS: claim/line adjustments (CARC codes)
    - NM1 within claim loops
    - SVC: service line payment
    - PLB: provider-level adjustments (parsed but not surfaced to ClaimPayment)
    """

    SEG_TERM_RE = re.compile(r"[~\n]")

    def parse(self, raw: str) -> ERAResult:
        """Parse raw 835 EDI string → ERAResult."""
        segments = self._split_segments(raw)

        result = ERAResult(
            payer_name="",
            payer_id="",
            payee_name="",
            payee_npi="",
            check_number="",
            check_date="",
            payment_amount=0.0,
            payment_method="",
        )

        current_claim: Optional[ClaimPayment] = None
        current_svc: Optional[ServiceLinePayment] = None
        in_payer_loop = False
        in_payee_loop = False
        check_date_trn: Optional[str] = None

        for seg in segments:
            if not seg:
                continue
            result.raw_segments.append(seg)
            seg_id = seg[0]

            # ── Interchange / functional group (skip) ─────────────────────────
            if seg_id in ("ISA", "GS", "ST", "GE", "IEA", "SE"):
                continue

            # ── BPR — Beginning of Payment ────────────────────────────────────
            elif seg_id == "BPR":
                result.payment_method = self._elem(seg, 4, "")
                result.payment_amount = self._float(seg, 2)
                # BPR16 = check date for check payments
                check_date_val = self._elem(seg, 16, "")
                if check_date_val:
                    result.check_date = check_date_val

            # ── TRN — Trace Number (check number) ─────────────────────────────
            elif seg_id == "TRN":
                result.check_number = self._elem(seg, 2, "")

            # ── DTM — Date ────────────────────────────────────────────────────
            elif seg_id == "DTM":
                qualifier = self._elem(seg, 1, "")
                val = self._elem(seg, 2, "")
                if qualifier == "405":      # Production date
                    result.check_date = result.check_date or val
                elif qualifier == "472" and current_claim:
                    current_claim.service_date = val

            # ── N1 — Name (payer/payee loops) ─────────────────────────────────
            elif seg_id == "N1":
                entity = self._elem(seg, 1, "")
                if entity == "PR":          # payer
                    in_payer_loop = True
                    in_payee_loop = False
                    result.payer_name = self._elem(seg, 2, "")
                    result.payer_id   = self._elem(seg, 4, "")
                elif entity == "PE":        # payee
                    in_payer_loop = False
                    in_payee_loop = True
                    result.payee_name = self._elem(seg, 2, "")
                    result.payee_npi  = self._elem(seg, 4, "")
                else:
                    in_payer_loop = False
                    in_payee_loop = False

            # ── CLP — Claim Payment ───────────────────────────────────────────
            elif seg_id == "CLP":
                # Save any pending claim
                if current_claim is not None:
                    if current_svc is not None:
                        current_claim.service_lines.append(current_svc)
                        current_svc = None
                    result.claims.append(current_claim)

                current_claim = ClaimPayment(
                    claim_number        = self._elem(seg, 1, ""),
                    claim_status_code   = self._elem(seg, 2, ""),
                    billed_amount       = self._float(seg, 3),
                    paid_amount         = self._float(seg, 4),
                    patient_responsibility = self._float(seg, 5),
                    payer_claim_number  = self._elem(seg, 7, ""),
                    adjustments         = [],
                )
                current_claim.check_date = result.check_date

            # ── CAS — Claim Adjustment ────────────────────────────────────────
            elif seg_id == "CAS":
                adjustment = self._parse_cas(seg)
                if current_svc is not None:
                    current_svc.adjustments.extend(adjustment)
                elif current_claim is not None:
                    current_claim.adjustments.extend(adjustment)

            # ── NM1 within claim loop (patient, insured, etc.) ────────────────
            elif seg_id == "NM1" and current_claim is not None:
                pass  # Not needed for payment posting; skip for now

            # ── REF within claim loop ─────────────────────────────────────────
            elif seg_id == "REF" and current_claim is not None:
                qualifier = self._elem(seg, 1, "")
                value     = self._elem(seg, 2, "")
                if qualifier == "1L":     # group or policy number
                    pass
                elif qualifier == "EA":   # medical record number
                    pass

            # ── SVC — Service Line Payment ────────────────────────────────────
            elif seg_id == "SVC":
                # Save previous service line
                if current_svc is not None and current_claim is not None:
                    current_claim.service_lines.append(current_svc)

                # SVC01: composite HC:CPT:MOD1:MOD2
                svc01 = self._elem(seg, 1, "")
                parts = svc01.split(":")
                proc  = parts[1] if len(parts) > 1 else parts[0]
                mods  = parts[2:] if len(parts) > 2 else []

                billed  = self._float(seg, 2)
                paid    = self._float(seg, 3)
                allowed = billed  # approximation; often same as billed pre-adjustment

                current_svc = ServiceLinePayment(
                    procedure_code = proc,
                    modifiers      = mods,
                    billed_amount  = billed,
                    paid_amount    = paid,
                    allowed_amount = allowed,
                    adjustments    = [],
                    service_date   = None,
                )

            # ── DTM within SVC (service date) ────────────────────────────────
            # Handled above but SVC-specific DTP472 comes after SVC
            # We check here again for the SVC context
            # (DTM is already handled above; this is a no-op re-check)

            # ── MOA — Medicare Outpatient Adjudication (skip) ─────────────────
            elif seg_id == "MOA":
                if current_claim and len(seg) > 9:
                    remarks = [r for r in seg[9:] if r]
                    current_claim.remark_codes.extend(remarks)

            # ── LQ — Remark Code ──────────────────────────────────────────────
            elif seg_id == "LQ":
                code = self._elem(seg, 2, "")
                if code and current_claim:
                    current_claim.remark_codes.append(code)

        # Flush last claim/svc
        if current_svc is not None and current_claim is not None:
            current_claim.service_lines.append(current_svc)
        if current_claim is not None:
            result.claims.append(current_claim)

        return result

    # ── Internal helpers ──────────────────────────────────────────────────────

    def _split_segments(self, raw: str) -> list[list[str]]:
        """
        Detect element separator and segment terminator from ISA, then split.
        Handles both ~ and newline-delimited files.
        """
        raw = raw.strip()
        if not raw.startswith("ISA"):
            raise ValueError("Not a valid X12 file: does not begin with ISA")

        # ISA is exactly 106 chars; ISA16 (char at position 105) is sub-sep,
        # and char at position 106 is segment terminator
        elem_sep = raw[3]    # char after "ISA"
        seg_term = raw[105]  # ISA ends at 105 (0-indexed), next char is seg terminator

        # Split on segment terminator
        raw_segs = raw.split(seg_term)
        segments = []
        for s in raw_segs:
            s = s.strip()
            if s:
                segments.append(s.split(elem_sep))
        return segments

    @staticmethod
    def _elem(seg: list[str], index: int, default: str = "") -> str:
        try:
            return seg[index].strip()
        except IndexError:
            return default

    @staticmethod
    def _float(seg: list[str], index: int) -> float:
        try:
            return float(seg[index])
        except (IndexError, ValueError, TypeError):
            return 0.0

    @staticmethod
    def _parse_cas(seg: list[str]) -> list[dict]:
        """
        CAS — Claim Adjustment Segment.
        Pattern: CAS*GROUP*CODE*AMT[*CODE*AMT...] (up to 6 triplets)
        """
        adjustments = []
        group = seg[1] if len(seg) > 1 else ""
        # Elements 2,3,4 → 5,6,7 → ... up to 6 pairs
        i = 2
        while i + 1 < len(seg):
            code = seg[i] if i < len(seg) else ""
            try:
                amt = float(seg[i + 1]) if i + 1 < len(seg) else 0.0
            except ValueError:
                amt = 0.0
            if code:
                adjustments.append({
                    "group":  group,    # CO=contractual, PR=patient resp, OA=other
                    "code":   code,     # CARC code
                    "amount": amt,
                })
            i += 3  # skip optional quantity field
        return adjustments


# ── Convenience function ──────────────────────────────────────────────────────

def parse_835(raw: str) -> ERAResult:
    """
    Parse a raw X12 835 EDI string.

    Returns an ERAResult with .claims list — each ClaimPayment has:
      - claim_number: matches our claim_number field
      - paid_amount, billed_amount, patient_responsibility
      - adjustments: list of {group, code, amount} dicts
      - service_lines: per-line breakdown

    For auto-posting, iterate result.claims and match by claim_number.
    """
    return X12835Parser().parse(raw)


def match_era_to_claims(era: ERAResult, db_claims: list) -> list[dict]:
    """
    Match parsed ERA claim payments to DB claims by claim_number.

    Args:
        era:       Parsed ERAResult
        db_claims: List of Claim ORM objects

    Returns:
        List of dicts: {
            "claim": Claim,
            "payment": ClaimPayment,
            "matched": True/False,
        }
    """
    # Build lookup: claim_number → Claim
    claim_map = {c.claim_number: c for c in db_claims}

    results = []
    for payment in era.claims:
        db_claim = claim_map.get(payment.claim_number)
        results.append({
            "claim":   db_claim,
            "payment": payment,
            "matched": db_claim is not None,
        })

    return results
