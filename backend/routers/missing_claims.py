"""
Missing Claims Detector — find patients with insurance who had services
but no corresponding claim was submitted in the given date range.
"""
from datetime import date, datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, not_, exists
from sqlalchemy.orm import selectinload

from database import get_db
from models import (
    Claim, ClaimStatus, Patient, PatientInsurance, Payer, ServiceLine,
)
from auth import get_current_user
from models import User

router = APIRouter(prefix="/missing-claims", tags=["missing-claims"])

# ── Lost Revenue Audit ─────────────────────────────────────────────────────────

WINK_PG_DSN = "dbname=wink_sync user=wink password=wink_sync_2026! host=localhost port=5432"


async def _pg_query(query: str, params: tuple = ()):
    """Run a blocking psycopg2 query in a thread executor."""
    import asyncio
    import psycopg2
    import psycopg2.extras

    loop = asyncio.get_event_loop()

    def _run():
        conn = psycopg2.connect(WINK_PG_DSN)
        conn.set_client_encoding('UTF8')
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(query, params)
        rows = cur.fetchall()
        cur.close()
        conn.close()
        return rows

    return await loop.run_in_executor(None, _run)


class LostRevenueAuditRequest(BaseModel):
    date_from: str  # ISO YYYY-MM-DD
    date_to: str    # ISO YYYY-MM-DD


class LostRevenueEntry(BaseModel):
    invoice_number: Optional[str]
    date: Optional[str]
    patient_id: Optional[str]
    patient_name: str
    plan_amount: float
    total: float
    attended_by: Optional[str]
    payer: Optional[str]


class LostRevenueAuditResponse(BaseModel):
    date_from: str
    date_to: str
    flagged_count: int
    total_lost: float
    flagged: list[LostRevenueEntry]


@router.post("/audit/lost-revenue", response_model=LostRevenueAuditResponse)
async def audit_lost_revenue(
    req: LostRevenueAuditRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """
    Find invoices where insurance was supposed to pay (plan/insurance_adjustment > 0)
    but no CPT codes were entered, meaning the claim was likely never submitted.
    Queries the AngelWink sync server PostgreSQL directly.
    """
    from sqlalchemy import text as sa_text
    import os

    # Resolve clinic_id from DB setting, then env var
    clinic_id: Optional[str] = None
    try:
        _row = (await db.execute(sa_text("SELECT angelwink_clinic_id FROM clinic_settings WHERE id = 1"))).fetchone()
        clinic_id = _row[0] if _row and _row[0] else None
    except Exception:
        pass
    if not clinic_id:
        clinic_id = os.environ.get("ANGELWINK_CLINIC_ID", "")
    if not clinic_id:
        raise HTTPException(status_code=400, detail="No clinic paired. Go to Settings → Connections and connect AngelWink first.")

    date_from = req.date_from
    date_to = req.date_to

    # 1. Get invoices with insurance_adjustment > 0 in the date range
    invoices = await _pg_query("""
        SELECT DISTINCT ON (row_id) data
        FROM sync_changes
        WHERE clinic_id = %s AND table_name = 'invoices'
          AND operation != 'DELETE' AND data IS NOT NULL
          AND data->>'date' >= %s AND data->>'date' <= %s
          AND (data->>'insurance_adjustment') IS NOT NULL
          AND (data->>'insurance_adjustment') != ''
          AND (data->>'insurance_adjustment')::float > 0
        ORDER BY row_id, timestamp DESC
    """, (clinic_id, date_from, date_to))

    if not invoices:
        return LostRevenueAuditResponse(
            date_from=date_from,
            date_to=date_to,
            flagged_count=0,
            total_lost=0.0,
            flagged=[],
        )

    # 2. For each invoice, check if it has any CPT codes in invoice_items
    invoice_ids = [str(row["data"].get("id", "")) for row in invoices if row["data"].get("id")]

    # Batch-fetch invoice items with CPT codes for all invoice IDs
    cpt_invoice_ids: set[str] = set()
    if invoice_ids:
        items_with_cpt = await _pg_query("""
            SELECT DISTINCT ON (row_id) data->>'invoice_id' AS invoice_id
            FROM sync_changes
            WHERE clinic_id = %s AND table_name = 'invoice_items'
              AND operation != 'DELETE' AND data IS NOT NULL
              AND data->>'invoice_id' = ANY(%s)
              AND data->>'cpt_code' IS NOT NULL
              AND data->>'cpt_code' != ''
            ORDER BY row_id, timestamp DESC
        """, (clinic_id, invoice_ids))
        cpt_invoice_ids = {str(row["invoice_id"]) for row in items_with_cpt if row.get("invoice_id")}

    # 2b. Batch-fetch invoices that have insurance payments (claim was submitted)
    ins_paid_invoice_ids: set[str] = set()
    if invoice_ids:
        ins_payments = await _pg_query("""
            SELECT DISTINCT ON (row_id) data->>'invoice_id' AS invoice_id
            FROM sync_changes
            WHERE clinic_id = %s AND table_name = 'payments'
              AND operation != 'DELETE' AND data IS NOT NULL
              AND data->>'invoice_id' = ANY(%s)
              AND (
                  LOWER(COALESCE(data->>'payment_method', '')) IN ('insurance', 'check')
                  OR LOWER(COALESCE(data->>'payment_type', '')) = 'insurance'
                  OR LOWER(COALESCE(data->>'notes', '')) LIKE '%%plan m%%dico%%'
                  OR LOWER(COALESCE(data->>'notes', '')) LIKE '%%p%%rdida%%plan%%'
              )
            ORDER BY row_id, timestamp DESC
        """, (clinic_id, invoice_ids))
        ins_paid_invoice_ids = {str(row["invoice_id"]) for row in ins_payments if row.get("invoice_id")}

    # 3. Collect flagged invoices: no CPT codes AND no insurance payments
    flagged_invoices = []
    for row in invoices:
        inv = row["data"]
        inv_id = str(inv.get("id", ""))
        if inv_id in cpt_invoice_ids:
            continue  # Has CPT codes → claim was coded
        if inv_id in ins_paid_invoice_ids:
            continue  # Insurance already paid → claim was submitted somehow
        plan_amount = float(inv.get("insurance_adjustment") or 0)
        if plan_amount <= 0:
            continue
        flagged_invoices.append(inv)

    if not flagged_invoices:
        return LostRevenueAuditResponse(
            date_from=date_from,
            date_to=date_to,
            flagged_count=0,
            total_lost=0.0,
            flagged=[],
        )

    # 4. Batch-fetch patient names
    patient_ids = list({str(inv.get("patient_id", "")) for inv in flagged_invoices if inv.get("patient_id")})
    patients_rows = await _pg_query("""
        SELECT DISTINCT ON (row_id)
            data->>'id' AS id,
            data->>'first_name' AS first_name,
            data->>'last_name' AS last_name,
            data->>'last_name_2' AS last_name_2
        FROM sync_changes
        WHERE clinic_id = %s AND table_name = 'patients'
          AND operation != 'DELETE' AND data IS NOT NULL
          AND data->>'id' = ANY(%s)
        ORDER BY row_id, timestamp DESC
    """, (clinic_id, patient_ids))

    patient_map: dict[str, str] = {}
    for p in patients_rows:
        pid = str(p.get("id", ""))
        name = " ".join(filter(None, [p.get("first_name"), p.get("last_name"), p.get("last_name_2")])).strip()
        patient_map[pid] = name or "Unknown"

    # 5. Build result
    flagged: list[LostRevenueEntry] = []
    total_lost = 0.0
    for inv in flagged_invoices:
        plan_amount = float(inv.get("insurance_adjustment") or 0)
        pid = str(inv.get("patient_id", ""))
        flagged.append(LostRevenueEntry(
            invoice_number=inv.get("invoice_number") or inv.get("id"),
            date=inv.get("date"),
            patient_id=pid,
            patient_name=patient_map.get(pid, "Unknown"),
            plan_amount=plan_amount,
            total=float(inv.get("total") or 0),
            attended_by=inv.get("attended_by") or "",
            payer=inv.get("insurance_plan") or inv.get("insurance_provider") or "",
        ))
        total_lost += plan_amount

    flagged.sort(key=lambda x: x.date or "", reverse=True)

    return LostRevenueAuditResponse(
        date_from=date_from,
        date_to=date_to,
        flagged_count=len(flagged),
        total_lost=round(total_lost, 2),
        flagged=flagged,
    )


# ── Direct VistaNet Audit ──────────────────────────────────────────────────────

class DirectAuditRequest(BaseModel):
    vistanet_url: str       # e.g., "https://visualzone.vistanet.cloud"
    vistanet_user: str
    vistanet_password: str
    vistanet_location: str  # e.g., "MANATI"
    date_from: str          # ISO date YYYY-MM-DD
    date_to: str            # ISO date YYYY-MM-DD


MONTHS_ES_NUM = {
    1: "Enero", 2: "Febrero", 3: "Marzo", 4: "Abril",
    5: "Mayo", 6: "Junio", 7: "Julio", 8: "Agosto",
    9: "Septiembre", 10: "Octubre", 11: "Noviembre", 12: "Diciembre",
}

VISTANET_ENCODING = "iso-8859-1"
REQUEST_TIMEOUT = 30


def _date_to_vn(d: date) -> str:
    """Convert date to VistaNet format: 'Mayo/21/2026'"""
    return f"{MONTHS_ES_NUM[d.month]}/{d.day}/{d.year}"


def _parse_vn_date(s: str) -> Optional[str]:
    """Parse VistaNet date like 'Mayo/21/2026' or 'May/21/2026' → ISO string."""
    import re as _re
    MONTHS_LOOKUP = {
        "enero": 1, "febrero": 2, "marzo": 3, "abril": 4,
        "mayo": 5, "junio": 6, "julio": 7, "agosto": 8,
        "septiembre": 9, "octubre": 10, "noviembre": 11, "diciembre": 12,
    }
    if not s:
        return None
    parts = s.strip().split("/")
    if len(parts) != 3:
        return None
    try:
        month_num = MONTHS_LOOKUP.get(parts[0].lower())
        if not month_num:
            return None
        return date(int(parts[2]), month_num, int(parts[1])).isoformat()
    except (ValueError, IndexError):
        return None


@router.post("/audit/direct", response_model=LostRevenueAuditResponse)
async def audit_direct_vistanet(req: DirectAuditRequest):
    """
    Direct VistaNet audit — login with provided credentials, scrape live data,
    and find invoices with insurance coverage but no CPT codes.
    No sync or database required. Works for any VistaNet instance.
    """
    import asyncio
    import re
    import time
    from bs4 import BeautifulSoup

    base_url = req.vistanet_url.rstrip("/")
    d_from = date.fromisoformat(req.date_from)
    d_to = date.fromisoformat(req.date_to)

    if d_from > d_to:
        raise HTTPException(400, "date_from must be <= date_to")
    if (d_to - d_from).days > 90:
        raise HTTPException(400, "Date range cannot exceed 90 days")

    # ── Helper: run blocking HTTP in thread ──
    import requests

    session = requests.Session()
    session.headers.update({
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/145.0.0.0 Safari/537.36"
        ),
    })

    loop = asyncio.get_event_loop()

    def _login() -> bool:
        """Login to VistaNet. Returns True on success."""
        try:
            session.get(
                f"{base_url}/cgi-bin/login.pl?continuar",
                timeout=REQUEST_TIMEOUT,
                allow_redirects=True,
            )
            now = datetime.now()
            the_time = now.strftime("%-I:%M:%S")
            data = {
                "dbi": "remoto",
                "localidad": req.vistanet_location,
                "username": req.vistanet_user,
                "password": req.vistanet_password,
                "theTime": the_time,
            }
            session.headers.update({
                "Referer": f"{base_url}/cgi-bin/login.pl?continuar",
                "Origin": base_url,
            })
            resp = session.post(
                f"{base_url}/cgi-bin/login.pl?Validar",
                data=data,
                timeout=REQUEST_TIMEOUT,
                allow_redirects=True,
            )
            cookies = {c.name: c.value for c in session.cookies}
            if cookies.get("logstatus") == "1" or "userid" in cookies:
                try:
                    session.get(f"{base_url}/cgi-bin/login.pl?Confirmar",
                                timeout=REQUEST_TIMEOUT, allow_redirects=True)
                except Exception:
                    pass
                return True
            if "index.pl" in resp.url or "Confirmar" in resp.url:
                try:
                    session.get(f"{base_url}/cgi-bin/login.pl?Confirmar",
                                timeout=REQUEST_TIMEOUT, allow_redirects=True)
                except Exception:
                    pass
                return True
            text = resp.content.decode(VISTANET_ENCODING, errors="replace")
            if "login.pl" in resp.url and "usuario" in text.lower():
                return False
            try:
                session.get(f"{base_url}/cgi-bin/login.pl?Confirmar",
                            timeout=REQUEST_TIMEOUT, allow_redirects=True)
            except Exception:
                pass
            return True
        except requests.RequestException:
            return False

    def _layer_search(target_date: date) -> list[str]:
        """Call LayerSearch for a date. Returns list of record numbers."""
        fecha = _date_to_vn(target_date)
        anticache = int(time.time() * 1000)
        resp = session.post(
            f"{base_url}/cgi-bin/Buscar-Pacientes.pl?LayerSearch",
            data={"fecha_ventas": fecha, "anticache": str(anticache)},
            timeout=REQUEST_TIMEOUT,
        )
        if resp.status_code != 200:
            return []
        html = resp.content.decode(VISTANET_ENCODING, errors="replace")
        # Parse: <select>...</select>~<select>...</select>~stats
        parts = re.split(r'</select>', html, maxsplit=2)
        records = []
        seen = set()
        for part in parts[:2]:
            for m in re.finditer(r'<option[^>]+value="(\d{7})"', part):
                rec = m.group(1)
                if rec not in seen:
                    seen.add(rec)
                    records.append(rec)
        return records

    def _get_mostrar_data(record_number: str) -> dict:
        """Fetch patient name + invoice IDs + insurance info from MostrarDatos (one request)."""
        try:
            resp = session.post(
                f"{base_url}/cgi-bin/Mostrar-Paciente.pl?MostrarDatos",
                data={"id_infopersonal": record_number, "accion": "mostrar", "foco": "", "listaestado": ""},
                timeout=REQUEST_TIMEOUT,
            )
            html = resp.content.decode(VISTANET_ENCODING, errors="replace")
            soup = BeautifulSoup(html, "lxml")

            # Name
            nombre = ""
            apellidos = ""
            n_input = soup.find("input", {"name": "nombre"})
            if n_input:
                nombre = (n_input.get("value") or "").strip()
            a_input = soup.find("input", {"name": "apellidos"})
            if a_input:
                apellidos = (a_input.get("value") or "").strip()
            name = f"{nombre} {apellidos}".strip() or f"Record {record_number}"

            # Insurance / coverage
            cubierta_sel = soup.find("select", {"name": "cubierta"})
            insurance_plan = ""
            if cubierta_sel:
                for opt in cubierta_sel.find_all("option"):
                    if opt.get("selected") is not None:
                        insurance_plan = opt.get_text(strip=True)
                        break

            # Invoice IDs
            ids = []
            venta_sel = soup.find("select", {"name": re.compile(r"id_venta", re.I)})
            if venta_sel:
                for opt in venta_sel.find_all("option"):
                    val = (opt.get("value") or "").strip()
                    if val and val.replace(" ", ""):
                        ids.append(val.zfill(7))
            if not ids:
                for elem in soup.find_all(onclick=True):
                    m = re.search(r"idventa[=,\s]+['\"]?(\d+)", elem.get("onclick", ""), re.I)
                    if m:
                        ids.append(m.group(1).zfill(7))

            return {
                "name": name,
                "insurance_plan": insurance_plan,
                "invoice_ids": list(dict.fromkeys(ids)),
            }
        except Exception:
            return {"name": f"Record {record_number}", "insurance_plan": "", "invoice_ids": []}

    def _scrape_invoice(sale_id: str, record_number: str) -> Optional[dict]:
        """Fetch invoice detail from ventayabonos.php."""
        try:
            resp = session.get(
                f"{base_url}/ventayabonos.php?idventa={sale_id}&record={record_number}",
                timeout=REQUEST_TIMEOUT,
            )
            html = resp.content.decode(VISTANET_ENCODING, errors="replace")
            if len(html.strip()) < 200:
                return None
            soup = BeautifulSoup(html, "lxml")
            page_text = soup.get_text("\n")

            def _extract_amount(label_pattern):
                m = re.search(label_pattern + r'[:\s]*\$?\s*([\d][\d\.,]*)', page_text, re.I | re.DOTALL)
                if m:
                    val = m.group(1).split()[0]
                    try:
                        return float(val.replace(",", ""))
                    except ValueError:
                        return 0.0
                return 0.0

            plan_amount = _extract_amount(r'Cubierta\s+Plan\s*1')
            total = _extract_amount(r'(?<!Sub)Total(?!\s+Abonos)')
            inv_date = ""
            # Try to find date from page
            date_m = re.search(r'Fecha[:\s]+([A-Za-z]+/\d+/\d+)', page_text)
            if date_m:
                inv_date = _parse_vn_date(date_m.group(1)) or ""

            # Try to get attended_by
            attended = ""
            att_m = re.search(r'(?:Atendido|Attended)[^:]*:\s*(.+?)(?:\n|$)', page_text)
            if att_m:
                attended = att_m.group(1).strip()

            return {
                "invoice_number": sale_id,
                "date": inv_date,
                "plan_amount": plan_amount,
                "total": total,
                "attended_by": attended,
            }
        except Exception:
            return None

    def _check_cpt_for_dates(record_number: str, target_dates: set[str]) -> set[str]:
        """
        Check which dates have CPT codes for a patient.
        Returns set of ISO dates that HAVE CPT codes.
        """
        try:
            resp = session.post(
                f"{base_url}/cgi-bin/Mostrar-Paciente.pl?FormaCompraVentaPlan",
                data={"id_record": record_number},
                timeout=REQUEST_TIMEOUT,
            )
            html = resp.content.decode(VISTANET_ENCODING, errors="replace")
            if len(html.strip()) < 200:
                return set()

            soup = BeautifulSoup(html, "lxml")

            # Get all dates that have CPT entries from the date dropdown
            fecha_select = soup.find("select", {"name": "fecha"})
            cpt_dates = set()
            if fecha_select:
                for opt in fecha_select.find_all("option"):
                    val = (opt.get("value") or "").strip()
                    if val and val.lower() != "nulo":
                        iso = _parse_vn_date(val)
                        if iso:
                            cpt_dates.add(iso)

            # Also check if the current page has any CPT codes
            page_text = soup.get_text()
            if any(kw in page_text.upper() for kw in ["PROCEDIMIENTOS", "DIAGNOSTICOS", "CODIGOS DE MATERIALES"]):
                # There are CPT codes on the page — at least the default date has codes
                if cpt_dates:
                    pass  # dates from dropdown are accurate
                else:
                    # No dropdown but has content — assume all target dates have CPT
                    return target_dates

            return cpt_dates
        except Exception:
            return set()  # Assume no CPT on error (will flag = false positive is acceptable)

    # ── Main audit logic ──
    # Run blocking I/O in thread pool
    def _do_audit():
        # 1. Login
        if not _login():
            return None, "VistaNet login failed. Check credentials and location."

        flagged = []
        total_lost = 0.0
        current = d_from
        processed_records = {}  # record -> {name, insurance_plan, invoice_ids}

        # 2. For each day, get all patients with activity
        while current <= d_to:
            records = _layer_search(current)
            if not records:
                current += timedelta(days=1)
                continue

            for record in records:
                # Fetch patient data (MostrarDatos) — only once per record
                if record not in processed_records:
                    time.sleep(0.3)  # Rate limit
                    data = _get_mostrar_data(record)
                    processed_records[record] = data

                patient = processed_records[record]

                # Get invoices for this patient (limit to most recent 10 to avoid
                # scraping hundreds of old invoices for long-time patients)
                invoice_ids = patient["invoice_ids"][:10]
                insured_dates = set()  # dates with plan > 0

                for inv_id in invoice_ids:
                    # Skip if we already processed this invoice
                    inv_key = f"{record}:{inv_id}"
                    if inv_key in processed_records.get("_inv_done", set()):
                        continue
                    processed_records.setdefault("_inv_done", set()).add(inv_key)

                    time.sleep(0.2)  # Rate limit
                    inv = _scrape_invoice(inv_id, record)
                    if not inv:
                        continue

                    # Only care about invoices in our date range with plan > 0
                    inv_date = inv.get("date", "")
                    if inv_date and (inv_date < req.date_from or inv_date > req.date_to):
                        continue
                    if inv["plan_amount"] <= 0:
                        continue

                    insured_dates.add(inv_date or current.isoformat())

                    # Lazy-check CPT: only fetch once per patient
                    if record not in processed_records.get("_cpt_checked", set()):
                        time.sleep(0.2)
                        cpt_dates = _check_cpt_for_dates(record, insured_dates)
                        processed_records.setdefault("_cpt_cache", {})[record] = cpt_dates
                        processed_records.setdefault("_cpt_checked", set()).add(record)

                    cpt_dates = processed_records.get("_cpt_cache", {}).get(record, set())

                    # If the invoice date has CPT codes, skip it
                    if inv_date and inv_date in cpt_dates:
                        continue

                    flagged.append({
                        "invoice_number": inv["invoice_number"],
                        "date": inv_date or current.isoformat(),
                        "patient_id": record,
                        "patient_name": patient["name"],
                        "plan_amount": inv["plan_amount"],
                        "total": inv["total"],
                        "attended_by": inv.get("attended_by", ""),
                        "payer": patient["insurance_plan"],
                    })
                    total_lost += inv["plan_amount"]

            current += timedelta(days=1)

        return flagged, None

    result = await loop.run_in_executor(None, _do_audit)
    flagged_list, error = result

    if error:
        raise HTTPException(status_code=401 if "login" in error.lower() else 502, detail=error)

    # Deduplicate by invoice_number
    seen_invoices = set()
    unique_flagged = []
    unique_total = 0.0
    for entry in (flagged_list or []):
        inv_key = entry["invoice_number"]
        if inv_key in seen_invoices:
            continue
        seen_invoices.add(inv_key)
        unique_flagged.append(LostRevenueEntry(**entry))
        unique_total += entry["plan_amount"]

    unique_flagged.sort(key=lambda x: x.date or "", reverse=True)

    return LostRevenueAuditResponse(
        date_from=req.date_from,
        date_to=req.date_to,
        flagged_count=len(unique_flagged),
        total_lost=round(unique_total, 2),
        flagged=unique_flagged,
    )


class DetectRequest(BaseModel):
    date_from: str   # YYYY-MM-DD
    date_to: str     # YYYY-MM-DD


class InsuranceInfo(BaseModel):
    payer_name: str
    member_id: str
    is_primary: bool


class MissingClaimEntry(BaseModel):
    claim_id: int
    claim_number: str
    status: str
    patient_id: int
    patient_name: str
    service_date: str
    total_billed: float
    source: str
    insurance: list[InsuranceInfo]
    sale_items: Optional[list] = None


class DetectResponse(BaseModel):
    date_from: str
    date_to: str
    total_found: int
    entries: list[MissingClaimEntry]


@router.post("/detect", response_model=DetectResponse)
async def detect_missing_claims(
    req: DetectRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """
    Find claims that are in draft/ready status (not submitted or paid) in the
    date range for patients who have insurance on file.

    These represent potential missed billing opportunities — services were
    performed and imported but claims were never submitted to the payer.
    """
    try:
        from_date = date.fromisoformat(req.date_from)
        to_date = date.fromisoformat(req.date_to)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"Invalid date format: {e}")

    if from_date > to_date:
        raise HTTPException(status_code=400, detail="date_from must be <= date_to")

    # Find claims in the date range that are draft/ready and the patient has insurance
    q = (
        select(Claim)
        .options(
            selectinload(Claim.patient).selectinload(Patient.insurances).selectinload(PatientInsurance.payer),
            selectinload(Claim.service_lines),
        )
        .where(
            and_(
                Claim.service_date_from >= from_date,
                Claim.service_date_from <= to_date,
                Claim.status.in_([ClaimStatus.DRAFT, ClaimStatus.READY]),
            )
        )
        .order_by(Claim.service_date_from.desc())
    )

    result = await db.execute(q)
    claims = result.scalars().all()

    entries: list[MissingClaimEntry] = []
    for claim in claims:
        patient = claim.patient
        if not patient:
            continue

        # Only include patients with active insurance on file
        active_insurance = [
            ins for ins in (patient.insurances or [])
            if not ins.termination_date or ins.termination_date >= from_date
        ]
        if not active_insurance:
            continue

        insurance_info = [
            InsuranceInfo(
                payer_name=ins.payer.name if ins.payer else "Unknown",
                member_id=ins.member_id or "",
                is_primary=ins.is_primary,
            )
            for ins in active_insurance
        ]

        entries.append(
            MissingClaimEntry(
                claim_id=claim.id,
                claim_number=claim.claim_number,
                status=claim.status.value,
                patient_id=patient.id,
                patient_name=f"{patient.first_name} {patient.last_name}".strip(),
                service_date=claim.service_date_from.isoformat() if claim.service_date_from else "",
                total_billed=claim.total_billed or 0.0,
                source=claim.source or "manual",
                insurance=insurance_info,
                sale_items=claim.sale_items or [],
            )
        )

    return DetectResponse(
        date_from=req.date_from,
        date_to=req.date_to,
        total_found=len(entries),
        entries=entries,
    )
