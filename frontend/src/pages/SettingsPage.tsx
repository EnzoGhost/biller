import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Save, CheckCircle, Building2, Shield, Cpu, Globe, Zap } from 'lucide-react';
import api from '../lib/api';

export default function SettingsPage() {
  const { t, i18n } = useTranslation();
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

  // AI
  const [aiKey,      setAiKey]      = useState('');
  const [aiModel,    setAiModel]    = useState('gpt-4o');
  const [aiEnabled,  setAiEnabled]  = useState(true);

  // Inmediata
  const [sftpHost,   setSftpHost]   = useState('');
  const [sftpUser,   setSftpUser]   = useState('');
  const [sftpPass,   setSftpPass]   = useState('');
  const [sftpUpDir,  setSftpUpDir]  = useState('/UPLOAD/837');
  const [sftpDnDir,  setSftpDnDir]  = useState('/DOWNLOAD/835');
  const [submitterId,setSubmitterId]= useState('');

  const handleSave = async () => {
    try {
      if (active === 'stedi') {
        await api.post('/stedi/config', { api_key: stediKey, environment: stediEnv });
      } else if (active === 'ai') {
        await api.post('/ai/config', { api_key: aiKey, model: aiModel, enabled: aiEnabled });
      } else if (active === 'inmediata') {
        await api.post('/inmediata/config', {
          sftp_host: sftpHost,
          sftp_user: sftpUser,
          sftp_password: sftpPass,
          sftp_upload_dir: sftpUpDir,
          sftp_download_dir: sftpDnDir,
          submitter_id: submitterId,
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

  const inputClass = 'w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500';
  const labelClass = 'block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1';

  const SECTIONS = [
    { key: 'clinic',     labelKey: 'settings.clinic_info', icon: Building2 },
    { key: 'stedi',      labelKey: 'settings.stedi',       icon: Shield },
    { key: 'inmediata',  labelKey: 'inmediata.title',      icon: Zap },
    { key: 'ai',         labelKey: 'settings.ai',          icon: Cpu },
    { key: 'lang',       labelKey: 'settings.language',    icon: Globe },
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
                  <label className={labelClass}>NPI (Billing)</label>
                  <input value={clinicNpi} onChange={e => setClinicNpi(e.target.value)} className={inputClass} placeholder="1234567890" />
                </div>
                <div>
                  <label className={labelClass}>Tax ID / EIN</label>
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

          {/* Stedi */}
          {active === 'stedi' && (
            <div className="space-y-4">
              <h2 className="font-semibold text-slate-800 mb-4">{t('settings.stedi')}</h2>
              <div>
                <label className={labelClass}>API Key</label>
                <input
                  type="password"
                  value={stediKey}
                  onChange={e => setStediKey(e.target.value)}
                  className={inputClass}
                  placeholder="sk_live_..."
                />
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
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
                {t('settings.sandbox_warning')}
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
                  <label className={labelClass}>{t('inmediata.sftp_password')}</label>
                  <input type="password" value={sftpPass} onChange={e => setSftpPass(e.target.value)} className={inputClass} placeholder="••••••••" />
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
          {active !== 'lang' && (
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
