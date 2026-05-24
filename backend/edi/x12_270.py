"""
X12 270 Eligibility Inquiry Generator
HIPAA 5010 compliant (005010X279A1)

Usage:
    from edi.x12_270 import generate_270
    x12_string = generate_270(
        submitter_id="SUBID123",
        subscriber_last="SMITH",
        subscriber_first="JOHN",
        subscriber_dob=date(1980, 5, 15),
        member_id="XYZ123456",
        payer_id="SB601",
        service_type_codes=["30"],  # 30=Health Benefit Plan Coverage
    )
"""
from __future__ import annotations

import re
from datetime import date, datetime
from typing import Optional


# ── Delimiters ────────────────────────────────────────────────────────────────

SEG_TERM  = "~"
ELEM_SEP  = "*"
SUB_SEP   = ":"
LINE_BREAK = "\n"


# ── Helpers ───────────────────────────────────────────────────────────────────

def _clean(value: str | None) -> str:
    if not value:
        return ""
    return re.sub(r"[~*:\^]", "", str(value)).strip().upper()


def _fmt_date(d: date | None, fmt: str = "%Y%m%d") -> str:
    if d is None:
        return ""
    if isinstance(d, datetime):
        d = d.date()
    return d.strftime(fmt)


def _seg(*elements: str) -> str:
    return ELEM_SEP.join(elements) + SEG_TERM + LINE_BREAK


_isa_counter = 0
_gs_counter  = 0
_st_counter  = 0


def _next_isa() -> str:
    global _isa_counter
    _isa_counter = (_isa_counter % 999999999) + 1
    return str(_isa_counter).zfill(9)


def _next_gs() -> str:
    global _gs_counter
    _gs_counter = (_gs_counter % 99999) + 1
    return str(_gs_counter).zfill(5)


def _next_st() -> str:
    global _st_counter
    _st_counter = (_st_counter % 9999) + 1
    return str(_st_counter).zfill(4)


# ── Main Generator ────────────────────────────────────────────────────────────

def generate_270(
    *,
    submitter_id: str,
    submitter_name: str = "MEDICAL BILLER",
    receiver_id: str = "INMEDIATA",
    # Subscriber (patient / member being checked)
    subscriber_last: str,
    subscriber_first: str,
    subscriber_dob: date | None = None,
    subscriber_gender: str = "",     # M, F, or ""
    member_id: str,
    group_number: str = "",
    # Payer
    payer_id: str,
    payer_name: str = "",
    # Provider (requestor)
    provider_npi: str = "",
    provider_last_name: str = "",
    provider_first_name: str = "",
    # Service type codes (loop 2110C)
    service_type_codes: list[str] | None = None,
    # Timestamps
    inquiry_date: date | None = None,
) -> str:
    """
    Generate a HIPAA 5010 X12 270 Eligibility Benefit Inquiry.

    Returns the raw X12 string (segments separated by ~ and newlines).
    """
    if inquiry_date is None:
        inquiry_date = date.today()
    if service_type_codes is None:
        service_type_codes = ["30"]  # 30 = Health Benefit Plan Coverage

    now = datetime.utcnow()
    date_str  = now.strftime("%Y%m%d")
    time_str  = now.strftime("%H%M")
    isa_ctrl  = _next_isa()
    gs_ctrl   = _next_gs()
    st_ctrl   = _next_st()

    sub_id_clean   = _clean(submitter_id)[:15].ljust(15)
    recv_id_clean  = _clean(receiver_id)[:15].ljust(15)

    segments: list[str] = []

    # ISA — Interchange Control Header
    segments.append(_seg(
        "ISA",
        "00", " " * 10,          # auth info qualifier, auth info
        "00", " " * 10,          # security qualifier, security info
        "ZZ", sub_id_clean,      # sender qualifier + ID
        "ZZ", recv_id_clean,     # receiver qualifier + ID
        date_str[2:],            # date YYMMDD
        time_str,                # time HHMM
        "^",                     # repetition separator
        "00501",                 # version
        isa_ctrl,                # interchange control number
        "0",                     # acknowledgment requested
        "T",                     # usage: T=test, P=production
        SUB_SEP,                 # sub-element separator
    ))

    # GS — Functional Group Header
    segments.append(_seg(
        "GS",
        "HS",                    # functional ID: HS = 270
        _clean(submitter_id)[:15],
        _clean(receiver_id)[:15],
        date_str,
        time_str,
        gs_ctrl,
        "X",                     # responsible agency: X = ASC X12
        "005010X279A1",
    ))

    # ST — Transaction Set Header
    segments.append(_seg("ST", "270", st_ctrl, "005010X279A1"))

    # BHT — Beginning of Hierarchical Transaction
    segments.append(_seg(
        "BHT",
        "0022",                  # hierarchical structure: 0022 = Information Source, Subscriber
        "13",                    # purpose: 13 = Request
        f"270{isa_ctrl}",        # reference ID
        date_str,
        time_str,
    ))

    # ──────────────────────────────────────────────────────
    # Loop 2000A — Information Source Level (HL 1)
    # ──────────────────────────────────────────────────────
    segments.append(_seg("HL", "1", "", "20", "1"))  # 20=Information Source, child level exists

    # NM1 — Information Source (Payer)
    segments.append(_seg(
        "NM1",
        "PR",                    # entity ID: PR = Payer
        "2",                     # entity type: 2 = non-person
        _clean(payer_name) or "PAYER",
        "", "", "", "",          # first, middle, suffix, prefix
        "PI",                    # ID qualifier: PI = Payer ID
        _clean(payer_id),
    ))

    # ──────────────────────────────────────────────────────
    # Loop 2000B — Information Receiver Level (HL 2)
    # ──────────────────────────────────────────────────────
    segments.append(_seg("HL", "2", "1", "21", "1"))  # 21=Information Receiver

    # NM1 — Information Receiver (Provider)
    if provider_npi:
        segments.append(_seg(
            "NM1",
            "1P",                # entity ID: 1P = Provider
            "1" if provider_first_name else "2",
            _clean(provider_last_name) or "PROVIDER",
            _clean(provider_first_name),
            "", "", "",
            "XX",                # NPI qualifier
            _clean(provider_npi),
        ))
    else:
        segments.append(_seg(
            "NM1",
            "1P",
            "2",
            _clean(submitter_name),
            "", "", "", "",
            "ZZ",
            _clean(submitter_id)[:10],
        ))

    # ──────────────────────────────────────────────────────
    # Loop 2000C — Subscriber Level (HL 3)
    # ──────────────────────────────────────────────────────
    segments.append(_seg("HL", "3", "2", "22", "0"))  # 22=Subscriber, no child

    # TRN — Subscriber Trace Number (optional but useful for matching responses)
    segments.append(_seg(
        "TRN",
        "1",                     # trace type: 1 = Current Transaction Trace Numbers
        f"TRN{isa_ctrl}",        # reference ID
        "9" + _clean(submitter_id)[:9].ljust(9, "0"),
    ))

    # NM1 — Subscriber Name
    gender_code = _clean(subscriber_gender).upper()
    segments.append(_seg(
        "NM1",
        "IL",                    # entity ID: IL = Insured or Subscriber
        "1",                     # person
        _clean(subscriber_last),
        _clean(subscriber_first),
        "", "", "",
        "MI",                    # member ID qualifier
        _clean(member_id),
    ))

    # REF — Additional subscriber references
    if group_number:
        segments.append(_seg("REF", "6P", _clean(group_number)))  # 6P = Group Number

    # DMG — Subscriber Demographic Information
    if subscriber_dob:
        dob_str = _fmt_date(subscriber_dob)
        segments.append(_seg(
            "DMG",
            "D8",                # date format qualifier
            dob_str,
            gender_code if gender_code in ("M", "F") else "",
        ))

    # ──────────────────────────────────────────────────────
    # Loop 2110C — Eligibility or Benefit Inquiry
    # ──────────────────────────────────────────────────────
    for svc_code in service_type_codes:
        segments.append(_seg(
            "EQ",
            _clean(svc_code),   # service type code
        ))

    # DTP — Date of Service (optional)
    segments.append(_seg(
        "DTP",
        "291",                   # qualifier: 291 = Plan
        "D8",
        _fmt_date(inquiry_date),
    ))

    # SE — Transaction Set Trailer
    seg_count = len(segments) - 2 + 1  # count from ST, not ISA/GS; +1 for SE itself
    segments.append(_seg("SE", str(seg_count), st_ctrl))

    # GE — Functional Group Trailer
    segments.append(_seg("GE", "1", gs_ctrl))

    # IEA — Interchange Control Trailer
    segments.append(_seg("IEA", "1", isa_ctrl))

    return "".join(segments)
