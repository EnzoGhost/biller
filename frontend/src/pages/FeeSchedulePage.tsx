import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { DollarSign, Plus, Trash2, Search, Filter, Camera } from 'lucide-react';
import api from '../lib/api';
import ScannerModal from '../components/scanner/ScannerModal';
import ScanResultsPanel from '../components/scanner/ScanResultsPanel';
import type { FeeScheduleEntry as ScannedFeeEntry } from '../components/scanner/ScanResultsPanel';

interface FeeEntry {
  id: number;
  payer_id: number | null;
  payer_name: string | null;
  cpt_code: string;
  description: string | null;
  allowed_amount: number;
  category: string | null;
  source: string;
  effective_date: string | null;
  notes: string | null;
}

interface PayerOption {
  id: number;
  name: string;
}

const CATEGORIES = ['exam', 'diagnostic', 'contacts', 'materials'];

type ViewMode = 'matrix' | 'code-focus';

type CptItem = {
  description: string | null;
  category: string | null;
  baseline: number;
  entries: Map<number | 'baseline', FeeEntry>;
};

export default function FeeSchedulePage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('');
  const [editingCell, setEditingCell] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [newCode, setNewCode] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newAmount, setNewAmount] = useState('');
  const [newCategory, setNewCategory] = useState('exam');
  const [newPayerId, setNewPayerId] = useState<number | null>(null);
  const [showScanner, setShowScanner] = useState(false);
  const [scanResult, setScanResult] = useState<any>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('matrix');
  const [selectedCode, setSelectedCode] = useState<string>('');
  const [codeSearch, setCodeSearch] = useState('');

  const { data: entries = [], isLoading } = useQuery<FeeEntry[]>({
    queryKey: ['fee-schedule'],
    queryFn: () => api.get('/fee-schedule').then(r => r.data),
  });

  const { data: payers = [] } = useQuery<PayerOption[]>({
    queryKey: ['payers-list'],
    queryFn: () => api.get('/payers').then(r => ((r.data?.items ?? r.data) || []).map((p: any) => ({ id: p.id, name: p.name }))),
  });

  const upsertMutation = useMutation({
    mutationFn: (data: any) => api.post('/fee-schedule', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['fee-schedule'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/fee-schedule/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['fee-schedule'] }),
  });

  // Unfiltered map — used by code focus mode
  const allCpt = useMemo(() => {
    const cptMap = new Map<string, CptItem>();
    for (const e of entries) {
      if (!cptMap.has(e.cpt_code)) {
        cptMap.set(e.cpt_code, { description: e.description, category: e.category, baseline: 0, entries: new Map() });
      }
      const item = cptMap.get(e.cpt_code)!;
      if (e.payer_id === null) {
        item.baseline = e.allowed_amount;
        item.description = e.description || item.description;
        item.entries.set('baseline', e);
      } else {
        item.entries.set(e.payer_id, e);
      }
    }
    return { codes: Array.from(cptMap.keys()).sort(), map: cptMap };
  }, [entries]);

  // Filtered map — used by matrix view
  const { cptCodes, matrix } = useMemo(() => {
    const filtered = entries.filter(e => {
      if (catFilter && e.category !== catFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          e.cpt_code.toLowerCase().includes(q) ||
          (e.description?.toLowerCase().includes(q) ?? false)
        );
      }
      return true;
    });

    const cptMap = new Map<string, CptItem>();
    for (const e of filtered) {
      if (!cptMap.has(e.cpt_code)) {
        cptMap.set(e.cpt_code, { description: e.description, category: e.category, baseline: 0, entries: new Map() });
      }
      const item = cptMap.get(e.cpt_code)!;
      if (e.payer_id === null) {
        item.baseline = e.allowed_amount;
        item.description = e.description || item.description;
        item.entries.set('baseline', e);
      } else {
        item.entries.set(e.payer_id, e);
      }
    }

    const codes = Array.from(cptMap.keys()).sort();
    return { cptCodes: codes, matrix: cptMap };
  }, [entries, search, catFilter]);

  // Code focus: filtered dropdown options
  const codeFocusCodes = useMemo(() => {
    if (!codeSearch) return allCpt.codes;
    const q = codeSearch.toLowerCase();
    return allCpt.codes.filter(c => {
      const item = allCpt.map.get(c);
      return c.toLowerCase().includes(q) || (item?.description?.toLowerCase().includes(q) ?? false);
    });
  }, [allCpt, codeSearch]);

  const focusItem = selectedCode ? allCpt.map.get(selectedCode) : null;

  const handleCellClick = (cptCode: string, payerId: number | 'baseline', currentAmount: number) => {
    setEditingCell(`${cptCode}-${payerId}`);
    setEditValue(currentAmount.toFixed(2));
  };

  const handleCellSave = async (cptCode: string, payerId: number | 'baseline') => {
    const amount = parseFloat(editValue);
    if (isNaN(amount)) {
      setEditingCell(null);
      return;
    }
    const item = matrix.get(cptCode) ?? allCpt.map.get(cptCode);
    await upsertMutation.mutateAsync({
      payer_id: payerId === 'baseline' ? null : payerId,
      cpt_code: cptCode,
      description: item?.description,
      allowed_amount: amount,
      category: item?.category,
      source: 'manual',
    });
    setEditingCell(null);
  };

  const handleAdd = async () => {
    if (!newCode.trim()) return;
    await upsertMutation.mutateAsync({
      payer_id: newPayerId,
      cpt_code: newCode.trim().toUpperCase(),
      description: newDesc.trim() || null,
      allowed_amount: parseFloat(newAmount) || 0,
      category: newCategory,
      source: 'manual',
    });
    setNewCode('');
    setNewDesc('');
    setNewAmount('');
    setShowAdd(false);
  };

  const getCellColor = (cptCode: string, payerId: number): string => {
    const item = matrix.get(cptCode);
    if (!item) return 'bg-red-50 text-red-400';
    const entry = item.entries.get(payerId);
    if (entry) return 'bg-emerald-50 text-emerald-700';
    if (item.baseline > 0) return 'bg-amber-50 text-amber-700';
    return 'bg-red-50 text-red-400';
  };

  const getAmount = (cptCode: string, payerId: number, map?: Map<string, CptItem>): number => {
    const item = (map ?? matrix).get(cptCode);
    if (!item) return 0;
    const entry = item.entries.get(payerId);
    return entry ? entry.allowed_amount : item.baseline;
  };

  const switchToCodeFocus = (code: string) => {
    setSelectedCode(code);
    setViewMode('code-focus');
    setCodeSearch('');
  };

  const categoryBadge = (cat: string | null) => {
    if (!cat) return null;
    const colors: Record<string, string> = {
      exam: 'bg-blue-100 text-blue-700',
      diagnostic: 'bg-purple-100 text-purple-700',
      contacts: 'bg-teal-100 text-teal-700',
      materials: 'bg-orange-100 text-orange-700',
    };
    return (
      <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${colors[cat] ?? 'bg-slate-100 text-slate-600'}`}>
        {cat}
      </span>
    );
  };

  const inputCls = 'w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500';

  return (
    <div className="max-w-full mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-3 border-b border-slate-100">
        <DollarSign className="w-5 h-5 text-sky-600 shrink-0" />
        <span className="text-base font-bold text-slate-900">Fee Schedule</span>
        <span className="text-sm text-slate-400">{allCpt.codes.length} codes × {payers.length} payers</span>
      </div>

      <div className="p-6 pt-4 max-w-full">
      {/* Action Bar */}
      <div className="flex items-center gap-2 flex-wrap mb-6">
        {/* View mode toggle */}
        <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1">
          <button
            onClick={() => setViewMode('matrix')}
            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
              viewMode === 'matrix' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            All Payers
          </button>
          <button
            onClick={() => setViewMode('code-focus')}
            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
              viewMode === 'code-focus' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            Code Focus
          </button>
        </div>
        <button
          onClick={() => setShowScanner(true)}
          className="flex items-center gap-2 border border-sky-300 text-sky-600 hover:bg-sky-50 text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          <Camera className="w-4 h-4" />
          Scan Fee Schedule
        </button>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="flex items-center gap-2 bg-sky-500 hover:bg-sky-600 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add Code
        </button>
      </div>

      {/* Scanner modal */}
      <ScannerModal
        open={showScanner}
        onClose={() => setShowScanner(false)}
        purpose="fee_schedule"
        onProcessingComplete={(result) => {
          setScanResult(result);
          setShowScanner(false);
        }}
      />

      {/* Scan results */}
      {scanResult && (
        <div className="mb-4">
          <ScanResultsPanel
            purpose="fee_schedule"
            result={scanResult}
            onImport={async (scannedEntries: ScannedFeeEntry[]) => {
              for (const entry of scannedEntries) {
                for (const [payerName, rate] of Object.entries(entry.rates)) {
                  const payer = payers.find(p => p.name.toLowerCase() === payerName.toLowerCase());
                  await upsertMutation.mutateAsync({
                    payer_id: payer?.id ?? null,
                    cpt_code: entry.code.trim().toUpperCase(),
                    description: entry.description || null,
                    allowed_amount: rate,
                    category: 'exam',
                    source: 'scan',
                  });
                }
                if (Object.keys(entry.rates).length === 0) {
                  await upsertMutation.mutateAsync({
                    payer_id: null,
                    cpt_code: entry.code.trim().toUpperCase(),
                    description: entry.description || null,
                    allowed_amount: 0,
                    category: 'exam',
                    source: 'scan',
                  });
                }
              }
              setScanResult(null);
            }}
            onClose={() => setScanResult(null)}
          />
        </div>
      )}

      {/* Add form */}
      {showAdd && (
        <div className="bg-sky-50 border border-sky-200 rounded-xl p-4 mb-4">
          <h3 className="text-sm font-semibold text-sky-900 mb-3">Add CPT Code</h3>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <input value={newCode} onChange={e => setNewCode(e.target.value)} placeholder="CPT Code" className={inputCls} />
            <input value={newDesc} onChange={e => setNewDesc(e.target.value)} placeholder="Description" className={inputCls} />
            <input
              value={newAmount}
              onChange={e => setNewAmount(e.target.value.replace(/[^0-9.]/g, ''))}
              onBlur={e => {
                const val = parseFloat(e.target.value) || 0;
                setNewAmount(val > 0 ? val.toFixed(2) : '');
              }}
              placeholder="$0.00"
              inputMode="decimal"
              className={inputCls}
            />
            <select value={newCategory} onChange={e => setNewCategory(e.target.value)} className={inputCls}>
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <select value={newPayerId ?? ''} onChange={e => setNewPayerId(e.target.value ? Number(e.target.value) : null)} className={inputCls}>
              <option value="">Medicare Baseline</option>
              {payers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div className="mt-3 flex gap-2">
            <button onClick={handleAdd} disabled={upsertMutation.isPending} className="bg-sky-500 hover:bg-sky-600 text-white text-sm px-4 py-1.5 rounded-lg">
              {upsertMutation.isPending ? 'Saving...' : 'Save'}
            </button>
            <button onClick={() => setShowAdd(false)} className="text-slate-500 text-sm px-4 py-1.5 rounded-lg hover:bg-slate-100">Cancel</button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="text-center py-12 text-slate-400">Loading fee schedule…</div>
      ) : viewMode === 'matrix' ? (
        /* ===== MATRIX VIEW ===== */
        <>
          {/* Filters */}
          <div className="flex gap-3 mb-4 flex-wrap">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search CPT code or description..."
                className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div>
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-slate-400" />
              <select
                value={catFilter}
                onChange={e => setCatFilter(e.target.value)}
                className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
              >
                <option value="">All Categories</option>
                {CATEGORIES.map(c => (
                  <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Legend */}
          <div className="flex gap-4 mb-4 text-xs">
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded bg-emerald-100 border border-emerald-300" />
              Payer-specific rate
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded bg-amber-100 border border-amber-300" />
              Medicare default
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded bg-red-100 border border-red-300" />
              No rate
            </span>
            <span className="flex items-center gap-1.5 text-slate-400">
              Click a CPT code to open Code Focus view
            </span>
          </div>

          {/* Horizontally scrollable table */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div
              className="overflow-x-auto"
              style={{ scrollbarWidth: 'thin', scrollbarColor: '#cbd5e1 transparent' }}
            >
              <table className="text-sm" style={{ minWidth: 'max-content', width: '100%' }}>
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    <th
                      className="text-left px-4 py-3 font-semibold text-slate-600 min-w-[110px] sticky left-0 bg-slate-50 z-10"
                      style={{ boxShadow: 'inset -2px 0 0 #e2e8f0' }}
                    >
                      CPT Code
                    </th>
                    <th className="text-left px-4 py-3 font-semibold text-slate-600 min-w-[220px]">Description</th>
                    <th className="text-left px-4 py-3 font-semibold text-slate-600 min-w-[100px]">Category</th>
                    <th className="text-right px-4 py-3 font-semibold text-sky-700 min-w-[110px] whitespace-nowrap">Medicare</th>
                    {payers.map(p => (
                      <th key={p.id} className="text-right px-4 py-3 font-semibold text-slate-600 min-w-[150px]">
                        <span className="block whitespace-nowrap" title={p.name}>{p.name}</span>
                      </th>
                    ))}
                    <th className="px-4 py-3 w-10" />
                  </tr>
                </thead>
                <tbody>
                  {cptCodes.map(code => {
                    const item = matrix.get(code)!;
                    const baselineEntry = item.entries.get('baseline');
                    return (
                      <tr key={code} className="border-b border-slate-100 hover:bg-slate-50/50">
                        <td
                          className="px-4 py-2.5 font-mono font-semibold text-slate-800 sticky left-0 bg-white z-10"
                          style={{ boxShadow: 'inset -2px 0 0 #e2e8f0' }}
                        >
                          <button
                            onClick={() => switchToCodeFocus(code)}
                            className="hover:text-sky-600 transition-colors"
                            title="View all payer rates for this code"
                          >
                            {code}
                          </button>
                        </td>
                        <td className="px-4 py-2.5 text-slate-600 max-w-[250px]">
                          <span className="block truncate" title={item.description ?? ''}>{item.description ?? '—'}</span>
                        </td>
                        <td className="px-4 py-2.5">{categoryBadge(item.category)}</td>
                        {/* Medicare baseline */}
                        <td className="px-4 py-2.5 text-right">
                          {editingCell === `${code}-baseline` ? (
                            <input
                              autoFocus
                              value={editValue}
                              onChange={e => setEditValue(e.target.value)}
                              onBlur={() => handleCellSave(code, 'baseline')}
                              onKeyDown={e => e.key === 'Enter' && handleCellSave(code, 'baseline')}
                              className="w-20 px-2 py-1 text-right border border-sky-300 rounded text-sm"
                            />
                          ) : (
                            <button
                              onClick={() => handleCellClick(code, 'baseline', item.baseline)}
                              className="font-mono text-sky-700 hover:bg-sky-50 px-2 py-1 rounded cursor-pointer"
                            >
                              ${item.baseline.toFixed(2)}
                            </button>
                          )}
                        </td>
                        {/* Per-payer columns */}
                        {payers.map(p => {
                          const cellKey = `${code}-${p.id}`;
                          const amount = getAmount(code, p.id);
                          const hasSpecific = item.entries.has(p.id);
                          return (
                            <td key={p.id} className={`px-4 py-2.5 text-right ${getCellColor(code, p.id)}`}>
                              {editingCell === cellKey ? (
                                <input
                                  autoFocus
                                  value={editValue}
                                  onChange={e => setEditValue(e.target.value)}
                                  onBlur={() => handleCellSave(code, p.id)}
                                  onKeyDown={e => e.key === 'Enter' && handleCellSave(code, p.id)}
                                  className="w-20 px-2 py-1 text-right border border-sky-300 rounded text-sm"
                                />
                              ) : (
                                <button
                                  onClick={() => handleCellClick(code, p.id, amount)}
                                  className="font-mono hover:bg-white/50 px-2 py-1 rounded cursor-pointer whitespace-nowrap"
                                  title={hasSpecific ? 'Payer-specific rate' : 'Using Medicare default'}
                                >
                                  ${amount.toFixed(2)}
                                </button>
                              )}
                            </td>
                          );
                        })}
                        <td className="px-2 py-2.5">
                          {baselineEntry && (
                            <button
                              onClick={() => {
                                if (confirm(`Delete ${code} baseline entry?`)) {
                                  deleteMutation.mutate(baselineEntry.id);
                                }
                              }}
                              className="p-1 text-slate-300 hover:text-red-500 rounded"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {cptCodes.length === 0 && (
                <div className="text-center py-12 text-slate-400">
                  No fee schedule entries found. Click "Add Code" to get started.
                </div>
              )}
            </div>
          </div>
        </>
      ) : (
        /* ===== CODE FOCUS VIEW ===== */
        <div>
          {/* Code selector */}
          <div className="mb-6 max-w-lg relative">
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Select CPT Code</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                value={codeSearch}
                onChange={e => {
                  setCodeSearch(e.target.value);
                  if (!e.target.value) setSelectedCode('');
                }}
                placeholder="Search by code or description..."
                className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div>

            {/* Dropdown results */}
            {codeSearch && (
              <div className="absolute z-20 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                {codeFocusCodes.slice(0, 20).map(code => {
                  const item = allCpt.map.get(code);
                  return (
                    <button
                      key={code}
                      onClick={() => {
                        setSelectedCode(code);
                        setCodeSearch('');
                      }}
                      className="w-full text-left px-4 py-2.5 hover:bg-sky-50 border-b border-slate-100 last:border-0 flex items-baseline gap-2"
                    >
                      <span className="font-mono font-semibold text-slate-800 text-sm shrink-0">{code}</span>
                      {item?.description && (
                        <span className="text-slate-500 text-sm truncate">{item.description}</span>
                      )}
                    </button>
                  );
                })}
                {codeFocusCodes.length === 0 && (
                  <div className="px-4 py-3 text-sm text-slate-400">No matching codes</div>
                )}
              </div>
            )}

            {/* Quick-pick chips (shown when no search active) */}
            {!codeSearch && !selectedCode && allCpt.codes.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {allCpt.codes.slice(0, 12).map(code => (
                  <button
                    key={code}
                    onClick={() => setSelectedCode(code)}
                    className="font-mono text-xs px-2.5 py-1 bg-slate-100 hover:bg-sky-100 hover:text-sky-700 text-slate-600 rounded-md transition-colors"
                  >
                    {code}
                  </button>
                ))}
                {allCpt.codes.length > 12 && (
                  <span className="text-xs text-slate-400 py-1">+{allCpt.codes.length - 12} more — search above</span>
                )}
              </div>
            )}
          </div>

          {/* Detail panel */}
          {selectedCode && focusItem ? (
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              {/* Code header */}
              <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="font-mono text-2xl font-bold text-slate-900">{selectedCode}</span>
                    {categoryBadge(focusItem.category)}
                  </div>
                  {focusItem.description && (
                    <p className="mt-1 text-slate-500 text-sm">{focusItem.description}</p>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <div className="text-xs text-slate-400 mb-0.5">Medicare baseline</div>
                  {editingCell === `${selectedCode}-baseline` ? (
                    <input
                      autoFocus
                      value={editValue}
                      onChange={e => setEditValue(e.target.value)}
                      onBlur={() => handleCellSave(selectedCode, 'baseline')}
                      onKeyDown={e => e.key === 'Enter' && handleCellSave(selectedCode, 'baseline')}
                      className="w-24 px-2 py-1 text-right border border-sky-300 rounded text-sm font-mono"
                    />
                  ) : (
                    <button
                      onClick={() => handleCellClick(selectedCode, 'baseline', focusItem.baseline)}
                      className="font-mono text-lg font-semibold text-sky-700 hover:bg-sky-50 px-2 py-0.5 rounded"
                    >
                      ${focusItem.baseline.toFixed(2)}
                    </button>
                  )}
                </div>
              </div>

              {/* Payer rows */}
              <div className="divide-y divide-slate-100">
                {payers.map(p => {
                  const entry = focusItem.entries.get(p.id);
                  const hasSpecific = !!entry;
                  const amount = entry ? entry.allowed_amount : focusItem.baseline;
                  const cellKey = `${selectedCode}-${p.id}`;

                  return (
                    <div key={p.id} className="flex items-center px-6 py-3 hover:bg-slate-50/60 gap-4">
                      <div className="flex-1 min-w-0">
                        <span className="text-slate-800 text-sm font-medium">{p.name}</span>
                        {!hasSpecific && (
                          <span className="ml-2 text-xs text-amber-600 bg-amber-50 border border-amber-100 px-1.5 py-0.5 rounded">
                            Medicare default
                          </span>
                        )}
                      </div>
                      <div className="shrink-0">
                        {editingCell === cellKey ? (
                          <input
                            autoFocus
                            value={editValue}
                            onChange={e => setEditValue(e.target.value)}
                            onBlur={() => handleCellSave(selectedCode, p.id)}
                            onKeyDown={e => e.key === 'Enter' && handleCellSave(selectedCode, p.id)}
                            className="w-24 px-2 py-1 text-right border border-sky-300 rounded text-sm font-mono"
                          />
                        ) : (
                          <span className={`font-mono text-sm font-semibold ${hasSpecific ? 'text-emerald-700' : 'text-amber-600'}`}>
                            ${amount.toFixed(2)}
                          </span>
                        )}
                      </div>
                      <button
                        onClick={() => handleCellClick(selectedCode, p.id, amount)}
                        className="shrink-0 text-xs text-sky-600 hover:text-sky-800 font-medium px-3 py-1.5 rounded-md hover:bg-sky-50 border border-transparent hover:border-sky-100 transition-colors"
                      >
                        Edit
                      </button>
                    </div>
                  );
                })}
              </div>

              {payers.length === 0 && (
                <div className="px-6 py-10 text-center text-slate-400 text-sm">
                  No payers configured. Add payers to see rates here.
                </div>
              )}
            </div>
          ) : (
            !selectedCode && (
              <div className="text-center py-16 text-slate-400">
                <DollarSign className="w-10 h-10 mx-auto mb-3 opacity-25" />
                <p className="text-sm">Select a CPT code above to view all payer rates</p>
              </div>
            )
          )}
        </div>
      )}
      </div>
    </div>
  );
}
