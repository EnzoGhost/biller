import { useEffect, useState } from 'react'
import { CreditCard, Edit2, Check, X } from 'lucide-react'
import { fetchOrganizations, updateSubscription, type Organization } from '../lib/api'
import { formatDate, tierColor } from '../lib/utils'

export default function Subscriptions() {
  const [orgs, setOrgs] = useState<Organization[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<number | null>(null)
  const [editTier, setEditTier] = useState('')
  const [editExpires, setEditExpires] = useState('')
  const [saving, setSaving] = useState(false)

  async function load() {
    try {
      setOrgs(await fetchOrganizations())
    } catch {
      setError('Failed to load subscriptions')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  function startEdit(org: Organization) {
    setEditing(org.id)
    setEditTier(org.subscription_tier)
    setEditExpires(org.subscription_expires_at ? org.subscription_expires_at.slice(0, 10) : '')
  }

  async function saveEdit(orgId: number) {
    setSaving(true)
    setError(null)
    try {
      await updateSubscription(orgId, editTier, editExpires || null)
      setEditing(null)
      await load()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
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
      <div>
        <h1 className="text-2xl font-semibold text-white">Subscriptions</h1>
        <p className="text-slate-400 text-sm mt-1">Manage subscription tiers per organization</p>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      <div className="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden">
        {orgs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-500">
            <CreditCard size={32} className="mb-3 opacity-50" />
            <p>No organizations yet</p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-800">
                <th className="text-left text-xs text-slate-500 font-medium px-5 py-3">Organization</th>
                <th className="text-left text-xs text-slate-500 font-medium px-5 py-3">Tier</th>
                <th className="text-left text-xs text-slate-500 font-medium px-5 py-3">Expires</th>
                <th className="text-left text-xs text-slate-500 font-medium px-5 py-3">Status</th>
                <th className="text-left text-xs text-slate-500 font-medium px-5 py-3">Stripe</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {orgs.map((org) => {
                const isEditing = editing === org.id
                const expired =
                  org.subscription_expires_at &&
                  new Date(org.subscription_expires_at) < new Date()

                return (
                  <tr key={org.id} className="border-b border-slate-800/50 hover:bg-slate-800/30 transition-colors">
                    <td className="px-5 py-3.5">
                      <div className="text-white text-sm font-medium">{org.name}</div>
                    </td>
                    <td className="px-5 py-3.5">
                      {isEditing ? (
                        <select
                          value={editTier}
                          onChange={(e) => setEditTier(e.target.value)}
                          className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-white text-xs focus:outline-none focus:ring-1 focus:ring-sky-500"
                        >
                          <option value="free">Free</option>
                          <option value="pro">Pro</option>
                          <option value="enterprise">Enterprise</option>
                        </select>
                      ) : (
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${tierColor(org.subscription_tier)}`}>
                          {org.subscription_tier}
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3.5">
                      {isEditing ? (
                        <input
                          type="date"
                          value={editExpires}
                          onChange={(e) => setEditExpires(e.target.value)}
                          className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-white text-xs focus:outline-none focus:ring-1 focus:ring-sky-500"
                        />
                      ) : (
                        <span className={`text-sm ${expired ? 'text-rose-400' : 'text-slate-400'}`}>
                          {org.subscription_expires_at ? formatDate(org.subscription_expires_at) : '—'}
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3.5">
                      <span className={`text-xs ${!org.is_active ? 'text-rose-400' : expired ? 'text-amber-400' : 'text-emerald-400'}`}>
                        {!org.is_active ? 'Deactivated' : expired ? 'Expired' : 'Active'}
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="text-xs text-slate-600 italic">Pending</span>
                    </td>
                    <td className="px-5 py-3.5">
                      {isEditing ? (
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => saveEdit(org.id)}
                            disabled={saving}
                            className="text-emerald-400 hover:text-emerald-300 transition-colors disabled:opacity-50"
                          >
                            <Check size={15} />
                          </button>
                          <button
                            onClick={() => setEditing(null)}
                            className="text-slate-500 hover:text-slate-300 transition-colors"
                          >
                            <X size={15} />
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => startEdit(org)}
                          className="text-slate-500 hover:text-slate-300 transition-colors"
                        >
                          <Edit2 size={15} />
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="bg-slate-900/50 rounded-xl border border-slate-800 p-5">
        <div className="flex items-start gap-3">
          <CreditCard size={16} className="text-slate-500 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-slate-400 text-sm font-medium">Stripe Integration</p>
            <p className="text-slate-500 text-xs mt-1">
              Stripe billing is not yet connected. Subscription tiers can be managed manually above.
              When ready, connect Stripe to automate billing and sync subscription status.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
