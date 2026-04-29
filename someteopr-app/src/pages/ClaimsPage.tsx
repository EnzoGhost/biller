import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Plus, Search, ChevronLeft, ChevronRight } from 'lucide-react';
import api from '../lib/api';
import { formatDateShort } from '../lib/dates';
import type { Claim, ClaimStatus, PaginatedResponse } from '../types';
import StatusBadge from '../components/ui/Badge';

const ALL_STATUSES: ClaimStatus[] = ['draft', 'ready', 'submitted', 'accepted', 'rejected', 'paid', 'denied', 'appealed', 'void'];

export default function ClaimsPage() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<ClaimStatus | ''>('' );
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  // Debounce search input 350ms
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1); // Reset to first page on new search
    }, 350);
    return () => clearTimeout(timer);
  }, [search]);

  // Sync status from URL ?status=xxx
  useEffect(() => {
    const s = searchParams.get('status') as ClaimStatus | null;
    if (s) setStatus(s);
  }, [searchParams]);

  const params = new URLSearchParams({ page: String(page), per_page: '25' });
  if (status) params.set('status', status);
  if (debouncedSearch) params.set('search', debouncedSearch);

  const { data, isLoading } = useQuery<PaginatedResponse<Claim>>({
    queryKey: ['claims', page, status, debouncedSearch],
    queryFn: () => api.get(`/claims?${params}`).then(r => r.data),
  });

  const fmt = (n: number) =>
    new Intl.NumberFormat('es-PR', { style: 'currency', currency: 'USD' }).format(n);

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-slate-900">{t('claims.title')}</h1>
        <Link
          to="/claims/new"
          className="flex items-center gap-2 bg-sky-500 hover:bg-sky-600 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" />
          {t('claims.new')}
        </Link>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 mb-4 flex flex-wrap gap-3">
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
          value={status}
          onChange={e => { setStatus(e.target.value as ClaimStatus | ''); setPage(1); }}
          /* page already reset by status change above */
          className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 bg-white"
        >
          <option value="">{t('common.all')}</option>
          {ALL_STATUSES.map(s => (
            <option key={s} value={s}>{t(`status.${s}`)}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center h-40">
            <div className="w-5 h-5 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : !data?.items.length ? (
          <div className="text-center py-12 text-slate-400">{t('claims.no_claims')}</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">{t('claims.claim_number')}</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">{t('claims.patient')}</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">{t('claims.payer')}</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">{t('claims.service_date')}</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">{t('claims.billed')}</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">{t('claims.paid')}</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">{t('claims.status')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.items.map(claim => (
                <tr key={claim.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3">
                    <Link to={`/claims/${claim.id}`} className="font-mono text-sky-600 hover:underline text-xs">
                      {claim.claim_number}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    {claim.patient ? `${claim.patient.last_name}, ${claim.patient.first_name}` : `#${claim.patient_id}`}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {claim.payer?.name ?? `#${claim.payer_id}`}
                    {claim.payer?.is_reforma && (
                      <span className="ml-2 text-xs font-medium bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">
                        {t('routing.manual_stedi_portal')}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{formatDateShort(claim.service_date_from)}</td>
                  <td className="px-4 py-3 text-right font-medium text-slate-900">{fmt(claim.total_billed)}</td>
                  <td className="px-4 py-3 text-right font-medium text-emerald-700">{fmt(claim.total_paid)}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={claim.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {data && data.pages > 1 && (
        <div className="flex items-center justify-between mt-4 text-sm text-slate-600">
          <span>{t('common.page')} {data.page} {t('common.of')} {data.pages} ({data.total} total)</span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="flex items-center gap-1 px-3 py-1.5 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-40"
            >
              <ChevronLeft className="w-4 h-4" /> {t('common.previous')}
            </button>
            <button
              onClick={() => setPage(p => p + 1)}
              disabled={page >= data.pages}
              className="flex items-center gap-1 px-3 py-1.5 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-40"
            >
              {t('common.next')} <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
