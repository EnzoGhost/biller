import type { LucideIcon } from 'lucide-react'

interface Props {
  title: string
  value: string | number
  icon: LucideIcon
  color?: string
  sub?: string
}

export default function StatCard({ title, value, icon: Icon, color = 'sky', sub }: Props) {
  const colorMap: Record<string, string> = {
    sky: 'text-sky-400 bg-sky-500/10',
    emerald: 'text-emerald-400 bg-emerald-500/10',
    violet: 'text-violet-400 bg-violet-500/10',
    orange: 'text-orange-400 bg-orange-500/10',
    rose: 'text-rose-400 bg-rose-500/10',
  }
  const iconClass = colorMap[color] || colorMap.sky

  return (
    <div className="bg-slate-900 rounded-xl border border-slate-800 p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-slate-400 text-sm">{title}</p>
          <p className="text-2xl font-semibold text-white mt-1">{value}</p>
          {sub && <p className="text-slate-500 text-xs mt-1">{sub}</p>}
        </div>
        <div className={`p-2.5 rounded-lg ${iconClass}`}>
          <Icon size={18} />
        </div>
      </div>
    </div>
  )
}
