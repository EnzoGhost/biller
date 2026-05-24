/**
 * SometeoPR Tauri API
 * Drop-in replacement for the old api.ts (axios/fetch) layer.
 * All data comes from SQLite via @tauri-apps/plugin-sql.
 * 
 * Export pattern: same function names as the old React Query calls used.
 */

import { query, execute, parseJson, generateClaimNumber } from './db';
import type {
  User, Provider, Payer, Patient, PatientInsurance, Claim, ServiceLine,
  Payment, Denial, Appeal, AuditLogEntry, EligibilityCheck,
  PriorAuth, ClaimTemplate, ClinicSettings, DashboardStats,
  ValidationResult, ValidationIssue, FollowUpItem,
} from '../types';

// Re-export type that pages may import from api
export type { User, Provider, Payer, Patient, Claim };

// ── Helper: normalize JSON columns ────────────────────────────────────────────

function normalizeClaim(row: Record<string, unknown>): Claim {
  return {
    ...row,
    diagnosis_codes: parseJson(row.diagnosis_codes, []),
    scrub_issues: parseJson(row.scrub_issues, null),
    service_lines: [],
  } as unknown as Claim;
}

function normalizeServiceLine(row: Record<string, unknown>): ServiceLine {
  return {
    ...row,
    modifiers: parseJson(row.modifiers, []),
    diagnosis_pointers: parseJson(row.diagnosis_pointers, [1]),
  } as unknown as ServiceLine;
}

function normalizePatient(row: Record<string, unknown>): Patient {
  return { ...row, insurances: [] } as unknown as Patient;
}

// ── Auth ──────────────────────────────────────────────────────────────────────

export async function login(email: string, password: string): Promise<{ user: User }> {
  const rows = await query<User>(
    'SELECT * FROM users WHERE email = ? AND is_active = 1 LIMIT 1',
    [email]
  );
  if (!rows.length) throw new Error('Invalid credentials');
  const user = rows[0];
  // Simple local auth — compare plaintext (for desktop app)
  if ((user as any).hashed_password !== password) throw new Error('Invalid credentials');
  return { user };
}

export async function getCurrentUser(userId: number): Promise<User> {
  const rows = await query<User>('SELECT * FROM users WHERE id = ? LIMIT 1', [userId]);
  if (!rows.length) throw new Error('User not found');
  return rows[0];
}

// ── Multi-tenancy: Organizations & Providers ─────────────────────────────────

export interface OrgRow {
  id: number;
  name: string;
  slug: string;
  role: string;
  subscription_tier: string;
  subscription_status: string;
}

export interface ProviderRow {
  id: number;
  npi: string;
  first_name: string;
  last_name: string;
  specialty?: string;
  organization_id?: number;
}

export async function getUserOrgs(userId: number): Promise<OrgRow[]> {
  const rows = await query<OrgRow>(
    `SELECT o.id, o.name, o.slug, ou.role, o.subscription_tier, o.subscription_status
     FROM organizations o
     JOIN org_users ou ON ou.organization_id = o.id
     WHERE ou.user_id = ?
     ORDER BY o.name`,
    [userId]
  );
  // If no orgs exist, create a default one
  if (rows.length === 0) {
    await execute(
      `INSERT OR IGNORE INTO organizations (name, slug, subscription_tier, subscription_status, max_providers)
       VALUES ('Test Organization', 'test-organization', 'free', 'trial', 10)`
    );
    const orgRows = await query<{ id: number }>('SELECT id FROM organizations WHERE slug=?', ['test-organization']);
    if (orgRows.length > 0) {
      const orgId = orgRows[0].id;
      await execute(
        `INSERT OR IGNORE INTO org_users (organization_id, user_id, role, accepted_at) VALUES (?, ?, 'admin', datetime('now'))`,
        [orgId, userId]
      );
      // Assign all existing providers to this org
      await execute(`UPDATE providers SET organization_id=? WHERE organization_id IS NULL`, [orgId]);
      return getUserOrgs(userId);
    }
  }
  return rows;
}

export async function getUserProviders(orgId: number): Promise<ProviderRow[]> {
  return query<ProviderRow>(
    `SELECT id, npi, first_name, last_name, specialty, organization_id
     FROM providers WHERE organization_id=? AND is_active=1 ORDER BY last_name`,
    [orgId]
  );
}

export async function getOrgDetails(orgId: number) {
  const rows = await query<OrgRow>(
    'SELECT id, name, slug, subscription_tier, subscription_status FROM organizations WHERE id=? LIMIT 1',
    [orgId]
  );
  return rows[0] ?? null;
}

export async function listOrganizations(userId: number) {
  return getUserOrgs(userId);
}

export async function createOrganization(name: string, userId: number): Promise<OrgRow> {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 100)
    + '-' + Date.now();
  await execute(
    `INSERT INTO organizations (name, slug, subscription_tier, subscription_status) VALUES (?, ?, 'free', 'trial')`,
    [name, slug]
  );
  const orgRows = await query<{ id: number }>('SELECT id FROM organizations WHERE slug=? LIMIT 1', [slug]);
  const orgId = orgRows[0].id;
  await execute(
    `INSERT INTO org_users (organization_id, user_id, role, accepted_at) VALUES (?, ?, 'admin', datetime('now'))`,
    [orgId, userId]
  );
  const org = await getOrgDetails(orgId);
  return { ...org!, role: 'admin' };
}

export async function inviteMember(orgId: number, email: string, role: string = 'biller') {
  const users = await query<{ id: number }>('SELECT id FROM users WHERE email=? LIMIT 1', [email]);
  if (!users.length) throw new Error('User not found');
  await execute(
    `INSERT OR IGNORE INTO org_users (organization_id, user_id, role, accepted_at) VALUES (?, ?, ?, datetime('now'))`,
    [orgId, users[0].id, role]
  );
}

// ── Dashboard ────────────────────────────────────────────────────────────────

export async function getDashboardStats(): Promise<DashboardStats> {
  const [totalRow] = await query<{ cnt: number }>('SELECT COUNT(*) as cnt FROM claims');
  const total_claims = totalRow?.cnt ?? 0;

  const statusRows = await query<{ status: string; cnt: number }>(
    'SELECT status, COUNT(*) as cnt FROM claims GROUP BY status'
  );
  const claims_by_status: Record<string, number> = {};
  for (const r of statusRows) claims_by_status[r.status] = r.cnt;

  const mtdStart = new Date();
  mtdStart.setDate(1);
  const mtdStr = mtdStart.toISOString().slice(0, 10);

  const [financialRow] = await query<{ billed: number; paid: number }>(
    `SELECT COALESCE(SUM(total_billed),0) as billed, COALESCE(SUM(total_paid),0) as paid
     FROM claims WHERE service_date_from >= ?`,
    [mtdStr]
  );
  const total_billed_mtd = financialRow?.billed ?? 0;
  const total_paid_mtd = financialRow?.paid ?? 0;
  const collection_rate = total_billed_mtd > 0 ? (total_paid_mtd / total_billed_mtd) * 100 : 0;

  const [appealRow] = await query<{ cnt: number }>(
    "SELECT COUNT(*) as cnt FROM appeals WHERE status = 'pending'"
  );
  const pending_appeals = appealRow?.cnt ?? 0;

  const [todayRow] = await query<{ cnt: number }>(
    "SELECT COUNT(*) as cnt FROM claims WHERE date_of_submission >= date('now','start of day')"
  );
  const submitted_today = todayRow?.cnt ?? 0;

  const denialRows = await query<{ denial_reason: string; denial_code: string; cnt: number }>(
    'SELECT denial_reason, denial_code, COUNT(*) as cnt FROM denials GROUP BY denial_reason ORDER BY cnt DESC LIMIT 5'
  );
  const top_denial_reasons = denialRows.map(r => ({
    reason: r.denial_reason,
    denial_code: r.denial_code,
    count: r.cnt,
  }));

  const recentRows = await query<Record<string, unknown>>(
    'SELECT id, claim_number, status, total_billed, service_date_from FROM claims ORDER BY created_at DESC LIMIT 10'
  );
  const recent_claims = recentRows as DashboardStats['recent_claims'];

  // Attention: denied/rejected + aging submitted
  const attentionRows = await query<Record<string, unknown>>(
    `SELECT id, claim_number, status, total_billed, service_date_from,
       CAST(julianday('now') - julianday(COALESCE(date_of_submission, service_date_from)) AS INTEGER) as days_old
     FROM claims 
     WHERE status IN ('denied','rejected') 
        OR (status='submitted' AND julianday('now') - julianday(COALESCE(date_of_submission,service_date_from)) > 30)
     ORDER BY days_old DESC LIMIT 10`
  );
  const attention_claims = attentionRows.map((r) => ({
    ...r,
    reason: r.status === 'denied' ? 'Denied' : r.status === 'rejected' ? 'Rejected — needs correction' : 'No response >30 days',
  })) as DashboardStats['attention_claims'];

  // Weekly trends (last 8 weeks)
  const weeklyRows = await query<{ week: string; claims: number; billed: number; paid: number }>(
    `SELECT strftime('%Y-W%W', service_date_from) as week,
       COUNT(*) as claims,
       COALESCE(SUM(total_billed),0) as billed,
       COALESCE(SUM(total_paid),0) as paid
     FROM claims
     WHERE service_date_from >= date('now','-56 days')
     GROUP BY week ORDER BY week ASC`
  );
  const weekly_trends = weeklyRows;

  // Payer performance
  const payerPerfRows = await query<{
    payer_id: number; payer_name: string; total_claims: number;
    denied_claims: number; paid_claims: number; total_billed: number; total_paid: number;
  }>(
    `SELECT c.payer_id, p.name as payer_name, COUNT(*) as total_claims,
       SUM(CASE WHEN c.status='denied' THEN 1 ELSE 0 END) as denied_claims,
       SUM(CASE WHEN c.status='paid' THEN 1 ELSE 0 END) as paid_claims,
       COALESCE(SUM(c.total_billed),0) as total_billed,
       COALESCE(SUM(c.total_paid),0) as total_paid
     FROM claims c JOIN payers p ON p.id=c.payer_id
     GROUP BY c.payer_id ORDER BY total_claims DESC LIMIT 8`
  );
  const payer_performance = payerPerfRows.map(r => ({
    payer_id: r.payer_id,
    payer_name: r.payer_name,
    total_claims: r.total_claims,
    denial_rate: r.total_claims > 0 ? Math.round((r.denied_claims / r.total_claims) * 100) : 0,
    collection_rate: r.total_billed > 0 ? Math.round((r.total_paid / r.total_billed) * 100) : 0,
  }));

  return {
    total_claims,
    claims_by_status: claims_by_status as DashboardStats['claims_by_status'],
    total_billed_mtd,
    total_paid_mtd,
    collection_rate: Math.round(collection_rate * 10) / 10,
    pending_appeals,
    top_denial_reasons,
    recent_claims,
    submitted_today,
    attention_claims,
    weekly_trends,
    payer_performance,
  };
}

// ── Patients ──────────────────────────────────────────────────────────────────

export async function getPatients(opts?: { search?: string; page?: number; per_page?: number; provider_id?: number }) {
  const { search = '', page = 1, per_page = 50, provider_id } = opts ?? {};
  const offset = (page - 1) * per_page;
  const likeSearch = `%${search}%`;

  const providerFilter = provider_id ? ' AND provider_id=?' : '';
  const providerParam = provider_id ? [provider_id] : [];

  const [countRow] = await query<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM patients WHERE is_active=1${providerFilter} AND (first_name LIKE ? OR last_name LIKE ? OR mrn LIKE ? OR phone LIKE ?)`,
    [...providerParam, likeSearch, likeSearch, likeSearch, likeSearch]
  );
  const total = countRow?.cnt ?? 0;

  const rows = await query<Record<string, unknown>>(
    `SELECT * FROM patients WHERE is_active=1${providerFilter} AND (first_name LIKE ? OR last_name LIKE ? OR mrn LIKE ? OR phone LIKE ?)
     ORDER BY last_name, first_name LIMIT ? OFFSET ?`,
    [...providerParam, likeSearch, likeSearch, likeSearch, likeSearch, per_page, offset]
  );

  const patients = await Promise.all(rows.map(async (row) => {
    const p = normalizePatient(row);
    const insurances = await query<Record<string, unknown>>(
      `SELECT pi.*, py.name as payer_name, py.payer_id as payer_code FROM patient_insurances pi
       JOIN payers py ON py.id=pi.payer_id WHERE pi.patient_id=?`,
      [p.id]
    );
    p.insurances = insurances as unknown as PatientInsurance[];
    return p;
  }));

  return { items: patients, total, page, per_page, pages: Math.ceil(total / per_page) };
}

export async function getPatient(id: number): Promise<Patient> {
  const [row] = await query<Record<string, unknown>>('SELECT * FROM patients WHERE id=?', [id]);
  if (!row) throw new Error('Patient not found');
  const p = normalizePatient(row);
  const insurances = await query<Record<string, unknown>>(
    `SELECT pi.*, py.name as payer_name, py.payer_id as payer_code, py.payer_type FROM patient_insurances pi
     JOIN payers py ON py.id=pi.payer_id WHERE pi.patient_id=?`,
    [id]
  );
  p.insurances = insurances as unknown as PatientInsurance[];
  return p;
}

export async function createPatient(data: Partial<Patient> & { provider_id?: number }): Promise<Patient> {
  const [countRow] = await query<{ cnt: number }>(
    'SELECT COUNT(*) as cnt FROM patients WHERE provider_id=?', [data.provider_id ?? null]
  );
  const mrn = `PR${String((countRow?.cnt ?? 0) + 1).padStart(6, '0')}`;
  const r = await execute(
    `INSERT INTO patients (mrn, provider_id, first_name, last_name, dob, gender, phone, email, address_line1, address_line2, city, state, zip_code, is_active)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1)`,
    [mrn, data.provider_id ?? null, data.first_name, data.last_name, data.dob, data.gender ?? 'U', data.phone ?? null, data.email ?? null,
     data.address_line1 ?? null, null, data.city ?? null, data.state ?? 'PR', data.zip_code ?? null]
  );
  return getPatient(r.lastInsertId);
}

export async function updatePatient(id: number, data: Partial<Patient>): Promise<Patient> {
  await execute(
    `UPDATE patients SET first_name=?, last_name=?, dob=?, gender=?, phone=?, email=?,
     address_line1=?, city=?, state=?, zip_code=?, updated_at=datetime('now') WHERE id=?`,
    [data.first_name, data.last_name, data.dob, data.gender, data.phone ?? null, data.email ?? null,
     data.address_line1 ?? null, data.city ?? null, data.state ?? 'PR', data.zip_code ?? null, id]
  );
  return getPatient(id);
}

// ── Payers ────────────────────────────────────────────────────────────────────

export async function getPayers(opts?: { search?: string; page?: number; per_page?: number }) {
  const { search = '', page = 1, per_page = 100 } = opts ?? {};
  const offset = (page - 1) * per_page;
  const like = `%${search}%`;
  const [countRow] = await query<{ cnt: number }>(
    'SELECT COUNT(*) as cnt FROM payers WHERE name LIKE ? OR payer_id LIKE ?', [like, like]
  );
  const rows = await query<Payer>(
    'SELECT * FROM payers WHERE name LIKE ? OR payer_id LIKE ? ORDER BY name LIMIT ? OFFSET ?',
    [like, like, per_page, offset]
  );
  return { items: rows, total: countRow?.cnt ?? 0, page, per_page, pages: Math.ceil((countRow?.cnt ?? 0) / per_page) };
}

export async function getPayer(id: number): Promise<Payer> {
  const [row] = await query<Payer>('SELECT * FROM payers WHERE id=?', [id]);
  if (!row) throw new Error('Payer not found');
  return row;
}

export async function createPayer(data: Partial<Payer>): Promise<Payer> {
  const r = await execute(
    `INSERT INTO payers (name, payer_id, payer_type, submission_method, stedi_payer_id, inmediata_payer_id,
     address_line1, city, state, zip_code, phone, fax_number, timely_filing_days, notes)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [data.name, data.payer_id, data.payer_type ?? 'commercial', data.submission_method ?? 'stedi',
     data.stedi_payer_id ?? null, data.inmediata_payer_id ?? null, data.address_line1 ?? null,
     data.city ?? null, data.state ?? 'PR', data.zip_code ?? null, data.phone ?? null,
     data.fax_number ?? null, data.timely_filing_days ?? 90, data.notes ?? null]
  );
  return getPayer(r.lastInsertId);
}

export async function updatePayer(id: number, data: Partial<Payer>): Promise<Payer> {
  await execute(
    `UPDATE payers SET name=?, payer_type=?, submission_method=?, stedi_payer_id=?, inmediata_payer_id=?,
     address_line1=?, city=?, state=?, zip_code=?, phone=?, fax_number=?, timely_filing_days=?, notes=?,
     is_active=? WHERE id=?`,
    [data.name, data.payer_type, data.submission_method, data.stedi_payer_id ?? null,
     data.inmediata_payer_id ?? null, data.address_line1 ?? null, data.city ?? null, data.state ?? 'PR',
     data.zip_code ?? null, data.phone ?? null, data.fax_number ?? null, data.timely_filing_days ?? 90,
     data.notes ?? null, data.is_active ? 1 : 0, id]
  );
  return getPayer(id);
}

// ── Providers ─────────────────────────────────────────────────────────────────

export async function getProviders(opts?: { search?: string; page?: number; per_page?: number }) {
  const { search = '', page = 1, per_page = 100 } = opts ?? {};
  const offset = (page - 1) * per_page;
  const like = `%${search}%`;
  const [countRow] = await query<{ cnt: number }>(
    'SELECT COUNT(*) as cnt FROM providers WHERE is_active=1 AND (first_name LIKE ? OR last_name LIKE ? OR npi LIKE ?)',
    [like, like, like]
  );
  const rows = await query<Provider>(
    'SELECT * FROM providers WHERE is_active=1 AND (first_name LIKE ? OR last_name LIKE ? OR npi LIKE ?) ORDER BY last_name LIMIT ? OFFSET ?',
    [like, like, like, per_page, offset]
  );
  return { items: rows, total: countRow?.cnt ?? 0, page, per_page, pages: Math.ceil((countRow?.cnt ?? 0) / per_page) };
}

export async function getProvider(id: number): Promise<Provider> {
  const [row] = await query<Provider>('SELECT * FROM providers WHERE id=?', [id]);
  if (!row) throw new Error('Provider not found');
  return row;
}

export async function createProvider(data: Partial<Provider>): Promise<Provider> {
  const r = await execute(
    `INSERT INTO providers (npi, first_name, last_name, specialty, taxonomy_code, license_number,
     address_line1, city, state, zip_code, phone, fax, ein)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [data.npi, data.first_name, data.last_name, data.specialty ?? null, data.taxonomy_code ?? null,
     data.license_number ?? null, data.address_line1 ?? null, data.city ?? null, data.state ?? 'PR',
     data.zip_code ?? null, data.phone ?? null, data.fax ?? null, data.ein ?? null]
  );
  return getProvider(r.lastInsertId);
}

export async function updateProvider(id: number, data: Partial<Provider>): Promise<Provider> {
  await execute(
    `UPDATE providers SET npi=?, first_name=?, last_name=?, specialty=?, taxonomy_code=?, license_number=?,
     address_line1=?, city=?, state=?, zip_code=?, phone=?, fax=?, ein=?, is_active=? WHERE id=?`,
    [data.npi, data.first_name, data.last_name, data.specialty ?? null, data.taxonomy_code ?? null,
     data.license_number ?? null, data.address_line1 ?? null, data.city ?? null, data.state ?? 'PR',
     data.zip_code ?? null, data.phone ?? null, data.fax ?? null, data.ein ?? null, data.is_active ? 1 : 0, id]
  );
  return getProvider(id);
}

// ── Claims ────────────────────────────────────────────────────────────────────

interface ClaimListOpts {
  page?: number;
  per_page?: number;
  status?: string;
  search?: string;
  patient_id?: number;
  payer_id?: number;
  date_from?: string;
  date_to?: string;
  provider_id?: number;
}

export async function getClaims(opts?: ClaimListOpts) {
  const { page = 1, per_page = 20, status, search, patient_id, payer_id, date_from, date_to, provider_id } = opts ?? {};
  const offset = (page - 1) * per_page;

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (provider_id) { conditions.push('c.provider_id=?'); params.push(provider_id); }
  if (status) { conditions.push('c.status=?'); params.push(status); }
  if (patient_id) { conditions.push('c.patient_id=?'); params.push(patient_id); }
  if (payer_id) { conditions.push('c.payer_id=?'); params.push(payer_id); }
  if (date_from) { conditions.push('c.service_date_from>=?'); params.push(date_from); }
  if (date_to) { conditions.push('c.service_date_from<=?'); params.push(date_to); }
  if (search) {
    conditions.push('(c.claim_number LIKE ? OR pat.first_name LIKE ? OR pat.last_name LIKE ?)');
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const [countRow] = await query<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM claims c JOIN patients pat ON pat.id=c.patient_id ${where}`,
    params
  );
  const total = countRow?.cnt ?? 0;

  const rows = await query<Record<string, unknown>>(
    `SELECT c.*, pat.first_name as patient_first_name, pat.last_name as patient_last_name,
       prov.first_name as provider_first_name, prov.last_name as provider_last_name,
       pay.name as payer_name
     FROM claims c
     JOIN patients pat ON pat.id=c.patient_id
     JOIN providers prov ON prov.id=c.provider_id
     JOIN payers pay ON pay.id=c.payer_id
     ${where}
     ORDER BY c.created_at DESC LIMIT ? OFFSET ?`,
    [...params, per_page, offset]
  );

  const items = rows.map(row => {
    const claim = normalizeClaim(row);
    claim.patient = {
      id: row.patient_id as number,
      first_name: row.patient_first_name as string,
      last_name: row.patient_last_name as string,
    } as Patient;
    claim.provider = {
      id: row.provider_id as number,
      first_name: row.provider_first_name as string,
      last_name: row.provider_last_name as string,
    } as Provider;
    claim.payer = { id: row.payer_id as number, name: row.payer_name as string } as Payer;
    return claim;
  });

  return { items, total, page, per_page, pages: Math.ceil(total / per_page) };
}

export async function getClaim(id: number): Promise<Claim> {
  const [row] = await query<Record<string, unknown>>(
    `SELECT c.*, pat.first_name as patient_first_name, pat.last_name as patient_last_name,
       pat.dob, pat.gender, pat.phone as patient_phone, pat.address_line1 as patient_address,
       pat.city as patient_city, pat.state as patient_state, pat.zip_code as patient_zip,
       prov.first_name as provider_first_name, prov.last_name as provider_last_name,
       prov.npi as provider_npi, prov.taxonomy_code, prov.ein as provider_ein,
       pay.name as payer_name, pay.payer_id as payer_code
     FROM claims c
     JOIN patients pat ON pat.id=c.patient_id
     JOIN providers prov ON prov.id=c.provider_id
     JOIN payers pay ON pay.id=c.payer_id
     WHERE c.id=?`,
    [id]
  );
  if (!row) throw new Error('Claim not found');

  const claim = normalizeClaim(row);
  
  // Attach patient
  const [patRow] = await query<Record<string, unknown>>('SELECT * FROM patients WHERE id=?', [row.patient_id]);
  if (patRow) {
    const pat = normalizePatient(patRow);
    const insurances = await query<PatientInsurance>(
      `SELECT pi.*, py.name as payer_name FROM patient_insurances pi JOIN payers py ON py.id=pi.payer_id WHERE pi.patient_id=?`,
      [pat.id]
    );
    pat.insurances = insurances;
    claim.patient = pat;
  }

  claim.provider = {
    id: row.provider_id as number,
    first_name: row.provider_first_name as string,
    last_name: row.provider_last_name as string,
    npi: row.provider_npi as string,
    taxonomy_code: row.taxonomy_code as string,
    ein: row.provider_ein as string,
    state: 'PR',
    is_active: true,
  } as Provider;

  claim.payer = { id: row.payer_id as number, name: row.payer_name as string, payer_id: row.payer_code as string } as Payer;

  // Service lines
  const slRows = await query<Record<string, unknown>>(
    'SELECT * FROM service_lines WHERE claim_id=? ORDER BY line_number', [id]
  );
  claim.service_lines = slRows.map(normalizeServiceLine);

  return claim;
}

export async function createClaim(data: Partial<Claim> & { service_lines?: Partial<ServiceLine>[] }): Promise<Claim> {
  const claim_number = data.claim_number ?? generateClaimNumber();
  const diag = JSON.stringify(data.diagnosis_codes ?? []);
  const total_billed = (data.service_lines ?? []).reduce((s, l) => s + (l.billed_amount ?? 0), 0);

  const r = await execute(
    `INSERT INTO claims (claim_number, patient_id, provider_id, payer_id, status, service_date_from, service_date_to,
     place_of_service, diagnosis_codes, prior_auth_number, referral_number, total_billed, source, notes)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [claim_number, data.patient_id, data.provider_id, data.payer_id, data.status ?? 'draft',
     data.service_date_from, data.service_date_to ?? null, data.place_of_service ?? '11',
     diag, data.prior_auth_number ?? null, data.referral_number ?? null, total_billed,
     data.source ?? 'manual', data.notes ?? null]
  );
  const claimId = r.lastInsertId;

  for (let i = 0; i < (data.service_lines ?? []).length; i++) {
    const sl = data.service_lines![i];
    await execute(
      `INSERT INTO service_lines (claim_id, line_number, cpt_code, modifiers, description, service_date, place_of_service, units, billed_amount, diagnosis_pointers)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [claimId, sl.line_number ?? i + 1, sl.cpt_code, JSON.stringify(sl.modifiers ?? []),
       sl.description ?? null, sl.service_date ?? data.service_date_from, sl.place_of_service ?? '11',
       sl.units ?? 1, sl.billed_amount, JSON.stringify(sl.diagnosis_pointers ?? [1])]
    );
  }

  await logAudit('claim', claimId, 'created', null, data.status ?? 'draft');
  return getClaim(claimId);
}

export async function updateClaim(id: number, data: Partial<Claim>): Promise<Claim> {
  const diag = data.diagnosis_codes ? JSON.stringify(data.diagnosis_codes) : undefined;
  const fields: string[] = [];
  const params: unknown[] = [];

  const addField = (f: string, v: unknown) => { fields.push(`${f}=?`); params.push(v); };

  if (data.status !== undefined) addField('status', data.status);
  if (data.patient_id !== undefined) addField('patient_id', data.patient_id);
  if (data.provider_id !== undefined) addField('provider_id', data.provider_id);
  if (data.payer_id !== undefined) addField('payer_id', data.payer_id);
  if (data.service_date_from !== undefined) addField('service_date_from', data.service_date_from);
  if (data.service_date_to !== undefined) addField('service_date_to', data.service_date_to);
  if (data.place_of_service !== undefined) addField('place_of_service', data.place_of_service);
  if (diag !== undefined) addField('diagnosis_codes', diag);
  if (data.prior_auth_number !== undefined) addField('prior_auth_number', data.prior_auth_number);
  if (data.referral_number !== undefined) addField('referral_number', data.referral_number);
  if (data.total_billed !== undefined) addField('total_billed', data.total_billed);
  if (data.total_paid !== undefined) addField('total_paid', data.total_paid);
  if (data.notes !== undefined) addField('notes', data.notes);
  if (data.stedi_transaction_id !== undefined) addField('stedi_transaction_id', data.stedi_transaction_id);
  if (data.payer_claim_number !== undefined) addField('payer_claim_number', data.payer_claim_number);
  if (data.date_of_submission !== undefined) addField('date_of_submission', data.date_of_submission);

  fields.push("updated_at=datetime('now')");
  params.push(id);

  if (fields.length > 1) {
    await execute(`UPDATE claims SET ${fields.join(',')} WHERE id=?`, params);
  }

  return getClaim(id);
}

export async function updateClaimStatus(id: number, status: string): Promise<Claim> {
  const old = await getClaim(id);
  const date_of_submission = ['submitted', 'accepted'].includes(status) && !old.date_of_submission
    ? new Date().toISOString()
    : undefined;

  await execute(
    `UPDATE claims SET status=?, updated_at=datetime('now') ${date_of_submission ? ", date_of_submission=?" : ""} WHERE id=?`,
    date_of_submission ? [status, date_of_submission, id] : [status, id]
  );
  await logAudit('claim', id, 'status_changed', old.status, status);
  return getClaim(id);
}

export async function deleteClaim(id: number): Promise<void> {
  await execute('DELETE FROM service_lines WHERE claim_id=?', [id]);
  await execute('DELETE FROM claims WHERE id=?', [id]);
}

// ── Service Lines ─────────────────────────────────────────────────────────────

export async function updateServiceLines(claimId: number, lines: Partial<ServiceLine>[]): Promise<ServiceLine[]> {
  await execute('DELETE FROM service_lines WHERE claim_id=?', [claimId]);
  for (let i = 0; i < lines.length; i++) {
    const sl = lines[i];
    await execute(
      `INSERT INTO service_lines (claim_id, line_number, cpt_code, modifiers, description, service_date, place_of_service, units, billed_amount, diagnosis_pointers)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [claimId, sl.line_number ?? i + 1, sl.cpt_code, JSON.stringify(sl.modifiers ?? []),
       sl.description ?? null, sl.service_date ?? null, sl.place_of_service ?? '11',
       sl.units ?? 1, sl.billed_amount, JSON.stringify(sl.diagnosis_pointers ?? [1])]
    );
  }
  // Update total_billed
  const total = lines.reduce((s, l) => s + (l.billed_amount ?? 0), 0);
  await execute('UPDATE claims SET total_billed=? WHERE id=?', [total, claimId]);

  const rows = await query<Record<string, unknown>>(
    'SELECT * FROM service_lines WHERE claim_id=? ORDER BY line_number', [claimId]
  );
  return rows.map(normalizeServiceLine);
}

// ── Payments ──────────────────────────────────────────────────────────────────

export async function getPayments(opts?: { page?: number; per_page?: number; claim_id?: number }) {
  const { page = 1, per_page = 50, claim_id } = opts ?? {};
  const offset = (page - 1) * per_page;
  const where = claim_id ? 'WHERE p.claim_id=?' : '';
  const params = claim_id ? [claim_id] : [];
  const [countRow] = await query<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM payments p ${where}`, params);
  const rows = await query<Record<string, unknown>>(
    `SELECT p.*, c.claim_number, pat.first_name||' '||pat.last_name as patient_name
     FROM payments p JOIN claims c ON c.id=p.claim_id JOIN patients pat ON pat.id=c.patient_id
     ${where} ORDER BY p.posted_at DESC LIMIT ? OFFSET ?`,
    [...params, per_page, offset]
  );
  return { items: rows as unknown as Payment[], total: countRow?.cnt ?? 0, page, per_page, pages: Math.ceil((countRow?.cnt ?? 0) / per_page) };
}

export async function createPayment(data: Partial<Payment>): Promise<Payment> {
  const r = await execute(
    `INSERT INTO payments (claim_id, check_number, check_date, payment_amount, adjustment_amount, patient_responsibility, payment_method, notes)
     VALUES (?,?,?,?,?,?,?,?)`,
    [data.claim_id, data.check_number ?? null, data.check_date ?? null, data.payment_amount,
     data.adjustment_amount ?? 0, data.patient_responsibility ?? 0, data.payment_method ?? 'eft', data.notes ?? null]
  );
  // Update claim totals
  const pmts = await query<{ total: number }>(
    'SELECT COALESCE(SUM(payment_amount),0) as total FROM payments WHERE claim_id=?', [data.claim_id]
  );
  const totalPaid = pmts[0]?.total ?? 0;
  await execute(
    "UPDATE claims SET total_paid=?, status='paid', updated_at=datetime('now') WHERE id=?",
    [totalPaid, data.claim_id]
  );
  await logAudit('payment', r.lastInsertId, 'created', null, String(data.payment_amount), data.claim_id);
  const [row] = await query<Payment>('SELECT * FROM payments WHERE id=?', [r.lastInsertId]);
  return row;
}

// ── Denials ───────────────────────────────────────────────────────────────────

export async function getDenials(opts?: { page?: number; per_page?: number; claim_id?: number; is_resolved?: boolean }) {
  const { page = 1, per_page = 50, claim_id, is_resolved } = opts ?? {};
  const offset = (page - 1) * per_page;
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (claim_id) { conditions.push('d.claim_id=?'); params.push(claim_id); }
  if (is_resolved !== undefined) { conditions.push('d.is_resolved=?'); params.push(is_resolved ? 1 : 0); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const [countRow] = await query<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM denials d ${where}`, params);
  const rows = await query<Record<string, unknown>>(
    `SELECT d.*, c.claim_number, pat.first_name||' '||pat.last_name as patient_name, pay.name as payer_name
     FROM denials d JOIN claims c ON c.id=d.claim_id
     JOIN patients pat ON pat.id=c.patient_id JOIN payers pay ON pay.id=c.payer_id
     ${where} ORDER BY d.denial_date DESC LIMIT ? OFFSET ?`,
    [...params, per_page, offset]
  );
  return { items: rows as unknown as Denial[], total: countRow?.cnt ?? 0, page, per_page, pages: Math.ceil((countRow?.cnt ?? 0) / per_page) };
}

export async function createDenial(data: Partial<Denial>): Promise<Denial> {
  const r = await execute(
    `INSERT INTO denials (claim_id, denial_code, denial_reason, denial_date, carc_code, rarc_code)
     VALUES (?,?,?,?,?,?)`,
    [data.claim_id, data.denial_code, data.denial_reason, data.denial_date,
     data.carc_code ?? null, data.rarc_code ?? null]
  );
  await updateClaimStatus(data.claim_id!, 'denied');
  const [row] = await query<Denial>('SELECT * FROM denials WHERE id=?', [r.lastInsertId]);
  return row;
}

export async function resolveDenial(id: number): Promise<void> {
  await execute('UPDATE denials SET is_resolved=1 WHERE id=?', [id]);
}

// ── Audit Logs ────────────────────────────────────────────────────────────────

async function logAudit(
  entityType: string, entityId: number, action: string,
  oldValue: string | null, newValue: string | null, claimId?: number
): Promise<void> {
  await execute(
    `INSERT INTO audit_logs (entity_type, entity_id, claim_id, action, old_value, new_value, created_at)
     VALUES (?,?,?,?,?,?,datetime('now'))`,
    [entityType, entityId, claimId ?? (entityType === 'claim' ? entityId : null), action, oldValue, newValue]
  );
}

export async function getAuditLogs(claimId?: number): Promise<AuditLogEntry[]> {
  const where = claimId ? 'WHERE claim_id=?' : '';
  const params = claimId ? [claimId] : [];
  return query<AuditLogEntry>(
    `SELECT * FROM audit_logs ${where} ORDER BY created_at DESC LIMIT 100`, params
  );
}

// ── Eligibility ───────────────────────────────────────────────────────────────

export async function getEligibilityChecks(opts?: { page?: number; per_page?: number }) {
  const { page = 1, per_page = 50 } = opts ?? {};
  const offset = (page - 1) * per_page;
  const [countRow] = await query<{ cnt: number }>('SELECT COUNT(*) as cnt FROM eligibility_checks');
  const rows = await query<EligibilityCheck>(
    'SELECT * FROM eligibility_checks ORDER BY checked_at DESC LIMIT ? OFFSET ?',
    [per_page, offset]
  );
  return { items: rows, total: countRow?.cnt ?? 0, page, per_page, pages: Math.ceil((countRow?.cnt ?? 0) / per_page) };
}

export async function createEligibilityCheck(data: Partial<EligibilityCheck>): Promise<EligibilityCheck> {
  const r = await execute(
    `INSERT INTO eligibility_checks (patient_id, payer_id, member_id, patient_first_name, patient_last_name,
     is_eligible, copay, deductible, payer_name, raw_response)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [data.patient_id ?? null, data.payer_id ?? null, data.member_id, data.patient_first_name ?? null,
     data.patient_last_name ?? null, data.is_eligible ?? null, data.copay ?? null, data.deductible ?? null,
     data.payer_name ?? null, data.raw_response ? JSON.stringify(data.raw_response) : null]
  );
  const [row] = await query<EligibilityCheck>('SELECT * FROM eligibility_checks WHERE id=?', [r.lastInsertId]);
  return row;
}

// ── Prior Auth ────────────────────────────────────────────────────────────────

export async function getPriorAuths(opts?: { page?: number; per_page?: number }) {
  const { page = 1, per_page = 50 } = opts ?? {};
  const offset = (page - 1) * per_page;
  const [countRow] = await query<{ cnt: number }>('SELECT COUNT(*) as cnt FROM prior_auths');
  const rows = await query<Record<string, unknown>>(
    'SELECT * FROM prior_auths ORDER BY created_at DESC LIMIT ? OFFSET ?', [per_page, offset]
  );
  return {
    items: rows.map(r => ({ ...r, cpt_codes: parseJson(r.cpt_codes, []) })) as unknown as PriorAuth[],
    total: countRow?.cnt ?? 0, page, per_page, pages: Math.ceil((countRow?.cnt ?? 0) / per_page)
  };
}

export async function createPriorAuth(data: Partial<PriorAuth>): Promise<PriorAuth> {
  const r = await execute(
    `INSERT INTO prior_auths (claim_id, payer_id, payer_name, auth_number, cpt_codes, status, requested_date, expiry_date, notes)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [data.claim_id ?? null, data.payer_id ?? null, data.payer_name ?? null, data.auth_number ?? null,
     JSON.stringify(data.cpt_codes ?? []), data.status ?? 'pending', data.requested_date ?? null,
     data.expiry_date ?? null, data.notes ?? null]
  );
  const [row] = await query<Record<string, unknown>>('SELECT * FROM prior_auths WHERE id=?', [r.lastInsertId]);
  return { ...row, cpt_codes: parseJson(row.cpt_codes, []) } as unknown as PriorAuth;
}

// ── Claim Templates ───────────────────────────────────────────────────────────

export async function getClaimTemplates(): Promise<ClaimTemplate[]> {
  const rows = await query<Record<string, unknown>>(
    'SELECT * FROM claim_templates WHERE is_active=1 ORDER BY name'
  );
  return rows.map(r => ({
    ...r,
    cpt_codes: parseJson(r.cpt_codes, []),
    diagnosis_codes: parseJson(r.diagnosis_codes, []),
  })) as unknown as ClaimTemplate[];
}

export async function createClaimTemplate(data: Partial<ClaimTemplate>): Promise<ClaimTemplate> {
  const r = await execute(
    `INSERT INTO claim_templates (name, description, cpt_codes, diagnosis_codes, place_of_service)
     VALUES (?,?,?,?,?)`,
    [data.name, data.description ?? null, JSON.stringify(data.cpt_codes ?? []),
     JSON.stringify(data.diagnosis_codes ?? []), data.place_of_service ?? '11']
  );
  const [row] = await query<Record<string, unknown>>('SELECT * FROM claim_templates WHERE id=?', [r.lastInsertId]);
  return { ...row, cpt_codes: parseJson(row.cpt_codes, []), diagnosis_codes: parseJson(row.diagnosis_codes, []) } as unknown as ClaimTemplate;
}

// ── Clinic Settings ───────────────────────────────────────────────────────────

export async function getClinicSettings(): Promise<ClinicSettings> {
  const [row] = await query<Record<string, unknown>>('SELECT * FROM clinic_settings LIMIT 1');
  if (!row) {
    // Create default
    await execute(
      `INSERT INTO clinic_settings (clinic_name, state, setup_complete) VALUES ('Mi Clínica', 'PR', 0)`
    );
    return getClinicSettings();
  }
  return {
    ...row,
    payer_enrollments: parseJson(row.payer_enrollments, []),
    has_inmediata: !!(row.inmediata_sftp_host),
    has_stedi: !!(row.stedi_api_key),
    has_availity: !!(row.availity_client_id),
    setup_complete: !!(row.setup_complete),
  } as unknown as ClinicSettings;
}

export async function updateClinicSettings(data: Partial<ClinicSettings> & { 
  implug_outbound_folder?: string; implug_inbound_folder?: string;
  stedi_api_key?: string; inmediata_sftp_host?: string; inmediata_sftp_user?: string;
  availity_client_id?: string; availity_client_secret?: string;
}): Promise<ClinicSettings> {
  const [existing] = await query<{ id: number }>('SELECT id FROM clinic_settings LIMIT 1');
  const id = existing?.id;

  const fields: string[] = [];
  const params: unknown[] = [];
  const add = (f: string, v: unknown) => { fields.push(`${f}=?`); params.push(v); };

  if (data.clinic_name !== undefined) add('clinic_name', data.clinic_name);
  if (data.address_line1 !== undefined) add('address_line1', data.address_line1);
  if (data.city !== undefined) add('city', data.city);
  if (data.state !== undefined) add('state', data.state);
  if (data.zip_code !== undefined) add('zip_code', data.zip_code);
  if (data.phone !== undefined) add('phone', data.phone);
  if (data.tax_id !== undefined) add('tax_id', data.tax_id);
  if (data.npi_org !== undefined) add('npi_org', data.npi_org);
  if (data.setup_complete !== undefined) add('setup_complete', data.setup_complete ? 1 : 0);
  if (data.implug_outbound_folder !== undefined) add('implug_outbound_folder', data.implug_outbound_folder);
  if (data.implug_inbound_folder !== undefined) add('implug_inbound_folder', data.implug_inbound_folder);
  if (data.stedi_api_key !== undefined) add('stedi_api_key', data.stedi_api_key);
  if (data.inmediata_sftp_host !== undefined) add('inmediata_sftp_host', data.inmediata_sftp_host);
  if (data.inmediata_sftp_user !== undefined) add('inmediata_sftp_user', data.inmediata_sftp_user);
  if (data.availity_client_id !== undefined) add('availity_client_id', data.availity_client_id);
  if (data.availity_client_secret !== undefined) add('availity_client_secret', data.availity_client_secret);
  if (data.payer_enrollments !== undefined) add('payer_enrollments', JSON.stringify(data.payer_enrollments));
  add("updated_at", new Date().toISOString());

  if (id) {
    params.push(id);
    await execute(`UPDATE clinic_settings SET ${fields.join(',')} WHERE id=?`, params);
  } else {
    await execute(`INSERT INTO clinic_settings (${fields.map(f => f.split('=')[0]).join(',')}) VALUES (${fields.map(() => '?').join(',')})`, params);
  }

  return getClinicSettings();
}

// ── Validation ────────────────────────────────────────────────────────────────

export async function validateClaim(claimId: number): Promise<ValidationResult> {
  const claim = await getClaim(claimId);
  const issues: ValidationIssue[] = [];

  if (!claim.diagnosis_codes?.length) {
    issues.push({ severity: 'error', code: 'MISSING_DIAGNOSIS', field: 'diagnosis_codes', message: 'At least one diagnosis code is required' });
  }
  if (!claim.service_lines?.length) {
    issues.push({ severity: 'error', code: 'MISSING_SERVICE_LINES', field: 'service_lines', message: 'At least one service line is required' });
  }
  if (!claim.patient_id) {
    issues.push({ severity: 'error', code: 'MISSING_PATIENT', field: 'patient_id', message: 'Patient is required' });
  }
  if (!claim.provider_id) {
    issues.push({ severity: 'error', code: 'MISSING_PROVIDER', field: 'provider_id', message: 'Provider is required' });
  }
  if (!claim.payer_id) {
    issues.push({ severity: 'error', code: 'MISSING_PAYER', field: 'payer_id', message: 'Payer is required' });
  }

  // Check payer-specific rules
  const payer = claim.payer;
  const isEnvolve = payer?.payer_id === 'ENVOLVE';

  for (const sl of claim.service_lines ?? []) {
    if (!sl.billed_amount || sl.billed_amount <= 0) {
      issues.push({ severity: 'error', code: 'INVALID_AMOUNT', field: 'service_lines', message: `Service line ${sl.line_number}: billed amount must be > 0` });
    }
    // Medicare: refraction not covered
    if (payer?.payer_type === 'medicare' && ['92015', '92310'].includes(sl.cpt_code)) {
      issues.push({ severity: 'warning', code: 'MEDICARE_REFRACTION', field: 'service_lines', message: `CPT ${sl.cpt_code} may not be covered by Medicare` });
    }
  }

  const errors = issues.filter(i => i.severity === 'error').length;
  const warnings = issues.filter(i => i.severity === 'warning').length;

  return {
    claim_id: claimId,
    is_valid: errors === 0,
    error_count: errors,
    warning_count: warnings,
    info_count: 0,
    issues,
    envolve_routing: {
      is_envolve_payer: isEnvolve,
      route: isEnvolve ? 'envolve' : 'standard',
      envolve_applicable: isEnvolve,
    },
  };
}

// ── Follow-Up Queue ───────────────────────────────────────────────────────────

export async function getFollowUpQueue(): Promise<FollowUpItem[]> {
  const rows = await query<Record<string, unknown>>(
    `SELECT c.id as claim_id, c.claim_number, c.status, c.total_billed, c.total_paid,
       c.service_date_from, pat.first_name||' '||pat.last_name as patient_name,
       pay.name as payer_name,
       CAST(julianday('now') - julianday(COALESCE(c.date_of_submission, c.service_date_from)) AS INTEGER) as days_since_submission
     FROM claims c
     JOIN patients pat ON pat.id=c.patient_id
     JOIN payers pay ON pay.id=c.payer_id
     WHERE c.status IN ('submitted','accepted','denied','rejected','appealed')
        OR (c.status='submitted' AND julianday('now') - julianday(COALESCE(c.date_of_submission,c.service_date_from)) > 30)
     ORDER BY days_since_submission DESC`
  );

  return rows.map(r => {
    const balance = (r.total_billed as number) - (r.total_paid as number);
    const days = r.days_since_submission as number;
    let reason = '';
    let priority: 'high' | 'medium' | 'low' = 'low';
    const actions: string[] = [];

    if (r.status === 'denied') {
      reason = 'Claim denied — appeal needed';
      priority = 'high';
      actions.push('Appeal', 'Review');
    } else if (r.status === 'rejected') {
      reason = 'Claim rejected — correction needed';
      priority = 'high';
      actions.push('Resubmit');
    } else if (r.status === 'submitted' && days > 45) {
      reason = `No response in ${days} days`;
      priority = 'high';
      actions.push('Call Payer', 'Check Status');
    } else if (r.status === 'submitted' && days > 30) {
      reason = `Pending ${days} days`;
      priority = 'medium';
      actions.push('Check Status');
    } else if (r.status === 'accepted') {
      reason = 'Accepted — awaiting payment';
      priority = 'low';
      actions.push('Check Status');
    } else {
      reason = `In ${r.status} status`;
      priority = 'low';
    }

    return {
      claim_id: r.claim_id as number,
      claim_number: r.claim_number as string,
      status: r.status as string,
      patient_name: r.patient_name as string,
      payer_name: r.payer_name as string,
      service_date: r.service_date_from as string,
      total_billed: r.total_billed as number,
      total_paid: r.total_paid as number,
      balance,
      days_since_submission: days,
      reason,
      priority,
      actions,
    };
  });
}

// ── Reports ───────────────────────────────────────────────────────────────────

export async function getReportsData(opts?: { date_from?: string; date_to?: string; payer_id?: number }) {
  const { date_from, date_to, payer_id } = opts ?? {};
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (date_from) { conditions.push('c.service_date_from>=?'); params.push(date_from); }
  if (date_to) { conditions.push('c.service_date_from<=?'); params.push(date_to); }
  if (payer_id) { conditions.push('c.payer_id=?'); params.push(payer_id); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const [summary] = await query<{ total_billed: number; total_paid: number; claim_count: number }>(
    `SELECT COALESCE(SUM(total_billed),0) as total_billed, COALESCE(SUM(total_paid),0) as total_paid, COUNT(*) as claim_count FROM claims c ${where}`,
    params
  );
  const byStatus = await query<{ status: string; cnt: number; billed: number; paid: number }>(
    `SELECT status, COUNT(*) as cnt, COALESCE(SUM(total_billed),0) as billed, COALESCE(SUM(total_paid),0) as paid FROM claims c ${where} GROUP BY status`,
    params
  );
  const byPayer = await query<{ payer_name: string; cnt: number; billed: number; paid: number }>(
    `SELECT pay.name as payer_name, COUNT(*) as cnt, COALESCE(SUM(c.total_billed),0) as billed, COALESCE(SUM(c.total_paid),0) as paid
     FROM claims c JOIN payers pay ON pay.id=c.payer_id ${where} GROUP BY c.payer_id ORDER BY billed DESC`,
    params
  );

  return { summary, by_status: byStatus, by_payer: byPayer };
}

// ── ERA Processing ────────────────────────────────────────────────────────────

export async function processEraFile(content: string): Promise<{ processed: number; errors: string[] }> {
  // Simple 835 parser — looks for CLP (claim) and CAS (adjustment) segments
  const errors: string[] = [];
  let processed = 0;
  const lines = content.split(/[\r\n]+/);
  
  let currentClaimNumber: string | null = null;
  let currentPaid = 0;

  for (const line of lines) {
    const seg = line.split('*');
    if (seg[0] === 'CLP') {
      // CLP*claim_number*status*billed*paid*...
      currentClaimNumber = seg[1];
      currentPaid = parseFloat(seg[4] ?? '0');
    } else if (seg[0] === 'SE' && currentClaimNumber) {
      // End of transaction — try to match and post payment
      if (currentClaimNumber && currentPaid > 0) {
        const [claimRow] = await query<{ id: number }>(
          'SELECT id FROM claims WHERE claim_number=? OR payer_claim_number=?',
          [currentClaimNumber, currentClaimNumber]
        );
        if (claimRow) {
          await createPayment({
            claim_id: claimRow.id,
            payment_amount: currentPaid,
            payment_method: 'eft',
            notes: 'Posted from ERA file',
          });
          processed++;
        } else {
          errors.push(`Claim not found: ${currentClaimNumber}`);
        }
      }
      currentClaimNumber = null;
      currentPaid = 0;
    }
  }

  return { processed, errors };
}

// ── Import ────────────────────────────────────────────────────────────────────

export async function importCsvPatients(csvContent: string): Promise<{ imported: number; errors: string[] }> {
  const lines = csvContent.split('\n').filter(Boolean);
  if (!lines.length) return { imported: 0, errors: ['Empty file'] };
  
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/"/g, ''));
  const errors: string[] = [];
  let imported = 0;

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map(v => v.trim().replace(/"/g, ''));
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => { row[h] = values[idx] ?? ''; });

    try {
      await createPatient({
        first_name: row.first_name || row.firstname || row['first name'],
        last_name: row.last_name || row.lastname || row['last name'],
        dob: row.dob || row.date_of_birth || row['date of birth'],
        gender: (row.gender?.toUpperCase() as 'M' | 'F' | 'U') || 'U',
        phone: row.phone,
        email: row.email,
        address_line1: row.address,
        city: row.city,
        state: row.state || 'PR',
        zip_code: row.zip || row.zip_code,
      });
      imported++;
    } catch (e) {
      errors.push(`Row ${i}: ${e}`);
    }
  }

  return { imported, errors };
}
