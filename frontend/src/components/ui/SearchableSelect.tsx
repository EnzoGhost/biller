/**
 * SearchableSelect — combo box with text filtering + keyboard navigation.
 * Replaces basic <select> for Patient / Provider / Payer on NewClaimPage.
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, X } from 'lucide-react';
import { clsx } from 'clsx';

export interface SelectOption {
  value: string;
  label: string;
}

interface SearchableSelectProps {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
}

export default function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = '— Select —',
  required,
  disabled,
  className,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlightedIdx, setHighlightedIdx] = useState(0);

  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // Selected option label
  const selectedOption = options.find(o => o.value === value);

  // Filter options by query
  const filtered = query
    ? options.filter(o => o.label.toLowerCase().includes(query.toLowerCase()))
    : options;

  // Reset highlight when filter changes
  useEffect(() => {
    setHighlightedIdx(0);
  }, [query]);

  // Scroll highlighted item into view
  useEffect(() => {
    if (open && listRef.current) {
      const el = listRef.current.children[highlightedIdx] as HTMLElement | undefined;
      el?.scrollIntoView({ block: 'nearest' });
    }
  }, [highlightedIdx, open]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const openDropdown = () => {
    if (disabled) return;
    setOpen(true);
    setQuery('');
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const selectOption = useCallback((opt: SelectOption) => {
    onChange(opt.value);
    setOpen(false);
    setQuery('');
  }, [onChange]);

  const clearSelection = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange('');
    setQuery('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
        e.preventDefault();
        openDropdown();
      }
      return;
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightedIdx(i => Math.min(i + 1, filtered.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightedIdx(i => Math.max(i - 1, 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (filtered[highlightedIdx]) selectOption(filtered[highlightedIdx]);
        break;
      case 'Escape':
        setOpen(false);
        setQuery('');
        break;
    }
  };

  const baseInputClass =
    'w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500';

  return (
    <div ref={containerRef} className={clsx('relative', className)} onKeyDown={handleKeyDown}>
      {/* Trigger */}
      {!open ? (
        <button
          type="button"
          onClick={openDropdown}
          disabled={disabled}
          className={clsx(
            baseInputClass,
            'flex items-center justify-between text-left cursor-pointer',
            disabled && 'opacity-50 cursor-not-allowed bg-slate-50',
            !selectedOption && 'text-slate-400',
          )}
        >
          <span className="truncate">{selectedOption ? selectedOption.label : placeholder}</span>
          <div className="flex items-center gap-1 shrink-0 ml-2">
            {selectedOption && !required && (
              <X
                className="w-3.5 h-3.5 text-slate-400 hover:text-slate-700"
                onClick={clearSelection}
              />
            )}
            <ChevronDown className="w-4 h-4 text-slate-400" />
          </div>
        </button>
      ) : (
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={selectedOption ? selectedOption.label : placeholder}
          className={baseInputClass}
          autoComplete="off"
        />
      )}

      {/* Hidden native input for form validation */}
      <input
        type="text"
        value={value}
        required={required}
        readOnly
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
      />

      {/* Dropdown */}
      {open && (
        <ul
          ref={listRef}
          className="absolute z-50 mt-1 w-full max-h-56 overflow-y-auto bg-white border border-slate-200 rounded-lg shadow-lg text-sm"
        >
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-slate-400 text-center">{t('common.none')}</li>
          ) : (
            filtered.map((opt, idx) => (
              <li
                key={opt.value}
                onClick={() => selectOption(opt)}
                onMouseEnter={() => setHighlightedIdx(idx)}
                className={clsx(
                  'px-3 py-2 cursor-pointer truncate',
                  idx === highlightedIdx
                    ? 'bg-sky-50 text-sky-700'
                    : 'text-slate-700 hover:bg-slate-50',
                  opt.value === value && 'font-medium',
                )}
              >
                {opt.label}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
