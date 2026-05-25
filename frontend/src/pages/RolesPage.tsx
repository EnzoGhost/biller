import { useState, useEffect } from 'react';
import { Shield, Plus, Edit2, Trash2, X, Check } from 'lucide-react';
import api from '../lib/api';

interface PermissionDef { key: string; label: string; group: string }
interface Role { id: number; name: string; description: string; is_system: boolean; permissions: string[]; user_count: number }

export default function RolesPage() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [permissions, setPermissions] = useState<PermissionDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Role | null>(null);
  const [creating, setCreating] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const load = async () => {
    try {
      const [r, p] = await Promise.all([api.get('/roles'), api.get('/roles/permissions')]);
      setRoles(r.data); setPermissions(p.data);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3000); };

  if (loading) return <div className="flex items-center justify-center h-64 text-slate-400 text-sm">Loading…</div>;

  return (
    <div className="max-w-4xl mx-auto py-8 px-4">
      {toast && <div className="fixed top-4 right-4 z-50 px-4 py-3 rounded-lg text-sm shadow-lg bg-emerald-50 border border-emerald-200 text-emerald-700">{toast}</div>}

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Roles & Permissions</h1>
          <p className="text-sm text-slate-500 mt-1">Manage what each role can access</p>
        </div>
        <button onClick={() => setCreating(true)} className="flex items-center gap-2 bg-sky-500 hover:bg-sky-600 text-white text-sm font-medium px-4 py-2 rounded-lg">
          <Plus size={15} /> New Role
        </button>
      </div>

      <div className="space-y-4">
        {roles.map(role => (
          <div key={role.id} className="bg-white rounded-xl border border-slate-200 p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <Shield size={18} className="text-sky-500" />
                <div>
                  <h3 className="font-semibold text-slate-900">{role.name}</h3>
                  <p className="text-xs text-slate-400">{role.description} · {role.user_count} user{role.user_count !== 1 ? 's' : ''}</p>
                </div>
                {role.is_system && <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">System</span>}
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => setEditing(role)} className="p-1.5 text-slate-400 hover:text-sky-500 rounded"><Edit2 size={14} /></button>
                {!role.is_system && (
                  <button onClick={async () => {
                    try { await api.delete(`/roles/${role.id}`); showToast('Role deleted'); load(); } catch { /* ignore */ }
                  }} className="p-1.5 text-slate-400 hover:text-red-500 rounded"><Trash2 size={14} /></button>
                )}
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {role.permissions.slice(0, 6).map(p => {
                const def = permissions.find(d => d.key === p);
                return <span key={p} className="text-xs bg-sky-50 text-sky-700 border border-sky-100 px-2 py-0.5 rounded-full">{def?.label || p.replace(/[_:]/g, ' ')}</span>;
              })}
              {role.permissions.length > 6 && (
                <span className="text-xs text-slate-400 border border-slate-200 px-2 py-0.5 rounded-full">+{role.permissions.length - 6} more</span>
              )}
              {role.permissions.length === 0 && <span className="text-xs text-slate-400 italic">No permissions</span>}
            </div>
          </div>
        ))}
      </div>

      {/* Editor Modal */}
      {(editing || creating) && (
        <RoleEditor
          role={editing}
          permissions={permissions}
          onClose={() => { setEditing(null); setCreating(false); }}
          onSaved={() => { setEditing(null); setCreating(false); showToast(editing ? 'Role updated' : 'Role created'); load(); }}
        />
      )}
    </div>
  );
}

function RoleEditor({ role, permissions, onClose, onSaved }: {
  role: Role | null; permissions: PermissionDef[]; onClose: () => void; onSaved: () => void;
}) {
  const [name, setName] = useState(role?.name || '');
  const [description, setDescription] = useState(role?.description || '');
  const [selected, setSelected] = useState<Set<string>>(new Set(role?.permissions || []));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const grouped: Record<string, PermissionDef[]> = {};
  permissions.forEach(p => { if (!grouped[p.group]) grouped[p.group] = []; grouped[p.group].push(p); });

  const toggle = (key: string) => setSelected(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  const toggleGroup = (group: string) => {
    const keys = grouped[group].map(p => p.key);
    const allSelected = keys.every(k => selected.has(k));
    setSelected(prev => { const n = new Set(prev); keys.forEach(k => allSelected ? n.delete(k) : n.add(k)); return n; });
  };

  const handleSave = async () => {
    if (!name.trim()) { setError('Name required'); return; }
    setSaving(true); setError(null);
    try {
      if (role) {
        await api.put(`/roles/${role.id}`, { name: name.trim(), description: description.trim(), permissions: Array.from(selected) });
      } else {
        await api.post('/roles', { name: name.trim(), description: description.trim(), permissions: Array.from(selected) });
      }
      onSaved();
    } catch (e: any) { setError(e.response?.data?.detail || 'Failed'); }
    finally { setSaving(false); }
  };

  const inputClass = "w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500/50";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <h2 className="font-semibold text-slate-900">{role ? `Edit: ${role.name}` : 'Create Role'}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Role Name</label>
            <input value={name} onChange={e => setName(e.target.value)} className={inputClass} placeholder="e.g. Senior Biller" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Description</label>
            <input value={description} onChange={e => setDescription(e.target.value)} className={inputClass} placeholder="What this role can do" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-3">Permissions</label>
            {Object.entries(grouped).map(([group, perms]) => {
              const allChecked = perms.every(p => selected.has(p.key));
              const someChecked = perms.some(p => selected.has(p.key));
              return (
                <div key={group} className="mb-4">
                  <button onClick={() => toggleGroup(group)} className="flex items-center gap-2 mb-2 text-sm font-medium text-slate-700 hover:text-sky-600">
                    <div className={`w-4 h-4 rounded border flex items-center justify-center ${allChecked ? 'bg-sky-500 border-sky-500' : someChecked ? 'bg-sky-100 border-sky-300' : 'border-slate-300'}`}>
                      {allChecked && <Check size={10} className="text-white" />}
                    </div>
                    {group}
                  </button>
                  <div className="grid grid-cols-2 gap-1.5 ml-6">
                    {perms.map(p => (
                      <label key={p.key} className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer hover:text-slate-900">
                        <input type="checkbox" checked={selected.has(p.key)} onChange={() => toggle(p.key)}
                          className="w-3.5 h-3.5 rounded border-slate-300 text-sky-500 focus:ring-sky-500" />
                        {p.label}
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          {error && <p className="text-sm text-red-500">{error}</p>}
        </div>
        <div className="flex justify-end gap-3 border-t border-slate-100 px-6 py-4">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-500 hover:text-slate-700">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="px-4 py-2 bg-sky-500 hover:bg-sky-600 text-white text-sm font-medium rounded-lg disabled:opacity-50">
            {saving ? 'Saving…' : role ? 'Save Changes' : 'Create Role'}
          </button>
        </div>
      </div>
    </div>
  );
}
