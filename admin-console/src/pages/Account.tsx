import { useState, useEffect } from 'react'
import { fetchAdminMe, updateAdminMe, markAuthenticated } from '../lib/api'
import Toast from '../components/Toast'

export default function Account() {
  const [email, setEmail] = useState('')
  const [fullName, setFullName] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)

  useEffect(() => {
    fetchAdminMe().then(me => {
      setEmail(me.email)
      setFullName(me.full_name)
    }).catch(() => {})
  }, [])

  const handleSaveProfile = async () => {
    setLoading(true)
    try {
      const result = await updateAdminMe({ email, full_name: fullName })
      if (result.token) markAuthenticated(result.token, result.email)
      setToast({ message: 'Profile updated', type: 'success' })
    } catch (e: any) {
      setToast({ message: e.message || 'Failed to update', type: 'error' })
    } finally {
      setLoading(false)
    }
  }

  const handleChangePassword = async () => {
    if (newPassword !== confirmPassword) {
      setToast({ message: 'Passwords do not match', type: 'error' })
      return
    }
    if (newPassword.length < 8) {
      setToast({ message: 'Password must be at least 8 characters', type: 'error' })
      return
    }
    setLoading(true)
    try {
      const result = await updateAdminMe({ current_password: currentPassword, new_password: newPassword })
      if (result.token) markAuthenticated(result.token, result.email)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setToast({ message: 'Password changed', type: 'success' })
    } catch (e: any) {
      setToast({ message: e.message || 'Failed to change password', type: 'error' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      <div>
        <h1 className="text-2xl font-bold text-white mb-1">My Account</h1>
        <p className="text-sm text-slate-400">Manage your admin account settings</p>
      </div>

      {/* Profile */}
      <div className="bg-slate-800 border border-slate-700 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-white mb-4">Profile</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Email</label>
            <input
              type="email" value={email} onChange={e => setEmail(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-sky-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Full Name</label>
            <input
              type="text" value={fullName} onChange={e => setFullName(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-sky-500"
            />
          </div>
          <button
            onClick={handleSaveProfile} disabled={loading}
            className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
          >
            Save Profile
          </button>
        </div>
      </div>

      {/* Change Password */}
      <div className="bg-slate-800 border border-slate-700 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-white mb-4">Change Password</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Current Password</label>
            <input
              type="password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-sky-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">New Password</label>
            <input
              type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-sky-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Confirm New Password</label>
            <input
              type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-sky-500"
            />
          </div>
          <button
            onClick={handleChangePassword} disabled={loading || !currentPassword || !newPassword}
            className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
          >
            Change Password
          </button>
        </div>
      </div>
    </div>
  )
}
