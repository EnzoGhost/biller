import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { BarChart3, TrendingUp, AlertTriangle, Clock, DollarSign } from 'lucide-react';
import { getReportsData } from '../lib/tauri-api';
import { query } from '../lib/db';

interface AgingBucket { bucket: string; count: number; amount: number; }

const fmt = (n: number) =>
  new Intl.NumberFormat('es-PR', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(n);

function SimpleBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.max(4, (value / max) * 100) : 4;
  return (
    <div className="h-2 rounded-full bg-slate-100 overflow-hidden flex-1">
      <div className={`h-full rounded-full ${color} transition-all duration-500`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function SectionCard({ title, icon: Icon, children }: { title: string; icon: typeof BarChart3; children: React.ReactNode }) {
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

async function fetchReports() {
  const base = await getReportsData();
  
  // By payer
  const claims_by_payer = (base.by_payer ?? []).map((r: Record<string, unknown>) => ({
    payer: r.payer_name as string,
    claims: r.cnt as number,
    billed: r.billed as number,
    paid: r.paid as number,
  }));

  // Monthly revenue
  const monthRows = await query<Record<string, unknown>>(
    `SELECT strftime('%Y-%m', service_date_from) as month,
       COUNT(*) as cnt,
       COALESCE(SUM(total_billed),0) as billed,
       COALESCE(SUM(total_paid),0) as paid
     FROM claims GROUP BY month ORDER BY month DESC LIMIT 12`
  );
  const revenue_by_month = monthRows.map(r => ({
    month: r.month as string,
    billed: r.billed as number,
    paid: r.paid as number,
    count: r.cnt as number,
  })).reverse();

  // Denial rate by payer
  const denialRows = await query<Record<string, unknown>>(
    `SELECT pay.name as payer,
       COUNT(*) as total,
       SUM(CASE WHEN c.status='denied' THEN 1 ELSE 0 END) as denied
     FROM claims c JOIN payers pay ON pay.id=c.payer_id
     GROUP BY c.payer_id ORDER BY denied DESC LIMIT 10`
  );
  const denial_rate_by_payer = denialRows.map(r => ({
    payer: r.payer as string,
    total: r.total as number,
    denied: r.denied as number,
    rate: (r.total as number) > 0 ? Math.round(((r.denied as number) / (r.total as number)) * 1000) / 10 : 0,
  }));

  // Aging buckets
  const agingRows = await query<Record<string, unknown>>(
    `SELECT 
       CASE 
         WHEN julianday('now') - julianday(COALESCE(date_of_submission, service_date_from)) <= 30 THEN '0-30 days'
         WHEN julianday('now') - julianday(COALESCE(date_of_submission, service_date_from)) <= 60 THEN '31-60 days'
         WHEN julianday('now') - julianday(COALESCE(date_of_submission, service_date_from)) <= 90 THEN '61-90 days'
         WHEN julianday('now') - julianday(COALESCE(date_of_submission, service_date_from)) <= 120 THEN '91-120 days'
         ELSE '120+ days'
       END as bucket,
       COUNT(*) as count,
       COALESCE(SUM(total_billed - total_paid), 0) as amount
     FROM claims WHERE status IN ('submitted','accepted','denied','rejected')
     GROUP BY bucket ORDER BY bucket`
  );
  const aging: AgingBucket[] = agingRows.map(r => ({
    bucket: r.bucket as string,
    count: r.count as number,
    amount: r.amount as number,
  }));

  // Avg days to payment
  const [avgRow] = await query<{ avg: number }>(
    `SELECT AVG(julianday(py.check_date) - julianday(c.service_date_from)) as avg
     FROM payments py JOIN claims c ON c.id=py.claim_id WHERE py.check_date IS NOT NULL`
  );
  const avg_days_to_payment = Math.round(avgRow?.avg ?? 0);

  return { claims_by_payer, revenue_by_month, denial_rate_by_payer, aging, avg_days_to_payment };
}

export default function ReportsPage() {
  const { t } = useTranslation();

  const { data: d, isLoading } = useQuery({
    queryKey: ['reports-full'],
    queryFn: fetchReports,
    staleTime: 120_000,
  });

  if (isLoading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-6 h-6 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (!d) return null;

  const maxBilled = Math.max(...(d.claims_by_payer.map(p => p.billed)), 1);
  const maxRevBilled = Math.max(...(d.revenue_by_month.map(m => m.billed)), 1);
  const agingBucketColors = ['bg-emerald-500', 'bg-sky-500', 'bg-amber-500', 'bg-orange-500', 'bg-rose-500'];

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <h1 className="text-xl font-bold text-slate-900 mb-6">{t('reports.title')}</h1>

      <div className="bg-white rounded-xl border border-slate-200 p-5 mb-6 flex items-center gap-4">
        <div className="w-12 h-12 rounded-xl bg-sky-50 flex items-center justify-center shrink-0">
          <Clock className="w-6 h-6 text-sky-600" />
        </div>
        <div>
          <p className="text-sm text-slate-500">{t('reports.avg_days_payment')}</p>
          <p className="text-3xl font-bold text-slate-900">
            {d.avg_days_to_payment}
            <span className="text-lg font-normal text-slate-400 ml-1">{t('reports.days')}</span>
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <SectionCard title={t('reports.claims_by_payer')} icon={BarChart3}>
          {!d.claims_by_payer.length ? <p className="text-slate-400 text-sm">{t('reports.no_data')}</p> : (
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

        <SectionCard title={t('reports.revenue_by_month')} icon={TrendingUp}>
          {!d.revenue_by_month.length ? <p className="text-slate-400 text-sm">{t('reports.no_data')}</p> : (
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

        <SectionCard title={t('reports.denial_rate')} icon={AlertTriangle}>
          {!d.denial_rate_by_payer.length ? <p className="text-slate-400 text-sm">{t('reports.no_data')}</p> : (
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
                      <span className={`font-bold ${row.rate >= 20 ? 'text-rose-600' : row.rate >= 10 ? 'text-amber-600' : 'text-emerald-600'}`}>
                        {row.rate.toFixed(1)}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </SectionCard>

        <SectionCard title={t('reports.aging_report')} icon={DollarSign}>
          {!d.aging.length ? <p className="text-slate-400 text-sm">{t('reports.no_data')}</p> : (
            <div className="space-y-3">
              {d.aging.map((bucket, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full text-white ${agingBucketColors[i % agingBucketColors.length]}`}>
                    {bucket.bucket}
                  </span>
                  <div className="flex-1">
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-slate-600">{bucket.count} claims</span>
                      <span className="font-medium text-slate-900">{fmt(bucket.amount)}</span>
                    </div>
                    <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${agingBucketColors[i % agingBucketColors.length]} opacity-70`}
                        style={{ width: `${Math.max(4, (bucket.count / Math.max(1, ...d.aging.map(b => b.count))) * 100)}%` }}
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
