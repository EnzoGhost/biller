/**
 * Date formatting utilities — bilingual (English / Spanish).
 *
 * IMPORTANT: Date-only strings ("2026-04-29") are parsed as LOCAL dates,
 * not UTC. This prevents the off-by-one-day timezone bug.
 */
import i18n from '../i18n';

/** Parse a date string safely — date-only strings as LOCAL, not UTC */
function parseDate(date: string | Date): Date {
  if (date instanceof Date) return date;
  // If it's a date-only string (YYYY-MM-DD), parse as local to avoid timezone shift
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const [y, m, d] = date.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  return new Date(date);
}

/** Full human date: "April 23, 2026" / "23 de abril de 2026" */
export function formatDate(date: string | Date | null | undefined): string {
  if (!date) return '—';
  const d = parseDate(date);
  if (isNaN(d.getTime())) return '—';
  const locale = i18n.language === 'es' ? 'es-PR' : 'en-US';
  return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long', day: 'numeric' }).format(d);
}

/** Short date: "Apr 23, 2026" / "23 abr 2026" */
export function formatDateShort(date: string | Date | null | undefined): string {
  if (!date) return '—';
  const d = parseDate(date);
  if (isNaN(d.getTime())) return '—';
  const locale = i18n.language === 'es' ? 'es-PR' : 'en-US';
  return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric' }).format(d);
}

/** Date + time: "April 23, 2026 at 5:30 PM" */
export function formatDateTime(date: string | Date | null | undefined): string {
  if (!date) return '—';
  const d = parseDate(date);
  if (isNaN(d.getTime())) return '—';
  const locale = i18n.language === 'es' ? 'es-PR' : 'en-US';
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric', month: 'long', day: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(d);
}

/** Relative time: "3 days ago" / "hace 3 días" */
export function formatRelative(date: string | Date | null | undefined): string {
  if (!date) return '—';
  const d = parseDate(date);
  if (isNaN(d.getTime())) return '—';
  const locale = i18n.language === 'es' ? 'es-PR' : 'en-US';
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const diffMs = d.getTime() - Date.now();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
  if (Math.abs(diffDays) < 1) {
    const diffHours = Math.round(diffMs / (1000 * 60 * 60));
    if (Math.abs(diffHours) < 1) {
      const diffMins = Math.round(diffMs / (1000 * 60));
      return rtf.format(diffMins, 'minute');
    }
    return rtf.format(diffHours, 'hour');
  }
  if (Math.abs(diffDays) < 30) return rtf.format(diffDays, 'day');
  const diffMonths = Math.round(diffDays / 30);
  return rtf.format(diffMonths, 'month');
}

/** ISO date string for form inputs: "2026-04-23" */
export function toISODate(date: string | Date | null | undefined): string {
  if (!date) return '';
  const d = parseDate(date);
  if (isNaN(d.getTime())) return '';
  // Use local date components to avoid UTC shift
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
