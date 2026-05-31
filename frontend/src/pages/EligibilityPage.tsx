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

/** Format YYYYMMDD or YYYY-MM-DD dates to human-readable (e.g., "March 1, 2026") */
function formatEligDate(raw: string | null | undefined): string {
  if (!raw) return 'Not listed';
  // Handle YYYYMMDD
  const m8 = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m8) {
    const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    return `${months[parseInt(m8[2],10)-1]} ${parseInt(m8[3],10)}, ${m8[1]}`;
  }
  // Fall back to formatDate for YYYY-MM-DD
  return formatDate(raw);
}
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
  subscriber_name?: string;
  status: string;
  response_parsed?: Record<string, unknown>;
  response_raw?: string;
  checked_at: string;
}

interface BenefitItem {
  service_type?: string;
  service_code?: string;
  amount?: number;
  percent?: number;
  network?: string;
  remaining?: number;
}

interface ParsedEligibility {
  status?: string;
  subscriber_name?: string;
  member_id?: string;
  payer_name?: string;
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
        service_type_codes: [serviceType, 'BV'],  // Include optometry/vision code
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
      {result && (() => {
        const effectiveDate = parsed.effective_date || parsed.plan_begin || null;
        const termDate = parsed.term_date || parsed.plan_end || null;
        const copays = (Array.isArray(parsed.copay) && parsed.copay.length > 0 ? parsed.copay : []) as BenefitItem[];
        const deductibles = (Array.isArray(parsed.deductible) && parsed.deductible.length > 0 ? parsed.deductible : []) as BenefitItem[];
        const coinsurance = (Array.isArray(parsed.coinsurance) ? parsed.coinsurance : []) as BenefitItem[];
        const outOfPocket = (Array.isArray(parsed.out_of_pocket) ? parsed.out_of_pocket : []) as BenefitItem[];
        const hasPatientCosts = copays.length > 0 || deductibles.length > 0 || coinsurance.length > 0 || outOfPocket.length > 0;
        const subscriberName = parsed.subscriber_name as string | undefined || result.subscriber_name;
        const memberId = parsed.member_id as string | undefined || result.member_id;
        const payerName = parsed.payer_name as string | undefined || result.payer_name;
        const planName = parsed.plan_name as string | undefined;
        return (
          <div className="bg-white rounded-xl border border-slate-200 p-5 mb-6 space-y-2.5">

            {/* Status badge */}
            <div className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border ${
              isEligible
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                : result.status === 'inactive'
                ? 'bg-red-50 text-red-700 border-red-100'
                : 'bg-slate-50 text-slate-600 border-slate-200'
            }`}>
              {isEligible ? <CheckCircle className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
              {isEligible ? 'Active Coverage' : result.status === 'inactive' ? 'Inactive' : 'Unknown'}
            </div>

            {/* Member info — compact */}
            <div className="space-y-0.5">
              {subscriberName && <p className="text-xs font-semibold text-slate-700">{subscriberName}</p>}
              {memberId && <p className="text-xs text-slate-600">Member ID: <span className="font-mono font-semibold">{memberId}</span></p>}
              {payerName && <p className="text-xs text-slate-600">Payer: {payerName}</p>}
              {planName && <p className="text-xs text-slate-600">Plan: {planName}</p>}
            </div>

            {/* Coverage dates */}
            {(effectiveDate || termDate) && (
              <div className="space-y-0.5">
                {effectiveDate && <p className="text-xs text-slate-600">Effective: <span className="font-semibold">{formatEligDate(effectiveDate as string)}</span></p>}
                <p className="text-xs text-slate-600">Expires: <span className="font-semibold">{formatEligDate(termDate as string)}</span></p>
              </div>
            )}

            {/* Patient costs */}
            {hasPatientCosts && (
              <div className="space-y-0.5">
                <p className="text-xs font-semibold text-slate-700">Patient Costs</p>
                {copays.map((c, i) => (
                  <p key={`cp-${i}`} className="text-xs text-slate-600">
                    Copay: <span className="font-semibold">${c.amount != null ? (typeof c.amount === 'number' ? c.amount.toFixed(0) : c.amount) : '—'}</span>
                    {c.service_type && c.service_type !== 'Other' ? ` (${c.service_type})` : ''}
                  </p>
                ))}
                {deductibles.map((d, i) => (
                  <p key={`dd-${i}`} className="text-xs text-slate-600">
                    Deductible: <span className="font-semibold">${d.amount != null ? (typeof d.amount === 'number' ? d.amount.toFixed(0) : d.amount) : '—'}</span>
                    {d.remaining != null ? ` ($${d.remaining} remaining)` : ''}
                  </p>
                ))}
                {coinsurance.map((c, i) => (
                  <p key={`ci-${i}`} className="text-xs text-slate-600">
                    Coinsurance: <span className="font-semibold">{c.percent != null ? `${c.percent}%` : '—'}</span>
                  </p>
                ))}
                {outOfPocket.map((o, i) => (
                  <p key={`oop-${i}`} className="text-xs text-slate-600">
                    Out-of-Pocket Max: <span className="font-semibold">${o.amount != null ? (typeof o.amount === 'number' ? o.amount.toFixed(0) : o.amount) : '—'}</span>
                    {o.remaining != null ? ` ($${o.remaining} remaining)` : ''}
                  </p>
                ))}
              </div>
            )}

            {/* Covered services */}
            {parsed.covered_services && parsed.covered_services.length > 0 && (
              <div className="space-y-0.5">
                <p className="text-xs font-semibold text-slate-700">Covered</p>
                {parsed.covered_services.map((svc, i) => (
                  <p key={i} className="text-xs text-slate-600">{typeof svc === 'object' ? JSON.stringify(svc) : svc}</p>
                ))}
              </div>
            )}

            {/* Non-covered */}
            {parsed.non_covered && parsed.non_covered.length > 0 && (
              <div className="space-y-0.5">
                <p className="text-xs font-semibold text-amber-700">Not Covered</p>
                {parsed.non_covered.map((svc, i) => (
                  <p key={i} className="text-xs text-amber-600">{svc}</p>
                ))}
              </div>
            )}

            {/* Errors */}
            {parsed.errors && parsed.errors.length > 0 && (
              <div className="text-xs text-red-600">
                {parsed.errors.map((e, i) => <p key={i}>{String(e)}</p>)}
              </div>
            )}

            {/* Raw response toggle */}
            <div>
              <button
                onClick={() => setShowRaw(v => !v)}
                className="flex items-center gap-1.5 text-[11px] text-slate-400 hover:text-slate-600 transition-colors"
              >
                {showRaw ? <ChevronUp className="w-2.5 h-2.5" /> : <ChevronDown className="w-2.5 h-2.5" />}
                Raw X12 271 Response
              </button>
              {showRaw && (
                <div className="mt-1 space-y-2">
                  <pre className="text-[10px] bg-slate-900 text-slate-100 rounded-lg p-2 overflow-auto whitespace-pre-wrap">
                    {JSON.stringify(parsed, null, 2)}
                  </pre>
                  {result.response_raw && (
                    <div>
                      <p className="text-[10px] font-semibold text-slate-500 mb-1">Raw X12 EDI</p>
                      <pre className="text-[10px] bg-slate-900 text-emerald-400 rounded-lg p-2 overflow-auto whitespace-pre-wrap break-all">
                        {result.response_raw.split('~').join('~\n')}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>

          </div>
        );
      })()}

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
