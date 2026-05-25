import { useState } from 'react';
import { useAuthStore } from '../hooks/useAuth';
import api from '../lib/api';

export default function AccountPage() {
  const { user, setUser } = useAuthStore();
  const [name, setName] = useState(user?.full_name ?? '');
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [saving, setSaving] = useState(false);
  const [changingPw, setChangingPw] = useState(false);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3000);
  };

  const handleSaveProfile = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const { data } = await api.patch('/auth/me/profile', { full_name: name.trim() });
      setUser(data);
      showToast('Profile updated');
    } catch (e: any) {
      showToast(e.response?.data?.detail || 'Failed to update', false);
    } finally {
      setSaving(false);
    }
  };

  const handleChangePw = async () => {
    if (newPw !== confirmPw) { showToast('Passwords do not match', false); return; }
    if (newPw.length < 8) { showToast('Password must be at least 8 characters', false); return; }
    setChangingPw(true);
    try {
      await api.patch('/auth/me/password', { current_password: currentPw, new_password: newPw });
      setCurrentPw(''); setNewPw(''); setConfirmPw('');
      showToast('Password changed');
    } catch (e: any) {
      showToast(e.response?.data?.detail || 'Failed to change password', false);
    } finally {
      setChangingPw(false);
    }
  };

  const inputClass = "w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500/50 focus:border-sky-500";
  const labelClass = "block text-xs font-medium text-slate-500 mb-1";

  return (
    <div className="max-w-2xl mx-auto py-8 px-4">
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg text-sm shadow-lg border ${
          toast.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-red-50 border-red-200 text-red-700'
        }`}>
          {toast.msg}
        </div>
      )}

      <h1 className="text-2xl font-bold text-slate-900 mb-1">My Account</h1>
      <p className="text-sm text-slate-500 mb-8">Manage your profile and password</p>

      {/* Profile */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6">
        <h2 className="text-base font-semibold text-slate-800 mb-4">Profile</h2>
        <div className="space-y-4">
          <div>
            <label className={labelClass}>Email</label>
            <input type="text" value={user?.email ?? ''} disabled className={inputClass + " bg-slate-50 text-slate-400"} />
          </div>
          <div>
            <label className={labelClass}>Full Name</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)} className={inputClass} />
          </div>
          <button
            onClick={handleSaveProfile}
            disabled={saving || !name.trim()}
            className="px-4 py-2 bg-sky-500 hover:bg-sky-600 text-white text-sm font-medium rounded-lg disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving...' : 'Save Profile'}
          </button>
        </div>
      </div>

      {/* Password */}
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <h2 className="text-base font-semibold text-slate-800 mb-4">Change Password</h2>
        <div className="space-y-4">
          <div>
            <label className={labelClass}>Current Password</label>
            <input type="password" value={currentPw} onChange={e => setCurrentPw(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>New Password</label>
            <input type="password" value={newPw} onChange={e => setNewPw(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Confirm New Password</label>
            <input type="password" value={confirmPw} onChange={e => setConfirmPw(e.target.value)} className={inputClass} />
          </div>
          <button
            onClick={handleChangePw}
            disabled={changingPw || !currentPw || !newPw}
            className="px-4 py-2 bg-sky-500 hover:bg-sky-600 text-white text-sm font-medium rounded-lg disabled:opacity-50 transition-colors"
          >
            {changingPw ? 'Changing...' : 'Change Password'}
          </button>
        </div>
      </div>
    </div>
  );
}
