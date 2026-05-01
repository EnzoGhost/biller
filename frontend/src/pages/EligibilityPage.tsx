import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { CheckCircle, XCircle, Search, AlertCircle, Globe, User } from 'lucide-react';
import api from '../lib/api';
import { formatDate } from '../lib/dates';
import DatePicker from '../components/ui/DatePicker';
import type { Patient, Payer } from '../types';

interface EligibilityResult {
  is_eligible: boolean;
  payer_name?: string;
  member_id: string;
  coverage_start?: string;
  coverage_end?: string;
  copay?: number;
  deductible?: number;
  deductible_met?: number;
  out_of_pocket_max?: number;
  out_of_pocket_met?: number;
  raw_response?: Record<string, unknown>;
}

interface StediPayer {
  stediId: string;
  displayName: string;
  primaryPayerId: string;
  operatingStates?: string[];
  transactionSupport?: {
    eligibilityCheck?: string;
    claimSubmission?: string;
  };
  coverageTypes?: string[];
}

const fmt = (n?: number) =>
  n != null
    ? new Intl.NumberFormat('es-PR', { style: 'currency', currency: 'USD' }).format(n)
    : '—';

export default function EligibilityPage() {
  const { t } = useTranslation();

  const [payerId, setPayerId] = useState('');
  const [memberId, setMemberId] = useState('');
  const [patientFirstName, setPatientFirstName] = useState('');
  const [patientLastName, setPatientLastName] = useState('');
  const [dob, setDob] = useState('');
  const [result, setResult] = useState<EligibilityResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPrPayers, setShowPrPayers] = useState(false);
  const [selectedStediPayer, setSelectedStediPayer] = useState<StediPayer | null>(null);

  // Patient search state
  const [patientSearch, setPatientSearch] = useState('');
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [showPatientDropdown, setShowPatientDropdown] = useState(false);

  const { data: payers } = useQuery<{ items: Payer[] }>({
    queryKey: ['payers-all'],
    queryFn: () => api.get('/payers?per_page=200').then(r => r.data),
  });

  const { data: patientResults } = useQuery<{ items: Patient[] }>({
    queryKey: ['patient-search', patientSearch],
    queryFn: () => api.get(`/patients?per_page=20&search=${encodeURIComponent(patientSearch)}`).then(r => r.data),
    enabled: patientSearch.length >= 2,
  });

  const { data: prPayers, isLoading: loadingPrPayers } = useQuery<{ items: StediPayer[]; total: number }>({
    queryKey: ['stedi-payers-pr'],
    queryFn: () => api.get('/stedi/payers/pr').then(r => r.data),
    enabled: showPrPayers,
    staleTime: 5 * 60 * 1000,
  });

  const selectPatient = (patient: Patient) => {
    setSelectedPatient(patient);
    setPatientFirstName(patient.first_name);
    setPatientLastName(patient.last_name);
    setDob(patient.dob);
    // Auto-fill payer from primary insurance
    const primary = patient.insurances?.find(i => i.is_primary) ?? patient.insurances?.[0];
    if (primary) {
      setPayerId(String(primary.payer_id));
      setMemberId(primary.member_id);
    }
    setShowPatientDropdown(false);
    setPatientSearch('');
  };

  const handleCheck = async () => {
    if (!payerId || !memberId) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const { data } = await api.post('/stedi/eligibility', {
        payer_id: Number(payerId),
        member_id: memberId,
        patient_dob: dob || new Date().toISOString().split('T')[0],
        patient_first_name: patientFirstName || '',
        patient_last_name: patientLastName || '',
      });
      setResult(data);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(msg ?? t('eligibility.error_checking'));
    } finally {
      setLoading(false);
    }
  };

  const eligibilityBadge = (status?: string) => {
    if (status === 'SUPPORTED') return <span className="text-xs font-medium text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">✓ Elegibilidad</span>;
    if (status === 'ENROLLMENT_REQUIRED') return <span className="text-xs font-medium text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">Requiere Enrollment</span>;
    return <span className="text-xs text-slate-400">Sin soporte</span>;
  };

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <h1 className="text-xl font-bold text-slate-900 mb-6">{t('eligibility.title')}</h1>

      {/* PR Payer Directory Panel */}
      <div className="mb-6">
        <button
          onClick={() => setShowPrPayers(v => !v)}
          className="flex items-center gap-2 text-sm font-medium text-sky-600 hover:text-sky-700 transition-colors"
        >
          <Globe className="w-4 h-4" />
          {showPrPayers ? 'Ocultar directorio de pagadores PR' : 'Ver pagadores de Puerto Rico (Stedi)'}
        </button>

        {showPrPayers && (
          <div className="mt-3 bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-4 py-3 bg-sky-50 border-b border-slate-200">
              <p className="text-sm font-semibold text-sky-800">Pagadores de Puerto Rico — Directorio Stedi</p>
              {prPayers && <p className="text-xs text-sky-600 mt-0.5">{prPayers.total} pagadores encontrados</p>}
            </div>
            {loadingPrPayers ? (
              <div className="p-6 text-center text-sm text-slate-400">Cargando directorio…</div>
            ) : (
              <div className="divide-y divide-slate-100 max-h-80 overflow-y-auto">
                {prPayers?.items.map(p => (
                  <div
                    key={p.stediId}
                    className={`flex items-center justify-between px-4 py-3 hover:bg-slate-50 cursor-pointer transition-colors ${selectedStediPayer?.stediId === p.stediId ? 'bg-sky-50' : ''}`}
                    onClick={() => setSelectedStediPayer(prev => prev?.stediId === p.stediId ? null : p)}
                  >
                    <div>
                      <p className="text-sm font-medium text-slate-800">{p.displayName}</p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        ID: {p.primaryPayerId}
                        {p.operatingStates?.includes('PR') && <span className="ml-2 text-sky-500 font-semibold">🇵🇷 PR</span>}
                        {p.coverageTypes && p.coverageTypes.length > 0 && <span className="ml-2 text-slate-300">· {p.coverageTypes.join(', ')}</span>}
                      </p>
                    </div>
                    {eligibilityBadge(p.transactionSupport?.eligibilityCheck)}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Form */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6 space-y-4">
        {selectedStediPayer && (
          <div className="flex items-center gap-3 bg-sky-50 border border-sky-100 rounded-lg px-4 py-3">
            <Globe className="w-4 h-4 text-sky-500 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-sky-700 uppercase tracking-wide">Stedi Payer Seleccionado</p>
              <p className="text-sm font-medium text-sky-900 truncate">{selectedStediPayer.displayName}</p>
              <p className="text-xs text-sky-500">Stedi ID: {selectedStediPayer.stediId} · Payer ID: {selectedStediPayer.primaryPayerId}</p>
            </div>
            <button onClick={() => setSelectedStediPayer(null)} className="text-xs text-sky-400 hover:text-sky-600">✕</button>
          </div>
        )}

        {/* Patient Search — ONE box that auto-fills everything */}
        <div>
          <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
            {t('patients.name')} / {t('eligibility.payer')}
          </label>
          {selectedPatient ? (
            <div className="flex items-center gap-3 bg-sky-50 border border-sky-200 rounded-lg px-3 py-2.5">
              <User className="w-4 h-4 text-sky-500 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-slate-800">{selectedPatient.first_name} {selectedPatient.last_name}</p>
                <p className="text-xs text-slate-500">{t('patients.dob')}: {formatDate(dob)} · {t('eligibility.member_id')}: {memberId}</p>
              </div>
              <button
                onClick={() => {
                  setSelectedPatient(null);
                  setPatientFirstName('');
                  setPatientLastName('');
                  setDob('');
                  setMemberId('');
                  setPayerId('');
                }}
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
                placeholder={t('patients.name') + '...'}
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
                        <p className="text-sm font-medium text-slate-800">{p.first_name} {p.last_name}</p>
                        <p className="text-xs text-slate-500">
                          {t('patients.dob')}: {formatDate(p.dob)}
                          {primary && ` · ${primary.payer?.name ?? 'Payer #' + primary.payer_id} · ${primary.member_id}`}
                        </p>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
              {t('eligibility.payer')}
            </label>
            <select
              value={payerId}
              onChange={e => setPayerId(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 bg-white"
            >
              <option value="">— {t('common.search')} —</option>
              {payers?.items.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
              {t('eligibility.member_id')}
            </label>
            <input
              value={memberId}
              onChange={e => setMemberId(e.target.value)}
              placeholder="XYZ123456"
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
          </div>

          {!selectedPatient && (
            <>
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
                  {t('patients.name')} ({t('common.first')})
                </label>
                <input
                  value={patientFirstName}
                  onChange={e => setPatientFirstName(e.target.value)}
                  placeholder={t('common.first_name')}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
                  {t('patients.name')} ({t('common.last')})
                </label>
                <input
                  value={patientLastName}
                  onChange={e => setPatientLastName(e.target.value)}
                  placeholder={t('common.last_name')}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>
            </>
          )}

          <div>
            <DatePicker
              label={t('patients.dob')}
              value={dob}
              onChange={setDob}
            />
          </div>
        </div>

        <button
          onClick={handleCheck}
          disabled={loading || !payerId || !memberId}
          className="flex items-center gap-2 bg-sky-500 hover:bg-sky-600 disabled:opacity-50 text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors"
        >
          <Search className="w-4 h-4" />
          {loading ? t('common.loading') : t('eligibility.check')}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6 flex items-center gap-3 text-red-700 text-sm">
          <AlertCircle className="w-5 h-5 shrink-0" />
          {error}
        </div>
      )}

      {/* Result */}
      {result && (
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <div className={`flex items-center gap-3 p-4 rounded-lg mb-6 ${result.is_eligible ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'}`}>
            {result.is_eligible
              ? <CheckCircle className="w-6 h-6 text-emerald-600 shrink-0" />
              : <XCircle className="w-6 h-6 text-red-500 shrink-0" />}
            <div>
              <p className="font-bold text-base">
                {result.is_eligible ? t('eligibility.eligible') : t('eligibility.not_eligible')}
              </p>
              {result.payer_name && (
                <p className="text-sm opacity-80">{result.payer_name} · {result.member_id}</p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {[
              { label: t('eligibility.copay'), value: fmt(result.copay) },
              { label: t('eligibility.deductible'), value: fmt(result.deductible) },
              { label: t('eligibility.deductible_met'), value: fmt(result.deductible_met) },
              { label: t('eligibility.oop_max'), value: fmt(result.out_of_pocket_max) },
              { label: t('eligibility.oop_met'), value: fmt(result.out_of_pocket_met) },
              { label: t('eligibility.coverage_start'), value: result.coverage_start ? formatDate(result.coverage_start) : '—' },
            ].map(({ label, value }) => (
              <div key={label} className="bg-slate-50 rounded-lg p-3">
                <p className="text-xs text-slate-500 mb-1">{label}</p>
                <p className="text-sm font-semibold text-slate-800">{value}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
