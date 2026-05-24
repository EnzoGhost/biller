import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Save, CheckCircle, Building2, Shield, Cpu, Globe, Zap, ExternalLink, Users, Folder, FolderOpen, Stethoscope, UserPlus } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../lib/api';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { useAuthStore } from '../hooks/useAuth';
import { getUserOrgs, getUserProviders, createOrganization, inviteMember } from '../lib/tauri-api';
import type { ClinicSettings } from '../types';

export default function SettingsPage() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const setUser = useAuthStore(s => s.setUser);
  const currentUser = useAuthStore(s => s.user);
  const [active, setActive] = useState('clinic');
  const [saved, setSaved] = useState(false);

  // Clinic
  const [clinicName,  setClinicName]  = useState('');
  const [clinicNpi,   setClinicNpi]   = useState('');
  const [clinicTax,   setClinicTax]   = useState('');
  const [clinicAddr,  setClinicAddr]  = useState('');
  const [clinicPhone, setClinicPhone] = useState('');

  // Stedi
  const [stediKey,   setStediKey]   = useState('');
  const [stediEnv,   setStediEnv]   = useState<'sandbox' | 'production'>('sandbox');

  // Availity
  const [availityClientId,     setAvailityClientId]     = useState('');
  const [availityClientSecret, setAvailityClientSecret] = useState('');

  // AI
  const [aiKey,      setAiKey]      = useState('');
  const [aiModel,    setAiModel]    = useState('gpt-4o');
  const [aiEnabled,  setAiEnabled]  = useState(true);

  // Inmediata
  const [sftpHost,   setSftpHost]   = useState('');
  const [sftpUser,   setSftpUser]   = useState('');
  const [sftpUpDir,  setSftpUpDir]  = useState('/UPLOAD/837');
  const [sftpDnDir,  setSftpDnDir]  = useState('/DOWNLOAD/835');
  const [submitterId,setSubmitterId]= useState('');

  // ImPlug
  const [implugOutbound, setImplugOutbound] = useState('');
  const [implugInbound,  setImplugInbound]  = useState('');

  // Load existing settings
  const { data: settings } = useQuery<ClinicSettings>({
    queryKey: ['clinic-settings'],
    queryFn: () => api.get('/clinic/settings').then(r => r.data as ClinicSettings),
  });

  useEffect(() => {
    if (settings) {
      setClinicName(settings.clinic_name ?? '');
      setClinicNpi(settings.npi_org ?? '');
      setClinicTax(settings.tax_id ?? '');
      setClinicAddr(settings.address_line1 ?? '');
      setClinicPhone(settings.phone ?? '');
      setImplugOutbound((settings as any).implug_outbound_folder ?? '');
      setImplugInbound((settings as any).implug_inbound_folder ?? '');
      setStediKey((settings as any).stedi_api_key ? '••••••••' : '');
    }
  }, [settings]);

  const saveMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => api.put('/clinic/settings', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['clinic-settings'] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    },
  });

  const handleSave = async () => {
    const payload: Record<string, unknown> = {};
    if (active === 'clinic') {
      Object.assign(payload, { clinic_name: clinicName, npi_org: clinicNpi, tax_id: clinicTax, address_line1: clinicAddr, phone: clinicPhone });
    } else if (active === 'stedi') {
      if (stediKey && !stediKey.startsWith('•')) payload.stedi_api_key = stediKey;
      payload.stedi_env = stediEnv;
    } else if (active === 'availity') {
      payload.availity_client_id = availityClientId;
      payload.availity_client_secret = availityClientSecret;
    } else if (active === 'inmediata') {
      Object.assign(payload, { inmediata_sftp_host: sftpHost, inmediata_sftp_user: sftpUser, submitter_id: submitterId });
    } else if (active === 'implug') {
      Object.assign(payload, { implug_outbound_folder: implugOutbound, implug_inbound_folder: implugInbound });
    } else if (active === 'ai') {
      // Store AI settings (not critical for local app)
    }
    saveMutation.mutate(payload);
  };

  const pickFolder = async (setter: (v: string) => void) => {
    try {
      const selected = await openDialog({ directory: true, multiple: false });
      if (selected && typeof selected === 'string') setter(selected);
    } catch { /* dialog cancelled */ }
  };

  const inputClass = 'w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500';
  const labelClass = 'block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1';

  const SECTIONS = [
    { key: 'org',          labelKey: 'Organization',           icon: Building2 },
    { key: 'team',         labelKey: 'Team',                   icon: Users },
    { key: 'provider',     labelKey: 'Provider',               icon: Stethoscope },
    { key: 'clinic',       labelKey: 'settings.clinic_info',  icon: Building2 },
    { key: 'implug',       labelKey: 'settings.implug_title', icon: FolderOpen },
    { key: 'stedi',        labelKey: 'settings.stedi',         icon: Shield },
    { key: 'stedi_portal', labelKey: 'settings.stedi_portal',  icon: ExternalLink },
    { key: 'availity',     labelKey: 'settings.availity',      icon: Users },
    { key: 'inmediata',    labelKey: 'inmediata.title',        icon: Zap },
    { key: 'ai',           labelKey: 'settings.ai',            icon: Cpu },
    { key: 'lang',         labelKey: 'settings.language',      icon: Globe },
  ];

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1 className="text-xl font-bold text-slate-900 mb-6">{t('settings.title')}</h1>

      <div className="flex gap-6">
        {/* Sidebar tabs */}
        <div className="w-52 shrink-0">
          <nav className="space-y-0.5">
            {SECTIONS.map(({ key, labelKey, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setActive(key)}
                className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-left ${
                  active === key ? 'bg-sky-50 text-sky-700' : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                {typeof labelKey === 'string' && labelKey.includes('.') ? t(labelKey) : labelKey}
              </button>
            ))}
          </nav>
        </div>

        {/* Panel */}
        <div className="flex-1 bg-white rounded-xl border border-slate-200 p-6">

          {/* Organization */}
          {active === 'org' && (
            <OrgSettingsPanel user={currentUser} />
          )}

          {/* Team */}
          {active === 'team' && (
            <TeamPanel user={currentUser} org={useAuthStore.getState().currentOrg} />
          )}

          {/* Provider */}
          {active === 'provider' && (
            <ProviderSettingsPanel org={useAuthStore.getState().currentOrg} />
          )}

          {/* Clinic */}
          {active === 'clinic' && (
            <div className="space-y-4">
              <h2 className="font-semibold text-slate-800 mb-4">{t('settings.clinic_info')}</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={labelClass}>{t('settings.clinic_name')}</label>
                  <input value={clinicName} onChange={e => setClinicName(e.target.value)} className={inputClass} placeholder="Clínica Ejemplo" />
                </div>
                <div>
                  <label className={labelClass}>{t('settings.npi_billing')}</label>
                  <input value={clinicNpi} onChange={e => setClinicNpi(e.target.value)} className={inputClass} placeholder="1234567890" />
                </div>
                <div>
                  <label className={labelClass}>{t('settings.tax_id_ein')}</label>
                  <input value={clinicTax} onChange={e => setClinicTax(e.target.value)} className={inputClass} placeholder="12-3456789" />
                </div>
                <div>
                  <label className={labelClass}>{t('common.phone')}</label>
                  <input value={clinicPhone} onChange={e => setClinicPhone(e.target.value)} className={inputClass} placeholder="(787) 555-0000" />
                </div>
                <div className="sm:col-span-2">
                  <label className={labelClass}>{t('settings.address')}</label>
                  <input value={clinicAddr} onChange={e => setClinicAddr(e.target.value)} className={inputClass} placeholder="Ave. Principal 123, San Juan, PR 00901" />
                </div>
              </div>
            </div>
          )}

          {/* ImPlug */}
          {active === 'implug' && (
            <div className="space-y-4">
              <h2 className="font-semibold text-slate-800 mb-2">{t('settings.implug_title')}</h2>
              <p className="text-sm text-slate-500 mb-4">{t('settings.implug_desc')}</p>
              <div className="space-y-4">
                <div>
                  <label className={labelClass}>{t('settings.implug_outbound')}</label>
                  <div className="flex gap-2">
                    <input
                      value={implugOutbound}
                      onChange={e => setImplugOutbound(e.target.value)}
                      className={`${inputClass} flex-1`}
                      placeholder="/Users/.../ImPlug/OUTBOUND"
                    />
                    <button
                      onClick={() => pickFolder(setImplugOutbound)}
                      className="flex items-center gap-1.5 px-3 py-2 border border-slate-200 rounded-lg text-sm hover:bg-slate-50 text-slate-600"
                    >
                      <Folder className="w-4 h-4" />
                      {t('settings.browse')}
                    </button>
                  </div>
                </div>
                <div>
                  <label className={labelClass}>{t('settings.implug_inbound')}</label>
                  <div className="flex gap-2">
                    <input
                      value={implugInbound}
                      onChange={e => setImplugInbound(e.target.value)}
                      className={`${inputClass} flex-1`}
                      placeholder="/Users/.../ImPlug/INBOUND"
                    />
                    <button
                      onClick={() => pickFolder(setImplugInbound)}
                      className="flex items-center gap-1.5 px-3 py-2 border border-slate-200 rounded-lg text-sm hover:bg-slate-50 text-slate-600"
                    >
                      <Folder className="w-4 h-4" />
                      {t('settings.browse')}
                    </button>
                  </div>
                </div>
                <div className="bg-sky-50 border border-sky-200 rounded-lg p-3 text-xs text-sky-900">
                  <strong>{t('settings.implug_how_it_works')}</strong> {t('settings.implug_how_it_works_desc')}
                </div>
              </div>
            </div>
          )}

          {/* Stedi */}
          {active === 'stedi' && (
            <div className="space-y-4">
              <h2 className="font-semibold text-slate-800 mb-4">{t('settings.stedi')}</h2>
              <div>
                <label className={labelClass}>{t('settings.api_key')}</label>
                <input type="password" value={stediKey} onChange={e => setStediKey(e.target.value)} className={inputClass} placeholder="sk_live_..." />
                <p className="text-xs text-slate-400 mt-1">
                  {t('settings.get_api_key_at')}{' '}
                  <a href="https://www.stedi.com" target="_blank" rel="noreferrer" className="text-sky-600 hover:underline">stedi.com</a>
                </p>
              </div>
              <div>
                <label className={labelClass}>{t('settings.environment')}</label>
                <select value={stediEnv} onChange={e => setStediEnv(e.target.value as 'sandbox' | 'production')} className={inputClass}>
                  <option value="sandbox">{t('settings.sandbox')}</option>
                  <option value="production">{t('settings.production')}</option>
                </select>
              </div>
            </div>
          )}

          {/* Stedi Portal Info */}
          {active === 'stedi_portal' && (
            <div className="space-y-4">
              <h2 className="font-semibold text-slate-800 mb-4">{t('settings.stedi_portal')}</h2>
              <div className="bg-sky-50 border border-sky-200 rounded-xl p-4 space-y-3">
                <p className="text-sm text-sky-900">{t('settings.stedi_portal_desc')}</p>
                <a href="https://www.stedi.com" target="_blank" rel="noreferrer"
                  className="inline-flex items-center gap-2 bg-sky-500 hover:bg-sky-600 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
                  <ExternalLink className="w-4 h-4" />
                  {t('settings.stedi_portal_link')}
                </a>
              </div>
            </div>
          )}

          {/* Availity */}
          {active === 'availity' && (
            <div className="space-y-4">
              <h2 className="font-semibold text-slate-800 mb-4">{t('settings.availity')}</h2>
              <div>
                <label className={labelClass}>{t('settings.availity_client_id')}</label>
                <input value={availityClientId} onChange={e => setAvailityClientId(e.target.value)} className={inputClass} placeholder="availity-client-xxx" />
              </div>
              <div>
                <label className={labelClass}>{t('settings.availity_client_secret')}</label>
                <input type="password" value={availityClientSecret} onChange={e => setAvailityClientSecret(e.target.value)} className={inputClass} placeholder="••••••••" />
              </div>
            </div>
          )}

          {/* Inmediata */}
          {active === 'inmediata' && (
            <div className="space-y-4">
              <h2 className="font-semibold text-slate-800 mb-4">{t('inmediata.title')}</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={labelClass}>{t('inmediata.sftp_host')}</label>
                  <input value={sftpHost} onChange={e => setSftpHost(e.target.value)} className={inputClass} placeholder="sftp.inmediata.com" />
                </div>
                <div>
                  <label className={labelClass}>{t('inmediata.sftp_user')}</label>
                  <input value={sftpUser} onChange={e => setSftpUser(e.target.value)} className={inputClass} placeholder="username" />
                </div>
                <div>
                  <label className={labelClass}>{t('inmediata.submitter_id')}</label>
                  <input value={submitterId} onChange={e => setSubmitterId(e.target.value)} className={inputClass} placeholder="YOURID" />
                </div>
                <div>
                  <label className={labelClass}>{t('inmediata.upload_dir')}</label>
                  <input value={sftpUpDir} onChange={e => setSftpUpDir(e.target.value)} className={inputClass} placeholder="/UPLOAD/837" />
                </div>
                <div>
                  <label className={labelClass}>{t('inmediata.download_dir')}</label>
                  <input value={sftpDnDir} onChange={e => setSftpDnDir(e.target.value)} className={inputClass} placeholder="/DOWNLOAD/835" />
                </div>
              </div>
            </div>
          )}

          {/* AI */}
          {active === 'ai' && (
            <div className="space-y-4">
              <h2 className="font-semibold text-slate-800 mb-4">{t('settings.ai')}</h2>
              <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                <div>
                  <p className="text-sm font-medium text-slate-700">{t('settings.ai_enabled')}</p>
                  <p className="text-xs text-slate-400">{t('settings.ai_desc')}</p>
                </div>
                <button
                  onClick={() => setAiEnabled(!aiEnabled)}
                  className={`relative w-10 h-6 rounded-full transition-colors ${aiEnabled ? 'bg-sky-500' : 'bg-slate-200'}`}
                >
                  <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${aiEnabled ? 'left-5' : 'left-1'}`} />
                </button>
              </div>
              <div>
                <label className={labelClass}>{t('settings.openai_api_key')}</label>
                <input type="password" value={aiKey} onChange={e => setAiKey(e.target.value)} className={inputClass} placeholder="sk-..." />
              </div>
              <div>
                <label className={labelClass}>{t('settings.model')}</label>
                <select value={aiModel} onChange={e => setAiModel(e.target.value)} className={inputClass}>
                  <option value="gpt-4o">{t('settings.gpt4o')}</option>
                  <option value="gpt-4o-mini">{t('settings.gpt4o_mini')}</option>
                </select>
              </div>
            </div>
          )}

          {/* Language */}
          {active === 'lang' && (
            <div className="space-y-4">
              <h2 className="font-semibold text-slate-800 mb-4">{t('settings.interface_language')}</h2>
              <div className="space-y-2">
                {[
                  { code: 'es', labelKey: 'settings.lang_es', flag: '🇵🇷' },
                  { code: 'en', labelKey: 'settings.lang_en', flag: '🇺🇸' },
                ].map(({ code, labelKey, flag }) => (
                  <button key={code} onClick={async () => {
                    i18n.changeLanguage(code);
                    try {
                      const { data } = await api.patch('auth/me/language', { language: code });
                      if (data && currentUser) setUser({ ...currentUser, language: code });
                    } catch (e) {
                      console.warn('[settings] language sync failed', e);
                    }
                  }}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg border text-sm font-medium transition-colors ${
                      i18n.language === code ? 'border-sky-500 bg-sky-50 text-sky-700' : 'border-slate-200 text-slate-700 hover:bg-slate-50'
                    }`}>
                    <span className="text-xl">{flag}</span>
                    {t(labelKey)}
                    {i18n.language === code && <CheckCircle className="w-4 h-4 ml-auto text-sky-500" />}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Save button */}
          {active !== 'lang' && active !== 'org' && active !== 'team' && active !== 'provider' && (
            <div className="mt-6 flex items-center gap-3">
              <button onClick={handleSave} disabled={saveMutation.isPending}
                className="flex items-center gap-2 bg-sky-500 hover:bg-sky-600 disabled:opacity-50 text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors">
                <Save className="w-4 h-4" />
                {saveMutation.isPending ? t('settings.saving') : (saved ? t('settings.saved') : t('settings.save'))}
              </button>
              {saved && (
                <div className="flex items-center gap-1.5 text-emerald-600 text-sm">
                  <CheckCircle className="w-4 h-4" />
                  {t('settings.saved')}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Sub-panels ─────────────────────────────────────────────────────────────

function OrgSettingsPanel({ user }: { user: any }) {
  const { organizations, currentOrg, selectOrg, user: authUser } = useAuthStore();
  const [newOrgName, setNewOrgName] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  const handleCreate = async () => {
    if (!newOrgName.trim()) return;
    setCreating(true);
    setError('');
    try {
      const org = await createOrganization(newOrgName.trim(), authUser!.id);
      const allOrgs = await getUserOrgs(authUser!.id);
      useAuthStore.setState({ organizations: allOrgs });
      setNewOrgName('');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-semibold text-slate-800 mb-1">Organizations</h2>
        <p className="text-sm text-slate-500">Manage your organizations and switch between them.</p>
      </div>

      <div className="space-y-2">
        {organizations.map((org) => (
          <div key={org.id} className={`flex items-center gap-3 p-3 rounded-xl border ${
            org.id === currentOrg?.id ? 'border-sky-300 bg-sky-50' : 'border-slate-200'
          }`}>
            <div className="w-9 h-9 rounded-lg bg-sky-100 text-sky-700 flex items-center justify-center">
              <Building2 className="w-4 h-4" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-slate-800 text-sm">{org.name}</p>
              <p className="text-xs text-slate-400 capitalize">{org.role} · {org.subscription_tier}</p>
            </div>
            {org.id !== currentOrg?.id && (
              <button onClick={() => selectOrg(org)} className="text-xs text-sky-600 hover:text-sky-800 font-medium">
                Switch
              </button>
            )}
            {org.id === currentOrg?.id && (
              <span className="text-xs text-sky-600 font-semibold">Active</span>
            )}
          </div>
        ))}
      </div>

      <div className="border-t border-slate-100 pt-4">
        <h3 className="text-sm font-semibold text-slate-700 mb-3">Create New Organization</h3>
        <div className="flex gap-2">
          <input
            value={newOrgName}
            onChange={e => setNewOrgName(e.target.value)}
            placeholder="Organization name"
            className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
          />
          <button
            onClick={handleCreate}
            disabled={creating || !newOrgName.trim()}
            className="px-4 py-2 bg-sky-500 text-white text-sm font-medium rounded-lg hover:bg-sky-600 disabled:opacity-50 transition-colors"
          >
            {creating ? '...' : 'Create'}
          </button>
        </div>
        {error && <p className="text-red-600 text-xs mt-1">{error}</p>}
      </div>
    </div>
  );
}

function TeamPanel({ user, org }: { user: any; org: any }) {
  const { user: authUser } = useAuthStore();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('biller');
  const [inviting, setInviting] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');

  const handleInvite = async () => {
    if (!email.trim() || !org) return;
    setInviting(true);
    setError('');
    setSuccess('');
    try {
      await inviteMember(org.id, email.trim(), role);
      setSuccess(`${email} added to ${org.name}`);
      setEmail('');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setInviting(false);
    }
  };

  if (!org) return <p className="text-slate-500 text-sm">No organization selected.</p>;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-semibold text-slate-800 mb-1">Team Management</h2>
        <p className="text-sm text-slate-500">Manage users in <strong>{org.name}</strong>.</p>
      </div>

      <div className="border border-slate-200 rounded-xl p-4 space-y-3">
        <h3 className="text-sm font-semibold text-slate-700">Invite User</h3>
        <div className="flex gap-2">
          <input
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="user@example.com"
            className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
          />
          <select
            value={role}
            onChange={e => setRole(e.target.value)}
            className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none"
          >
            <option value="admin">Admin</option>
            <option value="biller">Biller</option>
            <option value="viewer">Viewer</option>
          </select>
          <button
            onClick={handleInvite}
            disabled={inviting || !email.trim()}
            className="px-4 py-2 bg-sky-500 text-white text-sm font-medium rounded-lg hover:bg-sky-600 disabled:opacity-50 transition-colors flex items-center gap-1"
          >
            <UserPlus className="w-3.5 h-3.5" />
            {inviting ? '...' : 'Add'}
          </button>
        </div>
        {error && <p className="text-red-600 text-xs">{error}</p>}
        {success && <p className="text-emerald-600 text-xs">{success}</p>}
      </div>
    </div>
  );
}

function ProviderSettingsPanel({ org }: { org: any }) {
  const { currentProvider, providers, selectProvider } = useAuthStore();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-semibold text-slate-800 mb-1">Provider Settings</h2>
        <p className="text-sm text-slate-500">Each provider has their own data, credentials, and settings.</p>
      </div>

      <div className="space-y-2">
        {providers.map((prov) => (
          <div key={prov.id} className={`flex items-center gap-3 p-3 rounded-xl border ${
            prov.id === currentProvider?.id ? 'border-sky-300 bg-sky-50' : 'border-slate-200'
          }`}>
            <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold ${
              prov.id === currentProvider?.id ? 'bg-sky-500 text-white' : 'bg-slate-100 text-slate-600'
            }`}>
              {prov.first_name[0]}{prov.last_name[0]}
            </div>
            <div className="flex-1">
              <p className="font-medium text-sm text-slate-800">{prov.first_name} {prov.last_name}</p>
              <p className="text-xs text-slate-400">{prov.npi}{prov.specialty ? ` · ${prov.specialty}` : ''}</p>
            </div>
            {prov.id !== currentProvider?.id && (
              <button onClick={() => selectProvider(prov)} className="text-xs text-sky-600 hover:text-sky-800 font-medium">
                Switch
              </button>
            )}
            {prov.id === currentProvider?.id && (
              <span className="text-xs text-sky-600 font-semibold">Active</span>
            )}
          </div>
        ))}
        {providers.length === 0 && (
          <p className="text-sm text-slate-400 italic">No providers in this organization. <a href="/providers" className="text-sky-600">Add one</a>.</p>
        )}
      </div>

      <p className="text-xs text-slate-400">
        To manage provider credentials (portals, clearinghouses), go to the Provider detail page.
        Each provider stores their own NPI, credentials, fee schedule, and patients independently.
      </p>
    </div>
  );
}
