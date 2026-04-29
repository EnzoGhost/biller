import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  Send, Zap, ChevronRight, ChevronDown, ChevronUp,
  FileText, CheckCircle, Clock, AlertTriangle, CircleDollarSign,
  Download, X, Loader2, Archive, Trash2,
} from 'lucide-react';
import api from '../lib/api';
import { formatDateShort } from '../lib/dates';
import type { ClaimStatus } from '../types';
import StatusBadge from '../components/ui/Badge';
import DatePicker from '../components/ui/DatePicker';

// ── Types ────────────────────────────────────────────────────────────────────

interface WorkQueueClaim {
  id: number;
  claim_number: string;
  status: ClaimStatus;
  patient_name: string;
  payer_name: string;
  service_date_from: string | null;
  total_billed: number;
  total_paid: number;
  days_aging: number;
  date_of_submission: string | null;
  source: string;
  notes: string | null;
  denial_reason?: string;
  denial_code?: string;
}

interface WorkQueueData {
  new: WorkQueueClaim[];
  ready: WorkQueueClaim[];
  submitted: WorkQueueClaim[];
  attention: WorkQueueClaim[];
  paid: WorkQueueClaim[];
  counts: {
    new_today: number;
    ready: number;
    attention: number;
  };
}

interface PullResult {
  patients_found: number;
  claims_created: number;
  errors: string[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (n: number) =>
  new Intl.NumberFormat('es-PR', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
  }).format(n);

// ── VistaNet Pull Modal ──────────────────────────────────────────────────────

function PullModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const { t } = useTranslation();
  const today = new Date().toISOString().split('T')[0];
  const [dateFrom, setDateFrom] = useState(today);
  const [dateTo, setDateTo] = useState(today);
  const [result, setResult] = useState<PullResult | null>(null);

  // Convert YYYY-MM-DD to Spanish format Abril/28/2026
  const MONTHS_ES: Record<string, string> = {
    '01': 'Enero', '02': 'Febrero', '03': 'Marzo', '04': 'Abril',
    '05': 'Mayo', '06': 'Junio', '07': 'Julio', '08': 'Agosto',
    '09': 'Septiembre', '10': 'Octubre', '11': 'Noviembre', '12': 'Diciembre',
  };

  const toSpanishDate = (isoDate: string): string => {
    const [year, month, day] = isoDate.split('-');
    const monthName = MONTHS_ES[month] || 'Enero';
    return `${monthName}/${parseInt(day)}/${year}`;
  };

  const pullMutation = useMutation({
    mutationFn: async () => {
      const resp = await api.post('/vistanet/pull-bitacora', {
        date_from: toSpanishDate(dateFrom),
        date_to: toSpanishDate(dateTo),
      });
      return resp.data as PullResult;
    },
    onSuccess: (data) => {
      setResult(data);
      onSuccess();
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-base font-semibold text-slate-900">
            {t('dashboard.pull_modal_title')}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">
          {!result ? (
            <>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  {t('dashboard.date_from')}
                </label>
                <DatePicker value={dateFrom} onChange={setDateFrom} />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  {t('dashboard.date_to')}
                </label>
                <DatePicker value={dateTo} onChange={setDateTo} />
              </div>
              {pullMutation.isError && (
                <div className="bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 text-sm text-rose-700">
                  {t('dashboard.pull_error')}
                </div>
              )}
            </>
          ) : (
            <div className="text-center py-4">
              <div className="w-12 h-12 bg-emerald-50 rounded-full flex items-center justify-center mx-auto mb-3">
                <CheckCircle className="w-6 h-6 text-emerald-500" />
              </div>
              <p className="text-sm font-medium text-slate-900 mb-1">
                {t('dashboard.pull_success', {
                  patients: result.patients_found,
                  claims: result.claims_created,
                })}
              </p>
              {result.errors.length > 0 && (
                <div className="mt-3 text-left bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 max-h-32 overflow-y-auto">
                  {result.errors.map((err, i) => (
                    <p key={i} className="text-xs text-amber-700">{err}</p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex justify-end gap-2">
          {!result ? (
            <>
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={() => pullMutation.mutate()}
                disabled={!dateFrom || !dateTo || pullMutation.isPending}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-sky-500 hover:bg-sky-600 text-white rounded-lg disabled:opacity-50"
              >
                {pullMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {t('dashboard.pulling')}
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4" />
                    {t('dashboard.pull')}
                  </>
                )}
              </button>
            </>
          ) : (
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium bg-sky-500 hover:bg-sky-600 text-white rounded-lg"
            >
              {t('common.ok')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Claim Card ───────────────────────────────────────────────────────────────

function ClaimCard({ claim, showAging = false, showDenialReason = false, onArchive, selected = false, onToggleSelect }: {
  claim: WorkQueueClaim;
  showAging?: boolean;
  showDenialReason?: boolean;
  onArchive?: (claimId: number) => void;
  selected?: boolean;
  onToggleSelect?: (claimId: number) => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <div
      onClick={() => navigate(`/claims/${claim.id}`)}
      className={`flex items-center justify-between py-3 px-4 bg-white rounded-xl border hover:border-slate-200 hover:shadow-sm cursor-pointer transition-all group ${
        selected ? 'border-sky-300 bg-sky-50/50' : 'border-slate-100'
      }`}
    >
      {onToggleSelect && (
        <div className="mr-3 shrink-0" onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggleSelect(claim.id)}
            className="w-4 h-4 rounded border-slate-300 text-sky-500 focus:ring-sky-500 cursor-pointer"
          />
        </div>
      )}
      <div className="flex items-center gap-4 min-w-0 flex-1">
        <StatusBadge status={claim.status} />
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-900 truncate">
            {claim.patient_name || claim.claim_number}
          </p>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-xs text-slate-400">
              {formatDateShort(claim.service_date_from)}
            </span>
            {claim.payer_name && (
              <>
                <span className="text-xs text-slate-300">·</span>
                <span className="text-xs text-slate-400 truncate max-w-[140px]">
                  {claim.payer_name}
                </span>
              </>
            )}
          </div>
          {showDenialReason && (claim.denial_reason || claim.denial_code) && (
            <p className="text-xs text-rose-500 mt-0.5 truncate">
              {claim.denial_code
                ? t(`denials.carc_codes.${claim.denial_code}`, { defaultValue: claim.denial_reason || claim.denial_code })
                : claim.denial_reason}
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3 shrink-0">
        {showAging && claim.days_aging > 0 && (
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
            claim.days_aging > 60 ? 'bg-rose-50 text-rose-600' :
            claim.days_aging > 30 ? 'bg-amber-50 text-amber-600' :
            'bg-slate-50 text-slate-500'
          }`}>
            {claim.days_aging}d
          </span>
        )}
        {onArchive && (
          <button
            onClick={(e) => { e.stopPropagation(); onArchive(claim.id); }}
            title={t('lifecycle.archive', { defaultValue: 'Archive' })}
            className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <Archive className="w-3.5 h-3.5" />
          </button>
        )}
        <span className="text-sm font-semibold text-slate-900">
          {fmt(claim.total_billed)}
        </span>
        <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-slate-400" />
      </div>
    </div>
  );
}

// ── Section ──────────────────────────────────────────────────────────────────

function Section({
  title, icon: Icon, iconColor, claims, defaultOpen = true,
  showAging = false, showDenialReason = false, headerAction, onArchive,
  selectedIds, onToggleSelect,
}: {
  title: string;
  icon: typeof FileText;
  iconColor: string;
  claims: WorkQueueClaim[];
  defaultOpen?: boolean;
  showAging?: boolean;
  showDenialReason?: boolean;
  headerAction?: React.ReactNode;
  onArchive?: (claimId: number) => void;
  selectedIds?: Set<number>;
  onToggleSelect?: (claimId: number) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(defaultOpen);

  if (claims.length === 0) return null;

  return (
    <div className="mb-6">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center justify-between w-full mb-2 group"
      >
        <div className="flex items-center gap-2">
          <Icon className={`w-4 h-4 ${iconColor}`} />
          <h2 className="text-sm font-semibold text-slate-700">
            {title}
          </h2>
          <span className="text-xs font-medium text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">
            {claims.length}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {headerAction}
          {open ? (
            <ChevronUp className="w-4 h-4 text-slate-400" />
          ) : (
            <ChevronDown className="w-4 h-4 text-slate-400" />
          )}
        </div>
      </button>
      {open && (
        <div className="space-y-2">
          {claims.map((claim) => (
            <ClaimCard
              key={claim.id}
              claim={claim}
              showAging={showAging}
              showDenialReason={showDenialReason}
              onArchive={onArchive}
              selected={selectedIds?.has(claim.id) ?? false}
              onToggleSelect={onToggleSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main Dashboard ───────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [showPullModal, setShowPullModal] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [deleting, setDeleting] = useState(false);

  const toggleSelect = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleBulkDelete = async () => {
    const count = selectedIds.size;
    if (!count) return;
    if (!confirm(`Delete ${count} claim${count > 1 ? 's' : ''}? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await api.post('/claims/bulk-delete', { claim_ids: Array.from(selectedIds) });
      setSelectedIds(new Set());
      qc.invalidateQueries({ queryKey: ['work-queue'] });
      qc.invalidateQueries({ queryKey: ['claims'] });
    } catch {
      alert('Failed to delete claims');
    } finally {
      setDeleting(false);
    }
  };

  const handleArchiveClaim = async (claimId: number) => {
    if (!confirm('Archive this claim? It will be marked as void.')) return;
    try {
      await api.post(`/claims/${claimId}/void`);
      qc.invalidateQueries({ queryKey: ['work-queue'] });
    } catch {
      alert('Failed to archive claim');
    }
  };

  const { data, isLoading } = useQuery<WorkQueueData>({
    queryKey: ['work-queue'],
    queryFn: () => api.get('/dashboard/work-queue').then(r => r.data),
    refetchInterval: 60_000,
  });

  // Bulk submit
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);

  const submitAllMutation = useMutation({
    mutationFn: async () => {
      const resp = await api.get('/claims?status=ready&per_page=100');
      const ready: { id: number; claim_number: string }[] = resp.data.items;
      if (!ready.length) return { count: 0, failed: [] as string[] };
      setBulkProgress({ done: 0, total: ready.length });
      const failed: string[] = [];
      for (let i = 0; i < ready.length; i++) {
        const c = ready[i];
        try {
          await api.post(`/stedi/submit/${c.id}`);
        } catch {
          failed.push(c.claim_number || String(c.id));
        }
        setBulkProgress({ done: i + 1, total: ready.length });
      }
      return { count: ready.length - failed.length, failed };
    },
    onSuccess: ({ count, failed }) => {
      qc.invalidateQueries({ queryKey: ['work-queue'] });
      qc.invalidateQueries({ queryKey: ['claims'] });
      setTimeout(() => setBulkProgress(null), 3000);
      if (failed.length === 0) {
        alert(`✅ ${t('dashboard.bulk_submitted', { count })}`);
      } else {
        alert(`✅ ${t('dashboard.bulk_partial', { success: count, failed: failed.length })}\n❌ ${failed.join(', ')}`);
      }
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 text-sky-500 animate-spin" />
      </div>
    );
  }

  const q = data!;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Top Bar */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-slate-900">{t('dashboard.work_queue')}</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowPullModal(true)}
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-2 border border-slate-200 rounded-lg hover:bg-slate-50 text-slate-600"
          >
            <Download className="w-3.5 h-3.5 text-sky-500" />
            {t('dashboard.pull_vistanet')}
          </button>
          <button
            onClick={() => navigate('/eligibility')}
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-2 border border-slate-200 rounded-lg hover:bg-slate-50 text-slate-600"
          >
            <Zap className="w-3.5 h-3.5 text-amber-500" />
            {t('dashboard.check_eligibility')}
          </button>
        </div>
      </div>

      {/* Stats Bar */}
      <div className="flex items-center gap-4 mb-6 text-sm">
        <span className="flex items-center gap-1.5 text-slate-500">
          <span className="w-2 h-2 rounded-full bg-sky-400" />
          {t('dashboard.new_today', { count: q.counts.new_today })}
        </span>
        <span className="text-slate-300">|</span>
        <span className="flex items-center gap-1.5 text-slate-500">
          <span className="w-2 h-2 rounded-full bg-emerald-400" />
          {t('dashboard.ready_to_submit', { count: q.counts.ready })}
        </span>
        <span className="text-slate-300">|</span>
        <span className="flex items-center gap-1.5 text-slate-500">
          <span className="w-2 h-2 rounded-full bg-rose-400" />
          {t('dashboard.needs_attention', { count: q.counts.attention })}
        </span>
      </div>

      {/* Sections */}

      {/* Needs Attention — shown first if any */}
      <Section
        title={t('dashboard.section_attention')}
        icon={AlertTriangle}
        iconColor="text-rose-500"
        claims={q.attention}
        showDenialReason
        onArchive={handleArchiveClaim}
        selectedIds={selectedIds}
        onToggleSelect={toggleSelect}
      />

      {/* Ready to Submit — top priority */}
      <Section
        title={t('dashboard.section_ready')}
        icon={CheckCircle}
        iconColor="text-emerald-500"
        claims={q.ready}
        selectedIds={selectedIds}
        onToggleSelect={toggleSelect}
        headerAction={
          q.ready.length > 0 ? (
            <button
              onClick={(e) => { e.stopPropagation(); submitAllMutation.mutate(); }}
              disabled={submitAllMutation.isPending}
              className="flex items-center gap-1 text-xs font-medium px-2.5 py-1 bg-sky-500 hover:bg-sky-600 text-white rounded-lg disabled:opacity-50"
            >
              {submitAllMutation.isPending ? (
                <>
                  <Loader2 className="w-3 h-3 animate-spin" />
                  {bulkProgress
                    ? t('dashboard.submitting_progress', { done: bulkProgress.done, total: bulkProgress.total })
                    : t('dashboard.submit_all_ready')}
                </>
              ) : (
                <>
                  <Send className="w-3 h-3" />
                  {t('dashboard.submit_all_ready')}
                </>
              )}
            </button>
          ) : undefined
        }
      />

      {/* New / Unprocessed */}
      <Section
        title={t('dashboard.section_new')}
        icon={FileText}
        iconColor="text-sky-500"
        claims={q.new}
        selectedIds={selectedIds}
        onToggleSelect={toggleSelect}
      />

      {/* Submitted */}
      <Section
        title={t('dashboard.section_submitted')}
        icon={Clock}
        iconColor="text-amber-500"
        claims={q.submitted}
        showAging
        selectedIds={selectedIds}
        onToggleSelect={toggleSelect}
      />

      {/* Recently Paid */}
      <Section
        title={t('dashboard.section_paid')}
        icon={CircleDollarSign}
        iconColor="text-emerald-500"
        claims={q.paid}
        defaultOpen={false}
        selectedIds={selectedIds}
        onToggleSelect={toggleSelect}
      />

      {/* Empty state */}
      {q.new.length === 0 && q.ready.length === 0 && q.submitted.length === 0 &&
       q.attention.length === 0 && q.paid.length === 0 && (
        <div className="text-center py-16">
          <FileText className="w-12 h-12 text-slate-200 mx-auto mb-3" />
          <p className="text-sm text-slate-400">
            {t('dashboard.no_claims_section')}
          </p>
          <button
            onClick={() => setShowPullModal(true)}
            className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-sky-500 hover:text-sky-600"
          >
            <Download className="w-4 h-4" />
            {t('dashboard.pull_vistanet')}
          </button>
        </div>
      )}

      {/* Floating Delete Bar */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 px-5 py-3 bg-slate-900 text-white rounded-2xl shadow-2xl">
          <span className="text-sm font-medium">
            {selectedIds.size} selected
          </span>
          <button
            onClick={handleBulkDelete}
            disabled={deleting}
            className="flex items-center gap-1.5 px-4 py-2 bg-rose-500 hover:bg-rose-600 text-white text-sm font-medium rounded-lg disabled:opacity-50"
          >
            {deleting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Trash2 className="w-4 h-4" />
            )}
            Delete Selected
          </button>
          <button
            onClick={() => setSelectedIds(new Set())}
            className="text-sm text-slate-300 hover:text-white px-2"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Pull Modal */}
      {showPullModal && (
        <PullModal
          onClose={() => setShowPullModal(false)}
          onSuccess={() => qc.invalidateQueries({ queryKey: ['work-queue'] })}
        />
      )}
    </div>
  );
}
