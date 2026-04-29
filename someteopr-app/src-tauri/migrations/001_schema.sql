-- SometeoPR Database Schema
-- Ported from Python SQLAlchemy models

PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

-- ── Users ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    full_name TEXT NOT NULL,
    hashed_password TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'biller' CHECK(role IN ('admin', 'biller', 'provider', 'viewer')),
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Clinic Settings ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS clinic_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
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
    inmediata_sftp_host TEXT,
    inmediata_sftp_user TEXT,
    stedi_api_key TEXT,
    availity_client_id TEXT,
    availity_client_secret TEXT,
    implug_outbound_folder TEXT,
    implug_inbound_folder TEXT,
    setup_complete INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Providers ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS providers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    npi TEXT NOT NULL UNIQUE,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    specialty TEXT,
    taxonomy_code TEXT,
    license_number TEXT,
    address_line1 TEXT,
    address_line2 TEXT,
    city TEXT,
    state TEXT DEFAULT 'PR',
    zip_code TEXT,
    phone TEXT,
    fax TEXT,
    ein TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Payers ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS payers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    payer_id TEXT NOT NULL UNIQUE,
    payer_type TEXT NOT NULL DEFAULT 'commercial' CHECK(payer_type IN ('commercial','medicare','medicaid','vision','dental','other')),
    submission_method TEXT NOT NULL DEFAULT 'stedi' CHECK(submission_method IN ('stedi','inmediata','fax','mail')),
    stedi_payer_id TEXT,
    inmediata_payer_id TEXT,
    address_line1 TEXT,
    city TEXT,
    state TEXT DEFAULT 'PR',
    zip_code TEXT,
    phone TEXT,
    fax_number TEXT,
    timely_filing_days INTEGER DEFAULT 90,
    is_active INTEGER NOT NULL DEFAULT 1,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Patients ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS patients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    wink_patient_id TEXT,
    mrn TEXT UNIQUE,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    dob TEXT NOT NULL,
    gender TEXT NOT NULL DEFAULT 'U' CHECK(gender IN ('M','F','U')),
    ssn_last4 TEXT,
    phone TEXT,
    email TEXT,
    address_line1 TEXT,
    address_line2 TEXT,
    city TEXT,
    state TEXT DEFAULT 'PR',
    zip_code TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS patient_insurances (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id INTEGER NOT NULL REFERENCES patients(id),
    payer_id INTEGER NOT NULL REFERENCES payers(id),
    member_id TEXT NOT NULL,
    group_number TEXT,
    subscriber_name TEXT,
    subscriber_dob TEXT,
    relationship_to_subscriber TEXT DEFAULT 'self',
    effective_date TEXT,
    termination_date TEXT,
    is_primary INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Claims ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS claims (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    claim_number TEXT NOT NULL UNIQUE,
    patient_id INTEGER NOT NULL REFERENCES patients(id),
    provider_id INTEGER NOT NULL REFERENCES providers(id),
    payer_id INTEGER NOT NULL REFERENCES payers(id),
    status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','ready','submitted','accepted','rejected','paid','denied','appealed','void')),
    service_date_from TEXT NOT NULL,
    service_date_to TEXT,
    date_of_submission TEXT,
    place_of_service TEXT DEFAULT '11',
    diagnosis_codes TEXT DEFAULT '[]',
    prior_auth_number TEXT,
    referral_number TEXT,
    total_billed REAL DEFAULT 0.0,
    total_allowed REAL,
    total_paid REAL DEFAULT 0.0,
    patient_responsibility REAL DEFAULT 0.0,
    adjustment_amount REAL DEFAULT 0.0,
    stedi_transaction_id TEXT,
    clearinghouse_ref TEXT,
    payer_claim_number TEXT,
    scrub_score REAL,
    scrub_issues TEXT,
    denial_risk_score REAL,
    source TEXT DEFAULT 'manual',
    external_ref TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_claims_status ON claims(status);
CREATE INDEX IF NOT EXISTS idx_claims_patient ON claims(patient_id);
CREATE INDEX IF NOT EXISTS idx_claims_payer ON claims(payer_id);
CREATE INDEX IF NOT EXISTS idx_claims_service_date ON claims(service_date_from);

CREATE TABLE IF NOT EXISTS service_lines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    claim_id INTEGER NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
    line_number INTEGER DEFAULT 1,
    cpt_code TEXT NOT NULL,
    modifiers TEXT DEFAULT '[]',
    description TEXT,
    service_date TEXT,
    place_of_service TEXT DEFAULT '11',
    units INTEGER DEFAULT 1,
    billed_amount REAL NOT NULL,
    allowed_amount REAL,
    paid_amount REAL DEFAULT 0.0,
    diagnosis_pointers TEXT DEFAULT '[1]'
);

-- ── Payments ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    claim_id INTEGER NOT NULL REFERENCES claims(id),
    check_number TEXT,
    check_date TEXT,
    payment_amount REAL NOT NULL,
    adjustment_amount REAL DEFAULT 0.0,
    patient_responsibility REAL DEFAULT 0.0,
    payment_method TEXT DEFAULT 'eft',
    eob_data TEXT,
    notes TEXT,
    posted_at TEXT NOT NULL DEFAULT (datetime('now')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Denials & Appeals ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS denials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    claim_id INTEGER NOT NULL REFERENCES claims(id),
    denial_code TEXT NOT NULL,
    denial_reason TEXT NOT NULL,
    denial_date TEXT NOT NULL,
    carc_code TEXT,
    rarc_code TEXT,
    ai_analysis TEXT,
    is_resolved INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS appeals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    claim_id INTEGER NOT NULL REFERENCES claims(id),
    denial_id INTEGER REFERENCES denials(id),
    appeal_date TEXT NOT NULL,
    deadline TEXT,
    status TEXT DEFAULT 'pending',
    appeal_letter TEXT,
    ai_drafted INTEGER DEFAULT 0,
    supporting_docs TEXT DEFAULT '[]',
    outcome TEXT,
    outcome_date TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Audit Log ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    claim_id INTEGER REFERENCES claims(id),
    entity_type TEXT NOT NULL DEFAULT 'claim',
    entity_id INTEGER NOT NULL,
    action TEXT NOT NULL,
    old_value TEXT,
    new_value TEXT,
    user_id INTEGER,
    user_email TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_claim ON audit_logs(claim_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);

-- ── Eligibility Checks ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS eligibility_checks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id INTEGER REFERENCES patients(id),
    payer_id INTEGER REFERENCES payers(id),
    member_id TEXT NOT NULL,
    patient_first_name TEXT,
    patient_last_name TEXT,
    is_eligible INTEGER,
    copay REAL,
    deductible REAL,
    deductible_met REAL,
    out_of_pocket_max REAL,
    out_of_pocket_met REAL,
    coverage_start TEXT,
    coverage_end TEXT,
    payer_name TEXT,
    raw_response TEXT,
    checked_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Prior Auth ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS prior_auths (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    claim_id INTEGER REFERENCES claims(id),
    payer_id INTEGER REFERENCES payers(id),
    payer_name TEXT,
    auth_number TEXT,
    cpt_codes TEXT DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','denied','expired')),
    requested_date TEXT,
    approved_date TEXT,
    expiry_date TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Claim Templates ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS claim_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    cpt_codes TEXT DEFAULT '[]',
    diagnosis_codes TEXT DEFAULT '[]',
    place_of_service TEXT DEFAULT '11',
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
