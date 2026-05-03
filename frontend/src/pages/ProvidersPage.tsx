import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Search, Stethoscope, Phone, Plus, X, Check } from 'lucide-react';
import { formatPhone, displayPhone } from '../lib/format';
import api from '../lib/api';
import type { Provider, PaginatedResponse } from '../types';

const US_STATES = [
  'PR','AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN',
  'IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH',
  'NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT',
  'VT','VA','WA','WV','WI','WY',
];

type ProviderForm = {
  npi: string;
  first_name: string;
  last_name: string;
  specialty: string;
  taxonomy_code: string;
  license_number: string;
  address_line1: string;
  city: string;
  state: string;
  zip_code: string;
  phone: string;
  fax: string;
  ein: string;
  is_active: boolean;
};

const EMPTY_FORM: ProviderForm = {
  npi: '', first_name: '', last_name: '', specialty: '', taxonomy_code: '',
  license_number: '', address_line1: '', city: '', state: 'PR', zip_code: '',
  phone: '', fax: '', ein: '', is_active: true,
};

export default function ProvidersPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Provider | null>(null);
  const [form, setForm] = useState<ProviderForm>(EMPTY_FORM);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3500);
  };

  const params = new URLSearchParams({ per_page: '100', ...(search ? { search } : {}) });
  const { data, isLoading } = useQuery<PaginatedResponse<Provider>>({
    queryKey: ['providers', search],
    queryFn: () => api.get(`/providers?${params}`).then(r => r.data),
  });

  // For inactive providers we need a separate fetch
  const { data: allData } = useQuery<PaginatedResponse<Provider>>({
    queryKey: ['providers-all', search],
    queryFn: () => api.get(`/providers?per_page=100${search ? `&search=${search}` : ''}`).then(r => r.data),
    enabled: showAll,
  });

  const displayData = showAll ? allData : data;

  const createMutation = useMutation({
    mutationFn: (body: ProviderForm) => api.post('/providers', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['providers'] });
      closeModal();
      showToast(t('providers.created'));
    },
    onError: () => showToast(t('common.error'), false),
  });

  const updateMutation = useMutation({
    mutationFn: (body: ProviderForm) => api.patch(`/providers/${editing!.id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['providers'] });
      closeModal();
      showToast(t('providers.updated'));
    },
    onError: () => showToast(t('common.error'), false),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, is_active }: { id: number; is_active: boolean }) =>
      api.patch(`/providers/${id}`, { is_active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['providers'] }),
  });

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setModalOpen(true);
  };

  const openEdit = (provider: Provider) => {
    setEditing(provider);
    setForm({
      npi: provider.npi,
      first_name: provider.first_name,
      last_name: provider.last_name,
      specialty: provider.specialty ?? '',
      taxonomy_code: provider.taxonomy_code ?? '',
      license_number: provider.license_number ?? '',
      address_line1: provider.address_line1 ?? '',
      city: provider.city ?? '',
      state: provider.state,
      zip_code: provider.zip_code ?? '',
      phone: provider.phone ?? '',
      fax: provider.fax ?? '',
      ein: provider.ein ?? '',
      is_active: provider.is_active,
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

  const field = (key: keyof ProviderForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [key]: e.target.value }));

  const providers = displayData?.items ?? [];
  const isPending = createMutation.isPending || updateMutation.isPending;

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
        <h1 className="text-xl font-bold text-slate-900">{t('nav.providers')}</h1>
        <button
          onClick={openCreate}
          className="flex items-center gap-1.5 px-3 py-2 bg-sky-500 hover:bg-sky-600 text-white text-sm rounded-lg"
        >
          <Plus className="w-4 h-4" /> {t('providers.new')}
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 mb-6 flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t('common.search')}
            className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
          <input
            type="checkbox"
            checked={showAll}
            onChange={e => setShowAll(e.target.checked)}
            className="rounded"
          />
          {t('providers.show_inactive')}
        </label>
      </div>

      {/* Grid */}
      {isLoading ? (
        <div className="flex items-center justify-center h-40">
          <div className="w-5 h-5 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : !providers.length ? (
        <div className="text-center py-12 text-slate-400">{t('providers.no_providers')}</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {providers.map(provider => (
            <div
              key={provider.id}
              className={`bg-white rounded-xl border p-5 transition-colors ${provider.is_active ? 'border-slate-200 hover:border-sky-300' : 'border-slate-100 opacity-60'}`}
            >
              <div className="flex items-start justify-between gap-2 mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-sky-50 flex items-center justify-center shrink-0">
                    <Stethoscope className="w-4 h-4 text-sky-600" />
                  </div>
                  <div>
                    <p className="font-semibold text-slate-800 text-sm leading-tight">
                      Dr. {provider.first_name} {provider.last_name}
                    </p>
                    <p className="text-xs text-slate-400 font-mono">NPI: {provider.npi}</p>
                  </div>
                </div>
              </div>

              <div className="space-y-1.5 text-xs text-slate-600 mb-3">
                {provider.specialty && (
                  <div className="flex items-center gap-2">
                    <Stethoscope className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    {provider.specialty}
                  </div>
                )}
                {provider.phone && (
                  <div className="flex items-center gap-2">
                    <Phone className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    {displayPhone(provider.phone)}
                  </div>
                )}
                {provider.city && (
                  <div className="text-slate-400">{provider.city}, {provider.state} {provider.zip_code}</div>
                )}
                {provider.license_number && (
                  <div className="flex items-center gap-2">
                    <span className="text-slate-400">{t('providers.license')}:</span>
                    <span className="font-mono">{provider.license_number}</span>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                <button
                  onClick={() => toggleMutation.mutate({ id: provider.id, is_active: !provider.is_active })}
                  className={`text-xs font-medium px-2 py-0.5 rounded-full transition-colors ${
                    provider.is_active
                      ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                      : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                  }`}
                >
                  {provider.is_active ? t('providers.active') : t('common.inactive')}
                </button>
                <button
                  onClick={() => openEdit(provider)}
                  className="text-xs text-sky-600 hover:text-sky-800 font-medium"
                >
                  {t('common.edit')}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <h2 className="text-base font-semibold text-slate-900">
                {editing ? t('providers.edit') : t('providers.new')}
              </h2>
              <button onClick={closeModal} className="text-slate-400 hover:text-slate-700">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              {/* NPI + Names */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">NPI *</label>
                  <input required value={form.npi} onChange={field('npi')}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 font-mono"
                    placeholder="1234567890" maxLength={10} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">{t('common.first_name')} *</label>
                  <input required value={form.first_name} onChange={field('first_name')}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">{t('common.last_name')} *</label>
                  <input required value={form.last_name} onChange={field('last_name')}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
                </div>
              </div>

              {/* Specialty + Taxonomy + License */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">{t('providers.specialty')}</label>
                  <input value={form.specialty} onChange={field('specialty')}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">{t('providers.taxonomy_code')}</label>
                  <input value={form.taxonomy_code} onChange={field('taxonomy_code')}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 font-mono" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">{t('providers.license')}</label>
                  <input value={form.license_number} onChange={field('license_number')}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
                </div>
              </div>

              {/* Address */}
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">{t('settings.address')}</label>
                <input value={form.address_line1} onChange={field('address_line1')}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">{t('providers.city')}</label>
                  <input value={form.city} onChange={field('city')}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">{t('providers.state')}</label>
                  <select value={form.state} onChange={field('state')}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 bg-white">
                    {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">{t('providers.zip_code')}</label>
                  <input value={form.zip_code} onChange={field('zip_code')}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 font-mono" />
                </div>
              </div>

              {/* Phone + Fax + EIN */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">{t('common.phone')}</label>
                  <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: formatPhone(e.target.value) }))} maxLength={14}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">{t('providers.fax')}</label>
                  <input value={form.fax} onChange={field('fax')}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">{t('providers.ein')}</label>
                  <input value={form.ein} onChange={field('ein')}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 font-mono" />
                </div>
              </div>

              {editing && (
                <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.is_active}
                    onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))}
                    className="rounded"
                  />
                  {t('providers.active')}
                </label>
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
