"""
VistaNet Cloud integration — pull bitácora data and create draft claims.
"""
import re
import logging
import uuid
from datetime import datetime, date
from typing import Optional

import requests
from bs4 import BeautifulSoup
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, text

from database import get_db
from models import (
    Claim, ClaimAttachment, ClaimStatus, ClinicSettings, Patient,
    PatientInsurance, Payer, Provider, ServiceLine, User,
)
from auth import get_current_user
from config import encrypt_value, decrypt_value

logger = logging.getLogger("vistanet")
router = APIRouter(prefix="/vistanet", tags=["vistanet"])

# Attachments directory — on VPS this is /opt/angelclaims/data/attachments
import os as _os
ATTACHMENTS_DIR = _os.environ.get("ATTACHMENTS_DIR", "/opt/angelclaims/data/attachments")

# ── Constants ────────────────────────────────────────────────────────────────

VISTANET_BASE_URL = "https://visualzone.vistanet.cloud"
# Fallback hardcoded credentials (used if DB has no config)
VISTANET_USER = "rcortes"
VISTANET_PASSWORD = "hola"
VISTANET_LOCATION = "MANATI"
VISTANET_ENCODING = "iso-8859-1"
REQUEST_TIMEOUT = 30

VISTANET_LOCATIONS = [
    "MANATI", "BARCELONETA", "ARECIBO", "CIALES", "MOROVIS",
    "VEGA BAJA", "VEGA ALTA", "SAN JUAN", "BAYAMON", "CAROLINA",
    "PONCE", "MAYAGUEZ", "CAGUAS", "HUMACAO", "FAJARDO",
]

# Legacy hardcoded fee schedule — used as fallback only if DB has no entry
_LEGACY_FEE_SCHEDULE = {
    "92002": 125.00, "92004": 200.00, "92012": 100.00, "92014": 150.00,
    "92015": 75.00, "99201": 75.00, "99202": 110.00, "99203": 150.00,
    "99211": 40.00, "99212": 65.00, "99213": 100.00, "99214": 150.00,
    "V2020": 0.00, "V2100": 0.00, "V2200": 0.00, "V2300": 0.00,
    "V2410": 0.00, "V2799": 0.00,
}

MONTHS_ES = {
    "Enero": "01", "Febrero": "02", "Marzo": "03", "Abril": "04",
    "Mayo": "05", "Junio": "06", "Julio": "07", "Agosto": "08",
    "Septiembre": "09", "Octubre": "10", "Noviembre": "11", "Diciembre": "12",
}

MONTHS_ES_REVERSE = {v: k for k, v in MONTHS_ES.items()}


# ── Request / Response Models ────────────────────────────────────────────────

class PullBitacoraRequest(BaseModel):
    date_from: str  # "Abril/28/2026"
    date_to: str    # "Abril/29/2026"


class PullBitacoraResponse(BaseModel):
    patients_found: int
    claims_created: int
    errors: list[str]


# ── VistaNet Session ─────────────────────────────────────────────────────────

async def _get_vistanet_creds(db: AsyncSession) -> tuple[str, str, str]:
    """Get VistaNet credentials from DB, falling back to hardcoded constants."""
    result = await db.execute(select(ClinicSettings).limit(1))
    settings = result.scalar_one_or_none()
    if settings and settings.vistanet_username and settings.vistanet_password:
        return (
            settings.vistanet_username,
            decrypt_value(settings.vistanet_password),
            settings.vistanet_location or VISTANET_LOCATION,
        )
    return (VISTANET_USER, VISTANET_PASSWORD, VISTANET_LOCATION)


class VistaNetSession:
    """Manages authenticated session with VistaNet Cloud."""

    def __init__(self, username: str = None, password: str = None, location: str = None):
        self.session = requests.Session()
        self.session.headers.update({
            "User-Agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/145.0.0.0 Safari/537.36"
            ),
        })
        self._logged_in = False
        self._username = username or VISTANET_USER
        self._password = password or VISTANET_PASSWORD
        self._location = location or VISTANET_LOCATION

    def login(self) -> bool:
        """Authenticate with VistaNet. Returns True on success."""
        try:
            # Step 0: Load login page for initial cookies
            self.session.get(
                f"{VISTANET_BASE_URL}/cgi-bin/login.pl?continuar",
                timeout=REQUEST_TIMEOUT,
                allow_redirects=True,
            )

            # Step 1: POST credentials
            now = datetime.now()
            the_time = now.strftime("%-I:%M:%S")
            data = {
                "dbi": "remoto",
                "localidad": self._location,
                "username": self._username,
                "password": self._password,
                "theTime": the_time,
            }
            self.session.headers.update({
                "Referer": f"{VISTANET_BASE_URL}/cgi-bin/login.pl?continuar",
                "Origin": VISTANET_BASE_URL,
            })
            resp = self.session.post(
                f"{VISTANET_BASE_URL}/cgi-bin/login.pl?Validar",
                data=data,
                timeout=REQUEST_TIMEOUT,
                allow_redirects=True,
            )

            # Check cookies
            cookies = {c.name: c.value for c in self.session.cookies}
            if cookies.get("logstatus") == "1" or "userid" in cookies:
                self._logged_in = True
                logger.info("VistaNet login successful.")
                return True

            # Check redirect
            if "index.pl" in resp.url or "Confirmar" in resp.url:
                self._logged_in = True
                try:
                    self.session.get(
                        f"{VISTANET_BASE_URL}/cgi-bin/login.pl?Confirmar",
                        timeout=REQUEST_TIMEOUT,
                        allow_redirects=True,
                    )
                except requests.RequestException:
                    pass
                logger.info("VistaNet login successful (redirect).")
                return True

            # Assume success if not bounced to login
            text = resp.content.decode(VISTANET_ENCODING, errors="replace")
            if "login.pl" in resp.url and "usuario" in text.lower():
                logger.error("VistaNet login failed — redirected back to login page.")
                return False

            self._logged_in = True
            # Hit Confirmar to finalize
            try:
                self.session.get(
                    f"{VISTANET_BASE_URL}/cgi-bin/login.pl?Confirmar",
                    timeout=REQUEST_TIMEOUT,
                    allow_redirects=True,
                )
            except requests.RequestException:
                pass
            logger.info("VistaNet login appears successful.")
            return True

        except requests.RequestException as e:
            logger.error("VistaNet login request failed: %s", e)
            return False

    def fetch_bitacora(self, date_from: str, date_to: str) -> str:
        """Fetch bitácora HTML for the given date range."""
        if not self._logged_in:
            raise RuntimeError("Not logged in to VistaNet")

        resp = self.session.post(
            f"{VISTANET_BASE_URL}/cgi-bin/bitacora_planesmedicos_facturacion.pl?Display",
            data={
                "fecha1": date_from,
                "fecha2": date_to,
                "plan": "",
                "signature": "",
                "record": "",
            },
            timeout=REQUEST_TIMEOUT,
            allow_redirects=True,
        )
        return resp.content.decode(VISTANET_ENCODING, errors="replace")


# ── HTML Parsing ─────────────────────────────────────────────────────────────

def parse_spanish_date(date_str: str) -> Optional[date]:
    """Convert 'Abril/28/2026' or 'Julio/23/1964' to a date object."""
    if not date_str:
        return None
    try:
        parts = date_str.strip().split("/")
        if len(parts) != 3:
            return None
        month_name, day, year = parts
        month_num = MONTHS_ES.get(month_name.strip().title())
        if not month_num:
            return None
        return date(int(year), int(month_num), int(day))
    except (ValueError, IndexError):
        return None


def to_spanish_date(d: date) -> str:
    """Convert date to 'Abril/28/2026' format."""
    month_name = MONTHS_ES_REVERSE.get(f"{d.month:02d}", "Enero")
    return f"{month_name}/{d.day}/{d.year}"


def normalize_name(name: str) -> str:
    """Normalize patient name: strip extra spaces, title case."""
    return " ".join(name.strip().split())


def parse_bitacora_html(html: str) -> list[dict]:
    """
    Parse bitácora HTML and extract patient billing records.
    Returns a list of patient dicts with demographics, diagnoses, procedures, materials, and sale info.
    """
    soup = BeautifulSoup(html, "html.parser")
    patients = []

    # Find all patient rows by onclick="BuscarRecord('XXXXX')"
    patient_rows = soup.find_all("tr", onclick=re.compile(r"BuscarRecord"))

    for row in patient_rows:
        try:
            patient_data = extract_patient_from_row(row)
            if patient_data:
                patients.append(patient_data)
        except Exception as e:
            logger.warning("Failed to parse patient row: %s", e)
            continue

    return patients


def extract_patient_from_row(row) -> Optional[dict]:
    """Extract all billing data from a single patient <tr> row."""
    # Get record ID from onclick
    onclick = row.get("onclick", "")
    record_match = re.search(r"BuscarRecord\('(\d+)'\)", onclick)
    if not record_match:
        return None
    record_id = record_match.group(1)

    tds = row.find_all("td", recursive=False)
    if len(tds) < 4:
        return None

    col1 = tds[1]  # Insurance card + plan info
    col3 = tds[3]  # Main data: demographics, diagnoses, procedures, materials
    # Note: tds[0]=row#, tds[1]=ins card, tds[2]=license/signature, tds[3]=demographics+billing

    # Get the full text/html of col3 for parsing
    col3_html = str(col3)
    col3_text = col3.get_text(separator="\n")

    # ── Patient Name ──
    name_font = col3.find("font", attrs={"face": "Verdana", "size": "4"})
    if not name_font:
        name_font = col3.find("font", attrs={"face": "Verdana", "size": 4})
    patient_name = normalize_name(name_font.get_text()) if name_font else ""

    # ── Record Number ──
    record_num = record_id
    record_fonts = col3.find_all("font", attrs={"face": "Verdana", "size": "2"})
    for f in record_fonts:
        text = f.get_text()
        if "Record:" in text:
            match = re.search(r"Record:\s*(\d+)", text)
            if match:
                record_num = match.group(1)

    # ── DOB ──
    dob = None
    for f in record_fonts:
        text = f.get_text()
        if "DOB:" in text:
            match = re.search(r"DOB:\s*(\S+/\d+/\d+)", text)
            if match:
                dob = parse_spanish_date(match.group(1))

    # ── Address ──
    address = ""
    addr_font = col3.find("font", attrs={"size": "1", "face": "Arial", "color": "#666666"})
    if addr_font:
        address = addr_font.get_text().strip()

    # ── Insurance Plan (from col1) ──
    plan_name = ""
    contract_number = ""
    col1_text = col1.get_text(separator="\n")
    plan_match = re.search(r"Plan\s*1:\s*(.+?)(?:\n|$)", col1_text)
    if plan_match:
        plan_name = plan_match.group(1).strip()
    contract_match = re.search(r"N[úu]m\.?\s*Contrato:\s*(\S+)", col1_text)
    if contract_match:
        contract_number = contract_match.group(1).strip()

    # Also try col3 for plan name if col1 is empty
    if not plan_name:
        plan_font = col3.find("font", attrs={"face": "Arial", "size": "2"})
        if plan_font:
            plan_text = plan_font.get_text().strip()
            if plan_text and plan_text != "\n":
                plan_name = plan_text

    # ── Service Date ──
    service_date = None
    svc_match = re.search(r"SERVICIOS OPTOMETRICOS:\s*\(([^)]+)\)", col3_text, re.IGNORECASE)
    if svc_match:
        service_date = parse_spanish_date(svc_match.group(1))

    # Fallback: materials date (try multiple spellings — VistaNet may use accented or unaccented)
    if not service_date:
        mat_date_match = re.search(
            r"C[OÓ]DIGOS DE MATERIALES:\s*\(([^)]+)\)",
            col3_text,
            re.IGNORECASE,
        )
        if mat_date_match:
            service_date = parse_spanish_date(mat_date_match.group(1))

    # Final fallback: any date-like pattern in the form Month/DD/YYYY in col3
    if not service_date:
        any_date_match = re.search(
            r"(?:Enero|Febrero|Marzo|Abril|Mayo|Junio|Julio|Agosto|Septiembre|Octubre|Noviembre|Diciembre)/\d+/\d{4}",
            col3_text,
            re.IGNORECASE,
        )
        if any_date_match:
            service_date = parse_spanish_date(any_date_match.group(0))

    # ── Diagnoses ──
    diagnoses = []
    diag_match = re.search(r"DIAGN[ÓO]STICOS:(.*?)(?:<hr|PROCEDIMIENTOS:|$)", col3_html, re.DOTALL | re.IGNORECASE)
    if diag_match:
        diag_block = diag_match.group(1)
        # Match diagnosis lines: <b>A</b>. H52.03 - description
        diag_lines = re.findall(
            r"<b>([A-J])\.?</b>\.?\s*([A-Z]\d[\w.]*)\s*-\s*(.+?)(?:<br|$)",
            diag_block,
            re.IGNORECASE,
        )
        for pointer, code, desc in diag_lines:
            code = code.strip()
            if code and code != ".":
                diagnoses.append({
                    "pointer": pointer.upper(),
                    "code": code,
                    "description": desc.strip(),
                })

    # ── Procedures (CPT) ──
    procedures = []
    proc_match = re.search(r"PROCEDIMIENTOS:(.*?)(?:C[O\u00d3]DIGOS DE MATERIALES|<hr|$)", col3_html, re.DOTALL | re.IGNORECASE)
    if proc_match:
        proc_block = proc_match.group(1)
        proc_lines = re.findall(
            r"(\d+)\.\s*(\d{5})(?:\s*-\s*(.+?))?\s*(?:<br|Pointer|\n|$)",
            proc_block,
            re.IGNORECASE | re.DOTALL,
        )
        for line_num, code, desc in proc_lines:
            desc = desc or ''  # description may be empty for codes without one
            # Find pointer for this procedure
            pointer_match = re.search(
                rf"{re.escape(code)}.*?Pointer:\s*([A-Z]*)",
                proc_block,
                re.DOTALL | re.IGNORECASE,
            )
            pointer_str = pointer_match.group(1) if pointer_match else ""
            diagnosis_pointers = list(pointer_str.upper()) if pointer_str else []

            procedures.append({
                "line": int(line_num),
                "code": code.strip(),
                "description": re.sub(r"<[^>]+>", "", desc).strip(),
                "diagnosis_pointers": diagnosis_pointers,
            })

    # ── Materials (HCPCS V-codes) ──
    materials = []
    mat_match = re.search(r"C[O\u00d3]DIGOS DE MATERIALES:(.*?)(?:</div>|<hr|$)", col3_html, re.DOTALL | re.IGNORECASE)
    if mat_match:
        mat_block = mat_match.group(1)
        mat_lines = re.findall(
            r"(\d+)\.\s*(V\d{4})\s*-\s*(.+?)\s*<br",
            mat_block,
            re.IGNORECASE,
        )
        for line_num, code, desc in mat_lines:
            materials.append({
                "line": int(line_num),
                "code": code.strip(),
                "description": re.sub(r"<[^>]+>", "", desc).strip(),
                "charge_amount": 0.0,
            })

    # ── Sale / Financial Info ──
    # Parse individual sale line items: <li>ITEM NAME <span style='color:green'>(XX.XX)</span></li>
    sale_items = []
    sale_match = re.search(r"Venta Paciente:.*?<ol>(.*?)</ol>", col3_html, re.DOTALL | re.IGNORECASE)
    if sale_match:
        sale_block = sale_match.group(1)
        li_items = re.findall(
            r"<li>(.+?)</li>",
            sale_block,
            re.DOTALL | re.IGNORECASE,
        )
        for li_text in li_items:
            # Extract item name and amount from "ITEM NAME  <span style='color:green'>(XX.XX)</span>"
            clean_text = re.sub(r"<[^>]+>", "", li_text).strip()
            amount_match = re.search(r"\(([\d,.]+)\)", clean_text)
            amount = float(amount_match.group(1).replace(",", "")) if amount_match else 0.0
            item_name = re.sub(r"\s*\([\d,.]+\)\s*$", "", clean_text).strip()
            sale_items.append({"name": item_name, "amount": amount})

    sale_total = 0.0
    total_match = re.search(r"Total:\s*\$([\d,.]+)", col3_text)
    if total_match:
        sale_total = float(total_match.group(1).replace(",", ""))

    # Cross-reference sale items with materials to assign amounts
    # Try to match sale item names to material descriptions
    for mat in materials:
        mat_desc_lower = mat["description"].lower()
        for sale_item in sale_items:
            sale_name_lower = sale_item["name"].lower()
            # Match if sale item name contains key words from material description or vice versa
            if (mat_desc_lower in sale_name_lower or sale_name_lower in mat_desc_lower
                    or _fuzzy_material_match(mat_desc_lower, sale_name_lower)):
                mat["charge_amount"] = sale_item["amount"]
                break

    # If no cross-reference worked but we have sale_total and materials,
    # distribute the total evenly as a fallback
    materials_with_amounts = [m for m in materials if m["charge_amount"] > 0]
    if not materials_with_amounts and materials and sale_total > 0:
        per_material = round(sale_total / len(materials), 2)
        for mat in materials:
            mat["charge_amount"] = per_material

    # ── Image URLs (insurance card, license, signature) ──
    insurance_card_url = None
    license_url = None
    signature_url = None

    # col1 (tds[1]) has insurance card image
    col1_imgs = col1.find_all("img")
    for img in col1_imgs:
        src = img.get("src", "")
        if "getimage.php" in src and "base64" not in src:
            insurance_card_url = src
            break

    # col2 (tds[2]) has license and signature images
    if len(tds) > 2:
        col2 = tds[2]
        col2_imgs = col2.find_all("img")
        for img in col2_imgs:
            src = img.get("src", "")
            if "getimage.php" not in src or "base64" in src:
                continue
            if "doc=licencia" in src:
                license_url = src
            elif "doc=firma" in src:
                signature_url = src

    # Determine section (exam vs no-exam)
    has_exam = bool(diagnoses) or bool(procedures)

    # Store sale_items for reference
    return {
        "sale_items": sale_items,
        "record_id": record_id,
        "record_num": record_num,
        "patient_name": patient_name,
        "dob": dob,
        "address": address,
        "plan_name": plan_name,
        "contract_number": contract_number,
        "service_date": service_date,
        "diagnoses": diagnoses,
        "procedures": procedures,
        "materials": materials,
        "sale_total": sale_total,
        "has_exam": has_exam,
        "insurance_card_url": insurance_card_url,
        "license_url": license_url,
        "signature_url": signature_url,
    }


def _fuzzy_material_match(mat_desc: str, sale_name: str) -> bool:
    """Fuzzy match between material description and sale item name."""
    # Common mappings between V-code descriptions and sale item names
    mappings = {
        "frame": ["montura", "frame", "oakley", "ray ban", "modern"],
        "esferico": ["vision sencilla", "ft-28", "progresivo", "trifocal"],
        "policarbonato": ["policarbonato"],
        "fotocromatico": ["transition", "fotocromatico"],
        "lente": ["lente", "vision sencilla", "ft-28", "progresivo"],
    }
    for key, aliases in mappings.items():
        if key in mat_desc:
            for alias in aliases:
                if alias in sale_name:
                    return True
    return False


# ── Claim Creation ───────────────────────────────────────────────────────────

def split_patient_name(full_name: str) -> tuple[str, str]:
    """Split 'JOSE PEREZ COLON' into (first_name, last_name)."""
    parts = full_name.strip().split()
    if len(parts) == 0:
        return ("Unknown", "Unknown")
    if len(parts) == 1:
        return (parts[0].title(), "")
    first = parts[0].title()
    last = " ".join(parts[1:]).title()
    return (first, last)


def generate_claim_number() -> str:
    """Generate a unique claim number."""
    return f"VN-{uuid.uuid4().hex[:8].upper()}"


def _backfill_patient_address(patient: Patient, parsed: dict) -> None:
    """Backfill empty city/state/zip on existing patients from new import data."""
    address = parsed.get("address", "")
    if not address:
        return
    # Clean address — strip doctor name suffix (e.g. "DRA. BRENDA CUBERO" appended by VistaNet)
    import re as _re
    address_clean = _re.sub(r'\s*DRA?\.?\s+[A-Z]+\s+[A-Z]+\s*$', '', address.strip(), flags=_re.IGNORECASE)
    # Update address_line1 if current one has junk (doctor name appended)
    if patient.address_line1 and 'DRA' in (patient.address_line1 or '').upper():
        patient.address_line1 = address_clean
    elif not (patient.address_line1 or '').strip():
        patient.address_line1 = address_clean
    # Backfill zip if empty
    if not (patient.zip_code or '').strip():
        zip_match = _re.search(r'(\d{5})(?:-\d{4})?\s*$', address_clean)
        if zip_match:
            patient.zip_code = zip_match.group(1)
    # Backfill state if empty
    if not (patient.state or '').strip():
        patient.state = 'PR'
    # Backfill city if empty
    if not (patient.city or '').strip():
        import unicodedata
        def _strip_accents_bf(s: str) -> str:
            return ''.join(c for c in unicodedata.normalize('NFD', s) if unicodedata.category(c) != 'Mn')
        addr_upper = address_clean.upper()
        addr_normalized = addr_upper.replace("'", "")
        pr_cities = [
            'SAN JUAN', 'BAYAMÓN', 'CAROLINA', 'PONCE', 'CAGUAS', 'GUAYNABO',
            'MAYAGÜEZ', 'ARECIBO', 'AGUADILLA', 'HATILLO', 'MANATÍ', 'FAJARDO',
            'HUMACAO', 'RÍO GRANDE', 'ISABELA', 'VEGA BAJA', 'VEGA ALTA',
            'DORADO', 'TOA ALTA', 'TOA BAJA', 'TRUJILLO ALTO', 'CATAÑO',
            'BARCELONETA', 'MOROVIS', 'CIDRA', 'CAMUY', 'UTUADO', 'JUNCOS',
            'COAMO', 'YAUCO', 'GUAYAMA', 'CABO ROJO', 'SAN GERMÁN',
            'SAN SEBASTIÁN', 'LARES', 'ADJUNTAS', 'COMERÍO', 'NARANJITO',
            'BARRANQUITAS', 'OROCOVIS', 'JAYUYA', 'VILLALBA', 'JUANA DÍAZ',
            'SANTA ISABEL', 'SALINAS', 'ARROYO', 'PATILLAS', 'MAUNABO',
            'YABUCOA', 'LAS PIEDRAS', 'NAGUABO', 'CEIBA', 'LUQUILLO',
            'CANÓVANAS', 'LOÍZA', 'RINCÓN', 'AÑASCO', 'LAS MARÍAS',
            'HORMIGUEROS', 'LAJAS', 'SABANA GRANDE', 'SAN LORENZO',
            'PEÑUELAS', 'CAYEY', 'GURABO',
        ]
        for c in pr_cities:
            c_stripped = _strip_accents_bf(c)
            if c in addr_upper or c_stripped in addr_upper or c_stripped in addr_normalized:
                patient.city = c.title()
                break


async def find_or_create_patient(
    db: AsyncSession,
    parsed: dict,
) -> Patient:
    """Find existing patient by record number or create a new one."""
    from sqlalchemy.orm import selectinload as _sil

    # Try to find by wink_patient_id (VistaNet record)
    result = await db.execute(
        select(Patient).options(_sil(Patient.insurances))
        .where(Patient.wink_patient_id == parsed["record_id"]).limit(1)
    )
    patient = result.scalars().first()
    if patient:
        _backfill_patient_address(patient, parsed)
        return patient

    # Try by MRN
    result = await db.execute(
        select(Patient).options(_sil(Patient.insurances))
        .where(Patient.mrn == parsed["record_num"]).limit(1)
    )
    patient = result.scalars().first()
    if patient:
        _backfill_patient_address(patient, parsed)
        return patient

    # Try by name + DOB (fuzzy match for patients without record IDs)
    first_name_q, last_name_q = split_patient_name(parsed["patient_name"])
    if first_name_q and last_name_q and parsed.get("dob"):
        result = await db.execute(
            select(Patient).options(_sil(Patient.insurances))
            .where(
                func.upper(Patient.first_name) == first_name_q.upper(),
                func.upper(Patient.last_name) == last_name_q.upper(),
            ).limit(1)
        )
        patient = result.scalars().first()
        if patient:
            _backfill_patient_address(patient, parsed)
            return patient

    # Create new patient
    first_name, last_name = split_patient_name(parsed["patient_name"])

    # Parse address — PR addresses typically end with "CITY PR ZIPCODE" or "CITY P.R. ZIPCODE"
    city = ""
    state = "PR"
    zip_code = ""
    address_line1 = parsed["address"]
    if address_line1:
        # Clean up the address (remove extra whitespace, newlines)
        address_clean = re.sub(r'\s+', ' ', address_line1).strip()
        # Strip doctor name suffix (VistaNet appends "DRA. BRENDA CUBERO" etc.)
        address_clean = re.sub(r'\s*DRA?\.?\s+[A-Z]+\s+[A-Z]+\s*$', '', address_clean, flags=re.IGNORECASE).strip()

        # Try to extract zip code
        zip_match = re.search(r'(\d{5})(?:-\d{4})?\s*$', address_clean)
        if zip_match:
            zip_code = zip_match.group(1)

        # Try to extract city — look for pattern: CITY (PR|P.R.) ZIPCODE
        # Use \w and Unicode flag to handle accented chars (MANATÍ, CAÑOVANAS, etc.)
        city_match = re.search(
            r'([\w][\w\s\']+?)\s+(?:PR|P\.?R\.?)\s+\d{5}',
            address_clean, re.IGNORECASE | re.UNICODE
        )
        if city_match:
            city = city_match.group(1).strip().title()
        else:
            # Fallback: try to get city from known PR municipalities
            pr_cities = [
                'MANATI', 'MANATÍ', 'BARCELONETA', 'ARECIBO', 'SAN JUAN', 'BAYAMON',
                'CAROLINA', 'PONCE', 'MAYAGUEZ', 'CAGUAS', 'GUAYNABO',
                'HUMACAO', 'AGUADILLA', 'HATILLO', 'VEGA BAJA', 'VEGA ALTA',
                'DORADO', 'TOA BAJA', 'TOA ALTA', 'TRUJILLO ALTO', 'UTUADO',
                'MOROVIS', 'CIALES', 'FLORIDA', 'COROZAL', 'NARANJITO',
                'COMERIO', 'OROCOVIS', 'JAYUYA', 'ADJUNTAS', 'LARES',
                'SAN SEBASTIAN', 'ISABELA', 'QUEBRADILLAS', 'CAMUY',
                'RIO GRANDE', 'LOIZA', 'CANÓVANAS', 'JUNCOS', 'LAS PIEDRAS',
                'NAGUABO', 'FAJARDO', 'CEIBA', 'LUQUILLO', 'YABUCOA',
                'MAUNABO', 'PATILLAS', 'ARROYO', 'GUAYAMA', 'SALINAS',
                'SANTA ISABEL', 'COAMO', 'JUANA DIAZ', 'VILLALBA',
                'AIBONITO', 'BARRANQUITAS', 'CIDRA', 'AGUAS BUENAS',
                'CATAÑO', 'GUANICA', 'YAUCO', 'SAN GERMAN', 'LAJAS',
                'SABANA GRANDE', 'MARICAO', 'HORMIGUEROS', 'CABO ROJO',
                'ANASCO', 'LAS MARIAS', 'RINCON', 'AGUADA', 'MOCA',
                'PEÑUELAS', 'CAYEY', 'GURABO', 'SAN LORENZO',
            ]
            addr_upper = address_clean.upper()
            # Normalize VistaNet encoding quirks: apostrophes for tildes
            # e.g. MANAT' -> MANAT, CANOVANAS' -> CANOVANAS
            addr_normalized = addr_upper.replace("'", "")

            # Build accent-stripped lookup for comparison
            import unicodedata
            def _strip_accents(s: str) -> str:
                return ''.join(c for c in unicodedata.normalize('NFD', s) if unicodedata.category(c) != 'Mn')

            matched_city = False
            for c in pr_cities:
                c_stripped = _strip_accents(c)
                # Match against both original and normalized (apostrophe-removed) address
                if c in addr_upper or c_stripped in addr_upper or c_stripped in addr_normalized:
                    city = c.title()
                    matched_city = True
                    break
            # If still no match, try the normalized address against stripped city names
            if not matched_city:
                for c in pr_cities:
                    c_stripped = _strip_accents(c)
                    if c_stripped in addr_normalized:
                        city = c.title()
                        break

        state = "PR"
        address_line1 = address_clean

    patient = Patient(
        wink_patient_id=parsed["record_id"],
        mrn=parsed["record_num"],
        first_name=first_name,
        last_name=last_name,
        dob=parsed["dob"] or date(1900, 1, 1),
        address_line1=address_line1,
        city=city,
        state=state,
        zip_code=zip_code,
    )
    db.add(patient)
    await db.flush()
    return patient


# VistaNet plan name → payer_id mapping
# VistaNet uses these names in their bitácora dropdowns
# Use shared PR payer mapping (single source of truth)
from payer_mapping import PR_PAYER_ALIASES
VISTANET_PLAN_ALIASES = {k: v for k, v in PR_PAYER_ALIASES.items() if v is not None}


async def find_payer_by_plan_name(db: AsyncSession, plan_name: str) -> Optional[Payer]:
    """Try to match a VistaNet plan name to an existing payer."""
    if not plan_name:
        return None

    normalized = plan_name.strip().upper()

    # 1. Check alias table first (most reliable)
    payer_id = VISTANET_PLAN_ALIASES.get(normalized)
    if payer_id:
        result = await db.execute(
            select(Payer).where(Payer.payer_id == payer_id).limit(1)
        )
        payer = result.scalars().first()
        if payer:
            return payer

    # 2. Exact name match (case-insensitive)
    result = await db.execute(
        select(Payer).where(Payer.name.ilike(plan_name)).limit(1)
    )
    payer = result.scalars().first()
    if payer:
        return payer

    # 3. Fuzzy: try matching with normalized (remove dashes, extra spaces)
    clean = normalized.replace("-", " ").replace("  ", " ")
    result = await db.execute(
        select(Payer).where(
            func.replace(func.upper(Payer.name), '-', ' ').ilike(f"%{clean}%")
        )
    )
    rows = result.scalars().all()
    if len(rows) == 1:
        return rows[0]

    # 4. No match
    return None


async def get_default_provider(db: AsyncSession) -> Optional[Provider]:
    """Get the first active provider as default."""
    result = await db.execute(
        select(Provider).where(Provider.is_active == True).limit(1)
    )
    return result.scalar_one_or_none()


async def create_claim_from_parsed(
    db: AsyncSession,
    parsed: dict,
    patient: Patient,
    payer: Optional[Payer],
    provider: Provider,
) -> Claim:
    """Create a draft claim from parsed bitácora data."""
    # Build diagnosis codes list
    diagnosis_codes = [d["code"] for d in parsed["diagnoses"]]

    # Calculate total from sale total
    total_billed = parsed["sale_total"] if parsed["sale_total"] > 0 else 0.0

    claim = Claim(
        claim_number=generate_claim_number(),
        patient_id=patient.id,
        provider_id=provider.id,
        payer_id=payer.id if payer else provider.id,  # fallback
        status=ClaimStatus.DRAFT,
        service_date_from=parsed["service_date"] or date.today(),
        diagnosis_codes=diagnosis_codes,
        total_billed=total_billed,
        source="vistanet",
        external_ref=f"vistanet:{parsed['record_id']}",
        notes=f"Auto-imported from VistaNet bitácora. Plan: {parsed['plan_name']}. Record: {parsed['record_num']}.",
        sale_items=parsed.get("sale_items"),
    )
    db.add(claim)
    await db.flush()

    # Create service lines for procedures
    _created_lines: list = []  # track locally to avoid lazy-load crash on claim.service_lines
    line_number = 1
    num_procedures = len(parsed["procedures"])

    # Try to figure out billed amounts for procedures from sale items
    # Look for exam-related sale items (e.g. "DEDUCIBLE EXAMEN VISUAL", "EXAMEN REGULAR")
    sale_items = parsed.get("sale_items", [])
    exam_amount = 0.0
    for si in sale_items:
        name_lower = si["name"].lower()
        if any(kw in name_lower for kw in ["examen", "deducible", "exam"]):
            exam_amount += si["amount"]

    for proc in parsed["procedures"]:
        # Convert letter pointers to numeric (A=1, B=2, etc.)
        numeric_pointers = [
            ord(p.upper()) - ord("A") + 1
            for p in proc.get("diagnosis_pointers", [])
            if p.isalpha()
        ]

        # If no pointers were parsed for this procedure, default to first diagnosis
        if not numeric_pointers and diagnosis_codes:
            numeric_pointers = [1]

        # Always use fee schedule for billed amounts (NOT patient deductible/copay from sale)
        from routers.fee_schedule import get_fee_amount as _get_fee
        db_amount, _src = await _get_fee(db, proc["code"], payer.id if payer else None)
        proc_amount = db_amount if db_amount > 0 else _LEGACY_FEE_SCHEDULE.get(proc["code"], 0.0)

        sl = ServiceLine(
            claim_id=claim.id,
            line_number=line_number,
            cpt_code=proc["code"],
            description=proc["description"],
            service_date=parsed["service_date"],
            billed_amount=proc_amount,
            diagnosis_pointers=numeric_pointers,
            units=1,
        )
        db.add(sl)
        _created_lines.append(sl)
        line_number += 1

    # Create service lines for materials (HCPCS V-codes)
    for mat in parsed["materials"]:
        # Use the cross-referenced charge_amount from sale items
        mat_amount = mat.get("charge_amount", 0.0)

        # If amount is still 0, look up fee schedule from DB (V-codes typically stay 0 unless sale data exists)
        if mat_amount <= 0:
            from routers.fee_schedule import get_fee_amount as _get_fee
            db_amount, _src = await _get_fee(db, mat["code"], payer.id if payer else None)
            mat_amount = db_amount if db_amount > 0 else _LEGACY_FEE_SCHEDULE.get(mat["code"], 0.0)

        # For materials, default pointers to first diagnosis if available
        mat_pointers = [1] if diagnosis_codes else []

        sl = ServiceLine(
            claim_id=claim.id,
            line_number=line_number,
            cpt_code=mat["code"],
            description=mat["description"],
            service_date=parsed["service_date"],
            billed_amount=mat_amount,
            diagnosis_pointers=mat_pointers,
            units=1,
        )
        db.add(sl)
        _created_lines.append(sl)
        line_number += 1

    # Recalculate total_billed from tracked service lines (NOT claim.service_lines — that triggers lazy load crash)
    recalculated_total = sum(sl.billed_amount * (sl.units or 1) for sl in _created_lines)
    if recalculated_total > 0:
        claim.total_billed = recalculated_total

    # Create patient insurance record if we have plan info
    if payer and parsed["contract_number"]:
        # Check if insurance already exists
        result = await db.execute(
            select(PatientInsurance).where(
                PatientInsurance.patient_id == patient.id,
                PatientInsurance.payer_id == payer.id,
                PatientInsurance.member_id == parsed["contract_number"],
            )
        )
        existing_ins = result.scalars().first()
        if not existing_ins:
            ins = PatientInsurance(
                patient_id=patient.id,
                payer_id=payer.id,
                member_id=parsed["contract_number"],
                is_primary=True,
            )
            db.add(ins)

    return claim


# ── Attachment Download ──────────────────────────────────────────────────────

async def _download_claim_attachments(
    db: AsyncSession,
    vs: "VistaNetSession",
    claim: Claim,
    parsed: dict,
) -> None:
    """Download insurance card, license, and signature images from VistaNet."""
    import pathlib

    image_map = [
        ("insurance_card_url", "insurance_card", "insurance_card.jpg"),
        ("license_url", "license", "license.jpg"),
        ("signature_url", "signature", "signature.jpg"),
    ]

    claim_dir = pathlib.Path(ATTACHMENTS_DIR) / str(claim.id)

    for url_key, att_type, filename in image_map:
        url = parsed.get(url_key)
        if not url:
            continue

        try:
            # Resolve relative URLs against VistaNet base
            full_url = url if url.startswith('http') else f"{VISTANET_BASE_URL}/cgi-bin/{url}"
            logger.info("Downloading %s from %s", att_type, full_url[:80])
            resp = vs.session.get(full_url, timeout=REQUEST_TIMEOUT)
            if resp.status_code != 200:
                logger.warning("Image download %s returned %s", att_type, resp.status_code)
                continue

            # Skip tiny placeholder images (the 1x1 base64 fallback)
            if len(resp.content) < 500:
                logger.debug("Skipping tiny image for %s (likely placeholder)", att_type)
                continue

            claim_dir.mkdir(parents=True, exist_ok=True)
            file_path = claim_dir / filename
            file_path.write_bytes(resp.content)

            attachment = ClaimAttachment(
                claim_id=claim.id,
                filename=filename,
                file_path=str(file_path),
                attachment_type=att_type,
            )
            db.add(attachment)
            logger.info("Saved %s for claim %s (%d bytes)", att_type, claim.claim_number, len(resp.content))

        except Exception as e:
            logger.warning("Failed to download %s for claim %s: %s", att_type, claim.claim_number, e)


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.post("/pull-bitacora", response_model=PullBitacoraResponse)
async def pull_bitacora(
    req: PullBitacoraRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """
    Pull bitácora from VistaNet for a date range, parse patient records,
    and create draft claims in the database.
    """
    errors: list[str] = []

    # Step 1: Authenticate to VistaNet (use DB credentials if available)
    vn_user, vn_pass, vn_loc = await _get_vistanet_creds(db)
    vs = VistaNetSession(username=vn_user, password=vn_pass, location=vn_loc)
    if not vs.login():
        raise HTTPException(status_code=502, detail="Failed to authenticate to VistaNet")

    # Step 2: Fetch bitácora HTML
    try:
        html = vs.fetch_bitacora(req.date_from, req.date_to)
    except Exception as e:
        logger.error("Failed to fetch bitácora: %s", e)
        raise HTTPException(status_code=502, detail=f"Failed to fetch bitácora: {str(e)}")

    if not html or len(html) < 200:
        raise HTTPException(status_code=404, detail="No bitácora data returned for the given date range")

    # Step 3: Parse HTML
    parsed_patients = parse_bitacora_html(html)
    if not parsed_patients:
        return PullBitacoraResponse(patients_found=0, claims_created=0, errors=["No patient records found in bitácora"])

    # Step 4: Get default provider
    provider = await get_default_provider(db)
    if not provider:
        raise HTTPException(status_code=400, detail="No active provider found. Please add a provider first.")

    # Step 5: Create claims
    claims_created = 0
    _new_claims: list[Claim] = []  # track for auto-scrub
    for parsed in parsed_patients:
        try:
            # Skip patients with no name
            if not parsed["patient_name"]:
                errors.append(f"Skipped record {parsed['record_id']}: no patient name")
                continue

            # Check for duplicate (same record + same date)
            existing = await db.execute(
                select(Claim).where(
                    Claim.external_ref == f"vistanet:{parsed['record_id']}",
                    Claim.service_date_from == parsed["service_date"],
                ).limit(1)
            )
            if existing.scalars().first():
                errors.append(
                    f"Skipped {parsed['patient_name']}: claim already exists for this date"
                )
                continue

            # Find or create patient
            patient = await find_or_create_patient(db, parsed)

            # Find payer
            payer = await find_payer_by_plan_name(db, parsed["plan_name"])
            if not payer and parsed["plan_name"]:
                errors.append(
                    f"{parsed['patient_name']}: plan '{parsed['plan_name']}' not found — claim created without payer match"
                )

            # We need a payer_id — if none found, skip
            if not payer:
                # Try to find any default payer
                result = await db.execute(select(Payer).limit(1))
                payer = result.scalar_one_or_none()
                if not payer:
                    errors.append(
                        f"Skipped {parsed['patient_name']}: no payer found and no default payer"
                    )
                    continue

            # Create claim
            claim = await create_claim_from_parsed(db, parsed, patient, payer, provider)
            _new_claims.append(claim)
            claims_created += 1

            # Download and save patient document images
            try:
                await _download_claim_attachments(db, vs, claim, parsed)
            except Exception as img_err:
                logger.warning("Failed to download images for %s: %s", parsed.get("patient_name", "?"), img_err)
                errors.append(f"{parsed.get('patient_name', 'unknown')}: image download failed — {str(img_err)}")

        except Exception as e:
            import traceback
            tb = traceback.format_exc()
            logger.error("Failed to create claim for %s: %s\n%s", parsed.get("patient_name", "?"), e, tb)
            errors.append(f"Error processing {parsed.get('patient_name', 'unknown')}: {str(e)}")

    await db.commit()

    # Auto-advance: re-query each claim with eager loading, run full scrub
    from sqlalchemy.orm import selectinload as _sil_scrub
    for claim_obj in _new_claims:
        try:
            cid = claim_obj.id
            # Get total from service lines via SQL
            sl_check = await db.execute(
                text("SELECT COUNT(*), COALESCE(SUM(billed_amount), 0) FROM service_lines WHERE claim_id = :cid"),
                {"cid": cid}
            )
            sl_count, sl_total = sl_check.one()

            # Re-query claim with eager loading to avoid lazy-load crashes
            _fresh_result = await db.execute(
                select(Claim)
                .options(
                    _sil_scrub(Claim.patient).selectinload(Patient.insurances),
                    _sil_scrub(Claim.provider),
                    _sil_scrub(Claim.payer),
                    _sil_scrub(Claim.service_lines),
                )
                .where(Claim.id == cid)
            )
            fresh_claim = _fresh_result.scalar_one_or_none()
            if not fresh_claim:
                logger.warning("Could not re-query claim %s for scrub", cid)
                continue

            try:
                from routers.ai import _scrub_patient, _scrub_provider, _scrub_payer, _scrub_claim_level, _scrub_service_lines
                scrub_issues = []
                _scrub_patient(fresh_claim, scrub_issues)
                _scrub_provider(fresh_claim, scrub_issues)
                _scrub_payer(fresh_claim, scrub_issues)
                _scrub_claim_level(fresh_claim, scrub_issues)
                _scrub_service_lines(fresh_claim, scrub_issues)
                err_c = sum(1 for i in scrub_issues if i.get('type') == 'error')
                warn_c = sum(1 for i in scrub_issues if i.get('type') == 'warning')
                score = max(0, 100 - err_c * 25 - warn_c * 5)
                import json
                # Auto-advance to READY only if zero errors AND zero warnings
                new_status = 'READY' if (err_c == 0 and warn_c == 0) else None
                if new_status:
                    await db.execute(
                        text("UPDATE claims SET scrub_score = :score, scrub_issues = :issues, total_billed = :total, status = 'READY' WHERE id = :cid"),
                        {"cid": cid, "total": float(sl_total), "score": score, "issues": json.dumps(scrub_issues)}
                    )
                    logger.info("Auto-advance claim %s → READY (score=%d)", claim_obj.claim_number, score)
                else:
                    await db.execute(
                        text("UPDATE claims SET scrub_score = :score, scrub_issues = :issues, total_billed = :total WHERE id = :cid"),
                        {"cid": cid, "total": float(sl_total), "score": score, "issues": json.dumps(scrub_issues)}
                    )
                    logger.info("Claim %s stays DRAFT (score=%d, %d errors, %d warnings)", claim_obj.claim_number, score, err_c, warn_c)
            except Exception:
                import traceback; traceback.print_exc()
                await db.execute(
                    text("UPDATE claims SET total_billed = :total WHERE id = :cid"),
                    {"cid": cid, "total": float(sl_total)}
                )
        except Exception as e:
            logger.warning("Auto-advance failed for claim %s: %s", claim_obj.id, e)
    await db.commit()

    # ── Auto-extract insurance + bulk rescrub for all newly imported claims ────────────
    # Spawn per-claim background tasks (non-blocking). Each task extracts insurance
    # from the card image AND re-scrubs the claim so scores are accurate after fill.
    # A final bulk rescrub task runs after all extractions to catch any stragglers.
    if _new_claims:
        import asyncio
        from routers.ai import auto_extract_insurance_for_claim
        _new_claim_ids = [c.id for c in _new_claims]
        for _bg_claim in _new_claims:
            asyncio.create_task(
                auto_extract_insurance_for_claim(_bg_claim.id),
                name=f"auto-extract-ins-{_bg_claim.id}",
            )
        logger.info("[auto-extract] Scheduled insurance extraction+rescrub for %d claims", len(_new_claims))

        async def _bulk_rescrub_pass(claim_ids: list) -> None:
            """Final bulk scrub pass after all per-claim extractions should be complete."""
            import asyncio as _aio
            await _aio.sleep(60)  # allow per-claim extraction tasks to finish
            from database import AsyncSessionLocal
            from routers.ai import scrub_claim
            from schemas import ScrubRequest as SR
            logger.info("[bulk-rescrub] Starting final scrub pass for %d claims", len(claim_ids))
            for cid in claim_ids:
                try:
                    async with AsyncSessionLocal() as _db:
                        await scrub_claim(SR(claim_id=cid), _db, None)  # type: ignore[arg-type]
                except Exception as _e:
                    logger.warning("[bulk-rescrub] claim %s: %s", cid, _e)
            logger.info("[bulk-rescrub] Done")

        asyncio.create_task(_bulk_rescrub_pass(_new_claim_ids), name="bulk-rescrub-post-extract")

    return PullBitacoraResponse(
        patients_found=len(parsed_patients),
        claims_created=claims_created,
        errors=errors,
    )


@router.get("/status")
async def vistanet_status(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Check if VistaNet credentials are configured."""
    vn_user, _, vn_loc = await _get_vistanet_creds(db)
    return {
        "configured": bool(vn_user),
        "base_url": VISTANET_BASE_URL,
        "location": vn_loc,
        "username": vn_user,
    }


@router.get("/config")
async def get_vistanet_config(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Get current VistaNet connection config (password masked)."""
    result = await db.execute(select(ClinicSettings).limit(1))
    settings = result.scalar_one_or_none()
    if settings and settings.vistanet_username:
        return {
            "connected": True,
            "username": settings.vistanet_username,
            "password_masked": "••••••••" if settings.vistanet_password else None,
            "location": settings.vistanet_location or VISTANET_LOCATION,
            "locations": VISTANET_LOCATIONS,
        }
    # Fallback to hardcoded
    return {
        "connected": bool(VISTANET_USER),
        "username": VISTANET_USER,
        "password_masked": "••••••••" if VISTANET_PASSWORD else None,
        "location": VISTANET_LOCATION,
        "locations": VISTANET_LOCATIONS,
    }


@router.post("/config")
async def save_vistanet_config(
    body: dict,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Save VistaNet credentials to clinic_settings."""
    result = await db.execute(select(ClinicSettings).limit(1))
    settings = result.scalar_one_or_none()
    if not settings:
        settings = ClinicSettings()
        db.add(settings)
        await db.flush()

    if body.get("username"):
        settings.vistanet_username = body["username"]
    if body.get("password"):
        settings.vistanet_password = encrypt_value(body["password"])
    if body.get("location"):
        settings.vistanet_location = body["location"]

    await db.commit()
    return {"status": "saved"}


@router.post("/disconnect")
async def disconnect_vistanet(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Clear VistaNet credentials."""
    result = await db.execute(select(ClinicSettings).limit(1))
    settings = result.scalar_one_or_none()
    if settings:
        settings.vistanet_username = None
        settings.vistanet_password = None
        settings.vistanet_location = None
        await db.commit()
    return {"status": "disconnected"}


@router.get("/attachments/{claim_id}")
async def list_claim_attachments(
    claim_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """List attachments for a claim."""
    result = await db.execute(
        select(ClaimAttachment).where(ClaimAttachment.claim_id == claim_id)
    )
    attachments = result.scalars().all()
    return [
        {
            "id": a.id,
            "filename": a.filename,
            "attachment_type": a.attachment_type,
            "url": f"/vistanet/attachments/{claim_id}/{a.filename}",
        }
        for a in attachments
    ]


@router.get("/attachments/{claim_id}/{filename}")
async def serve_attachment(
    claim_id: int,
    filename: str,
):
    """Serve an attachment file."""
    import pathlib
    from fastapi.responses import FileResponse

    # Sanitize filename to prevent path traversal
    safe_filename = pathlib.Path(filename).name
    file_path = pathlib.Path(ATTACHMENTS_DIR) / str(claim_id) / safe_filename

    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Attachment not found")

    return FileResponse(
        str(file_path),
        media_type="image/jpeg",
        filename=safe_filename,
    )
