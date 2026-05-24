"""Multi-tenancy: organizations, org_users, provider_credentials, provider_settings.
Add organization_id to providers, provider_id to patients/fee_schedule/prior_auths.
Migrate existing data to default Test Organization.

Revision ID: 001_multitenancy
Revises:
Create Date: 2026-05-23
"""
from __future__ import annotations
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from datetime import datetime

revision: str = "001_multitenancy"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()

    # ── 1. Create organizations table ────────────────────────────────────────
    op.create_table(
        "organizations",
        sa.Column("id", sa.Integer, primary_key=True, index=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("slug", sa.String(100), unique=True, nullable=False),
        sa.Column("subscription_tier", sa.String(20), nullable=False, server_default="free"),
        sa.Column("subscription_status", sa.String(20), nullable=False, server_default="trial"),
        sa.Column("subscription_expires_at", sa.DateTime, nullable=True),
        sa.Column("max_providers", sa.Integer, nullable=False, server_default="5"),
        sa.Column("created_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
    )

    # ── 2. Create org_users table ────────────────────────────────────────────
    op.create_table(
        "org_users",
        sa.Column("id", sa.Integer, primary_key=True, index=True),
        sa.Column("organization_id", sa.Integer, sa.ForeignKey("organizations.id"), nullable=False, index=True),
        sa.Column("user_id", sa.Integer, sa.ForeignKey("users.id"), nullable=False, index=True),
        sa.Column("role", sa.String(20), nullable=False, server_default="biller"),
        sa.Column("invited_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
        sa.Column("accepted_at", sa.DateTime, nullable=True),
        sa.UniqueConstraint("organization_id", "user_id", name="uq_org_user"),
    )

    # ── 3. Add organization_id to providers ───────────────────────────────────
    op.add_column("providers", sa.Column("organization_id", sa.Integer, sa.ForeignKey("organizations.id"), nullable=True))
    op.create_index("ix_providers_organization_id", "providers", ["organization_id"])

    # ── 4. Create provider_settings table ─────────────────────────────────────
    op.create_table(
        "provider_settings",
        sa.Column("id", sa.Integer, primary_key=True, index=True),
        sa.Column("provider_id", sa.Integer, sa.ForeignKey("providers.id"), unique=True, nullable=False),
        sa.Column("clinic_name", sa.String(255), nullable=True),
        sa.Column("address_line1", sa.String(255), nullable=True),
        sa.Column("address_line2", sa.String(100), nullable=True),
        sa.Column("city", sa.String(100), nullable=True),
        sa.Column("state", sa.String(2), nullable=False, server_default="PR"),
        sa.Column("zip_code", sa.String(10), nullable=True),
        sa.Column("phone", sa.String(20), nullable=True),
        sa.Column("tax_id", sa.String(20), nullable=True),
        sa.Column("npi_org", sa.String(10), nullable=True),
        sa.Column("payer_enrollments", sa.JSON, nullable=True),
        sa.Column("setup_complete", sa.Boolean, nullable=False, server_default="0"),
        sa.Column("angelwink_clinic_id", sa.String(36), nullable=True),
        sa.Column("created_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
    )

    # ── 5. Create provider_credentials table ──────────────────────────────────
    op.create_table(
        "provider_credentials",
        sa.Column("id", sa.Integer, primary_key=True, index=True),
        sa.Column("provider_id", sa.Integer, sa.ForeignKey("providers.id"), nullable=False, index=True),
        sa.Column("credential_type", sa.String(20), nullable=False),
        sa.Column("url", sa.String(500), nullable=True),
        sa.Column("username", sa.String(100), nullable=True),
        sa.Column("password_encrypted", sa.String(500), nullable=True),
        sa.Column("extra_json", sa.JSON, nullable=True),
        sa.Column("created_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("provider_id", "credential_type", name="uq_provider_cred_type"),
    )

    # ── 6. Add provider_id to patients ────────────────────────────────────────
    op.add_column("patients", sa.Column("provider_id", sa.Integer, sa.ForeignKey("providers.id"), nullable=True))
    op.create_index("ix_patients_provider_id", "patients", ["provider_id"])

    # Remove global unique constraint on mrn (now per-provider)
    try:
        op.drop_constraint("uq_patients_mrn", "patients", type_="unique")
    except Exception:
        pass  # Constraint might not exist or have different name
    try:
        op.drop_index("ix_patients_mrn", "patients")
        op.create_index("ix_patients_mrn", "patients", ["mrn"])
    except Exception:
        pass

    # ── 7. Add provider_id to fee_schedule ────────────────────────────────────
    op.add_column("fee_schedule", sa.Column("provider_id", sa.Integer, sa.ForeignKey("providers.id"), nullable=True))
    op.create_index("ix_fee_schedule_provider_id", "fee_schedule", ["provider_id"])

    # Drop old unique constraint and add new one
    try:
        op.drop_constraint("uq_fee_payer_cpt", "fee_schedule", type_="unique")
    except Exception:
        pass
    try:
        op.create_unique_constraint(
            "uq_fee_provider_payer_cpt", "fee_schedule", ["provider_id", "payer_id", "cpt_code"]
        )
    except Exception:
        pass

    # ── 8. Add provider_id to prior_auths ─────────────────────────────────────
    op.add_column("prior_auths", sa.Column("provider_id", sa.Integer, sa.ForeignKey("providers.id"), nullable=True))
    op.create_index("ix_prior_auths_provider_id", "prior_auths", ["provider_id"])

    # ── 9. Seed: create "Test Organization" and migrate existing data ─────────
    now = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")

    # Insert default org
    conn.execute(sa.text(
        "INSERT INTO organizations (name, slug, subscription_tier, subscription_status, max_providers, created_at, updated_at) "
        "VALUES ('Test Organization', 'test-organization', 'free', 'trial', 10, :now, :now)"
    ), {"now": now})

    # Get the new org id
    org_row = conn.execute(sa.text("SELECT id FROM organizations WHERE slug='test-organization'")).fetchone()
    if not org_row:
        return
    org_id = org_row[0]

    # Assign all existing users to this org as admin
    users = conn.execute(sa.text("SELECT id FROM users")).fetchall()
    for (user_id,) in users:
        conn.execute(sa.text(
            "INSERT INTO org_users (organization_id, user_id, role, invited_at, accepted_at) "
            "VALUES (:org_id, :user_id, 'admin', :now, :now)"
        ), {"org_id": org_id, "user_id": user_id, "now": now})

    # Assign all providers to this org
    conn.execute(sa.text(
        "UPDATE providers SET organization_id = :org_id"
    ), {"org_id": org_id})

    # Get first provider (for data migration)
    provider_row = conn.execute(sa.text("SELECT id FROM providers LIMIT 1")).fetchone()
    if not provider_row:
        return
    provider_id = provider_row[0]

    # Assign all patients to first provider
    conn.execute(sa.text(
        "UPDATE patients SET provider_id = :pid WHERE provider_id IS NULL"
    ), {"pid": provider_id})

    # Assign all fee_schedule entries to first provider
    conn.execute(sa.text(
        "UPDATE fee_schedule SET provider_id = :pid WHERE provider_id IS NULL"
    ), {"pid": provider_id})

    # Assign all prior_auths to first provider (via claim provider)
    conn.execute(sa.text(
        "UPDATE prior_auths SET provider_id = :pid WHERE provider_id IS NULL"
    ), {"pid": provider_id})

    # Migrate ClinicSettings -> ProviderSettings for the first provider
    cs = conn.execute(sa.text("SELECT * FROM clinic_settings LIMIT 1")).fetchone()
    if cs:
        cols = conn.execute(sa.text("SELECT * FROM clinic_settings LIMIT 0")).keys()
        cs_dict = dict(zip(cols, cs))

        conn.execute(sa.text(
            "INSERT INTO provider_settings "
            "(provider_id, clinic_name, address_line1, city, state, zip_code, phone, tax_id, npi_org, "
            "payer_enrollments, setup_complete, angelwink_clinic_id, created_at, updated_at) "
            "VALUES (:pid, :clinic_name, :address, :city, :state, :zip, :phone, :tax_id, :npi, "
            ":enrollments, :setup, :wink_id, :now, :now)"
        ), {
            "pid": provider_id,
            "clinic_name": cs_dict.get("clinic_name"),
            "address": cs_dict.get("address_line1"),
            "city": cs_dict.get("city"),
            "state": cs_dict.get("state", "PR"),
            "zip": cs_dict.get("zip_code"),
            "phone": cs_dict.get("phone"),
            "tax_id": cs_dict.get("tax_id"),
            "npi": cs_dict.get("npi_org"),
            "enrollments": "[]",
            "setup": cs_dict.get("setup_complete", 0),
            "wink_id": cs_dict.get("angelwink_clinic_id"),
            "now": now,
        })

        # Migrate credentials to provider_credentials
        cred_map = [
            ("vistanet", None, cs_dict.get("vistanet_username"), cs_dict.get("vistanet_password")),
            ("ivision", cs_dict.get("ivision_url"), cs_dict.get("ivision_username"), cs_dict.get("ivision_password")),
            ("envolve", cs_dict.get("envolve_url"), cs_dict.get("envolve_username"), cs_dict.get("envolve_password")),
            ("triples", cs_dict.get("triples_url"), cs_dict.get("triples_username"), cs_dict.get("triples_password")),
            ("innovamd", cs_dict.get("innovamd_url"), cs_dict.get("innovamd_username"), cs_dict.get("innovamd_password")),
        ]

        for ctype, url, username, password in cred_map:
            if username:
                conn.execute(sa.text(
                    "INSERT INTO provider_credentials "
                    "(provider_id, credential_type, url, username, password_encrypted, created_at, updated_at) "
                    "VALUES (:pid, :ctype, :url, :username, :password, :now, :now)"
                ), {
                    "pid": provider_id,
                    "ctype": ctype,
                    "url": url,
                    "username": username,
                    "password": password,
                    "now": now,
                })

        # Migrate Inmediata credentials
        if cs_dict.get("inmediata_sftp_user"):
            conn.execute(sa.text(
                "INSERT INTO provider_credentials "
                "(provider_id, credential_type, url, username, created_at, updated_at) "
                "VALUES (:pid, 'inmediata', :url, :username, :now, :now)"
            ), {
                "pid": provider_id,
                "url": cs_dict.get("inmediata_sftp_host"),
                "username": cs_dict.get("inmediata_sftp_user"),
                "now": now,
            })

        # Migrate Availity credentials
        if cs_dict.get("availity_client_id"):
            conn.execute(sa.text(
                "INSERT INTO provider_credentials "
                "(provider_id, credential_type, extra_json, created_at, updated_at) "
                "VALUES (:pid, 'availity', :extra, :now, :now)"
            ), {
                "pid": provider_id,
                "extra": '{"client_id": "' + (cs_dict.get("availity_client_id") or "") + '"}',
                "now": now,
            })


def downgrade() -> None:
    # Remove columns added to existing tables
    try:
        op.drop_index("ix_prior_auths_provider_id", "prior_auths")
        op.drop_column("prior_auths", "provider_id")
    except Exception:
        pass

    try:
        op.drop_constraint("uq_fee_provider_payer_cpt", "fee_schedule", type_="unique")
        op.drop_index("ix_fee_schedule_provider_id", "fee_schedule")
        op.drop_column("fee_schedule", "provider_id")
    except Exception:
        pass

    try:
        op.drop_index("ix_patients_provider_id", "patients")
        op.drop_column("patients", "provider_id")
    except Exception:
        pass

    try:
        op.drop_index("ix_providers_organization_id", "providers")
        op.drop_column("providers", "organization_id")
    except Exception:
        pass

    # Drop new tables
    op.drop_table("provider_credentials")
    op.drop_table("provider_settings")
    op.drop_table("org_users")
    op.drop_table("organizations")
