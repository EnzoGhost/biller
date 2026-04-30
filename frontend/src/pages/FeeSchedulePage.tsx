import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { DollarSign, Plus, Trash2, Search, Filter } from 'lucide-react';
import api from '../lib/api';

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

  // Group entries by CPT code for the matrix view
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

    // Get unique CPT codes with their baseline info
    const cptMap = new Map<string, { description: string | null; category: string | null; baseline: number; entries: Map<number | 'baseline', FeeEntry> }>();
    
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

  const handleCellClick = (cptCode: string, payerId: number | 'baseline', currentAmount: number) => {
    const key = `${cptCode}-${payerId}`;
    setEditingCell(key);
    setEditValue(currentAmount.toFixed(2));
  };

  const handleCellSave = async (cptCode: string, payerId: number | 'baseline') => {
    const amount = parseFloat(editValue);
    if (isNaN(amount)) {
      setEditingCell(null);
      return;
    }

    const item = matrix.get(cptCode);
    const entry = item?.entries.get(payerId);

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
    if (entry) return 'bg-emerald-50 text-emerald-700'; // Has payer-specific rate
    if (item.baseline > 0) return 'bg-amber-50 text-amber-700'; // Using Medicare default
    return 'bg-red-50 text-red-400'; // No rate at all
  };

  const getAmount = (cptCode: string, payerId: number): number => {
    const item = matrix.get(cptCode);
    if (!item) return 0;
    const entry = item.entries.get(payerId);
    return entry ? entry.allowed_amount : item.baseline;
  };

  const inputCls = 'w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500';

  return (
    <div className="p-6 max-w-full mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <DollarSign className="w-6 h-6 text-sky-600" />
          <h1 className="text-xl font-bold text-slate-900">Fee Schedule</h1>
          <span className="text-sm text-slate-400">{cptCodes.length} codes</span>
        </div>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="flex items-center gap-2 bg-sky-500 hover:bg-sky-600 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add Code
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-4">
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
      </div>

      {/* Add form */}
      {showAdd && (
        <div className="bg-sky-50 border border-sky-200 rounded-xl p-4 mb-4">
          <h3 className="text-sm font-semibold text-sky-900 mb-3">Add CPT Code</h3>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <input value={newCode} onChange={e => setNewCode(e.target.value)} placeholder="CPT Code" className={inputCls} />
            <input value={newDesc} onChange={e => setNewDesc(e.target.value)} placeholder="Description" className={inputCls} />
            <input value={newAmount} onChange={e => setNewAmount(e.target.value)} placeholder="Amount" type="number" step="0.01" className={inputCls} />
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

      {/* Table */}
      {isLoading ? (
        <div className="text-center py-12 text-slate-400">Loading fee schedule...</div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="text-left px-4 py-3 font-semibold text-slate-600 sticky left-0 bg-slate-50 z-10 min-w-[100px]">CPT Code</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600 min-w-[200px]">Description</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600 min-w-[80px]">Category</th>
                <th className="text-right px-4 py-3 font-semibold text-sky-700 min-w-[100px]">Medicare</th>
                {payers.map(p => (
                  <th key={p.id} className="text-right px-4 py-3 font-semibold text-slate-600 min-w-[100px]">
                    {p.name.length > 15 ? p.name.slice(0, 15) + '…' : p.name}
                  </th>
                ))}
                <th className="px-4 py-3 w-10"></th>
              </tr>
            </thead>
            <tbody>
              {cptCodes.map(code => {
                const item = matrix.get(code)!;
                const baselineEntry = item.entries.get('baseline');
                return (
                  <tr key={code} className="border-b border-slate-100 hover:bg-slate-50/50">
                    <td className="px-4 py-2.5 font-mono font-semibold text-slate-800 sticky left-0 bg-white z-10">{code}</td>
                    <td className="px-4 py-2.5 text-slate-600 truncate max-w-[250px]">{item.description ?? '—'}</td>
                    <td className="px-4 py-2.5">
                      {item.category && (
                        <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                          item.category === 'exam' ? 'bg-blue-100 text-blue-700' :
                          item.category === 'diagnostic' ? 'bg-purple-100 text-purple-700' :
                          item.category === 'contacts' ? 'bg-teal-100 text-teal-700' :
                          'bg-orange-100 text-orange-700'
                        }`}>
                          {item.category}
                        </span>
                      )}
                    </td>
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
                              onClick={() => handleCellClick(code, p.id, hasSpecific ? amount : amount)}
                              className="font-mono hover:bg-white/50 px-2 py-1 rounded cursor-pointer"
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
      )}
    </div>
  );
}
