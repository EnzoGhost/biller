import { useState, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  CheckCircle, XCircle, Search, AlertCircle, User, Camera,
  ChevronDown, ChevronUp, Clock, RefreshCw, X,
} from 'lucide-react';
import api from '../lib/api';
import { formatDate } from '../lib/dates';
import DateDropdown from '../components/ui/DateDropdown';
import type { Patient } from '../types';
import ScannerModal from '../components/scanner/ScannerModal';

// ── Types ────────────────────────────────────────────────────────────────────

interface EligibilityPayer {
  id: number;
  name: string;
  payer_id: string;
  inmediata_payer_id: string;
  required_fields: {
    member_id?: boolean;
    group_number?: boolean;
    first_name?: boolean;
    last_name?: boolean;
    dob?: boolean;
    gender?: boolean;
  };
}


interface EligibilityCheckResponse {
  id: number;
  patient_id: number;
  patient_name?: string;
  payer_name?: string;
  payer_id?: string;
  member_id?: string;
  status: string;
  response_parsed?: Record<string, unknown>;
  checked_at: string;
}

interface BenefitItem {
  service_type?: string;
  service_code?: string;
  amount?: number;
  percent?: number;
  network?: string;
}

interface ParsedEligibility {
  status?: string;
  plan_name?: string;
  plan_begin?: string;
  plan_end?: string;
  effective_date?: string;
  term_date?: string;
  copay?: BenefitItem[] | number | null;
  deductible?: BenefitItem[] | number | null;
  coinsurance?: BenefitItem[] | number | null;
  out_of_pocket?: BenefitItem[] | number | null;
  deductible_remaining?: number | null;
  out_of_pocket_max?: number | null;
  out_of_pocket_remaining?: number | null;
  covered_services?: string[];
  non_covered?: string[];
  errors?: string[];
  error?: string;
  parse_error?: string;
}

// ── Spotlight Payer Dropdown ─────────────────────────────────────────────────

function PayerSpotlight({
  payers,
  selected,
  onSelect,
  onClear,
}: {
  payers: EligibilityPayer[];
  selected: EligibilityPayer | null;
  onSelect: (p: EligibilityPayer) => void;
  onClear: () => void;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const filtered = payers.filter(p =>
    !query || p.name.toLowerCase().includes(query.toLowerCase()) ||
    p.inmediata_payer_id.toLowerCase().includes(query.toLowerCase())
  );

  if (selected) {
    return (
      <div className="flex items-center gap-2 bg-sky-50 border border-sky-200 rounded-lg px-3 py-2">
        <span className="text-sm font-medium text-slate-800 flex-1">{selected.name}</span>
        <span className="text-xs text-slate-400 font-mono">{selected.inmediata_payer_id}</span>
        <button onClick={onClear} className="text-slate-400 hover:text-slate-600 ml-1">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div ref={ref} className="relative">
      <div className="flex items-center border border-slate-200 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-sky-500">
        <Search className="w-4 h-4 text-slate-400 ml-3 shrink-0" />
        <input
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder="Search payer…"
          className="flex-1 px-2 py-2 text-sm outline-none bg-transparent"
        />
      </div>
      {open && filtered.length > 0 && (
        <div className="absolute z-50 top-full mt-1 left-0 right-0 bg-white rounded-xl border border-slate-200 shadow-xl max-h-60 overflow-y-auto">
          {filtered.map(p => (
            <button
              key={p.id}
              type="button"
              onMouseDown={() => { onSelect(p); setQuery(''); setOpen(false); }}
              className="w-full text-left px-3 py-2.5 hover:bg-sky-50 transition-colors border-b border-slate-50 last:border-0"
            >
              <p className="text-sm font-medium text-slate-800">{p.name}</p>
              <p className="text-xs text-slate-400 font-mono">{p.inmediata_payer_id}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmt = (n?: number | null) =>
  n != null
    ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
    : '—';

const pct = (n?: number | null) => (n != null ? `${n}%` : '—');

// ── Component ─────────────────────────────────────────────────────────────────

export default function EligibilityPage() {
  const { t } = useTranslation();

  // Scanner
  const [showScanner, setShowScanner] = useState(false);

  // Patient selector
  const [patientSearch, setPatientSearch] = useState('');
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [showPatientDropdown, setShowPatientDropdown] = useState(false);

  // Insurance / eligibility fields
  const [selectedPayer,  setSelectedPayer]  = useState<EligibilityPayer | null>(null);
  const [memberId,       setMemberId]       = useState('');
  const [groupNumber,    setGroupNumber]    = useState('');
  const [subscriberName, setSubscriberName] = useState('');
  const [subscriberDob,  setSubscriberDob]  = useState('');
  const [serviceType,    setServiceType]    = useState('AL');

  // Internal IDs for the API call
  const [patientInsuranceId, setPatientInsuranceId] = useState<number | undefined>(undefined);

  // ── Persist form state across tab switches ──────────────────────────────────
  const [restored, setRestored] = useState(false);

  // Load persisted state on mount
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem('eligibility-form-state');
      if (saved) {
        const s = JSON.parse(saved);
        if (s.memberId) setMemberId(s.memberId);
        if (s.groupNumber) setGroupNumber(s.groupNumber);
        if (s.subscriberName) setSubscriberName(s.subscriberName);
        if (s.subscriberDob) setSubscriberDob(s.subscriberDob);
        if (s.serviceType) setServiceType(s.serviceType);
        if (s.patientInsuranceId) setPatientInsuranceId(s.patientInsuranceId);
        if (s.selectedPatient) setSelectedPatient(s.selectedPatient);
        if (s.selectedPayer) setSelectedPayer(s.selectedPayer);
      }
    } catch {}
    setRestored(true);
  }, []);

  // Save form state on change (only after initial restore)
  useEffect(() => {
    if (!restored) return;
    const state = {
      memberId, groupNumber, subscriberName, subscriberDob, serviceType,
      patientInsuranceId,
      selectedPatient: selectedPatient ? { id: selectedPatient.id, first_name: selectedPatient.first_name, last_name: selectedPatient.last_name, dob: selectedPatient.dob, insurances: selectedPatient.insurances } : null,
      selectedPayer,
    };
    sessionStorage.setItem('eligibility-form-state', JSON.stringify(state));
  }, [memberId, groupNumber, subscriberName, subscriberDob, serviceType, patientInsuranceId, selectedPatient, selectedPayer, restored]);

  // Results
  const [result,      setResult]      = useState<EligibilityCheckResponse | null>(null);
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState<string | null>(null);
  const [showRaw,     setShowRaw]     = useState(false);

  // History
  const [historyOpen, setHistoryOpen] = useState(false);

  // ── Eligibility payers list ───────────────────────────────────────────────
  const { data: eligibilityPayers = [] } = useQuery<EligibilityPayer[]>({
    queryKey: ['eligibility-payers'],
    queryFn: () => api.get('/payers/eligibility-list').then(r => r.data),
    staleTime: 5 * 60 * 1000,
  });

  // ── Queries ──────────────────────────────────────────────────────────────────

  const { data: patientResults } = useQuery<{ items: Patient[] }>({
    queryKey: ['patient-search', patientSearch],
    queryFn: () =>
      api.get(`/patients?per_page=20&search=${encodeURIComponent(patientSearch)}`).then(r => r.data),
    enabled: patientSearch.length >= 2,
  });

  const { data: historyData, refetch: refetchHistory } = useQuery<{
    checks: EligibilityCheckResponse[];
    total: number;
  }>({
    queryKey: ['eligibility-history', selectedPatient?.id],
    queryFn: () =>
      api.get(`/eligibility/history/${selectedPatient!.id}?limit=10`).then(r => r.data),
    enabled: !!selectedPatient?.id && historyOpen,
  });

  // ── Handlers ─────────────────────────────────────────────────────────────────

  const selectPatient = (p: Patient) => {
    setSelectedPatient(p);
    setPatientSearch('');
    setShowPatientDropdown(false);

    const primary = p.insurances?.find(i => i.is_primary) ?? p.insurances?.[0];
    if (primary) {
      // Try to match primary payer to eligibility payers list
      const matched = eligibilityPayers.find(
        ep => ep.id === primary.payer_id ||
              ep.payer_id === String(primary.payer_id) ||
              ep.name.toLowerCase() === (primary.payer?.name ?? '').toLowerCase()
      ) ?? null;
      setSelectedPayer(matched);
      setMemberId(primary.member_id ?? '');
      setGroupNumber(primary.group_number ?? '');
      setSubscriberName(primary.subscriber_name ?? `${p.first_name} ${p.last_name}`);
      setSubscriberDob(p.dob ?? '');
      setPatientInsuranceId(primary.id);
    } else {
      setSubscriberName(`${p.first_name} ${p.last_name}`);
      setSubscriberDob(p.dob ?? '');
      setSelectedPayer(null);
      setMemberId('');
      setGroupNumber('');
      setPatientInsuranceId(undefined);
    }

    setResult(null);
    setError(null);
  };

  const clearPatient = () => {
    setSelectedPatient(null);
    setSelectedPayer(null);
    setMemberId('');
    setGroupNumber('');
    setSubscriberName('');
    setSubscriberDob('');
    setPatientInsuranceId(undefined);
    setResult(null);
    setError(null);
    setHistoryOpen(false);
  };

  const handleCheck = async () => {
    if (!selectedPatient) return;
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const { data } = await api.post('/eligibility/check', {
        patient_id: selectedPatient.id,
        insurance_id: patientInsuranceId,
        payer_id_override: selectedPayer?.inmediata_payer_id ?? undefined,
        service_type_codes: [serviceType],
      });
      setResult(data);
      // Refresh history if open
      if (historyOpen) refetchHistory();
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(msg ?? 'Error checking eligibility. Check Inmediata Web Services configuration.');
    } finally {
      setLoading(false);
    }
  };

  // ── Parsed result helpers ─────────────────────────────────────────────────

  const parsed: ParsedEligibility =
    (result?.response_parsed as ParsedEligibility) ?? {};

  const isEligible = result?.status === 'active' || result?.status === 'eligible';

  // ── Render ────────────────────────────────────────────────────────────────

  const labelClass = 'block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1';
  const inputClass =
    'w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500';

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-slate-900">Eligibility</h1>
        <button
          onClick={() => setShowScanner(true)}
          className="flex items-center gap-2 border border-sky-300 text-sky-600 hover:bg-sky-50 text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          <Camera className="w-4 h-4" />
          Scan Card
        </button>
      </div>

      {/* Insurance card scanner */}
      <ScannerModal
        open={showScanner}
        onClose={() => setShowScanner(false)}
        purpose="eligibility"
        onProcessingComplete={(result) => {
          const info = result?.info;
          if (info) {
            if (info.member_id) setMemberId(info.member_id as string);
            if (info.subscriber_name) setSubscriberName(info.subscriber_name as string);
            if (info.group_number) setGroupNumber(info.group_number as string);
            // Auto-select payer from scanned payer_name
            if (info.payer_name && eligibilityPayers.length > 0) {
              const scanned = String(info.payer_name).toLowerCase();
              const matched = eligibilityPayers.find(ep =>
                ep.name.toLowerCase().includes(scanned) || scanned.includes(ep.name.toLowerCase())
              );
              if (matched) setSelectedPayer(matched);
            }
          }
          setShowScanner(false);
        }}
      />

      {/* Form */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6 space-y-4">

        {/* Patient selector */}
        <div>
          <label className={labelClass}>Patient</label>
          {selectedPatient ? (
            <div className="flex items-center gap-3 bg-sky-50 border border-sky-200 rounded-lg px-3 py-2.5">
              <User className="w-4 h-4 text-sky-500 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-slate-800">
                  {selectedPatient.first_name} {selectedPatient.last_name}
                </p>
                <p className="text-xs text-slate-500">
                  DOB: {formatDate(selectedPatient.dob)}
                  {selectedPayer && ` · ${selectedPayer.name}`}
                  {memberId && ` · ${memberId}`}
                </p>
              </div>
              <button
                onClick={clearPatient}
                className="text-xs text-sky-400 hover:text-sky-600"
              >✕</button>
            </div>
          ) : (
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                value={patientSearch}
                onChange={e => { setPatientSearch(e.target.value); setShowPatientDropdown(true); }}
                onFocus={() => patientSearch && setShowPatientDropdown(true)}
                onBlur={() => setTimeout(() => setShowPatientDropdown(false), 150)}
                placeholder="Search patients…"
                className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
              {showPatientDropdown && patientResults?.items && patientResults.items.length > 0 && (
                <div className="absolute z-50 top-full mt-1 left-0 right-0 bg-white rounded-xl border border-slate-200 shadow-xl max-h-60 overflow-y-auto">
                  {patientResults.items.map(p => {
                    const primary = p.insurances?.find(i => i.is_primary) ?? p.insurances?.[0];
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onMouseDown={() => selectPatient(p)}
                        className="w-full text-left px-3 py-2.5 hover:bg-sky-50 transition-colors border-b border-slate-50 last:border-0"
                      >
                        <p className="text-sm font-medium text-slate-800">
                          {p.first_name} {p.last_name}
                        </p>
                        <p className="text-xs text-slate-500">
                          DOB: {formatDate(p.dob)}
                          {primary && ` · ${primary.payer?.name ?? 'Payer'} · ${primary.member_id}`}
                        </p>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Payer spotlight dropdown */}
        <div>
          <label className={labelClass}>Payer</label>
          <PayerSpotlight
            payers={eligibilityPayers}
            selected={selectedPayer}
            onSelect={setSelectedPayer}
            onClear={() => setSelectedPayer(null)}
          />
          {/* Required field hints */}
          {selectedPayer && Object.entries(selectedPayer.required_fields).some(([, v]) => v) && (() => {
            const missingFields = Object.entries(selectedPayer.required_fields)
              .filter(([field, required]) => {
                if (!required) return false;
                switch (field) {
                  case 'member_id': return !memberId;
                  case 'group_number': return !groupNumber;
                  case 'first_name': return !subscriberName;
                  case 'last_name': return !subscriberName;
                  case 'dob': return !subscriberDob;
                  default: return true;
                }
              });
            return missingFields.length > 0 ? (
              <div className="flex flex-wrap gap-1 mt-1.5">
                {missingFields.map(([field]) => (
                  <span key={field} className="text-xs bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full">
                    {field.replace(/_/g, ' ')} required
                  </span>
                ))}
              </div>
            ) : (
              <div className="flex items-center gap-1.5 mt-1.5">
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                  ✓ all required fields filled
                </span>
              </div>
            );
          })()}
        </div>

        {/* Insurance fields */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>
              Member ID
              {selectedPayer?.required_fields?.member_id && (
                <span className="ml-1 text-amber-500">*</span>
              )}
            </label>
            <input
              value={memberId}
              onChange={e => setMemberId(e.target.value)}
              className={inputClass}
              placeholder="ABC123456"
            />
          </div>
          <div>
            <label className={labelClass}>
              Group Number
              {selectedPayer?.required_fields?.group_number && (
                <span className="ml-1 text-amber-500">*</span>
              )}
            </label>
            <input
              value={groupNumber}
              onChange={e => setGroupNumber(e.target.value)}
              className={inputClass}
              placeholder="e.g. GRP001"
            />
          </div>
          <div>
            <label className={labelClass}>Subscriber Name</label>
            <input
              value={subscriberName}
              onChange={e => setSubscriberName(e.target.value)}
              className={inputClass}
              placeholder="Full name"
            />
          </div>
          <div>
            <label className={labelClass}>Subscriber DOB</label>
            <DateDropdown
              value={subscriberDob}
              onChange={setSubscriberDob}
            />
          </div>
        </div>

        <button
          onClick={handleCheck}
          disabled={loading || !selectedPatient}
          className="flex items-center gap-2 bg-sky-500 hover:bg-sky-600 disabled:opacity-50 text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors"
        >
          <Search className="w-4 h-4" />
          {loading ? 'Checking…' : 'Check Eligibility'}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6 flex items-start gap-3 text-red-700 text-sm">
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
          <div>
            <p className="font-medium">Eligibility check failed</p>
            <p className="text-red-600 mt-0.5">{error}</p>
          </div>
        </div>
      )}

      {/* Result */}
      {result && (
        <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6 space-y-5">
          {/* Status badge */}
          <div
            className={`flex items-center gap-3 p-4 rounded-lg ${
              isEligible ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'
            }`}
          >
            {isEligible
              ? <CheckCircle className="w-6 h-6 text-emerald-600 shrink-0" />
              : <XCircle className="w-6 h-6 text-red-500 shrink-0" />}
            <div>
              <p className="font-bold text-base capitalize">
                {isEligible ? '✓ Active / Eligible' : '✗ Inactive / Not Eligible'}
              </p>
              {result.payer_name && (
                <p className="text-sm opacity-80">
                  {result.payer_name} · Member: {result.member_id}
                </p>
              )}
            </div>
          </div>

          {/* Plan details */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {[
              { label: 'Plan Name',       value: (parsed.plan_name as string) || '—' },
              { label: 'Coverage Start',   value: (parsed.effective_date || parsed.plan_begin) ? formatDate((parsed.effective_date || parsed.plan_begin) as string) : '—' },
              { label: 'Coverage End',     value: (parsed.term_date || parsed.plan_end) ? formatDate((parsed.term_date || parsed.plan_end) as string) : '—' },
            ].map(({ label, value }) => (
              <div key={label} className="bg-slate-50 rounded-lg p-3">
                <p className="text-xs text-slate-500 mb-1">{label}</p>
                <p className="text-sm font-semibold text-slate-800">{value}</p>
              </div>
            ))}
          </div>

          {/* Benefits breakdown */}
          {(() => {
            const renderBenefits = (title: string, items: BenefitItem[] | number | null | undefined, isMoney = true) => {
              if (!items) return null;
              if (typeof items === 'number') return (
                <div className="bg-slate-50 rounded-lg p-3">
                  <p className="text-xs text-slate-500 mb-1">{title}</p>
                  <p className="text-sm font-semibold text-slate-800">{isMoney ? fmt(items) : pct(items)}</p>
                </div>
              );
              if (!Array.isArray(items) || items.length === 0) return null;
              return (
                <div className="bg-slate-50 rounded-lg p-3">
                  <p className="text-xs font-semibold text-slate-500 mb-2">{title}</p>
                  <div className="space-y-1">
                    {items.slice(0, 8).map((b, i) => (
                      <div key={i} className="flex justify-between text-xs">
                        <span className="text-slate-600 truncate mr-2">{b.service_type || `Service ${b.service_code}`}</span>
                        <span className="font-medium text-slate-800 whitespace-nowrap">
                          {b.amount != null ? fmt(b.amount) : b.percent != null ? `${b.percent}%` : '—'}
                          {b.network === 'Y' ? '' : b.network === 'N' ? ' (OON)' : ''}
                        </span>
                      </div>
                    ))}
                    {items.length > 8 && <p className="text-xs text-slate-400">+{items.length - 8} more</p>}
                  </div>
                </div>
              );
            };
            return (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {renderBenefits('Copays', parsed.copay)}
                {renderBenefits('Deductibles', parsed.deductible)}
                {renderBenefits('Coinsurance', parsed.coinsurance, false)}
                {renderBenefits('Out of Pocket', parsed.out_of_pocket)}
              </div>
            );
          })()}

          {/* Errors from 271 */}
          {parsed.errors && parsed.errors.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
              <p className="text-xs font-semibold text-amber-700 mb-1">Payer Notes</p>
              {parsed.errors.map((e, i) => <p key={i} className="text-xs text-amber-600">{String(e)}</p>)}
            </div>
          )}

          {/* Covered services */}
          {parsed.covered_services && parsed.covered_services.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                Covered Services
              </p>
              <div className="flex flex-wrap gap-1.5">
                {parsed.covered_services.map((s, i) => (
                  <span
                    key={i}
                    className="text-xs bg-sky-50 text-sky-700 border border-sky-100 px-2 py-0.5 rounded-full"
                  >
                    {typeof s === 'object' ? JSON.stringify(s) : s}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Raw 271 toggle */}
          <div>
            <button
              onClick={() => setShowRaw(v => !v)}
              className="flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-700"
            >
              {showRaw ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              {showRaw ? 'Hide' : 'Show'} Raw X12 271 Response
            </button>
            {showRaw && (
              <pre className="mt-2 bg-slate-900 text-emerald-400 text-xs p-4 rounded-lg overflow-x-auto whitespace-pre-wrap break-all">
                {typeof result.response_parsed === 'object'
                  ? JSON.stringify(result.response_parsed, null, 2)
                  : String(result.response_parsed ?? '')}
              </pre>
            )}
          </div>
        </div>
      )}

      {/* History */}
      {selectedPatient && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <button
            onClick={() => setHistoryOpen(v => !v)}
            className="w-full flex items-center justify-between px-5 py-3.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-slate-400" />
              Eligibility History — {selectedPatient.first_name} {selectedPatient.last_name}
            </div>
            <div className="flex items-center gap-2">
              {historyData && (
                <span className="text-xs font-normal text-slate-400">{historyData.total} checks</span>
              )}
              <button
                onClick={(e) => { e.stopPropagation(); refetchHistory(); }}
                className="text-slate-400 hover:text-slate-600"
                title="Refresh"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
              {historyOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </div>
          </button>

          {historyOpen && (
            <div className="border-t border-slate-200">
              {!historyData ? (
                <div className="p-6 text-center text-sm text-slate-400">Loading history…</div>
              ) : historyData.checks.length === 0 ? (
                <div className="p-6 text-center text-sm text-slate-400">No eligibility checks yet for this patient.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wide">
                        <th className="px-4 py-2.5 text-left">Date</th>
                        <th className="px-4 py-2.5 text-left">Payer</th>
                        <th className="px-4 py-2.5 text-left">Member ID</th>
                        <th className="px-4 py-2.5 text-left">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {historyData.checks.map(c => (
                        <tr key={c.id} className="hover:bg-slate-50 transition-colors">
                          <td className="px-4 py-3 text-slate-600 whitespace-nowrap">
                            {new Date(c.checked_at).toLocaleDateString('en-US', {
                              month: 'short', day: 'numeric', year: 'numeric',
                              hour: '2-digit', minute: '2-digit',
                            })}
                          </td>
                          <td className="px-4 py-3 text-slate-800">{c.payer_name || '—'}</td>
                          <td className="px-4 py-3 font-mono text-xs text-slate-600">{c.member_id || '—'}</td>
                          <td className="px-4 py-3">
                            <span
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                                c.status === 'active' || c.status === 'eligible'
                                  ? 'bg-emerald-50 text-emerald-700'
                                  : c.status === 'error'
                                  ? 'bg-red-50 text-red-600'
                                  : 'bg-slate-100 text-slate-600'
                              }`}
                            >
                              {c.status === 'active' || c.status === 'eligible'
                                ? '✓'
                                : c.status === 'error'
                                ? '✗'
                                : '·'}{' '}
                              {c.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
