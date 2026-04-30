"""
Seed the fee_schedule table with Medicare baseline rates for PR locality.
Run after the table is created (init_db handles CREATE TABLE via SQLAlchemy).

Usage:
    cd backend && python -m migrations.seed_fee_schedule
"""
import asyncio
import sys
import os

# Ensure backend dir is on path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import select
from database import AsyncSessionLocal
from models import FeeScheduleEntry

MEDICARE_PR_RATES = [
    ("92002", "Ophthalmological services, new patient, intermediate", 78.00, "exam"),
    ("92004", "Ophthalmological services, new patient, comprehensive", 128.00, "exam"),
    ("92012", "Ophthalmological services, established, intermediate", 58.00, "exam"),
    ("92014", "Ophthalmological services, established, comprehensive", 93.00, "exam"),
    ("92015", "Refraction", 38.00, "exam"),
    ("92081", "Visual field exam, limited", 32.00, "diagnostic"),
    ("92082", "Visual field exam, intermediate", 43.00, "diagnostic"),
    ("92083", "Visual field exam, extended", 54.00, "diagnostic"),
    ("92132", "OCT, anterior segment", 35.00, "diagnostic"),
    ("92133", "OCT, optic nerve", 38.00, "diagnostic"),
    ("92134", "OCT, retina", 38.00, "diagnostic"),
    ("92250", "Fundus photography", 43.00, "diagnostic"),
    ("92020", "Gonioscopy", 22.00, "diagnostic"),
    ("92100", "Tonometry", 16.00, "diagnostic"),
    ("92310", "CL fitting, corneal, both eyes", 68.00, "contacts"),
    ("92311", "CL fitting, corneal, one eye", 48.00, "contacts"),
    ("92312", "CL fitting, corneal, bilateral", 68.00, "contacts"),
    ("92313", "CL fitting, keratoconus", 78.00, "contacts"),
    ("92314", "Rx of contact lens, per lens", 32.00, "contacts"),
    ("V2020", "Frame", 0.00, "materials"),
    ("V2100", "Sphere, single vision", 0.00, "materials"),
    ("V2200", "Sphere, bifocal", 0.00, "materials"),
    ("V2300", "Sphere, trifocal", 0.00, "materials"),
]


async def seed():
    async with AsyncSessionLocal() as db:
        inserted = 0
        skipped = 0
        for cpt_code, description, allowed_amount, category in MEDICARE_PR_RATES:
            # Check if already exists (payer_id=NULL + cpt_code)
            result = await db.execute(
                select(FeeScheduleEntry).where(
                    FeeScheduleEntry.payer_id.is_(None),
                    FeeScheduleEntry.cpt_code == cpt_code,
                )
            )
            existing = result.scalar_one_or_none()
            if existing:
                skipped += 1
                continue

            entry = FeeScheduleEntry(
                payer_id=None,
                cpt_code=cpt_code,
                description=description,
                allowed_amount=allowed_amount,
                category=category,
                source="medicare",
            )
            db.add(entry)
            inserted += 1

        await db.commit()
        print(f"Fee schedule seeded: {inserted} inserted, {skipped} skipped (already exist).")


if __name__ == "__main__":
    asyncio.run(seed())
