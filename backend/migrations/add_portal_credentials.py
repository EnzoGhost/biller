"""
Migration: Add portal credential columns to clinic_settings
and encrypt existing plaintext vistanet passwords.

Run:  python migrations/add_portal_credentials.py
"""
import sqlite3
import sys
import os

# Resolve DB path — same logic as config.py default
DB_PATH = os.environ.get("BILLER_DB_PATH", os.path.join(os.path.dirname(__file__), "..", "angelclaims.db"))
DB_PATH = os.path.abspath(DB_PATH)

NEW_COLUMNS = [
    # (column_name, column_type, default)
    ("ivision_url", "VARCHAR(500)", None),
    ("ivision_username", "VARCHAR(100)", None),
    ("ivision_password", "VARCHAR(255)", None),
    ("envolve_url", "VARCHAR(500)", None),
    ("envolve_username", "VARCHAR(100)", None),
    ("envolve_password", "VARCHAR(255)", None),
    ("triples_url", "VARCHAR(500)", None),
    ("triples_username", "VARCHAR(100)", None),
    ("triples_password", "VARCHAR(255)", None),
    ("innovamd_url", "VARCHAR(500)", None),
    ("innovamd_username", "VARCHAR(100)", None),
    ("innovamd_password", "VARCHAR(255)", None),
]


def migrate():
    if not os.path.exists(DB_PATH):
        print(f"DB not found at {DB_PATH} — skipping (will be created by app)")
        return

    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()

    # Get existing columns
    cur.execute("PRAGMA table_info(clinic_settings)")
    existing = {row[1] for row in cur.fetchall()}

    added = 0
    for col_name, col_type, default in NEW_COLUMNS:
        if col_name not in existing:
            default_clause = f" DEFAULT {default!r}" if default is not None else ""
            sql = f"ALTER TABLE clinic_settings ADD COLUMN {col_name} {col_type}{default_clause}"
            cur.execute(sql)
            added += 1
            print(f"  Added column: {col_name}")

    if added == 0:
        print("  All portal columns already exist — nothing to do.")

    # Encrypt existing plaintext vistanet_password values
    try:
        # Import from the backend package
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
        from config import encrypt_value, decrypt_value

        cur.execute("SELECT id, vistanet_password FROM clinic_settings WHERE vistanet_password IS NOT NULL AND vistanet_password != ''")
        rows = cur.fetchall()
        encrypted_count = 0
        for row_id, pwd in rows:
            # Check if already encrypted (Fernet tokens start with 'gAAAAA')
            if pwd and not pwd.startswith("gAAAAA"):
                enc = encrypt_value(pwd)
                cur.execute("UPDATE clinic_settings SET vistanet_password = ? WHERE id = ?", (enc, row_id))
                encrypted_count += 1
        if encrypted_count:
            print(f"  Encrypted {encrypted_count} existing plaintext password(s).")
        else:
            print("  No plaintext passwords to encrypt.")
    except Exception as e:
        print(f"  Warning: Could not encrypt existing passwords: {e}")
        print("  They will be encrypted on next save.")

    conn.commit()
    conn.close()
    print("Migration complete.")


if __name__ == "__main__":
    print(f"Running migration on {DB_PATH}")
    migrate()
