"""
Startup migration — ensures all required columns exist in the SQLite DB.
Runs on every app start. Safe to run multiple times (idempotent).
"""
import sqlite3
from config import settings


def run_startup_migration():
    """Add any missing columns to existing tables. SQLAlchemy create_all only creates new tables."""
    # Extract DB path from SQLAlchemy URL
    db_url = settings.DATABASE_URL
    if ":///" in db_url:
        db_path = db_url.split(":///")[-1]
    else:
        db_path = "biller.db"
    
    if db_path.startswith("./"):
        db_path = db_path[2:]

    conn = sqlite3.connect(db_path)
    
    # Define all required columns per table
    migrations = {
        "users": [
            ("is_super_admin", "ALTER TABLE users ADD COLUMN is_super_admin BOOLEAN DEFAULT 0"),
            ("organization_id", "ALTER TABLE users ADD COLUMN organization_id INTEGER"),
        ],
        "organizations": [
            ("is_active", "ALTER TABLE organizations ADD COLUMN is_active BOOLEAN DEFAULT 1"),
            ("stripe_customer_id", "ALTER TABLE organizations ADD COLUMN stripe_customer_id VARCHAR(100)"),
            ("notes", "ALTER TABLE organizations ADD COLUMN notes TEXT"),
        ],
        "claims": [
            ("provider_id", "ALTER TABLE claims ADD COLUMN provider_id INTEGER"),
        ],
        "patients": [
            ("provider_id", "ALTER TABLE patients ADD COLUMN provider_id INTEGER"),
        ],
        "fee_schedule": [
            ("provider_id", "ALTER TABLE fee_schedule ADD COLUMN provider_id INTEGER"),
        ],
        "payers": [
            ("provider_id", "ALTER TABLE payers ADD COLUMN provider_id INTEGER"),
        ],
        "payments": [
            ("provider_id", "ALTER TABLE payments ADD COLUMN provider_id INTEGER"),
        ],
        "clinic_settings": [
            ("angelwink_clinic_id", "ALTER TABLE clinic_settings ADD COLUMN angelwink_clinic_id VARCHAR(36)"),
            ("vistanet_url", "ALTER TABLE clinic_settings ADD COLUMN vistanet_url TEXT DEFAULT 'https://visualzone.vistanet.cloud'"),
        ],
        "provider_settings": [
            ("angelwink_clinic_id", "ALTER TABLE provider_settings ADD COLUMN angelwink_clinic_id VARCHAR(36)"),
        ],
    }

    for table, columns in migrations.items():
        try:
            existing = [c[1] for c in conn.execute(f"PRAGMA table_info({table})").fetchall()]
        except Exception:
            continue  # Table doesn't exist yet, create_all will handle it
        
        for col_name, sql in columns:
            if col_name not in existing:
                try:
                    conn.execute(sql)
                    print(f"[startup_migration] Added {col_name} to {table}")
                except Exception as e:
                    print(f"[startup_migration] Warning: {e}")
    
    conn.commit()
    conn.close()
    print("[startup_migration] Complete")
