"""
Migration: Fix payer routing to INMEDIATA, add is_reforma column, insert missing PR payers.
Run: cd biller/backend && python migrations/add_payers_and_fix_routing.py
"""
import asyncio
import sys
import os
from datetime import datetime

# Add parent dir to path so we can import our modules
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text
from database import init_db, AsyncSessionLocal


MISSING_PAYERS = [
    {
        "name": "Triple-S Advantage",
        "payer_id": "TSSA",
        "payer_type": "medicare",
        "submission_method": "inmediata",
        "is_reforma": False,
        "timely_filing_days": 365,
        "city": "San Juan",
        "state": "PR",
        "zip_code": "00936",
        "phone": "787-774-6060",
        "notes": "Triple-S Medicare Advantage plan. Submit via Inmediata.",
    },
    {
        "name": "Triple-S Vital",
        "payer_id": "TSSV",
        "payer_type": "medicaid",
        "submission_method": "inmediata",
        "is_reforma": True,
        "timely_filing_days": 365,
        "city": "San Juan",
        "state": "PR",
        "zip_code": "00936",
        "phone": "787-774-6060",
        "notes": "Triple-S Vital (Reforma/Medicaid). Submit via Inmediata.",
    },
    {
        "name": "First Medical Vital",
        "payer_id": "FMVITAL",
        "payer_type": "medicaid",
        "submission_method": "inmediata",
        "is_reforma": True,
        "timely_filing_days": 365,
        "city": "San Juan",
        "state": "PR",
        "zip_code": "00902",
        "phone": "787-474-7474",
        "notes": "First Medical Vital (Reforma/Medicaid). Submit via Inmediata.",
    },
    {
        "name": "MMM Multi Health / MMM Vital",
        "payer_id": "MMMVITAL",
        "payer_type": "medicaid",
        "submission_method": "inmediata",
        "is_reforma": True,
        "timely_filing_days": 365,
        "city": "San Juan",
        "state": "PR",
        "zip_code": "00919",
        "phone": "787-774-6700",
        "notes": "MMM Multi Health / Vital (Reforma/Medicaid). Submit via Inmediata.",
    },
    {
        "name": "Plan de Salud Menonita",
        "payer_id": "MENONITA",
        "payer_type": "commercial",
        "submission_method": "inmediata",
        "is_reforma": False,
        "timely_filing_days": 180,
        "city": "Aibonito",
        "state": "PR",
        "zip_code": "00705",
        "notes": "Plan de Salud Menonita (Commercial). Submit via Inmediata.",
    },
    {
        "name": "Plan de Salud Menonita Vital",
        "payer_id": "MENONITAV",
        "payer_type": "medicaid",
        "submission_method": "inmediata",
        "is_reforma": True,
        "timely_filing_days": 365,
        "city": "Aibonito",
        "state": "PR",
        "zip_code": "00705",
        "notes": "Plan de Salud Menonita Vital (Reforma/Medicaid). Submit via Inmediata.",
    },
    {
        "name": "MCS Classicare",
        "payer_id": "MCSMC",
        "payer_type": "medicare",
        "submission_method": "inmediata",
        "is_reforma": False,
        "timely_filing_days": 365,
        "city": "San Juan",
        "state": "PR",
        "zip_code": "00902",
        "phone": "787-763-4949",
        "notes": "MCS Classicare (Medicare Advantage). Submit via Inmediata.",
    },
    {
        "name": "MAPFRE / Aetna PR",
        "payer_id": "MAPFRE",
        "payer_type": "commercial",
        "submission_method": "inmediata",
        "is_reforma": False,
        "timely_filing_days": 180,
        "city": "San Juan",
        "state": "PR",
        "zip_code": "00926",
        "notes": "MAPFRE / Aetna Puerto Rico (Commercial). Submit via Inmediata.",
    },
]


async def migrate():
    await init_db()
    async with AsyncSessionLocal() as db:
        # 1. Add is_reforma column if not exists
        try:
            await db.execute(text("ALTER TABLE payers ADD COLUMN is_reforma BOOLEAN DEFAULT 0"))
            await db.commit()
            print("✓ Added is_reforma column to payers")
        except Exception:
            await db.rollback()
            print("  is_reforma column already exists, skipping")

        # 2. Update ALL existing payers to submission_method='inmediata' (except Envolve — just update notes)
        await db.execute(text("""
            UPDATE payers
            SET submission_method = 'inmediata'
            WHERE payer_id != 'ENVOLVE'
        """))
        # Update Envolve notes only
        await db.execute(text("""
            UPDATE payers
            SET notes = 'Vision carve-out TPA. Availity clearinghouse. Payer ID 56190. ~35% TPA fee. Keep as Stedi/Availity for now.'
            WHERE payer_id = 'ENVOLVE'
        """))
        await db.commit()
        print("✓ Updated all payers to submission_method=INMEDIATA (except Envolve)")

        # 3. Insert missing payers
        for p in MISSING_PAYERS:
            # Check if already exists
            result = await db.execute(
                text("SELECT id FROM payers WHERE payer_id = :pid"),
                {"pid": p["payer_id"]}
            )
            if result.scalar_one_or_none():
                print(f"  Payer {p['name']} already exists, skipping")
                continue

            await db.execute(text("""
                INSERT INTO payers (name, payer_id, payer_type, submission_method, is_reforma,
                                    timely_filing_days, city, state, zip_code, phone, notes, is_active, created_at)
                VALUES (:name, :payer_id, :payer_type, :submission_method, :is_reforma,
                        :timely_filing_days, :city, :state, :zip_code, :phone, :notes, 1, :created_at)
            """), {
                "name": p["name"],
                "payer_id": p["payer_id"],
                "payer_type": p["payer_type"],
                "submission_method": p["submission_method"],
                "is_reforma": p["is_reforma"],
                "timely_filing_days": p["timely_filing_days"],
                "city": p["city"],
                "state": p["state"],
                "zip_code": p["zip_code"],
                "phone": p.get("phone"),
                "notes": p["notes"],
                "created_at": datetime.utcnow().isoformat(),
            })
            print(f"  ✓ Inserted: {p['name']}")

        await db.commit()

        # 4. Set is_reforma=TRUE for Reforma/Vital payers (including any that existed before)
        reforma_ids = ["TSSV", "FMVITAL", "MMMVITAL", "MENONITAV"]
        for pid in reforma_ids:
            await db.execute(
                text("UPDATE payers SET is_reforma = 1 WHERE payer_id = :pid"),
                {"pid": pid}
            )
        # Also set for existing Medicaid payers that are reforma
        await db.execute(text("""
            UPDATE payers SET is_reforma = 1
            WHERE payer_id IN ('ASES', 'MHPR')
        """))
        await db.commit()
        print("✓ Set is_reforma=TRUE for Reforma payers")

        # Verify
        result = await db.execute(text("SELECT payer_id, name, submission_method, is_reforma FROM payers ORDER BY name"))
        rows = result.fetchall()
        print(f"\n📋 Final payer list ({len(rows)} payers):")
        for r in rows:
            reforma_tag = " [REFORMA]" if r[3] else ""
            print(f"  {r[0]:12s} | {r[2]:10s} | {r[1]}{reforma_tag}")

        print("\n✅ Migration complete!")


if __name__ == "__main__":
    asyncio.run(migrate())
