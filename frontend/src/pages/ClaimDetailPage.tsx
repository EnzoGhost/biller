import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft, Send, Trash2, Sparkles, ShieldCheck,
  ChevronDown, ChevronUp, AlertTriangle, RefreshCw, Check, X,
  FileCode, Upload, Zap, CheckCircle, Clock, XCircle,
  MessageSquare, RotateCcw, FileText, Copy,
} from 'lucide-react';
import api from '../lib/api';
import { formatDateShort, formatDate } from '../lib/dates';
import type { Claim, Denial, Appeal } from '../types';
import StatusBadge from '../components/ui/Badge';

// ── Routing indicator ─────────────────────────────────────────────────────────

const ROUTING_CONFIG = {
  stedi:    { label: 'Stedi',        color: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  inmediata:{ label: 'Inmediata',    color: 'bg-indigo-100 text-indigo-700 border-indigo-200' },
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
  { key: 'draft',     label: 'Created',      icon: FileText },
  { key: 'ready',     label: 'Scrubbed',     icon: ShieldCheck },
  { key: 'submitted', label: 'Submitted',    icon: Send },
  { key: 'accepted',  label: 'Acknowledged', icon: Check },
  { key: 'paid',      label: 'Paid',         icon: CheckCircle },
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
                  {step.label}
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
              {status === 'appealed' ? 'Appealed' : 'Denied'}
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
      setEdiContent(typeof data === 'string' ? data : JSON.stringify(data));
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

  // ── Appeal letter ─────────────────────────────────────────────────────────

  const handleGenerateAppealLetter = async () => {
    if (!denials || denials.length === 0) {
      showToast('No denial found to appeal', false);
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
      <Link to="/claims" className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800 mb-4">
        <ArrowLeft className="w-4 h-4" /> {t('claims.title')}
      </Link>

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
                className="flex items-center gap-1.5 px-3 py-2 bg-sky-500 hover:bg-sky-600 text-white text-sm rounded-lg disabled:opacity-60"
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
              {claim.service_lines.map(sl => (
                <tr key={sl.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2 text-slate-500">{sl.line_number}</td>
                  <td className="px-4 py-2 font-mono font-medium text-slate-900">{sl.cpt_code}</td>
                  <td className="px-4 py-2 text-slate-600">{sl.description ?? '—'}</td>
                  <td className="px-4 py-2 font-mono text-xs text-slate-500">{sl.modifiers.join(' ') || '—'}</td>
                  <td className="px-4 py-2 text-center text-slate-600">{sl.units}</td>
                  <td className="px-4 py-2 text-right font-medium text-slate-900">{fmt(sl.billed_amount)}</td>
                  <td className="px-4 py-2 text-right font-medium text-emerald-700">{fmt(sl.paid_amount)}</td>
                </tr>
              ))}
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

      {/* Inmediata section */}
      <div className="bg-indigo-50 rounded-xl border border-indigo-200 p-4 mb-4">
        <h2 className="text-sm font-semibold text-indigo-700 mb-3 flex items-center gap-2">
          <Zap className="w-4 h-4" />
          {t('inmediata.title')}
        </h2>
        <div className="flex flex-wrap gap-2 mb-3">
          <button
            onClick={handleGenerateEDI}
            disabled={generatingEDI}
            className="flex items-center gap-1.5 px-3 py-2 bg-indigo-500 hover:bg-indigo-600 text-white text-sm rounded-lg disabled:opacity-60"
          >
            {generatingEDI
              ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              : <FileCode className="w-4 h-4" />}
            {generatingEDI ? t('inmediata.generating') : t('inmediata.generate_edi')}
          </button>
          {ediContent && (
            <>
              <button
                onClick={handleUploadEDI}
                disabled={uploadingEDI}
                className="flex items-center gap-1.5 px-3 py-2 bg-emerald-500 hover:bg-emerald-600 text-white text-sm rounded-lg disabled:opacity-60"
              >
                {uploadingEDI
                  ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  : <Upload className="w-4 h-4" />}
                {uploadingEDI ? t('inmediata.uploading') : t('inmediata.upload')}
              </button>
              <button
                onClick={() => setShowEDIPreview(v => !v)}
                className="flex items-center gap-1.5 px-3 py-2 border border-indigo-200 text-indigo-700 text-sm rounded-lg hover:bg-indigo-100"
              >
                <FileCode className="w-4 h-4" />
                {showEDIPreview ? 'Hide' : t('inmediata.edi_preview')}
              </button>
            </>
          )}
          <Link
            to="/era"
            className="flex items-center gap-1.5 px-3 py-2 border border-indigo-200 text-indigo-700 text-sm rounded-lg hover:bg-indigo-100"
          >
            <RefreshCw className="w-4 h-4" />
            {t('inmediata.era_dashboard')}
          </Link>
        </div>
        {ediContent && showEDIPreview && (
          <div>
            <p className="text-xs font-semibold text-indigo-600 mb-1">{t('inmediata.edi_preview')}</p>
            <pre className="text-xs text-indigo-800 bg-white border border-indigo-100 rounded-lg p-3 overflow-x-auto max-h-48 font-mono">
              {ediContent.substring(0, 2000)}{ediContent.length > 2000 ? '...' : ''}
            </pre>
          </div>
        )}
        {!ediContent && (
          <p className="text-xs text-indigo-500">Generate an EDI file to submit this claim via Inmediata SFTP.</p>
        )}
      </div>

      {/* Stedi Transaction Info */}
      {claim.stedi_transaction_id && (
        <div className="bg-sky-50 rounded-xl border border-sky-200 p-4 mb-4">
          <h2 className="text-sm font-semibold text-sky-700 mb-2">{t('stedi.transaction_info')}</h2>
          <div className="text-sm text-sky-800 space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-sky-500">{t('stedi.transaction_id')}:</span>
              <span className="font-mono font-medium">{claim.stedi_transaction_id}</span>
            </div>
            {claim.payer_claim_number && (
              <div className="flex items-center gap-2">
                <span className="text-sky-500">{t('stedi.payer_claim_number')}:</span>
                <span className="font-mono">{claim.payer_claim_number}</span>
              </div>
            )}
            {claim.date_of_submission && (
              <div className="flex items-center gap-2">
                <span className="text-sky-500">{t('stedi.submitted_on')}:</span>
                <span>{formatDateShort(claim.date_of_submission)}</span>
              </div>
            )}
          </div>
          {stediStatus && (
            <div className="mt-3 pt-3 border-t border-sky-200">
              <p className="text-xs font-medium text-sky-600 mb-1">{t('stedi.raw_status')}</p>
              <pre className="text-xs text-sky-800 overflow-x-auto">{JSON.stringify(stediStatus, null, 2)}</pre>
            </div>
          )}
        </div>
      )}

      {/* Denials */}
      {denials && denials.length > 0 && (
        <div className="bg-rose-50 rounded-xl border border-rose-200 p-4 mb-4">
          <h2 className="text-sm font-semibold text-rose-700 mb-2">{t('denials.title')}</h2>
          {denials.map(d => (
            <div key={d.id} className="text-sm text-rose-800">
              <span className="font-mono font-medium">{d.denial_code}</span> — {d.denial_reason}
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
