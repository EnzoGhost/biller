import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { DollarSign, Plus, RefreshCw, ChevronDown, ChevronUp, Check, X, Layers, Search } from 'lucide-react';
import DatePicker from '../components/ui/DatePicker';
import api from '../lib/api';
import { formatDate } from '../lib/dates';
import type { Payment, PaginatedResponse } from '../types';

const fmt = (n: number) =>
  new Intl.NumberFormat('es-PR', { style: 'currency', currency: 'USD' }).format(n);

interface PaymentSummary {
  total_payments: number;
  total_amount: number;
  total_adjustments: number;
  total_patient_responsibility: number;
}

interface BatchItem {
  claim_id: string;
  payment_amount: string;
  adjustment_amount: string;
  patient_responsibility: string;
  denial_code: string;
  denial_reason: string;
}

export default function PaymentsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();

  // Single payment form
  const [claimId, setClaimId] = useState('');
  const [checkNumber, setCheckNumber] = useState('');
  const [checkDate, setCheckDate] = useState('');
  const [paymentAmount, setPaymentAmount] = useState('');
  const [adjustmentAmount, setAdjustmentAmount] = useState('');
  const [patientResp, setPatientResp] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('eft');
  const [notes, setNotes] = useState('');
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

  // Batch form
  const [historySearch, setHistorySearch] = useState('');
  const [showBatch, setShowBatch] = useState(false);
  const [batchCheckNumber, setBatchCheckNumber] = useState('');
  const [batchCheckDate, setBatchCheckDate] = useState('');
  const [batchPayerName, setBatchPayerName] = useState('');
  const [batchItems, setBatchItems] = useState<BatchItem[]>([
    { claim_id: '', payment_amount: '', adjustment_amount: '', patient_responsibility: '', denial_code: '', denial_reason: '' },
  ]);

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 4000);
  };

  const { data: summary } = useQuery<PaymentSummary>({
    queryKey: ['payments-summary'],
    queryFn: () => api.get('/payments/summary').then(r => r.data),
  });

  const { data: payments, isLoading } = useQuery<PaginatedResponse<Payment>>({
    queryKey: ['payments-list'],
    queryFn: () => api.get('/payments?per_page=50').then(r => r.data),
  });

  const postMutation = useMutation({
    mutationFn: (data: object) => api.post(`/payments/claims/${claimId}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payments'] });
      showToast(t('payments.post_success'));
      setClaimId(''); setCheckNumber(''); setCheckDate('');
      setPaymentAmount(''); setAdjustmentAmount(''); setPatientResp('');
      setNotes('');
    },
    onError: (e: { response?: { data?: { detail?: string } } }) => {
      showToast(e?.response?.data?.detail ?? t('common.error'), false);
    },
  });

  const batchMutation = useMutation({
    mutationFn: (data: object) => api.post('/payments/batch', data),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['payments'] });
      showToast(`${t('payments.batch_success')}: ${res.data.posted} posted, ${res.data.errors} errors`);
      setBatchItems([{ claim_id: '', payment_amount: '', adjustment_amount: '', patient_responsibility: '', denial_code: '', denial_reason: '' }]);
    },
    onError: (e: { response?: { data?: { detail?: string } } }) => {
      showToast(e?.response?.data?.detail ?? t('common.error'), false);
    },
  });

  const handlePost = () => {
    if (!claimId || !paymentAmount) return;
    postMutation.mutate({
      payment_amount: parseFloat(paymentAmount),
      adjustment_amount: parseFloat(adjustmentAmount || '0'),
      patient_responsibility: parseFloat(patientResp || '0'),
      check_number: checkNumber || undefined,
      check_date: checkDate || undefined,
      payment_method: paymentMethod,
      notes: notes || undefined,
    });
  };

  const handleBatchPost = () => {
    const items = batchItems
      .filter(item => item.claim_id && item.payment_amount)
      .map(item => ({
        claim_id: parseInt(item.claim_id),
        payment_amount: parseFloat(item.payment_amount),
        adjustment_amount: parseFloat(item.adjustment_amount || '0'),
        patient_responsibility: parseFloat(item.patient_responsibility || '0'),
        denial_code: item.denial_code || undefined,
        denial_reason: item.denial_reason || undefined,
      }));
    if (!items.length) return;
    batchMutation.mutate({
      check_number: batchCheckNumber || undefined,
      check_date: batchCheckDate || undefined,
      payer_name: batchPayerName || undefined,
      payment_method: paymentMethod,
      items,
    });
  };

  const addBatchRow = () => {
    setBatchItems(prev => [
      ...prev,
      { claim_id: '', payment_amount: '', adjustment_amount: '', patient_responsibility: '', denial_code: '', denial_reason: '' },
    ]);
  };

  const updateBatchItem = (idx: number, field: keyof BatchItem, value: string) => {
    setBatchItems(prev => prev.map((item, i) => i === idx ? { ...item, [field]: value } : item));
  };

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 flex items-center gap-2 px-4 py-3 rounded-lg shadow-lg text-sm font-medium text-white ${toast.ok ? 'bg-emerald-500' : 'bg-red-500'}`}>
          {toast.ok ? <Check className="w-4 h-4" /> : <X className="w-4 h-4" />}
          {toast.msg}
        </div>
      )}

      <h1 className="text-xl font-bold text-slate-900 mb-6">{t('payments.title')}</h1>

      {/* Summary cards */}
      {summary && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {[
            { label: t('payments.total_payments'), value: String(summary.total_payments), color: 'bg-slate-500' },
            { label: t('payments.total_amount'), value: fmt(summary.total_amount), color: 'bg-emerald-500' },
            { label: t('payments.total_adjustments'), value: fmt(summary.total_adjustments), color: 'bg-amber-500' },
            { label: t('payments.total_patient_resp'), value: fmt(summary.total_patient_responsibility), color: 'bg-sky-500' },
          ].map(({ label, value, color }) => (
            <div key={label} className="bg-white rounded-xl border border-slate-200 p-4 flex items-start gap-3">
              <div className={`w-9 h-9 rounded-lg ${color} flex items-center justify-center shrink-0`}>
                <DollarSign className="w-4 h-4 text-white" />
              </div>
              <div>
                <p className="text-xs text-slate-500">{label}</p>
                <p className="text-lg font-bold text-slate-900">{value}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Manual Payment Form */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h2 className="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2">
            <Plus className="w-4 h-4 text-emerald-500" />
            {t('payments.post_payment')}
          </h2>
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
                Claim ID
              </label>
              <input
                value={claimId}
                onChange={e => setClaimId(e.target.value)}
                placeholder="e.g. 42"
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-sky-500 focus:outline-none"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
                  {t('payments.check_number')}
                </label>
                <input
                  value={checkNumber}
                  onChange={e => setCheckNumber(e.target.value)}
                  placeholder="CHK-12345"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-sky-500 focus:outline-none"
                />
              </div>
              <div>
                <DatePicker
                  label={t('payments.check_date')}
                  value={checkDate}
                  onChange={setCheckDate}
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
                  {t('payments.payment_amount')}
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={paymentAmount}
                  onChange={e => setPaymentAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-sky-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
                  {t('payments.adjustment')}
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={adjustmentAmount}
                  onChange={e => setAdjustmentAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-sky-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
                  {t('payments.patient_resp')}
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={patientResp}
                  onChange={e => setPatientResp(e.target.value)}
                  placeholder="0.00"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-sky-500 focus:outline-none"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
                {t('payments.payment_method')}
              </label>
              <select
                value={paymentMethod}
                onChange={e => setPaymentMethod(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-sky-500 focus:outline-none bg-white"
              >
                <option value="eft">EFT</option>
                <option value="check">Check</option>
                <option value="virtual_card">Virtual Card</option>
                <option value="cash">Cash</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
                {t('common.notes')}
              </label>
              <input
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Optional notes"
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-sky-500 focus:outline-none"
              />
            </div>
            <button
              onClick={handlePost}
              disabled={postMutation.isPending || !claimId || !paymentAmount}
              className="w-full py-2 bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-medium rounded-lg disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {postMutation.isPending ? (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : <DollarSign className="w-4 h-4" />}
              {postMutation.isPending ? t('common.loading') : t('payments.post_payment')}
            </button>
          </div>
        </div>

        {/* Batch ERA Post */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <button
            onClick={() => setShowBatch(v => !v)}
            className="w-full flex items-center justify-between text-sm font-semibold text-slate-700 mb-4"
          >
            <span className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-indigo-500" />
              {t('payments.batch_post')}
            </span>
            {showBatch ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>

          {showBatch && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
                    {t('payments.check_number')}
                  </label>
                  <input
                    value={batchCheckNumber}
                    onChange={e => setBatchCheckNumber(e.target.value)}
                    placeholder="ERA Check #"
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-sky-500 focus:outline-none"
                  />
                </div>
                <div>
                  <DatePicker
                    label={t('payments.check_date')}
                    value={batchCheckDate}
                    onChange={setBatchCheckDate}
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
                  Payer Name
                </label>
                <input
                  value={batchPayerName}
                  onChange={e => setBatchPayerName(e.target.value)}
                  placeholder="e.g. Triple-S Salud"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-sky-500 focus:outline-none"
                />
              </div>

              {/* Batch items table */}
              <div className="overflow-x-auto">
                <table className="w-full text-xs border border-slate-200 rounded-lg overflow-hidden">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-2 py-2 text-left font-semibold text-slate-500">Claim ID</th>
                      <th className="px-2 py-2 text-left font-semibold text-slate-500">Paid</th>
                      <th className="px-2 py-2 text-left font-semibold text-slate-500">Adj.</th>
                      <th className="px-2 py-2 text-left font-semibold text-slate-500">Pt Resp.</th>
                      <th className="px-2 py-2 text-left font-semibold text-slate-500">Denial Code</th>
                    </tr>
                  </thead>
                  <tbody>
                    {batchItems.map((item, idx) => (
                      <tr key={idx} className="border-t border-slate-100">
                        <td className="px-2 py-1"><input type="number" value={item.claim_id} onChange={e => updateBatchItem(idx, 'claim_id', e.target.value)} placeholder="ID" className="w-16 px-1 py-0.5 border border-slate-200 rounded text-xs" /></td>
                        <td className="px-2 py-1"><input type="number" step="0.01" value={item.payment_amount} onChange={e => updateBatchItem(idx, 'payment_amount', e.target.value)} placeholder="0.00" className="w-20 px-1 py-0.5 border border-slate-200 rounded text-xs" /></td>
                        <td className="px-2 py-1"><input type="number" step="0.01" value={item.adjustment_amount} onChange={e => updateBatchItem(idx, 'adjustment_amount', e.target.value)} placeholder="0.00" className="w-20 px-1 py-0.5 border border-slate-200 rounded text-xs" /></td>
                        <td className="px-2 py-1"><input type="number" step="0.01" value={item.patient_responsibility} onChange={e => updateBatchItem(idx, 'patient_responsibility', e.target.value)} placeholder="0.00" className="w-20 px-1 py-0.5 border border-slate-200 rounded text-xs" /></td>
                        <td className="px-2 py-1"><input value={item.denial_code} onChange={e => updateBatchItem(idx, 'denial_code', e.target.value)} placeholder="CO-96" className="w-20 px-1 py-0.5 border border-slate-200 rounded text-xs" /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex gap-2">
                <button onClick={addBatchRow} className="flex items-center gap-1 text-xs text-sky-600 hover:text-sky-800 px-2 py-1 border border-sky-200 rounded">
                  <Plus className="w-3 h-3" /> Add Row
                </button>
                <button
                  onClick={handleBatchPost}
                  disabled={batchMutation.isPending}
                  className="flex-1 py-2 bg-indigo-500 hover:bg-indigo-600 text-white text-sm font-medium rounded-lg disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {batchMutation.isPending ? (
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : <Layers className="w-4 h-4" />}
                  {batchMutation.isPending ? t('common.loading') : t('payments.batch_post')}
                </button>
              </div>
            </div>
          )}

          {!showBatch && (
            <p className="text-xs text-slate-400">Post multiple claim payments from one ERA (835) check at once.</p>
          )}
        </div>
      </div>

      {/* Payment History */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-3">
          <RefreshCw className="w-4 h-4 text-slate-400" />
          <h2 className="text-sm font-semibold text-slate-700 flex-1">{t('payments.history')}</h2>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
            <input
              value={historySearch}
              onChange={e => setHistorySearch(e.target.value)}
              placeholder={t('common.search')}
              className="pl-8 pr-3 py-1.5 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-sky-500 w-48"
            />
          </div>
        </div>
        {isLoading ? (
          <div className="p-6 text-center">
            <div className="w-6 h-6 border-2 border-sky-500 border-t-transparent rounded-full animate-spin mx-auto" />
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="text-left px-4 py-2 text-xs font-semibold text-slate-500">Claim ID</th>
                <th className="text-left px-4 py-2 text-xs font-semibold text-slate-500">{t('payments.check_number')}</th>
                <th className="text-left px-4 py-2 text-xs font-semibold text-slate-500">{t('payments.check_date')}</th>
                <th className="text-right px-4 py-2 text-xs font-semibold text-slate-500">{t('payments.payment_amount')}</th>
                <th className="text-right px-4 py-2 text-xs font-semibold text-slate-500">{t('payments.adjustment')}</th>
                <th className="text-right px-4 py-2 text-xs font-semibold text-slate-500">{t('payments.patient_resp')}</th>
                <th className="text-left px-4 py-2 text-xs font-semibold text-slate-500">{t('payments.payment_method')}</th>
                <th className="text-left px-4 py-2 text-xs font-semibold text-slate-500">{t('payments.posted_at')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(payments?.items ?? []).filter(p => {
                if (!historySearch) return true;
                const s = historySearch.toLowerCase();
                return (
                  String(p.claim_id).includes(s) ||
                  (p.check_number?.toLowerCase().includes(s) ?? false)
                );
              }).length === 0 && (
                <tr><td colSpan={8} className="px-4 py-6 text-center text-slate-400 text-sm">{t('payments.no_payments')}</td></tr>
              )}
              {(payments?.items ?? []).filter(p => {
                if (!historySearch) return true;
                const s = historySearch.toLowerCase();
                return (
                  String(p.claim_id).includes(s) ||
                  (p.check_number?.toLowerCase().includes(s) ?? false)
                );
              }).map(p => (
                <tr key={p.id} className={`hover:bg-slate-50 ${p.payment_amount < 0 ? 'bg-rose-50' : ''}`}>
                  <td className="px-4 py-2 font-mono text-slate-700">#{p.claim_id}</td>
                  <td className="px-4 py-2 font-mono text-slate-600">{p.check_number ?? '—'}</td>
                  <td className="px-4 py-2 text-slate-600">{p.check_date ? formatDate(p.check_date) : '—'}</td>
                  <td className={`px-4 py-2 text-right font-semibold ${p.payment_amount >= 0 ? 'text-emerald-700' : 'text-rose-600'}`}>
                    {fmt(p.payment_amount)}
                  </td>
                  <td className="px-4 py-2 text-right text-amber-700">{fmt(p.adjustment_amount)}</td>
                  <td className="px-4 py-2 text-right text-sky-700">{fmt(p.patient_responsibility)}</td>
                  <td className="px-4 py-2">
                    <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full font-medium uppercase">
                      {p.payment_method}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-slate-400 text-xs">{formatDate(p.posted_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
