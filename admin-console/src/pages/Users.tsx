import { useEffect, useState } from 'react'
import { Plus, Users as UsersIcon, KeyRound } from 'lucide-react'
import Badge from '../components/Badge'
import {
  fetchUsers,
  fetchOrganizations,
  createUser,
  updateUser,
  resetUserPassword,
  type AdminUser,
  type Organization,
} from '../lib/api'
import { formatDate } from '../lib/utils'

export default function Users() {
  const [users, setUsers] = useState<AdminUser[]>([])
  const [orgs, setOrgs] = useState<Organization[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [resetModal, setResetModal] = useState<AdminUser | null>(null)

  // Create form
  const [newEmail, setNewEmail] = useState('')
  const [newName, setNewName] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newRole, setNewRole] = useState('admin')
  const [newOrgId, setNewOrgId] = useState<number | ''>('')
  const [creating, setCreating] = useState(false)

  // Reset form
  const [resetPw, setResetPw] = useState('')
  const [resetting, setResetting] = useState(false)
  const [resetMsg, setResetMsg] = useState('')

  async function load() {
    try {
      const [u, o] = await Promise.all([fetchUsers(), fetchOrganizations()])
      setUsers(u)
      setOrgs(o)
    } catch {
      setError('Failed to load users')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!newEmail.trim() || !newName.trim() || !newPassword.trim()) return
    setCreating(true)
    setError(null)
    try {
      await createUser({
        email: newEmail.trim(),
        full_name: newName.trim(),
        password: newPassword,
        role: newRole,
        organization_id: newOrgId ? Number(newOrgId) : null,
      })
      setNewEmail(''); setNewName(''); setNewPassword('')
      setNewRole('admin'); setNewOrgId('')
      setShowCreate(false)
      await load()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create user')
    } finally {
      setCreating(false)
    }
  }

  async function toggleActive(user: AdminUser) {
    try {
      await updateUser(user.id, { is_active: !user.is_active })
      await load()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to update user')
    }
  }

  async function handleReset(e: React.FormEvent) {
    e.preventDefault()
    if (!resetModal || !resetPw.trim()) return
    setResetting(true)
    setResetMsg('')
    try {
      await resetUserPassword(resetModal.id, resetPw)
      setResetMsg('Password reset!')
      setResetPw('')
      setTimeout(() => { setResetModal(null); setResetMsg('') }, 1500)
    } catch (err: unknown) {
      setResetMsg(err instanceof Error ? err.message : 'Failed to reset password')
    } finally {
      setResetting(false)
    }
  }

  const orgMap = Object.fromEntries(orgs.map((o) => [o.id, o.name]))

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
          <h1 className="text-2xl font-semibold text-white">Users</h1>
          <p className="text-slate-400 text-sm mt-1">{users.length} total</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 bg-sky-500 hover:bg-sky-600 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          <Plus size={15} />
          New User
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
            <h2 className="text-white font-semibold mb-4">Create User</h2>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-sm text-slate-400 mb-1.5">Email</label>
                <input type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/50 focus:border-sky-500"
                  placeholder="user@example.com" required />
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1.5">Full Name</label>
                <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/50 focus:border-sky-500"
                  placeholder="Jane Doe" required />
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1.5">Password</label>
                <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/50 focus:border-sky-500"
                  placeholder="••••••••" required />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-slate-400 mb-1.5">Role</label>
                  <select value={newRole} onChange={(e) => setNewRole(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/50">
                    <option value="admin">Admin</option>
                    <option value="biller">Biller</option>
                    <option value="provider">Provider</option>
                    <option value="viewer">Viewer</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-slate-400 mb-1.5">Organization</label>
                  <select value={newOrgId} onChange={(e) => setNewOrgId(e.target.value ? Number(e.target.value) : '')}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/50">
                    <option value="">None</option>
                    {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                </div>
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowCreate(false)}
                  className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-medium py-2.5 rounded-lg transition-colors">
                  Cancel
                </button>
                <button type="submit" disabled={creating}
                  className="flex-1 bg-sky-500 hover:bg-sky-600 disabled:opacity-50 text-white text-sm font-medium py-2.5 rounded-lg transition-colors">
                  {creating ? 'Creating…' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reset password modal */}
      {resetModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 w-full max-w-sm">
            <h2 className="text-white font-semibold mb-1">Reset Password</h2>
            <p className="text-slate-400 text-sm mb-4">{resetModal.email}</p>
            <form onSubmit={handleReset} className="space-y-4">
              <div>
                <label className="block text-sm text-slate-400 mb-1.5">New Password</label>
                <input type="password" value={resetPw} onChange={(e) => setResetPw(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/50 focus:border-sky-500"
                  placeholder="New password" autoFocus required />
              </div>
              {resetMsg && (
                <p className={resetMsg.includes('!') ? 'text-emerald-400 text-sm' : 'text-red-400 text-sm'}>
                  {resetMsg}
                </p>
              )}
              <div className="flex gap-3">
                <button type="button" onClick={() => { setResetModal(null); setResetPw(''); setResetMsg('') }}
                  className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-medium py-2.5 rounded-lg transition-colors">
                  Cancel
                </button>
                <button type="submit" disabled={resetting || !resetPw.trim()}
                  className="flex-1 bg-sky-500 hover:bg-sky-600 disabled:opacity-50 text-white text-sm font-medium py-2.5 rounded-lg transition-colors">
                  {resetting ? 'Resetting…' : 'Reset'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden">
        {users.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-500">
            <UsersIcon size={32} className="mb-3 opacity-50" />
            <p>No users yet</p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-800">
                <th className="text-left text-xs text-slate-500 font-medium px-5 py-3">Name</th>
                <th className="text-left text-xs text-slate-500 font-medium px-5 py-3">Email</th>
                <th className="text-left text-xs text-slate-500 font-medium px-5 py-3">Role</th>
                <th className="text-left text-xs text-slate-500 font-medium px-5 py-3">Organization</th>
                <th className="text-left text-xs text-slate-500 font-medium px-5 py-3">Status</th>
                <th className="text-left text-xs text-slate-500 font-medium px-5 py-3">Created</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-slate-800/50 hover:bg-slate-800/30 transition-colors">
                  <td className="px-5 py-3.5 text-white text-sm font-medium">{u.full_name}</td>
                  <td className="px-5 py-3.5 text-slate-400 text-sm">{u.email}</td>
                  <td className="px-5 py-3.5 text-slate-400 text-sm capitalize">{u.role}</td>
                  <td className="px-5 py-3.5 text-slate-400 text-sm">
                    {u.organization_id ? (orgMap[u.organization_id] || `Org #${u.organization_id}`) : '—'}
                  </td>
                  <td className="px-5 py-3.5">
                    <button onClick={() => toggleActive(u)}>
                      <Badge color={u.is_active ? 'green' : 'red'}>
                        {u.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </button>
                  </td>
                  <td className="px-5 py-3.5 text-slate-400 text-sm">{formatDate(u.created_at)}</td>
                  <td className="px-5 py-3.5">
                    <button
                      onClick={() => setResetModal(u)}
                      className="text-slate-500 hover:text-slate-300 transition-colors"
                      title="Reset password"
                    >
                      <KeyRound size={15} />
                    </button>
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
