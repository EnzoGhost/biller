import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { BarChart3, TrendingUp, AlertTriangle, Clock, DollarSign } from 'lucide-react';
import api from '../lib/api';

interface ReportData {
  claims_by_payer: Array<{ payer: string; claims: number; billed: number; paid: number }>;
  revenue_by_month: Array<{ month: string; billed: number; paid: number; count: number }>;
  denial_rate_by_payer: Array<{ payer: string; denied: number; total: number; rate: number }>;
  aging: Array<{ bucket: string; count: number; amount: number }>;
  avg_days_to_payment: number;
}

const fmt = (n: number) =>
  new Intl.NumberFormat('es-PR', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(n);

function SimpleBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.max(4, (value / max) * 100) : 4;
  return (
    <div className="h-2 rounded-full bg-slate-100 overflow-hidden flex-1">
      <div
        className={`h-full rounded-full ${color} transition-all duration-500`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function SectionCard({ title, icon: Icon, children }: {
  title: string; icon: typeof BarChart3; children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <h2 className="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2">
        <Icon className="w-4 h-4 text-slate-400" />
        {title}
      </h2>
      {children}
    </div>
  );
}

export default function ReportsPage() {
  const { t } = useTranslation();

  const { data, isLoading } = useQuery<ReportData>({
    queryKey: ['reports'],
    queryFn: () => api.get('/dashboard/reports').then(r => r.data),
    staleTime: 120_000,
  });

  if (isLoading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-6 h-6 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  const d = data!;
  const maxBilled = Math.max(...(d?.claims_by_payer.map(p => p.billed) ?? [1]), 1);
  const maxRevBilled = Math.max(...(d?.revenue_by_month.map(m => m.billed) ?? [1]), 1);
  const agingBucketColors = ['bg-emerald-500', 'bg-sky-500', 'bg-amber-500', 'bg-orange-500', 'bg-rose-500'];

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <h1 className="text-xl font-bold text-slate-900 mb-6">{t('reports.title')}</h1>

      {/* Avg days stat */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 mb-6 flex items-center gap-4">
        <div className="w-12 h-12 rounded-xl bg-sky-50 flex items-center justify-center shrink-0">
          <Clock className="w-6 h-6 text-sky-600" />
        </div>
        <div>
          <p className="text-sm text-slate-500">{t('reports.avg_days_payment')}</p>
          <p className="text-3xl font-bold text-slate-900">
            {d?.avg_days_to_payment ?? 0}
            <span className="text-lg font-normal text-slate-400 ml-1">{t('reports.days')}</span>
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Claims by payer */}
        <SectionCard title={t('reports.claims_by_payer')} icon={BarChart3}>
          {!d?.claims_by_payer.length ? (
            <p className="text-slate-400 text-sm">{t('reports.no_data')}</p>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-4 text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                <span className="col-span-2">{t('reports.payer')}</span>
                <span className="text-right">{t('reports.claims')}</span>
                <span className="text-right">{t('reports.billed')}</span>
              </div>
              {d.claims_by_payer.map((row, i) => (
                <div key={i} className="space-y-1">
                  <div className="grid grid-cols-4 text-sm">
                    <span className="col-span-2 font-medium text-slate-800 truncate">{row.payer}</span>
                    <span className="text-right text-slate-600">{row.claims}</span>
                    <span className="text-right text-slate-900 font-medium">{fmt(row.billed)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <SimpleBar value={row.billed} max={maxBilled} color="bg-sky-500" />
                    <span className="text-xs text-emerald-600 w-20 text-right shrink-0">{fmt(row.paid)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        {/* Revenue by month */}
        <SectionCard title={t('reports.revenue_by_month')} icon={TrendingUp}>
          {!d?.revenue_by_month.length ? (
            <p className="text-slate-400 text-sm">{t('reports.no_data')}</p>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-4 text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                <span className="col-span-2">{t('reports.month')}</span>
                <span className="text-right">{t('reports.billed')}</span>
                <span className="text-right">{t('reports.paid')}</span>
              </div>
              {d.revenue_by_month.map((row, i) => (
                <div key={i} className="space-y-1">
                  <div className="grid grid-cols-4 text-sm">
                    <span className="col-span-2 font-medium text-slate-800">{row.month}</span>
                    <span className="text-right text-slate-700">{fmt(row.billed)}</span>
                    <span className="text-right text-emerald-700 font-medium">{fmt(row.paid)}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <SimpleBar value={row.billed} max={maxRevBilled} color="bg-slate-300" />
                    <SimpleBar value={row.paid} max={maxRevBilled} color="bg-emerald-400" />
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        {/* Denial rate by payer */}
        <SectionCard title={t('reports.denial_rate')} icon={AlertTriangle}>
          {!d?.denial_rate_by_payer.length ? (
            <p className="text-slate-400 text-sm">{t('reports.no_data')}</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                  <th className="text-left pb-2">{t('reports.payer')}</th>
                  <th className="text-right pb-2">{t('reports.denied')}</th>
                  <th className="text-right pb-2">{t('reports.claims')}</th>
                  <th className="text-right pb-2">{t('reports.denial_rate_pct')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {d.denial_rate_by_payer.map((row, i) => (
                  <tr key={i}>
                    <td className="py-2 font-medium text-slate-800 truncate max-w-32">{row.payer}</td>
                    <td className="py-2 text-right text-rose-600">{row.denied}</td>
                    <td className="py-2 text-right text-slate-600">{row.total}</td>
                    <td className="py-2 text-right">
                      <span className={`font-bold ${
                        row.rate >= 20 ? 'text-rose-600' : row.rate >= 10 ? 'text-amber-600' : 'text-emerald-600'
                      }`}>
                        {row.rate.toFixed(1)}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </SectionCard>

        {/* Aging report */}
        <SectionCard title={t('reports.aging_report')} icon={DollarSign}>
          {!d?.aging.length ? (
            <p className="text-slate-400 text-sm">{t('reports.no_data')}</p>
          ) : (
            <div className="space-y-3">
              {d.aging.map((bucket, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full text-white ${agingBucketColors[i]}`}>
                    {bucket.bucket}
                  </span>
                  <div className="flex-1">
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-slate-600">{bucket.count} claims</span>
                      <span className="font-medium text-slate-900">{fmt(bucket.amount)}</span>
                    </div>
                    <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${agingBucketColors[i]} opacity-70 transition-all`}
                        style={{
                          width: `${Math.max(4, (bucket.count / Math.max(1, ...d.aging.map(b => b.count))) * 100)}%`
                        }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
