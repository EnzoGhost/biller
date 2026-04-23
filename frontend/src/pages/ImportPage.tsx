import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Upload, FileText, Download, CheckCircle, XCircle, AlertCircle } from 'lucide-react';
import api from '../lib/api';

interface ImportResult {
  imported: number;
  skipped: number;
  errors: string[];
}

export default function ImportPage() {
  const { t } = useTranslation();
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFile = (f: File) => {
    setFile(f);
    setResult(null);
    setError(null);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  };

  const handleImport = async () => {
    if (!file) return;
    setLoading(true);
    setResult(null);
    setError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const { data } = await api.post<ImportResult>('/import/superbill', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setResult(data);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(msg ?? 'Error al importar');
    } finally {
      setLoading(false);
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

      {/* Options */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
        {/* Wink import */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-9 h-9 rounded-lg bg-sky-50 flex items-center justify-center">
              <Upload className="w-4 h-4 text-sky-600" />
            </div>
            <p className="font-semibold text-slate-800 text-sm">{t('import.wink')}</p>
          </div>
          <p className="text-xs text-slate-500 mb-4">
            Sincroniza reclamaciones directamente desde Wink EHR vía API.
          </p>
          <button
            onClick={() => api.post('/import/wink').catch(() => setError('Error al sincronizar con Wink'))}
            className="w-full bg-sky-500 hover:bg-sky-600 text-white text-xs font-medium py-2 rounded-lg transition-colors"
          >
            Sincronizar
          </button>
        </div>

        {/* Template download */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-9 h-9 rounded-lg bg-emerald-50 flex items-center justify-center">
              <Download className="w-4 h-4 text-emerald-600" />
            </div>
            <p className="font-semibold text-slate-800 text-sm">{t('import.download_template')}</p>
          </div>
          <p className="text-xs text-slate-500 mb-4">
            Descarga la plantilla CSV de superbill con todos los campos requeridos.
          </p>
          <button
            onClick={downloadTemplate}
            className="w-full bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-medium py-2 rounded-lg transition-colors"
          >
            Descargar CSV
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
            onClick={handleImport}
            disabled={loading}
            className="mt-4 w-full bg-sky-500 hover:bg-sky-600 disabled:opacity-50 text-white text-sm font-medium py-2.5 rounded-lg transition-colors"
          >
            {loading ? t('import.importing') : 'Importar archivo'}
          </button>
        )}

        {/* Error */}
        {error && (
          <div className="mt-4 flex items-center gap-2 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg p-3">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}

        {/* Result */}
        {result && (
          <div className="mt-4 bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
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
            {result.errors.length > 0 && (
              <div className="mt-2">
                <p className="text-xs font-semibold text-slate-600 mb-1">Errores:</p>
                <ul className="space-y-1">
                  {result.errors.map((e, i) => (
                    <li key={i} className="text-xs text-red-600 bg-red-50 rounded px-2 py-1">{e}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
