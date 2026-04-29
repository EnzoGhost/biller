import { useState, useRef, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  Send, Zap, ChevronRight, ChevronDown, ChevronUp,
  FileText, CheckCircle, Clock, AlertTriangle, CircleDollarSign,
  Download, X, Loader2, ChevronLeft,
  Calendar,
} from 'lucide-react';
import api from '../lib/api';
import { formatDateShort } from '../lib/dates';
import type { ClaimStatus } from '../types';
import StatusBadge from '../components/ui/Badge';

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

// ── Helpers: Date formatting ─────────────────────────────────────────────────

const MONTHS_EN = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const MONTHS_ES_FULL = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];
const MONTHS_ES_API = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

function formatDisplayDate(d: Date, lang: string): string {
  const day = d.getDate();
  const month = d.getMonth();
  const year = d.getFullYear();
  if (lang === 'es') {
    return `${day} de ${MONTHS_ES_FULL[month]} de ${year}`;
  }
  return `${MONTHS_EN[month]} ${day}, ${year}`;
}

function toApiDate(d: Date): string {
  return `${MONTHS_ES_API[d.getMonth()]}/${d.getDate()}/${d.getFullYear()}`;
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// ── DatePicker Component ─────────────────────────────────────────────────────

function DatePicker({
  label,
  value,
  onChange,
  lang,
}: {
  label: string;
  value: Date;
  onChange: (d: Date) => void;
  lang: string;
}) {
  const [open, setOpen] = useState(false);
  const [viewYear, setViewYear] = useState(value.getFullYear());
  const [viewMonth, setViewMonth] = useState(value.getMonth());
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // When value changes, sync view
  useEffect(() => {
    setViewYear(value.getFullYear());
    setViewMonth(value.getMonth());
  }, [value]);

  const prevMonth = useCallback(() => {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); }
    else setViewMonth(m => m - 1);
  }, [viewMonth]);

  const nextMonth = useCallback(() => {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); }
    else setViewMonth(m => m + 1);
  }, [viewMonth]);

  const days = daysInMonth(viewYear, viewMonth);
  const firstDow = new Date(viewYear, viewMonth, 1).getDay(); // 0=Sun
  const today = new Date();

  const dayHeaders = lang === 'es'
    ? ['Do', 'Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sá']
    : ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

  const monthLabel = lang === 'es'
    ? `${MONTHS_ES_FULL[viewMonth].charAt(0).toUpperCase() + MONTHS_ES_FULL[viewMonth].slice(1)} ${viewYear}`
    : `${MONTHS_EN[viewMonth]} ${viewYear}`;

  return (
    <div className="relative" ref={ref}>
      <label className="block text-sm font-medium text-slate-700 mb-1">{label}</label>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white hover:border-slate-300 focus:ring-2 focus:ring-sky-500 focus:border-sky-500 outline-none transition-colors"
      >
        <span className="text-slate-900">{formatDisplayDate(value, lang)}</span>
        <Calendar className="w-4 h-4 text-slate-400" />
      </button>

      {open && (
        <div className="absolute left-0 mt-1 w-72 bg-white border border-slate-200 rounded-xl shadow-xl z-[100] p-3 animate-in fade-in slide-in-from-top-1">
          {/* Month nav */}
          <div className="flex items-center justify-between mb-2">
            <button
              type="button"
              onClick={prevMonth}
              className="p-1 rounded-lg hover:bg-slate-100 text-slate-500"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-sm font-semibold text-slate-800">{monthLabel}</span>
            <button
              type="button"
              onClick={nextMonth}
              className="p-1 rounded-lg hover:bg-slate-100 text-slate-500"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* Day headers */}
          <div className="grid grid-cols-7 mb-1">
            {dayHeaders.map(dh => (
              <div key={dh} className="text-center text-xs font-medium text-slate-400 py-1">{dh}</div>
            ))}
          </div>

          {/* Day grid */}
          <div className="grid grid-cols-7">
            {/* Empty cells before first day */}
            {Array.from({ length: firstDow }).map((_, i) => (
              <div key={`e-${i}`} />
            ))}
            {Array.from({ length: days }).map((_, i) => {
              const day = i + 1;
              const cellDate = new Date(viewYear, viewMonth, day);
              const selected = isSameDay(cellDate, value);
              const isToday = isSameDay(cellDate, today);
              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => { onChange(cellDate); setOpen(false); }}
                  className={`
                    w-9 h-9 mx-auto flex items-center justify-center rounded-lg text-sm transition-colors
                    ${selected
                      ? 'bg-sky-500 text-white font-semibold'
                      : isToday
                        ? 'bg-sky-50 text-sky-600 font-medium hover:bg-sky-100'
                        : 'text-slate-700 hover:bg-slate-100'
                    }
                  `}
                >
                  {day}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── VistaNet Pull Modal ──────────────────────────────────────────────────────

function PullModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language?.startsWith('es') ? 'es' : 'en';

  // Default: from = yesterday, to = today
  const now = new Date();
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const todayDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const [dateFrom, setDateFrom] = useState<Date>(yesterday);
  const [dateTo, setDateTo] = useState<Date>(todayDate);
  const [result, setResult] = useState<PullResult | null>(null);

  const pullMutation = useMutation({
    mutationFn: async () => {
      const resp = await api.post('/vistanet/pull-bitacora', {
        date_from: toApiDate(dateFrom),
        date_to: toApiDate(dateTo),
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
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
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
              <DatePicker
                label={t('dashboard.date_from')}
                value={dateFrom}
                onChange={setDateFrom}
                lang={lang}
              />
              <DatePicker
                label={t('dashboard.date_to')}
                value={dateTo}
                onChange={setDateTo}
                lang={lang}
              />
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
                {lang === 'es' ? 'Cancelar' : 'Cancel'}
              </button>
              <button
                onClick={() => pullMutation.mutate()}
                disabled={pullMutation.isPending}
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
              OK
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Claim Card ───────────────────────────────────────────────────────────────

function ClaimCard({ claim, showAging = false, showDenialReason = false }: {
  claim: WorkQueueClaim;
  showAging?: boolean;
  showDenialReason?: boolean;
}) {
  const navigate = useNavigate();
  const { t } = useTranslation();

  return (
    <div
      onClick={() => navigate(`/claims/${claim.id}`)}
      className="flex items-center justify-between py-3 px-4 bg-white rounded-xl border border-slate-100 hover:border-slate-200 hover:shadow-sm cursor-pointer transition-all group"
    >
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
          {showDenialReason && claim.denial_reason && (
            <p className="text-xs text-rose-500 mt-0.5 truncate">
              {claim.denial_code 
                ? t(`denials.carc_codes.${claim.denial_code}`, { defaultValue: claim.denial_reason })
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
  showAging = false, showDenialReason = false, headerAction,
}: {
  title: string;
  icon: typeof FileText;
  iconColor: string;
  claims: WorkQueueClaim[];
  defaultOpen?: boolean;
  showAging?: boolean;
  showDenialReason?: boolean;
  headerAction?: React.ReactNode;
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
      />

      {/* New / Unprocessed */}
      <Section
        title={t('dashboard.section_new')}
        icon={FileText}
        iconColor="text-sky-500"
        claims={q.new}
      />

      {/* Ready to Submit */}
      <Section
        title={t('dashboard.section_ready')}
        icon={CheckCircle}
        iconColor="text-emerald-500"
        claims={q.ready}
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

      {/* Submitted */}
      <Section
        title={t('dashboard.section_submitted')}
        icon={Clock}
        iconColor="text-amber-500"
        claims={q.submitted}
        showAging
      />

      {/* Recently Paid */}
      <Section
        title={t('dashboard.section_paid')}
        icon={CircleDollarSign}
        iconColor="text-emerald-500"
        claims={q.paid}
        defaultOpen={false}
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
