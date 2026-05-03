import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Search, Building2, Phone, Mail } from 'lucide-react';
import { displayPhone } from '../lib/format';
import api from '../lib/api';
import type { Payer, PayerType, PaginatedResponse } from '../types';

const PAYER_TYPES: PayerType[] = ['commercial', 'medicare', 'medicaid', 'vision', 'dental', 'other'];

const typeColors: Record<PayerType, string> = {
  commercial: 'bg-sky-100 text-sky-700',
  medicare:   'bg-blue-100 text-blue-700',
  medicaid:   'bg-violet-100 text-violet-700',
  vision:     'bg-emerald-100 text-emerald-700',
  dental:     'bg-amber-100 text-amber-700',
  other:      'bg-slate-100 text-slate-600',
};



export default function PayersPage() {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [type, setType] = useState<PayerType | ''>('');

  const typeLabels: Record<PayerType, string> = {
    commercial: t('payers.commercial'),
    medicare:   t('payers.medicare'),
    medicaid:   t('payers.medicaid'),
    vision:     t('payers.vision'),
    dental:     t('payers.dental'),
    other:      t('payers.other'),
  };

  const params = new URLSearchParams({ per_page: '100' });
  if (type) params.set('payer_type', type);

  const { data, isLoading } = useQuery<PaginatedResponse<Payer>>({
    queryKey: ['payers', type],
    queryFn: () => api.get(`/payers?${params}`).then(r => r.data),
  });

  const filtered = (data?.items ?? []).filter(p =>
    !search ||
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    p.payer_id.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <h1 className="text-xl font-bold text-slate-900 mb-6">{t('nav.payers')}</h1>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 mb-6 flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t('common.search')}
            className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
          />
        </div>
        <select
          value={type}
          onChange={e => setType(e.target.value as PayerType | '')}
          className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 bg-white"
        >
          <option value="">{t('common.all')}</option>
          {PAYER_TYPES.map(pt => (
            <option key={pt} value={pt}>{typeLabels[pt]}</option>
          ))}
        </select>
      </div>

      {/* Grid */}
      {isLoading ? (
        <div className="flex items-center justify-center h-40">
          <div className="w-5 h-5 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : !filtered.length ? (
        <div className="text-center py-12 text-slate-400">{t('payers.no_payers')}</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(payer => (
            <div
              key={payer.id}
              className="bg-white rounded-xl border border-slate-200 p-5 hover:border-sky-300 transition-colors"
            >
              <div className="flex items-start justify-between gap-2 mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-sky-50 flex items-center justify-center shrink-0">
                    <Building2 className="w-4 h-4 text-sky-600" />
                  </div>
                  <div>
                    <p className="font-semibold text-slate-800 text-sm leading-tight">{payer.name}</p>
                    <p className="text-xs text-slate-400 font-mono">{payer.payer_id}</p>
                  </div>
                </div>
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${typeColors[payer.payer_type]}`}>
                  {typeLabels[payer.payer_type]}
                </span>
              </div>

              <div className="space-y-1.5 text-xs text-slate-600">
                {payer.phone && (
                  <div className="flex items-center gap-2">
                    <Phone className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    {displayPhone(payer.phone)}
                  </div>
                )}
                {payer.city && (
                  <div className="flex items-center gap-2">
                    <Mail className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    {payer.city}, {payer.state} {payer.zip_code}
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <span className="text-slate-400">{t('payers.method')}:</span>
                  <span className="font-medium uppercase">{payer.submission_method}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-slate-400">{t('payers.timely_filing')}:</span>
                  <span className="font-medium">{payer.timely_filing_days} {t('common.days')}</span>
                </div>
                {payer.stedi_payer_id && (
                  <div className="flex items-center gap-2">
                    <span className="text-slate-400">Stedi ID:</span>
                    <span className="font-mono">{payer.stedi_payer_id}</span>
                  </div>
                )}
              </div>

              {!payer.is_active && (
                <div className="mt-3 text-xs text-red-600 font-medium">{t('payers.inactive')}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
