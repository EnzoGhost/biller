import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  Send, ChevronRight, ChevronDown, ChevronUp,
  FileText, CheckCircle, Clock, AlertTriangle, CircleDollarSign,
  Download, X, Loader2, Archive, Trash2, Upload, Settings, ShieldCheck,
} from 'lucide-react';
import ScannerModal from '../components/scanner/ScannerModal';
import api from '../lib/api';
import { formatDateShort } from '../lib/dates';
import type { ClaimStatus } from '../types';
import StatusBadge from '../components/ui/Badge';
import DatePicker from '../components/ui/DatePicker';
import ConfirmDialog from '../components/ui/ConfirmDialog';

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
  scrub_score?: number | null;
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
  claims_created: number | number[];
  errors: string[];
  uninsured_skipped?: number;
  uninsured_patients?: Array<{ name: string; record_number: string; invoice_id: number }>;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (n: number) =>
  new Intl.NumberFormat('es-PR', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);

// ── VistaNet Pull Modal ──────────────────────────────────────────────────────

function PullModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const { t } = useTranslation();
  const now = new Date(); const today = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
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
                  claims: Array.isArray(result.claims_created) ? result.claims_created.length : result.claims_created,
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

// ── Wink Pull Modal ──────────────────────────────────────────────────────────

function WinkPullModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const { t } = useTranslation();
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  const [dateFrom, setDateFrom] = useState(today);
  const [dateTo, setDateTo] = useState(today);
  const [result, setResult] = useState<PullResult | null>(null);

  // Pairing state
  const [winkClinicId, setWinkClinicId] = useState<string | null>(() => localStorage.getItem('angelwink_clinic_id'));
  const [winkClinicName, setWinkClinicName] = useState<string | null>(() => localStorage.getItem('angelwink_clinic_name'));
  const [joinCode, setJoinCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  const isPaired = !!winkClinicId;

  const handleVerifyCode = async () => {
    if (joinCode.length < 6) return;
    setVerifying(true);
    setJoinError(null);
    try {
      const { data } = await api.post('/clinic/join-codes/verify', { code: joinCode.trim() });
      if (data.valid) {
        const clinicId = data.angelwink_clinic_id;
        setWinkClinicId(clinicId);
        setWinkClinicName(data.clinic_name);
        localStorage.setItem('angelwink_clinic_id', clinicId);
        localStorage.setItem('angelwink_clinic_name', data.clinic_name);
        setJoinCode('');
      } else {
        setJoinError(data.message || 'Invalid code');
      }
    } catch {
      setJoinError('Failed to verify code');
    } finally {
      setVerifying(false);
    }
  };

  const pullMutation = useMutation({
    mutationFn: async () => {
      const resp = await api.post('/import/wink-invoices', null, {
        params: {
          date_from: dateFrom,
          date_to: dateTo,
          provider_id: 1,
          payer_id: 1,
          clinic_id: winkClinicId,
        },
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
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-base font-semibold text-slate-900">
            {t('dashboard.import_wink_title', 'Import from AngelWink')}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="px-6 py-5 space-y-4">
          {!isPaired ? (
            /* Pairing flow — enter clinic code */
            <div className="space-y-3">
              <p className="text-sm font-medium text-slate-700">Enter Clinic Code</p>
              <p className="text-xs text-slate-500">
                Ask the clinic admin to generate a join code from AngelWink Settings → Clinic Pairing.
              </p>
              <div className="flex gap-2">
                <input
                  value={joinCode}
                  onChange={e => setJoinCode(e.target.value.toUpperCase())}
                  placeholder="ABC123"
                  maxLength={6}
                  className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm font-mono tracking-widest text-center uppercase focus:outline-none focus:ring-2 focus:ring-sky-500"
                  onKeyDown={e => e.key === 'Enter' && handleVerifyCode()}
                />
                <button
                  onClick={handleVerifyCode}
                  disabled={verifying || joinCode.length < 6}
                  className="bg-sky-500 hover:bg-sky-600 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg"
                >
                  {verifying ? 'Verifying...' : 'Connect'}
                </button>
              </div>
              {joinError && (
                <div className="flex items-center gap-1.5 text-red-600 text-xs bg-red-50 border border-red-200 rounded-lg p-2">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />{joinError}
                </div>
              )}
            </div>
          ) : !result ? (
            /* Date range picker */
            <>
              <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 mb-1">
                <CheckCircle className="w-4 h-4 text-emerald-600" />
                <span className="text-sm text-emerald-700 font-medium">Connected to {winkClinicName}</span>
                <button
                  onClick={() => {
                    setWinkClinicId(null);
                    setWinkClinicName(null);
                    localStorage.removeItem('angelwink_clinic_id');
                    localStorage.removeItem('angelwink_clinic_name');
                  }}
                  className="ml-auto text-xs text-slate-500 hover:text-red-600"
                >
                  Disconnect
                </button>
              </div>
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
                  {t('dashboard.import_wink_error', 'Error importing from AngelWink')}
                </div>
              )}
            </>
          ) : (
            <WinkImportResult result={result} />
          )}
        </div>
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex justify-end gap-2">
          {!isPaired ? (
            <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800">
              {t('common.cancel')}
            </button>
          ) : !result ? (
            <>
              <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800">
                {t('common.cancel')}
              </button>
              <button
                onClick={() => pullMutation.mutate()}
                disabled={!dateFrom || !dateTo || pullMutation.isPending}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-sky-500 hover:bg-sky-600 text-white rounded-lg disabled:opacity-50"
              >
                {pullMutation.isPending ? (
                  <><Loader2 className="w-4 h-4 animate-spin" />{t('dashboard.pulling')}</>
                ) : (
                  <><Download className="w-4 h-4" />{t('dashboard.pull', 'Import')}</>
                )}
              </button>
            </>
          ) : (
            <button onClick={onClose} className="px-4 py-2 text-sm font-medium bg-sky-500 hover:bg-sky-600 text-white rounded-lg">
              {t('common.ok')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Wink Import Result ───────────────────────────────────────────────────────

function WinkImportResult({ result }: { result: PullResult }) {
  const [showUninsured, setShowUninsured] = useState(false);
  const claimCount = Array.isArray(result.claims_created) ? result.claims_created.length : (result.claims_created || 0);
  const uninsuredCount = result.uninsured_skipped || 0;
  const uninsuredPatients = result.uninsured_patients || [];

  return (
    <div className="py-4 space-y-3">
      {/* Success row */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-emerald-50 rounded-full flex items-center justify-center shrink-0">
          <CheckCircle className="w-5 h-5 text-emerald-500" />
        </div>
        <p className="text-sm font-medium text-slate-900">
          Imported {claimCount} claim{claimCount !== 1 ? 's' : ''}
        </p>
      </div>

      {/* Uninsured patients section */}
      {uninsuredCount > 0 && (
        <div className="bg-sky-50 border border-sky-200 rounded-lg overflow-hidden">
          <button
            onClick={() => setShowUninsured(!showUninsured)}
            className="w-full flex items-center justify-between px-3 py-2 text-left"
          >
            <span className="text-sm text-sky-700 font-medium">
              {uninsuredCount} patient{uninsuredCount !== 1 ? 's' : ''} skipped (no insurance)
            </span>
            {showUninsured ? (
              <ChevronUp className="w-4 h-4 text-sky-500" />
            ) : (
              <ChevronDown className="w-4 h-4 text-sky-500" />
            )}
          </button>
          {showUninsured && uninsuredPatients.length > 0 && (
            <div className="border-t border-sky-200 px-3 py-2 max-h-36 overflow-y-auto space-y-1">
              {uninsuredPatients.map((p, i) => (
                <div key={i} className="flex items-center justify-between text-xs text-sky-700">
                  <span className="font-medium">{p.name}</span>
                  {p.record_number && (
                    <span className="text-sky-500 ml-2">#{p.record_number}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Errors (non-uninsured) */}
      {result.errors && result.errors.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 max-h-32 overflow-y-auto">
          {result.errors.map((err, i) => (
            <p key={i} className="text-xs text-amber-700">{err}</p>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Import Dropdown ──────────────────────────────────────────────────────────

function ImportDropdown({
  onVistaNet,
  onWink,
}: {
  onVistaNet: () => void;
  onWink: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-xs font-medium px-3 py-2 bg-sky-500 hover:bg-sky-600 text-white rounded-lg"
      >
        <Upload className="w-3.5 h-3.5" />
        {t('dashboard.import_claims', 'Import Claims')}
        <ChevronDown className="w-3 h-3" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-40 bg-white rounded-xl shadow-xl border border-slate-200 py-1 w-56">
            <button
              onClick={() => { setOpen(false); onVistaNet(); }}
              className="w-full flex items-center justify-center px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              VistaNet
            </button>
            <button
              onClick={() => { setOpen(false); onWink(); }}
              className="w-full flex items-center justify-center px-3 py-2.5 hover:bg-slate-50"
            >
              <img src="/forClaimsImport.png" alt="AngelWink" className="max-w-[85%] max-h-10 object-contain" />
            </button>
            <button
              onClick={async () => {
                setOpen(false);
                try {
                  const { data } = await api.post('/claims/seed-test-claims');
                  alert(`Created ${data.total_created} test claims, skipped ${data.total_skipped}`);
                  queryClient.invalidateQueries({ queryKey: ['work-queue'] });
                } catch {
                  alert('Error creating test claims');
                }
              }}
              className="w-full flex items-center justify-center px-4 py-2.5 text-sm font-medium text-amber-600 hover:bg-amber-50"
            >
              🧪 Test Claims
            </button>
            <div className="border-t border-slate-100 my-1" />
            <button
              onClick={() => { setOpen(false); navigate('/import'); }}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-xs text-slate-400 hover:bg-slate-50 text-left"
            >
              <Settings className="w-3.5 h-3.5" />
              <span>{t('dashboard.more_import_options', 'More import options...')}</span>
            </button>
          </div>
        </>
      )}
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
        {claim.scrub_score !== null && claim.scrub_score !== undefined && claim.scrub_score < 100 && (
          <span className="w-5 h-5 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center text-xs font-bold" title={t('dashboard.has_issues', 'Has issues')}>!</span>
        )}
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

function IndeterminateCheckbox({ checked, indeterminate, onChange, className }: {
  checked: boolean;
  indeterminate: boolean;
  onChange: () => void;
  className?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      onChange={onChange}
      className={className}
    />
  );
}

function Section({
  title, icon: Icon, iconColor, claims, defaultOpen = true,
  showAging = false, showDenialReason = false, headerAction, onArchive,
  selectedIds, onToggleSelect, onToggleSelectAll,
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
  onToggleSelectAll?: (claimIds: number[], allSelected: boolean) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(defaultOpen);

  if (claims.length === 0) return null;

  const claimIds = claims.map(c => c.id);
  const selectedCount = selectedIds ? claimIds.filter(id => selectedIds.has(id)).length : 0;
  const allSelected = selectedCount === claims.length;
  const someSelected = selectedCount > 0 && !allSelected;

  return (
    <div className="mb-6">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center justify-between w-full mb-2 group"
      >
        <div className="flex items-center gap-2">
          {onToggleSelectAll && (
            <div onClick={(e) => e.stopPropagation()}>
              <IndeterminateCheckbox
                checked={allSelected}
                indeterminate={someSelected}
                onChange={() => onToggleSelectAll(claimIds, allSelected)}
                className="w-4 h-4 rounded border-slate-300 text-sky-500 focus:ring-sky-500 cursor-pointer"
              />
            </div>
          )}
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
  const [showWinkModal, setShowWinkModal] = useState(false);
  const [showEligibilityScanner, setShowEligibilityScanner] = useState(false);
  const [eligibilityScanResult, setEligibilityScanResult] = useState<Record<string, string> | null>(null);

  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<{open:boolean, title:string, message:string, onConfirm:()=>void}>({open:false,title:'',message:'',onConfirm:()=>{}});

  const toggleSelect = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = (claimIds: number[], allSelected: boolean) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (allSelected) {
        claimIds.forEach(id => next.delete(id));
      } else {
        claimIds.forEach(id => next.add(id));
      }
      return next;
    });
  };

  const handleBulkDelete = async () => {
    const count = selectedIds.size;
    if (!count) return;
    setConfirmDialog({
      open: true,
      title: 'Delete Claims',
      message: `Delete ${count} claim${count > 1 ? 's' : ''}? This cannot be undone.`,
      onConfirm: async () => {
        setConfirmDialog(prev => ({ ...prev, open: false }));
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
      },
    });
  };

  const handleArchiveClaim = async (claimId: number) => {
    setConfirmDialog({
      open: true,
      title: 'Archive Claim',
      message: 'Archive this claim? It will be marked as void.',
      onConfirm: async () => {
        setConfirmDialog(prev => ({ ...prev, open: false }));
        try {
          await api.post(`/claims/${claimId}/void`);
          qc.invalidateQueries({ queryKey: ['work-queue'] });
        } catch {
          alert('Failed to archive claim');
        }
      },
    });
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
          await api.post(`/inmediata/submit-ws/${c.id}`);
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
            onClick={() => setShowEligibilityScanner(true)}
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-2 border border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50 rounded-lg transition-colors"
            title="Scan insurance card to extract member info"
          >
            <ShieldCheck className="w-3.5 h-3.5 text-sky-500" />
            Eligibility Scanner
          </button>
          <ImportDropdown
            onVistaNet={() => setShowPullModal(true)}
            onWink={() => setShowWinkModal(true)}
          />
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
        onToggleSelectAll={toggleSelectAll}
      />

      {/* Ready to Submit — top priority */}
      <Section
        title={t('dashboard.section_ready')}
        icon={CheckCircle}
        iconColor="text-emerald-500"
        claims={q.ready}
        selectedIds={selectedIds}
        onToggleSelect={toggleSelect}
        onToggleSelectAll={toggleSelectAll}
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
        onToggleSelectAll={toggleSelectAll}
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
        onToggleSelectAll={toggleSelectAll}
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
        onToggleSelectAll={toggleSelectAll}
      />

      {/* Empty state */}
      {q.new.length === 0 && q.ready.length === 0 && q.submitted.length === 0 &&
       q.attention.length === 0 && q.paid.length === 0 && (
        <div className="text-center py-16">
          <FileText className="w-12 h-12 text-slate-200 mx-auto mb-3" />
          <p className="text-sm text-slate-400">
            {t('dashboard.no_claims_section')}
          </p>
          <div className="mt-4 inline-flex">
            <ImportDropdown
              onVistaNet={() => setShowPullModal(true)}
              onWink={() => setShowWinkModal(true)}
            />
          </div>
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

      {/* Eligibility Scanner Modal */}
      <ScannerModal
        open={showEligibilityScanner}
        onClose={() => { setShowEligibilityScanner(false); setEligibilityScanResult(null); }}
        purpose="eligibility"
        onProcessingComplete={(result) => {
          const info = result?.info;
          if (info) setEligibilityScanResult(info);
          setShowEligibilityScanner(false);
        }}
      />

      {/* Eligibility Scan Result */}
      {eligibilityScanResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-sky-500" />
                <h2 className="text-base font-semibold text-slate-900">Insurance Card</h2>
              </div>
              <button onClick={() => setEligibilityScanResult(null)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="px-6 py-5 space-y-3">
              {Object.entries(eligibilityScanResult).filter(([, v]) => v).map(([k, v]) => (
                <div key={k} className="flex justify-between items-start gap-4">
                  <span className="text-xs font-medium text-slate-400 uppercase tracking-wide shrink-0">
                    {k.replace(/_/g, ' ')}
                  </span>
                  <span className="text-sm text-slate-800 text-right">{String(v)}</span>
                </div>
              ))}
            </div>
            <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 text-xs text-slate-400 text-center">
              Scan only — eligibility check available when payer portals are connected
            </div>
          </div>
        </div>
      )}

      {/* Wink Pull Modal */}
      {showWinkModal && (
        <WinkPullModal
          onClose={() => setShowWinkModal(false)}
          onSuccess={() => qc.invalidateQueries({ queryKey: ['work-queue'] })}
        />
      )}

      {/* Confirm Dialog */}
      <ConfirmDialog
        open={confirmDialog.open}
        title={confirmDialog.title}
        message={confirmDialog.message}
        onConfirm={confirmDialog.onConfirm}
        onCancel={() => setConfirmDialog(prev => ({ ...prev, open: false }))}
      />
    </div>
  );
}
