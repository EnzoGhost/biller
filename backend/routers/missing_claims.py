"""
Missing Claims Detector — find patients with insurance who had services
but no corresponding claim was submitted in the given date range.
"""
from datetime import date, datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
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
    Find invoices where:
      1. Insurance was supposed to pay (insurance_adjustment > 0)
      2. Balance is still > 0 (money still owed)
      3. No CPT codes were entered (claim never coded)
      4. No insurance payment received

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
    # Also track which invoices have ANY items synced (to avoid false positives on partial sync)
    invoices_with_any_items: set[str] = set()
    if invoice_ids:
        items_with_cpt = await _pg_query("""
            SELECT DISTINCT ON (row_id) data->>'invoice_id' AS invoice_id, data->>'cpt_code' AS cpt_code
            FROM sync_changes
            WHERE clinic_id = %s AND table_name = 'invoice_items'
              AND operation != 'DELETE' AND data IS NOT NULL
              AND data->>'invoice_id' = ANY(%s)
            ORDER BY row_id, timestamp DESC
        """, (clinic_id, invoice_ids))
        for row in items_with_cpt:
            iid = row.get("invoice_id")
            if iid:
                invoices_with_any_items.add(str(iid))
                cpt = (row.get("cpt_code") or "").strip()
                if cpt:
                    cpt_invoice_ids.add(str(iid))

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
                  LOWER(COALESCE(data->>'method', '')) IN ('insurance', 'check', 'cheque')
                  OR LOWER(COALESCE(data->>'payment_method', '')) IN ('insurance', 'check', 'cheque')
                  OR LOWER(COALESCE(data->>'payment_type', '')) = 'insurance'
                  OR LOWER(COALESCE(data->>'notes', '')) LIKE '%%insurance%%'
                  OR LOWER(COALESCE(data->>'notes', '')) LIKE '%%plan m%%dico%%'
              )
            ORDER BY row_id, timestamp DESC
        """, (clinic_id, invoice_ids))
        ins_paid_invoice_ids = {str(row["invoice_id"]) for row in ins_payments if row.get("invoice_id")}

    # 3. Collect flagged invoices: plan > 0, balance > 0, no CPT codes, no insurance payment
    flagged_invoices = []
    for row in invoices:
        inv = row["data"]
        inv_id = str(inv.get("id", ""))

        # Condition 1: plan amount > 0 (already filtered in query, but double-check)
        plan_amount = float(inv.get("insurance_adjustment") or 0)
        if plan_amount <= 0:
            continue

        # Condition 2: balance > 0 — still money owed
        balance = float(inv.get("balance_con_interes") or inv.get("balance") or 0)
        if balance <= 0:
            continue

        # Condition 3: no CPT/billing codes entered
        # Check multiple indicators:
        # a) invoice_items with cpt_code populated
        if inv_id in cpt_invoice_ids:
            continue  # Has CPT codes in items
        # b) invoice-level diagnosis_codes = billing section was filled
        diag_codes = inv.get("diagnosis_codes")
        if diag_codes:
            if isinstance(diag_codes, str):
                try:
                    import json as _json
                    diag_codes = _json.loads(diag_codes)
                except (ValueError, TypeError):
                    diag_codes = None
            if isinstance(diag_codes, list) and len(diag_codes) > 0:
                continue  # Has diagnosis codes = billing was started
        # c) invoice has cpt_codes field directly (some sync versions include it)
        inv_cpt = inv.get("cpt_codes") or inv.get("billing_codes")
        if inv_cpt and isinstance(inv_cpt, list) and len(inv_cpt) > 0:
            continue

        # Condition 4: no insurance payment
        if inv_id in ins_paid_invoice_ids:
            continue  # Insurance already paid → claim was submitted somehow

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
    """Parse VistaNet date like 'Mayo/21/2026' or 'Mayo 21, 2026' → ISO string."""
    import re as _re
    MONTHS_LOOKUP = {
        "enero": 1, "febrero": 2, "marzo": 3, "abril": 4,
        "mayo": 5, "junio": 6, "julio": 7, "agosto": 8,
        "septiembre": 9, "octubre": 10, "noviembre": 11, "diciembre": 12,
    }
    if not s:
        return None
    s = s.strip()
    # Handle "Mes/Day/Year [time]" — strip optional time suffix
    s = _re.split(r'\s+\[', s)[0].strip()

    # Format 1: slash-separated "Marzo/3/2026"
    parts = s.split("/")
    if len(parts) == 3:
        try:
            month_num = MONTHS_LOOKUP.get(parts[0].lower())
            if not month_num:
                return None
            return date(int(parts[2].strip()), month_num, int(parts[1].strip())).isoformat()
        except (ValueError, IndexError):
            return None

    # Format 2: "Marzo 3, 2026"
    m = _re.match(r'^([A-Za-záéíóúñÁÉÍÓÚÑ]+)\s+(\d{1,2}),?\s+(\d{4})$', s)
    if m:
        month_num = MONTHS_LOOKUP.get(m.group(1).lower())
        if month_num:
            try:
                return date(int(m.group(3)), month_num, int(m.group(2))).isoformat()
            except ValueError:
                pass

    return None


def _parse_amount(val: str) -> float:
    """Strip $, commas and parse to float. Returns 0.0 on failure."""
    if not val:
        return 0.0
    try:
        return float(str(val).strip().replace("$", "").replace(",", "").strip())
    except (ValueError, TypeError):
        return 0.0


@router.post("/audit/direct", response_model=LostRevenueAuditResponse)
async def audit_direct_vistanet(req: DirectAuditRequest):
    """
    Direct VistaNet audit — login with provided credentials, scrape live data,
    and find invoices matching all 4 conditions:
      1. Plan amount > 0
      2. Balance > 0
      3. No CPT codes in bitacora for the invoice date
      4. No insurance/cheque payment in abonos
    No sync or database required. Works for any VistaNet instance.
    """
    import asyncio
    import re
    import time
    from bs4 import BeautifulSoup
    import requests

    base_url = req.vistanet_url.rstrip("/")
    d_from = date.fromisoformat(req.date_from)
    d_to = date.fromisoformat(req.date_to)

    if d_from > d_to:
        raise HTTPException(400, "date_from must be <= date_to")
    session = requests.Session()
    session.headers.update({
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/145.0.0.0 Safari/537.36"
        ),
    })

    loop = asyncio.get_event_loop()

    # ── Login (unchanged — works fine) ──────────────────────────────────────
    def _login() -> bool:
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

    # ── LayerSearch — get patient records for a day (unchanged) ─────────────
    def _layer_search(target_date: date) -> list[str]:
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

    # ── MostrarDatos — patient info + invoice list with ALL financial details ──
    def _get_patient_data(record_number: str) -> dict:
        """
        POST to MostrarDatos. The response contains:
          1. Patient name, insurance plan
          2. Invoice dropdown (id_venta select) with dates
          3. A JavaScript function InfoVentas() with per-invoice financial data:
             if (document.form_ventas.id_venta.value == "0003120") {
                 document.form_ventas.plan.value = "225.00";
                 document.form_ventas.balance.value = "225.00";
                 document.form_ventas.balance_con_interes.value = "$225.00";
                 ...
             }
        Returns: name, insurance_plan, invoices: list of dicts with sale_id, date_text,
                 plan_amount, balance, total, attended_by
        """
        try:
            resp = session.post(
                f"{base_url}/cgi-bin/Mostrar-Paciente.pl?MostrarDatos",
                data={"id_infopersonal": record_number, "accion": "mostrar",
                      "foco": "", "listaestado": ""},
                timeout=REQUEST_TIMEOUT,
            )
            html = resp.content.decode(VISTANET_ENCODING, errors="replace")
            soup = BeautifulSoup(html, "lxml")

            # Patient name
            nombre = (soup.find("input", {"name": "nombre"}) or {}).get("value", "") or ""
            apellidos = (soup.find("input", {"name": "apellidos"}) or {}).get("value", "") or ""
            name = f"{nombre.strip()} {apellidos.strip()}".strip() or f"Record {record_number}"

            # Insurance plan (cubierta select)
            insurance_plan = ""
            cubierta_sel = soup.find("select", {"name": "cubierta"})
            if cubierta_sel:
                for opt in cubierta_sel.find_all("option"):
                    if opt.get("selected") is not None:
                        insurance_plan = opt.get_text(strip=True)
                        break

            # Invoice list with dates from id_venta select
            invoice_options: list[tuple[str, str]] = []
            venta_sel = soup.find("select", {"name": re.compile(r"id_venta", re.I)})
            if venta_sel:
                for opt in venta_sel.find_all("option"):
                    sale_id = (opt.get("value") or "").strip()
                    if not sale_id or sale_id.lower() == "nulo" or not sale_id.replace(" ", ""):
                        continue
                    date_text = opt.get_text(strip=True)
                    invoice_options.append((sale_id.zfill(7), date_text))

            # Parse per-invoice financial data from InfoVentas() JS blocks.
            # The JS has: if (document.form_ventas.id_venta.value == "0003120") { ...assignments... }
            # Because blocks contain nested braces, we find each id_venta check position
            # and extract all form_ventas assignments between consecutive checks.
            id_venta_positions = [
                m.start() for m in re.finditer(r'id_venta\.value\s*==\s*"', html)
            ]

            invoices = []
            for sale_id, date_text in invoice_options:
                # Find the position of this invoice's JS block
                pattern = r'id_venta\.value\s*==\s*"' + re.escape(sale_id) + r'"'
                start_match = re.search(pattern, html)
                block = ""
                if start_match:
                    start_pos = start_match.start()
                    # Find the next id_venta check after this one (or end of string)
                    next_positions = [p for p in id_venta_positions if p > start_pos + 10]
                    end_pos = next_positions[0] if next_positions else len(html)
                    block = html[start_pos:end_pos]

                plan_amount = 0.0
                balance = 0.0
                total = 0.0
                attended_by = ""
                inv_date = _parse_vn_date(date_text) or ""

                if block:
                    def _js_field(field: str, blk: str = block) -> str:
                        m = re.search(
                            r'form_ventas\.' + re.escape(field) + r'\.value\s*=\s*"([^"]*)"',
                            blk,
                        )
                        return m.group(1).strip() if m else ""

                    plan_amount = _parse_amount(_js_field("plan"))
                    balance = _parse_amount(
                        _js_field("balance_con_interes") or _js_field("balance")
                    )
                    total = _parse_amount(
                        _js_field("totalbruto") or _js_field("subtotal")
                    )
                    attended_by = _js_field("atendido_por")
                    js_date = _js_field("fecha_venta")
                    if js_date:
                        parsed = _parse_vn_date(js_date)
                        if parsed:
                            inv_date = parsed

                invoices.append({
                    "sale_id": sale_id,
                    "date_text": date_text,
                    "date": inv_date,
                    "plan_amount": plan_amount,
                    "balance": balance,
                    "total": total,
                    "attended_by": attended_by,
                })

            return {"name": name, "insurance_plan": insurance_plan, "invoices": invoices}
        except Exception:
            return {"name": f"Record {record_number}", "insurance_plan": "", "invoices": []}

    # ── FormaCompraVentaPlan — dates with CPT entries (bitacora) ────────────
    def _get_cpt_dates(record_number: str) -> set[str]:
        """
        POST to FormaCompraVentaPlan. Returns set of ISO dates that have CPT entries.
        An empty set means no CPT codes on file for this patient.
        """
        try:
            resp = session.post(
                f"{base_url}/cgi-bin/Mostrar-Paciente.pl?FormaCompraVentaPlan",
                data={"id_record": record_number},
                timeout=REQUEST_TIMEOUT,
            )
            html = resp.content.decode(VISTANET_ENCODING, errors="replace")
            if len(html.strip()) < 100:
                return set()
            soup = BeautifulSoup(html, "lxml")
            cpt_dates: set[str] = set()
            fecha_select = soup.find("select", {"name": "fecha"})
            if fecha_select:
                for opt in fecha_select.find_all("option"):
                    val = (opt.get("value") or "").strip()
                    if val and val.lower() not in ("nulo", "", "seleccione"):
                        iso = _parse_vn_date(val)
                        if iso:
                            cpt_dates.add(iso)
            return cpt_dates
        except Exception:
            return set()

    # ── HistorialAbonos — check for insurance/cheque payments ───────────────
    def _has_insurance_payment(sale_id: str, record_number: str) -> bool:
        """
        POST to HistorialAbonos. Returns True if any payment was made via
        cheque/insurance (meaning insurance already paid this invoice).
        """
        try:
            resp = session.post(
                f"{base_url}/cgi-bin/Mostrar-Paciente.pl?HistorialAbonos",
                data={
                    "id_venta": sale_id,
                    "record": record_number,
                    "from_recordPT": "SI",
                    "temp_atendido_por": "",
                },
                timeout=REQUEST_TIMEOUT,
            )
            html = resp.content.decode(VISTANET_ENCODING, errors="replace")
            if len(html.strip()) < 100:
                return False
            soup = BeautifulSoup(html, "lxml")

            # Check full text for "Pérdida Plan Médico" (insurance write-off = was billed)
            full_text = soup.get_text()
            if re.search(r'p[eé]rdida\s+plan\s+m[eé]dico', full_text, re.I):
                return True

            # Parse payment tables for "Método Pago" values.
            # Abono data tables have 4 rows: [header, data, meta-header, meta-data].
            # Row 2 (meta-header) contains: Comentarios | Atendido por | Método Pago
            # Row 3 (meta-data) contains the actual values.
            # We look for rows where a preceding row has "todo Pago" in cell[2],
            # then check the next row's cell[2] for the method value.
            for table in soup.find_all("table"):
                rows = table.find_all("tr")
                for i, row in enumerate(rows):
                    cells = row.find_all(["td", "th"])
                    if len(cells) < 3:
                        continue
                    # Check if this is the meta-header with "Método Pago"
                    header_text = cells[2].get_text(strip=True)
                    if "todo Pago" in header_text or "todo pago" in header_text.lower():
                        # The next row has the actual method value
                        if i + 1 < len(rows):
                            data_row = rows[i + 1]
                            data_cells = data_row.find_all(["td", "th"])
                            if len(data_cells) >= 3:
                                method_text = data_cells[2].get_text(separator=" ")
                                method = re.split(r'seleccione', method_text, flags=re.I)[0].strip()
                                if re.search(r'cheque', method, re.I):
                                    return True

            return False
        except Exception:
            return False

    # ── Main audit ────────────────────────────────────────────────────────────
    def _do_audit():
        if not _login():
            return None, "VistaNet login failed. Check credentials and location."

        flagged: list[dict] = []
        total_lost = 0.0
        current = d_from
        patient_cache: dict[str, dict] = {}   # record → {name, insurance_plan, invoices}
        cpt_cache: dict[str, set] = {}         # record → set of ISO dates with CPT
        processed_invoices: set[str] = set()   # "record:sale_id" already fully evaluated

        while current <= d_to:
            records = _layer_search(current)
            if not records:
                current += timedelta(days=1)
                continue

            for record in records:
                # Step 1: Fetch patient data once per record
                if record not in patient_cache:
                    time.sleep(0.3)
                    patient_cache[record] = _get_patient_data(record)

                patient = patient_cache[record]

                # Step 2: Fetch CPT dates once per record
                if record not in cpt_cache:
                    time.sleep(0.3)
                    cpt_cache[record] = _get_cpt_dates(record)

                cpt_dates = cpt_cache[record]

                # Step 3: Evaluate each invoice (data already parsed from MostrarDatos JS)
                for inv in patient["invoices"]:
                    sale_id = inv["sale_id"]
                    inv_key = f"{record}:{sale_id}"
                    if inv_key in processed_invoices:
                        continue
                    processed_invoices.add(inv_key)

                    inv_date = inv["date"] or current.isoformat()

                    # Filter by date range
                    if inv_date < req.date_from or inv_date > req.date_to:
                        continue

                    # Condition 1: plan > $0
                    plan = inv["plan_amount"]
                    if plan <= 0:
                        continue

                    # Condition 2: balance > $0
                    balance = inv["balance"]
                    if balance <= 0:
                        continue

                    # Condition 3: no CPT codes submitted for this invoice date
                    if inv_date in cpt_dates:
                        continue

                    # Condition 4: no insurance payment in abonos
                    time.sleep(0.3)
                    if _has_insurance_payment(sale_id, record):
                        continue

                    # All 4 conditions met — flag it
                    flagged.append({
                        "invoice_number": sale_id,
                        "date": inv_date,
                        "patient_id": record,
                        "patient_name": patient["name"],
                        "plan_amount": plan,
                        "total": inv["total"],
                        "attended_by": inv["attended_by"],
                        "payer": patient["insurance_plan"],
                    })
                    total_lost += plan

            current += timedelta(days=1)

        return flagged, None

    flagged_list, error = await loop.run_in_executor(None, _do_audit)

    if error:
        raise HTTPException(status_code=401 if "login" in error.lower() else 502, detail=error)

    flagged_list = flagged_list or []
    flagged_list.sort(key=lambda x: x.get("date") or "", reverse=True)

    return LostRevenueAuditResponse(
        date_from=req.date_from,
        date_to=req.date_to,
        flagged_count=len(flagged_list),
        total_lost=round(sum(e["plan_amount"] for e in flagged_list), 2),
        flagged=[LostRevenueEntry(**e) for e in flagged_list],
    )


@router.post("/audit/direct/stream")
async def audit_direct_vistanet_stream(
    req: DirectAuditRequest,
    _: User = Depends(get_current_user),
):
    """
    SSE version of /audit/direct — streams real-time progress as Server-Sent Events.
    Each event is: data: {json}\\n\\n
    Phases: login → scanning (per-day updates) → done | error

    Same 4-condition logic as /audit/direct:
      1. Plan amount > 0
      2. Balance > 0
      3. No CPT codes in bitacora for the invoice date
      4. No insurance/cheque payment in abonos
    """
    import asyncio
    import json
    import re
    import time
    from bs4 import BeautifulSoup
    import requests as _requests

    base_url = req.vistanet_url.rstrip("/")
    d_from = date.fromisoformat(req.date_from)
    d_to = date.fromisoformat(req.date_to)

    if d_from > d_to:
        raise HTTPException(400, "date_from must be <= date_to")
    loop = asyncio.get_event_loop()
    queue: asyncio.Queue = asyncio.Queue()

    def push(event: dict):
        """Thread-safe push to SSE queue."""
        asyncio.run_coroutine_threadsafe(queue.put(event), loop)

    sess = _requests.Session()
    sess.headers.update({
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/145.0.0.0 Safari/537.36"
        ),
    })

    # ── Login ─────────────────────────────────────────────────────────────────
    def _login() -> bool:
        try:
            sess.get(f"{base_url}/cgi-bin/login.pl?continuar",
                     timeout=REQUEST_TIMEOUT, allow_redirects=True)
            now = datetime.now()
            the_time = now.strftime("%-I:%M:%S")
            data = {
                "dbi": "remoto",
                "localidad": req.vistanet_location,
                "username": req.vistanet_user,
                "password": req.vistanet_password,
                "theTime": the_time,
            }
            sess.headers.update({
                "Referer": f"{base_url}/cgi-bin/login.pl?continuar",
                "Origin": base_url,
            })
            resp = sess.post(f"{base_url}/cgi-bin/login.pl?Validar",
                             data=data, timeout=REQUEST_TIMEOUT, allow_redirects=True)
            cookies = {c.name: c.value for c in sess.cookies}
            if cookies.get("logstatus") == "1" or "userid" in cookies:
                try:
                    sess.get(f"{base_url}/cgi-bin/login.pl?Confirmar",
                             timeout=REQUEST_TIMEOUT, allow_redirects=True)
                except Exception:
                    pass
                return True
            if "index.pl" in resp.url or "Confirmar" in resp.url:
                try:
                    sess.get(f"{base_url}/cgi-bin/login.pl?Confirmar",
                             timeout=REQUEST_TIMEOUT, allow_redirects=True)
                except Exception:
                    pass
                return True
            text = resp.content.decode(VISTANET_ENCODING, errors="replace")
            if "login.pl" in resp.url and "usuario" in text.lower():
                return False
            try:
                sess.get(f"{base_url}/cgi-bin/login.pl?Confirmar",
                         timeout=REQUEST_TIMEOUT, allow_redirects=True)
            except Exception:
                pass
            return True
        except _requests.RequestException:
            return False

    # ── LayerSearch ───────────────────────────────────────────────────────────
    def _layer_search(target_date: date) -> list[str]:
        fecha = _date_to_vn(target_date)
        anticache = int(time.time() * 1000)
        resp = sess.post(
            f"{base_url}/cgi-bin/Buscar-Pacientes.pl?LayerSearch",
            data={"fecha_ventas": fecha, "anticache": str(anticache)},
            timeout=REQUEST_TIMEOUT,
        )
        if resp.status_code != 200:
            return []
        html = resp.content.decode(VISTANET_ENCODING, errors="replace")
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

    # ── MostrarDatos — patient info + invoice list ────────────────────────────
    def _get_patient_data(record_number: str) -> dict:
        """
        POST to MostrarDatos. The response contains:
          1. Patient name, insurance plan
          2. Invoice dropdown (id_venta select) with dates
          3. A JavaScript function InfoVentas() with per-invoice financial data:
             if (document.form_ventas.id_venta.value == "0003120") {
                 document.form_ventas.plan.value = "225.00";
                 document.form_ventas.balance.value = "225.00";
                 document.form_ventas.balance_con_interes.value = "$225.00";
                 ...
             }
        Returns: name, insurance_plan, invoices: list of dicts with sale_id, date_text,
                 plan_amount, balance, total, attended_by
        """
        try:
            resp = sess.post(
                f"{base_url}/cgi-bin/Mostrar-Paciente.pl?MostrarDatos",
                data={"id_infopersonal": record_number, "accion": "mostrar",
                      "foco": "", "listaestado": ""},
                timeout=REQUEST_TIMEOUT,
            )
            html = resp.content.decode(VISTANET_ENCODING, errors="replace")
            soup = BeautifulSoup(html, "lxml")

            # Patient name
            nombre = (soup.find("input", {"name": "nombre"}) or {}).get("value", "") or ""
            apellidos = (soup.find("input", {"name": "apellidos"}) or {}).get("value", "") or ""
            name = f"{nombre.strip()} {apellidos.strip()}".strip() or f"Record {record_number}"

            # Insurance plan (cubierta select)
            insurance_plan = ""
            cubierta_sel = soup.find("select", {"name": "cubierta"})
            if cubierta_sel:
                for opt in cubierta_sel.find_all("option"):
                    if opt.get("selected") is not None:
                        insurance_plan = opt.get_text(strip=True)
                        break

            # Invoice list with dates from id_venta select
            invoice_options: list[tuple[str, str]] = []
            venta_sel = soup.find("select", {"name": re.compile(r"id_venta", re.I)})
            if venta_sel:
                for opt in venta_sel.find_all("option"):
                    sale_id = (opt.get("value") or "").strip()
                    if not sale_id or sale_id.lower() == "nulo" or not sale_id.replace(" ", ""):
                        continue
                    date_text = opt.get_text(strip=True)
                    invoice_options.append((sale_id.zfill(7), date_text))

            # Parse per-invoice financial data from InfoVentas() JS blocks.
            # The JS has: if (document.form_ventas.id_venta.value == "0003120") { ...assignments... }
            # Because blocks contain nested braces, we find each id_venta check position
            # and extract all form_ventas assignments between consecutive checks.
            id_venta_positions = [
                m.start() for m in re.finditer(r'id_venta\.value\s*==\s*"', html)
            ]

            invoices = []
            for sale_id, date_text in invoice_options:
                # Find the position of this invoice's JS block
                pattern = r'id_venta\.value\s*==\s*"' + re.escape(sale_id) + r'"'
                start_match = re.search(pattern, html)
                block = ""
                if start_match:
                    start_pos = start_match.start()
                    # Find the next id_venta check after this one (or end of string)
                    next_positions = [p for p in id_venta_positions if p > start_pos + 10]
                    end_pos = next_positions[0] if next_positions else len(html)
                    block = html[start_pos:end_pos]

                plan_amount = 0.0
                balance = 0.0
                total = 0.0
                attended_by = ""
                inv_date = _parse_vn_date(date_text) or ""

                if block:
                    def _js_field(field: str, blk: str = block) -> str:
                        m = re.search(
                            r'form_ventas\.' + re.escape(field) + r'\.value\s*=\s*"([^"]*)"',
                            blk,
                        )
                        return m.group(1).strip() if m else ""

                    plan_amount = _parse_amount(_js_field("plan"))
                    balance = _parse_amount(
                        _js_field("balance_con_interes") or _js_field("balance")
                    )
                    total = _parse_amount(
                        _js_field("totalbruto") or _js_field("subtotal")
                    )
                    attended_by = _js_field("atendido_por")
                    js_date = _js_field("fecha_venta")
                    if js_date:
                        parsed = _parse_vn_date(js_date)
                        if parsed:
                            inv_date = parsed

                invoices.append({
                    "sale_id": sale_id,
                    "date_text": date_text,
                    "date": inv_date,
                    "plan_amount": plan_amount,
                    "balance": balance,
                    "total": total,
                    "attended_by": attended_by,
                })

            return {"name": name, "insurance_plan": insurance_plan, "invoices": invoices}
        except Exception:
            return {"name": f"Record {record_number}", "insurance_plan": "", "invoices": []}

    def _get_cpt_dates(record_number: str) -> set[str]:
        try:
            resp = sess.post(
                f"{base_url}/cgi-bin/Mostrar-Paciente.pl?FormaCompraVentaPlan",
                data={"id_record": record_number},
                timeout=REQUEST_TIMEOUT,
            )
            html = resp.content.decode(VISTANET_ENCODING, errors="replace")
            if len(html.strip()) < 100:
                return set()
            soup = BeautifulSoup(html, "lxml")
            cpt_dates: set[str] = set()
            fecha_select = soup.find("select", {"name": "fecha"})
            if fecha_select:
                for opt in fecha_select.find_all("option"):
                    val = (opt.get("value") or "").strip()
                    if val and val.lower() not in ("nulo", "", "seleccione"):
                        iso = _parse_vn_date(val)
                        if iso:
                            cpt_dates.add(iso)
            return cpt_dates
        except Exception:
            return set()

    # ── HistorialAbonos — insurance payment check ─────────────────────────────
    def _has_insurance_payment(sale_id: str, record_number: str) -> bool:
        try:
            resp = sess.post(
                f"{base_url}/cgi-bin/Mostrar-Paciente.pl?HistorialAbonos",
                data={
                    "id_venta": sale_id,
                    "record": record_number,
                    "from_recordPT": "SI",
                    "temp_atendido_por": "",
                },
                timeout=REQUEST_TIMEOUT,
            )
            html = resp.content.decode(VISTANET_ENCODING, errors="replace")
            if len(html.strip()) < 100:
                return False
            soup = BeautifulSoup(html, "lxml")

            full_text = soup.get_text()
            if re.search(r'p[eé]rdida\s+plan\s+m[eé]dico', full_text, re.I):
                return True

            for table in soup.find_all("table"):
                rows = table.find_all("tr")
                for i, row in enumerate(rows):
                    cells = row.find_all(["td", "th"])
                    if len(cells) < 3:
                        continue
                    header_text = cells[2].get_text(strip=True)
                    if "todo Pago" in header_text or "todo pago" in header_text.lower():
                        if i + 1 < len(rows):
                            data_row = rows[i + 1]
                            data_cells = data_row.find_all(["td", "th"])
                            if len(data_cells) >= 3:
                                method_text = data_cells[2].get_text(separator=" ")
                                method = re.split(r'seleccione', method_text, flags=re.I)[0].strip()
                                if re.search(r'cheque', method, re.I):
                                    return True

            return False
        except Exception:
            return False

    # ── Streaming audit ───────────────────────────────────────────────────────
    def _do_audit_streaming():
        push({"phase": "login", "message": "Connecting to VistaNet..."})
        if not _login():
            push({"phase": "error", "message": "VistaNet login failed. Check credentials and location."})
            return

        push({"phase": "scanning", "message": "Logged in. Starting scan..."})

        flagged: list[dict] = []
        total_lost = 0.0
        current = d_from
        patient_cache: dict[str, dict] = {}
        cpt_cache: dict[str, set] = {}
        processed_invoices: set[str] = set()
        total_days = (d_to - d_from).days + 1
        day_number = 0
        patients_scanned = 0

        while current <= d_to:
            day_number += 1
            records = _layer_search(current)

            push({
                "phase": "scanning",
                "day": current.isoformat(),
                "day_number": day_number,
                "total_days": total_days,
                "patients_found": len(records),
                "patients_scanned": patients_scanned,
                "flagged_so_far": len(flagged),
                "lost_so_far": round(total_lost, 2),
            })

            if not records:
                current += timedelta(days=1)
                continue

            for record in records:
                # Patient data (once per record)
                if record not in patient_cache:
                    time.sleep(0.3)
                    patient_cache[record] = _get_patient_data(record)

                patient = patient_cache[record]

                # CPT dates (once per record)
                if record not in cpt_cache:
                    time.sleep(0.3)
                    cpt_cache[record] = _get_cpt_dates(record)

                cpt_dates = cpt_cache[record]

                # Evaluate invoices (data already parsed from MostrarDatos JS)
                for inv in patient["invoices"]:
                    sale_id = inv["sale_id"]
                    inv_key = f"{record}:{sale_id}"
                    if inv_key in processed_invoices:
                        continue
                    processed_invoices.add(inv_key)

                    inv_date = inv["date"] or current.isoformat()

                    # Filter by date range
                    if inv_date < req.date_from or inv_date > req.date_to:
                        continue

                    # Condition 1: plan > $0
                    plan = inv["plan_amount"]
                    if plan <= 0:
                        continue

                    # Condition 2: balance > $0
                    if inv["balance"] <= 0:
                        continue

                    # Condition 3: no CPT for this invoice date
                    if inv_date in cpt_dates:
                        continue

                    # Condition 4: no insurance payment
                    time.sleep(0.3)
                    if _has_insurance_payment(sale_id, record):
                        continue

                    flagged.append({
                        "invoice_number": sale_id,
                        "date": inv_date,
                        "patient_id": record,
                        "patient_name": patient["name"],
                        "plan_amount": plan,
                        "total": inv["total"],
                        "attended_by": inv["attended_by"],
                        "payer": patient["insurance_plan"],
                    })
                    total_lost += plan

                patients_scanned += 1

                # Push progress update every 4 patients
                if patients_scanned % 4 == 0:
                    push({
                        "phase": "scanning",
                        "day": current.isoformat(),
                        "day_number": day_number,
                        "total_days": total_days,
                        "patients_found": len(records),
                        "patients_scanned": patients_scanned,
                        "flagged_so_far": len(flagged),
                        "lost_so_far": round(total_lost, 2),
                    })

            current += timedelta(days=1)

        # Final result
        flagged.sort(key=lambda x: x.get("date") or "", reverse=True)
        result = LostRevenueAuditResponse(
            date_from=req.date_from,
            date_to=req.date_to,
            flagged_count=len(flagged),
            total_lost=round(total_lost, 2),
            flagged=[LostRevenueEntry(**e) for e in flagged],
        )
        push({"phase": "done", "result": result.model_dump()})

    async def _event_generator():
        future = loop.run_in_executor(None, _do_audit_streaming)
        try:
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=120.0)
                    yield f"data: {json.dumps(event)}\n\n"
                    if event.get("phase") in ("done", "error"):
                        break
                except asyncio.TimeoutError:
                    yield f"data: {json.dumps({'phase': 'error', 'message': 'Audit timed out (120s)'})}\n\n"
                    break
        finally:
            try:
                await future
            except Exception:
                pass

    return StreamingResponse(
        _event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
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
