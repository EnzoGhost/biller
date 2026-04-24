"""
Seed the database with realistic Puerto Rico optometry billing data.
Run: python seed.py
"""
import asyncio
from datetime import date, datetime, timedelta
import random
import string
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from database import init_db, AsyncSessionLocal
from models import (
    User, Provider, Payer, Patient, PatientInsurance,
    Claim, ServiceLine, Payment, Denial, AuditLog,
    ClaimStatus, Gender, UserRole, PayerType, SubmissionMethod
)
from auth import hash_password


PR_PAYERS = [
    {
        "name": "Triple-S Salud",
        "payer_id": "TSS",
        "payer_type": PayerType.COMMERCIAL,
        "submission_method": SubmissionMethod.STEDI,
        "stedi_payer_id": "VMJBW",
        "address_line1": "PO Box 363628",
        "city": "San Juan",
        "zip_code": "00936",
        "phone": "787-774-6060",
        "timely_filing_days": 180,
        "notes": "Largest commercial insurer in Puerto Rico. Stedi ID: VMJBW",
    },
    {
        "name": "MCS Healthcare",
        "payer_id": "MCS",
        "payer_type": PayerType.COMMERCIAL,
        "submission_method": SubmissionMethod.STEDI,
        "stedi_payer_id": "OLFKO",
        "address_line1": "PO Box 9023518",
        "city": "San Juan",
        "zip_code": "00902",
        "phone": "787-763-4949",
        "timely_filing_days": 180,
        "notes": "MCS Healthcare PR. Stedi ID: OLFKO",
    },
    {
        "name": "MMM Healthcare",
        "payer_id": "MMM",
        "payer_type": PayerType.MEDICARE,
        "submission_method": SubmissionMethod.STEDI,
        "stedi_payer_id": "DCURP",
        "address_line1": "PO Box 195009",
        "city": "San Juan",
        "zip_code": "00919",
        "phone": "787-774-6700",
        "timely_filing_days": 365,
        "notes": "Medicare Advantage plan in PR. Stedi ID: DCURP",
    },
    {
        "name": "First Medical Health Plan",
        "payer_id": "FMHP",
        "payer_type": PayerType.COMMERCIAL,
        "submission_method": SubmissionMethod.STEDI,
        "stedi_payer_id": "FMKIY",
        "address_line1": "PO Box 9023005",
        "city": "San Juan",
        "zip_code": "00902",
        "phone": "787-474-7474",
        "timely_filing_days": 180,
        "notes": "First Medical Health Plan. Stedi ID: FMKIY",
    },
    {
        "name": "Humana Puerto Rico",
        "payer_id": "HUMPR",
        "payer_type": PayerType.MEDICARE,
        "submission_method": SubmissionMethod.STEDI,
        "stedi_payer_id": "GZMSV",
        "address_line1": "500 W. Main Street",
        "city": "San Juan",
        "zip_code": "00918",
        "phone": "800-448-6262",
        "timely_filing_days": 365,
        "notes": "Humana Puerto Rico Medicare Advantage. Stedi ID: GZMSV",
    },
    {
        "name": "Medicare / Novitas Solutions",
        "payer_id": "MEDICARE",
        "payer_type": PayerType.MEDICARE,
        "submission_method": SubmissionMethod.STEDI,
        "stedi_payer_id": "KXVQE",
        "address_line1": "PO Box 3080",
        "city": "Mechanicsburg",
        "state": "PA",
        "zip_code": "17055",
        "phone": "855-252-8782",
        "timely_filing_days": 365,
        "notes": "Novitas Solutions is MAC for PR (J12). Medicare Part B.",
    },
    {
        "name": "Envolve Vision of Puerto Rico",
        "payer_id": "ENVOLVE",
        "payer_type": PayerType.VISION,
        "submission_method": SubmissionMethod.STEDI,
        "stedi_payer_id": "WSXQY",
        "address_line1": "PO Box 17367",
        "city": "Richmond",
        "state": "VA",
        "zip_code": "23226",
        "phone": "800-282-3232",
        "timely_filing_days": 365,
        "notes": "Vision carve-out TPA. Availity clearinghouse. Payer ID 56190. ~35% TPA fee.",
    },
    {
        "name": "Molina Healthcare of Puerto Rico",
        "payer_id": "MHPR",
        "payer_type": PayerType.MEDICAID,
        "submission_method": SubmissionMethod.INMEDIATA,
        "inmediata_payer_id": "MHPR1",
        "address_line1": "PO Box 29030",
        "city": "San Juan",
        "zip_code": "00929",
        "phone": "787-474-8300",
        "timely_filing_days": 365,
        "notes": "Medicaid managed care. Use Inmediata for EDI submission.",
    },
    {
        "name": "Plan de Salud del Gobierno (ASES/GHP)",
        "payer_id": "ASES",
        "payer_type": PayerType.MEDICAID,
        "submission_method": SubmissionMethod.INMEDIATA,
        "inmediata_payer_id": "ASES1",
        "address_line1": "PO Box 195009",
        "city": "San Juan",
        "zip_code": "00919",
        "phone": "787-474-3300",
        "timely_filing_days": 365,
        "notes": "Government Health Plan. Via Inmediata clearinghouse.",
    },
    {
        "name": "PMC Medicare Choice",
        "payer_id": "PMC",
        "payer_type": PayerType.MEDICARE,
        "submission_method": SubmissionMethod.STEDI,
        "stedi_payer_id": "PMC01",
        "address_line1": "PO Box 192296",
        "city": "San Juan",
        "zip_code": "00919",
        "phone": "787-993-3000",
        "timely_filing_days": 365,
        "notes": "PMC Medicare Choice PR",
    },
]

PR_PROVIDERS = [
    {
        "npi": "1234567893",  # Valid Luhn NPI
        "first_name": "José",
        "last_name": "Martínez",
        "specialty": "Optometry",
        "taxonomy_code": "152W00000X",
        "license_number": "OD-PR-1042",
        "address_line1": "Centro Médico Oftalmo, Suite 201",
        "city": "San Juan",
        "zip_code": "00918",
        "phone": "787-722-4000",
        "ein": "66-0654321",
    },
    {
        "npi": "1234567901",  # Valid Luhn NPI
        "first_name": "Carmen",
        "last_name": "Rodríguez",
        "specialty": "Ophthalmology",
        "taxonomy_code": "207W00000X",
        "license_number": "MD-PR-5512",
        "address_line1": "400 Av. Hostos, Edif. B",
        "city": "San Juan",
        "zip_code": "00918",
        "phone": "787-764-3000",
        "ein": "66-0123456",
    },
    {
        "npi": "1234567919",  # Valid Luhn NPI
        "first_name": "Miguel",
        "last_name": "Santos",
        "specialty": "Optometry",
        "taxonomy_code": "152W00000X",
        "license_number": "OD-PR-2201",
        "address_line1": "Plaza Carolina Mall, Local 45",
        "city": "Carolina",
        "zip_code": "00987",
        "phone": "787-768-5500",
        "ein": "66-0987654",
    },
]

PR_PATIENTS = [
    {
        "first_name": "Carlos",
        "last_name": "Rivera",
        "dob": date(1978, 6, 15),
        "gender": Gender.M,
        "phone": "787-555-1234",
        "email": "carlos.rivera@email.com",
        "address_line1": "Urb. San Francisco, Calle Almendro 45",
        "city": "San Juan",
        "zip_code": "00927",
        "payer_id_ref": "TSS",
        "member_id": "TSS-987654321",
        "group_number": "GRP-001",
    },
    {
        "first_name": "María",
        "last_name": "Ortiz",
        "dob": date(1990, 3, 22),
        "gender": Gender.F,
        "phone": "787-555-5678",
        "email": "maria.ortiz@gmail.com",
        "address_line1": "Cond. Torres de Madrid, Apt 5B",
        "city": "Guaynabo",
        "zip_code": "00969",
        "payer_id_ref": "MCS",
        "member_id": "MCS-123456789",
    },
    {
        "first_name": "Luis",
        "last_name": "González",
        "dob": date(1952, 11, 8),
        "gender": Gender.M,
        "phone": "787-555-9012",
        "address_line1": "HC-02 Box 15432",
        "city": "Bayamón",
        "zip_code": "00956",
        "payer_id_ref": "MEDICARE",
        "member_id": "1EG4-TE5-MK72",
    },
    {
        "first_name": "Lucía",
        "last_name": "Hernández",
        "dob": date(2005, 8, 30),
        "gender": Gender.F,
        "phone": "787-555-3456",
        "address_line1": "Urb. Villa del Rey, Calle 12 #23",
        "city": "Caguas",
        "zip_code": "00725",
        "payer_id_ref": "ASES",
        "member_id": "ASES-PR-456789",
    },
    {
        "first_name": "Roberto",
        "last_name": "Colón",
        "dob": date(1967, 4, 14),
        "gender": Gender.M,
        "phone": "787-555-7890",
        "address_line1": "Ave. Ponce de León 1200",
        "city": "Santurce",
        "zip_code": "00907",
        "payer_id_ref": "MMM",
        "member_id": "MMM-789012345",
    },
    {
        "first_name": "Ana",
        "last_name": "Ramírez",
        "dob": date(1960, 1, 19),
        "gender": Gender.F,
        "phone": "787-555-2233",
        "address_line1": "Calle Loíza 1845, Apt 3",
        "city": "San Juan",
        "zip_code": "00911",
        "payer_id_ref": "HUMPR",
        "member_id": "HUM-PR-334455",
    },
    {
        "first_name": "Pedro",
        "last_name": "Torres",
        "dob": date(1985, 9, 5),
        "gender": Gender.M,
        "phone": "787-555-6677",
        "address_line1": "Urb. Caparra Heights, Calle E-5",
        "city": "Guaynabo",
        "zip_code": "00968",
        "payer_id_ref": "FMHP",
        "member_id": "FMHP-556677",
    },
    {
        "first_name": "Isabel",
        "last_name": "Morales",
        "dob": date(1972, 12, 3),
        "gender": Gender.F,
        "phone": "787-555-8899",
        "address_line1": "Residencial Buen Consejo, Edif 12 Apt 4",
        "city": "San Juan",
        "zip_code": "00926",
        "payer_id_ref": "ENVOLVE",
        "member_id": "ENV-PR-998877",
    },
]

SAMPLE_CLAIMS = [
    # ── PAID claims with payment ──────────────────────────────────────────────
    {
        "patient_idx": 0,
        "provider_idx": 0,
        "payer_id_ref": "TSS",
        "service_date_from": date(2025, 1, 8),
        "diagnosis_codes": ["H52.11", "H52.223"],  # Myopia + Compound astigmatism
        "place_of_service": "11",
        "status": ClaimStatus.PAID,
        "service_lines": [
            {"cpt": "92004", "desc": "Comprehensive ophthalmological exam, new patient", "billed": 195.00, "paid": 155.00},
            {"cpt": "92015", "desc": "Determination of refractive state", "billed": 55.00, "paid": 45.00},
        ],
        "payment": {"check": "TSS-CHK-44521", "days_after": 28, "method": "eft"},
    },
    {
        "patient_idx": 1,
        "provider_idx": 0,
        "payer_id_ref": "MCS",
        "service_date_from": date(2025, 1, 15),
        "diagnosis_codes": ["H40.1130", "H40.1131"],  # Open-angle glaucoma
        "place_of_service": "11",
        "status": ClaimStatus.PAID,
        "service_lines": [
            {"cpt": "92014", "desc": "Comprehensive ophthalmological exam, established patient", "billed": 145.00, "paid": 118.00},
            {"cpt": "92083", "desc": "Visual field examination, bilateral", "billed": 180.00, "paid": 148.00},
            {"cpt": "92250", "desc": "Fundus photography with interpretation", "billed": 95.00, "paid": 78.00},
        ],
        "payment": {"check": "MCS-EFT-88921", "days_after": 32, "method": "eft"},
    },
    {
        "patient_idx": 2,
        "provider_idx": 1,
        "payer_id_ref": "MEDICARE",
        "service_date_from": date(2025, 1, 22),
        "diagnosis_codes": ["E11.3519", "H36.0"],  # Diabetic retinopathy
        "place_of_service": "11",
        "status": ClaimStatus.PAID,
        "service_lines": [
            {"cpt": "92014", "desc": "Comprehensive ophthalmological exam, established", "billed": 145.00, "paid": 105.00},
            {"cpt": "92228", "desc": "Remote imaging for diabetic retinopathy detection", "billed": 155.00, "paid": 112.00},
            {"cpt": "92250", "desc": "Fundus photography", "billed": 95.00, "paid": 68.00},
        ],
        "payment": {"check": "NOV-CHK-77342", "days_after": 45, "method": "check"},
    },
    # ── SUBMITTED claims ──────────────────────────────────────────────────────
    {
        "patient_idx": 3,
        "provider_idx": 0,
        "payer_id_ref": "ASES",
        "service_date_from": date(2025, 3, 5),
        "diagnosis_codes": ["H52.223", "H10.013"],  # Astigmatism + conjunctivitis
        "place_of_service": "11",
        "status": ClaimStatus.SUBMITTED,
        "service_lines": [
            {"cpt": "92012", "desc": "Ophthalmological exam, established patient, intermediate", "billed": 95.00},
            {"cpt": "92015", "desc": "Determination of refractive state", "billed": 55.00},
        ],
    },
    {
        "patient_idx": 4,
        "provider_idx": 1,
        "payer_id_ref": "MMM",
        "service_date_from": date(2025, 3, 12),
        "diagnosis_codes": ["H26.001", "H26.002"],  # Cataract
        "place_of_service": "11",
        "status": ClaimStatus.SUBMITTED,
        "service_lines": [
            {"cpt": "92004", "desc": "Comprehensive ophthalmological exam, new patient", "billed": 195.00},
            {"cpt": "92083", "desc": "Visual field examination", "billed": 180.00},
        ],
    },
    # ── DENIED claim ──────────────────────────────────────────────────────────
    {
        "patient_idx": 2,
        "provider_idx": 1,
        "payer_id_ref": "MEDICARE",
        "service_date_from": date(2025, 2, 3),
        "diagnosis_codes": ["Z01.00"],  # Eye exam without complaint — will trigger denial for 92015
        "place_of_service": "11",
        "status": ClaimStatus.DENIED,
        "service_lines": [
            {"cpt": "92015", "desc": "Determination of refractive state", "billed": 55.00},
            {"cpt": "92310", "desc": "Fitting of contact lens, aphakia, one eye", "billed": 145.00},
        ],
        "denial": {
            "code": "CO-96",
            "reason": "Non-covered charge: Routine refraction and contact lens fitting not covered by Medicare",
            "carc": "96",
            "rarc": "N130",
        },
    },
    # ── DRAFT claim ───────────────────────────────────────────────────────────
    {
        "patient_idx": 5,
        "provider_idx": 0,
        "payer_id_ref": "HUMPR",
        "service_date_from": date(2025, 3, 20),
        "diagnosis_codes": ["H35.30", "H35.31"],  # Age-related macular degeneration
        "place_of_service": "11",
        "status": ClaimStatus.DRAFT,
        "service_lines": [
            {"cpt": "92250", "desc": "Fundus photography", "billed": 95.00},
            {"cpt": "92134", "desc": "Scanning computerized ophthalmic diagnostic imaging, posterior", "billed": 175.00},
        ],
    },
    # ── ACCEPTED claim ────────────────────────────────────────────────────────
    {
        "patient_idx": 6,
        "provider_idx": 2,
        "payer_id_ref": "FMHP",
        "service_date_from": date(2025, 3, 15),
        "diagnosis_codes": ["H52.10", "H52.223"],  # Myopia
        "place_of_service": "11",
        "status": ClaimStatus.ACCEPTED,
        "service_lines": [
            {"cpt": "92004", "desc": "Comprehensive ophthalmological exam, new patient", "billed": 195.00},
            {"cpt": "92015", "desc": "Determination of refractive state", "billed": 55.00},
            {"cpt": "92310", "desc": "Fitting of spectacle lenses", "billed": 85.00},
        ],
    },
    # ── Vision (Envolve) claim ────────────────────────────────────────────────
    {
        "patient_idx": 7,
        "provider_idx": 0,
        "payer_id_ref": "ENVOLVE",
        "service_date_from": date(2025, 3, 10),
        "diagnosis_codes": ["H52.11", "H52.211"],  # Myopia + regular astigmatism
        "place_of_service": "11",
        "status": ClaimStatus.SUBMITTED,
        "service_lines": [
            {"cpt": "92004", "desc": "Comprehensive vision exam, new patient", "billed": 150.00},
            {"cpt": "92015", "desc": "Determination of refractive state", "billed": 45.00},
            {"cpt": "92310", "desc": "Contact lens fitting", "billed": 95.00},
        ],
    },
    # ── REJECTED claim that needs correction ─────────────────────────────────
    {
        "patient_idx": 0,
        "provider_idx": 0,
        "payer_id_ref": "TSS",
        "service_date_from": date(2025, 2, 20),
        "diagnosis_codes": ["H40.10X0"],  # Glaucoma
        "place_of_service": "11",
        "status": ClaimStatus.REJECTED,
        "service_lines": [
            {"cpt": "92083", "desc": "Visual field examination", "billed": 180.00},
            {"cpt": "92133", "desc": "Scanning laser ophthalmoscopy, anterior", "billed": 165.00},
        ],
        "denial": {
            "code": "PR-22",
            "reason": "Missing prior authorization number for this service",
            "carc": "22",
            "rarc": "N56",
        },
    },
    # ── Aging claim (>30 days submitted, no response) ─────────────────────────
    {
        "patient_idx": 1,
        "provider_idx": 0,
        "payer_id_ref": "MCS",
        "service_date_from": date(2025, 1, 30),
        "diagnosis_codes": ["H52.4", "H53.10"],  # Presbyopia + unspecified visual disturbance
        "place_of_service": "11",
        "status": ClaimStatus.SUBMITTED,
        "service_lines": [
            {"cpt": "92014", "desc": "Comprehensive ophthalmological exam, established", "billed": 145.00},
            {"cpt": "92015", "desc": "Determination of refractive state", "billed": 55.00},
        ],
    },
]


async def seed():
    await init_db()
    async with AsyncSessionLocal() as db:
        # Admin user
        existing_admin = await db.execute(select(User).where(User.email == "admin@biller.pr"))
        if not existing_admin.scalar_one_or_none():
            admin = User(
                email="admin@biller.pr",
                full_name="Administrador del Sistema",
                hashed_password=hash_password("Admin1234!"),
                role=UserRole.ADMIN,
            )
            db.add(admin)
            biller_user = User(
                email="biller@biller.pr",
                full_name="María Facturadora",
                hashed_password=hash_password("Biller1234!"),
                role=UserRole.BILLER,
            )
            db.add(biller_user)
            print("✓ Usuarios creados")

        # Payers
        payer_map = {}
        for p in PR_PAYERS:
            state = p.pop("state", "PR")
            existing = await db.execute(select(Payer).where(Payer.payer_id == p["payer_id"]))
            if not existing.scalar_one_or_none():
                payer = Payer(**p, state=state)
                db.add(payer)
                await db.flush()
                payer_map[p["payer_id"]] = payer.id
                print(f"  ✓ Pagador: {p['name']}")
            else:
                res = await db.execute(select(Payer).where(Payer.payer_id == p["payer_id"]))
                payer_map[p["payer_id"]] = res.scalar_one().id
            p["state"] = state  # restore

        # Providers
        provider_ids = []
        for prov in PR_PROVIDERS:
            existing = await db.execute(select(Provider).where(Provider.npi == prov["npi"]))
            if not existing.scalar_one_or_none():
                provider = Provider(**prov, state="PR")
                db.add(provider)
                await db.flush()
                provider_ids.append(provider.id)
                print(f"  ✓ Proveedor: Dr. {prov['first_name']} {prov['last_name']}")
            else:
                res = await db.execute(select(Provider).where(Provider.npi == prov["npi"]))
                provider_ids.append(res.scalar_one().id)

        await db.commit()

        # Patients
        patient_ids = []
        for pat_data in PR_PATIENTS:
            payer_ref = pat_data.pop("payer_id_ref")
            member_id = pat_data.pop("member_id")
            group_number = pat_data.pop("group_number", None)

            existing = await db.execute(
                select(Patient).where(
                    Patient.last_name == pat_data["last_name"],
                    Patient.dob == pat_data["dob"]
                )
            )
            if not existing.scalar_one_or_none():
                count_res = await db.execute(select(Patient))
                count = len(count_res.scalars().all())
                mrn = f"PR{str(count + 1).zfill(6)}"
                patient = Patient(mrn=mrn, state="PR", **pat_data)
                db.add(patient)
                await db.flush()

                payer_db_id = payer_map.get(payer_ref)
                if payer_db_id:
                    ins = PatientInsurance(
                        patient_id=patient.id,
                        payer_id=payer_db_id,
                        member_id=member_id,
                        group_number=group_number,
                        is_primary=True,
                    )
                    db.add(ins)

                patient_ids.append(patient.id)
                print(f"  ✓ Paciente: {pat_data['first_name']} {pat_data['last_name']}")
            else:
                res = await db.execute(
                    select(Patient).where(
                        Patient.last_name == pat_data["last_name"],
                        Patient.dob == pat_data["dob"]
                    )
                )
                patient_ids.append(res.scalar_one().id)
            pat_data["payer_id_ref"] = payer_ref
            pat_data["member_id"] = member_id

        await db.commit()

        # Claims
        for claim_data in SAMPLE_CLAIMS:
            pat_id = patient_ids[claim_data["patient_idx"]] if claim_data["patient_idx"] < len(patient_ids) else patient_ids[0]
            prov_id = provider_ids[claim_data["provider_idx"]] if claim_data["provider_idx"] < len(provider_ids) else provider_ids[0]
            payer_db_id = payer_map.get(claim_data["payer_id_ref"], list(payer_map.values())[0])

            ts = claim_data["service_date_from"].strftime("%Y%m%d")
            suffix = "".join(random.choices(string.ascii_uppercase + string.digits, k=6))
            claim_num = f"CLM-{ts}-{suffix}"

            total_billed = sum(sl["billed"] for sl in claim_data["service_lines"])
            total_paid = sum(sl.get("paid", 0.0) for sl in claim_data["service_lines"])
            sub_date = datetime.utcnow() if claim_data["status"] != ClaimStatus.DRAFT else None

            # For aging claims, backdate the submission
            if claim_data["service_date_from"] < date(2025, 2, 15):
                sub_date = datetime.combine(
                    claim_data["service_date_from"] + timedelta(days=3),
                    datetime.min.time()
                )

            claim = Claim(
                claim_number=claim_num,
                patient_id=pat_id,
                provider_id=prov_id,
                payer_id=payer_db_id,
                service_date_from=claim_data["service_date_from"],
                diagnosis_codes=claim_data["diagnosis_codes"],
                place_of_service=claim_data["place_of_service"],
                total_billed=total_billed,
                total_paid=total_paid,
                status=claim_data["status"],
                date_of_submission=sub_date,
                source="seed",
            )
            db.add(claim)
            await db.flush()

            for i, sl in enumerate(claim_data["service_lines"]):
                line = ServiceLine(
                    claim_id=claim.id,
                    line_number=i + 1,
                    cpt_code=sl["cpt"],
                    description=sl["desc"],
                    service_date=claim_data["service_date_from"],
                    place_of_service="11",
                    units=1,
                    billed_amount=sl["billed"],
                    paid_amount=sl.get("paid", 0.0),
                    diagnosis_pointers=[1],
                )
                db.add(line)

            # Payments for paid claims
            if claim_data["status"] == ClaimStatus.PAID and total_paid > 0:
                pmt_data = claim_data.get("payment", {})
                payment = Payment(
                    claim_id=claim.id,
                    check_number=pmt_data.get("check", f"CHK-{random.randint(100000, 999999)}"),
                    check_date=claim_data["service_date_from"] + timedelta(days=pmt_data.get("days_after", 28)),
                    payment_amount=total_paid,
                    adjustment_amount=round(total_billed - total_paid, 2),
                    payment_method=pmt_data.get("method", "eft"),
                    notes="Payment from seed data",
                )
                db.add(payment)

            # Denials for denied/rejected claims
            if claim_data["status"] in (ClaimStatus.DENIED, ClaimStatus.REJECTED):
                denial_data = claim_data.get("denial", {
                    "code": "CO-96",
                    "reason": "Non-covered service",
                    "carc": "96",
                    "rarc": "N130",
                })
                denial = Denial(
                    claim_id=claim.id,
                    denial_code=denial_data["code"],
                    denial_reason=denial_data["reason"],
                    denial_date=claim_data["service_date_from"] + timedelta(days=15),
                    carc_code=denial_data.get("carc"),
                    rarc_code=denial_data.get("rarc"),
                )
                db.add(denial)

            # Seed audit log entry
            audit = AuditLog(
                entity_type="claim",
                entity_id=claim.id,
                claim_id=claim.id,
                action="created",
                new_value=str(claim_data["status"]),
                notes="Seed data",
                created_at=datetime.combine(claim_data["service_date_from"], datetime.min.time()),
            )
            db.add(audit)

            print(f"  ✓ Reclamación: {claim_num} ({claim_data['status']}) — {claim_data['payer_id_ref']}")

        await db.commit()
        print("\n✅ Base de datos iniciada con datos de optometría PR")


if __name__ == "__main__":
    asyncio.run(seed())
