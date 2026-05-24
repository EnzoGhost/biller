import { useEffect, useState } from 'react'
import { Stethoscope, Search } from 'lucide-react'
import Badge from '../components/Badge'
import { fetchProviders, type AdminProvider } from '../lib/api'
import { formatDate, formatNumber } from '../lib/utils'

export default function Providers() {
  const [providers, setProviders] = useState<AdminProvider[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  useEffect(() => {
    fetchProviders()
      .then(setProviders)
      .catch(() => setError('Failed to load providers'))
      .finally(() => setLoading(false))
  }, [])

  const filtered = providers.filter((p) => {
    const q = search.toLowerCase()
    return (
      p.full_name.toLowerCase().includes(q) ||
      p.npi.includes(q) ||
      (p.specialty || '').toLowerCase().includes(q)
    )
  })

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-slate-400 text-sm">Loading…</div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-white">Providers</h1>
        <p className="text-slate-400 text-sm mt-1">{formatNumber(providers.length)} total providers (read-only)</p>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      {/* Search */}
      <div className="relative max-w-sm">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, NPI, specialty…"
          className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-9 pr-4 py-2.5 text-white text-sm placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-sky-500/50 focus:border-sky-500"
        />
      </div>

      <div className="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-500">
            <Stethoscope size={32} className="mb-3 opacity-50" />
            <p>{search ? 'No matching providers' : 'No providers yet'}</p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-800">
                <th className="text-left text-xs text-slate-500 font-medium px-5 py-3">Provider</th>
                <th className="text-left text-xs text-slate-500 font-medium px-5 py-3">NPI</th>
                <th className="text-left text-xs text-slate-500 font-medium px-5 py-3">Specialty</th>
                <th className="text-left text-xs text-slate-500 font-medium px-5 py-3">Location</th>
                <th className="text-left text-xs text-slate-500 font-medium px-5 py-3">Claims</th>
                <th className="text-left text-xs text-slate-500 font-medium px-5 py-3">Status</th>
                <th className="text-left text-xs text-slate-500 font-medium px-5 py-3">Added</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id} className="border-b border-slate-800/50 hover:bg-slate-800/30 transition-colors">
                  <td className="px-5 py-3.5 text-white text-sm font-medium">{p.full_name}</td>
                  <td className="px-5 py-3.5">
                    <span className="text-slate-300 text-sm font-mono">{p.npi}</span>
                  </td>
                  <td className="px-5 py-3.5 text-slate-400 text-sm">{p.specialty || '—'}</td>
                  <td className="px-5 py-3.5 text-slate-400 text-sm">
                    {p.city ? `${p.city}, ${p.state}` : (p.state || '—')}
                  </td>
                  <td className="px-5 py-3.5 text-slate-300 text-sm">{formatNumber(p.claim_count)}</td>
                  <td className="px-5 py-3.5">
                    <Badge color={p.is_active ? 'green' : 'red'}>
                      {p.is_active ? 'Active' : 'Inactive'}
                    </Badge>
                  </td>
                  <td className="px-5 py-3.5 text-slate-400 text-sm">{formatDate(p.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
