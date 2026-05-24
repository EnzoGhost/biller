import { useState, useEffect } from 'react';
import SearchableSelect from './SearchableSelect';
import type { SelectOption } from './SearchableSelect';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const MONTH_OPTIONS: SelectOption[] = MONTHS.map((name, i) => ({
  value: String(i + 1),
  label: name,
}));

function daysInMonth(month: number, year: number): number {
  if (!month || !year) return 31;
  return new Date(year, month, 0).getDate();
}

function buildDayOptions(max: number): SelectOption[] {
  const opts: SelectOption[] = [];
  for (let d = 1; d <= max; d++) opts.push({ value: String(d), label: String(d) });
  return opts;
}

const CURRENT_YEAR = new Date().getFullYear();
const YEAR_OPTIONS: SelectOption[] = [];
for (let y = CURRENT_YEAR + 2; y >= 1920; y--) YEAR_OPTIONS.push({ value: String(y), label: String(y) });

interface DateDropdownProps {
  value: string;
  onChange: (value: string) => void;
}

export default function DateDropdown({ value, onChange }: DateDropdownProps) {
  const parseValue = (v: string) => {
    if (!v) return { m: '', d: '', y: '' };
    const parts = v.split('-');
    return {
      y: parts[0] || '',
      m: parts[1] ? String(Number(parts[1])) : '',
      d: parts[2] ? String(Number(parts[2])) : '',
    };
  };

  const [sel, setSel] = useState(parseValue(value));

  useEffect(() => {
    setSel(parseValue(value));
  }, [value]);

  const maxDay = daysInMonth(Number(sel.m) || 1, Number(sel.y) || CURRENT_YEAR);
  const dayOptions = buildDayOptions(maxDay);

  const handleChange = (field: 'm' | 'd' | 'y', val: string) => {
    const next = { ...sel, [field]: val };
    if (next.m && next.d) {
      const max = daysInMonth(Number(next.m), Number(next.y) || CURRENT_YEAR);
      if (Number(next.d) > max) next.d = String(max);
    }
    setSel(next);
    if (next.m && next.d && next.y) {
      onChange(`${next.y}-${next.m.padStart(2, '0')}-${next.d.padStart(2, '0')}`);
    } else if (!next.m && !next.d && !next.y) {
      onChange('');
    }
  };

  return (
    <div className="grid grid-cols-3 gap-2">
      <div className="min-w-0">
        <select
          value={sel.m}
          onChange={(e) => handleChange('m', e.target.value)}
          className="w-full px-2 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-sky-500 appearance-none cursor-pointer"
        >
          <option value="">Month</option>
          {MONTH_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
      <div className="min-w-0">
        <select
          value={sel.d}
          onChange={(e) => handleChange('d', e.target.value)}
          className="w-full px-2 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-sky-500 appearance-none cursor-pointer"
        >
          <option value="">Day</option>
          {dayOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
      <div className="min-w-0">
        <input
          type="number"
          value={sel.y}
          onChange={(e) => handleChange('y', e.target.value)}
          placeholder="Year"
          min={1920}
          max={CURRENT_YEAR + 2}
          className="w-full px-2 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-sky-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
        />
      </div>
    </div>
  );
}
