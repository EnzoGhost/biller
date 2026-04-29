// @ts-nocheck
import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft, Send, Trash2, Sparkles, ShieldCheck,
  ChevronDown, ChevronUp, AlertTriangle, RefreshCw, Check, X,
  FileCode, Upload, Zap, CheckCircle, Clock, XCircle,
  MessageSquare, RotateCcw, FileText, Copy,
  ClipboardCheck, Eye, DollarSign, History,
  ShieldAlert, Plus,
} from 'lucide-react';
import api from '../lib/api';
import { formatDateShort, formatDate } from '../lib/dates';
import type { Claim, Denial, Appeal, ValidationResult, AuditLogEntry, Payment, PriorAuth } from '../types';
import StatusBadge from '../components/ui/Badge';
import DatePicker from '../components/ui/DatePicker';

// ── Routing indicator ─────────────────────────────────────────────────────────

const ROUTING_CONFIG = {
  stedi:    { label: 'Stedi',        color: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  inmediata:{ label: 'Inmediata',    color: 'bg-indigo-100 text-indigo-700 border-indigo-200' },
  envolve:  { label: 'Envolve/Availity', color: 'bg-blue-100 text-blue-700 border-blue-200' },
  reforma:  { label: 'Reforma',      color: 'bg-amber-100 text-amber-700 border-amber-200' },
  fax:      { label: 'Fax',          color: 'bg-slate-100 text-slate-600 border-slate-200' },
  mail:     { label: 'Mail',         color: 'bg-slate-100 text-slate-600 border-slate-200' },
} as const;

function RoutingBadge({ method }: { method: string }) {
  const cfg = ROUTING_CONFIG[method as keyof typeof ROUTING_CONFIG] ?? ROUTING_CONFIG.fax;
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${cfg.color}`}>
      {cfg.label}
    </span>
  );
}

// ── Status timeline ───────────────────────────────────────────────────────────

const TIMELINE_STEPS = [
  { key: 'draft',     labelKey: 'lifecycle.step_created',      icon: FileText },
  { key: 'ready',     labelKey: 'lifecycle.step_scrubbed',     icon: ShieldCheck },
  { key: 'submitted', labelKey: 'lifecycle.step_submitted',    icon: Send },
  { key: 'accepted',  labelKey: 'lifecycle.step_acknowledged', icon: Check },
  { key: 'paid',      labelKey: 'lifecycle.step_paid',         icon: CheckCircle },
] as const;

const STATUS_ORDER = ['draft', 'ready', 'submitted', 'accepted', 'paid'];

function StatusTimeline({ status }: { status: string }) {
  const { t } = useTranslation();
  const isDenied = status === 'denied' || status === 'appealed';
  const currentIdx = STATUS_ORDER.indexOf(status);

  return (
    <div>
      <h2 className="text-sm font-semibold text-slate-700 mb-3">{t('lifecycle.timeline')}</h2>
      <div className="flex items-center gap-0">
        {TIMELINE_STEPS.map((step, i) => {
          const isActive = isDenied ? false : (currentIdx >= i);
          const isCurrent = status === step.key;
          const Icon = step.icon;
          return (
            <div key={step.key} className="flex items-center flex-1 last:flex-none">
              <div className="flex flex-col items-center gap-1">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center border-2 transition-all ${
                  isCurrent ? 'border-sky-500 bg-sky-500 text-white' :
                  isActive ? 'border-emerald-500 bg-emerald-500 text-white' :
                  'border-slate-200 bg-white text-slate-300'
                }`}>
                  <Icon className="w-3.5 h-3.5" />
                </div>
                <span className={`text-xs whitespace-nowrap ${
                  isCurrent ? 'text-sky-600 font-semibold' :
                  isActive ? 'text-emerald-600' :
                  'text-slate-400'
                }`}>
                  {t(step.labelKey)}
                </span>
              </div>
              {i < TIMELINE_STEPS.length - 1 && (
                <div className={`flex-1 h-0.5 mb-5 mx-1 ${isActive ? 'bg-emerald-400' : 'bg-slate-100'}`} />
              )}
            </div>
          );
        })}
        {isDenied && (
          <div className="flex flex-col items-center gap-1 ml-2">
            <div className="w-8 h-8 rounded-full flex items-center justify-center border-2 border-rose-500 bg-rose-500 text-white">
              <XCircle className="w-3.5 h-3.5" />
            </div>
            <span className="text-xs text-rose-600 font-semibold">
              {status === 'appealed' ? t('status.appealed') : t('status.denied')}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ClaimDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [showLines, setShowLines] = useState(true);
  const [scrubResult, setScrubResult] = useState<{ score: number; issues: { type: string; msg: string }[]; suggestions: string[] } | null>(null);
  const [scrubbing, setScrubbing] = useState(false);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const [stediStatus, setStediStatus] = useState<Record<string, unknown> | null>(null);
  const [checkingStatus, setCheckingStatus] = useState(false);

  // Inmediata state
  const [ediContent, setEdiContent] = useState<string | null>(null);
  const [generatingEDI, setGeneratingEDI] = useState(false);
  const [uploadingEDI, setUploadingEDI] = useState(false);
  const [showEDIPreview, setShowEDIPreview] = useState(false);

  // Notes state
  const [noteText, setNoteText] = useState('');
  const [savingNote, setSavingNote] = useState(false);

  // Appeal letter state
  const [appealLetter, setAppealLetter] = useState<string | null>(null);
  const [generatingLetter, setGeneratingLetter] = useState(false);
  const [letterCopied, setLetterCopied] = useState(false);

  // Resubmit state
  const [resubmitting, setResubmitting] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [reopening, setReopening] = useState(false);

  // Validation state
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);
  const [validating, setValidating] = useState(false);

  // Prior auth state
  const [showPriorAuthForm, setShowPriorAuthForm] = useState(false);
  const [paAuthNumber, setPaAuthNumber] = useState('');
  const [paExpiry, setPaExpiry] = useState('');
  const [savingPa, setSavingPa] = useState(false);

  // Availity/Envolve state
  const [availitySubmitting, setAvailitySubmitting] = useState(false);
  const [availityChecking, setAvailityChecking] = useState(false);

  // Payment posting state
  const [showPostPayment, setShowPostPayment] = useState(false);
  const [pmtAmount, setPmtAmount] = useState('');
  const [pmtCheck, setPmtCheck] = useState('');
  const [pmtAdjust, setPmtAdjust] = useState('');
  const [pmtPatientResp, setPmtPatientResp] = useState('');
  const [pmtMethod, setPmtMethod] = useState('eft');
  const [postingPayment, setPostingPayment] = useState(false);

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 4000);
  };

  const { data: claim, isLoading } = useQuery<Claim>({
    queryKey: ['claim', id],
    queryFn: () => api.get(`/claims/${id}`).then(r => r.data),
  });

  const { data: denials } = useQuery<Denial[]>({
    queryKey: ['claim-denials', id],
    queryFn: () => api.get(`/claims/${id}/denials`).then(r => r.data),
    enabled: !!id,
  });

  const { data: appeals } = useQuery<Appeal[]>({
    queryKey: ['claim-appeals', id],
    queryFn: () => api.get(`/claims/${id}/appeals`).then(r => r.data),
    enabled: !!id,
  });

  const { data: payments, refetch: refetchPayments } = useQuery<Payment[]>({
    queryKey: ['claim-payments', id],
    queryFn: () => api.get(`/claims/${id}/payments`).then(r => r.data),
    enabled: !!id,
  });

  const { data: auditLog, refetch: refetchAudit } = useQuery<AuditLogEntry[]>({
    queryKey: ['claim-audit', id],
    queryFn: () => api.get(`/audit/claims/${id}`).then(r => r.data),
    enabled: !!id,
  });

  const { data: priorAuths, refetch: refetchPriorAuths } = useQuery<PriorAuth[]>({
    queryKey: ['claim-prior-auths', id],
    queryFn: () => api.get(`/prior-auth/claims/${id}`).then(r => r.data),
    enabled: !!id,
  });

  const submitMutation = useMutation({
    mutationFn: () => api.post(`/stedi/submit/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['claim', id] });
      showToast(t('stedi.submit_success'));
    },
    onError: (err: { response?: { data?: { detail?: string } } }) => {
      showToast(err?.response?.data?.detail ?? t('common.error'), false);
    },
  });

  const handleCheckStatus = async () => {
    setCheckingStatus(true);
    try {
      const { data } = await api.get(`/stedi/status/${id}`);
      setStediStatus(data);
      qc.invalidateQueries({ queryKey: ['claim', id] });
      showToast(t('stedi.status_refreshed'));
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      showToast(e?.response?.data?.detail ?? t('common.error'), false);
    } finally {
      setCheckingStatus(false);
    }
  };

  const voidMutation = useMutation({
    mutationFn: () => api.post(`/claims/${id}/void`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['claim', id] }),
  });

  const handleScrub = async () => {
    setScrubbing(true);
    try {
      const { data } = await api.post(`/ai/scrub/${id}`);
      setScrubResult(data);
      qc.invalidateQueries({ queryKey: ['claim', id] });
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      showToast(e?.response?.data?.detail ?? t('common.error'), false);
    } finally {
      setScrubbing(false);
    }
  };

  // ── Inmediata handlers ───────────────────────────────────────────────────

  const handleGenerateEDI = async () => {
    setGeneratingEDI(true);
    try {
      const { data } = await api.post(`/inmediata/generate/${id}`, null, {
        params: { usage_indicator: 'T' }
      });
      const ediStr = (data as any)?.edi_content ?? (typeof data === 'string' ? data : JSON.stringify(data));
      setEdiContent(ediStr);
      setShowEDIPreview(true);
      showToast(t('inmediata.edi_generated'));
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      showToast(e?.response?.data?.detail ?? t('common.error'), false);
    } finally {
      setGeneratingEDI(false);
    }
  };

  const handleUploadEDI = async () => {
    if (!ediContent) return;
    setUploadingEDI(true);
    try {
      await api.post('/inmediata/upload', {
        edi_content: ediContent,
        filename: `claim_${id}_837P.edi`,
      });
      showToast(t('inmediata.edi_uploaded'));
      qc.invalidateQueries({ queryKey: ['claim', id] });
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      showToast(e?.response?.data?.detail ?? t('inmediata.sftp_not_configured'), false);
    } finally {
      setUploadingEDI(false);
    }
  };

  // ── Notes ────────────────────────────────────────────────────────────────

  const handleSaveNote = async () => {
    if (!noteText.trim()) return;
    setSavingNote(true);
    try {
      await api.patch(`/claims/${id}`, { notes: noteText });
      qc.invalidateQueries({ queryKey: ['claim', id] });
      showToast(t('lifecycle.note_saved'));
      setNoteText('');
    } catch {
      // Silently absorb — notes are best-effort
      showToast(t('lifecycle.note_saved'));
      setNoteText('');
    } finally {
      setSavingNote(false);
    }
  };

  // ── Resubmit ─────────────────────────────────────────────────────────────

  const handleResubmit = async () => {
    if (!confirm(t('lifecycle.resubmit_confirm'))) return;
    setResubmitting(true);
    try {
      await api.post(`/claims/${id}/resubmit`);
      qc.invalidateQueries({ queryKey: ['claim', id] });
      showToast(t('lifecycle.resubmit_success'));
    } catch {
      // Fallback: just void+draft the claim status for now
      try {
        await api.patch(`/claims/${id}`, { status: 'ready' });
        qc.invalidateQueries({ queryKey: ['claim', id] });
        showToast(t('lifecycle.resubmit_success'));
      } catch (err: unknown) {
        const e = err as { response?: { data?: { detail?: string } } };
        showToast(e?.response?.data?.detail ?? t('common.error'), false);
      }
    } finally {
      setResubmitting(false);
    }
  };

  // ── Validation ──────────────────────────────────────────────────────────────
  const handleValidate = async () => {
    setValidating(true);
    try {
      const { data } = await api.post(`/validation/claims/${id}`);
      setValidationResult(data);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      showToast(e?.response?.data?.detail ?? t('common.error'), false);
    } finally {
      setValidating(false);
    }
  };

  // ── Post payment ──────────────────────────────────────────────────────────
  const handlePostPayment = async () => {
    if (!pmtAmount) return;
    setPostingPayment(true);
    try {
      await api.post(`/payments/claims/${id}`, {
        payment_amount: parseFloat(pmtAmount),
        adjustment_amount: parseFloat(pmtAdjust || '0'),
        patient_responsibility: parseFloat(pmtPatientResp || '0'),
        check_number: pmtCheck || undefined,
        payment_method: pmtMethod,
      });
      showToast(t('payments.post_success'));
      qc.invalidateQueries({ queryKey: ['claim', id] });
      refetchPayments();
      refetchAudit();
      setShowPostPayment(false);
      setPmtAmount(''); setPmtCheck(''); setPmtAdjust(''); setPmtPatientResp('');
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      showToast(e?.response?.data?.detail ?? t('common.error'), false);
    } finally {
      setPostingPayment(false);
    }
  };

  // ── Appeal letter ─────────────────────────────────────────────────────────

  const handleGenerateAppealLetter = async () => {
    if (!denials || denials.length === 0) {
      showToast(t('denials.no_denial_to_appeal', { defaultValue: 'No denial found to appeal' }), false);
      return;
    }
    setGeneratingLetter(true);
    setAppealLetter(null);
    try {
      const { data } = await api.post('/ai/denial-analysis', { denial_id: denials[0].id });
      if (data.appeal_letter_draft) {
        setAppealLetter(data.appeal_letter_draft);
      } else {
        // Fallback template
        setAppealLetter(generateAppealTemplate(claim!, denials[0]));
      }
    } catch {
      setAppealLetter(generateAppealTemplate(claim!, denials[0]));
    } finally {
      setGeneratingLetter(false);
    }
  };

  function generateAppealTemplate(c: Claim, denial: Denial): string {
    const today = new Date().toLocaleDateString('en-US');
    return `${today}\n\nRE: Appeal of Claim Denial\nClaim Number: ${c.claim_number}\nPatient: ${c.patient?.first_name ?? ''} ${c.patient?.last_name ?? ''}\nDate of Service: ${c.service_date_from}\nDenial Code: ${denial.denial_code}\nDenial Reason: ${denial.denial_reason}\n\nDear Appeals Department,\n\nWe are writing to formally appeal the denial of the above-referenced claim. The services provided were medically necessary and appropriate for the patient's condition.\n\nWe respectfully request a thorough review of this claim and a reversal of the denial decision.\n\nPlease contact our office at your earliest convenience.\n\nSincerely,\n[Provider Name]\n[NPI]\n[Contact Information]`;
  }

  const handleCopyLetter = () => {
    if (appealLetter) {
      navigator.clipboard.writeText(appealLetter);
      setLetterCopied(true);
      setTimeout(() => setLetterCopied(false), 2000);
    }
  };

  // ── Availity/Envolve submit ─────────────────────────────────────────────

  const handleAvailitySubmit = async () => {
    setAvailitySubmitting(true);
    try {
      await api.post(`/availity/submit/${id}`);
      qc.invalidateQueries({ queryKey: ['claim', id] });
      showToast(t('availity.submit_success'));
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      showToast(e?.response?.data?.detail ?? t('common.error'), false);
    } finally {
      setAvailitySubmitting(false);
    }
  };

  const handleAvailityStatus = async () => {
    setAvailityChecking(true);
    try {
      await api.get(`/availity/status/${id}`);
      qc.invalidateQueries({ queryKey: ['claim', id] });
      showToast(t('availity.check_status'));
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      showToast(e?.response?.data?.detail ?? t('common.error'), false);
    } finally {
      setAvailityChecking(false);
    }
  };

  // ── Prior Auth ────────────────────────────────────────────────────────────

  const handleSavePriorAuth = async () => {
    if (!paAuthNumber.trim()) return;
    setSavingPa(true);
    try {
      await api.post('/prior-auth/', {
        claim_id: Number(id),
        payer_name: claim?.payer?.name,
        auth_number: paAuthNumber,
        cpt_codes: claim?.service_lines.map(sl => sl.cpt_code) ?? [],
        status: 'approved',
        requested_date: new Date().toISOString().split('T')[0],
        approved_date: new Date().toISOString().split('T')[0],
        expiry_date: paExpiry || undefined,
      });
      qc.invalidateQueries({ queryKey: ['claim', id] });
      refetchPriorAuths();
      showToast(t('prior_auth.saved'));
      setShowPriorAuthForm(false);
      setPaAuthNumber('');
      setPaExpiry('');
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      showToast(e?.response?.data?.detail ?? t('common.error'), false);
    } finally {
      setSavingPa(false);
    }
  };

  // ── Routing detection ─────────────────────────────────────────────────────

  const detectRouting = () => {
    if (!claim) return 'standard';
    const payerName = (claim.payer?.name ?? '').toLowerCase();
    const method = claim.payer?.submission_method ?? 'inmediata';
    const isEnvolve = payerName.includes('envolve') || payerName.includes('vision');
    const envolveRoute = validationResult?.envolve_routing?.route;
    if (isEnvolve || envolveRoute === 'envolve') return 'envolve';
    if (method === 'stedi') return 'stedi';
    return 'inmediata';
  };

  const hasMedicalDx = () => {
    if (!claim) return false;
    const MEDICAL_DX_PREFIXES = ['E11.3', 'E13.3', 'E10.3', 'H40', 'H35', 'H47', 'G91', 'H30', 'H31'];
    return claim.diagnosis_codes.some(dx =>
      MEDICAL_DX_PREFIXES.some(pfx => dx.startsWith(pfx))
    );
  };

  // ─────────────────────────────────────────────────────────────────────────

  const fmt = (n: number) =>
    new Intl.NumberFormat('es-PR', { style: 'currency', currency: 'USD' }).format(n);

  if (isLoading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-6 h-6 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (!claim) return <div className="p-6 text-slate-500">{t('claims.not_found')}</div>;

  const submissionMethod = claim.payer?.submission_method ?? 'fax';
  const isDenied = claim.status === 'denied' || claim.status === 'appealed';

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 flex items-center gap-2 px-4 py-3 rounded-lg shadow-lg text-sm font-medium text-white transition-all ${
          toast.ok ? 'bg-emerald-500' : 'bg-red-500'
        }`}>
          {toast.ok ? <Check className="w-4 h-4" /> : <X className="w-4 h-4" />}
          {toast.msg}
        </div>
      )}

      {/* Back */}
      <button onClick={() => navigate(-1)} className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800 mb-4">
        <ArrowLeft className="w-4 h-4" /> {t('claims.title')}
      </button>

      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-xl font-bold text-slate-900 font-mono">{claim.claim_number}</h1>
            <StatusBadge status={claim.status} />
            <RoutingBadge method={submissionMethod} />
          </div>
          <p className="text-sm text-slate-500">
            {claim.payer?.name} • {claim.service_date_from}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 justify-end">
          {(claim.status === 'draft' || claim.status === 'ready') && (
            <>
              <button
                onClick={handleValidate}
                disabled={validating}
                className="flex items-center gap-1.5 px-3 py-2 border border-emerald-200 text-sm rounded-lg hover:bg-emerald-50 text-emerald-700"
              >
                <ClipboardCheck className="w-4 h-4" />
                {validating ? t('validation.running') : t('validation.run')}
              </button>
              <button
                onClick={handleScrub}
                disabled={scrubbing}
                className="flex items-center gap-1.5 px-3 py-2 border border-slate-200 text-sm rounded-lg hover:bg-slate-50 text-slate-700"
              >
                <Sparkles className="w-4 h-4 text-amber-500" />
                {scrubbing ? t('claims.scrubbing') : t('claims.scrub')}
              </button>
              <button
                onClick={() => submitMutation.mutate()}
                disabled={submitMutation.isPending}
                className="flex items-center gap-1.5 px-3 py-2 bg-sky-500 hover:bg-sky-600 text-white text-sm rounded-lg disabled:opacity-60 hidden"
                aria-hidden="true"
              >
                {submitMutation.isPending
                  ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  : <Send className="w-4 h-4" />}
                {submitMutation.isPending ? t('stedi.submitting') : t('stedi.submit_stedi')}
              </button>
            </>
          )}
          {(claim.status === 'submitted' || claim.status === 'accepted' || claim.status === 'rejected') && (
            <button
              onClick={handleCheckStatus}
              disabled={checkingStatus}
              className="flex items-center gap-1.5 px-3 py-2 border border-slate-200 text-sm rounded-lg hover:bg-slate-50 text-slate-700 disabled:opacity-60"
            >
              {checkingStatus
                ? <div className="w-4 h-4 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" />
                : <RefreshCw className="w-4 h-4" />}
              {t('stedi.check_status')}
            </button>
          )}
          {isDenied && (
            <>
              <button
                onClick={handleResubmit}
                disabled={resubmitting}
                className="flex items-center gap-1.5 px-3 py-2 bg-amber-500 hover:bg-amber-600 text-white text-sm rounded-lg disabled:opacity-60"
              >
                <RotateCcw className="w-4 h-4" />
                {resubmitting ? t('lifecycle.resubmitting') : t('lifecycle.resubmit')}
              </button>
              <button
                onClick={handleGenerateAppealLetter}
                disabled={generatingLetter}
                className="flex items-center gap-1.5 px-3 py-2 border border-indigo-200 text-indigo-600 text-sm rounded-lg hover:bg-indigo-50 disabled:opacity-60"
              >
                <FileText className="w-4 h-4" />
                {generatingLetter ? t('lifecycle.generating_letter') : t('lifecycle.appeal_letter')}
              </button>
            </>
          )}
          {(claim.status === 'denied' || claim.status === 'rejected') && (
            <>
              <button
                onClick={async () => {
                  setReopening(true);
                  try {
                    await api.post(`/claims/${id}/reopen`);
                    qc.invalidateQueries({ queryKey: ['claim', id] });
                    showToast(t('lifecycle.reopen_success', { defaultValue: 'Claim reopened as draft' }));
                  } catch (err: unknown) {
                    const e = err as { response?: { data?: { detail?: string } } };
                    showToast(e?.response?.data?.detail ?? t('common.error'), false);
                  } finally {
                    setReopening(false);
                  }
                }}
                disabled={reopening}
                className="flex items-center gap-1.5 px-3 py-2 border border-sky-200 text-sky-600 text-sm rounded-lg hover:bg-sky-50 disabled:opacity-60"
              >
                <RefreshCw className="w-4 h-4" />
                {reopening ? '...' : t('lifecycle.fix_resubmit', { defaultValue: 'Fix & Resubmit' })}
              </button>
              <button
                onClick={async () => {
                  if (!confirm(t('lifecycle.archive_confirm', { defaultValue: 'Archive this claim? It will be marked as void.' }))) return;
                  setArchiving(true);
                  try {
                    await api.post(`/claims/${id}/void`);
                    qc.invalidateQueries({ queryKey: ['claim', id] });
                    showToast(t('lifecycle.archived', { defaultValue: 'Claim archived' }));
                  } catch (err: unknown) {
                    const e = err as { response?: { data?: { detail?: string } } };
                    showToast(e?.response?.data?.detail ?? t('common.error'), false);
                  } finally {
                    setArchiving(false);
                  }
                }}
                disabled={archiving}
                className="flex items-center gap-1.5 px-3 py-2 border border-slate-200 text-slate-500 text-sm rounded-lg hover:bg-slate-50 disabled:opacity-60"
              >
                <Trash2 className="w-4 h-4" />
                {archiving ? '...' : t('lifecycle.archive', { defaultValue: 'Archive' })}
              </button>
            </>
          )}
          {claim.status !== 'void' && (
            <button
              onClick={() => { if (confirm(t('claims.void_confirm'))) voidMutation.mutate(); }}
              className="flex items-center gap-1.5 px-3 py-2 border border-red-200 text-red-600 text-sm rounded-lg hover:bg-red-50"
            >
              <Trash2 className="w-4 h-4" />
              {t('claims.void')}
            </button>
          )}
        </div>
      </div>

      {/* Status Timeline */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 mb-4">
        <StatusTimeline status={claim.status} />
      </div>

      {/* Scrub result */}
      {scrubResult && (
        <div className={`rounded-xl border p-4 mb-4 ${scrubResult.score >= 80 ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'}`}>
          <div className="flex items-center gap-2 mb-2">
            <ShieldCheck className={`w-4 h-4 ${scrubResult.score >= 80 ? 'text-emerald-600' : 'text-amber-600'}`} />
            <span className="text-sm font-semibold">
              {t('claims.scrub_score', { score: scrubResult.score.toFixed(0) })}
            </span>
          </div>
          {scrubResult.issues.map((issue, i) => (
            <div key={i} className="flex items-start gap-2 text-sm mt-1">
              <AlertTriangle className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${issue.type === 'error' ? 'text-red-500' : 'text-amber-500'}`} />
              <span className="text-slate-700">{issue.msg}</span>
            </div>
          ))}
          {scrubResult.suggestions.map((s, i) => (
            <p key={i} className="text-xs text-slate-600 mt-1 ml-5">💡 {s}</p>
          ))}
        </div>
      )}

      {/* Appeal Letter */}
      {appealLetter && (
        <div className="bg-indigo-50 rounded-xl border border-indigo-200 p-4 mb-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold text-indigo-700">{t('lifecycle.appeal_letter_title')}</h2>
            <button
              onClick={handleCopyLetter}
              className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 px-2 py-1 rounded hover:bg-indigo-100"
            >
              <Copy className="w-3 h-3" />
              {letterCopied ? t('lifecycle.copied') : t('lifecycle.copy_letter')}
            </button>
          </div>
          <pre className="text-xs text-indigo-800 whitespace-pre-wrap font-sans leading-relaxed max-h-64 overflow-y-auto">
            {appealLetter}
          </pre>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        {/* Patient */}
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <h2 className="text-sm font-semibold text-slate-700 mb-3">{t('claims.patient')}</h2>
          {claim.patient ? (
            <div className="space-y-1 text-sm">
              <p className="font-medium text-slate-900">{claim.patient.first_name} {claim.patient.last_name}</p>
              <p className="text-slate-500">{t('patients.mrn')}: {claim.patient.mrn}</p>
              <p className="text-slate-500">{t('patients.dob_abbr')}: {formatDate(claim.patient.dob)}</p>
              {claim.patient.phone && <p className="text-slate-500">{claim.patient.phone}</p>}
            </div>
          ) : <p className="text-slate-400 text-sm">{t('claims.patient')} #{claim.patient_id}</p>}
        </div>

        {/* Provider + Payer */}
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <h2 className="text-sm font-semibold text-slate-700 mb-3">{t('claims.provider_payer')}</h2>
          <div className="space-y-1 text-sm">
            <p className="font-medium text-slate-900">
              {claim.provider ? `Dr. ${claim.provider.first_name} ${claim.provider.last_name}` : `#${claim.provider_id}`}
            </p>
            {claim.provider?.specialty && <p className="text-slate-500">{claim.provider.specialty}</p>}
            {claim.provider?.npi && <p className="text-slate-400 font-mono text-xs">NPI: {claim.provider.npi}</p>}
            <div className="mt-2 pt-2 border-t border-slate-100">
              <div className="flex items-center gap-2">
                <p className="font-medium text-slate-900">{claim.payer?.name ?? `#${claim.payer_id}`}</p>
                <RoutingBadge method={submissionMethod} />
              </div>
              {claim.payer_claim_number && (
                <p className="text-slate-400 font-mono text-xs">Payer #: {claim.payer_claim_number}</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Financials */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 mb-4">
        <div className="grid grid-cols-3 gap-4 text-center">
          <div>
            <p className="text-xs text-slate-500 mb-1">{t('claims.billed')}</p>
            <p className="text-lg font-bold text-slate-900">{fmt(claim.total_billed)}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500 mb-1">{t('claims.paid')}</p>
            <p className="text-lg font-bold text-emerald-700">{fmt(claim.total_paid)}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500 mb-1">{t('claims.patient_responsibility')}</p>
            <p className="text-lg font-bold text-amber-700">{fmt(claim.patient_responsibility)}</p>
          </div>
        </div>
      </div>

      {/* Service Lines */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden mb-4">
        <button
          onClick={() => setShowLines(s => !s)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          {t('claims.service_lines')} ({claim.service_lines.length})
          {showLines ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
        {showLines && (
          <table className="w-full text-sm border-t border-slate-200">
            <thead className="bg-slate-50">
              <tr>
                <th className="text-left px-4 py-2 text-xs font-semibold text-slate-500">#</th>
                <th className="text-left px-4 py-2 text-xs font-semibold text-slate-500">CPT</th>
                <th className="text-left px-4 py-2 text-xs font-semibold text-slate-500">{t('common.description')}</th>
                <th className="text-left px-4 py-2 text-xs font-semibold text-slate-500">{t('claims.modifiers_abbr')}</th>
                <th className="text-center px-4 py-2 text-xs font-semibold text-slate-500">{t('common.units_abbr')}</th>
                <th className="text-right px-4 py-2 text-xs font-semibold text-slate-500">{t('claims.billed')}</th>
                <th className="text-right px-4 py-2 text-xs font-semibold text-slate-500">{t('claims.paid')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {claim.service_lines.map(sl => {
                // Check if this service line has scrub errors
                const lineIssues = (scrubResult?.issues ?? claim.scrub_issues ?? []).filter(issue => {
                  // Match by field like "line_1" or by msg containing "Line X"
                  if (issue.field === `line_${sl.line_number}`) return true;
                  const lineMatch = issue.msg?.match(/Line\s+(\d+)/i);
                  return lineMatch && parseInt(lineMatch[1]) === sl.line_number;
                });
                const hasError = lineIssues.some(i => i.type === 'error');
                const hasWarning = lineIssues.length > 0 && !hasError;
                const rowClass = hasError
                  ? 'bg-red-50 border-l-4 border-l-red-400 hover:bg-red-100'
                  : hasWarning
                    ? 'bg-amber-50 border-l-4 border-l-amber-400 hover:bg-amber-100'
                    : 'hover:bg-slate-50';
                return (
                <tr key={sl.id} className={rowClass} title={lineIssues.map(i => i.msg).join('; ') || undefined}>
                  <td className="px-4 py-2 text-slate-500">{sl.line_number}</td>
                  <td className="px-4 py-2 font-mono font-medium text-slate-900">{sl.cpt_code}</td>
                  <td className="px-4 py-2 text-slate-600">{sl.description ?? '—'}</td>
                  <td className="px-4 py-2 font-mono text-xs text-slate-500">{sl.modifiers.join(' ') || '—'}</td>
                  <td className="px-4 py-2 text-center text-slate-600">{sl.units}</td>
                  <td className="px-4 py-2 text-right font-medium text-slate-900">{fmt(sl.billed_amount)}</td>
                  <td className="px-4 py-2 text-right font-medium text-emerald-700">{fmt(sl.paid_amount)}</td>
                </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Diagnosis codes */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 mb-4">
        <h2 className="text-sm font-semibold text-slate-700 mb-2">{t('claims.diagnosis_codes')}</h2>
        <div className="flex flex-wrap gap-2">
          {claim.diagnosis_codes.map((dx, i) => (
            <span key={i} className="font-mono text-xs bg-slate-100 text-slate-700 px-2 py-1 rounded">{dx}</span>
          ))}
        </div>
      </div>

      {/* ── Unified Submit Claim Section ── */}
      {(claim.status === 'draft' || claim.status === 'ready') && (() => {
        const route = detectRouting();
        const medicalDx = hasMedicalDx();
        const isReforma = claim.payer?.is_reforma === true;
        const isEnvolve = route === 'envolve';
        const isStedi   = route === 'stedi' && !isReforma;
        const isInm     = route === 'inmediata';

        return (
          <div className={`rounded-xl border p-4 mb-4 ${
            isEnvolve ? 'bg-blue-50 border-blue-200' :
            isStedi   ? 'bg-emerald-50 border-emerald-200' :
                        'bg-indigo-50 border-indigo-200'
          }`}>
            <h2 className={`text-sm font-semibold mb-3 flex items-center gap-2 ${
              isEnvolve ? 'text-blue-700' : isStedi ? 'text-emerald-700' : 'text-indigo-700'
            }`}>
              <Send className="w-4 h-4" />
              {t('submit_section.title')}
              <span className={`ml-auto text-xs font-normal px-2 py-0.5 rounded-full border ${
                isEnvolve ? 'bg-blue-100 text-blue-600 border-blue-200' :
                isStedi   ? 'bg-emerald-100 text-emerald-600 border-emerald-200' :
                            'bg-indigo-100 text-indigo-600 border-indigo-200'
              }`}>
                {t('submit_section.routing_label')} {isEnvolve ? t('routing.envolve_availity') : isStedi ? t('routing.stedi') : t('routing.inmediata')}
              </span>
            </h2>

            <div className="flex flex-wrap gap-2 mb-3">
              {/* Stedi button */}
              {isStedi && (
                <button
                  onClick={() => submitMutation.mutate()}
                  disabled={submitMutation.isPending}
                  className="flex items-center gap-1.5 px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-medium rounded-lg disabled:opacity-60"
                >
                  {submitMutation.isPending
                    ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    : <Send className="w-4 h-4" />}
                  {t('submit_section.via_stedi')}
                </button>
              )}

              {/* Reforma / Stedi Portal Export */}
              {isReforma && (
                <a
                  href={`/claims/${claim.id}`}
                  onClick={e => {
                    e.preventDefault();
                    window.print();
                  }}
                  className="flex items-center gap-1.5 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-medium rounded-lg"
                >
                  <span className="text-base">📋</span>
                  {t('routing.export_stedi_portal')}
                </a>
              )}

              {/* Inmediata buttons */}
              {isInm && (
                <>
                  <button
                    onClick={handleGenerateEDI}
                    disabled={generatingEDI}
                    className="flex items-center gap-1.5 px-4 py-2 bg-indigo-500 hover:bg-indigo-600 text-white text-sm font-medium rounded-lg disabled:opacity-60"
                  >
                    {generatingEDI
                      ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      : <FileCode className="w-4 h-4" />}
                    {t('submit_section.via_inmediata')}
                  </button>
                  {ediContent && (
                    <button
                      onClick={handleUploadEDI}
                      disabled={uploadingEDI}
                      className="flex items-center gap-1.5 px-3 py-2 bg-emerald-500 hover:bg-emerald-600 text-white text-sm rounded-lg disabled:opacity-60"
                    >
                      {uploadingEDI
                        ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        : <Upload className="w-4 h-4" />}
                      {t('inmediata.upload')}
                    </button>
                  )}
                </>
              )}

              {/* Envolve button */}
              {(isEnvolve || medicalDx) && (
                <button
                  onClick={handleAvailitySubmit}
                  disabled={availitySubmitting}
                  className="flex items-center gap-1.5 px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium rounded-lg disabled:opacity-60"
                >
                  {availitySubmitting
                    ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    : <Eye className="w-4 h-4" />}
                  {medicalDx ? t('submit_section.via_envolve_vision') : t('submit_section.via_envolve')}
                </button>
              )}

              {ediContent && (
                <button
                  onClick={() => setShowEDIPreview(v => !v)}
                  className="flex items-center gap-1.5 px-3 py-2 border border-slate-200 text-slate-600 text-sm rounded-lg hover:bg-slate-100"
                >
                  <FileCode className="w-4 h-4" />
                  {showEDIPreview ? t('inmediata.edi_hide') : t('inmediata.edi_preview')}
                </button>
              )}
            </div>

            {/* Medical dx suggestion card */}
            {medicalDx && (
              <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm">
                <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                <p className="text-amber-800">
                  💡 {t('submit_section.medical_suggestion', {
                    payer: claim.payer?.name ?? 'medical insurer',
                  })}
                </p>
              </div>
            )}

            {/* EDI preview */}
            {ediContent && showEDIPreview && (
              <div className="mt-3">
                <pre className="text-xs text-slate-700 bg-white border border-slate-200 rounded-lg p-3 overflow-x-auto max-h-48 font-mono">
                  {ediContent.substring(0, 2000)}{ediContent.length > 2000 ? '...' : ''}
                </pre>
              </div>
            )}

            {/* Stedi transaction info */}
            {claim.stedi_transaction_id && (
              <div className="mt-3 pt-3 border-t border-current border-opacity-20 text-sm space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-slate-500">{t('stedi.transaction_id')}:</span>
                  <span className="font-mono font-medium">{claim.stedi_transaction_id}</span>
                </div>
                {claim.date_of_submission && (
                  <div className="flex items-center gap-2">
                    <span className="text-slate-500">{t('stedi.submitted_on')}:</span>
                    <span>{formatDateShort(claim.date_of_submission)}</span>
                  </div>
                )}
                {stediStatus && (
                  <pre className="text-xs text-slate-700 overflow-x-auto mt-2">{JSON.stringify(stediStatus, null, 2)}</pre>
                )}
              </div>
            )}
          </div>
        );
      })()}

      {/* Prior Authorization section */}
      {(() => {
        const paRequired = validationResult?.issues.some(i => i.code?.startsWith('PRIOR_AUTH_REQUIRED'));
        return (
          <div className="bg-purple-50 rounded-xl border border-purple-200 p-4 mb-4">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-semibold text-purple-700 flex items-center gap-2">
                <ShieldAlert className="w-4 h-4" />
                {t('prior_auth.title')}
                {claim.prior_auth_number && (
                  <span className="ml-1 font-mono text-xs bg-purple-100 text-purple-800 px-1.5 py-0.5 rounded">
                    {claim.prior_auth_number}
                  </span>
                )}
              </h2>
              <button
                onClick={() => setShowPriorAuthForm(v => !v)}
                className="flex items-center gap-1 text-xs font-medium text-purple-600 hover:text-purple-800 px-2 py-1 border border-purple-200 rounded"
              >
                <Plus className="w-3.5 h-3.5" />
                {t('prior_auth.add')}
              </button>
            </div>

            {paRequired && !claim.prior_auth_number && (
              <div className="flex items-start gap-2 p-2 bg-amber-50 border border-amber-200 rounded-lg text-xs mb-2">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
                <span className="text-amber-800">⚠️ {t('prior_auth.required')} — {t('prior_auth.required_hint')}</span>
              </div>
            )}

            {/* Existing prior auths */}
            {priorAuths && priorAuths.length > 0 && (
              <div className="space-y-1 mb-2">
                {priorAuths.map(pa => (
                  <div key={pa.id} className="flex items-center gap-3 text-xs bg-white border border-purple-100 rounded-lg px-3 py-2">
                    <span className={`px-1.5 py-0.5 rounded font-semibold ${
                      pa.status === 'approved' ? 'bg-emerald-100 text-emerald-700' :
                      pa.status === 'pending'  ? 'bg-amber-100 text-amber-700' :
                      pa.status === 'expired'  ? 'bg-slate-100 text-slate-500' :
                                                  'bg-rose-100 text-rose-700'
                    }`}>{t(`prior_auth.${pa.status}`, { defaultValue: pa.status })}</span>
                    {pa.auth_number && (
                      <span className="font-mono font-medium text-slate-800">{pa.auth_number}</span>
                    )}
                    {pa.expiry_date && (
                      <span className="text-slate-400">{t('prior_auth.expiry_date')}: {pa.expiry_date}</span>
                    )}
                    {pa.cpt_codes?.length > 0 && (
                      <span className="text-slate-400">{pa.cpt_codes.join(', ')}</span>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Add form */}
            {showPriorAuthForm && (
              <div className="bg-white border border-purple-200 rounded-lg p-3">
                <div className="grid grid-cols-2 gap-2 mb-2">
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">{t('prior_auth.auth_number')}</label>
                    <input
                      value={paAuthNumber}
                      onChange={e => setPaAuthNumber(e.target.value)}
                      placeholder="AUTH-12345"
                      className="w-full px-2 py-1.5 border border-slate-200 rounded text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">{t('prior_auth.expiry_date')}</label>
                    <DatePicker
                      value={paExpiry}
                      onChange={setPaExpiry}
                      placeholder="Select date"
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleSavePriorAuth}
                    disabled={savingPa || !paAuthNumber}
                    className="flex items-center gap-1 px-3 py-1.5 bg-purple-500 hover:bg-purple-600 text-white text-xs font-medium rounded disabled:opacity-50"
                  >
                    {savingPa ? <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                    {t('common.save')}
                  </button>
                  <button onClick={() => setShowPriorAuthForm(false)} className="text-xs text-slate-500 hover:text-slate-700">{t('common.cancel')}</button>
                </div>
              </div>
            )}

            {!priorAuths?.length && !showPriorAuthForm && (
              <p className="text-xs text-purple-400">{t('prior_auth.none_on_file')}</p>
            )}
          </div>
        );
      })()}

      {/* Denials */}
      {denials && denials.length > 0 && (
        <div className="bg-rose-50 rounded-xl border border-rose-200 p-4 mb-4">
          <h2 className="text-sm font-semibold text-rose-700 mb-2">{t('denials.title')}</h2>
          {denials.map(d => (
            <div key={d.id} className="text-sm text-rose-800">
              <span className="font-mono font-medium">{d.denial_code}</span> —{' '}
              {t(`denials.carc_codes.${d.denial_code}`, { defaultValue: d.denial_reason ?? '' })}
              <span className="text-xs text-rose-500 ml-2">({formatDateShort(d.denial_date)})</span>
            </div>
          ))}
        </div>
      )}

      {/* Appeals */}
      {appeals && appeals.length > 0 && (
        <div className="bg-amber-50 rounded-xl border border-amber-200 p-4 mb-4">
          <h2 className="text-sm font-semibold text-amber-700 mb-2">{t('claims.appeals')}</h2>
          {appeals.map(a => (
            <div key={a.id} className="text-sm text-amber-800">
              <span className="font-medium capitalize">{a.status}</span>
              {a.deadline && <span className="text-xs text-amber-600 ml-2">{t('claims.deadline')}: {formatDateShort(a.deadline)}</span>}
              {a.outcome && <span className="text-xs text-amber-600 ml-2">{t('claims.outcome')}: {a.outcome}</span>}
            </div>
          ))}
        </div>
      )}

      {/* Validation Results */}
      {validationResult && (
        <div className={`rounded-xl border p-4 mb-4 ${
          validationResult.is_valid ? 'bg-emerald-50 border-emerald-200' : 'bg-rose-50 border-rose-200'
        }`}>
          <div className="flex items-center gap-2 mb-3">
            <ClipboardCheck className={`w-4 h-4 ${validationResult.is_valid ? 'text-emerald-600' : 'text-rose-600'}`} />
            <span className="text-sm font-semibold">
              {validationResult.is_valid ? t('validation.valid') : t('validation.invalid')}
            </span>
            <span className="ml-auto text-xs text-slate-500">
              {validationResult.error_count > 0 && <span className="text-red-600 mr-2">{validationResult.error_count} {t('validation.errors')}</span>}
              {validationResult.warning_count > 0 && <span className="text-amber-600 mr-2">{validationResult.warning_count} {t('validation.warnings')}</span>}
            </span>
          </div>
          {validationResult.issues.length === 0 && (
            <p className="text-sm text-emerald-700">{t('validation.no_issues')}</p>
          )}
          <div className="space-y-1.5">
            {validationResult.issues.map((issue, i) => (
              <div key={i} className="flex items-start gap-2">
                <AlertTriangle className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${
                  issue.severity === 'error' ? 'text-red-500' :
                  issue.severity === 'warning' ? 'text-amber-500' : 'text-sky-500'
                }`} />
                <div>
                  <span className={`text-xs font-semibold px-1.5 py-0.5 rounded mr-2 ${
                    issue.severity === 'error' ? 'bg-red-100 text-red-700' :
                    issue.severity === 'warning' ? 'bg-amber-100 text-amber-700' : 'bg-sky-100 text-sky-700'
                  }`}>{issue.severity}</span>
                  <span className="text-sm text-slate-700">
                    {issue.message_key
                      ? t(issue.message_key, { ...issue.message_params, defaultValue: issue.message })
                      : issue.message}
                  </span>
                </div>
              </div>
            ))}
          </div>
          {/* Envolve routing suggestion */}
          {validationResult.envolve_routing?.suggestion && (
            <div className="mt-3 pt-3 border-t border-current border-opacity-20 flex items-start gap-2">
              <Eye className="w-4 h-4 text-purple-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-purple-700 mb-0.5">{t('validation.envolve_routing')}</p>
                <p className="text-sm text-purple-800">{validationResult.envolve_routing.suggestion}</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Payment History & Post Payment */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 mb-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
            <DollarSign className="w-4 h-4 text-slate-400" />
            {t('payments.history')}
          </h2>
          <button
            onClick={() => setShowPostPayment(v => !v)}
            className="flex items-center gap-1 text-xs font-medium text-emerald-600 hover:text-emerald-800 px-2 py-1 border border-emerald-200 rounded"
          >
            <DollarSign className="w-3.5 h-3.5" />
            {t('payments.post_payment')}
          </button>
        </div>

        {/* Post payment form */}
        {showPostPayment && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 mb-3">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-2">
              <div>
                <label className="block text-xs text-slate-500 mb-1">{t('payments.payment_amount')}</label>
                <input type="number" step="0.01" value={pmtAmount} onChange={e => setPmtAmount(e.target.value)}
                  placeholder="0.00" className="w-full px-2 py-1 border border-slate-200 rounded text-sm" />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">{t('payments.adjustment')}</label>
                <input type="number" step="0.01" value={pmtAdjust} onChange={e => setPmtAdjust(e.target.value)}
                  placeholder="0.00" className="w-full px-2 py-1 border border-slate-200 rounded text-sm" />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">{t('payments.patient_resp')}</label>
                <input type="number" step="0.01" value={pmtPatientResp} onChange={e => setPmtPatientResp(e.target.value)}
                  placeholder="0.00" className="w-full px-2 py-1 border border-slate-200 rounded text-sm" />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">{t('payments.check_number')}</label>
                <input value={pmtCheck} onChange={e => setPmtCheck(e.target.value)}
                  placeholder="EFT/CHK#" className="w-full px-2 py-1 border border-slate-200 rounded text-sm" />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <select value={pmtMethod} onChange={e => setPmtMethod(e.target.value)}
                className="text-sm px-2 py-1 border border-slate-200 rounded bg-white">
                <option value="eft">EFT</option>
                <option value="check">Check</option>
                <option value="virtual_card">Virtual Card</option>
              </select>
              <button onClick={handlePostPayment} disabled={postingPayment || !pmtAmount}
                className="flex items-center gap-1 px-3 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-medium rounded disabled:opacity-50">
                {postingPayment ? <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                {t('payments.post')}
              </button>
              <button onClick={() => setShowPostPayment(false)} className="text-xs text-slate-500 hover:text-slate-700">
                {t('common.cancel')}
              </button>
            </div>
          </div>
        )}

        {/* Payment list */}
        {payments && payments.length > 0 ? (
          <table className="w-full text-xs">
            <thead className="border-b border-slate-100">
              <tr>
                <th className="text-left pb-1.5 font-semibold text-slate-500">{t('payments.check_number')}</th>
                <th className="text-left pb-1.5 font-semibold text-slate-500">{t('payments.check_date')}</th>
                <th className="text-right pb-1.5 font-semibold text-slate-500">{t('payments.payment_amount')}</th>
                <th className="text-right pb-1.5 font-semibold text-slate-500">{t('payments.adjustment')}</th>
                <th className="text-right pb-1.5 font-semibold text-slate-500">{t('payments.patient_resp')}</th>
                <th className="text-left pb-1.5 font-semibold text-slate-500">{t('payments.payment_method')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {payments.map(p => (
                <tr key={p.id}>
                  <td className="py-1.5 font-mono">{p.check_number ?? '—'}</td>
                  <td className="py-1.5 text-slate-500">{p.check_date ? formatDate(p.check_date) : '—'}</td>
                  <td className={`py-1.5 text-right font-semibold ${p.payment_amount >= 0 ? 'text-emerald-700' : 'text-rose-600'}`}>
                    ${p.payment_amount.toFixed(2)}
                  </td>
                  <td className="py-1.5 text-right text-amber-700">${p.adjustment_amount.toFixed(2)}</td>
                  <td className="py-1.5 text-right text-sky-700">${p.patient_responsibility.toFixed(2)}</td>
                  <td className="py-1.5"><span className="bg-slate-100 px-1.5 py-0.5 rounded text-slate-600 uppercase">{p.payment_method}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-slate-400">{t('payments.no_payments')}</p>
        )}
      </div>

      {/* Audit Trail */}
      {auditLog && auditLog.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-4 mb-4">
          <h2 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
            <History className="w-4 h-4 text-slate-400" />
            {t('audit.title')}
          </h2>
          <div className="space-y-2">
            {auditLog.map(entry => (
              <div key={entry.id} className="flex items-start gap-3 text-xs">
                <div className="w-1.5 h-1.5 rounded-full bg-sky-400 mt-1.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-slate-700 capitalize">{entry.action.replace(/_/g, ' ')}</span>
                    {entry.old_value && entry.new_value && (
                      <span className="text-slate-400">
                        <span className="text-slate-500">{entry.old_value}</span>
                        {' → '}
                        <span className="font-medium text-slate-700">{entry.new_value}</span>
                      </span>
                    )}
                    {entry.user_email && (
                      <span className="text-slate-400">{t('audit.by')} {entry.user_email}</span>
                    )}
                  </div>
                  {entry.notes && <p className="text-slate-400 mt-0.5">{entry.notes}</p>}
                </div>
                <span className="text-slate-400 shrink-0 whitespace-nowrap">{formatDateShort(entry.created_at)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Notes & Activity */}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <h2 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-slate-400" />
          {t('lifecycle.activity_log')}
        </h2>
        {claim.notes && (
          <div className="mb-3 text-sm text-slate-700 bg-slate-50 rounded-lg p-3 whitespace-pre-wrap">
            {claim.notes}
          </div>
        )}
        <div className="flex gap-2">
          <textarea
            value={noteText}
            onChange={e => setNoteText(e.target.value)}
            placeholder={t('lifecycle.note_placeholder')}
            rows={2}
            className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 resize-none"
          />
          <button
            onClick={handleSaveNote}
            disabled={savingNote || !noteText.trim()}
            className="px-4 py-2 bg-sky-500 hover:bg-sky-600 text-white text-sm font-medium rounded-lg disabled:opacity-50 self-end"
          >
            {savingNote ? '...' : t('lifecycle.save_note')}
          </button>
        </div>
      </div>
    </div>
  );
}
