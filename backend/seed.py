"""
Seed the database with realistic Puerto Rico medical billing data.
Run: python seed.py
"""
import asyncio
from datetime import date, datetime, timedelta
import random
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from database import init_db, AsyncSessionLocal
from models import (
    User, Provider, Payer, Patient, PatientInsurance,
    Claim, ServiceLine, Payment, Denial,
    ClaimStatus, Gender, UserRole, PayerType, SubmissionMethod
)
from auth import hash_password


PR_PAYERS = [
    {
        "name": "Triple-S Salud",
        "payer_id": "TSS",
        "payer_type": PayerType.COMMERCIAL,
        "submission_method": SubmissionMethod.STEDI,
        "stedi_payer_id": "SB560",
        "address_line1": "PO Box 363628",
        "city": "San Juan",
        "zip_code": "00936",
        "phone": "787-774-6060",
        "timely_filing_days": 90,
        "notes": "Largest commercial insurer in Puerto Rico",
    },
    {
        "name": "MCS Healthcare",
        "payer_id": "MCS",
        "payer_type": PayerType.COMMERCIAL,
        "submission_method": SubmissionMethod.STEDI,
        "stedi_payer_id": "MCS01",
        "address_line1": "PO Box 9023518",
        "city": "San Juan",
        "zip_code": "00902",
        "phone": "787-763-4949",
        "timely_filing_days": 90,
    },
    {
        "name": "MMM Healthcare",
        "payer_id": "MMM",
        "payer_type": PayerType.MEDICARE,
        "submission_method": SubmissionMethod.STEDI,
        "stedi_payer_id": "MMM01",
        "address_line1": "PO Box 195009",
        "city": "San Juan",
        "zip_code": "00919",
        "phone": "787-774-6700",
        "timely_filing_days": 90,
        "notes": "Medicare Advantage plan in PR",
    },
    {
        "name": "First Medical Health Plan",
        "payer_id": "FMHP",
        "payer_type": PayerType.COMMERCIAL,
        "submission_method": SubmissionMethod.STEDI,
        "stedi_payer_id": "FMHP1",
        "address_line1": "PO Box 9023005",
        "city": "San Juan",
        "zip_code": "00902",
        "phone": "787-474-7474",
        "timely_filing_days": 90,
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
        "notes": "Medicaid managed care; use Inmediata for EDI",
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
        "timely_filing_days": 90,
    },
    {
        "name": "VSP Vision Care",
        "payer_id": "VSP",
        "payer_type": PayerType.VISION,
        "submission_method": SubmissionMethod.STEDI,
        "stedi_payer_id": "39026",
        "address_line1": "3333 Quality Drive",
        "city": "Rancho Cordova",
        "zip_code": "95670",
        "phone": "800-877-7195",
        "timely_filing_days": 365,
    },
    {
        "name": "EyeMed Vision Care",
        "payer_id": "EYEMED",
        "payer_type": PayerType.VISION,
        "submission_method": SubmissionMethod.STEDI,
        "stedi_payer_id": "EYEMED",
        "address_line1": "4000 Luxottica Place",
        "city": "Mason",
        "state": "OH",
        "zip_code": "45040",
        "phone": "888-581-3648",
        "timely_filing_days": 365,
    },
    {
        "name": "Medicare / Novitas Solutions",
        "payer_id": "MEDICARE",
        "payer_type": PayerType.MEDICARE,
        "submission_method": SubmissionMethod.STEDI,
        "stedi_payer_id": "12B18",
        "address_line1": "PO Box 3080",
        "city": "Mechanicsburg",
        "state": "PA",
        "zip_code": "17055",
        "phone": "855-252-8782",
        "timely_filing_days": 365,
        "notes": "Novitas Solutions is MAC for PR (J12)",
    },
    {
        "name": "Medicaid / Plan de Salud del Gobierno (GHP)",
        "payer_id": "ASES",
        "payer_type": PayerType.MEDICAID,
        "submission_method": SubmissionMethod.INMEDIATA,
        "inmediata_payer_id": "ASES1",
        "address_line1": "PO Box 195009",
        "city": "San Juan",
        "zip_code": "00919",
        "phone": "787-474-3300",
        "timely_filing_days": 365,
        "notes": "Government Health Plan administered through managed care organizations",
    },
]

PR_PROVIDERS = [
    {
        "npi": "1234567890",
        "first_name": "Carmen",
        "last_name": "Rodríguez",
        "specialty": "Internal Medicine",
        "taxonomy_code": "207R00000X",
        "license_number": "PR-21234",
        "address_line1": "400 Av. Hostos",
        "city": "San Juan",
        "zip_code": "00918",
        "phone": "787-764-3000",
        "ein": "66-0123456",
    },
    {
        "npi": "0987654321",
        "first_name": "José",
        "last_name": "Martínez",
        "specialty": "Optometry",
        "taxonomy_code": "152W00000X",
        "license_number": "PR-OD-0056",
        "address_line1": "200 Calle Fortaleza",
        "city": "San Juan",
        "zip_code": "00901",
        "phone": "787-722-4000",
        "ein": "66-0654321",
    },
    {
        "npi": "1122334455",
        "first_name": "Ana",
        "last_name": "González",
        "specialty": "Psychology",
        "taxonomy_code": "103TC0700X",
        "license_number": "PR-PSYC-1234",
        "address_line1": "Centro Médico, Edif. A",
        "city": "Río Piedras",
        "zip_code": "00921",
        "phone": "787-758-2000",
        "ein": "66-0789012",
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
        "dob": date(1955, 11, 8),
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
]

SAMPLE_CLAIMS = [
    {
        "patient_idx": 0,
        "provider_idx": 0,
        "payer_id_ref": "TSS",
        "service_date_from": date(2025, 3, 10),
        "diagnosis_codes": ["J06.9", "J30.1"],
        "place_of_service": "11",
        "status": ClaimStatus.PAID,
        "service_lines": [
            {"cpt": "99213", "desc": "Office visit, established patient", "billed": 150.00, "paid": 120.00},
            {"cpt": "94640", "desc": "Inhalation treatment", "billed": 85.00, "paid": 70.00},
        ],
    },
    {
        "patient_idx": 1,
        "provider_idx": 0,
        "payer_id_ref": "MCS",
        "service_date_from": date(2025, 3, 15),
        "diagnosis_codes": ["E11.9", "I10"],
        "place_of_service": "11",
        "status": ClaimStatus.SUBMITTED,
        "service_lines": [
            {"cpt": "99214", "desc": "Office visit, established, moderate complexity", "billed": 200.00},
            {"cpt": "82947", "desc": "Glucose; quantitative, blood (except reagent strip)", "billed": 28.00},
            {"cpt": "85025", "desc": "Blood count; complete (CBC)", "billed": 45.00},
        ],
    },
    {
        "patient_idx": 2,
        "provider_idx": 0,
        "payer_id_ref": "MEDICARE",
        "service_date_from": date(2025, 3, 8),
        "diagnosis_codes": ["I10", "E78.5", "Z87.39"],
        "place_of_service": "11",
        "status": ClaimStatus.DENIED,
        "service_lines": [
            {"cpt": "99215", "desc": "Office visit, high complexity", "billed": 280.00},
            {"cpt": "93000", "desc": "Electrocardiogram, routine", "billed": 95.00},
        ],
    },
    {
        "patient_idx": 3,
        "provider_idx": 2,
        "payer_id_ref": "ASES",
        "service_date_from": date(2025, 3, 20),
        "diagnosis_codes": ["F41.1", "F32.1"],
        "place_of_service": "11",
        "status": ClaimStatus.DRAFT,
        "service_lines": [
            {"cpt": "90837", "desc": "Psychotherapy, 60 minutes", "billed": 175.00},
        ],
    },
    {
        "patient_idx": 4,
        "provider_idx": 1,
        "payer_id_ref": "MMM",
        "service_date_from": date(2025, 3, 12),
        "diagnosis_codes": ["H52.4", "H52.13"],
        "place_of_service": "11",
        "status": ClaimStatus.ACCEPTED,
        "service_lines": [
            {"cpt": "92004", "desc": "Ophthalmological examination, new patient", "billed": 210.00},
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
            existing = await db.execute(select(Payer).where(Payer.payer_id == p["payer_id"]))
            if not existing.scalar_one_or_none():
                payer = Payer(**{k: v for k, v in p.items() if k != "state"}, state=p.get("state", "PR"))
                db.add(payer)
                await db.flush()
                payer_map[p["payer_id"]] = payer.id
                print(f"  ✓ Pagador: {p['name']}")
            else:
                res = await db.execute(select(Payer).where(Payer.payer_id == p["payer_id"]))
                payer_map[p["payer_id"]] = res.scalar_one().id

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

        await db.commit()

        # Claims
        import string
        for claim_data in SAMPLE_CLAIMS:
            pat_id = patient_ids[claim_data["patient_idx"]] if claim_data["patient_idx"] < len(patient_ids) else patient_ids[0]
            prov_id = provider_ids[claim_data["provider_idx"]] if claim_data["provider_idx"] < len(provider_ids) else provider_ids[0]
            payer_db_id = payer_map.get(claim_data["payer_id_ref"], list(payer_map.values())[0])

            ts = claim_data["service_date_from"].strftime("%Y%m%d")
            suffix = "".join(random.choices(string.ascii_uppercase + string.digits, k=6))
            claim_num = f"CLM-{ts}-{suffix}"

            total_billed = sum(sl["billed"] for sl in claim_data["service_lines"])
            total_paid = sum(sl.get("paid", 0.0) for sl in claim_data["service_lines"])

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
                date_of_submission=datetime.utcnow() if claim_data["status"] != ClaimStatus.DRAFT else None,
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

            # Add payment for paid claims
            if claim_data["status"] == ClaimStatus.PAID and total_paid > 0:
                payment = Payment(
                    claim_id=claim.id,
                    check_number=f"CHK-{random.randint(100000, 999999)}",
                    check_date=claim_data["service_date_from"] + timedelta(days=25),
                    payment_amount=total_paid,
                    adjustment_amount=total_billed - total_paid,
                    payment_method="eft",
                )
                db.add(payment)

            # Add denial for denied claims
            if claim_data["status"] == ClaimStatus.DENIED:
                denial = Denial(
                    claim_id=claim.id,
                    denial_code="CO-4",
                    denial_reason="El servicio/procedimiento/equipo no está cubierto",
                    denial_date=claim_data["service_date_from"] + timedelta(days=15),
                    carc_code="4",
                    rarc_code="N130",
                )
                db.add(denial)

            print(f"  ✓ Reclamación: {claim_num} ({claim_data['status']})")

        await db.commit()
        print("\n✅ Base de datos iniciada con datos de Puerto Rico")


if __name__ == "__main__":
    asyncio.run(seed())
