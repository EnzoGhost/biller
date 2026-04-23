import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft, Send, Trash2, Sparkles, ShieldCheck,
  ChevronDown, ChevronUp, AlertTriangle
} from 'lucide-react';
import api from '../lib/api';
import type { Claim, Denial, Appeal } from '../types';
import StatusBadge from '../components/ui/Badge';

export default function ClaimDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [showLines, setShowLines] = useState(true);
  const [scrubResult, setScrubResult] = useState<{ score: number; issues: any[]; suggestions: string[] } | null>(null);
  const [scrubbing, setScrubbing] = useState(false);

  const { data: claim, isLoading } = useQuery<Claim>({
    queryKey: ['claim', id],
    queryFn: () => api.get(`/claims/${id}`).then(r => r.data),
  });

  const { data: denials } = useQuery<Denial[]>({
    queryKey: ['claim-denials', id],
    queryFn: () => api.get(`/claims/${id}/denials`).then(r => r.data),
    enabled: !!id,
  });

  const { data: appeals } = useQuery<Appeal[]>({
    queryKey: ['claim-appeals', id],
    queryFn: () => api.get(`/claims/${id}/appeals`).then(r => r.data),
    enabled: !!id,
  });

  const submitMutation = useMutation({
    mutationFn: () => api.post(`/stedi/submit/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['claim', id] }),
  });

  const voidMutation = useMutation({
    mutationFn: () => api.post(`/claims/${id}/void`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['claim', id] }),
  });

  const handleScrub = async () => {
    setScrubbing(true);
    try {
      const { data } = await api.post('/ai/scrub', { claim_id: Number(id) });
      setScrubResult(data);
      qc.invalidateQueries({ queryKey: ['claim', id] });
    } finally {
      setScrubbing(false);
    }
  };

  const fmt = (n: number) =>
    new Intl.NumberFormat('es-PR', { style: 'currency', currency: 'USD' }).format(n);

  if (isLoading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-6 h-6 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (!claim) return <div className="p-6 text-slate-500">Reclamación no encontrada</div>;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Back */}
      <Link to="/claims" className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800 mb-4">
        <ArrowLeft className="w-4 h-4" /> {t('claims.title')}
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-xl font-bold text-slate-900 font-mono">{claim.claim_number}</h1>
            <StatusBadge status={claim.status} />
          </div>
          <p className="text-sm text-slate-500">
            {claim.payer?.name} • {claim.service_date_from}
          </p>
        </div>
        <div className="flex gap-2">
          {(claim.status === 'draft' || claim.status === 'ready') && (
            <>
              <button
                onClick={handleScrub}
                disabled={scrubbing}
                className="flex items-center gap-1.5 px-3 py-2 border border-slate-200 text-sm rounded-lg hover:bg-slate-50 text-slate-700"
              >
                <Sparkles className="w-4 h-4 text-amber-500" />
                {scrubbing ? 'Verificando...' : t('claims.scrub')}
              </button>
              <button
                onClick={() => submitMutation.mutate()}
                disabled={submitMutation.isPending}
                className="flex items-center gap-1.5 px-3 py-2 bg-sky-500 hover:bg-sky-600 text-white text-sm rounded-lg"
              >
                <Send className="w-4 h-4" />
                {t('claims.submit')}
              </button>
            </>
          )}
          {claim.status !== 'void' && (
            <button
              onClick={() => { if (confirm('¿Anular esta reclamación?')) voidMutation.mutate(); }}
              className="flex items-center gap-1.5 px-3 py-2 border border-red-200 text-red-600 text-sm rounded-lg hover:bg-red-50"
            >
              <Trash2 className="w-4 h-4" />
              {t('claims.void')}
            </button>
          )}
        </div>
      </div>

      {/* Scrub result */}
      {scrubResult && (
        <div className={`rounded-xl border p-4 mb-4 ${scrubResult.score >= 80 ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'}`}>
          <div className="flex items-center gap-2 mb-2">
            <ShieldCheck className={`w-4 h-4 ${scrubResult.score >= 80 ? 'text-emerald-600' : 'text-amber-600'}`} />
            <span className="text-sm font-semibold">
              Puntuación de limpieza: {scrubResult.score.toFixed(0)}/100
            </span>
          </div>
          {scrubResult.issues.map((issue, i) => (
            <div key={i} className="flex items-start gap-2 text-sm mt-1">
              <AlertTriangle className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${issue.type === 'error' ? 'text-red-500' : 'text-amber-500'}`} />
              <span className="text-slate-700">{issue.msg}</span>
            </div>
          ))}
          {scrubResult.suggestions.map((s, i) => (
            <p key={i} className="text-xs text-slate-600 mt-1 ml-5">💡 {s}</p>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        {/* Patient */}
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <h2 className="text-sm font-semibold text-slate-700 mb-3">Paciente</h2>
          {claim.patient ? (
            <div className="space-y-1 text-sm">
              <p className="font-medium text-slate-900">{claim.patient.first_name} {claim.patient.last_name}</p>
              <p className="text-slate-500">MRN: {claim.patient.mrn}</p>
              <p className="text-slate-500">F/N: {claim.patient.dob}</p>
              {claim.patient.phone && <p className="text-slate-500">{claim.patient.phone}</p>}
            </div>
          ) : <p className="text-slate-400 text-sm">Paciente #{claim.patient_id}</p>}
        </div>

        {/* Provider + Payer */}
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <h2 className="text-sm font-semibold text-slate-700 mb-3">Proveedor & Pagador</h2>
          <div className="space-y-1 text-sm">
            <p className="font-medium text-slate-900">
              {claim.provider ? `Dr. ${claim.provider.first_name} ${claim.provider.last_name}` : `#${claim.provider_id}`}
            </p>
            {claim.provider?.specialty && <p className="text-slate-500">{claim.provider.specialty}</p>}
            {claim.provider?.npi && <p className="text-slate-400 font-mono text-xs">NPI: {claim.provider.npi}</p>}
            <div className="mt-2 pt-2 border-t border-slate-100">
              <p className="font-medium text-slate-900">{claim.payer?.name ?? `#${claim.payer_id}`}</p>
              {claim.payer_claim_number && (
                <p className="text-slate-400 font-mono text-xs">Payer #: {claim.payer_claim_number}</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Financials */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 mb-4">
        <div className="grid grid-cols-3 gap-4 text-center">
          <div>
            <p className="text-xs text-slate-500 mb-1">Facturado</p>
            <p className="text-lg font-bold text-slate-900">{fmt(claim.total_billed)}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500 mb-1">Pagado</p>
            <p className="text-lg font-bold text-emerald-700">{fmt(claim.total_paid)}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500 mb-1">Responsabilidad Paciente</p>
            <p className="text-lg font-bold text-amber-700">{fmt(claim.patient_responsibility)}</p>
          </div>
        </div>
      </div>

      {/* Service Lines */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden mb-4">
        <button
          onClick={() => setShowLines(s => !s)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          Líneas de Servicio ({claim.service_lines.length})
          {showLines ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
        {showLines && (
          <table className="w-full text-sm border-t border-slate-200">
            <thead className="bg-slate-50">
              <tr>
                <th className="text-left px-4 py-2 text-xs font-semibold text-slate-500">#</th>
                <th className="text-left px-4 py-2 text-xs font-semibold text-slate-500">CPT</th>
                <th className="text-left px-4 py-2 text-xs font-semibold text-slate-500">Descripción</th>
                <th className="text-left px-4 py-2 text-xs font-semibold text-slate-500">Mods</th>
                <th className="text-center px-4 py-2 text-xs font-semibold text-slate-500">Uds</th>
                <th className="text-right px-4 py-2 text-xs font-semibold text-slate-500">Facturado</th>
                <th className="text-right px-4 py-2 text-xs font-semibold text-slate-500">Pagado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {claim.service_lines.map(sl => (
                <tr key={sl.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2 text-slate-500">{sl.line_number}</td>
                  <td className="px-4 py-2 font-mono font-medium text-slate-900">{sl.cpt_code}</td>
                  <td className="px-4 py-2 text-slate-600">{sl.description ?? '—'}</td>
                  <td className="px-4 py-2 font-mono text-xs text-slate-500">{sl.modifiers.join(' ') || '—'}</td>
                  <td className="px-4 py-2 text-center text-slate-600">{sl.units}</td>
                  <td className="px-4 py-2 text-right font-medium text-slate-900">{fmt(sl.billed_amount)}</td>
                  <td className="px-4 py-2 text-right font-medium text-emerald-700">{fmt(sl.paid_amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Diagnosis codes */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 mb-4">
        <h2 className="text-sm font-semibold text-slate-700 mb-2">{t('claims.diagnosis_codes')}</h2>
        <div className="flex flex-wrap gap-2">
          {claim.diagnosis_codes.map((dx, i) => (
            <span key={i} className="font-mono text-xs bg-slate-100 text-slate-700 px-2 py-1 rounded">{dx}</span>
          ))}
        </div>
      </div>

      {/* Denials */}
      {denials && denials.length > 0 && (
        <div className="bg-rose-50 rounded-xl border border-rose-200 p-4 mb-4">
          <h2 className="text-sm font-semibold text-rose-700 mb-2">Denegaciones</h2>
          {denials.map(d => (
            <div key={d.id} className="text-sm text-rose-800">
              <span className="font-mono font-medium">{d.denial_code}</span> — {d.denial_reason}
              <span className="text-xs text-rose-500 ml-2">({formatDateShort(d.denial_date)})</span>
            </div>
          ))}
        </div>
      )}

      {/* Appeals */}
      {appeals && appeals.length > 0 && (
        <div className="bg-amber-50 rounded-xl border border-amber-200 p-4">
          <h2 className="text-sm font-semibold text-amber-700 mb-2">Apelaciones</h2>
          {appeals.map(a => (
            <div key={a.id} className="text-sm text-amber-800">
              <span className="font-medium capitalize">{a.status}</span>
              {a.deadline && <span className="text-xs text-amber-600 ml-2">Vence: {formatDateShort(a.deadline)}</span>}
              {a.outcome && <span className="text-xs text-amber-600 ml-2">Resultado: {a.outcome}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
