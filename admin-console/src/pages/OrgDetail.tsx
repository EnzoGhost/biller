import { useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { ArrowLeft, Save, Users } from 'lucide-react'
import Badge from '../components/Badge'
import {
  fetchOrganization,
  updateOrganization,
  updateSubscription,
  type OrgDetail as OrgDetailType,
} from '../lib/api'
import { formatDate, tierColor } from '../lib/utils'

export default function OrgDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [org, setOrg] = useState<OrgDetailType | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Edit state
  const [editName, setEditName] = useState('')
  const [editNotes, setEditNotes] = useState('')
  const [editActive, setEditActive] = useState(true)
  const [editTier, setEditTier] = useState('free')
  const [editExpires, setEditExpires] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')

  async function load() {
    try {
      const data = await fetchOrganization(Number(id))
      setOrg(data)
      setEditName(data.name)
      setEditNotes(data.notes || '')
      setEditActive(data.is_active)
      setEditTier(data.subscription_tier)
      setEditExpires(data.subscription_expires_at ? data.subscription_expires_at.slice(0, 10) : '')
    } catch {
      setError('Failed to load organization')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [id])

  async function handleSave() {
    if (!org) return
    setSaving(true)
    setError(null)
    try {
      await updateOrganization(org.id, {
        name: editName,
        is_active: editActive,
        notes: editNotes,
      })
      await updateSubscription(
        org.id,
        editTier,
        editExpires ? editExpires : null
      )
      setSaveMsg('Saved!')
      setTimeout(() => setSaveMsg(''), 2000)
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

  if (!org) {
    return (
      <div className="text-center text-slate-400 mt-16">
        <p>Organization not found</p>
        <Link to="/organizations" className="text-sky-400 hover:text-sky-300 text-sm mt-2 inline-block">
          Back to Organizations
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate('/organizations')}
          className="text-slate-400 hover:text-white transition-colors"
        >
          <ArrowLeft size={18} />
        </button>
        <div>
          <h1 className="text-2xl font-semibold text-white">{org.name}</h1>
          <p className="text-slate-400 text-sm mt-0.5">Organization details</p>
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Details form */}
        <div className="bg-slate-900 rounded-xl border border-slate-800 p-6 space-y-4">
          <h2 className="text-white font-medium">Organization Details</h2>

          <div>
            <label className="block text-sm text-slate-400 mb-1.5">Name</label>
            <input
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/50 focus:border-sky-500"
            />
          </div>

          <div>
            <label className="block text-sm text-slate-400 mb-1.5">Notes</label>
            <textarea
              value={editNotes}
              onChange={(e) => setEditNotes(e.target.value)}
              rows={3}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/50 focus:border-sky-500 resize-none"
              placeholder="Internal notes…"
            />
          </div>

          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="active"
              checked={editActive}
              onChange={(e) => setEditActive(e.target.checked)}
              className="accent-sky-500"
            />
            <label htmlFor="active" className="text-sm text-slate-300">Active</label>
          </div>

          <div className="text-xs text-slate-500">
            Created {formatDate(org.created_at)} · Slug: {org.slug || '—'}
          </div>
        </div>

        {/* Subscription form */}
        <div className="bg-slate-900 rounded-xl border border-slate-800 p-6 space-y-4">
          <h2 className="text-white font-medium">Subscription</h2>

          <div>
            <label className="block text-sm text-slate-400 mb-1.5">Tier</label>
            <select
              value={editTier}
              onChange={(e) => setEditTier(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/50 focus:border-sky-500"
            >
              <option value="free">Free</option>
              <option value="pro">Pro</option>
              <option value="enterprise">Enterprise</option>
            </select>
          </div>

          <div>
            <label className="block text-sm text-slate-400 mb-1.5">Expires At (optional)</label>
            <input
              type="date"
              value={editExpires}
              onChange={(e) => setEditExpires(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/50 focus:border-sky-500"
            />
            <p className="text-xs text-slate-500 mt-1">Leave blank for no expiration</p>
          </div>

          <div className="pt-1">
            <span className={`inline-flex items-center px-2.5 py-1 rounded text-sm font-medium ${tierColor(editTier)}`}>
              {editTier.charAt(0).toUpperCase() + editTier.slice(1)}
            </span>
          </div>

          <div className="text-xs text-slate-500">
            Stripe Customer ID: {org.stripe_customer_id || '—'}
            <br />
            <span className="text-slate-600">(Stripe integration placeholder)</span>
          </div>
        </div>
      </div>

      {/* Save button */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 bg-sky-500 hover:bg-sky-600 disabled:opacity-50 text-white text-sm font-medium px-5 py-2.5 rounded-lg transition-colors"
        >
          <Save size={15} />
          {saving ? 'Saving…' : 'Save Changes'}
        </button>
        {saveMsg && <span className="text-emerald-400 text-sm">{saveMsg}</span>}
      </div>

      {/* Users in this org */}
      <div className="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-4 border-b border-slate-800">
          <Users size={16} className="text-slate-400" />
          <h2 className="text-white font-medium text-sm">Users ({org.users.length})</h2>
        </div>
        {org.users.length === 0 ? (
          <div className="py-8 text-center text-slate-500 text-sm">No users in this organization</div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-800">
                <th className="text-left text-xs text-slate-500 font-medium px-5 py-3">Name</th>
                <th className="text-left text-xs text-slate-500 font-medium px-5 py-3">Email</th>
                <th className="text-left text-xs text-slate-500 font-medium px-5 py-3">Role</th>
                <th className="text-left text-xs text-slate-500 font-medium px-5 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {org.users.map((u) => (
                <tr key={u.id} className="border-b border-slate-800/50">
                  <td className="px-5 py-3 text-white text-sm">{u.full_name}</td>
                  <td className="px-5 py-3 text-slate-400 text-sm">{u.email}</td>
                  <td className="px-5 py-3 text-slate-400 text-sm capitalize">{u.role}</td>
                  <td className="px-5 py-3">
                    <Badge color={u.is_active ? 'green' : 'red'}>
                      {u.is_active ? 'Active' : 'Inactive'}
                    </Badge>
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
