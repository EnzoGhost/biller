import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Search, Users, Phone, FileText, Plus, X, Check, Trash2 } from 'lucide-react';
import api from '../lib/api';
import { formatDate } from '../lib/dates';
import type { Patient, Payer, PaginatedResponse, Gender } from '../types';

const GENDERS: Gender[] = ['M', 'F', 'U'];
const US_STATES = [
  'PR','AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN',
  'IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH',
  'NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT',
  'VT','VA','WA','WV','WI','WY',
];

type InsuranceForm = {
  payer_id: number | '';
  member_id: string;
  group_number: string;
  subscriber_name: string;
  relationship_to_subscriber: string;
  effective_date: string;
  termination_date: string;
  is_primary: boolean;
};

type PatientForm = {
  first_name: string;
  last_name: string;
  dob: string;
  gender: Gender;
  phone: string;
  email: string;
  address_line1: string;
  city: string;
  state: string;
  zip_code: string;
  insurances: InsuranceForm[];
};

const EMPTY_INS: InsuranceForm = {
  payer_id: '', member_id: '', group_number: '', subscriber_name: '',
  relationship_to_subscriber: 'self', effective_date: '', termination_date: '',
  is_primary: true,
};

const EMPTY_FORM: PatientForm = {
  first_name: '', last_name: '', dob: '', gender: 'U',
  phone: '', email: '', address_line1: '', city: '', state: 'PR', zip_code: '',
  insurances: [{ ...EMPTY_INS }],
};

export default function PatientsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Patient | null>(null);
  const [form, setForm] = useState<PatientForm>(EMPTY_FORM);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3500);
  };

  const { data, isLoading } = useQuery<PaginatedResponse<Patient>>({
    queryKey: ['patients', search],
    queryFn: () => api.get(`/patients?per_page=100${search ? `&search=${search}` : ''}`).then(r => r.data),
  });

  const { data: payersData } = useQuery<PaginatedResponse<Payer>>({
    queryKey: ['payers-all'],
    queryFn: () => api.get('/payers?per_page=100').then(r => r.data),
  });
  const payers = payersData?.items ?? [];

  const createMutation = useMutation({
    mutationFn: (body: PatientForm) => api.post('/patients', {
      ...body,
      insurances: body.insurances.filter(i => i.payer_id !== '').map(i => ({
        ...i,
        payer_id: Number(i.payer_id),
        effective_date: i.effective_date || null,
        termination_date: i.termination_date || null,
      })),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['patients'] });
      closeModal();
      showToast(t('patients.created'));
    },
    onError: () => showToast(t('common.error'), false),
  });

  const updateMutation = useMutation({
    mutationFn: (body: PatientForm) => api.patch(`/patients/${editing!.id}`, {
      first_name: body.first_name,
      last_name: body.last_name,
      dob: body.dob,
      gender: body.gender,
      phone: body.phone,
      email: body.email,
      address_line1: body.address_line1,
      city: body.city,
      state: body.state,
      zip_code: body.zip_code,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['patients'] });
      closeModal();
      showToast(t('patients.updated'));
    },
    onError: () => showToast(t('common.error'), false),
  });

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setModalOpen(true);
  };

  const openEdit = (patient: Patient) => {
    setEditing(patient);
    setForm({
      first_name: patient.first_name,
      last_name: patient.last_name,
      dob: patient.dob,
      gender: patient.gender,
      phone: patient.phone ?? '',
      email: patient.email ?? '',
      address_line1: patient.address_line1 ?? '',
      city: patient.city ?? '',
      state: patient.state,
      zip_code: patient.zip_code ?? '',
      insurances: patient.insurances.length > 0
        ? patient.insurances.map(i => ({
            payer_id: i.payer_id,
            member_id: i.member_id,
            group_number: i.group_number ?? '',
            subscriber_name: i.subscriber_name ?? '',
            relationship_to_subscriber: i.relationship_to_subscriber,
            effective_date: i.effective_date ?? '',
            termination_date: i.termination_date ?? '',
            is_primary: i.is_primary,
          }))
        : [{ ...EMPTY_INS }],
    });
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditing(null);
    setForm(EMPTY_FORM);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editing) updateMutation.mutate(form);
    else createMutation.mutate(form);
  };

  const setField = (key: keyof PatientForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [key]: e.target.value }));

  const setInsField = (idx: number, key: keyof InsuranceForm) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm(f => {
        const ins = [...f.insurances];
        ins[idx] = { ...ins[idx], [key]: key === 'is_primary' ? (e.target as HTMLInputElement).checked : e.target.value };
        return { ...f, insurances: ins };
      });

  const addInsurance = () => setForm(f => ({ ...f, insurances: [...f.insurances, { ...EMPTY_INS, is_primary: false }] }));
  const removeInsurance = (idx: number) => setForm(f => ({ ...f, insurances: f.insurances.filter((_, i) => i !== idx) }));

  const patients = data?.items ?? [];
  const isPending = createMutation.isPending || updateMutation.isPending;

  const genderLabel = (g: Gender) => g === 'M' ? t('patients.male') : g === 'F' ? t('patients.female') : t('patients.unknown_gender');

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 flex items-center gap-2 px-4 py-3 rounded-lg shadow-lg text-sm font-medium text-white transition-all ${toast.ok ? 'bg-emerald-500' : 'bg-red-500'}`}>
          {toast.ok ? <Check className="w-4 h-4" /> : <X className="w-4 h-4" />}
          {toast.msg}
        </div>
      )}

      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-slate-900">{t('nav.patients')}</h1>
        <button
          onClick={openCreate}
          className="flex items-center gap-1.5 px-3 py-2 bg-sky-500 hover:bg-sky-600 text-white text-sm rounded-lg"
        >
          <Plus className="w-4 h-4" /> {t('patients.new')}
        </button>
      </div>

      {/* Search */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 mb-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t('common.search')}
            className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
          />
        </div>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex items-center justify-center h-40">
          <div className="w-5 h-5 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : !patients.length ? (
        <div className="text-center py-12 text-slate-400">{t('patients.no_patients')}</div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500">{t('patients.mrn')}</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500">{t('patients.name')}</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500">{t('patients.dob')}</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500">{t('common.phone')}</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500">{t('patients.insurance')}</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500">{t('claims.actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {patients.map(patient => {
                const primary = patient.insurances.find(i => i.is_primary) ?? patient.insurances[0];
                return (
                  <tr key={patient.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs text-slate-500">{patient.mrn ?? '—'}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-sky-100 flex items-center justify-center shrink-0">
                          <Users className="w-3.5 h-3.5 text-sky-600" />
                        </div>
                        <div>
                          <p className="font-medium text-slate-900">{patient.first_name} {patient.last_name}</p>
                          <p className="text-xs text-slate-400">{genderLabel(patient.gender)}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{formatDate(patient.dob)}</td>
                    <td className="px-4 py-3 text-slate-600">
                      {patient.phone ? (
                        <div className="flex items-center gap-1">
                          <Phone className="w-3.5 h-3.5 text-slate-400" />
                          {patient.phone}
                        </div>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-3">
                      {primary ? (
                        <div>
                          <p className="font-medium text-slate-800 text-xs">{primary.payer?.name ?? `Payer #${primary.payer_id}`}</p>
                          <p className="text-xs text-slate-400 font-mono">{primary.member_id}</p>
                          {primary.group_number && <p className="text-xs text-slate-400">Grp: {primary.group_number}</p>}
                        </div>
                      ) : (
                        <span className="text-slate-300 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center gap-2 justify-end">
                        <Link
                          to={`/claims?patient_id=${patient.id}`}
                          className="flex items-center gap-1 text-xs text-slate-500 hover:text-sky-600"
                          title={t('patients.view_claims')}
                        >
                          <FileText className="w-3.5 h-3.5" />
                          {t('patients.claims')}
                        </Link>
                        <button
                          onClick={() => openEdit(patient)}
                          className="text-xs text-sky-600 hover:text-sky-800 font-medium"
                        >
                          {t('common.edit')}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="px-4 py-3 border-t border-slate-100 text-xs text-slate-400">
            {data?.total ?? 0} {t('patients.total')}
          </div>
        </div>
      )}

      {/* Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <h2 className="text-base font-semibold text-slate-900">
                {editing ? t('patients.edit') : t('patients.new')}
              </h2>
              <button onClick={closeModal} className="text-slate-400 hover:text-slate-700">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              {/* Name */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">{t('common.first_name')} *</label>
                  <input required value={form.first_name} onChange={setField('first_name')}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">{t('common.last_name')} *</label>
                  <input required value={form.last_name} onChange={setField('last_name')}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
                </div>
              </div>

              {/* DOB + Gender */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">{t('patients.dob')} *</label>
                  <input required type="date" value={form.dob} onChange={setField('dob')}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">{t('patients.gender')}</label>
                  <select value={form.gender} onChange={setField('gender')}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 bg-white">
                    {GENDERS.map(g => <option key={g} value={g}>{genderLabel(g)}</option>)}
                  </select>
                </div>
              </div>

              {/* Phone + Email */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">{t('common.phone')}</label>
                  <input value={form.phone} onChange={setField('phone')}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">{t('common.email')}</label>
                  <input type="email" value={form.email} onChange={setField('email')}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
                </div>
              </div>

              {/* Address */}
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">{t('settings.address')}</label>
                <input value={form.address_line1} onChange={setField('address_line1')}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">{t('providers.city')}</label>
                  <input value={form.city} onChange={setField('city')}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">{t('providers.state')}</label>
                  <select value={form.state} onChange={setField('state')}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 bg-white">
                    {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">{t('providers.zip_code')}</label>
                  <input value={form.zip_code} onChange={setField('zip_code')}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 font-mono" />
                </div>
              </div>

              {/* Insurance — only for create */}
              {!editing && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-semibold text-slate-700">{t('patients.insurance')}</h3>
                    <button type="button" onClick={addInsurance}
                      className="text-xs text-sky-600 hover:text-sky-800 flex items-center gap-1">
                      <Plus className="w-3.5 h-3.5" /> {t('patients.add_insurance')}
                    </button>
                  </div>
                  {form.insurances.map((ins, idx) => (
                    <div key={idx} className="border border-slate-200 rounded-lg p-4 mb-3 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-slate-500">{t('patients.insurance')} {idx + 1}</span>
                        {idx > 0 && (
                          <button type="button" onClick={() => removeInsurance(idx)}
                            className="text-slate-400 hover:text-red-500">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-600 mb-1">{t('claims.payer')}</label>
                        <select value={ins.payer_id} onChange={setInsField(idx, 'payer_id')}
                          className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 bg-white">
                          <option value="">{t('common.select_placeholder')}</option>
                          {payers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-slate-600 mb-1">{t('eligibility.member_id')} *</label>
                          <input value={ins.member_id} onChange={setInsField(idx, 'member_id')}
                            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 font-mono" />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-slate-600 mb-1">{t('patients.group_number')}</label>
                          <input value={ins.group_number} onChange={setInsField(idx, 'group_number')}
                            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 font-mono" />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-slate-600 mb-1">{t('patients.subscriber_name')}</label>
                          <input value={ins.subscriber_name} onChange={setInsField(idx, 'subscriber_name')}
                            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-slate-600 mb-1">{t('patients.relationship')}</label>
                          <select value={ins.relationship_to_subscriber} onChange={setInsField(idx, 'relationship_to_subscriber')}
                            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 bg-white">
                            <option value="self">{t('patients.self')}</option>
                            <option value="spouse">{t('patients.spouse')}</option>
                            <option value="child">{t('patients.child')}</option>
                            <option value="other">{t('payers.other')}</option>
                          </select>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-slate-600 mb-1">{t('eligibility.coverage_start')}</label>
                          <input type="date" value={ins.effective_date} onChange={setInsField(idx, 'effective_date')}
                            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-slate-600 mb-1">{t('patients.termination_date')}</label>
                          <input type="date" value={ins.termination_date} onChange={setInsField(idx, 'termination_date')}
                            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
                        </div>
                      </div>
                      <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={ins.is_primary}
                          onChange={e => setForm(f => {
                            const updated = f.insurances.map((i, i2) => ({
                              ...i,
                              is_primary: i2 === idx ? e.target.checked : (e.target.checked ? false : i.is_primary),
                            }));
                            return { ...f, insurances: updated };
                          })}
                          className="rounded"
                        />
                        {t('patients.primary_insurance')}
                      </label>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={closeModal}
                  className="px-4 py-2 border border-slate-200 rounded-lg text-sm text-slate-700 hover:bg-slate-50">
                  {t('common.cancel')}
                </button>
                <button type="submit" disabled={isPending}
                  className="px-4 py-2 bg-sky-500 hover:bg-sky-600 text-white text-sm rounded-lg disabled:opacity-50 flex items-center gap-2">
                  {isPending && <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                  {t('common.save')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
