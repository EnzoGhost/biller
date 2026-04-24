/**
 * CPT code autocomplete for optometry procedures.
 * Selecting a code auto-fills description and standard fee.
 */
import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Search } from 'lucide-react';
import { searchCPT, type CPTCode } from '../../lib/cpt';
import { clsx } from 'clsx';

interface CPTInputProps {
  value: string;
  onChange: (value: string) => void;
  onSelect?: (code: CPTCode) => void; // called when a code is picked
  placeholder?: string;
  required?: boolean;
  className?: string;
}

export default function CPTInput({ value, onChange, onSelect, placeholder, required, className }: CPTInputProps) {
  const { i18n } = useTranslation();
  const lang = i18n.language || 'en';

  const [results, setResults] = useState<CPTCode[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (value.length >= 1) {
      setResults(searchCPT(value, lang));
      setOpen(true);
      setActiveIdx(-1);
    } else {
      setResults([]);
      setOpen(false);
    }
  }, [value, lang]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  const selectCode = (code: CPTCode) => {
    onChange(code.code);
    onSelect?.(code);
    setOpen(false);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx(i => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx(i => Math.max(i - 1, -1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIdx >= 0 && results[activeIdx]) {
        selectCode(results[activeIdx]);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div className={clsx('relative', className)} ref={containerRef}>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={e => { onChange(e.target.value); setOpen(true); }}
          onKeyDown={handleKeyDown}
          onFocus={() => value && setOpen(true)}
          placeholder={placeholder || (lang.startsWith('es') ? 'Buscar CPT...' : 'Search CPT...')}
          required={required}
          className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
        />
      </div>

      {open && results.length > 0 && (
        <div className="absolute z-50 top-full mt-1 left-0 right-0 bg-white rounded-xl border border-slate-200 shadow-xl max-h-64 overflow-y-auto">
          {results.map((code, i) => (
            <button
              key={code.code}
              type="button"
              onClick={() => selectCode(code)}
              className={clsx(
                'w-full text-left px-3 py-2.5 hover:bg-sky-50 transition-colors border-b border-slate-50 last:border-0',
                activeIdx === i && 'bg-sky-50',
              )}
            >
              <div className="flex items-start gap-2">
                <span className="font-mono text-xs font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded shrink-0 mt-0.5">
                  {code.code}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-slate-700 leading-snug">
                    {lang.startsWith('es') ? code.descripcion : code.description}
                  </p>
                  <p className="text-xs text-emerald-600 font-medium mt-0.5">
                    ${code.standardFee.toFixed(2)}
                  </p>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
