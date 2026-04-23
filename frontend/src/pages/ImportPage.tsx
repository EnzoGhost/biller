import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Upload, FileText, Download, CheckCircle, XCircle, AlertCircle, RefreshCw, ClipboardList } from 'lucide-react';
import api from '../lib/api';

interface ImportResult {
  imported: number;
  skipped: number;
  errors: string[];
  claims_created?: number[];
}

function ResultBadges({ result }: { result: ImportResult }) {
  const { t } = useTranslation();
  return (
    <div className="mt-3 bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
      <p className="font-semibold text-slate-800 text-sm">{t('import.result')}</p>
      <div className="grid grid-cols-3 gap-3 text-center">
        <div className="bg-emerald-50 rounded-lg p-3">
          <CheckCircle className="w-5 h-5 text-emerald-500 mx-auto mb-1" />
          <p className="text-lg font-bold text-emerald-700">{result.imported}</p>
          <p className="text-xs text-emerald-600">{t('import.imported')}</p>
        </div>
        <div className="bg-amber-50 rounded-lg p-3">
          <AlertCircle className="w-5 h-5 text-amber-500 mx-auto mb-1" />
          <p className="text-lg font-bold text-amber-700">{result.skipped}</p>
          <p className="text-xs text-amber-600">{t('import.skipped')}</p>
        </div>
        <div className="bg-red-50 rounded-lg p-3">
          <XCircle className="w-5 h-5 text-red-500 mx-auto mb-1" />
          <p className="text-lg font-bold text-red-700">{result.errors.length}</p>
          <p className="text-xs text-red-600">{t('import.errors')}</p>
        </div>
      </div>
      {result.claims_created && result.claims_created.length > 0 && (
        <p className="text-xs text-slate-500 text-center">
          {t('import.claims_created', { count: result.claims_created.length })}
        </p>
      )}
      {result.errors.length > 0 && (
        <div className="mt-2">
          <p className="text-xs font-semibold text-slate-600 mb-1">{t('import.errors_label')}</p>
          <ul className="space-y-1 max-h-32 overflow-y-auto">
            {result.errors.map((e, i) => (
              <li key={i} className="text-xs text-red-600 bg-red-50 rounded px-2 py-1">{e}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function ImportPage() {
  const { t } = useTranslation();
  const fileRef = useRef<HTMLInputElement>(null);

  // CSV state
  const [dragging, setDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [csvLoading, setCsvLoading] = useState(false);
  const [csvResult, setCsvResult] = useState<ImportResult | null>(null);
  const [csvError, setCsvError] = useState<string | null>(null);

  // Wink patients state
  const [winkLoading, setWinkLoading] = useState(false);
  const [winkResult, setWinkResult] = useState<ImportResult | null>(null);
  const [winkError, setWinkError] = useState<string | null>(null);

  // Wink encounters state
  const [encLoading, setEncLoading] = useState(false);
  const [encResult, setEncResult] = useState<ImportResult | null>(null);
  const [encError, setEncError] = useState<string | null>(null);

  const handleFile = (f: File) => {
    setFile(f);
    setCsvResult(null);
    setCsvError(null);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  };

  const handleCsvImport = async () => {
    if (!file) return;
    setCsvLoading(true);
    setCsvResult(null);
    setCsvError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const { data } = await api.post<ImportResult>('/import/superbill', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setCsvResult(data);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setCsvError(msg ?? t('import.error_importing'));
    } finally {
      setCsvLoading(false);
    }
  };

  const handleWinkPatients = async () => {
    setWinkLoading(true);
    setWinkResult(null);
    setWinkError(null);
    try {
      const { data } = await api.post<ImportResult>('/import/wink', null, {
        params: { provider_id: 1 },
      });
      setWinkResult(data);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setWinkError(msg ?? t('import.error_wink'));
    } finally {
      setWinkLoading(false);
    }
  };

  const handleWinkEncounters = async () => {
    setEncLoading(true);
    setEncResult(null);
    setEncError(null);
    try {
      const { data } = await api.post<ImportResult>('/import/wink/encounters', null, {
        params: { provider_id: 1, payer_id: 1 },
      });
      setEncResult(data);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setEncError(msg ?? t('import.error_encounters'));
    } finally {
      setEncLoading(false);
    }
  };

  const downloadTemplate = () => {
    const headers = [
      'patient_mrn', 'patient_first_name', 'patient_last_name', 'dob',
      'service_date', 'provider_npi', 'payer_id', 'member_id',
      'cpt_code', 'icd10_1', 'icd10_2', 'units', 'billed_amount', 'place_of_service',
    ];
    const csv = headers.join(',') + '\n';
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'superbill_template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h1 className="text-xl font-bold text-slate-900 mb-6">{t('import.title')}</h1>

      {/* Wink Integration Card */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 mb-6">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-9 h-9 rounded-lg bg-sky-50 flex items-center justify-center">
            <Upload className="w-4 h-4 text-sky-600" />
          </div>
          <p className="font-semibold text-slate-800">{t('import.wink')}</p>
        </div>
        <p className="text-xs text-slate-500 mb-4">{t('import.wink_desc')}</p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* Sync Patients */}
          <div>
            <button
              onClick={handleWinkPatients}
              disabled={winkLoading}
              className="w-full flex items-center justify-center gap-2 bg-sky-500 hover:bg-sky-600 disabled:opacity-50 text-white text-xs font-medium py-2 rounded-lg transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${winkLoading ? 'animate-spin' : ''}`} />
              {winkLoading ? t('import.importing') : t('import.sync_patients')}
            </button>
            {winkError && (
              <div className="mt-2 flex items-center gap-1.5 text-red-600 text-xs bg-red-50 border border-red-200 rounded-lg p-2">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                {winkError}
              </div>
            )}
            {winkResult && <ResultBadges result={winkResult} />}
          </div>

          {/* Import Encounters as Claims */}
          <div>
            <button
              onClick={handleWinkEncounters}
              disabled={encLoading}
              className="w-full flex items-center justify-center gap-2 bg-indigo-500 hover:bg-indigo-600 disabled:opacity-50 text-white text-xs font-medium py-2 rounded-lg transition-colors"
            >
              <ClipboardList className={`w-3.5 h-3.5 ${encLoading ? 'animate-pulse' : ''}`} />
              {encLoading ? t('import.importing') : t('import.import_encounters')}
            </button>
            {encError && (
              <div className="mt-2 flex items-center gap-1.5 text-red-600 text-xs bg-red-50 border border-red-200 rounded-lg p-2">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                {encError}
              </div>
            )}
            {encResult && <ResultBadges result={encResult} />}
          </div>
        </div>
      </div>

      {/* Options row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
        {/* Template download */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-9 h-9 rounded-lg bg-emerald-50 flex items-center justify-center">
              <Download className="w-4 h-4 text-emerald-600" />
            </div>
            <p className="font-semibold text-slate-800 text-sm">{t('import.download_template')}</p>
          </div>
          <p className="text-xs text-slate-500 mb-4">
            {t('import.template_desc')}
          </p>
          <button
            onClick={downloadTemplate}
            className="w-full bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-medium py-2 rounded-lg transition-colors"
          >
            {t('import.download_csv')}
          </button>
        </div>
      </div>

      {/* CSV Upload */}
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <div className="flex items-center gap-2 mb-4">
          <FileText className="w-5 h-5 text-sky-600" />
          <h2 className="font-semibold text-slate-800">{t('import.csv')}</h2>
        </div>

        {/* Drop zone */}
        <div
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileRef.current?.click()}
          className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors ${
            dragging ? 'border-sky-500 bg-sky-50' : 'border-slate-200 hover:border-slate-300'
          }`}
        >
          <Upload className="w-8 h-8 text-slate-300 mx-auto mb-3" />
          {file ? (
            <div>
              <p className="text-sm font-medium text-slate-700">{file.name}</p>
              <p className="text-xs text-slate-400 mt-1">
                {(file.size / 1024).toFixed(1)} KB
              </p>
            </div>
          ) : (
            <>
              <p className="text-sm text-slate-500">{t('import.drop_file')}</p>
              <p className="text-xs text-slate-400 mt-1">{t('import.or_click')}</p>
            </>
          )}
        </div>
        <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])} />

        {file && (
          <button
            onClick={handleCsvImport}
            disabled={csvLoading}
            className="mt-4 w-full bg-sky-500 hover:bg-sky-600 disabled:opacity-50 text-white text-sm font-medium py-2.5 rounded-lg transition-colors"
          >
            {csvLoading ? t('import.importing') : t('import.import_file')}
          </button>
        )}

        {/* Error */}
        {csvError && (
          <div className="mt-4 flex items-center gap-2 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg p-3">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {csvError}
          </div>
        )}

        {/* Result */}
        {csvResult && <ResultBadges result={csvResult} />}
      </div>
    </div>
  );
}
