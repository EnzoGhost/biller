"""
X12 837P Professional Claim Generator
HIPAA 5010 (005010X222A1) compliant

Segment terminators:
  ~  = segment terminator
  *  = element separator
  :  = sub-element separator

Usage:
    from edi.x12_837p import generate_837p
    edi_text = generate_837p(claim, submitter_id="INMEDIATA123")
"""
from __future__ import annotations

import re
from datetime import datetime, date
from typing import Optional

from models import Claim


# ── Helpers ───────────────────────────────────────────────────────────────────

SEG_TERM = "~"
ELEM_SEP = "*"
SUB_SEP  = ":"
REPEAT_SEP = "^"
LINE_BREAK = "\n"  # optional; set to "" for single-line output


def _pad(value: str, length: int) -> str:
    """Right-pad or truncate to exactly `length` characters."""
    value = str(value or "")
    return value[:length].ljust(length)


def _clean(value: str | None) -> str:
    """Strip non-printable / special X12 characters from a string value."""
    if not value:
        return ""
    # Remove segment/element/sub separators from data values
    cleaned = re.sub(r"[~*:\^]", "", str(value))
    return cleaned.strip()


def _fmt_date(d: date | None, fmt: str = "%Y%m%d") -> str:
    if d is None:
        return ""
    if isinstance(d, datetime):
        d = d.date()
    return d.strftime(fmt)


def _fmt_amount(amount: float | None) -> str:
    if amount is None:
        return "0.00"
    return f"{amount:.2f}"


def _seg(*elements) -> str:
    """Build an X12 segment string."""
    return ELEM_SEP.join(str(e) for e in elements) + SEG_TERM


def _zip_clean(zip_code: str | None) -> str:
    """Return only digits, max 9 chars."""
    if not zip_code:
        return ""
    digits = re.sub(r"\D", "", zip_code)
    return digits[:9]


# ── Main Generator ────────────────────────────────────────────────────────────

class X12837PGenerator:
    """
    Generates HIPAA 5010 (005010X222A1) 837P EDI from a fully-loaded Claim.

    The Claim must have .patient, .provider, .payer, and .service_lines
    already loaded (via selectinload or similar).
    """

    def __init__(
        self,
        submitter_id: str,
        submitter_name: str = "MEDICAL BILLER PR",
        submitter_phone: str = "7875550100",
        receiver_id: str = "INMEDIATA",
        sender_qualifier: str = "ZZ",
        receiver_qualifier: str = "ZZ",
        usage_indicator: str = "T",  # T=test, P=production
        control_number: int = 1,
    ):
        self.submitter_id   = submitter_id
        self.submitter_name = submitter_name
        self.submitter_phone = submitter_phone
        self.receiver_id    = receiver_id
        self.sender_qual    = sender_qualifier
        self.receiver_qual  = receiver_qualifier
        self.usage_indicator = usage_indicator
        self.control_number  = control_number
        self._now = datetime.utcnow()
        self._segment_count  = 0

    # ── Low-level helpers ─────────────────────────────────────────────────────

    def _seg(self, *elements) -> str:
        self._segment_count += 1
        return _seg(*elements)

    def _isa(self) -> str:
        """
        ISA — Interchange Control Header (exactly 106 chars before ~).
        Field widths are fixed and MUST be space-padded to exact lengths.
        """
        dt = self._now
        # ISA06 sender ID: 15 chars, ISA08 receiver ID: 15 chars
        sender = _pad(self.submitter_id, 15)
        receiver = _pad(self.receiver_id, 15)
        isa_date = dt.strftime("%y%m%d")   # YYMMDD
        isa_time = dt.strftime("%H%M")     # HHMM
        ctrl     = str(self.control_number).zfill(9)

        # Build ISA as a fixed-width string — do NOT use _seg() since it counts
        parts = [
            "ISA",
            "00", _pad("", 10),       # auth qualifier, auth info
            "00", _pad("", 10),       # security qualifier, security info
            self.sender_qual, sender, # ISA05, ISA06
            self.receiver_qual, receiver,  # ISA07, ISA08
            isa_date, isa_time,        # ISA09, ISA10
            REPEAT_SEP,                # ISA11 — repetition separator
            "00501",                   # ISA12 — version
            ctrl,                      # ISA13 — control number
            "0",                       # ISA14 — ack requested
            self.usage_indicator,      # ISA15 — T or P
            SUB_SEP,                   # ISA16 — sub-element separator
        ]
        # ISA counts as 1 segment (add manually since we bypass _seg)
        self._segment_count += 1
        return ELEM_SEP.join(parts) + SEG_TERM

    def generate(self, claim: "Claim") -> str:
        """
        Generate a complete 837P EDI transaction for a single claim.
        Returns the raw X12 EDI string.
        """
        self._segment_count = 0
        segments: list[str] = []

        now = self._now
        ctrl = str(self.control_number).zfill(9)
        gs_date = now.strftime("%Y%m%d")
        gs_time = now.strftime("%H%M")

        # ── Interchange & Group Headers ───────────────────────────────────────
        segments.append(self._isa())  # ISA already counted

        # GS — Functional Group Header
        segments.append(self._seg(
            "GS", "HC",
            _clean(self.submitter_id)[:15],
            _clean(self.receiver_id)[:15],
            gs_date, gs_time,
            "1",         # group control number
            "X",         # responsible agency code
            "005010X222A1",
        ))

        # ST — Transaction Set Header
        segments.append(self._seg("ST", "837", "0001", "005010X222A1"))

        # BHT — Beginning of Hierarchical Transaction
        # BHT06: CH = claim, RP = reporting (for ERA)
        segments.append(self._seg(
            "BHT", "0019", "00",
            claim.claim_number,
            gs_date, gs_time,
            "CH",
        ))

        # ── 1000A — Submitter ─────────────────────────────────────────────────
        segments.append(self._seg(
            "NM1", "41", "2",
            _clean(self.submitter_name), "", "", "", "",
            "46",
            _clean(self.submitter_id),
        ))
        segments.append(self._seg(
            "PER", "IC",
            "BILLING DEPT",
            "TE",
            re.sub(r"\D", "", self.submitter_phone)[:10],
        ))

        # ── 1000B — Receiver ──────────────────────────────────────────────────
        segments.append(self._seg(
            "NM1", "40", "2",
            _clean(self.receiver_id), "", "", "", "",
            "46",
            _clean(self.receiver_id),
        ))

        # ── 2000A — Billing Provider HL ───────────────────────────────────────
        hl_billing = "1"
        segments.append(self._seg("HL", hl_billing, "", "20", "1"))

        # PRV — Provider specialty (if taxonomy code available)
        if claim.provider.taxonomy_code:
            segments.append(self._seg(
                "PRV", "BI", "PXC", _clean(claim.provider.taxonomy_code)
            ))

        # ── 2010AA — Billing Provider Name ───────────────────────────────────
        ein = re.sub(r"\D", "", claim.provider.ein or "")
        npi = _clean(claim.provider.npi)

        # Individual provider (person) vs organization
        # We treat as individual since we have first/last
        segments.append(self._seg(
            "NM1", "85", "1",
            _clean(claim.provider.last_name),
            _clean(claim.provider.first_name),
            "", "", "",
            "XX", npi,
        ))
        segments.append(self._seg(
            "N3",
            _clean(claim.provider.address_line1 or "UNKNOWN"),
        ))
        segments.append(self._seg(
            "N4",
            _clean(claim.provider.city or "SAN JUAN"),
            claim.provider.state or "PR",
            _zip_clean(claim.provider.zip_code),
        ))
        if ein:
            segments.append(self._seg("REF", "EI", ein))  # Tax ID (EIN)
        if claim.provider.license_number:
            segments.append(self._seg(
                "REF", "0B", _clean(claim.provider.license_number)
            ))

        # ── 2000B — Subscriber HL ─────────────────────────────────────────────
        hl_subscriber = "2"
        segments.append(self._seg("HL", hl_subscriber, hl_billing, "22", "0"))

        # SBR — Subscriber Information
        # SBR01: P=primary, S=secondary
        # SBR02: 18=self, 01=spouse, 19=child, G8=other
        # SBR09: CI=commercial, MA=Medicare Part A, MB=Medicare Part B, MC=Medicaid
        payer_type_code = self._payer_type_code(claim)
        segments.append(self._seg(
            "SBR", "P", "18", "", "", "", "", "", "", payer_type_code
        ))

        # ── 2010BA — Subscriber (Patient) Name ───────────────────────────────
        patient = claim.patient

        # Resolve member ID from patient insurances if available
        member_id = ""
        if hasattr(patient, "insurances") and patient.insurances:
            primary = next(
                (ins for ins in patient.insurances if ins.is_primary),
                patient.insurances[0] if patient.insurances else None,
            )
            if primary:
                member_id = primary.member_id or ""

        gender_code = patient.gender.value if patient.gender else "U"

        segments.append(self._seg(
            "NM1", "IL", "1",
            _clean(patient.last_name),
            _clean(patient.first_name),
            "", "", "",
            "MI", _clean(member_id),
        ))
        if patient.address_line1:
            segments.append(self._seg("N3", _clean(patient.address_line1)))
            segments.append(self._seg(
                "N4",
                _clean(patient.city or "SAN JUAN"),
                patient.state or "PR",
                _zip_clean(patient.zip_code),
            ))
        segments.append(self._seg(
            "DMG", "D8",
            _fmt_date(patient.dob),
            gender_code if gender_code in ("M", "F") else "U",
        ))

        # ── 2010BB — Payer Name ───────────────────────────────────────────────
        payer = claim.payer
        payer_id = _clean(
            payer.inmediata_payer_id or payer.payer_id or payer.name
        )
        segments.append(self._seg(
            "NM1", "PR", "2",
            _clean(payer.name), "", "", "", "",
            "PI", payer_id,
        ))
        if payer.address_line1:
            segments.append(self._seg("N3", _clean(payer.address_line1)))
            segments.append(self._seg(
                "N4",
                _clean(payer.city or ""),
                payer.state or "PR",
                _zip_clean(payer.zip_code),
            ))

        # ── 2300 — Claim Information ──────────────────────────────────────────
        pos = claim.place_of_service or "11"
        total_charge = _fmt_amount(claim.total_billed)

        # CLM*patient_control*charge**pos:B:1*Y*A*Y*I~
        segments.append(self._seg(
            "CLM",
            _clean(claim.claim_number),          # CLM01 patient control number
            total_charge,                          # CLM02 total charge
            "",                                    # CLM03 not used
            "",                                    # CLM04 not used
            f"{pos}{SUB_SEP}B{SUB_SEP}1",         # CLM05 facility/freq (POS:code:freq)
            "Y",                                   # CLM06 provider signature
            "A",                                   # CLM07 Medicare assignment
            "Y",                                   # CLM08 benefits assignment
            "Y",                                   # CLM09 release info
        ))

        # DTP — Service date(s)
        svc_from = _fmt_date(claim.service_date_from)
        svc_to   = _fmt_date(claim.service_date_to)
        if svc_to and svc_to != svc_from:
            segments.append(self._seg("DTP", "472", "RD8", f"{svc_from}-{svc_to}"))
        else:
            segments.append(self._seg("DTP", "472", "D8", svc_from))

        # REF — Prior authorization
        if claim.prior_auth_number:
            segments.append(self._seg(
                "REF", "G1", _clean(claim.prior_auth_number)
            ))
        # REF — Referral number
        if claim.referral_number:
            segments.append(self._seg(
                "REF", "9F", _clean(claim.referral_number)
            ))

        # HI — Diagnosis Codes (ICD-10-CM)
        diag_codes = claim.diagnosis_codes or []
        if diag_codes:
            hi_parts = ["HI"]
            for i, code in enumerate(diag_codes[:12]):  # max 12 per HIPAA 5010
                qualifier = "ABK" if i == 0 else "ABF"
                clean_code = re.sub(r"\.", "", _clean(code))  # remove decimal
                hi_parts.append(f"{qualifier}{SUB_SEP}{clean_code}")
            segments.append(ELEM_SEP.join(hi_parts) + SEG_TERM)
            self._segment_count += 1

        # ── 2400 — Service Lines ──────────────────────────────────────────────
        for idx, sl in enumerate(claim.service_lines, start=1):
            segments.append(self._seg("LX", str(idx)))

            # SV1*HC:CPT:MOD1:MOD2*charge*UN*units**diag_pointers~
            cpt = _clean(sl.cpt_code)
            modifiers = sl.modifiers or []
            mod_str = SUB_SEP.join(
                [_clean(m) for m in modifiers[:4]]  # max 4 modifiers
            )
            proc_code = f"HC{SUB_SEP}{cpt}"
            if mod_str:
                proc_code += f"{SUB_SEP}{mod_str}"

            # Diagnosis pointers: integers → letters (1→A, 2→B...)
            diag_ptrs = sl.diagnosis_pointers or [1]
            ptr_str = ":".join(
                chr(64 + int(p)) for p in diag_ptrs[:4] if isinstance(p, (int, float))
            )

            sl_charge = _fmt_amount(sl.billed_amount)
            units = str(sl.units or 1)

            segments.append(self._seg(
                "SV1",
                proc_code,
                sl_charge,
                "UN",
                units,
                "",           # facility code — not used at line level for 837P
                "",           # SV106 not used
                ptr_str,      # diagnosis code pointers
            ))

            # DTP — service date for this line
            sl_date = sl.service_date or claim.service_date_from
            segments.append(self._seg("DTP", "472", "D8", _fmt_date(sl_date)))

        # ── Trailer ───────────────────────────────────────────────────────────
        # SE — Transaction Set Trailer
        # segment_count includes SE itself; add 1 here
        total_segs = self._segment_count + 1  # +1 for SE
        segments.append(_seg("SE", str(total_segs), "0001"))

        # GE — Functional Group Trailer
        segments.append(_seg("GE", "1", "1"))

        # IEA — Interchange Control Trailer
        segments.append(_seg("IEA", "1", ctrl))

        return LINE_BREAK.join(segments)

    # ── Utilities ─────────────────────────────────────────────────────────────

    @staticmethod
    def _payer_type_code(claim: "Claim") -> str:
        """Map payer type to X12 SBR09 claim filing indicator."""
        from models import PayerType
        mapping = {
            PayerType.MEDICARE:   "MB",
            PayerType.MEDICAID:   "MC",
            PayerType.COMMERCIAL: "CI",
            PayerType.VISION:     "CI",
            PayerType.DENTAL:     "CI",
            PayerType.OTHER:      "CI",
        }
        if claim.payer and claim.payer.payer_type:
            return mapping.get(claim.payer.payer_type, "CI")
        return "CI"


# ── Convenience function ──────────────────────────────────────────────────────

def generate_837p(
    claim: "Claim",
    submitter_id: str = "",
    submitter_name: str = "MEDICAL BILLER PR",
    receiver_id: str = "INMEDIATA",
    usage_indicator: str = "T",
    control_number: int = 1,
) -> str:
    """
    Convenience wrapper — generate an 837P EDI string for a single claim.

    Args:
        claim:            Fully loaded Claim ORM object
        submitter_id:     ISA sender ID (your clearinghouse submitter ID)
        submitter_name:   Human-readable submitter name
        receiver_id:      ISA receiver ID (payer/clearinghouse)
        usage_indicator:  'T' for test, 'P' for production
        control_number:   ISA control number (increment across batches)

    Returns:
        Raw X12 EDI string suitable for writing to a .edi or .txt file.
    """
    gen = X12837PGenerator(
        submitter_id=submitter_id or "UNKNOWN",
        submitter_name=submitter_name,
        receiver_id=receiver_id,
        usage_indicator=usage_indicator,
        control_number=control_number,
    )
    return gen.generate(claim)


def generate_837p_batch(
    claims: list["Claim"],
    submitter_id: str = "",
    submitter_name: str = "MEDICAL BILLER PR",
    receiver_id: str = "INMEDIATA",
    usage_indicator: str = "T",
) -> str:
    """
    Generate a single 837P batch file containing multiple claims.
    All claims share one ISA/GS envelope; each gets its own ST/SE transaction.
    """
    if not claims:
        return ""

    now = datetime.utcnow()
    ctrl = "1".zfill(9)
    gs_date = now.strftime("%Y%m%d")
    gs_time = now.strftime("%H%M")
    isa_date = now.strftime("%y%m%d")
    sender  = _pad(submitter_id or "UNKNOWN", 15)
    receiver = _pad(receiver_id, 15)

    lines: list[str] = []

    # ISA
    isa_parts = [
        "ISA", "00", _pad("", 10), "00", _pad("", 10),
        "ZZ", sender, "ZZ", receiver,
        isa_date, isa_time, REPEAT_SEP, "00501", ctrl, "0", usage_indicator, SUB_SEP,
    ]
    lines.append(ELEM_SEP.join(isa_parts) + SEG_TERM)

    # GS
    lines.append(_seg(
        "GS", "HC",
        (submitter_id or "UNKNOWN")[:15],
        receiver_id[:15],
        gs_date, gs_time, "1", "X", "005010X222A1",
    ))

    tx_count = 0
    for i, claim in enumerate(claims, start=1):
        tx_count += 1
        gen = X12837PGenerator(
            submitter_id=submitter_id or "UNKNOWN",
            submitter_name=submitter_name,
            receiver_id=receiver_id,
            usage_indicator=usage_indicator,
            control_number=i,
        )
        gen._now = now
        # We need the inner segments only (between ISA/GS and GE/IEA)
        # Generate the whole thing and strip the envelope
        full = gen.generate(claim)
        # Extract just ST→SE
        st_start = full.find("ST*")
        se_end   = full.find("SE*")
        if st_start == -1:
            continue
        # Find the end of the SE segment (up to and including ~)
        se_line_end = full.find(SEG_TERM, se_end) + 1
        inner = full[st_start:se_line_end]
        # Fix ST02 control number to match our sequence
        inner = inner.replace("ST*837*0001", f"ST*837*{str(i).zfill(4)}", 1)
        inner = inner.replace("SE*", f"SE*", 1)
        # Also fix SE02 to match
        se_pos = inner.rfind("SE*")
        if se_pos != -1:
            se_seg_end = inner.find(SEG_TERM, se_pos)
            old_se = inner[se_pos:se_seg_end]
            parts = old_se.split(ELEM_SEP)
            if len(parts) >= 3:
                parts[2] = str(i).zfill(4)
                inner = inner[:se_pos] + ELEM_SEP.join(parts) + inner[se_seg_end:]
        lines.append(inner)

    # GE
    lines.append(_seg("GE", str(tx_count), "1"))
    # IEA
    lines.append(_seg("IEA", "1", ctrl))

    return LINE_BREAK.join(lines)
