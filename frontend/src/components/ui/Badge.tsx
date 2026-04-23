import clsx from 'clsx';
import type { ClaimStatus } from '../../types';

const STATUS_STYLES: Record<ClaimStatus, string> = {
  draft:     'bg-slate-100 text-slate-600',
  ready:     'bg-blue-50 text-blue-700',
  submitted: 'bg-sky-100 text-sky-700',
  accepted:  'bg-teal-50 text-teal-700',
  rejected:  'bg-red-50 text-red-700',
  paid:      'bg-emerald-50 text-emerald-700',
  denied:    'bg-rose-100 text-rose-700',
  appealed:  'bg-amber-50 text-amber-700',
  void:      'bg-slate-50 text-slate-400',
};

const STATUS_LABELS_ES: Record<ClaimStatus, string> = {
  draft:     'Borrador',
  ready:     'Lista',
  submitted: 'Sometida',
  accepted:  'Aceptada',
  rejected:  'Rechazada',
  paid:      'Pagada',
  denied:    'Denegada',
  appealed:  'Apelada',
  void:      'Anulada',
};

interface Props {
  status: ClaimStatus;
  lang?: 'es' | 'en';
}

export default function StatusBadge({ status, lang = 'es' }: Props) {
  const label = lang === 'es' ? STATUS_LABELS_ES[status] : status.charAt(0).toUpperCase() + status.slice(1);
  return (
    <span className={clsx('inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium', STATUS_STYLES[status])}>
      {label}
    </span>
  );
}
