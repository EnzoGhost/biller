import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, RefreshCw, CheckCircle, XCircle, AlertCircle, FileText, DollarSign } from 'lucide-react';
import api from '../lib/api';

interface ERAClaimResult {
  claim_number: string;
  matched: boolean;
  paid_amount: number;
  patient_responsibility: number;
  adjustments: Array<{ group: string; reason_code: string; amount: number }>;
  posted: boolean;
  error?: string;
}

interface ReconcileResult {
  payer_name: string;
  check_number: string;
  payment_amount: number;
  matched: number;
  unmatched: number;
  posted: number;
  results: ERAClaimResult[];
}

interface ERAFile {
  filename: string;
  payer_name: string;
  check_number: string;
  check_date: string;
  payment_amount: number;
  payment_method: string;
  claim_count: number;
  claims: Array<{
    claim_number: string;
    paid_amount: number;
    billed_amount: number;
    patient_responsibility: number;
    status_code: string;
  }>;
}

interface DownloadResult {
  files_found: number;
  files_parsed: number;
  results: ERAFile[];
  errors: Array<{ filename: string; error: string }>;
}

const fmt = (n: number) =>
  new Intl.NumberFormat('es-PR', { style: 'currency', currency: 'USD' }).format(n);

export default function ERADashboardPage() {
  const { t } = useTranslation();

  const [downloading, setDownloading] = useState(false);
  const [downloadResult, setDownloadResult] = useState<DownloadResult | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const [selectedERA, setSelectedERA] = useState('');
  const [reconciling, setReconciling] = useState(false);
  const [reconcileResult, setReconcileResult] = useState<ReconcileResult | null>(null);
  const [reconcileError, setReconcileError] = useState<string | null>(null);

  const [pasteMode, setPasteMode] = useState(false);
  const [eraContent, setEraContent] = useState('');

  const handleDownload = async () => {
    setDownloading(true);
    setDownloadError(null);
    setDownloadResult(null);
    try {
      const { data } = await api.get<DownloadResult>('/inmediata/download-era');
      setDownloadResult(data);
      if (data.results.length > 0) {
        setSelectedERA('');
      }
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } };
      setDownloadError(err?.response?.data?.detail ?? t('common.error'));
    } finally {
      setDownloading(false);
    }
  };

  const handleReconcile = async () => {
    const content = pasteMode ? eraContent : selectedERA;
    if (!content.trim()) return;
    setReconciling(true);
    setReconcileError(null);
    setReconcileResult(null);
    try {
      const { data } = await api.post<ReconcileResult>('/inmediata/reconcile', {
        era_content: content,
        auto_post: true,
      });
      setReconcileResult(data);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } };
      setReconcileError(err?.response?.data?.detail ?? t('common.error'));
    } finally {
      setReconciling(false);
    }
  };

  const totalReceived = downloadResult?.results.reduce((s, f) => s + f.payment_amount, 0) ?? 0;
  const totalParsed = downloadResult?.files_parsed ?? 0;

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <h1 className="text-xl font-bold text-slate-900 mb-6">{t('era.title')}</h1>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-slate-200 p-4 flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-sky-50 flex items-center justify-center shrink-0">
            <FileText className="w-4 h-4 text-sky-600" />
          </div>
          <div>
            <p className="text-xs text-slate-500">{t('era.files_found')}</p>
            <p className="text-xl font-bold text-slate-900">{downloadResult?.files_found ?? '—'}</p>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4 flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-emerald-50 flex items-center justify-center shrink-0">
            <CheckCircle className="w-4 h-4 text-emerald-600" />
          </div>
          <div>
            <p className="text-xs text-slate-500">{t('era.files_parsed')}</p>
            <p className="text-xl font-bold text-slate-900">{totalParsed || '—'}</p>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4 flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-indigo-50 flex items-center justify-center shrink-0">
            <DollarSign className="w-4 h-4 text-indigo-600" />
          </div>
          <div>
            <p className="text-xs text-slate-500">{t('era.total_received')}</p>
            <p className="text-xl font-bold text-slate-900">{totalReceived > 0 ? fmt(totalReceived) : '—'}</p>
          </div>
        </div>
        {reconcileResult && (
          <div className="bg-white rounded-xl border border-slate-200 p-4 flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-amber-50 flex items-center justify-center shrink-0">
              <RefreshCw className="w-4 h-4 text-amber-600" />
            </div>
            <div>
              <p className="text-xs text-slate-500">{t('era.matched')}/{t('era.unmatched')}</p>
              <p className="text-xl font-bold text-slate-900">
                <span className="text-emerald-600">{reconcileResult.matched}</span>
                <span className="text-slate-400 mx-1">/</span>
                <span className="text-rose-600">{reconcileResult.unmatched}</span>
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Download ERA */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h2 className="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2">
            <Download className="w-4 h-4 text-slate-400" />
            {t('era.download_era')}
          </h2>
          <button
            onClick={handleDownload}
            disabled={downloading}
            className="w-full flex items-center justify-center gap-2 bg-sky-500 hover:bg-sky-600 disabled:opacity-50 text-white text-sm font-medium py-2.5 rounded-lg transition-colors mb-4"
          >
            {downloading
              ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              : <Download className="w-4 h-4" />}
            {downloading ? t('era.downloading') : t('era.download_era')}
          </button>

          {downloadError && (
            <div className="flex items-center gap-2 text-red-600 text-xs bg-red-50 border border-red-200 rounded-lg p-2 mb-3">
              <XCircle className="w-3.5 h-3.5 shrink-0" />
              {downloadError}
            </div>
          )}

          {/* ERA file list */}
          {downloadResult && downloadResult.results.length === 0 && (
            <p className="text-sm text-slate-400 text-center py-4">{t('era.no_era_found')}</p>
          )}

          {downloadResult?.results.map((file, i) => (
            <div
              key={i}
              className="border border-slate-200 rounded-lg p-3 mb-2 text-sm hover:bg-slate-50 cursor-pointer"
              onClick={() => {
                setSelectedERA(JSON.stringify(file));
                setPasteMode(false);
              }}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="font-medium text-slate-800">{file.filename}</span>
                <span className="text-emerald-700 font-bold">{fmt(file.payment_amount)}</span>
              </div>
              <div className="flex gap-3 text-xs text-slate-500">
                <span>{file.payer_name}</span>
                {file.check_number && <span>#{file.check_number}</span>}
                <span>{file.claim_count} claims</span>
              </div>
            </div>
          ))}

          {/* Paste ERA */}
          <div className="mt-4 pt-4 border-t border-slate-100">
            <button
              onClick={() => { setPasteMode(!pasteMode); setSelectedERA(''); }}
              className="text-xs text-sky-600 hover:underline"
            >
              {t('era.paste_era')}
            </button>
            {pasteMode && (
              <textarea
                value={eraContent}
                onChange={e => setEraContent(e.target.value)}
                rows={6}
                className="w-full mt-2 px-3 py-2 border border-slate-200 rounded-lg text-xs font-mono focus:outline-none focus:ring-2 focus:ring-sky-500"
                placeholder={t('era.era_content_placeholder')}
              />
            )}
          </div>
        </div>

        {/* Reconcile */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h2 className="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2">
            <RefreshCw className="w-4 h-4 text-slate-400" />
            {t('era.reconcile')}
          </h2>

          {selectedERA && !pasteMode && (
            <div className="bg-sky-50 border border-sky-200 rounded-lg p-3 mb-3 text-xs text-sky-700">
              ✓ {t('era.select_file')}: {(() => { try { return JSON.parse(selectedERA).filename; } catch { return '—'; } })()}
            </div>
          )}
          {pasteMode && eraContent && (
            <div className="bg-sky-50 border border-sky-200 rounded-lg p-3 mb-3 text-xs text-sky-700">
              ✓ {eraContent.length} characters ready
            </div>
          )}

          <button
            onClick={handleReconcile}
            disabled={reconciling || (!selectedERA && !eraContent.trim())}
            className="w-full flex items-center justify-center gap-2 bg-indigo-500 hover:bg-indigo-600 disabled:opacity-50 text-white text-sm font-medium py-2.5 rounded-lg transition-colors mb-4"
          >
            {reconciling
              ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              : <RefreshCw className="w-4 h-4" />}
            {reconciling ? t('era.reconciling') : t('era.reconcile')}
          </button>

          {reconcileError && (
            <div className="flex items-center gap-2 text-red-600 text-xs bg-red-50 border border-red-200 rounded-lg p-2 mb-3">
              <XCircle className="w-3.5 h-3.5 shrink-0" />
              {reconcileError}
            </div>
          )}

          {/* Reconcile results */}
          {reconcileResult && (
            <div>
              <div className="grid grid-cols-3 gap-2 mb-4">
                <div className="text-center bg-emerald-50 rounded-lg p-2">
                  <p className="text-lg font-bold text-emerald-700">{reconcileResult.matched}</p>
                  <p className="text-xs text-emerald-600">{t('era.matched')}</p>
                </div>
                <div className="text-center bg-rose-50 rounded-lg p-2">
                  <p className="text-lg font-bold text-rose-700">{reconcileResult.unmatched}</p>
                  <p className="text-xs text-rose-600">{t('era.unmatched')}</p>
                </div>
                <div className="text-center bg-indigo-50 rounded-lg p-2">
                  <p className="text-lg font-bold text-indigo-700">{reconcileResult.posted}</p>
                  <p className="text-xs text-indigo-600">{t('era.posted')}</p>
                </div>
              </div>

              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                {t('era.claim_number')} / {t('era.paid_amount')}
              </p>
              <div className="max-h-64 overflow-y-auto space-y-1">
                {reconcileResult.results.map((r, i) => (
                  <div
                    key={i}
                    className={`flex items-center justify-between px-3 py-2 rounded-lg text-sm ${
                      r.matched ? 'bg-emerald-50' : 'bg-rose-50'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {r.matched
                        ? <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />
                        : <AlertCircle className="w-3.5 h-3.5 text-rose-500" />}
                      <span className="font-mono text-xs text-slate-700">{r.claim_number}</span>
                    </div>
                    <div className="text-right">
                      <span className={`text-xs font-medium ${r.matched ? 'text-emerald-700' : 'text-rose-700'}`}>
                        {fmt(r.paid_amount)}
                      </span>
                      {r.posted && (
                        <span className="ml-2 text-xs text-indigo-600 bg-indigo-100 px-1 rounded">posted</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
