/**
 * API compatibility shim for SometeoPR Tauri.
 * 
 * Maps URL patterns from the original axios/fetch calls to local SQLite operations.
 * Response shape mirrors axios: { data: ... }
 */

import {
  getDashboardStats,
  getPatients, getPatient, createPatient, updatePatient,
  getPayers, getPayer, createPayer, updatePayer,
  getProviders, getProvider, createProvider, updateProvider,
  getClaims, getClaim, createClaim, updateClaim, updateClaimStatus, deleteClaim,
  updateServiceLines,
  getPayments, createPayment,
  getDenials, createDenial, resolveDenial,
  getAuditLogs,
  getEligibilityChecks, createEligibilityCheck,
  getPriorAuths, createPriorAuth,
  getClaimTemplates, createClaimTemplate,
  getClinicSettings, updateClinicSettings,
  validateClaim,
  getFollowUpQueue,
  getReportsData,
  processEraFile,
  importCsvPatients,
  login as dbLogin,
} from './tauri-api';
import { query, execute } from './db';
import type { ClinicSettings } from '../types';

export type { ClinicSettings };

const ok = (data: unknown) => ({ data });

function parseQS(qs: string): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(qs));
}

function parseUrl(url: string): { path: string; qs: Record<string, string> } {
  const [path, qsPart] = url.split('?');
  return { path: path.replace(/^\/+/, '').replace(/\/+$/, ''), qs: qsPart ? parseQS(qsPart) : {} };
}

// ── GET ──────────────────────────────────────────────────────────────────────

async function get(url: string): Promise<{ data: unknown }> {
  const { path, qs } = parseUrl(url);
  const page = parseInt(qs.page ?? '1');
  const per_page = parseInt(qs.per_page ?? '50');
  const search = qs.search ?? '';

  // Dashboard
  if (path === 'dashboard/stats') return ok(await getDashboardStats());
  if (path === 'dashboard/reports') {
    const data = await getReportsData({ date_from: qs.date_from, date_to: qs.date_to });
    return ok(data);
  }

  // Payments summary
  if (path === 'payments/summary') {
    const [row] = await query<{ total: number; count: number; month_total: number }>(
      "SELECT COUNT(*) as count, COALESCE(SUM(payment_amount),0) as total, COALESCE(SUM(CASE WHEN posted_at >= date('now','start of month') THEN payment_amount ELSE 0 END),0) as month_total FROM payments"
    );
    return ok(row ?? { total: 0, count: 0, month_total: 0 });
  }

  // Claims
  if (path === 'claims') {
    return ok(await getClaims({
      page, per_page, status: qs.status, search,
      patient_id: qs.patient_id ? parseInt(qs.patient_id) : undefined,
      payer_id: qs.payer_id ? parseInt(qs.payer_id) : undefined,
      date_from: qs.date_from, date_to: qs.date_to
    }));
  }

  // /claims/:id
  if (/^claims\/\d+$/.test(path)) {
    const id = parseInt(path.split('/')[1]);
    return ok(await getClaim(id));
  }
  // /claims/:id/audit
  if (/^claims\/\d+\/audit$/.test(path)) {
    const id = parseInt(path.split('/')[1]);
    return ok(await getAuditLogs(id));
  }
  // /claims/:id/validate or /validation/claims/:id
  if (/^claims\/\d+\/validate$/.test(path) || /^validation\/claims\/\d+$/.test(path)) {
    const id = parseInt(path.split('/').find(p => /^\d+$/.test(p)) ?? '0');
    return ok(await validateClaim(id));
  }
  // /claims/:id/denials
  if (/^claims\/\d+\/denials$/.test(path)) {
    const id = parseInt(path.split('/')[1]);
    return ok((await getDenials({ claim_id: id })).items);
  }
  // /claims/:id/appeals
  if (/^claims\/\d+\/appeals$/.test(path)) {
    const id = parseInt(path.split('/')[1]);
    return ok(await query('SELECT * FROM appeals WHERE claim_id=? ORDER BY created_at DESC', [id]));
  }
  // /claims/:id/payments
  if (/^claims\/\d+\/payments$/.test(path)) {
    const id = parseInt(path.split('/')[1]);
    return ok((await getPayments({ claim_id: id })).items);
  }

  // Audit logs
  if (path === 'audit') return ok(await getAuditLogs());
  if (/^audit\/claims\/\d+$/.test(path)) {
    const id = parseInt(path.split('/')[2]);
    return ok(await getAuditLogs(id));
  }

  // Patients
  if (path === 'patients') return ok(await getPatients({ page, per_page, search }));
  if (/^patients\/\d+$/.test(path)) return ok(await getPatient(parseInt(path.split('/')[1])));

  // Payers
  if (path === 'payers') return ok(await getPayers({ page, per_page, search }));
  if (/^payers\/\d+$/.test(path)) return ok(await getPayer(parseInt(path.split('/')[1])));
  if (path === 'stedi/payers/pr') {
    const payersResult = await getPayers({ per_page: 100 });
    return ok({ items: payersResult.items, total: payersResult.total });
  }

  // Providers
  if (path === 'providers') return ok(await getProviders({ page, per_page, search }));
  if (/^providers\/\d+$/.test(path)) return ok(await getProvider(parseInt(path.split('/')[1])));

  // Payments
  if (path === 'payments') return ok(await getPayments({ page, per_page, claim_id: qs.claim_id ? parseInt(qs.claim_id) : undefined }));
  if (/^payments\/claims\/\d+$/.test(path)) {
    const id = parseInt(path.split('/')[2]);
    return ok((await getPayments({ claim_id: id })).items);
  }

  // Denials
  if (path === 'denials') return ok(await getDenials({
    page, per_page,
    claim_id: qs.claim_id ? parseInt(qs.claim_id) : undefined,
    is_resolved: qs.is_resolved !== undefined ? qs.is_resolved === 'true' : undefined
  }));

  // Eligibility
  if (path === 'eligibility') return ok(await getEligibilityChecks({ page, per_page }));

  // Prior auth
  if (path === 'prior-auth' || path === 'prior-auths') return ok(await getPriorAuths({ page, per_page }));
  if (/^prior-auth\/claims\/\d+$/.test(path)) {
    const id = parseInt(path.split('/')[2]);
    return ok(await query('SELECT * FROM prior_auths WHERE claim_id=? ORDER BY created_at DESC', [id]));
  }

  // Templates
  if (path === 'templates') return ok(await getClaimTemplates());

  // Clinic / Settings
  if (path === 'clinic/settings') return ok(await getClinicSettings());

  // Follow-up queue
  if (path === 'followup' || path === 'follow-up') return ok(await getFollowUpQueue());

  // Reports
  if (path === 'reports') return ok(await getReportsData({
    date_from: qs.date_from, date_to: qs.date_to,
    payer_id: qs.payer_id ? parseInt(qs.payer_id) : undefined
  }));

  // ERA
  if (path === 'era') return ok(await getEligibilityChecks({ page, per_page }));

  // Stedi status (returns submitted for local use)
  if (/^stedi\/status\/\d+$/.test(path)) return ok({ status: 'submitted', acknowledged: true });

  // Availity status
  if (/^availity\/status\/\d+$/.test(path)) return ok({ status: 'submitted', payer_response: null });

  // Inmediata download ERA (stub)
  if (path === 'inmediata/download-era') return ok({ files: [], processed: 0 });

  console.warn('[api shim] Unhandled GET:', path);
  return ok(null);
}

// ── POST ─────────────────────────────────────────────────────────────────────

async function post(url: string, data?: unknown): Promise<{ data: unknown }> {
  const { path } = parseUrl(url);
  const body = (data ?? {}) as Record<string, unknown>;

  // Auth
  if (path === 'auth/login') {
    return ok(await dbLogin(body.email as string, body.password as string));
  }

  // Claims CRUD
  if (path === 'claims') return ok(await createClaim(body as any));

  if (/^claims\/\d+\/service-lines$/.test(path)) {
    const id = parseInt(path.split('/')[1]);
    return ok(await updateServiceLines(id, body as any));
  }
  if (/^claims\/\d+\/status$/.test(path)) {
    const id = parseInt(path.split('/')[1]);
    return ok(await updateClaimStatus(id, body.status as string));
  }
  if (/^claims\/\d+\/void$/.test(path)) {
    const id = parseInt(path.split('/')[1]);
    return ok(await updateClaimStatus(id, 'void'));
  }
  if (/^claims\/\d+\/resubmit$/.test(path)) {
    const id = parseInt(path.split('/')[1]);
    return ok(await updateClaimStatus(id, 'submitted'));
  }
  if (/^claims\/\d+\/appeals$/.test(path)) {
    const id = parseInt(path.split('/')[1]);
    const r = await execute(
      `INSERT INTO appeals (claim_id, appeal_date, status, notes) VALUES (?, date('now'), 'pending', ?)`,
      [id, (body as any).notes ?? null]
    );
    await updateClaimStatus(id, 'appealed');
    const [row] = await query('SELECT * FROM appeals WHERE id=?', [r.lastInsertId]);
    return ok(row);
  }
  if (/^claims\/\d+\/payments$/.test(path)) {
    const id = parseInt(path.split('/')[1]);
    return ok(await createPayment({ ...(body as any), claim_id: id }));
  }
  if (/^claims\/\d+\/denials$/.test(path)) {
    const id = parseInt(path.split('/')[1]);
    return ok(await createDenial({ ...(body as any), claim_id: id }));
  }

  // Stedi/Inmediata submit — mark claim as submitted
  if (/^stedi\/submit\/\d+$/.test(path)) {
    const id = parseInt(path.split('/')[2]);
    return ok(await updateClaimStatus(id, 'submitted'));
  }
  if (/^inmediata\/submit\/\d+$/.test(path)) {
    const id = parseInt(path.split('/')[2]);
    return ok(await updateClaimStatus(id, 'submitted'));
  }
  if (/^inmediata\/upload$/.test(path)) {
    return ok({ success: true, message: 'EDI queued for ImPlug outbound folder' });
  }
  if (/^inmediata\/generate\/\d+$/.test(path)) {
    const id = parseInt(path.split('/')[2]);
    const claim = await getClaim(id);
    // Return a stub EDI content for preview
    return ok({ edi_content: `ISA*00*          *00*          *ZZ*SUBMITTER       *ZZ*PAYER          *250101*1200*^*00501*000001001*0*P*:~\nGE*1*1~\nIEA*1*000001001~`, claim_number: claim.claim_number });
  }
  if (/^inmediata\/reconcile$/.test(path)) {
    return ok({ matched: 0, unmatched: 0, total_amount: 0 });
  }
  if (/^inmediata\/download-era$/.test(path)) {
    return ok({ files: [], processed: 0 });
  }
  if (/^availity\/submit\/\d+$/.test(path)) {
    const id = parseInt(path.split('/')[2]);
    return ok(await updateClaimStatus(id, 'submitted'));
  }

  // Patients
  if (path === 'patients') return ok(await createPatient(body as any));

  // Payers
  if (path === 'payers') return ok(await createPayer(body as any));

  // Providers
  if (path === 'providers') return ok(await createProvider(body as any));

  // Payments
  if (path === 'payments') return ok(await createPayment(body as any));
  if (/^payments\/claims\/\d+$/.test(path)) {
    const id = parseInt(path.split('/')[2]);
    return ok(await createPayment({ ...(body as any), claim_id: id }));
  }
  if (path === 'payments/batch') {
    const items = (body as any).items ?? [];
    let processed = 0;
    for (const item of items) {
      await createPayment(item);
      processed++;
    }
    return ok({ processed });
  }

  // Denials
  if (path === 'denials') return ok(await createDenial(body as any));
  if (/^denials\/\d+\/resolve$/.test(path)) {
    await resolveDenial(parseInt(path.split('/')[1]));
    return ok({ success: true });
  }

  // Eligibility
  if (path === 'eligibility/check' || path === 'stedi/eligibility') {
    return ok(await createEligibilityCheck(body as any));
  }

  // Prior auth
  if (path === 'prior-auth' || path === 'prior-auth/') return ok(await createPriorAuth(body as any));

  // Templates
  if (path === 'templates' || path === 'templates/') return ok(await createClaimTemplate(body as any));

  // Clinic settings
  if (path === 'clinic/settings') return ok(await updateClinicSettings(body as any));

  // ERA processing
  if (path === 'era/process') return ok(await processEraFile((body as any).content as string));

  // Import
  if (path === 'import/patients') return ok(await importCsvPatients((body as any).content as string));
  if (path === 'import/superbill') return ok({ imported: 0, errors: ['Superbill import not yet implemented in desktop mode'] });
  if (path === 'import/wink') return ok({ imported: 0, errors: ['Wink import runs via Wink integration'] });
  if (path === 'import/wink/encounters') return ok({ imported: 0, errors: ['Wink encounter import runs via Wink integration'] });

  // Validation — also support POST for /validation/claims/:id
  if (/^validation\/claims\/\d+$/.test(path) || /^claims\/\d+\/validate$/.test(path)) {
    const id = parseInt(path.split('/').find(p => /^\d+$/.test(p)) ?? '0');
    return ok(await validateClaim(id));
  }

  // AI (stub responses for offline use)
  if (/^ai\/scrub\/\d+$/.test(path)) {
    const id = parseInt(path.split('/')[2]);
    const result = await validateClaim(id);
    return ok({ score: result.is_valid ? 95 : 60, issues: result.issues.map(i => ({ type: i.severity, msg: i.message })), suggestions: [] });
  }
  if (path === 'ai/denial-analysis') {
    return ok({ analysis: 'AI analysis not available in offline mode', recommendations: [] });
  }
  if (/^ai\/appeal-letter\/\d+$/.test(path)) {
    return ok({ appeal_letter_draft: 'Dear Payer,\n\nWe are writing to appeal the denial of claim #[CLAIM_NUMBER]...\n\n[Please complete the appeal letter with specific details]\n\nSincerely,\n[Provider Name]' });
  }

  // Stedi config
  if (path === 'stedi/config') return ok(await updateClinicSettings(body as any));

  // AI config
  if (path === 'ai/config') return ok({ success: true });

  // Inmediata config
  if (path === 'inmediata/config') return ok(await updateClinicSettings(body as any));

  console.warn('[api shim] Unhandled POST:', path);
  return ok(null);
}

// ── PUT / PATCH ──────────────────────────────────────────────────────────────

async function put(url: string, data?: unknown): Promise<{ data: unknown }> {
  const { path } = parseUrl(url);
  const body = (data ?? {}) as Record<string, unknown>;

  if (/^claims\/\d+$/.test(path)) {
    const id = parseInt(path.split('/')[1]);
    return ok(await updateClaim(id, body as any));
  }
  if (/^patients\/\d+$/.test(path)) {
    const id = parseInt(path.split('/')[1]);
    return ok(await updatePatient(id, body as any));
  }
  if (/^payers\/\d+$/.test(path)) {
    const id = parseInt(path.split('/')[1]);
    return ok(await updatePayer(id, body as any));
  }
  if (/^providers\/\d+$/.test(path)) {
    const id = parseInt(path.split('/')[1]);
    return ok(await updateProvider(id, body as any));
  }
  if (path === 'clinic/settings') return ok(await updateClinicSettings(body as any));

  // User language preference
  if (path === 'auth/me/language') {
    const lang = (body as any).language as string;
    if (lang === 'en' || lang === 'es') {
      // Read user from Zustand persisted store
      const stored = localStorage.getItem('angelclaims-auth');
      if (stored) {
        const state = JSON.parse(stored);
        const user = state?.state?.user;
        if (user?.id) {
          await execute('UPDATE users SET language=? WHERE id=?', [lang, user.id]);
          // Update persisted store so Zustand re-hydrates correctly
          state.state.user = { ...user, language: lang };
          localStorage.setItem('angelclaims-auth', JSON.stringify(state));
          return ok(state.state.user);
        }
      }
    }
    return ok(null);
  }

  // Denials — PATCH /denials/:id supports { is_resolved: true } to resolve a denial
  if (/^denials\/\d+$/.test(path)) {
    const id = parseInt(path.split('/')[1]);
    if ((body as any).is_resolved) await resolveDenial(id);
    const [row] = await query('SELECT * FROM denials WHERE id=?', [id]);
    return ok(row);
  }

  console.warn('[api shim] Unhandled PUT:', path);
  return ok(null);
}

async function patch(url: string, data?: unknown): Promise<{ data: unknown }> {
  return put(url, data);
}

// ── DELETE ───────────────────────────────────────────────────────────────────

async function del(url: string): Promise<{ data: unknown }> {
  const { path } = parseUrl(url);
  if (/^claims\/\d+$/.test(path)) {
    await deleteClaim(parseInt(path.split('/')[1]));
    return ok({ success: true });
  }
  if (/^patients\/\d+$/.test(path)) {
    await execute('UPDATE patients SET is_active=0 WHERE id=?', [parseInt(path.split('/')[1])]);
    return ok({ success: true });
  }
  console.warn('[api shim] Unhandled DELETE:', path);
  return ok(null);
}

// ── Export as axios-like object ───────────────────────────────────────────────

const api = {
  get,
  post,
  put,
  patch,
  delete: del,
  // interceptors stub (no-op for compat)
  interceptors: {
    request: { use: () => {} },
    response: { use: () => {} },
  },
};

export default api;
