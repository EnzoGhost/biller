/**
 * ScanResultsPanel — Display and edit AI-extracted results from scanned images.
 * Shows different UI based on purpose: fee_schedule | inventory | eligibility
 */

import { useState } from 'react';
import { Plus, Trash2, Download, Edit2 } from 'lucide-react';
import type { ScanPurpose } from './ScannerModal';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface FeeScheduleEntry {
  code: string;
  description: string;
  rates: Record<string, number>;
}

export interface InventoryItem {
  name: string;
  sku?: string | null;
  brand?: string | null;
  price?: number | null;
  quantity?: number | null;
  supplier?: string | null;
  category?: string | null;
}

export interface EligibilityInfo {
  payer_name: string;
  plan_type?: string | null;
  member_id: string;
  group_number?: string | null;
  subscriber_name?: string | null;
  effective_date?: string | null;
  copay?: string | null;
  phone?: string | null;
}

interface ScanResultsPanelProps {
  purpose: ScanPurpose;
  result: any;
  onImport: (data: any) => void;
  onClose?: () => void;
}

// ─── Component ─────────────────────────────────────────────────────────────

export default function ScanResultsPanel({
  purpose,
  result,
  onImport,
  onClose,
}: ScanResultsPanelProps) {
  if (purpose === 'fee_schedule') {
    return <FeeScheduleResults result={result} onImport={onImport} onClose={onClose} />;
  }
  if (purpose === 'inventory') {
    return <InventoryResults result={result} onImport={onImport} onClose={onClose} />;
  }
  if (purpose === 'eligibility') {
    return <EligibilityResults result={result} onImport={onImport} onClose={onClose} />;
  }
  return null;
}

// ─── Fee Schedule Results ──────────────────────────────────────────────────

function FeeScheduleResults({
  result,
  onImport,
  onClose,
}: {
  result: { entries: FeeScheduleEntry[] };
  onImport: (data: any) => void;
  onClose?: () => void;
}) {
  const [entries, setEntries] = useState<FeeScheduleEntry[]>(result?.entries ?? []);

  const updateEntry = (i: number, field: keyof FeeScheduleEntry, val: any) => {
    setEntries(prev => prev.map((e, idx) => idx === i ? { ...e, [field]: val } : e));
  };

  const updateRate = (i: number, payer: string, val: string) => {
    setEntries(prev => prev.map((e, idx) => {
      if (idx !== i) return e;
      return { ...e, rates: { ...e.rates, [payer]: parseFloat(val) || 0 } };
    }));
  };

  const removeEntry = (i: number) => {
    setEntries(prev => prev.filter((_, idx) => idx !== i));
  };

  const allPayers = Array.from(new Set(entries.flatMap(e => Object.keys(e.rates))));

  const inputCls = 'w-full px-2 py-1 border border-slate-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-sky-400';

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-sky-50">
        <div>
          <p className="text-sm font-semibold text-sky-900">Extracted Fee Schedule</p>
          <p className="text-xs text-sky-600 mt-0.5">{entries.length} codes extracted — review and edit before importing</p>
        </div>
        <div className="flex gap-2">
          {onClose && (
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-xs text-slate-500 hover:text-slate-700 rounded-lg hover:bg-slate-100 transition-colors"
            >
              Discard
            </button>
          )}
          <button
            onClick={() => onImport(entries)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-sky-500 hover:bg-sky-600 text-white text-xs font-medium rounded-lg transition-colors"
          >
            <Download size={13} />
            Import {entries.length} Codes
          </button>
        </div>
      </div>

      <div className="overflow-x-auto max-h-80">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50 sticky top-0">
              <th className="text-left px-3 py-2 font-medium text-slate-600 w-28 min-w-[7rem]">CPT Code</th>
              <th className="text-left px-3 py-2 font-medium text-slate-600 min-w-[8rem]">Description</th>
              {allPayers.map(p => (
                <th key={p} className="text-right px-3 py-2 font-medium text-slate-600 min-w-[5.5rem] whitespace-nowrap text-[10px]">{p}</th>
              ))}
              <th className="w-8 px-2 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e, i) => (
              <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
                <td className="px-3 py-1.5">
                  <input
                    value={e.code}
                    onChange={ev => updateEntry(i, 'code', ev.target.value)}
                    className={inputCls + ' font-mono'}
                  />
                </td>
                <td className="px-3 py-1.5">
                  <input
                    value={e.description}
                    onChange={ev => updateEntry(i, 'description', ev.target.value)}
                    className={inputCls}
                  />
                </td>
                {allPayers.map(p => (
                  <td key={p} className="px-3 py-1.5 text-right">
                    <input
                      value={e.rates[p] != null ? `$${Number(e.rates[p]).toFixed(2)}` : ''}
                      onFocus={ev => {
                        // On focus, show raw number for editing
                        const raw = e.rates[p];
                        ev.target.value = raw != null ? String(raw) : '';
                        ev.target.select();
                      }}
                      onBlur={ev => {
                        // On blur, parse and format as currency
                        const cleaned = ev.target.value.replace(/[^0-9.]/g, '');
                        const val = parseFloat(cleaned) || 0;
                        updateRate(i, p, String(val));
                      }}
                      onChange={ev => {
                        // Allow free typing, parse on blur
                        const cleaned = ev.target.value.replace(/[^0-9.]/g, '');
                        ev.target.value = cleaned;
                      }}
                      inputMode="decimal"
                      className={inputCls + ' text-right font-mono tabular-nums'}
                    />
                  </td>
                ))}
                <td className="px-2 py-1.5">
                  <button
                    onClick={() => removeEntry(i)}
                    className="p-1 text-slate-300 hover:text-red-500 rounded transition-colors"
                  >
                    <Trash2 size={12} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {entries.length === 0 && (
          <div className="text-center py-6 text-sm text-slate-400">No entries extracted.</div>
        )}
      </div>
    </div>
  );
}

// ─── Inventory Results ─────────────────────────────────────────────────────

function InventoryResults({
  result,
  onImport,
  onClose,
}: {
  result: { items: InventoryItem[] };
  onImport: (data: any) => void;
  onClose?: () => void;
}) {
  const [items, setItems] = useState<InventoryItem[]>(result?.items ?? []);

  const update = (i: number, field: keyof InventoryItem, val: any) => {
    setItems(prev => prev.map((item, idx) => idx === i ? { ...item, [field]: val } : item));
  };

  const remove = (i: number) => setItems(prev => prev.filter((_, idx) => idx !== i));

  const inputCls = 'w-full px-2 py-1 border border-slate-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-sky-400';

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-violet-50">
        <div>
          <p className="text-sm font-semibold text-violet-900">Extracted Inventory</p>
          <p className="text-xs text-violet-600 mt-0.5">{items.length} items — review and edit</p>
        </div>
        <div className="flex gap-2">
          {onClose && (
            <button onClick={onClose} className="px-3 py-1.5 text-xs text-slate-500 hover:text-slate-700 rounded-lg hover:bg-slate-100 transition-colors">
              Discard
            </button>
          )}
          <button
            onClick={() => onImport(items)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-500 hover:bg-violet-600 text-white text-xs font-medium rounded-lg transition-colors"
          >
            <Download size={13} />
            Import {items.length} Items
          </button>
        </div>
      </div>

      <div className="divide-y divide-slate-100 max-h-80 overflow-y-auto">
        {items.map((item, i) => (
          <div key={i} className="px-4 py-3 hover:bg-slate-50">
            <div className="flex items-start gap-2">
              <div className="flex-1 grid grid-cols-2 gap-2 sm:grid-cols-3">
                <div>
                  <label className="text-xs text-slate-400">Name</label>
                  <input value={item.name} onChange={e => update(i, 'name', e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className="text-xs text-slate-400">SKU</label>
                  <input value={item.sku ?? ''} onChange={e => update(i, 'sku', e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className="text-xs text-slate-400">Brand</label>
                  <input value={item.brand ?? ''} onChange={e => update(i, 'brand', e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className="text-xs text-slate-400">Price</label>
                  <input value={item.price ?? ''} onChange={e => update(i, 'price', parseFloat(e.target.value) || null)} type="number" step="0.01" className={inputCls} />
                </div>
                <div>
                  <label className="text-xs text-slate-400">Qty</label>
                  <input value={item.quantity ?? ''} onChange={e => update(i, 'quantity', parseInt(e.target.value) || null)} type="number" className={inputCls} />
                </div>
                <div>
                  <label className="text-xs text-slate-400">Supplier</label>
                  <input value={item.supplier ?? ''} onChange={e => update(i, 'supplier', e.target.value)} className={inputCls} />
                </div>
              </div>
              <button onClick={() => remove(i)} className="mt-4 p-1 text-slate-300 hover:text-red-500 rounded transition-colors">
                <Trash2 size={12} />
              </button>
            </div>
          </div>
        ))}
        {items.length === 0 && (
          <div className="text-center py-6 text-sm text-slate-400">No items extracted.</div>
        )}
      </div>
    </div>
  );
}

// ─── Eligibility Results ───────────────────────────────────────────────────

function EligibilityResults({
  result,
  onImport,
  onClose,
}: {
  result: { info: EligibilityInfo };
  onImport: (data: any) => void;
  onClose?: () => void;
}) {
  const [info, setInfo] = useState<EligibilityInfo>(result?.info ?? {
    payer_name: '',
    member_id: '',
  });

  const update = (field: keyof EligibilityInfo, val: string) => {
    setInfo(prev => ({ ...prev, [field]: val }));
  };

  const inputCls = 'w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-400';

  const fields: Array<{ key: keyof EligibilityInfo; label: string }> = [
    { key: 'payer_name', label: 'Insurance Payer' },
    { key: 'plan_type', label: 'Plan Type' },
    { key: 'member_id', label: 'Member ID' },
    { key: 'group_number', label: 'Group Number' },
    { key: 'subscriber_name', label: 'Subscriber Name' },
    { key: 'effective_date', label: 'Effective Date' },
    { key: 'copay', label: 'Copay' },
    { key: 'phone', label: 'Payer Phone' },
  ];

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-emerald-50">
        <div>
          <p className="text-sm font-semibold text-emerald-900">Extracted Insurance Info</p>
          <p className="text-xs text-emerald-600 mt-0.5">Review and edit before importing</p>
        </div>
        <div className="flex gap-2">
          {onClose && (
            <button onClick={onClose} className="px-3 py-1.5 text-xs text-slate-500 hover:text-slate-700 rounded-lg hover:bg-slate-100 transition-colors">
              Discard
            </button>
          )}
          <button
            onClick={() => onImport(info)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-medium rounded-lg transition-colors"
          >
            <Download size={13} />
            Import Info
          </button>
        </div>
      </div>

      <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
        {fields.map(({ key, label }) => (
          <div key={key}>
            <label className="block text-xs font-medium text-slate-500 mb-1">{label}</label>
            <input
              value={(info[key] as string) ?? ''}
              onChange={e => update(key, e.target.value)}
              className={inputCls}
              placeholder={`Enter ${label.toLowerCase()}...`}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
