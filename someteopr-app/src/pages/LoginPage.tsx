import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Loader2, Building2, Check } from 'lucide-react';
import { useAuthStore, type OrgInfo } from '../hooks/useAuth';

export default function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { login, selectOrg } = useAuthStore();
  const [email, setEmail] = useState('admin@biller.pr');
  const [password, setPassword] = useState('Admin1234!');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Org picker state (shown when user belongs to multiple orgs)
  const [showOrgPicker, setShowOrgPicker] = useState(false);
  const [orgs, setOrgs] = useState<OrgInfo[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState<number | null>(null);
  const [orgLoading, setOrgLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const result = await login(email, password);
      if (result.needsOrgPicker) {
        setOrgs(result.organizations);
        setShowOrgPicker(true);
      } else {
        navigate('/', { replace: true });
      }
    } catch {
      setError(t('auth.invalid_credentials'));
    } finally {
      setLoading(false);
    }
  };

  const handleSelectOrg = async (org: OrgInfo) => {
    setSelectedOrgId(org.id);
    setOrgLoading(true);
    try {
      await selectOrg(org);
      navigate('/', { replace: true });
    } finally {
      setOrgLoading(false);
    }
  };

  // ── Org Picker ────────────────────────────────────────────────────────────
  if (showOrgPicker) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-sky-50 to-slate-100 flex flex-col items-center justify-center p-4">
        <img
          src="/angel-logo.png"
          alt="SometeoPR"
          className="w-60 max-w-[80vw] object-contain mb-8"
        />

        <div className="w-full max-w-sm">
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
            <h2 className="text-lg font-semibold text-slate-800 mb-1">Select Organization</h2>
            <p className="text-sm text-slate-500 mb-4">Choose the organization you want to work in.</p>

            <div className="space-y-2">
              {orgs.map((org) => (
                <button
                  key={org.id}
                  onClick={() => handleSelectOrg(org)}
                  disabled={orgLoading}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-slate-200 hover:border-sky-300 hover:bg-sky-50 transition-all text-left disabled:opacity-50"
                >
                  <div className="w-10 h-10 rounded-xl bg-sky-100 text-sky-700 flex items-center justify-center shrink-0">
                    <Building2 className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-slate-800 truncate">{org.name}</p>
                    <p className="text-xs text-slate-400 capitalize">{org.role} · {org.subscription_tier}</p>
                  </div>
                  {selectedOrgId === org.id && orgLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin text-sky-500" />
                  ) : (
                    <Check className="w-4 h-4 text-transparent" />
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Login Form ────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gradient-to-br from-sky-50 to-slate-100 flex flex-col items-center justify-center p-4">
      <img
        src="/angel-logo.png"
        alt="SometeoPR"
        className="w-80 max-w-[90vw] object-contain mb-8"
      />

      <div className="w-full max-w-sm">
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                {t('auth.email')}
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                {t('auth.password')}
              </label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
                required
              />
            </div>

            {error && (
              <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg p-3">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-sky-500 hover:bg-sky-600 disabled:opacity-50 text-white font-medium py-2.5 rounded-lg text-sm transition-colors flex items-center justify-center gap-2"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              {loading ? t('auth.signing_in') : t('auth.sign_in')}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-slate-400 mt-4">
          🇵🇷
        </p>
      </div>
    </div>
  );
}
