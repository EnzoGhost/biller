import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { CheckCircle, XCircle, Search, AlertCircle } from 'lucide-react';
import api from '../lib/api';
import { formatDate } from '../lib/dates';
import DatePicker from '../components/ui/DatePicker';
import type { Payer } from '../types';

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

  const { data: payers } = useQuery<{ items: Payer[] }>({
    queryKey: ['payers-all'],
    queryFn: () => api.get('/payers?per_page=200').then(r => r.data),
  });

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
      setError(msg ?? 'Error al verificar elegibilidad');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <h1 className="text-xl font-bold text-slate-900 mb-6">{t('eligibility.title')}</h1>

      {/* Form */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6 space-y-4">
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

          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
              {t('patients.name')} ({t('common.first')})
            </label>
            <input
              value={patientFirstName}
              onChange={e => setPatientFirstName(e.target.value)}
              placeholder="Nombre"
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
              placeholder="Apellido"
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
          </div>

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
          {/* Status banner */}
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

          {/* Benefits grid */}
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
