import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  Building2, Stethoscope, Shield, Zap, CheckCircle,
  ChevronRight, ChevronLeft, Check, Loader2,
} from 'lucide-react';
import api from '../lib/api';
import { formatPhone } from '../lib/format';

const STEPS = [
  { id: 'clinic',        label: 'Clinic Info',       icon: Building2 },
  { id: 'payers',        label: 'Payer Enrollments', icon: Shield },
  { id: 'clearinghouse', label: 'Clearinghouse',     icon: Zap },
  { id: 'done',          label: 'Done!',             icon: CheckCircle },
];

const PR_PAYERS = [
  { id: 'TSS',      name: 'Triple-S Salud' },
  { id: 'MCS',      name: 'MCS Healthcare' },
  { id: 'MMM',      name: 'MMM Healthcare' },
  { id: '56190',    name: 'Envolve Vision (Availity)' },
  { id: 'REFORMA',  name: 'Reforma / First Medical' },
  { id: 'HUMANA',   name: 'Humana Puerto Rico' },
  { id: 'MEDICARE', name: 'Medicare Part B' },
  { id: 'ASES',     name: 'ASES / Platino' },
];

const inputClass = 'w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500';
const labelClass = 'block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1';

export default function SetupWizardPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [saved, setSaved] = useState(false);

  // Form state
  const [clinicName, setClinicName] = useState('Visual Zone Optical');
  const [address, setAddress]       = useState('');
  const [city, setCity]             = useState('Manatí');
  const [zip, setZip]               = useState('');
  const [phone, setPhone]           = useState('');
  const [taxId, setTaxId]           = useState('');
  const [npiOrg, setNpiOrg]         = useState('');
  const [enrolledPayers, setEnrolledPayers] = useState<string[]>(['TSS', 'MCS', 'MMM', '56190']);
  const [stediKey, setStediKey]         = useState('');
  const [availityClientId, setAvailityClientId]     = useState('');
  const [availitySecret, setAvailitySecret]   = useState('');
  const [inmediataHost, setInmediataHost] = useState('sftp.inmediata.com');
  const [inmediataUser, setInmediataUser] = useState('');

  // Load existing settings
  const { data: existingSettings } = useQuery({
    queryKey: ['clinic-settings'],
    queryFn: () => api.get('/clinic/settings').then(r => r.data),
    retry: false,
  });

  useEffect(() => {
    if (existingSettings) {
      setClinicName(existingSettings.clinic_name || 'Visual Zone Optical');
      setAddress(existingSettings.address_line1 || '');
      setCity(existingSettings.city || 'Manatí');
      setZip(existingSettings.zip_code || '');
      setPhone(existingSettings.phone || '');
      setTaxId(existingSettings.tax_id || '');
      setNpiOrg(existingSettings.npi_org || '');
    }
  }, [existingSettings]);

  const saveMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => api.put('/clinic/settings', data),
    onSuccess: () => setSaved(true),
  });

  const handleFinish = async () => {
    await saveMutation.mutateAsync({
      clinic_name: clinicName,
      address_line1: address,
      city,
      state: 'PR',
      zip_code: zip,
      phone,
      tax_id: taxId,
      npi_org: npiOrg,
      payer_enrollments: enrolledPayers.map(id => ({
        payer_id: id,
        payer_name: PR_PAYERS.find(p => p.id === id)?.name || id,
      })),
      stedi_api_key: stediKey || undefined,
      availity_client_id: availityClientId || undefined,
      availity_client_secret: availitySecret || undefined,
      inmediata_sftp_host: inmediataHost || undefined,
      inmediata_sftp_user: inmediataUser || undefined,
      setup_complete: true,
    });
    setStep(3);
  };

  const togglePayer = (id: string) => {
    setEnrolledPayers(prev =>
      prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]
    );
  };

  const currentStepObj = STEPS[step];

  return (
    <div className="p-6 max-w-2xl mx-auto">
      {/* Header */}
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-bold text-slate-900 mb-1">{t('wizard.title')}</h1>
        <p className="text-slate-500 text-sm">{t('wizard.subtitle')}</p>
      </div>

      {/* Step indicator */}
      <div className="flex items-center justify-between mb-8 px-4">
        {STEPS.map((s, i) => {
          const Icon = s.icon;
          const isActive = i === step;
          const isDone = i < step || step === 3;
          return (
            <div key={s.id} className="flex items-center flex-1 last:flex-none">
              <div className="flex flex-col items-center gap-1">
                <div className={`w-9 h-9 rounded-full flex items-center justify-center border-2 transition-all ${
                  isDone && i < step ? 'border-emerald-500 bg-emerald-500 text-white' :
                  isActive ? 'border-sky-500 bg-sky-500 text-white' :
                  'border-slate-200 bg-white text-slate-400'
                }`}>
                  {isDone && i < step ? <Check className="w-4 h-4" /> : <Icon className="w-4 h-4" />}
                </div>
                <span className={`text-xs font-medium whitespace-nowrap ${
                  isActive ? 'text-sky-600' : isDone && i < step ? 'text-emerald-600' : 'text-slate-400'
                }`}>
                  {s.label}
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <div className={`flex-1 h-0.5 mb-5 mx-2 ${i < step ? 'bg-emerald-400' : 'bg-slate-100'}`} />
              )}
            </div>
          );
        })}
      </div>

      {/* Step content */}
      <div className="bg-white rounded-xl border border-slate-200 p-6">

        {/* Step 0: Clinic Info */}
        {step === 0 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-slate-800 mb-4 flex items-center gap-2">
              <Building2 className="w-5 h-5 text-sky-500" />
              {t('wizard.step_clinic')}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label className={labelClass}>{t('wizard.clinic_name')}</label>
                <input value={clinicName} onChange={e => setClinicName(e.target.value)} className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>{t('wizard.tax_id')}</label>
                <input value={taxId} onChange={e => setTaxId(e.target.value)} placeholder="XX-XXXXXXX" className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>{t('wizard.npi_org')}</label>
                <input value={npiOrg} onChange={e => setNpiOrg(e.target.value)} placeholder="1234567890" className={inputClass} />
              </div>
              <div className="sm:col-span-2">
                <label className={labelClass}>{t('wizard.address')}</label>
                <input value={address} onChange={e => setAddress(e.target.value)} className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>{t('wizard.city')}</label>
                <input value={city} onChange={e => setCity(e.target.value)} className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>{t('wizard.zip')}</label>
                <input value={zip} onChange={e => setZip(e.target.value)} className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>{t('wizard.phone')}</label>
                <input value={phone} onChange={e => setPhone(formatPhone(e.target.value))} className={inputClass} maxLength={14} />
              </div>
            </div>
          </div>
        )}

        {/* Step 1: Payer Enrollments */}
        {step === 1 && (
          <div>
            <h2 className="text-lg font-semibold text-slate-800 mb-2 flex items-center gap-2">
              <Shield className="w-5 h-5 text-sky-500" />
              {t('wizard.step_payers')}
            </h2>
            <p className="text-sm text-slate-500 mb-4">{t('wizard.enrolled_payers')}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {PR_PAYERS.map(payer => {
                const checked = enrolledPayers.includes(payer.id);
                return (
                  <label
                    key={payer.id}
                    className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                      checked ? 'bg-sky-50 border-sky-300' : 'border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => togglePayer(payer.id)}
                      className="w-4 h-4 text-sky-500"
                    />
                    <div>
                      <p className="text-sm font-medium text-slate-800">{payer.name}</p>
                      <p className="text-xs text-slate-400">ID: {payer.id}</p>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>
        )}

        {/* Step 2: Clearinghouse */}
        {step === 2 && (
          <div className="space-y-5">
            <h2 className="text-lg font-semibold text-slate-800 mb-4 flex items-center gap-2">
              <Zap className="w-5 h-5 text-sky-500" />
              {t('wizard.step_clearinghouse')}
            </h2>

            {/* Stedi */}
            <div>
              <h3 className="text-sm font-semibold text-slate-700 mb-2">Stedi</h3>
              <label className={labelClass}>{t('wizard.stedi_key')}</label>
              <input type="password" value={stediKey} onChange={e => setStediKey(e.target.value)}
                placeholder="test_..." className={inputClass} />
              <p className="text-xs text-slate-400 mt-1">Leave blank to keep existing key</p>
            </div>

            {/* Availity */}
            <div>
              <h3 className="text-sm font-semibold text-slate-700 mb-2">Availity (Envolve Vision — Payer ID 56190)</h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>{t('wizard.availity_client_id')}</label>
                  <input value={availityClientId} onChange={e => setAvailityClientId(e.target.value)} className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>{t('wizard.availity_secret')}</label>
                  <input type="password" value={availitySecret} onChange={e => setAvailitySecret(e.target.value)} className={inputClass} />
                </div>
              </div>
            </div>

            {/* Inmediata */}
            <div>
              <h3 className="text-sm font-semibold text-slate-700 mb-2">Inmediata SFTP</h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>{t('wizard.inmediata_host')}</label>
                  <input value={inmediataHost} onChange={e => setInmediataHost(e.target.value)} className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>{t('wizard.inmediata_user')}</label>
                  <input value={inmediataUser} onChange={e => setInmediataUser(e.target.value)} className={inputClass} />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Step 3: Done */}
        {step === 3 && (
          <div className="text-center py-8">
            <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-4">
              <CheckCircle className="w-8 h-8 text-emerald-600" />
            </div>
            <h2 className="text-xl font-bold text-slate-900 mb-2">{t('wizard.complete')}</h2>
            <p className="text-slate-500 mb-6">{t('wizard.complete_msg')}</p>
            <button
              onClick={() => navigate('/')}
              className="px-6 py-2.5 bg-sky-500 hover:bg-sky-600 text-white rounded-lg font-medium"
            >
              Go to Dashboard
            </button>
          </div>
        )}
      </div>

      {/* Navigation */}
      {step < 3 && (
        <div className="flex items-center justify-between mt-5">
          <button
            onClick={() => step > 0 ? setStep(s => s - 1) : navigate('/')}
            className="flex items-center gap-1 px-4 py-2 text-sm text-slate-600 hover:text-slate-900 rounded-lg hover:bg-slate-100"
          >
            <ChevronLeft className="w-4 h-4" />
            {step === 0 ? t('wizard.skip') : t('wizard.back')}
          </button>

          {step < 2 ? (
            <button
              onClick={() => setStep(s => s + 1)}
              className="flex items-center gap-1 px-5 py-2 bg-sky-500 hover:bg-sky-600 text-white text-sm font-medium rounded-lg"
            >
              {t('wizard.next')}
              <ChevronRight className="w-4 h-4" />
            </button>
          ) : (
            <button
              onClick={handleFinish}
              disabled={saveMutation.isPending}
              className="flex items-center gap-2 px-5 py-2 bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-medium rounded-lg disabled:opacity-60"
            >
              {saveMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Check className="w-4 h-4" />
              )}
              {t('wizard.finish')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
