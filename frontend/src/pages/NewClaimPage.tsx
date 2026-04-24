import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2, ArrowLeft, LayoutTemplate } from 'lucide-react';
import api from '../lib/api';
import DatePicker from '../components/ui/DatePicker';
import SearchableSelect from '../components/ui/SearchableSelect';
import ICD10Input from '../components/ui/ICD10Input';
import CPTInput from '../components/ui/CPTInput';
import type { CPTCode } from '../lib/cpt';
import type { Patient, Provider, Payer, ClaimTemplate } from '../types';

interface ServiceLineForm {
  cpt_code: string;
  description: string;
  units: number;
  billed_amount: number;
  place_of_service: string;
  modifiers: string;
}

const defaultLine = (): ServiceLineForm => ({
  cpt_code: '',
  description: '',
  units: 1,
  billed_amount: 0,
  place_of_service: '11',
  modifiers: '',
});

const inputClass = 'w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500';
const labelClass = 'block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1';

export default function NewClaimPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  // Form state
  const [patientId,    setPatientId]    = useState('');
  const [providerId,   setProviderId]   = useState('');
  const [payerId,      setPayerId]      = useState('');
  const [serviceDateFrom, setServiceDateFrom] = useState('');
  const [serviceDateTo,   setServiceDateTo]   = useState('');
  const [placeOfService, setPlaceOfService]   = useState('11');
  const [diagCodes,    setDiagCodes]    = useState('');
  const [priorAuth,    setPriorAuth]    = useState('');
  const [lines,        setLines]        = useState<ServiceLineForm[]>([defaultLine()]);
  const [notes,        setNotes]        = useState('');

  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [templateApplied, setTemplateApplied] = useState(false);

  const { data: templates = [] } = useQuery<ClaimTemplate[]>({
    queryKey: ['templates'],
    queryFn: () => api.get('/templates/').then(r => r.data),
  });

  const applyTemplate = (templateId: string) => {
    const tmpl = templates.find(t => String(t.id) === templateId);
    if (!tmpl) return;
    // Set diagnosis codes
    if (tmpl.diagnosis_codes.length > 0) {
      setDiagCodes(tmpl.diagnosis_codes.join(', '));
    }
    // Set POS
    if (tmpl.place_of_service) {
      setPlaceOfService(tmpl.place_of_service);
    }
    // Set service lines
    if (tmpl.cpt_codes.length > 0) {
      setLines(tmpl.cpt_codes.map(c => ({
        cpt_code: c.code,
        description: c.desc || '',
        units: c.units || 1,
        billed_amount: c.amount || 0,
        place_of_service: tmpl.place_of_service || '11',
        modifiers: '',
      })));
    }
    setTemplateApplied(true);
    setTimeout(() => setTemplateApplied(false), 2000);
    setSelectedTemplate(templateId);
  };

  // Reference data
  const { data: patients } = useQuery<{ items: Patient[] }>({
    queryKey: ['patients-all'],
    queryFn: () => api.get('/patients?per_page=500').then(r => r.data),
  });
  const { data: providers } = useQuery<{ items: Provider[] }>({
    queryKey: ['providers-all'],
    queryFn: () => api.get('/providers?per_page=200').then(r => r.data),
  });
  const { data: payers } = useQuery<{ items: Payer[] }>({
    queryKey: ['payers-all'],
    queryFn: () => api.get('/payers?per_page=200').then(r => r.data),
  });

  const mutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => api.post('/claims', payload),
    onSuccess: (res) => navigate(`/claims/${res.data.id}`),
  });

  const updateLine = (i: number, patch: Partial<ServiceLineForm>) => {
    setLines(prev => prev.map((l, idx) => idx === i ? { ...l, ...patch } : l));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    mutation.mutate({
      patient_id:       Number(patientId),
      provider_id:      Number(providerId),
      payer_id:         Number(payerId),
      service_date_from: serviceDateFrom,
      service_date_to:   serviceDateTo || undefined,
      place_of_service:  placeOfService,
      diagnosis_codes:   diagCodes.split(',').map(d => d.trim()).filter(Boolean),
      prior_auth_number: priorAuth || undefined,
      notes:             notes || undefined,
      service_lines:     lines.map((l, i) => ({
        line_number:     i + 1,
        cpt_code:        l.cpt_code,
        description:     l.description,
        units:           l.units,
        billed_amount:   l.billed_amount,
        place_of_service: l.place_of_service,
        modifiers:       l.modifiers ? l.modifiers.split(',').map(m => m.trim()) : [],
        diagnosis_pointers: [0],
      })),
    });
  };

  // Build options for searchable selects
  const patientOptions = (patients?.items ?? []).map(p => ({
    value: String(p.id),
    label: `${p.last_name}, ${p.first_name}`,
  }));
  const providerOptions = (providers?.items ?? []).map(p => ({
    value: String(p.id),
    label: `${p.last_name}, ${p.first_name}`,
  }));
  const payerOptions = (payers?.items ?? []).map(p => ({
    value: String(p.id),
    label: p.name,
  }));

  const posOptions = [
    { value: '11', label: t('pos.11') },
    { value: '21', label: t('pos.21') },
    { value: '22', label: t('pos.22') },
    { value: '23', label: t('pos.23') },
    { value: '31', label: t('pos.31') },
    { value: '12', label: t('pos.12') },
  ];

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate(-1)} className="text-slate-400 hover:text-slate-700">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-xl font-bold text-slate-900">{t('claims.new')}</h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Template Selector */}
        {templates.length > 0 && (
          <div className="bg-sky-50 border border-sky-200 rounded-xl p-4 flex items-center gap-3">
            <LayoutTemplate className="w-4 h-4 text-sky-600 shrink-0" />
            <label className="text-sm font-medium text-sky-700">{t('templates.select')}</label>
            <select
              value={selectedTemplate}
              onChange={e => applyTemplate(e.target.value)}
              className="flex-1 px-3 py-1.5 text-sm border border-sky-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-sky-500"
            >
              <option value="">{t('templates.placeholder')}</option>
              {templates.map(t => (
                <option key={t.id} value={String(t.id)}>{t.name}</option>
              ))}
            </select>
            {templateApplied && (
              <span className="text-xs text-emerald-600 font-medium">✔ {t('templates.applied')}</span>
            )}
          </div>
        )}

        {/* Patient / Provider / Payer */}
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <h2 className="font-semibold text-slate-800 mb-4">{t('claims.general_info')}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className={labelClass}>{t('claims.patient')} *</label>
              <SearchableSelect
                options={patientOptions}
                value={patientId}
                onChange={setPatientId}
                placeholder={t('common.select_placeholder')}
                required
              />
            </div>
            <div>
              <label className={labelClass}>{t('claims.provider')} *</label>
              <SearchableSelect
                options={providerOptions}
                value={providerId}
                onChange={setProviderId}
                placeholder={t('common.select_placeholder')}
                required
              />
            </div>
            <div>
              <label className={labelClass}>{t('claims.payer')} *</label>
              <SearchableSelect
                options={payerOptions}
                value={payerId}
                onChange={setPayerId}
                placeholder={t('common.select_placeholder')}
                required
              />
            </div>
          </div>
        </div>

        {/* Dates & Codes */}
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <h2 className="font-semibold text-slate-800 mb-4">{t('claims.dates_and_codes')}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <DatePicker
                label={`${t('claims.service_date_from')} *`}
                value={serviceDateFrom}
                onChange={setServiceDateFrom}
                required
              />
            </div>
            <div>
              <DatePicker
                label={t('claims.service_date_to')}
                value={serviceDateTo}
                onChange={setServiceDateTo}
              />
            </div>
            <div>
              <label className={labelClass}>{t('claims.place_of_service')}</label>
              <select
                value={placeOfService}
                onChange={e => setPlaceOfService(e.target.value)}
                className={inputClass}
              >
                {posOptions.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className={labelClass}>
                {t('claims.diagnosis_codes')} ({t('claims.diagnosis_codes_hint')}) *
              </label>
              <ICD10Input
                value={diagCodes}
                onChange={setDiagCodes}
                required
              />
            </div>
            <div>
              <label className={labelClass}>{t('claims.prior_auth')}</label>
              <input
                value={priorAuth}
                onChange={e => setPriorAuth(e.target.value)}
                placeholder="PA123456"
                className={inputClass}
              />
            </div>
          </div>
        </div>

        {/* Service Lines */}
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-slate-800">{t('claims.procedure_codes')}</h2>
            <button
              type="button"
              onClick={() => setLines(prev => [...prev, defaultLine()])}
              className="flex items-center gap-1 text-sky-600 hover:text-sky-700 text-sm font-medium"
            >
              <Plus className="w-4 h-4" /> {t('claims.add_line')}
            </button>
          </div>

          <div className="space-y-3">
            {lines.map((line, i) => (
              <div key={i} className="grid grid-cols-12 gap-2 items-end p-3 bg-slate-50 rounded-lg">
                <div className="col-span-2">
                  {i === 0 && <label className={labelClass}>CPT *</label>}
                  <CPTInput
                    value={line.cpt_code}
                    onChange={v => updateLine(i, { cpt_code: v })}
                    onSelect={(cpt: CPTCode) => updateLine(i, {
                      cpt_code: cpt.code,
                      description: cpt.description,
                      billed_amount: cpt.standardFee,
                    })}
                    required
                  />
                </div>
                <div className="col-span-4">
                  {i === 0 && <label className={labelClass}>{t('common.description')}</label>}
                  <input
                    value={line.description}
                    onChange={e => updateLine(i, { description: e.target.value })}
                    placeholder="Office visit..."
                    className={inputClass}
                  />
                </div>
                <div className="col-span-1">
                  {i === 0 && <label className={labelClass}>{t('common.units_abbr')}</label>}
                  <input
                    type="number"
                    min="1"
                    value={line.units}
                    onChange={e => updateLine(i, { units: Number(e.target.value) })}
                    className={inputClass}
                  />
                </div>
                <div className="col-span-2">
                  {i === 0 && <label className={labelClass}>{t('common.amount')}</label>}
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={line.billed_amount}
                    onChange={e => updateLine(i, { billed_amount: Number(e.target.value) })}
                    className={inputClass}
                  />
                </div>
                <div className="col-span-2">
                  {i === 0 && <label className={labelClass}>{t('claims.modifiers_abbr')}</label>}
                  <input
                    value={line.modifiers}
                    onChange={e => updateLine(i, { modifiers: e.target.value })}
                    placeholder="25,59"
                    className={inputClass}
                  />
                </div>
                <div className="col-span-1 flex justify-end">
                  {lines.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setLines(prev => prev.filter((_, idx) => idx !== i))}
                      className="p-2 text-red-400 hover:text-red-600"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-3 text-right text-sm font-semibold text-slate-800">
            {t('common.total')}:{' '}
            {new Intl.NumberFormat('es-PR', { style: 'currency', currency: 'USD' }).format(
              lines.reduce((s, l) => s + l.billed_amount * l.units, 0)
            )}
          </div>
        </div>

        {/* Notes */}
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <label className={labelClass}>{t('common.notes')}</label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={3}
            className={inputClass}
            placeholder={t('claims.internal_notes_placeholder')}
          />
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={mutation.isPending}
            className="bg-sky-500 hover:bg-sky-600 disabled:opacity-50 text-white text-sm font-medium px-6 py-2.5 rounded-lg transition-colors"
          >
            {mutation.isPending ? t('common.loading') : t('claims.create')}
          </button>
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="text-slate-600 hover:text-slate-900 text-sm font-medium px-4 py-2.5 border border-slate-200 rounded-lg transition-colors"
          >
            {t('common.cancel')}
          </button>
          {mutation.isError && (
            <p className="text-red-600 text-sm">{t('common.error')}</p>
          )}
        </div>
      </form>
    </div>
  );
}
