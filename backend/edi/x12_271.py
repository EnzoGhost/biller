"""
X12 271 Eligibility Response Parser
HIPAA 5010 compliant (005010X279A1)

Parses a 271 X12 string and returns a structured dict with coverage details.

Usage:
    from edi.x12_271 import parse_271
    result = parse_271(x12_string)
    # result["status"]    → "active" | "inactive" | "unknown"
    # result["plan_name"] → str
    # result["copay"]     → list of {"service_type": ..., "amount": ...}
    # ...
"""
from __future__ import annotations

import re
from typing import Any


# ── Lookup tables ─────────────────────────────────────────────────────────────

# X12 271 EB01 — Eligibility / Benefit Information Codes
EB01_CODES: dict[str, str] = {
    "1":  "Active Coverage",
    "2":  "Active — Full Risk Capitation",
    "3":  "Active — Supplemental/Other",
    "4":  "Active — Spouse Only",
    "5":  "Active — Children Only",
    "6":  "Inactive",
    "7":  "Inactive — Pending Investigation",
    "A":  "Co-Insurance",
    "B":  "Co-Payment",
    "C":  "Deductible",
    "CB": "Coverage Basis",
    "D":  "Benefit Description",
    "E":  "Exclusions",
    "F":  "Limitations",
    "G":  "Out of Pocket (Stop Loss)",
    "H":  "Unlimited",
    "I":  "Non-Covered",
    "J":  "Cost Containment",
    "K":  "Reserve",
    "L":  "Primary Care Provider",
    "M":  "Pre-existing Condition",
    "MC": "Managed Care Coordinator",
    "N":  "Services Restricted to Following Provider",
    "O":  "Not Deemed a Medical Necessity",
    "P":  "Benefit Plan Name",
    "Q":  "In-Plan Network",
    "R":  "Other or Additional Payor",
    "S":  "Prior Year(s) History",
    "T":  "Card(s) Reported Lost/Stolen",
    "U":  "Contact Following Entity for Eligibility or Benefit Information",
    "V":  "Cannot Process",
    "W":  "Other Source of Data",
    "X":  "Health Care Facility",
    "Y":  "Spend Down",
}

# X12 271 Service Type Codes (partial — most common)
SERVICE_TYPE_CODES: dict[str, str] = {
    "1":  "Medical Care",
    "2":  "Surgical",
    "3":  "Consultation",
    "4":  "Diagnostic X-Ray",
    "5":  "Diagnostic Lab",
    "6":  "Radiation Therapy",
    "7":  "Anesthesia",
    "8":  "Surgical Assistance",
    "9":  "Other Medical",
    "10": "Blood Charges",
    "11": "Used Durable Medical Equipment",
    "12": "Durable Medical Equipment Purchase",
    "13": "Ambulatory Service Center Facility",
    "14": "Renal Supplies in the Home",
    "15": "Alternate Method Dialysis",
    "16": "Chronic Renal Disease (CRD) Equipment",
    "17": "Pre-Admission Testing",
    "18": "Durable Medical Equipment Rental",
    "20": "Skilled Nursing Care",
    "21": "Formal Mental Health Programs",
    "22": "Visit",
    "23": "Surgical Benefits (Professional Physician)",
    "24": "Surgical Benefits (Facility)",
    "25": "Hospital — Inpatient",
    "26": "Hospital — Outpatient",
    "27": "Hospital — Emergency Accident",
    "28": "Hospital — Emergency Medical",
    "29": "Hospital — Ambulatory Surgical",
    "30": "Health Benefit Plan Coverage",
    "33": "Chiropractic",
    "35": "Dental Care",
    "40": "Home Health Care",
    "42": "Home Health: Medical Equipment",
    "43": "Home Health: Drug Infusion",
    "44": "Home Health: DME",
    "45": "Hospice",
    "46": "Respite Care",
    "47": "Hospital",
    "48": "Psychiatric",
    "49": "Psychiatric — Room and Board",
    "50": "Substance Abuse",
    "51": "Alcoholism",
    "52": "Drug Addiction",
    "53": "Mental Health",
    "54": "Mental Health Facility — Inpatient",
    "55": "Mental Health Facility — Outpatient",
    "56": "Substance Abuse Facility — Inpatient",
    "57": "Substance Abuse Facility — Outpatient",
    "58": "Medical Pharmacy",
    "59": "Major Medical",
    "60": "Medically Related Transportation",
    "61": "In-vitro Fertilization",
    "62": "MRI/CAT Scan",
    "63": "Donor Procedures",
    "64": "Acupuncture",
    "65": "Newborn Care",
    "66": "Pathology",
    "67": "Smoking Cessation",
    "68": "Well Baby Care",
    "69": "Maternity",
    "70": "Transplants",
    "71": "Audiology Exam",
    "72": "Inhalation Therapy",
    "73": "Diagnostic Medical",
    "74": "Private Duty Nursing",
    "75": "Prosthetic Device",
    "76": "Dialysis",
    "77": "Otology",
    "78": "Chemotherapy",
    "79": "Allergy Testing",
    "80": "Immunizations",
    "81": "Routine Physical",
    "82": "Family Planning",
    "83": "Infertility",
    "84": "Abortion",
    "85": "AIDS",
    "86": "Emergency Services",
    "87": "Cancer",
    "88": "Pharmacy",
    "89": "Free Standing Prescription Drug",
    "90": "Mail Order Prescription Drug",
    "91": "Brand Name Prescription Drug",
    "92": "Generic Prescription Drug",
    "93": "Podiatry",
    "94": "Podiatry — Office Visits",
    "95": "Podiatry — Nursing Home Visits",
    "96": "Professional (Physician) Visit — Office",
    "97": "Professional (Physician) Visit — Inpatient",
    "98": "Professional (Physician) Visit — Outpatient",
    "99": "Professional (Physician) Visit — Nursing Home",
    "A0": "Skilled Nursing Care at Home",
    "A3": "Custodial Care",
    "A4": "Restorative",
    "A6": "Occupational Therapy",
    "A7": "Speech Therapy",
    "A8": "Audiology",
    "A9": "Physical Therapy",
    "AB": "Adult Day Care",
    "AC": "Pediatric",
    "AD": "Psychiatric — Partial Hospitalization",
    "AE": "Adult Mental Health",
    "AF": "Substance Abuse",
    "AG": "Alcoholism",
    "AH": "Drug Addiction",
    "AI": "Ophthalmology",
    "AJ": "Certified Nurse Midwife",
    "AK": "Certified Nurse Practitioner",
    "AL": "Other",
    "AM": "Osteopathic Manipulation",
    "AO": "Vision (Optometry)",
    "AP": "Frames",
    "AQ": "Routine Exam",
    "AR": "Lenses",
    "B1": "Nonmedically Necessary Physical",
    "B2": "Experimental Drug Therapy",
    "B3": "Burn Care",
    "B4": "Independent Medical Evaluation",
    "B5": "Psychiatric Treatment Partial Hospitalization (Less than 24 Hours)",
    "B6": "Master Social Worker",
    "B7": "Allied Health Professional",
    "B8": "Treatment Room",
    "B9": "Leaf Disease",
    "BA": "Day Care (Psychiatric)",
    "BB": "Cognitive Therapy",
    "BC": "Massage Therapy",
    "BD": "Pulmonary Rehabilitation",
    "BE": "Cardiac Rehabilitation",
    "BF": "Pediatric",
    "BG": "Nursery",
    "BH": "Skin",
    "BI": "Orthopedic",
    "BJ": "Cardiac",
    "BK": "Lymphatic",
    "BL": "Gastrointestinal",
    "BM": "Endocrine",
    "BN": "Neurology",
    "BO": "Eye",
    "BP": "Invasive Procedures",
}


# ── Parser ────────────────────────────────────────────────────────────────────

def _split_x12(x12: str) -> list[list[str]]:
    """Split raw X12 string into list of segments (each a list of elements)."""
    # Normalize line endings and segment terminators
    x12 = x12.strip()
    # Extract separator characters from ISA if present
    elem_sep = "*"
    sub_sep  = ":"
    seg_term = "~"

    if x12.startswith("ISA"):
        elem_sep = x12[3]
        sub_sep  = x12[104] if len(x12) > 104 else ":"
        seg_term = x12[105] if len(x12) > 105 else "~"

    # Split on segment terminator (ignore trailing whitespace after ~)
    raw_segs = re.split(re.escape(seg_term), x12)
    segments = []
    for seg in raw_segs:
        seg = seg.strip()
        if seg:
            segments.append(seg.split(elem_sep))
    return segments


def _safe(seg: list[str], idx: int, default: str = "") -> str:
    try:
        return (seg[idx] or "").strip()
    except IndexError:
        return default


def parse_271(x12_string: str) -> dict[str, Any]:
    """
    Parse a HIPAA 5010 X12 271 Eligibility Benefit Response.

    Returns a dict with:
      status          — "active" | "inactive" | "unknown" | "error"
      plan_name       — str or None
      group_number    — str or None
      member_id       — str or None
      subscriber_name — str or None
      payer_name      — str or None
      effective_date  — "YYYYMMDD" str or None
      term_date       — "YYYYMMDD" str or None
      copay           — list of {"service_type": str, "service_code": str, "amount": float, "network": str}
      deductible      — list of {"service_type": str, "amount": float, "remaining": float, "network": str}
      coinsurance     — list of {"service_type": str, "percent": float, "network": str}
      out_of_pocket   — list of {"service_type": str, "amount": float, "remaining": float, "network": str}
      covered_services— list of str (service type names)
      non_covered     — list of str
      errors          — list of str (AAA rejection reasons if any)
      raw_segments    — int (total segments parsed)
    """
    result: dict[str, Any] = {
        "status": "unknown",
        "plan_name": None,
        "group_number": None,
        "member_id": None,
        "subscriber_name": None,
        "payer_name": None,
        "effective_date": None,
        "term_date": None,
        "copay": [],
        "deductible": [],
        "coinsurance": [],
        "out_of_pocket": [],
        "covered_services": [],
        "non_covered": [],
        "errors": [],
        "raw_segments": 0,
    }

    if not x12_string or not x12_string.strip():
        result["status"] = "error"
        result["errors"].append("Empty 271 response")
        return result

    segments = _split_x12(x12_string)
    result["raw_segments"] = len(segments)

    # State tracking
    in_subscriber_loop = False
    current_eb: dict[str, Any] | None = None

    def _flush_eb():
        nonlocal current_eb
        if current_eb is None:
            return
        eb_code = current_eb.get("eb01", "")
        svc_code = current_eb.get("eb03", "")
        svc_name = SERVICE_TYPE_CODES.get(svc_code, svc_code)
        network  = current_eb.get("eb12", "")  # IN = in-network, OUT = out-of-network

        # Active/inactive determination
        if eb_code in ("1", "2", "3", "4", "5"):
            result["status"] = "active"
        elif eb_code in ("6", "7") and result["status"] == "unknown":
            result["status"] = "inactive"

        # Plan name
        if eb_code == "P" and current_eb.get("eb10"):
            result["plan_name"] = current_eb["eb10"]

        # Copay (B)
        if eb_code == "B" and current_eb.get("amount") is not None:
            result["copay"].append({
                "service_type": svc_name,
                "service_code": svc_code,
                "amount": current_eb["amount"],
                "network": network,
            })

        # Deductible (C)
        elif eb_code == "C" and current_eb.get("amount") is not None:
            result["deductible"].append({
                "service_type": svc_name,
                "amount": current_eb["amount"],
                "remaining": current_eb.get("remaining"),
                "network": network,
            })

        # Co-Insurance (A)
        elif eb_code == "A" and current_eb.get("percent") is not None:
            result["coinsurance"].append({
                "service_type": svc_name,
                "percent": current_eb["percent"],
                "network": network,
            })

        # Out-of-Pocket (G)
        elif eb_code == "G" and current_eb.get("amount") is not None:
            result["out_of_pocket"].append({
                "service_type": svc_name,
                "amount": current_eb["amount"],
                "remaining": current_eb.get("remaining"),
                "network": network,
            })

        # Covered services
        if eb_code in ("1", "2", "3", "4", "5") and svc_name and svc_name not in result["covered_services"]:
            result["covered_services"].append(svc_name)

        # Non-covered
        if eb_code == "I" and svc_name and svc_name not in result["non_covered"]:
            result["non_covered"].append(svc_name)

        current_eb = None

    for seg in segments:
        if not seg:
            continue
        seg_id = _safe(seg, 0).upper()

        # NM1 — Name
        if seg_id == "NM1":
            entity_code = _safe(seg, 1)
            name_last   = _safe(seg, 3)
            name_first  = _safe(seg, 4)
            id_qual     = _safe(seg, 8)
            id_val      = _safe(seg, 9)

            if entity_code == "PR":  # Payer
                result["payer_name"] = name_last  # payer org name in NM103
            elif entity_code in ("IL", "QC"):  # Insured / Subscriber
                in_subscriber_loop = True
                if name_last or name_first:
                    result["subscriber_name"] = f"{name_first} {name_last}".strip()
                if id_qual in ("MI", "1W", "HN") and id_val:
                    result["member_id"] = id_val

        # REF — Reference numbers
        elif seg_id == "REF":
            ref_qual = _safe(seg, 1)
            ref_val  = _safe(seg, 2)
            if ref_qual in ("1W", "6P", "SY", "IG"):  # Group number qualifiers
                result["group_number"] = ref_val

        # DTP — Date
        elif seg_id == "DTP":
            dtp_qual = _safe(seg, 1)
            dtp_fmt  = _safe(seg, 2)
            dtp_val  = _safe(seg, 3)
            if dtp_qual == "291" and dtp_fmt == "D8":  # Plan period
                result["effective_date"] = dtp_val
            elif dtp_qual == "292" and dtp_fmt == "D8":  # Termination
                result["term_date"] = dtp_val
            elif dtp_qual == "346" and dtp_fmt == "D8":  # Eligibility begin
                if not result["effective_date"]:
                    result["effective_date"] = dtp_val

        # EB — Eligibility or Benefit Information
        elif seg_id == "EB":
            _flush_eb()
            # EB segment (0=segment_id, 1=EB01, 2=EB02, ... 7=EB07, 8=EB08 ...)
            current_eb = {
                "eb01": _safe(seg, 1),   # eligibility/benefit info code
                "eb02": _safe(seg, 2),   # coverage level
                "eb03": _safe(seg, 3),   # service type code
                "eb04": _safe(seg, 4),   # insurance type
                "eb05": _safe(seg, 5),   # plan coverage description
                "eb10": _safe(seg, 10),  # quantity (used with EB09)
                "eb12": _safe(seg, 12),  # in plan network indicator
            }
            # EB07 = monetary amount (dollar value)
            try:
                amt = _safe(seg, 7)
                if amt:
                    current_eb["amount"] = float(amt)
            except ValueError:
                pass
            # EB08 = percent (coinsurance percentage)
            try:
                pct = _safe(seg, 8)
                if pct:
                    current_eb["percent"] = float(pct)
            except ValueError:
                pass
            # EB05 also carries plan description sometimes
            if _safe(seg, 5) and not current_eb.get("amount") and not current_eb.get("percent"):
                # Could be plan description text
                pass

        # MSG — Message text (under EB)
        elif seg_id == "MSG":
            if current_eb is not None:
                current_eb.setdefault("messages", []).append(_safe(seg, 1))

        # BEN — benefit amount (can appear under EB for remaining)
        # HSD — Health Care Services Delivery (limits, remaining)
        # We capture remaining via EB08 (quantity) for deductible/OOP
        elif seg_id == "EB" and current_eb:
            # Already handled above; this branch won't trigger
            pass

        # AAA — Request Validation / Rejection
        elif seg_id == "AAA":
            reject_code = _safe(seg, 1)
            reject_reason = _safe(seg, 3)
            reject_follow = _safe(seg, 4)
            result["errors"].append(
                f"AAA rejection: code={reject_code} reason={reject_reason} follow={reject_follow}"
            )
            if result["status"] == "unknown":
                result["status"] = "error"

    _flush_eb()

    # If status still unknown and we have segments, mark as unknown
    if result["status"] == "unknown" and len(segments) < 3:
        result["status"] = "error"
        result["errors"].append("271 response appears empty or malformed")

    return result


def parse_271_summary(x12_string: str) -> dict[str, Any]:
    """
    Convenience wrapper: returns only the key coverage summary fields.
    Useful for storing in eligibility_checks.response_parsed.
    """
    full = parse_271(x12_string)
    return {
        "status": full["status"],
        "plan_name": full["plan_name"],
        "member_id": full["member_id"],
        "subscriber_name": full["subscriber_name"],
        "payer_name": full["payer_name"],
        "effective_date": full["effective_date"],
        "term_date": full["term_date"],
        "copay": full["copay"],
        "deductible": full["deductible"],
        "coinsurance": full["coinsurance"],
        "out_of_pocket": full["out_of_pocket"],
        "covered_services": full["covered_services"],
        "non_covered": full["non_covered"],
        "errors": full["errors"],
    }
