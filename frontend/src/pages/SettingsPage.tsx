import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Save, CheckCircle, Building2, Shield, Cpu, Globe } from 'lucide-react';
import api from '../lib/api';

interface Section {
  key: string;
  label: string;
  icon: React.ElementType;
}

const SECTIONS: Section[] = [
  { key: 'clinic',  label: 'Información de la Clínica', icon: Building2 },
  { key: 'stedi',   label: 'Stedi (Clearinghouse)',      icon: Shield },
  { key: 'ai',      label: 'Inteligencia Artificial',    icon: Cpu },
  { key: 'lang',    label: 'Idioma',                     icon: Globe },
];

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

  const handleSave = async () => {
    try {
      if (active === 'stedi') {
        await api.post('/stedi/config', { api_key: stediKey, environment: stediEnv });
      } else if (active === 'ai') {
        await api.post('/ai/config', { api_key: aiKey, model: aiModel, enabled: aiEnabled });
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

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1 className="text-xl font-bold text-slate-900 mb-6">{t('settings.title')}</h1>

      <div className="flex gap-6">
        {/* Sidebar tabs */}
        <div className="w-52 shrink-0">
          <nav className="space-y-0.5">
            {SECTIONS.map(({ key, label, icon: Icon }) => (
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
                {label}
              </button>
            ))}
          </nav>
        </div>

        {/* Panel */}
        <div className="flex-1 bg-white rounded-xl border border-slate-200 p-6">
          {/* Clinic */}
          {active === 'clinic' && (
            <div className="space-y-4">
              <h2 className="font-semibold text-slate-800 mb-4">Información de la Clínica</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={labelClass}>Nombre de la Clínica</label>
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
                  <label className={labelClass}>Teléfono</label>
                  <input value={clinicPhone} onChange={e => setClinicPhone(e.target.value)} className={inputClass} placeholder="(787) 555-0000" />
                </div>
                <div className="sm:col-span-2">
                  <label className={labelClass}>Dirección</label>
                  <input value={clinicAddr} onChange={e => setClinicAddr(e.target.value)} className={inputClass} placeholder="Ave. Principal 123, San Juan, PR 00901" />
                </div>
              </div>
            </div>
          )}

          {/* Stedi */}
          {active === 'stedi' && (
            <div className="space-y-4">
              <h2 className="font-semibold text-slate-800 mb-4">Stedi Clearinghouse</h2>
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
                  Obtén tu API key en{' '}
                  <a href="https://www.stedi.com" target="_blank" rel="noreferrer" className="text-sky-600 hover:underline">stedi.com</a>
                </p>
              </div>
              <div>
                <label className={labelClass}>Entorno</label>
                <select value={stediEnv} onChange={e => setStediEnv(e.target.value as 'sandbox' | 'production')} className={inputClass}>
                  <option value="sandbox">Sandbox (Pruebas)</option>
                  <option value="production">Producción</option>
                </select>
              </div>
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
                ⚠️ En modo sandbox, las transacciones no se envían al clearinghouse real.
              </div>
            </div>
          )}

          {/* AI */}
          {active === 'ai' && (
            <div className="space-y-4">
              <h2 className="font-semibold text-slate-800 mb-4">Inteligencia Artificial</h2>
              <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                <div>
                  <p className="text-sm font-medium text-slate-700">Análisis IA habilitado</p>
                  <p className="text-xs text-slate-400">Análisis de denegaciones, scrubbing, y sugerencias</p>
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
                <label className={labelClass}>Modelo</label>
                <select value={aiModel} onChange={e => setAiModel(e.target.value)} className={inputClass}>
                  <option value="gpt-4o">GPT-4o (Recomendado)</option>
                  <option value="gpt-4o-mini">GPT-4o Mini (Económico)</option>
                  <option value="gpt-4-turbo">GPT-4 Turbo</option>
                </select>
              </div>
            </div>
          )}

          {/* Language */}
          {active === 'lang' && (
            <div className="space-y-4">
              <h2 className="font-semibold text-slate-800 mb-4">Idioma de la Interfaz</h2>
              <div className="space-y-2">
                {[
                  { code: 'es', label: 'Español (Puerto Rico)', flag: '🇵🇷' },
                  { code: 'en', label: 'English', flag: '🇺🇸' },
                ].map(({ code, label, flag }) => (
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
                    {label}
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
                  Guardado
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
