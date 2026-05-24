-- Migration 004: Multi-tenancy — organizations, org_users, provider_credentials, provider_settings
-- Adds organization → users → providers hierarchy with full data isolation

PRAGMA foreign_keys=OFF;

-- ── Organizations ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS organizations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    subscription_tier TEXT NOT NULL DEFAULT 'free' CHECK(subscription_tier IN ('free','pro','enterprise')),
    subscription_status TEXT NOT NULL DEFAULT 'trial' CHECK(subscription_status IN ('active','trial','expired')),
    subscription_expires_at TEXT,
    max_providers INTEGER NOT NULL DEFAULT 5,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Org-User memberships ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS org_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    organization_id INTEGER NOT NULL REFERENCES organizations(id),
    user_id INTEGER NOT NULL REFERENCES users(id),
    role TEXT NOT NULL DEFAULT 'biller' CHECK(role IN ('admin','biller','viewer')),
    invited_at TEXT NOT NULL DEFAULT (datetime('now')),
    accepted_at TEXT,
    UNIQUE(organization_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_org_users_org ON org_users(organization_id);
CREATE INDEX IF NOT EXISTS idx_org_users_user ON org_users(user_id);

-- ── Provider Settings (replaces global clinic_settings) ───────────────────────

CREATE TABLE IF NOT EXISTS provider_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider_id INTEGER NOT NULL UNIQUE REFERENCES providers(id),
    clinic_name TEXT,
    address_line1 TEXT,
    address_line2 TEXT,
    city TEXT,
    state TEXT DEFAULT 'PR',
    zip_code TEXT,
    phone TEXT,
    tax_id TEXT,
    npi_org TEXT,
    payer_enrollments TEXT DEFAULT '[]',
    setup_complete INTEGER NOT NULL DEFAULT 0,
    angelwink_clinic_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Provider Credentials (replaces flat credential columns in clinic_settings) ──

CREATE TABLE IF NOT EXISTS provider_credentials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider_id INTEGER NOT NULL REFERENCES providers(id),
    credential_type TEXT NOT NULL CHECK(credential_type IN ('inmediata','availity','ivision','envolve','triples','innovamd','vistanet')),
    url TEXT,
    username TEXT,
    password_encrypted TEXT,
    extra_json TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(provider_id, credential_type)
);

CREATE INDEX IF NOT EXISTS idx_provider_creds ON provider_credentials(provider_id);

-- ── Add organization_id to providers ──────────────────────────────────────────

ALTER TABLE providers ADD COLUMN organization_id INTEGER REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_providers_org ON providers(organization_id);

-- ── Add provider_id to patients (scoped data isolation) ──────────────────────

ALTER TABLE patients ADD COLUMN provider_id INTEGER REFERENCES providers(id);
CREATE INDEX IF NOT EXISTS idx_patients_provider ON patients(provider_id);

-- ── Add provider_id to fee_schedule ──────────────────────────────────────────

ALTER TABLE fee_schedule ADD COLUMN provider_id INTEGER REFERENCES providers(id);
CREATE INDEX IF NOT EXISTS idx_fee_schedule_provider ON fee_schedule(provider_id);

-- ── Add provider_id to prior_auths ────────────────────────────────────────────

ALTER TABLE prior_auths ADD COLUMN provider_id INTEGER REFERENCES providers(id);

-- ── Add language to users (if not exists) ────────────────────────────────────
-- (migration 003 may have already done this)

-- ── Seed: create default Test Organization and migrate existing data ──────────

INSERT OR IGNORE INTO organizations (name, slug, subscription_tier, subscription_status, max_providers)
VALUES ('Test Organization', 'test-organization', 'free', 'trial', 10);

-- Assign all existing users to Test Organization as admin
INSERT OR IGNORE INTO org_users (organization_id, user_id, role, accepted_at)
SELECT o.id, u.id, 'admin', datetime('now')
FROM organizations o, users u
WHERE o.slug = 'test-organization';

-- Assign all providers to Test Organization
UPDATE providers SET organization_id = (SELECT id FROM organizations WHERE slug='test-organization')
WHERE organization_id IS NULL;

-- Assign all patients to first provider
UPDATE patients SET provider_id = (SELECT id FROM providers LIMIT 1)
WHERE provider_id IS NULL;

-- Assign all fee_schedule entries to first provider
UPDATE fee_schedule SET provider_id = (SELECT id FROM providers LIMIT 1)
WHERE provider_id IS NULL;

-- Assign all prior_auths to first provider
UPDATE prior_auths SET provider_id = (SELECT id FROM providers LIMIT 1)
WHERE provider_id IS NULL;

-- Create provider_settings for all existing providers from clinic_settings
INSERT OR IGNORE INTO provider_settings (provider_id, clinic_name, address_line1, city, state, zip_code, phone, tax_id, npi_org, payer_enrollments, setup_complete, angelwink_clinic_id)
SELECT
    p.id,
    cs.clinic_name,
    cs.address_line1,
    cs.city,
    cs.state,
    cs.zip_code,
    cs.phone,
    cs.tax_id,
    cs.npi_org,
    cs.payer_enrollments,
    cs.setup_complete,
    NULL
FROM providers p
CROSS JOIN (SELECT * FROM clinic_settings LIMIT 1) cs
WHERE NOT EXISTS (SELECT 1 FROM provider_settings ps WHERE ps.provider_id = p.id);

PRAGMA foreign_keys=ON;
