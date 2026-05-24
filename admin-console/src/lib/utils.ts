export function formatNumber(n: number): string {
  return n.toLocaleString()
}

export function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function tierColor(tier: string): string {
  switch (tier) {
    case 'enterprise': return 'text-violet-400 bg-violet-500/10 border border-violet-500/20'
    case 'pro': return 'text-sky-400 bg-sky-500/10 border border-sky-500/20'
    default: return 'text-slate-400 bg-slate-500/10 border border-slate-500/20'
  }
}
