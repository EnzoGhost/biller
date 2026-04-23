import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { XCircle, AlertTriangle, CheckCircle, ChevronDown, ChevronRight, Sparkles } from 'lucide-react';
import api from '../lib/api';
import type { Denial, PaginatedResponse } from '../types';

export default function DenialsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState<number | null>(null);
  const [resolved, setResolved] = useState<boolean | ''>('');

  const params = new URLSearchParams({ per_page: '50' });
  if (resolved !== '') params.set('is_resolved', String(resolved));

  const { data, isLoading } = useQuery<PaginatedResponse<Denial>>({
    queryKey: ['denials', resolved],
    queryFn: () => api.get(`/denials?${params}`).then(r => r.data),
  });

  const analyzeMutation = useMutation({
    mutationFn: (denialId: number) => api.post(`/ai/analyze-denial/${denialId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['denials'] }),
  });

  const resolveMutation = useMutation({
    mutationFn: (denialId: number) => api.patch(`/denials/${denialId}`, { is_resolved: true }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['denials'] }),
  });

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-slate-900">Denegaciones</h1>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-slate-500">Estado:</span>
          <select
            value={String(resolved)}
            onChange={e => setResolved(e.target.value === '' ? '' : e.target.value === 'true')}
            className="px-3 py-1.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 bg-white"
          >
            <option value="">{t('common.all')}</option>
            <option value="false">Pendientes</option>
            <option value="true">Resueltas</option>
          </select>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: 'Total Denegaciones', value: data?.total ?? 0, icon: XCircle, color: 'text-red-500 bg-red-50' },
          { label: 'Pendientes', value: (data?.items ?? []).filter(d => !d.is_resolved).length, icon: AlertTriangle, color: 'text-amber-500 bg-amber-50' },
          { label: 'Resueltas', value: (data?.items ?? []).filter(d => d.is_resolved).length, icon: CheckCircle, color: 'text-emerald-500 bg-emerald-50' },
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

      {/* Denial list */}
      {isLoading ? (
        <div className="flex items-center justify-center h-40">
          <div className="w-5 h-5 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : !data?.items.length ? (
        <div className="text-center py-12 text-slate-400 bg-white rounded-xl border border-slate-200">
          No hay denegaciones
        </div>
      ) : (
        <div className="space-y-2">
          {data.items.map(denial => (
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
                    <span className="text-sm text-slate-700 truncate">{denial.denial_reason}</span>
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0 text-xs text-slate-500">
                  <Link
                    to={`/claims/${denial.claim_id}`}
                    onClick={e => e.stopPropagation()}
                    className="text-sky-600 hover:underline font-mono"
                  >
                    Claim #{denial.claim_id}
                  </Link>
                  <span>{denial.denial_date}</span>
                  {denial.is_resolved && (
                    <span className="text-emerald-600 font-medium">Resuelta</span>
                  )}
                </div>
              </div>

              {/* Expanded detail */}
              {expanded === denial.id && (
                <div className="px-10 pb-4 border-t border-slate-100">
                  <div className="pt-3 grid grid-cols-2 gap-4">
                    {/* CARC / RARC */}
                    <div>
                      <p className="text-xs font-semibold text-slate-500 uppercase mb-2">Códigos de Ajuste</p>
                      <div className="space-y-1 text-sm">
                        {denial.carc_code && (
                          <div><span className="text-slate-400">CARC:</span> <span className="font-mono font-medium">{denial.carc_code}</span></div>
                        )}
                        {denial.rarc_code && (
                          <div><span className="text-slate-400">RARC:</span> <span className="font-mono font-medium">{denial.rarc_code}</span></div>
                        )}
                        {!denial.carc_code && !denial.rarc_code && (
                          <span className="text-slate-400">No disponible</span>
                        )}
                      </div>
                    </div>

                    {/* AI Analysis */}
                    <div>
                      <p className="text-xs font-semibold text-slate-500 uppercase mb-2">Análisis IA</p>
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
                          {analyzeMutation.isPending ? 'Analizando...' : 'Analizar con IA'}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  {!denial.is_resolved && (
                    <div className="mt-3 flex items-center gap-2">
                      <button
                        onClick={() => resolveMutation.mutate(denial.id)}
                        disabled={resolveMutation.isPending}
                        className="flex items-center gap-1.5 bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
                      >
                        <CheckCircle className="w-3.5 h-3.5" />
                        Marcar Resuelta
                      </button>
                      <Link
                        to={`/claims/${denial.claim_id}`}
                        className="flex items-center gap-1.5 text-slate-600 hover:text-slate-900 text-xs font-medium border border-slate-200 px-3 py-1.5 rounded-lg transition-colors"
                      >
                        Ver Reclamación
                      </Link>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
