import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate, Link } from 'react-router-dom';
import { DollarSign, FileText, TrendingUp, AlertCircle, Clock, Zap, TriangleAlert, Send, ChevronRight, BarChart2, CheckCircle } from 'lucide-react';
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

// Mini sparkline using SVG
function MiniChart({ data }: { data: { week: string; billed: number; paid: number }[] }) {
  if (!data || data.length === 0) return null;
  const max = Math.max(...data.map(d => d.billed), 1);
  const W = 160; const H = 40; const pad = 4;
  const n = data.length;
  const stepX = (W - pad * 2) / Math.max(n - 1, 1);

  const billedPts = data.map((d, i) => `${pad + i * stepX},${H - pad - ((d.billed / max) * (H - pad * 2))}`).join(' ');
  const paidPts   = data.map((d, i) => `${pad + i * stepX},${H - pad - ((d.paid   / max) * (H - pad * 2))}`).join(' ');

  return (
    <svg width={W} height={H} className="overflow-visible">
      <polyline points={billedPts} fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeLinejoin="round" />
      <polyline points={paidPts}   fill="none" stroke="#10b981" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

export default function DashboardPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: stats, isLoading } = useQuery<DashboardStats>({
    queryKey: ['dashboard'],
    queryFn: () => api.get('/dashboard/stats').then(r => r.data),
    refetchInterval: 60_000,
  });

  // Bulk submit state
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number; failed: string[] } | null>(null);

  // Quick-action: submit all ready claims with progress
  const submitAllMutation = useMutation({
    mutationFn: async () => {
      const resp = await api.get('/claims?status=ready&per_page=100');
      const ready: { id: number; claim_number: string }[] = resp.data.items;
      if (!ready.length) return { count: 0, failed: [] };
      setBulkProgress({ done: 0, total: ready.length, failed: [] });
      const failed: string[] = [];
      for (let i = 0; i < ready.length; i++) {
        const c = ready[i];
        try {
          await api.post(`/stedi/submit/${c.id}`);
        } catch {
          failed.push(c.claim_number || String(c.id));
        }
        setBulkProgress({ done: i + 1, total: ready.length, failed });
      }
      return { count: ready.length - failed.length, failed };
    },
    onSuccess: ({ count, failed }) => {
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.invalidateQueries({ queryKey: ['claims'] });
      setTimeout(() => setBulkProgress(null), 4000);
      if (failed.length === 0) {
        alert(`✅ ${count} claim(s) submitted successfully`);
      } else {
        alert(`✅ ${count} submitted\n❌ ${failed.length} failed: ${failed.join(', ')}`);
      }
    },
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
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-slate-900">{t('dashboard.title')}</h1>
        {/* Quick actions */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate('/eligibility')}
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-2 border border-slate-200 rounded-lg hover:bg-slate-50 text-slate-600"
          >
            <Zap className="w-3.5 h-3.5 text-amber-500" />
            Check Eligibility
          </button>
          <button
            onClick={() => submitAllMutation.mutate()}
            disabled={submitAllMutation.isPending}
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-2 bg-sky-500 hover:bg-sky-600 text-white rounded-lg disabled:opacity-50"
          >
            {submitAllMutation.isPending
              ? <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              : <Send className="w-3.5 h-3.5" />}
            {bulkProgress && submitAllMutation.isPending
              ? `Submitting ${bulkProgress.done}/${bulkProgress.total}...`
              : 'Submit All Ready'}
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
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
        <StatCard
          label="Submitted Today"
          value={String(s.submitted_today ?? 0)}
          icon={Send}
          color="bg-indigo-500"
        />
      </div>

      {/* Attention required */}
      {s.attention_claims && s.attention_claims.length > 0 && (
        <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 mb-6">
          <div className="flex items-center gap-2 mb-3">
            <TriangleAlert className="w-4 h-4 text-rose-500" />
            <h2 className="text-sm font-semibold text-rose-700">
              Claims Requiring Attention ({s.attention_claims.length})
            </h2>
          </div>
          <div className="space-y-2">
            {s.attention_claims.slice(0, 5).map(c => (
              <div
                key={c.id}
                onClick={() => navigate(`/claims/${c.id}`)}
                className="flex items-center justify-between bg-white rounded-lg px-3 py-2 cursor-pointer hover:bg-rose-50 border border-rose-100"
              >
                <div className="flex items-center gap-3">
                  <StatusBadge status={c.status} />
                  <span className="font-mono text-xs text-slate-700">{c.claim_number}</span>
                  <span className="text-xs text-slate-500">{c.reason}</span>
                </div>
                <div className="flex items-center gap-3 text-right">
                  <span className="text-xs font-medium text-slate-700">{fmt(c.total_billed)}</span>
                  <span className="text-xs text-slate-400">{c.days_old}d</span>
                  <ChevronRight className="w-3.5 h-3.5 text-slate-300" />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        {/* Claims by status */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h2 className="text-sm font-semibold text-slate-700 mb-4">{t('dashboard.claims_by_status')}</h2>
          <div className="space-y-2">
            {STATUS_ORDER.map(status => {
              const count = s.claims_by_status[status] ?? 0;
              if (count === 0) return null;
              return (
                <Link
                  key={status}
                  to={`/claims?status=${status}`}
                  className="flex items-center justify-between hover:bg-slate-50 rounded-lg px-2 py-1 -mx-2 transition-colors group"
                >
                  <StatusBadge status={status} />
                  <span className="text-sm font-semibold text-slate-900 group-hover:text-sky-600">{count}</span>
                </Link>
              );
            })}
          </div>
        </div>

        {/* Weekly trends */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
              <BarChart2 className="w-4 h-4 text-slate-400" />
              Weekly Trends
            </h2>
            <div className="flex items-center gap-3 text-xs text-slate-400">
              <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-slate-400 inline-block" /> Billed</span>
              <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-emerald-500 inline-block" /> Paid</span>
            </div>
          </div>
          {s.weekly_trends && s.weekly_trends.length > 0 ? (
            <>
              <MiniChart data={s.weekly_trends} />
              <div className="mt-3 space-y-1">
                {s.weekly_trends.slice(-4).map(w => (
                  <div key={w.week} className="flex items-center justify-between text-xs">
                    <span className="text-slate-500">{w.week}</span>
                    <span className="text-slate-700">{w.claims} claims</span>
                    <span className="text-emerald-600 font-medium">{fmt(w.paid)}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="text-sm text-slate-400">No trend data</p>
          )}
        </div>

        {/* Top denials */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h2 className="text-sm font-semibold text-slate-700 mb-4">{t('dashboard.top_denials')}</h2>
          {s.top_denial_reasons.length === 0 ? (
            <p className="text-sm text-slate-400">{t('dashboard.no_denials')}</p>
          ) : (
            <div className="space-y-3">
              {s.top_denial_reasons.map((d, i) => (
                <Link
                  key={i}
                  to={`/denials?reason=${encodeURIComponent(d.reason)}`}
                  className="flex items-start gap-2 hover:bg-rose-50 rounded-lg px-2 py-1 -mx-2 transition-colors"
                >
                  <span className="text-xs font-bold text-rose-600 bg-rose-50 rounded px-1.5 py-0.5 shrink-0">
                    {d.count}
                  </span>
                  <p className="text-sm text-slate-700 leading-snug">{d.reason}</p>
                  <ChevronRight className="w-3.5 h-3.5 text-slate-300 ml-auto shrink-0 mt-0.5" />
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Payer performance */}
        {s.payer_performance && s.payer_performance.length > 0 && (
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <h2 className="text-sm font-semibold text-slate-700 mb-4">Payer Performance</h2>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="text-left pb-2 font-semibold text-slate-500">Payer</th>
                  <th className="text-center pb-2 font-semibold text-slate-500">Claims</th>
                  <th className="text-center pb-2 font-semibold text-slate-500">Denial %</th>
                  <th className="text-center pb-2 font-semibold text-slate-500">Collection %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {s.payer_performance.map(p => (
                  <tr key={p.payer_id}>
                    <td className="py-1.5 font-medium text-slate-700 truncate max-w-[140px]">{p.payer_name}</td>
                    <td className="py-1.5 text-center text-slate-600">{p.total_claims}</td>
                    <td className="py-1.5 text-center">
                      <span className={`font-semibold ${p.denial_rate > 20 ? 'text-rose-600' : p.denial_rate > 10 ? 'text-amber-600' : 'text-emerald-600'}`}>
                        {p.denial_rate}%
                      </span>
                    </td>
                    <td className="py-1.5 text-center">
                      <span className={`font-semibold ${p.collection_rate > 70 ? 'text-emerald-600' : p.collection_rate > 40 ? 'text-amber-600' : 'text-rose-600'}`}>
                        {p.collection_rate}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Recent claims */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h2 className="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2">
            <Clock className="w-4 h-4 text-slate-400" />
            {t('dashboard.recent_claims')}
          </h2>
          <div className="space-y-2">
            {s.recent_claims.map(claim => (
              <div
                key={claim.id}
                onClick={() => navigate(`/claims/${claim.id}`)}
                className="flex items-center justify-between py-1.5 border-b border-slate-50 last:border-0 cursor-pointer hover:bg-slate-50 px-1 rounded"
              >
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
