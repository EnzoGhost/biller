/**
 * Beautiful date picker with bilingual labels.
 * Uses native date input styled to match our theme.
 * Displays the selected date in human-readable format.
 */
import { useState, useRef } from 'react';
import { Calendar } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatDate, toISODate } from '../../lib/dates';
import { clsx } from 'clsx';

interface DatePickerProps {
  value: string | Date | null | undefined;
  onChange: (date: string) => void;
  label?: string;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  min?: string;
  max?: string;
  className?: string;
  error?: string;
}

export default function DatePicker({
  value,
  onChange,
  label,
  placeholder,
  required,
  disabled,
  min,
  max,
  className,
  error,
}: DatePickerProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);

  const isoValue = toISODate(value);
  const displayValue = value ? formatDate(value) : '';

  return (
    <div className={clsx('flex flex-col gap-1', className)}>
      {label && (
        <label className="text-sm font-medium text-slate-700">
          {label}
          {required && <span className="text-red-500 ml-0.5">*</span>}
        </label>
      )}
      <div className="relative">
        {/* Visible display field */}
        <div
          onClick={() => !disabled && inputRef.current?.showPicker?.()}
          className={clsx(
            'flex items-center gap-2 px-3 py-2 rounded-lg border text-sm cursor-pointer transition-colors',
            focused
              ? 'border-sky-400 ring-2 ring-sky-100'
              : error
                ? 'border-red-300 bg-red-50'
                : 'border-slate-200 hover:border-slate-300',
            disabled && 'opacity-50 cursor-not-allowed bg-slate-50',
          )}
        >
          <Calendar size={16} className="text-slate-400 shrink-0" />
          <span className={clsx(displayValue ? 'text-slate-900' : 'text-slate-400')}>
            {displayValue || placeholder || t('common.select_date', 'Seleccionar fecha')}
          </span>
        </div>
        {/* Hidden native input for actual date picking */}
        <input
          ref={inputRef}
          type="date"
          value={isoValue}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          min={min}
          max={max}
          required={required}
          disabled={disabled}
          className="absolute inset-0 opacity-0 cursor-pointer"
          tabIndex={-1}
        />
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
