interface Props {
  children: React.ReactNode
  color?: string
  className?: string
}

const colorMap: Record<string, string> = {
  green: 'text-emerald-400 bg-emerald-500/10 border border-emerald-500/20',
  red: 'text-rose-400 bg-rose-500/10 border border-rose-500/20',
  yellow: 'text-amber-400 bg-amber-500/10 border border-amber-500/20',
  sky: 'text-sky-400 bg-sky-500/10 border border-sky-500/20',
  violet: 'text-violet-400 bg-violet-500/10 border border-violet-500/20',
  slate: 'text-slate-400 bg-slate-500/10 border border-slate-500/20',
}

export default function Badge({ children, color = 'slate', className = '' }: Props) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${colorMap[color] || colorMap.slate} ${className}`}
    >
      {children}
    </span>
  )
}
