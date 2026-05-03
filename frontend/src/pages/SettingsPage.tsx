import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { Save, CheckCircle, Building2, Shield, Cpu, Globe, Zap, Users, Wifi, Stethoscope, DollarSign, Link2, Unplug, RefreshCw, Eye, EyeOff } from 'lucide-react';
import api from '../lib/api';
import { formatPhone } from '../lib/format';

const ProvidersPage = lazy(() => import('./ProvidersPage'));
const PayersPage = lazy(() => import('./PayersPage'));
const FeeSchedulePage = lazy(() => import('./FeeSchedulePage'));

export default function SettingsPage() {
  const { t, i18n } = useTranslation();
  const [active, setActive] = useState('clinic');
  const [saved, setSaved] = useState(false);

  // Clinic
  const [clinicName,    setClinicName]    = useState('');
  const [clinicNpi,     setClinicNpi]     = useState('');
  const [clinicTax,     setClinicTax]     = useState('');
  const [clinicAddr,    setClinicAddr]    = useState('');
  const [clinicPhone,   setClinicPhone]   = useState('');
  const [providerName,  setProviderName]  = useState('');

  // Availity
  const [availityClientId,     setAvailityClientId]     = useState('');
  const [availityClientSecret, setAvailityClientSecret] = useState('');

  // AI
  const [aiKey,      setAiKey]      = useState('');
  const [aiModel,    setAiModel]    = useState('gpt-4o');
  const [aiEnabled,  setAiEnabled]  = useState(true);

  // Inmediata API
  const [inmApiKey,      setInmApiKey]      = useState('');
  const [inmSubmitterId, setInmSubmitterId]  = useState('');
  const [inmEnv,         setInmEnv]          = useState<'sandbox' | 'production'>('sandbox');
  const [inmBaseUrl,     setInmBaseUrl]      = useState('https://api.inmediata.com');
  const [inmTestResult,  setInmTestResult]   = useState<{ success: boolean; message: string } | null>(null);
  const [inmTesting,     setInmTesting]      = useState(false);

  // VistaNet connection state
  const [vnConnected, setVnConnected] = useState(false);
  const [vnUsername, setVnUsername] = useState('');
  const [vnPassword, setVnPassword] = useState('');
  const [vnLocation, setVnLocation] = useState('MANATI');
  const [vnLocations, setVnLocations] = useState<string[]>([]);
  const [vnPasswordMasked, setVnPasswordMasked] = useState('');
  const [vnShowPassword, setVnShowPassword] = useState(false);
  const [vnSaving, setVnSaving] = useState(false);
  const [vnDisconnecting, setVnDisconnecting] = useState(false);
  const [vnEditing, setVnEditing] = useState(false);

  // Wink connection state
  const [winkClinicId, setWinkClinicId] = useState<string | null>(null);
  const [winkClinicName, setWinkClinicName] = useState<string | null>(null);
  const [winkJoinCode, setWinkJoinCode] = useState('');
  const [winkPairing, setWinkPairing] = useState(false);

  // Load clinic config on mount
  useEffect(() => {
    api.get('/clinic/config').then(res => {
      const d = res.data;
      setClinicName(d.clinic_name || '');
      setClinicNpi(d.npi || '');
      setClinicTax(d.tax_id || '');
      setClinicAddr(d.address || '');
      setClinicPhone(d.phone || '');
      setProviderName(d.provider_name || '');
    }).catch(() => {});
  }, []);

  // Load VistaNet config when connections tab selected
  useEffect(() => {
    if (active === 'connections') {
      api.get('/vistanet/config').then(res => {
        const d = res.data;
        setVnConnected(d.connected || false);
        setVnUsername(d.username || '');
        setVnPasswordMasked(d.password_masked || '');
        setVnLocation(d.location || 'MANATI');
        setVnLocations(d.locations || []);
        setVnEditing(false);
        setVnPassword('');
      }).catch(() => {});

      // Load Wink state from localStorage
      setWinkClinicId(localStorage.getItem('wink_clinic_id'));
      setWinkClinicName(localStorage.getItem('wink_clinic_name'));
    }
  }, [active]);

  // Load Inmediata config when tab selected
  useEffect(() => {
    if (active === 'inmediata') {
      api.get('/inmediata/api-config').then(res => {
        const d = res.data;
        setInmSubmitterId(d.submitter_id || '');
        setInmBaseUrl(d.api_base_url || 'https://api.inmediata.com');
        setInmEnv(d.environment || 'sandbox');
        // Don't populate the key field — it's masked on the server
      }).catch(() => {});
    }
  }, [active]);

  const handleSave = async () => {
    try {
      if (active === 'clinic') {
        // Save clinic config including provider name
        await api.post('/clinic/config', {
          clinic_name: clinicName,
          npi: clinicNpi,
          tax_id: clinicTax,
          address: clinicAddr,
          phone: clinicPhone,
          provider_name: providerName,
        });
      } else if (active === 'ai') {
        await api.post('/ai/config', { api_key: aiKey, model: aiModel, enabled: aiEnabled });
      } else if (active === 'inmediata') {
        await api.post('/inmediata/api-config', {
          api_key: inmApiKey,
          submitter_id: inmSubmitterId,
          environment: inmEnv,
          api_base_url: inmBaseUrl,
        });
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch {
      // Best-effort
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    }
  };

  // VistaNet handlers
  const handleVnSave = async () => {
    setVnSaving(true);
    try {
      await api.post('/vistanet/config', {
        username: vnUsername,
        password: vnPassword || undefined,
        location: vnLocation,
      });
      setVnConnected(true);
      setVnEditing(false);
      setVnPasswordMasked('••••••••');
      setVnPassword('');
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch { /* best-effort */ }
    finally { setVnSaving(false); }
  };

  const handleVnDisconnect = async () => {
    setVnDisconnecting(true);
    try {
      await api.post('/vistanet/disconnect');
      setVnConnected(false);
      setVnUsername('');
      setVnPassword('');
      setVnPasswordMasked('');
      setVnLocation('MANATI');
      setVnEditing(false);
    } catch { /* best-effort */ }
    finally { setVnDisconnecting(false); }
  };

  // Wink handlers
  const handleWinkPair = async () => {
    if (!winkJoinCode.trim()) return;
    setWinkPairing(true);
    try {
      const res = await api.post('/clinic/join-codes/verify', { code: winkJoinCode });
      if (res.data.valid) {
        localStorage.setItem('wink_clinic_id', res.data.wink_clinic_id);
        localStorage.setItem('wink_clinic_name', res.data.clinic_name);
        setWinkClinicId(res.data.wink_clinic_id);
        setWinkClinicName(res.data.clinic_name);
        setWinkJoinCode('');
      }
    } catch { /* best-effort */ }
    finally { setWinkPairing(false); }
  };

  const handleWinkDisconnect = () => {
    localStorage.removeItem('wink_clinic_id');
    localStorage.removeItem('wink_clinic_name');
    setWinkClinicId(null);
    setWinkClinicName(null);
  };

  const handleTestConnection = async () => {
    setInmTesting(true);
    setInmTestResult(null);
    try {
      // Save first, then test
      await api.post('/inmediata/api-config', {
        api_key: inmApiKey,
        submitter_id: inmSubmitterId,
        environment: inmEnv,
        api_base_url: inmBaseUrl,
      });
      const res = await api.post('/inmediata/test-connection');
      setInmTestResult(res.data);
    } catch (err: any) {
      setInmTestResult({ success: false, message: err?.response?.data?.detail || 'Connection failed' });
    } finally {
      setInmTesting(false);
    }
  };

  // formatPhone imported from shared lib

  const inputClass = 'w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500';
  const labelClass = 'block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1';

  // Join code state
  const [joinCode, setJoinCode] = useState<string | null>(null);
  const [joinExpiresIn, setJoinExpiresIn] = useState(0);
  const [joinGenerating, setJoinGenerating] = useState(false);
  const joinTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const handleGenerateJoinCode = async () => {
    setJoinGenerating(true);
    try {
      const res = await api.post('/clinic/join-codes/generate');
      setJoinCode(res.data.code);
      setJoinExpiresIn(res.data.expires_in);

      // Start countdown
      if (joinTimerRef.current) clearInterval(joinTimerRef.current);
      joinTimerRef.current = setInterval(() => {
        setJoinExpiresIn(prev => {
          if (prev <= 1) {
            if (joinTimerRef.current) clearInterval(joinTimerRef.current);
            setJoinCode(null);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } catch {
      // best-effort
    } finally {
      setJoinGenerating(false);
    }
  };

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (joinTimerRef.current) clearInterval(joinTimerRef.current);
    };
  }, []);

  const SECTIONS = [
    { key: 'clinic',       labelKey: 'settings.clinic_info',  icon: Building2 },
    { key: 'providers',    labelKey: 'nav.providers',         icon: Stethoscope },
    { key: 'payers',       labelKey: 'nav.payers',            icon: Building2 },
    { key: 'fee-schedule', labelKey: 'nav.fee_schedule',      icon: DollarSign },
    { key: 'connections',  labelKey: 'Connections',           icon: Wifi },
    { key: 'pairing',      labelKey: 'Clinic Pairing',        icon: Link2 },
    { key: 'availity',     labelKey: 'settings.availity',     icon: Users },
    { key: 'inmediata',    labelKey: 'inmediata.title',       icon: Zap },
    { key: 'ai',           labelKey: 'settings.ai',           icon: Cpu },
    { key: 'lang',         labelKey: 'settings.language',     icon: Globe },
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
                  active === key
                    ? 'bg-sky-50 text-sky-700'
                    : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                {t(labelKey)}
              </button>
            ))}
          </nav>
        </div>

        {/* Panel */}
        <div className="flex-1 bg-white rounded-xl border border-slate-200 p-6">
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
                  <label className={labelClass}>Provider / Doctor Name</label>
                  <input value={providerName} onChange={e => setProviderName(e.target.value)} className={inputClass} placeholder="Dra. María Cortés" />
                </div>
                <div>
                  <label className={labelClass}>NPI (Billing)</label>
                  <input value={clinicNpi} onChange={e => setClinicNpi(e.target.value)} className={inputClass} placeholder="1234567890" />
                </div>
                <div>
                  <label className={labelClass}>Tax ID / EIN</label>
                  <input value={clinicTax} onChange={e => setClinicTax(e.target.value)} className={inputClass} placeholder="12-3456789" />
                </div>
                <div>
                  <label className={labelClass}>{t('common.phone')}</label>
                  <input value={clinicPhone} onChange={e => setClinicPhone(formatPhone(e.target.value))} className={inputClass} placeholder="(787) 555-0000" maxLength={14} />
                </div>
                <div className="sm:col-span-2">
                  <label className={labelClass}>{t('settings.address')}</label>
                  <input value={clinicAddr} onChange={e => setClinicAddr(e.target.value)} className={inputClass} placeholder="Ave. Principal 123, San Juan, PR 00901" />
                </div>
              </div>
            </div>
          )}

          {/* Availity (Envolve) */}
          {active === 'availity' && (
            <div className="space-y-4">
              <h2 className="font-semibold text-slate-800 mb-4">{t('settings.availity')}</h2>
              <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-3 text-sm text-indigo-900 mb-2">
                {t('settings.availity_desc')}
              </div>
              <div>
                <label className={labelClass}>{t('settings.availity_client_id')}</label>
                <input
                  value={availityClientId}
                  onChange={e => setAvailityClientId(e.target.value)}
                  className={inputClass}
                  placeholder="availity-client-xxx"
                />
              </div>
              <div>
                <label className={labelClass}>{t('settings.availity_client_secret')}</label>
                <input
                  type="password"
                  value={availityClientSecret}
                  onChange={e => setAvailityClientSecret(e.target.value)}
                  className={inputClass}
                  placeholder="••••••••"
                />
                <p className="text-xs text-slate-400 mt-1">
                  {t('settings.get_api_key_at')}{' '}
                  <a href="https://developer.availity.com" target="_blank" rel="noreferrer" className="text-sky-600 hover:underline">developer.availity.com</a>
                </p>
              </div>
            </div>
          )}

          {/* Inmediata API */}
          {active === 'inmediata' && (
            <div className="space-y-4">
              <h2 className="font-semibold text-slate-800 mb-4">{t('inmediata.title')}</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={labelClass}>API Key</label>
                  <input
                    type="password"
                    value={inmApiKey}
                    onChange={e => setInmApiKey(e.target.value)}
                    className={inputClass}
                    placeholder="Enter API key..."
                  />
                </div>
                <div>
                  <label className={labelClass}>Submitter ID</label>
                  <input value={inmSubmitterId} onChange={e => setInmSubmitterId(e.target.value)} className={inputClass} placeholder="YOURID" />
                </div>
                <div>
                  <label className={labelClass}>Environment</label>
                  <select value={inmEnv} onChange={e => setInmEnv(e.target.value as 'sandbox' | 'production')} className={inputClass}>
                    <option value="sandbox">Sandbox</option>
                    <option value="production">Production</option>
                  </select>
                </div>
                <div>
                  <label className={labelClass}>API Base URL</label>
                  <input value={inmBaseUrl} onChange={e => setInmBaseUrl(e.target.value)} className={inputClass} placeholder="https://api.inmediata.com" />
                </div>
              </div>
              {inmEnv === 'sandbox' && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
                  Sandbox mode — claims will NOT be submitted to Inmediata for real processing.
                </div>
              )}
              <div className="flex items-center gap-3 mt-2">
                <button
                  onClick={handleTestConnection}
                  disabled={inmTesting}
                  className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 disabled:bg-emerald-300 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
                >
                  <Wifi className="w-4 h-4" />
                  {inmTesting ? 'Testing...' : 'Test Connection'}
                </button>
                {inmTestResult && (
                  <span className={`text-sm ${inmTestResult.success ? 'text-emerald-600' : 'text-red-600'}`}>
                    {inmTestResult.success ? '✓' : '✗'} {inmTestResult.message}
                  </span>
                )}
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
                <label className={labelClass}>OpenAI API Key</label>
                <input type="password" value={aiKey} onChange={e => setAiKey(e.target.value)} className={inputClass} placeholder="sk-..." />
              </div>
              <div>
                <label className={labelClass}>{t('settings.model')}</label>
                <select value={aiModel} onChange={e => setAiModel(e.target.value)} className={inputClass}>
                  <option value="gpt-4o">{t('settings.gpt4o')}</option>
                  <option value="gpt-4o-mini">{t('settings.gpt4o_mini')}</option>
                  <option value="gpt-4-turbo">{t('settings.gpt4_turbo')}</option>
                </select>
              </div>
            </div>
          )}

          {/* Providers */}
          {active === 'providers' && (
            <Suspense fallback={<div className="p-4 text-sm text-slate-400">Loading...</div>}>
              <div className="-m-6"><ProvidersPage /></div>
            </Suspense>
          )}

          {/* Payers */}
          {active === 'payers' && (
            <Suspense fallback={<div className="p-4 text-sm text-slate-400">Loading...</div>}>
              <div className="-m-6"><PayersPage /></div>
            </Suspense>
          )}

          {/* Fee Schedule */}
          {active === 'fee-schedule' && (
            <Suspense fallback={<div className="p-4 text-sm text-slate-400">Loading...</div>}>
              <div className="-m-6"><FeeSchedulePage /></div>
            </Suspense>
          )}

          {/* Connections — VistaNet + Wink */}
          {active === 'connections' && (
            <div className="space-y-6">
              <h2 className="font-semibold text-slate-800 mb-4">Connections</h2>

              {/* VistaNet */}
              <div className="border border-slate-200 rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className={`w-2.5 h-2.5 rounded-full ${vnConnected ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                    <h3 className="font-semibold text-slate-700">VistaNet</h3>
                  </div>
                  {vnConnected && !vnEditing && (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => { setVnEditing(true); setVnPassword(''); }}
                        className="text-xs font-medium text-sky-600 hover:text-sky-800 px-2 py-1 border border-sky-200 rounded"
                      >
                        Change Credentials
                      </button>
                      <button
                        onClick={handleVnDisconnect}
                        disabled={vnDisconnecting}
                        className="flex items-center gap-1 text-xs font-medium text-red-600 hover:text-red-800 px-2 py-1 border border-red-200 rounded"
                      >
                        <Unplug className="w-3 h-3" />
                        {vnDisconnecting ? '...' : 'Disconnect'}
                      </button>
                    </div>
                  )}
                </div>

                {vnConnected && !vnEditing ? (
                  <div className="space-y-1 text-sm">
                    <p className="text-slate-600">Username: <span className="font-medium text-slate-800">{vnUsername}</span></p>
                    <p className="text-slate-600">Location: <span className="font-medium text-slate-800">{vnLocation}</span></p>
                    <p className="text-slate-600">Password: <span className="text-slate-400">{vnPasswordMasked}</span></p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {!vnConnected && (
                      <p className="text-sm text-slate-500">Connect to VistaNet Cloud to import bitácora data.</p>
                    )}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className={labelClass}>Username</label>
                        <input
                          value={vnUsername}
                          onChange={e => setVnUsername(e.target.value)}
                          className={inputClass}
                          placeholder="vistanet username"
                        />
                      </div>
                      <div>
                        <label className={labelClass}>Password</label>
                        <div className="relative">
                          <input
                            type={vnShowPassword ? 'text' : 'password'}
                            value={vnPassword}
                            onChange={e => setVnPassword(e.target.value)}
                            className={inputClass}
                            placeholder={vnEditing ? 'Enter new password' : 'password'}
                          />
                          <button
                            type="button"
                            onClick={() => setVnShowPassword(v => !v)}
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                          >
                            {vnShowPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                        </div>
                      </div>
                      <div>
                        <label className={labelClass}>Location</label>
                        <select
                          value={vnLocation}
                          onChange={e => setVnLocation(e.target.value)}
                          className={inputClass}
                        >
                          {vnLocations.length > 0 ? vnLocations.map(loc => (
                            <option key={loc} value={loc}>{loc}</option>
                          )) : (
                            <option value="MANATI">MANATI</option>
                          )}
                        </select>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={handleVnSave}
                        disabled={vnSaving || !vnUsername}
                        className="flex items-center gap-1.5 px-4 py-2 bg-sky-500 hover:bg-sky-600 text-white text-sm font-medium rounded-lg disabled:opacity-50"
                      >
                        <Save className="w-4 h-4" />
                        {vnSaving ? 'Saving...' : vnEditing ? 'Update' : 'Connect'}
                      </button>
                      {vnEditing && (
                        <button
                          onClick={() => setVnEditing(false)}
                          className="text-sm text-slate-500 hover:text-slate-700"
                        >
                          Cancel
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Wink */}
              <div className="border border-slate-200 rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className={`w-2.5 h-2.5 rounded-full ${winkClinicId ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                    <h3 className="font-semibold text-slate-700">Wink</h3>
                  </div>
                  {winkClinicId && (
                    <button
                      onClick={handleWinkDisconnect}
                      className="flex items-center gap-1 text-xs font-medium text-red-600 hover:text-red-800 px-2 py-1 border border-red-200 rounded"
                    >
                      <Unplug className="w-3 h-3" />
                      Disconnect
                    </button>
                  )}
                </div>

                {winkClinicId ? (
                  <div className="space-y-1 text-sm">
                    <p className="text-slate-600">Clinic: <span className="font-medium text-slate-800">{winkClinicName || 'Connected'}</span></p>
                    <p className="text-slate-600">Clinic ID: <span className="font-mono text-xs text-slate-400">{winkClinicId}</span></p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="text-sm text-slate-500">Connect to a Wink clinic using a join code.</p>
                    <div className="flex items-center gap-2">
                      <input
                        value={winkJoinCode}
                        onChange={e => setWinkJoinCode(e.target.value.toUpperCase())}
                        className={`${inputClass} max-w-[200px] font-mono tracking-widest`}
                        placeholder="ABC123"
                        maxLength={6}
                      />
                      <button
                        onClick={handleWinkPair}
                        disabled={winkPairing || !winkJoinCode.trim()}
                        className="flex items-center gap-1.5 px-4 py-2 bg-sky-500 hover:bg-sky-600 text-white text-sm font-medium rounded-lg disabled:opacity-50"
                      >
                        <Link2 className="w-4 h-4" />
                        {winkPairing ? 'Pairing...' : 'Connect'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Clinic Pairing / Join Codes */}
          {active === 'pairing' && (
            <div className="space-y-4">
              <h2 className="font-semibold text-slate-800 mb-4">Clinic Pairing</h2>
              <p className="text-sm text-slate-600">
                Generate a temporary join code to pair an external system (like Wink) with this clinic.
                Codes expire after 5 minutes.
              </p>
              {joinCode ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-center bg-slate-50 border border-slate-200 rounded-xl py-8">
                    <span className="text-4xl font-mono font-bold tracking-[0.3em] text-sky-700 select-all">
                      {joinCode}
                    </span>
                  </div>
                  <div className="text-center text-sm text-slate-500">
                    Expires in <span className="font-medium text-slate-700">{Math.floor(joinExpiresIn / 60)}:{String(joinExpiresIn % 60).padStart(2, '0')}</span>
                  </div>
                  <button
                    onClick={handleGenerateJoinCode}
                    disabled={joinGenerating}
                    className="w-full flex items-center justify-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium px-4 py-2 rounded-lg transition-colors"
                  >
                    Generate New Code
                  </button>
                </div>
              ) : (
                <button
                  onClick={handleGenerateJoinCode}
                  disabled={joinGenerating}
                  className="flex items-center gap-2 bg-sky-500 hover:bg-sky-600 disabled:bg-sky-300 text-white text-sm font-medium px-5 py-2.5 rounded-lg transition-colors"
                >
                  <Link2 className="w-4 h-4" />
                  {joinGenerating ? 'Generating...' : 'Generate Join Code'}
                </button>
              )}
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
                  <button
                    key={code}
                    onClick={() => i18n.changeLanguage(code)}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg border text-sm font-medium transition-colors ${
                      i18n.language === code
                        ? 'border-sky-500 bg-sky-50 text-sky-700'
                        : 'border-slate-200 text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <span className="text-xl">{flag}</span>
                    {t(labelKey)}
                    {i18n.language === code && <CheckCircle className="w-4 h-4 ml-auto text-sky-500" />}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Save */}
          {active !== 'lang' && active !== 'providers' && active !== 'payers' && active !== 'fee-schedule' && active !== 'pairing' && active !== 'connections' && (
            <div className="mt-6 flex items-center gap-3">
              <button
                onClick={handleSave}
                className="flex items-center gap-2 bg-sky-500 hover:bg-sky-600 text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors"
              >
                <Save className="w-4 h-4" />
                {saved ? t('settings.saved') : t('settings.save')}
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
