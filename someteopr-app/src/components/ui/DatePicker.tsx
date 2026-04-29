/**
 * Beautiful custom DatePicker with calendar popup.
 * Locale-aware: displays month names in EN or ES.
 * Works with ISO strings internally, shows human-friendly format.
 */
import { useState, useRef, useEffect } from 'react';
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
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

const MONTHS_EN = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];
const MONTHS_ES = [
  'enero','febrero','marzo','abril','mayo','junio',
  'julio','agosto','septiembre','octubre','noviembre','diciembre',
];
const DAYS_EN = ['Su','Mo','Tu','We','Th','Fr','Sa'];
const DAYS_ES = ['Do','Lu','Ma','Mi','Ju','Vi','Sa'];

function toISO(value: string | Date | null | undefined): string {
  if (!value) return '';
  if (value instanceof Date) return value.toISOString().split('T')[0];
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.substring(0, 10);
  return '';
}

function formatDisplay(iso: string, lang: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  const months = lang.startsWith('es') ? MONTHS_ES : MONTHS_EN;
  if (lang.startsWith('es')) return `${d} de ${months[m - 1]} de ${y}`;
  return `${months[m - 1]} ${d}, ${y}`;
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
  const { i18n } = useTranslation();
  const lang = i18n.language || 'en';

  const isoValue = toISO(value);
  const displayValue = formatDisplay(isoValue, lang);

  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const today = new Date();
  const todayISO = today.toISOString().split('T')[0];

  const init = isoValue ? new Date(isoValue + 'T12:00:00') : today;
  const [viewYear, setViewYear] = useState(init.getFullYear());
  const [viewMonth, setViewMonth] = useState(init.getMonth());

  useEffect(() => {
    if (isoValue) {
      const d = new Date(isoValue + 'T12:00:00');
      setViewYear(d.getFullYear());
      setViewMonth(d.getMonth());
    }
  }, [isoValue]);

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

  const months = lang.startsWith('es') ? MONTHS_ES : MONTHS_EN;
  const days = lang.startsWith('es') ? DAYS_ES : DAYS_EN;

  const prevMonth = () => {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); }
    else setViewMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); }
    else setViewMonth(m => m + 1);
  };

  const selectDay = (day: number) => {
    const m = String(viewMonth + 1).padStart(2, '0');
    const d = String(day).padStart(2, '0');
    onChange(`${viewYear}-${m}-${d}`);
    setOpen(false);
  };

  const isDisabled = (day: number) => {
    const m = String(viewMonth + 1).padStart(2, '0');
    const d = String(day).padStart(2, '0');
    const iso = `${viewYear}-${m}-${d}`;
    if (min && iso < min) return true;
    if (max && iso > max) return true;
    return false;
  };

  const firstDayOfMonth = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

  // Build grid cells
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDayOfMonth; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') setOpen(false);
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(v => !v); }
  };

  const labelClass = 'block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1';

  return (
    <div className={clsx('relative', className)} ref={containerRef}>
      {label && (
        <label className={labelClass}>
          {label}
          {required && <span className="text-red-500 ml-0.5">*</span>}
        </label>
      )}
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen(v => !v)}
        onKeyDown={handleKeyDown}
        className={clsx(
          'flex items-center gap-2 w-full px-3 py-2 rounded-lg border text-sm transition-colors text-left',
          open
            ? 'border-sky-400 ring-2 ring-sky-100'
            : error
              ? 'border-red-300 bg-red-50'
              : 'border-slate-200 hover:border-slate-300 bg-white',
          disabled && 'opacity-50 cursor-not-allowed bg-slate-50',
        )}
      >
        <Calendar size={16} className="text-slate-400 shrink-0" />
        <span className={clsx('flex-1', displayValue ? 'text-slate-900' : 'text-slate-400')}>
          {displayValue || placeholder || (lang.startsWith('es') ? 'Seleccionar fecha' : 'Select date')}
        </span>
      </button>

      {/* Hidden native input for required form validation */}
      {required && (
        <input
          type="text"
          value={isoValue}
          required
          readOnly
          tabIndex={-1}
          className="absolute opacity-0 w-0 h-0 pointer-events-none"
        />
      )}

      {open && (
        <div className="absolute z-50 top-full mt-1.5 left-0 bg-white rounded-xl border border-slate-200 shadow-2xl p-3 w-72">
          {/* Header */}
          <div className="flex items-center justify-between mb-3">
            <button type="button" onClick={prevMonth} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-600 transition-colors">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-sm font-semibold text-slate-800">
              {months[viewMonth]} {viewYear}
            </span>
            <button type="button" onClick={nextMonth} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-600 transition-colors">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* Day name headers */}
          <div className="grid grid-cols-7 mb-1">
            {days.map(d => (
              <div key={d} className="text-center text-xs font-medium text-slate-400 py-1">{d}</div>
            ))}
          </div>

          {/* Calendar grid */}
          <div className="grid grid-cols-7 gap-0.5">
            {cells.map((day, i) => {
              if (!day) return <div key={`e-${i}`} />;
              const m = String(viewMonth + 1).padStart(2, '0');
              const d = String(day).padStart(2, '0');
              const iso = `${viewYear}-${m}-${d}`;
              const isToday = iso === todayISO;
              const isSelected = iso === isoValue;
              const isDis = isDisabled(day);
              return (
                <button
                  key={`d-${day}`}
                  type="button"
                  disabled={isDis}
                  onClick={() => selectDay(day)}
                  className={clsx(
                    'h-8 w-full rounded-lg text-xs font-medium transition-colors',
                    isSelected && 'bg-sky-500 text-white shadow-sm',
                    !isSelected && isToday && 'bg-sky-50 text-sky-600 font-bold ring-1 ring-sky-200',
                    !isSelected && !isToday && !isDis && 'hover:bg-slate-100 text-slate-700',
                    isDis && 'opacity-30 cursor-not-allowed text-slate-300',
                  )}
                >
                  {day}
                </button>
              );
            })}
          </div>

          {/* Today shortcut */}
          <div className="mt-2 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={() => { onChange(todayISO); setOpen(false); }}
              className="w-full text-xs text-sky-600 hover:text-sky-700 font-medium py-1.5 hover:bg-sky-50 rounded-lg transition-colors"
            >
              {lang.startsWith('es') ? 'Hoy' : 'Today'}
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
    </div>
  );
}
