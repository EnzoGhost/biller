"""
Migration: Add organizations table, is_super_admin and organization_id to users.
Also creates default organization and seeds super admin user if env vars are set.

Run: cd biller/backend && python migrations/add_admin_tables.py

Env vars for seeding:
  SUPER_ADMIN_EMAIL    (default: admin@angelclaims.app)
  SUPER_ADMIN_PASSWORD (default: changeme123)
"""
import asyncio
import os
import sys
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import bcrypt
from sqlalchemy import text
from database import init_db, AsyncSessionLocal


async def run():
    await init_db()

    async with AsyncSessionLocal() as db:
        # 1. Create organizations table
        await db.execute(text("""
            CREATE TABLE IF NOT EXISTS organizations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name VARCHAR(255) NOT NULL,
                slug VARCHAR(100) UNIQUE,
                subscription_tier VARCHAR(20) DEFAULT 'free',
                subscription_expires_at DATETIME,
                is_active BOOLEAN DEFAULT 1,
                stripe_customer_id VARCHAR(100),
                notes TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """))

        # 2. Add columns to users (ignore if already exist)
        for col_sql in [
            "ALTER TABLE users ADD COLUMN is_super_admin BOOLEAN DEFAULT 0",
            "ALTER TABLE users ADD COLUMN organization_id INTEGER REFERENCES organizations(id)",
        ]:
            try:
                await db.execute(text(col_sql))
                print(f"  ✓ {col_sql[:60]}...")
            except Exception as e:
                if "duplicate column" in str(e).lower() or "already exists" in str(e).lower():
                    print(f"  – Column already exists, skipping")
                else:
                    print(f"  ! Warning: {e}")

        await db.commit()
        print("✓ Schema migration complete")

        # 3. Seed default organization (if none exist)
        result = await db.execute(text("SELECT COUNT(*) FROM organizations"))
        org_count = result.scalar()
        if org_count == 0:
            await db.execute(text("""
                INSERT INTO organizations (name, slug, subscription_tier, is_active)
                VALUES ('AngelClaims', 'angelclaims', 'enterprise', 1)
            """))
            await db.commit()
            print("✓ Created default organization: AngelClaims")

        # 4. Seed super admin user
        admin_email = os.environ.get("SUPER_ADMIN_EMAIL", "admin@angelclaims.app")
        admin_password = os.environ.get("SUPER_ADMIN_PASSWORD", "changeme123")

        result = await db.execute(
            text("SELECT id FROM users WHERE email = :email"),
            {"email": admin_email},
        )
        existing = result.scalar_one_or_none()

        if existing:
            await db.execute(
                text("UPDATE users SET is_super_admin = 1 WHERE email = :email"),
                {"email": admin_email},
            )
            await db.commit()
            print(f"✓ Promoted existing user to super admin: {admin_email}")
        else:
            hashed = bcrypt.hashpw(admin_password.encode(), bcrypt.gensalt()).decode()
            await db.execute(
                text("""
                    INSERT INTO users (email, full_name, hashed_password, role, is_active, is_super_admin, created_at, updated_at)
                    VALUES (:email, 'Super Admin', :hashed, 'admin', 1, 1, :now, :now)
                """),
                {"email": admin_email, "hashed": hashed, "now": datetime.utcnow()},
            )
            await db.commit()
            print(f"✓ Created super admin: {admin_email} / {admin_password}")
            print("  ⚠️  Change this password immediately after first login!")


if __name__ == "__main__":
    asyncio.run(run())
