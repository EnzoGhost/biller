/**
 * ICD-10 autocomplete for optometry codes.
 * Supports comma-separated multiple codes.
 * Shows code + description in both EN and ES.
 */
import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, X } from 'lucide-react';
import { searchICD10, type ICD10Code } from '../../lib/icd10';
import { clsx } from 'clsx';

interface ICD10InputProps {
  value: string; // comma-separated codes e.g. "H52.10, H40.9"
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  className?: string;
}

function parseCodesFromValue(value: string): string[] {
  return value.split(',').map(c => c.trim()).filter(Boolean);
}

export default function ICD10Input({ value, onChange, placeholder, required, className }: ICD10InputProps) {
  const { i18n } = useTranslation();
  const lang = i18n.language || 'en';
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ICD10Code[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedCodes = parseCodesFromValue(value);

  useEffect(() => {
    if (query.length >= 1) {
      setResults(searchICD10(query, lang));
      setOpen(true);
      setActiveIdx(-1);
    } else {
      setResults([]);
      setOpen(false);
    }
  }, [query, lang]);

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

  const addCode = (code: ICD10Code) => {
    const existing = parseCodesFromValue(value);
    if (!existing.includes(code.code)) {
      const next = [...existing, code.code];
      onChange(next.join(', '));
    }
    setQuery('');
    setOpen(false);
    inputRef.current?.focus();
  };

  const removeCode = (code: string) => {
    const next = selectedCodes.filter(c => c !== code);
    onChange(next.join(', '));
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
        addCode(results[activeIdx]);
      } else if (query.trim()) {
        // Allow typing a raw code directly
        const raw = query.trim().toUpperCase();
        const existing = parseCodesFromValue(value);
        if (!existing.includes(raw)) {
          onChange([...existing, raw].join(', '));
        }
        setQuery('');
        setOpen(false);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div className={clsx('relative', className)} ref={containerRef}>
      {/* Selected chips */}
      {selectedCodes.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {selectedCodes.map(code => (
            <span
              key={code}
              className="inline-flex items-center gap-1 bg-sky-50 text-sky-800 border border-sky-200 rounded-md px-2 py-0.5 text-xs font-mono"
            >
              {code}
              <button
                type="button"
                onClick={() => removeCode(code)}
                className="text-sky-400 hover:text-sky-700 ml-0.5"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Search input */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => query && setOpen(true)}
          placeholder={placeholder || (lang.startsWith('es') ? 'Buscar código ICD-10...' : 'Search ICD-10 code...')}
          className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
        />
        {required && (
          <input
            type="text"
            value={value}
            required
            readOnly
            tabIndex={-1}
            className="absolute opacity-0 w-0 h-0 pointer-events-none"
          />
        )}
      </div>

      {/* Dropdown */}
      {open && results.length > 0 && (
        <div className="absolute z-50 top-full mt-1 left-0 right-0 bg-white rounded-xl border border-slate-200 shadow-xl max-h-64 overflow-y-auto">
          {results.map((code, i) => (
            <button
              key={code.code}
              type="button"
              onClick={() => addCode(code)}
              className={clsx(
                'w-full text-left px-3 py-2.5 hover:bg-sky-50 transition-colors border-b border-slate-50 last:border-0',
                activeIdx === i && 'bg-sky-50',
              )}
            >
              <div className="flex items-start gap-2">
                <span className="font-mono text-xs font-bold text-sky-700 bg-sky-100 px-1.5 py-0.5 rounded shrink-0 mt-0.5">
                  {code.code}
                </span>
                <span className="text-sm text-slate-700 leading-snug">
                  {lang.startsWith('es') ? code.es : code.en}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Also allow editing as raw text */}
      {selectedCodes.length > 0 && (
        <p className="text-xs text-slate-400 mt-1">
          {lang.startsWith('es') ? 'Códigos seleccionados' : 'Selected'}: <span className="font-mono text-slate-600">{value}</span>
        </p>
      )}
    </div>
  );
}
