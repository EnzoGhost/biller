import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Building2, ChevronRight } from 'lucide-react'
import Badge from '../components/Badge'
import { fetchOrganizations, createOrganization, type Organization } from '../lib/api'
import { formatDate, tierColor } from '../lib/utils'

export default function Organizations() {
  const [orgs, setOrgs] = useState<Organization[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName] = useState('')
  const [newTier, setNewTier] = useState<'free' | 'pro' | 'enterprise'>('free')
  const [creating, setCreating] = useState(false)

  async function load() {
    try {
      setOrgs(await fetchOrganizations())
    } catch {
      setError('Failed to load organizations')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!newName.trim()) return
    setCreating(true)
    try {
      await createOrganization({ name: newName.trim(), subscription_tier: newTier })
      setNewName('')
      setNewTier('free')
      setShowCreate(false)
      await load()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create organization')
    } finally {
      setCreating(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-slate-400 text-sm">Loading…</div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">Organizations</h1>
          <p className="text-slate-400 text-sm mt-1">{orgs.length} total</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 bg-sky-500 hover:bg-sky-600 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          <Plus size={15} />
          New Organization
        </button>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      {/* Create modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 w-full max-w-md">
            <h2 className="text-white font-semibold mb-4">Create Organization</h2>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-sm text-slate-400 mb-1.5">Organization Name</label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Acme Eye Clinic"
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-white text-sm placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-sky-500/50 focus:border-sky-500"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1.5">Subscription Tier</label>
                <select
                  value={newTier}
                  onChange={(e) => setNewTier(e.target.value as 'free' | 'pro' | 'enterprise')}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/50 focus:border-sky-500"
                >
                  <option value="free">Free</option>
                  <option value="pro">Pro</option>
                  <option value="enterprise">Enterprise</option>
                </select>
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreate(false)}
                  className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-medium py-2.5 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating || !newName.trim()}
                  className="flex-1 bg-sky-500 hover:bg-sky-600 disabled:opacity-50 text-white text-sm font-medium py-2.5 rounded-lg transition-colors"
                >
                  {creating ? 'Creating…' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden">
        {orgs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-500">
            <Building2 size={32} className="mb-3 opacity-50" />
            <p>No organizations yet</p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-800">
                <th className="text-left text-xs text-slate-500 font-medium px-5 py-3">Name</th>
                <th className="text-left text-xs text-slate-500 font-medium px-5 py-3">Tier</th>
                <th className="text-left text-xs text-slate-500 font-medium px-5 py-3">Users</th>
                <th className="text-left text-xs text-slate-500 font-medium px-5 py-3">Status</th>
                <th className="text-left text-xs text-slate-500 font-medium px-5 py-3">Created</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {orgs.map((org) => (
                <tr key={org.id} className="border-b border-slate-800/50 hover:bg-slate-800/30 transition-colors">
                  <td className="px-5 py-3.5">
                    <div className="text-white text-sm font-medium">{org.name}</div>
                    {org.slug && <div className="text-slate-500 text-xs">{org.slug}</div>}
                  </td>
                  <td className="px-5 py-3.5">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${tierColor(org.subscription_tier)}`}>
                      {org.subscription_tier}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-slate-300 text-sm">{org.user_count}</td>
                  <td className="px-5 py-3.5">
                    <Badge color={org.is_active ? 'green' : 'red'}>
                      {org.is_active ? 'Active' : 'Inactive'}
                    </Badge>
                  </td>
                  <td className="px-5 py-3.5 text-slate-400 text-sm">{formatDate(org.created_at)}</td>
                  <td className="px-5 py-3.5">
                    <Link
                      to={`/organizations/${org.id}`}
                      className="text-slate-400 hover:text-white transition-colors"
                    >
                      <ChevronRight size={16} />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
