import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  Bell, AlertTriangle, Clock, DollarSign, FileX, ShieldAlert,
  RefreshCw, Phone, RotateCcw, Eye, ChevronDown, ChevronUp,
} from 'lucide-react';
import api from '../lib/api';
import type { FollowUpItem } from '../types';

const PRIORITY_CONFIG = {
  high:   { label: 'High',   bg: 'bg-rose-100',   text: 'text-rose-700',   border: 'border-rose-200',   dot: 'bg-rose-500' },
  medium: { label: 'Medium', bg: 'bg-amber-100',  text: 'text-amber-700',  border: 'border-amber-200',  dot: 'bg-amber-500' },
  low:    { label: 'Low',    bg: 'bg-slate-100',  text: 'text-slate-600',  border: 'border-slate-200',  dot: 'bg-slate-400' },
} as const;

const ACTION_ICONS: Record<string, React.ElementType> = {
  'Check Status': RefreshCw,
  'Call Payer':   Phone,
  'Appeal':       ShieldAlert,
  'Resubmit':     RotateCcw,
  'Review':       Eye,
  'Renew Auth':   ShieldAlert,
  'Submit':       Bell,
  'Submit Claim': Bell,
  'Void':         FileX,
};

// Map backend action strings to i18n keys
const ACTION_I18N_KEYS: Record<string, string> = {
  'Check Status': 'followup.action_check_status',
  'Call Payer':   'followup.action_call_payer',
  'Appeal':       'followup.action_appeal',
  'Resubmit':     'followup.action_resubmit',
  'Review':       'followup.action_review',
  'Renew Auth':   'followup.action_renew_auth',
  'Submit':       'followup.action_submit',
  'Submit Claim': 'followup.action_submit_claim',
  'Void':         'followup.action_void',
};

function ReasonIcon({ reason }: { reason: string }) {
  if (reason.includes('no payment') || reason.includes('no response')) return <Clock className="w-4 h-4 text-amber-500" />;
  if (reason.includes('balance') || reason.includes('Partially')) return <DollarSign className="w-4 h-4 text-emerald-600" />;
  if (reason.includes('Denied')) return <FileX className="w-4 h-4 text-rose-500" />;
  if (reason.includes('auth') || reason.includes('Auth')) return <ShieldAlert className="w-4 h-4 text-purple-500" />;
  if (reason.includes('Draft') || reason.includes('draft')) return <AlertTriangle className="w-4 h-4 text-slate-500" />;
  return <Bell className="w-4 h-4 text-sky-500" />;
}

export default function FollowUpPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [daysFilter, setDaysFilter] = useState(14);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const { data: items = [], isLoading, refetch } = useQuery<FollowUpItem[]>({
    queryKey: ['followup', daysFilter],
    queryFn: () =>
      api.get('/followup/', { params: { days_without_response: daysFilter } }).then(r => r.data),
  });

  const highCount = items.filter(i => i.priority === 'high').length;
  const medCount  = items.filter(i => i.priority === 'medium').length;

  const fmt = (n: number) =>
    new Intl.NumberFormat('es-PR', { style: 'currency', currency: 'USD' }).format(n);

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Bell className="w-5 h-5 text-sky-600" />
            <h1 className="text-xl font-bold text-slate-900">{t('followup.title')}</h1>
            {highCount > 0 && (
              <span className="bg-rose-500 text-white text-xs font-bold px-2 py-0.5 rounded-full">
                {highCount}
              </span>
            )}
          </div>
          <p className="text-sm text-slate-500">{t('followup.subtitle')}</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-500">{t('followup.days_without_response')}</label>
            <select
              value={daysFilter}
              onChange={e => setDaysFilter(Number(e.target.value))}
              className="text-sm px-2 py-1 border border-slate-200 rounded bg-white"
            >
              <option value={7}>{t('followup.days_7')}</option>
              <option value={14}>{t('followup.days_14')}</option>
              <option value={21}>{t('followup.days_21')}</option>
              <option value={30}>{t('followup.days_30')}</option>
            </select>
          </div>
          <button
            onClick={() => refetch()}
            className="p-2 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100"
            title={t('followup.refresh')}
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Stats bar */}
      {items.length > 0 && (
        <div className="grid grid-cols-3 gap-3 mb-5">
          <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 text-center">
            <p className="text-2xl font-bold text-rose-700">{highCount}</p>
            <p className="text-xs text-rose-500 font-medium">{t('followup.high')} {t('followup.priority')}</p>
          </div>
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-center">
            <p className="text-2xl font-bold text-amber-700">{medCount}</p>
            <p className="text-xs text-amber-500 font-medium">{t('followup.medium')} {t('followup.priority')}</p>
          </div>
          <div className="bg-sky-50 border border-sky-200 rounded-xl p-3 text-center">
            <p className="text-2xl font-bold text-sky-700">{items.length}</p>
            <p className="text-xs text-sky-500 font-medium">{t('followup.total_items')}</p>
          </div>
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center h-48">
          <div className="w-6 h-6 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {/* Empty state */}
      {!isLoading && items.length === 0 && (
        <div className="text-center py-16 text-slate-400">
          <Bell className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="text-lg font-medium">{t('followup.no_items')}</p>
        </div>
      )}

      {/* Items */}
      <div className="space-y-3">
        {items.map(item => {
          const cfg = PRIORITY_CONFIG[item.priority] ?? PRIORITY_CONFIG.low;
          const isExpanded = expandedId === item.claim_id;

          return (
            <div
              key={item.claim_id}
              className={`bg-white rounded-xl border ${cfg.border} overflow-hidden`}
            >
              {/* Item header */}
              <div
                className="flex items-center gap-3 p-4 cursor-pointer hover:bg-slate-50"
                onClick={() => setExpandedId(isExpanded ? null : item.claim_id)}
              >
                {/* Priority dot */}
                <div className={`w-2.5 h-2.5 rounded-full ${cfg.dot} shrink-0`} />

                {/* Reason icon */}
                <ReasonIcon reason={item.reason} />

                {/* Main info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono font-semibold text-slate-900 text-sm">{item.claim_number}</span>
                    <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${cfg.bg} ${cfg.text}`}>
                      {item.priority.toUpperCase()}
                    </span>
                    <span className="text-xs text-slate-500 capitalize">{item.status}</span>
                  </div>
                  <p className="text-sm text-slate-700 mt-0.5">{item.reason}</p>
                  <div className="flex items-center gap-3 mt-1 text-xs text-slate-400">
                    <span>{item.patient_name}</span>
                    <span>•</span>
                    <span>{item.payer_name}</span>
                    <span>•</span>
                    <span>{item.service_date}</span>
                    {item.days_since_submission && (
                      <>
                        <span>•</span>
                        <span>{t('followup.days_since_submission', { days: item.days_since_submission })}</span>
                      </>
                    )}
                  </div>
                </div>

                {/* Financials */}
                <div className="text-right shrink-0 hidden sm:block">
                  <p className="text-sm font-semibold text-slate-900">{fmt(item.total_billed)}</p>
                  {item.balance > 0 && (
                    <p className="text-xs text-rose-600 font-medium">{fmt(item.balance)} {t('followup.owed')}</p>
                  )}
                  {item.total_paid > 0 && item.balance === 0 && (
                    <p className="text-xs text-emerald-600">{fmt(item.total_paid)} paid</p>
                  )}
                </div>

                {/* Expand toggle */}
                <div className="shrink-0 text-slate-400">
                  {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </div>
              </div>

              {/* Expanded actions */}
              {isExpanded && (
                <div className="border-t border-slate-100 px-4 py-3 bg-slate-50 flex flex-wrap gap-2">
                  {item.actions.map(action => {
                    const Icon = ACTION_ICONS[action] ?? Bell;
                    const isNavigate = action === 'Review' || action === 'Check Status' || action === 'Submit' || action === 'Resubmit' || action === 'Appeal';
                    return (
                      <button
                        key={action}
                        onClick={() => {
                          if (isNavigate) navigate(`/claims/${item.claim_id}`);
                        }}
                        className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                          action === 'Appeal'
                            ? 'bg-amber-500 hover:bg-amber-600 text-white border-transparent'
                            : action === 'Call Payer'
                            ? 'bg-emerald-500 hover:bg-emerald-600 text-white border-transparent'
                            : action === 'Resubmit'
                            ? 'bg-sky-500 hover:bg-sky-600 text-white border-transparent'
                            : 'bg-white hover:bg-slate-100 text-slate-700 border-slate-200'
                        }`}
                      >
                        <Icon className="w-3.5 h-3.5" />
                        {t(ACTION_I18N_KEYS[action] ?? 'followup.action_review', { defaultValue: action })}
                      </button>
                    );
                  })}
                  <Link
                    to={`/claims/${item.claim_id}`}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border bg-white hover:bg-slate-100 text-slate-700 border-slate-200"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    {t('followup.view_claim')}
                  </Link>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
