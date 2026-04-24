import { useRef, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Upload, FileText, Download, CheckCircle, XCircle, AlertCircle, RefreshCw, ClipboardList, ChevronRight } from 'lucide-react';
import api from '../lib/api';

interface ImportResult {
  imported: number;
  skipped: number;
  errors: string[];
  claims_created?: number[];
}

// ── Column mapping fields ─────────────────────────────────────────────────────

const TARGET_FIELDS = [
  { key: 'patient_mrn',         label: 'Patient MRN' },
  { key: 'patient_first_name',  label: 'First Name' },
  { key: 'patient_last_name',   label: 'Last Name' },
  { key: 'dob',                 label: 'Date of Birth' },
  { key: 'service_date',        label: 'Service Date' },
  { key: 'provider_npi',        label: 'Provider NPI' },
  { key: 'payer_id',            label: 'Payer ID' },
  { key: 'member_id',           label: 'Member ID' },
  { key: 'cpt_code',            label: 'CPT Code' },
  { key: 'icd10_1',             label: 'ICD-10 #1' },
  { key: 'icd10_2',             label: 'ICD-10 #2' },
  { key: 'units',               label: 'Units' },
  { key: 'billed_amount',       label: 'Billed Amount' },
  { key: 'place_of_service',    label: 'Place of Service' },
];

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

// ── CSV parsing ───────────────────────────────────────────────────────────────

function parseCSV(text: string): { headers: string[]; rows: string[][] } {
  const lines = text.trim().split('\n').filter(Boolean);
  if (!lines.length) return { headers: [], rows: [] };
  const parseRow = (line: string): string[] => {
    const result: string[] = [];
    let field = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = !inQuotes;
      } else if (ch === ',' && !inQuotes) {
        result.push(field.trim());
        field = '';
      } else {
        field += ch;
      }
    }
    result.push(field.trim());
    return result;
  };
  const headers = parseRow(lines[0]);
  const rows = lines.slice(1).map(parseRow);
  return { headers, rows };
}

// ── Component ─────────────────────────────────────────────────────────────────

type ImportStep = 'upload' | 'mapping' | 'preview' | 'done';

export default function ImportPage() {
  const { t } = useTranslation();
  const fileRef = useRef<HTMLInputElement>(null);

  // Step state
  const [step, setStep] = useState<ImportStep>('upload');

  // CSV state
  const [dragging, setDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvRows, setCsvRows] = useState<string[][]>([]);
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({});  // csvCol -> targetField

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

  const handleFile = useCallback((f: File) => {
    setFile(f);
    setCsvResult(null);
    setCsvError(null);
    setStep('upload');
    const reader = new FileReader();
    reader.onload = e => {
      const text = e.target?.result as string;
      const { headers, rows } = parseCSV(text);
      setCsvHeaders(headers);
      setCsvRows(rows);
      // Auto-map columns with matching names
      const autoMap: Record<string, string> = {};
      headers.forEach(h => {
        const lh = h.toLowerCase().replace(/\s+/g, '_');
        const match = TARGET_FIELDS.find(f => f.key === lh || f.key === h.toLowerCase());
        if (match) autoMap[h] = match.key;
      });
      setColumnMapping(autoMap);
    };
    reader.readAsText(f);
  }, []);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  };

  const handleProceedToMapping = () => {
    if (csvHeaders.length > 0) setStep('mapping');
  };

  const handleProceedToPreview = () => {
    setStep('preview');
  };

  // Build remapped rows for preview / submission
  const buildRemappedCSV = (): string => {
    const targetCols = TARGET_FIELDS.map(f => f.key);
    const header = targetCols.join(',');
    const rows = csvRows.slice(0, 5).map(row => {
      return targetCols.map(targetKey => {
        const csvCol = Object.entries(columnMapping).find(([, v]) => v === targetKey)?.[0];
        if (!csvCol) return '';
        const idx = csvHeaders.indexOf(csvCol);
        return idx >= 0 ? (row[idx] ?? '') : '';
      }).join(',');
    });
    return [header, ...rows].join('\n');
  };

  const handleCsvImport = async () => {
    if (!file) return;
    setCsvLoading(true);
    setCsvResult(null);
    setCsvError(null);
    try {
      // Rebuild CSV with mapped columns if mapping was done
      let fileToUpload = file;
      if (step === 'preview' && Object.keys(columnMapping).length > 0) {
        // Build remapped CSV from all rows
        const targetCols = TARGET_FIELDS.map(f => f.key);
        const header = targetCols.join(',');
        const allRows = csvRows.map(row =>
          targetCols.map(targetKey => {
            const csvCol = Object.entries(columnMapping).find(([, v]) => v === targetKey)?.[0];
            if (!csvCol) return '';
            const idx = csvHeaders.indexOf(csvCol);
            return idx >= 0 ? (row[idx] ?? '') : '';
          }).join(',')
        );
        const remapped = [header, ...allRows].join('\n');
        fileToUpload = new File([remapped], file.name, { type: 'text/csv' });
      }
      const form = new FormData();
      form.append('file', fileToUpload);
      const { data } = await api.post<ImportResult>('/import/superbill', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setCsvResult(data);
      setStep('done');
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
      const { data } = await api.post<ImportResult>('/import/wink', null, { params: { provider_id: 1 } });
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
      const { data } = await api.post<ImportResult>('/import/wink/encounters', null, { params: { provider_id: 1, payer_id: 1 } });
      setEncResult(data);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setEncError(msg ?? t('import.error_encounters'));
    } finally {
      setEncLoading(false);
    }
  };

  const downloadTemplate = () => {
    const headers = TARGET_FIELDS.map(f => f.key);
    const csv = headers.join(',') + '\n';
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'superbill_template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const inputClass = 'px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 bg-white';

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-xl font-bold text-slate-900 mb-6">{t('import.title')}</h1>

      {/* Wink Integration */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 mb-6">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-9 h-9 rounded-lg bg-sky-50 flex items-center justify-center">
            <Upload className="w-4 h-4 text-sky-600" />
          </div>
          <p className="font-semibold text-slate-800">{t('import.wink')}</p>
        </div>
        <p className="text-xs text-slate-500 mb-4">{t('import.wink_desc')}</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <button
              onClick={handleWinkPatients}
              disabled={winkLoading}
              className="w-full flex items-center justify-center gap-2 bg-sky-500 hover:bg-sky-600 disabled:opacity-50 text-white text-xs font-medium py-2 rounded-lg"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${winkLoading ? 'animate-spin' : ''}`} />
              {winkLoading ? t('import.importing') : t('import.sync_patients')}
            </button>
            {winkError && (
              <div className="mt-2 flex items-center gap-1.5 text-red-600 text-xs bg-red-50 border border-red-200 rounded-lg p-2">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />{winkError}
              </div>
            )}
            {winkResult && <ResultBadges result={winkResult} />}
          </div>
          <div>
            <button
              onClick={handleWinkEncounters}
              disabled={encLoading}
              className="w-full flex items-center justify-center gap-2 bg-indigo-500 hover:bg-indigo-600 disabled:opacity-50 text-white text-xs font-medium py-2 rounded-lg"
            >
              <ClipboardList className={`w-3.5 h-3.5 ${encLoading ? 'animate-pulse' : ''}`} />
              {encLoading ? t('import.importing') : t('import.import_encounters')}
            </button>
            {encError && (
              <div className="mt-2 flex items-center gap-1.5 text-red-600 text-xs bg-red-50 border border-red-200 rounded-lg p-2">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />{encError}
              </div>
            )}
            {encResult && <ResultBadges result={encResult} />}
          </div>
        </div>
      </div>

      {/* Template download */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 mb-6">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-9 h-9 rounded-lg bg-emerald-50 flex items-center justify-center">
            <Download className="w-4 h-4 text-emerald-600" />
          </div>
          <p className="font-semibold text-slate-800 text-sm">{t('import.download_template')}</p>
        </div>
        <p className="text-xs text-slate-500 mb-4">{t('import.template_desc')}</p>
        <button
          onClick={downloadTemplate}
          className="bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-medium py-2 px-4 rounded-lg"
        >
          {t('import.download_csv')}
        </button>
      </div>

      {/* CSV Upload with stepper */}
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <div className="flex items-center gap-2 mb-4">
          <FileText className="w-5 h-5 text-sky-600" />
          <h2 className="font-semibold text-slate-800">{t('import.csv')}</h2>
        </div>

        {/* Step indicators */}
        <div className="flex items-center gap-2 mb-5 text-xs">
          {(['upload', 'mapping', 'preview', 'done'] as ImportStep[]).map((s, i) => (
            <div key={s} className="flex items-center gap-2">
              <span className={`px-2 py-0.5 rounded-full font-semibold ${
                step === s ? 'bg-sky-500 text-white' :
                (['upload', 'mapping', 'preview', 'done'].indexOf(step) > i) ? 'bg-emerald-100 text-emerald-700' :
                'bg-slate-100 text-slate-400'
              }`}>
                {i + 1}
              </span>
              <span className={step === s ? 'text-sky-700 font-medium' : 'text-slate-400'}>
                {s === 'upload' ? 'Upload' : s === 'mapping' ? t('import_preview.column_mapping') : s === 'preview' ? t('import_preview.preview') : 'Done'}
              </span>
              {i < 3 && <ChevronRight className="w-3 h-3 text-slate-300" />}
            </div>
          ))}
        </div>

        {/* Step 1: Drop zone */}
        {(step === 'upload' || step === 'done') && (
          <>
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
                  <p className="text-xs text-slate-400 mt-1">{(file.size / 1024).toFixed(1)} KB • {csvRows.length} rows</p>
                </div>
              ) : (
                <>
                  <p className="text-sm text-slate-500">{t('import.drop_file')}</p>
                  <p className="text-xs text-slate-400 mt-1">{t('import.or_click')}</p>
                </>
              )}
            </div>
            <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])} />

            {file && step === 'upload' && (
              <button
                onClick={handleProceedToMapping}
                className="mt-4 w-full bg-sky-500 hover:bg-sky-600 text-white text-sm font-medium py-2.5 rounded-lg"
              >
                {t('import_preview.map_columns')} →
              </button>
            )}
            {step === 'done' && csvResult && <ResultBadges result={csvResult} />}
          </>
        )}

        {/* Step 2: Column mapping */}
        {step === 'mapping' && (
          <div>
            <p className="text-sm text-slate-600 mb-3">{t('import_preview.map_columns')}</p>
            <div className="border border-slate-200 rounded-lg overflow-hidden mb-4">
              <table className="w-full text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="text-left px-3 py-2 text-xs font-semibold text-slate-500">{t('import_preview.csv_column')}</th>
                    <th className="text-left px-3 py-2 text-xs font-semibold text-slate-500">{t('import_preview.maps_to')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {csvHeaders.map(col => (
                    <tr key={col}>
                      <td className="px-3 py-2 font-mono text-xs text-slate-700">{col}</td>
                      <td className="px-3 py-2">
                        <select
                          value={columnMapping[col] ?? ''}
                          onChange={e => setColumnMapping(prev => ({ ...prev, [col]: e.target.value }))}
                          className={inputClass + ' w-full text-xs'}
                        >
                          <option value="">{t('import_preview.ignore')}</option>
                          {TARGET_FIELDS.map(f => (
                            <option key={f.key} value={f.key}>{f.label}</option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setStep('upload')} className="px-4 py-2 border border-slate-200 text-sm rounded-lg hover:bg-slate-50">
                ← Back
              </button>
              <button
                onClick={handleProceedToPreview}
                className="flex-1 bg-sky-500 hover:bg-sky-600 text-white text-sm font-medium py-2 rounded-lg"
              >
                {t('import_preview.preview')} →
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Preview */}
        {step === 'preview' && (
          <div>
            <p className="text-sm font-semibold text-slate-700 mb-2">{t('import_preview.preview_rows')}</p>
            <div className="border border-slate-200 rounded-lg overflow-x-auto mb-4 max-h-64">
              <table className="text-xs text-slate-700 whitespace-nowrap">
                <thead className="bg-slate-50 sticky top-0">
                  <tr>
                    {Object.entries(columnMapping)
                      .filter(([, v]) => v)
                      .map(([col, target]) => (
                        <th key={col} className="px-3 py-2 text-left font-semibold text-slate-500">
                          {TARGET_FIELDS.find(f => f.key === target)?.label ?? target}
                        </th>
                      ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {csvRows.slice(0, 5).map((row, ri) => (
                    <tr key={ri} className="hover:bg-slate-50">
                      {Object.entries(columnMapping)
                        .filter(([, v]) => v)
                        .map(([col]) => {
                          const idx = csvHeaders.indexOf(col);
                          return (
                            <td key={col} className="px-3 py-1.5">
                              {row[idx] ?? ''}
                            </td>
                          );
                        })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {csvError && (
              <div className="flex items-center gap-2 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg p-3 mb-3">
                <AlertCircle className="w-4 h-4 shrink-0" />{csvError}
              </div>
            )}
            <div className="flex gap-2">
              <button onClick={() => setStep('mapping')} className="px-4 py-2 border border-slate-200 text-sm rounded-lg hover:bg-slate-50">
                ← Back
              </button>
              <button
                onClick={handleCsvImport}
                disabled={csvLoading}
                className="flex-1 bg-sky-500 hover:bg-sky-600 disabled:opacity-50 text-white text-sm font-medium py-2 rounded-lg"
              >
                {csvLoading ? t('import.importing') : t('import_preview.confirm_import', { count: csvRows.length })}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
