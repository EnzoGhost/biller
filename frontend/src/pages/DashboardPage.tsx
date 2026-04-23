import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { DollarSign, FileText, TrendingUp, AlertCircle, Clock } from 'lucide-react';
import api from '../lib/api';
import { formatDateShort } from '../lib/dates';
import type { DashboardStats, ClaimStatus } from '../types';
import StatusBadge from '../components/ui/Badge';

const STATUS_ORDER: ClaimStatus[] = ['draft', 'ready', 'submitted', 'accepted', 'paid', 'denied', 'appealed'];

function StatCard({ label, value, sub, icon: Icon, color }: {
  label: string; value: string; sub?: string;
  icon: typeof DollarSign; color: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 flex items-start gap-4">
      <div className={`w-10 h-10 rounded-lg ${color} flex items-center justify-center shrink-0`}>
        <Icon className="w-5 h-5 text-white" />
      </div>
      <div>
        <p className="text-sm text-slate-500">{label}</p>
        <p className="text-xl font-bold text-slate-900 mt-0.5">{value}</p>
        {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { t } = useTranslation();
  const { data: stats, isLoading } = useQuery<DashboardStats>({
    queryKey: ['dashboard'],
    queryFn: () => api.get('/dashboard/stats').then(r => r.data),
    refetchInterval: 60_000,
  });

  const fmt = (n: number) =>
    new Intl.NumberFormat('es-PR', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(n);

  if (isLoading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-6 h-6 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  const s = stats!;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <h1 className="text-xl font-bold text-slate-900 mb-6">{t('dashboard.title')}</h1>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label={t('dashboard.total_claims')} value={String(s.total_claims)} icon={FileText} color="bg-slate-500" />
        <StatCard label={t('dashboard.billed_mtd')} value={fmt(s.total_billed_mtd)} icon={DollarSign} color="bg-sky-500" />
        <StatCard label={t('dashboard.collected_mtd')} value={fmt(s.total_paid_mtd)} icon={TrendingUp} color="bg-emerald-500" />
        <StatCard
          label={t('dashboard.collection_rate')}
          value={`${s.collection_rate.toFixed(1)}%`}
          sub={`${s.pending_appeals} ${t('dashboard.pending_appeals').toLowerCase()}`}
          icon={AlertCircle}
          color="bg-amber-500"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Claims by status */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h2 className="text-sm font-semibold text-slate-700 mb-4">{t('dashboard.claims_by_status')}</h2>
          <div className="space-y-2">
            {STATUS_ORDER.map(status => {
              const count = s.claims_by_status[status] ?? 0;
              if (count === 0) return null;
              return (
                <div key={status} className="flex items-center justify-between">
                  <StatusBadge status={status} />
                  <span className="text-sm font-semibold text-slate-900">{count}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Top denials */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h2 className="text-sm font-semibold text-slate-700 mb-4">{t('dashboard.top_denials')}</h2>
          {s.top_denial_reasons.length === 0 ? (
            <p className="text-sm text-slate-400">{t('dashboard.no_denials')}</p>
          ) : (
            <div className="space-y-3">
              {s.top_denial_reasons.map((d, i) => (
                <div key={i} className="flex items-start gap-2">
                  <span className="text-xs font-bold text-rose-600 bg-rose-50 rounded px-1.5 py-0.5 shrink-0">
                    {d.count}
                  </span>
                  <p className="text-sm text-slate-700 leading-snug">{d.reason}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent claims */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h2 className="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2">
            <Clock className="w-4 h-4 text-slate-400" />
            {t('dashboard.recent_claims')}
          </h2>
          <div className="space-y-2">
            {s.recent_claims.map(claim => (
              <div key={claim.id} className="flex items-center justify-between py-1 border-b border-slate-50 last:border-0">
                <div>
                  <p className="text-xs font-mono text-slate-700">{claim.claim_number}</p>
                  <p className="text-xs text-slate-400">{formatDateShort(claim.service_date_from)}</p>
                </div>
                <div className="text-right">
                  <StatusBadge status={claim.status} />
                  <p className="text-xs text-slate-600 mt-1">{fmt(claim.total_billed)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
