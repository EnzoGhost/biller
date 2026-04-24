import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { XCircle, AlertTriangle, CheckCircle, ChevronDown, ChevronRight, Sparkles, Search, FileText } from 'lucide-react';
import api from '../lib/api';
import { formatDateShort } from '../lib/dates';
import type { Denial, PaginatedResponse } from '../types';

export default function DenialsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [searchParams] = useSearchParams();
  const [expanded, setExpanded] = useState<number | null>(null);
  const [resolved, setResolved] = useState<boolean | ''>('');
  const [search, setSearch] = useState('');
  const [filterCode, setFilterCode] = useState('');

  // Pre-fill search/filter from URL query params
  useEffect(() => {
    const reason = searchParams.get('reason');
    if (reason) setSearch(reason);
    const code = searchParams.get('code');
    if (code) setFilterCode(code);
  }, [searchParams]);

  const params = new URLSearchParams({ per_page: '100' });
  if (resolved !== '') params.set('is_resolved', String(resolved));

  const { data, isLoading } = useQuery<PaginatedResponse<Denial>>({
    queryKey: ['denials', resolved],
    queryFn: () => api.get(`/denials?${params}`).then(r => r.data),
  });

  const analyzeMutation = useMutation({
    mutationFn: (denialId: number) => api.post('/ai/denial-analysis', { denial_id: denialId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['denials'] }),
  });

  const resolveMutation = useMutation({
    mutationFn: (denialId: number) => api.patch(`/denials/${denialId}`, { is_resolved: true }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['denials'] }),
  });

  const appealMutation = useMutation({
    mutationFn: (claimId: number) => api.post(`/claims/${claimId}/appeals`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['denials'] }),
  });

  // Client-side filtering
  const allItems = data?.items ?? [];
  const filtered = allItems.filter(d => {
    const searchLower = search.toLowerCase();
    if (search && !(
      d.denial_code?.toLowerCase().includes(searchLower) ||
      d.denial_reason?.toLowerCase().includes(searchLower) ||
      String(d.claim_id).includes(searchLower)
    )) return false;
    if (filterCode && d.denial_code !== filterCode) return false;
    return true;
  });

  const uniqueCodes = Array.from(new Set(allItems.map(d => d.denial_code).filter(Boolean)));

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-slate-900">{t('denials.title')}</h1>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: t('denials.total'), value: data?.total ?? 0, icon: XCircle, color: 'text-red-500 bg-red-50' },
          { label: t('denials.pending'), value: allItems.filter(d => !d.is_resolved).length, icon: AlertTriangle, color: 'text-amber-500 bg-amber-50' },
          { label: t('denials.resolved'), value: allItems.filter(d => d.is_resolved).length, icon: CheckCircle, color: 'text-emerald-500 bg-emerald-50' },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="bg-white rounded-xl border border-slate-200 p-4 flex items-center gap-4">
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${color}`}>
              <Icon className="w-5 h-5" />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-800">{value}</p>
              <p className="text-xs text-slate-500">{label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 mb-4 flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t('common.search') + '...'}
            className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
          />
        </div>
        <select
          value={String(resolved)}
          onChange={e => setResolved(e.target.value === '' ? '' : e.target.value === 'true')}
          className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 bg-white"
        >
          <option value="">{t('common.all')}</option>
          <option value="false">{t('denials.pending')}</option>
          <option value="true">{t('denials.resolved')}</option>
        </select>
        {uniqueCodes.length > 0 && (
          <select
            value={filterCode}
            onChange={e => setFilterCode(e.target.value)}
            className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 bg-white"
          >
            <option value="">{t('denials.filter_code') ?? 'All codes'}</option>
            {uniqueCodes.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
      </div>

      {/* Denial list */}
      {isLoading ? (
        <div className="flex items-center justify-center h-40">
          <div className="w-5 h-5 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : !filtered.length ? (
        <div className="text-center py-12 text-slate-400 bg-white rounded-xl border border-slate-200">
          {t('denials.no_denials')}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(denial => (
            <div
              key={denial.id}
              className={`bg-white rounded-xl border transition-colors ${
                denial.is_resolved ? 'border-slate-100' : 'border-red-100'
              }`}
            >
              {/* Row header */}
              <div
                className="flex items-center gap-3 px-4 py-3 cursor-pointer"
                onClick={() => setExpanded(expanded === denial.id ? null : denial.id)}
              >
                <button className="text-slate-400">
                  {expanded === denial.id
                    ? <ChevronDown className="w-4 h-4" />
                    : <ChevronRight className="w-4 h-4" />}
                </button>

                <div className={`w-2 h-2 rounded-full shrink-0 ${denial.is_resolved ? 'bg-emerald-400' : 'bg-red-400'}`} />

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-bold text-red-700 bg-red-50 px-2 py-0.5 rounded">
                      {denial.denial_code}
                    </span>
                    <span className="text-sm text-slate-700 truncate">
                      {t(`denials.carc_codes.${denial.denial_code}`, { defaultValue: denial.denial_reason ?? '' })}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0 text-xs text-slate-500">
                  <Link
                    to={`/claims/${denial.claim_id}`}
                    onClick={e => e.stopPropagation()}
                    className="text-sky-600 hover:underline font-mono flex items-center gap-1"
                  >
                    <FileText className="w-3 h-3" />
                    #{denial.claim_id}
                  </Link>
                  <span>{formatDateShort(denial.denial_date)}</span>
                  {denial.is_resolved && (
                    <span className="text-emerald-600 font-medium">{t('denials.resolved_tag')}</span>
                  )}
                </div>
              </div>

              {/* Expanded detail */}
              {expanded === denial.id && (
                <div className="px-10 pb-4 border-t border-slate-100">
                  <div className="pt-3 grid grid-cols-2 gap-4">
                    {/* CARC / RARC */}
                    <div>
                      <p className="text-xs font-semibold text-slate-500 uppercase mb-2">{t('denials.adjustment_codes')}</p>
                      <div className="space-y-1 text-sm">
                        {denial.carc_code && (
                          <div><span className="text-slate-400">CARC:</span> <span className="font-mono font-medium">{denial.carc_code}</span></div>
                        )}
                        {denial.rarc_code && (
                          <div><span className="text-slate-400">RARC:</span> <span className="font-mono font-medium">{denial.rarc_code}</span></div>
                        )}
                        {!denial.carc_code && !denial.rarc_code && (
                          <span className="text-slate-400">{t('denials.not_available')}</span>
                        )}
                      </div>
                    </div>

                    {/* AI Analysis */}
                    <div>
                      <p className="text-xs font-semibold text-slate-500 uppercase mb-2">{t('denials.ai_analysis')}</p>
                      {denial.ai_analysis ? (
                        <div className="text-sm text-slate-700 bg-sky-50 rounded-lg p-3 space-y-1">
                          {Object.entries(denial.ai_analysis).map(([k, v]) => (
                            <div key={k}>
                              <span className="text-xs font-semibold text-sky-700 capitalize">{k}:</span>{' '}
                              <span>{String(v)}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <button
                          onClick={() => analyzeMutation.mutate(denial.id)}
                          disabled={analyzeMutation.isPending}
                          className="flex items-center gap-1.5 text-sky-600 hover:text-sky-700 text-sm font-medium border border-sky-200 hover:border-sky-300 px-3 py-1.5 rounded-lg transition-colors"
                        >
                          <Sparkles className="w-3.5 h-3.5" />
                          {analyzeMutation.isPending ? t('denials.analyzing') : t('denials.analyze_ai')}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="mt-3 flex items-center gap-2">
                    {!denial.is_resolved && (
                      <button
                        onClick={() => resolveMutation.mutate(denial.id)}
                        disabled={resolveMutation.isPending}
                        className="flex items-center gap-1.5 bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
                      >
                        <CheckCircle className="w-3.5 h-3.5" />
                        {t('denials.resolve')}
                      </button>
                    )}
                    <Link
                      to={`/claims/${denial.claim_id}`}
                      className="flex items-center gap-1.5 text-slate-600 hover:text-slate-900 text-xs font-medium border border-slate-200 px-3 py-1.5 rounded-lg transition-colors"
                    >
                      {t('denials.view_claim')}
                    </Link>
                    {!denial.is_resolved && (
                      <button
                        onClick={() => appealMutation.mutate(denial.claim_id)}
                        disabled={appealMutation.isPending}
                        className="flex items-center gap-1.5 text-indigo-600 hover:text-indigo-700 text-xs font-medium border border-indigo-200 px-3 py-1.5 rounded-lg transition-colors"
                      >
                        <FileText className="w-3.5 h-3.5" />
                        {t('denials.appeal') ?? 'Appeal'}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
