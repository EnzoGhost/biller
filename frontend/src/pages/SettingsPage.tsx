import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { Save, CheckCircle, Building2, Shield, Cpu, Globe, Zap, Users, Wifi, Stethoscope, DollarSign, Link2, Unplug, RefreshCw, Eye, EyeOff, AlertTriangle, Search, UserCog, Trash2, UserPlus, ChevronDown } from 'lucide-react';
import DatePicker from '../components/ui/DatePicker';
import api from '../lib/api';
import { formatPhone } from '../lib/format';

const ProvidersPage = lazy(() => import('./ProvidersPage'));
const PayersPage = lazy(() => import('./PayersPage'));
const FeeSchedulePage = lazy(() => import('./FeeSchedulePage'));
const RolesPage = lazy(() => import('./RolesPage'));

// ── Module-level audit state (persists across tab switches) ─────────────────
interface AuditEntry {
  invoice_number: string | null;
  date: string | null;
  patient_id: string | null;
  patient_name: string;
  plan_amount: number;
  total: number;
  attended_by: string | null;
  payer: string | null;
}
interface AuditResult {
  date_from: string;
  date_to: string;
  flagged_count: number;
  total_lost: number;
  flagged: AuditEntry[];
}
interface AuditProgress {
  phase: 'login' | 'scanning' | 'done' | 'error';
  message?: string;
  day?: string;
  day_number?: number;
  total_days?: number;
  patients_found?: number;
  patients_scanned?: number;
  flagged_so_far?: number;
  lost_so_far?: number;
}
interface ModuleAuditState {
  loading: boolean;
  progress: AuditProgress | null;
  result: AuditResult | null;
  error: string | null;
}
let _auditState: ModuleAuditState = { loading: false, progress: null, result: null, error: null };
let _abortController: AbortController | null = null;
type AuditStateListener = (state: ModuleAuditState) => void;
const _auditListeners = new Set<AuditStateListener>();
function _setAuditState(patch: Partial<ModuleAuditState>) {
  _auditState = { ..._auditState, ...patch };
  _auditListeners.forEach(fn => fn(_auditState));
}

export default function SettingsPage() {
  const { t, i18n } = useTranslation();
  const [active, setActive] = useState('clinic');
  const [teamTab, setTeamTab] = useState<'users' | 'roles'>('users');
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

  // Inmediata Web Services
  const [inmWsUsername,    setInmWsUsername]    = useState('');
  const [inmWsPassword,    setInmWsPassword]    = useState('');
  const [inmWsShowPw,      setInmWsShowPw]      = useState(false);
  const [inmWsEnv,         setInmWsEnv]         = useState<'uat' | 'prod'>('uat');
  const [inmSubmitterId,   setInmSubmitterId]   = useState('');
  const [inmWsConfigured,  setInmWsConfigured]  = useState(false);
  const [inmTestResult,    setInmTestResult]    = useState<{ success: boolean; message: string } | null>(null);
  const [inmTesting,       setInmTesting]       = useState(false);

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

  // Portal credentials state
  type PortalId = 'ivision' | 'envolve' | 'triples' | 'innovamd';
  type PortalState = {
    url: string;
    username: string;
    password: string;
    passwordMasked: string;
    connected: boolean;
    showPassword: boolean;
    saving: boolean;
    disconnecting: boolean;
  };
  const defaultPortal: PortalState = {
    url: '', username: '', password: '', passwordMasked: '',
    connected: false, showPassword: false, saving: false, disconnecting: false,
  };
  const [portals, setPortals] = useState<Record<PortalId, PortalState>>({
    ivision:  { ...defaultPortal, url: 'https://www.ivisionintl.net' },
    envolve:  { ...defaultPortal, url: 'https://www.centenevision.com' },
    triples:  { ...defaultPortal, url: '' },
    innovamd: { ...defaultPortal, url: 'https://provider.innovamd.com' },
  });

  // AngelWink connection state
  const [winkClinicId, setWinkClinicId] = useState<string | null>(null);
  const [winkClinicName, setWinkClinicName] = useState<string | null>(null);
  const [winkJoinCode, setWinkJoinCode] = useState('');
  const [winkPairing, setWinkPairing] = useState(false);

  // Revenue Audit state
  const today = new Date().toISOString().split('T')[0];
  const firstOfMonth = today.substring(0, 8) + '01';
  const [auditDateFrom, setAuditDateFrom] = useState(firstOfMonth);
  const [auditDateTo, setAuditDateTo]   = useState(today);
  const [auditMode, setAuditMode]       = useState<'synced' | 'direct'>('synced');
  // Direct VistaNet credentials
  const [directUrl, setDirectUrl]           = useState('https://visualzone.vistanet.cloud');
  const [directUser, setDirectUser]         = useState('');
  const [directPassword, setDirectPassword] = useState('');
  const [directLocation, setDirectLocation] = useState('MANATI');
  const [directShowPassword, setDirectShowPassword] = useState(false);
  // Mirror module-level audit state into component state
  const [auditLoading, setAuditLoading] = useState(_auditState.loading);
  const [auditError, setAuditError]     = useState<string | null>(_auditState.error);
  const [auditResult, setAuditResult]   = useState<AuditResult | null>(_auditState.result);
  const [auditProgress, setAuditProgress] = useState<AuditProgress | null>(_auditState.progress);

  // Subscribe to module-level audit state changes on mount
  useEffect(() => {
    const listener: AuditStateListener = (state) => {
      setAuditLoading(state.loading);
      setAuditError(state.error);
      setAuditResult(state.result);
      setAuditProgress(state.progress);
    };
    _auditListeners.add(listener);
    // Sync current state in case it changed while unmounted
    listener(_auditState);
    return () => { _auditListeners.delete(listener); };
  }, []);

  const VISTANET_LOCATIONS = [
    'MANATI', 'BARCELONETA', 'ARECIBO', 'CIALES', 'MOROVIS',
    'VEGA BAJA', 'VEGA ALTA', 'SAN JUAN', 'BAYAMON', 'CAROLINA',
    'PONCE', 'MAYAGUEZ', 'CAGUAS', 'HUMACAO', 'FAJARDO',
  ];

  const runAudit = async () => {
    if (!auditDateFrom || !auditDateTo) return;
    if (auditMode === 'direct' && (!directUser || !directPassword)) return;
    // Abort any running audit
    if (_abortController) {
      _abortController.abort();
      _abortController = null;
    }
    _setAuditState({ loading: true, error: null, result: null, progress: null });

    try {
      if (auditMode === 'direct') {
        // Use SSE stream for live progress — runs independent of component lifecycle
        const token = localStorage.getItem('biller_token');
        _abortController = new AbortController();
        const ctrl = _abortController;
        const response = await fetch('/api/missing-claims/audit/direct/stream', {
          method: 'POST',
          signal: ctrl.signal,
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            vistanet_url: directUrl,
            vistanet_user: directUser,
            vistanet_password: directPassword,
            vistanet_location: directLocation,
            date_from: auditDateFrom,
            date_to: auditDateTo,
          }),
        });

        if (!response.ok) {
          let detail = `HTTP ${response.status}`;
          try {
            const errData = await response.json();
            detail = errData.detail || detail;
          } catch { /* ignore */ }
          _setAuditState({ loading: false, error: detail });
          return;
        }

        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        // This loop continues even if the component unmounts
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';
            for (const line of lines) {
              if (!line.startsWith('data: ')) continue;
              try {
                const event = JSON.parse(line.slice(6)) as AuditProgress & { result?: AuditResult };
                if (event.phase === 'done') {
                  _setAuditState({ loading: false, progress: null, result: event.result ?? null });
                } else if (event.phase === 'error') {
                  _setAuditState({ loading: false, progress: null, error: event.message || 'Audit failed' });
                } else {
                  _setAuditState({ progress: event });
                }
              } catch { /* skip malformed line */ }
            }
          }
        } catch (streamErr: unknown) {
          if ((streamErr as { name?: string })?.name !== 'AbortError') {
            _setAuditState({ loading: false, error: 'Stream interrupted', progress: null });
          }
        } finally {
          if (_abortController === ctrl) _abortController = null;
        }
      } else {
        const res = await api.post('/missing-claims/audit/lost-revenue', {
          date_from: auditDateFrom,
          date_to: auditDateTo,
        });
        _setAuditState({ loading: false, result: res.data });
      }
    } catch (e: unknown) {
      if ((e as { name?: string })?.name === 'AbortError') return;
      const err = e as { response?: { data?: { detail?: string } }; message?: string };
      _setAuditState({ loading: false, error: err?.response?.data?.detail || err?.message || 'Error running audit', progress: null });
    }
  };

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
      // Load AngelWink pairing from server (per-provider), not localStorage
      api.get('/clinic/config').then(res => {
        const d = res.data;
        if (d.angelwink_clinic_id) {
          setWinkClinicId(d.angelwink_clinic_id);
          setWinkClinicName(d.clinic_name || 'Connected');
        } else {
          // Fallback to localStorage for legacy
          setWinkClinicId(localStorage.getItem('angelwink_clinic_id'));
          setWinkClinicName(localStorage.getItem('angelwink_clinic_name'));
        }
      }).catch(() => {
        setWinkClinicId(localStorage.getItem('angelwink_clinic_id'));
        setWinkClinicName(localStorage.getItem('angelwink_clinic_name'));
      });
    }
  }, [active]);

  // Load portal configs when portals tab selected
  useEffect(() => {
    if (active === 'portals') {
      api.get('/portals/config').then(res => {
        const data = res.data;
        setPortals(prev => {
          const next = { ...prev };
          (['ivision', 'envolve', 'triples', 'innovamd'] as PortalId[]).forEach(pid => {
            if (data[pid]) {
              next[pid] = {
                ...next[pid],
                url: data[pid].url || next[pid].url,
                username: data[pid].username || '',
                passwordMasked: data[pid].password_masked || '',
                connected: data[pid].connected || false,
                password: '',
                showPassword: false,
              };
            }
          });
          return next;
        });
      }).catch(() => {});
    }
  }, [active]);

  // Load Inmediata config when tab selected
  useEffect(() => {
    if (active === 'inmediata') {
      api.get('/inmediata/config').then(res => {
        const d = res.data;
        setInmSubmitterId(d.submitter_id || '');
        setInmWsEnv(d.ws_env === 'prod' ? 'prod' : 'uat');
        setInmWsUsername(d.ws_username || '');
        setInmWsConfigured(d.ws_has_password || d.ws_configured || false);
        // Show placeholder dots when password exists (never send actual password back)
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
        await api.post('/inmediata/config', {
          submitter_id: inmSubmitterId,
          ws_username: inmWsUsername,
          ws_password: inmWsPassword || undefined,
          ws_env: inmWsEnv,
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

  // AngelWink handlers
  const handleWinkPair = async () => {
    if (!winkJoinCode.trim()) return;
    setWinkPairing(true);
    try {
      const res = await api.post('/clinic/join-codes/verify', { code: winkJoinCode });
      if (res.data.valid) {
        localStorage.setItem('angelwink_clinic_id', res.data.angelwink_clinic_id);
        localStorage.setItem('angelwink_clinic_name', res.data.clinic_name);
        setWinkClinicId(res.data.angelwink_clinic_id);
        setWinkClinicName(res.data.clinic_name);
        setWinkJoinCode('');
      }
    } catch { /* best-effort */ }
    finally { setWinkPairing(false); }
  };

  const handleWinkDisconnect = async () => {
    try {
      await api.post('/clinic/angelwink/disconnect');
    } catch { /* best-effort */ }
    localStorage.removeItem('angelwink_clinic_id');
    localStorage.removeItem('angelwink_clinic_name');
    setWinkClinicId(null);
    setWinkClinicName(null);
  };

  const handleTestConnection = async () => {
    setInmTesting(true);
    setInmTestResult(null);
    try {
      // Save first, then test
      await api.post('/inmediata/config', {
        submitter_id: inmSubmitterId,
        ws_username: inmWsUsername,
        ws_password: inmWsPassword || undefined,
        ws_env: inmWsEnv,
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

  const handlePortalSave = async (pid: PortalId) => {
    setPortals(prev => ({ ...prev, [pid]: { ...prev[pid], saving: true } }));
    try {
      const p = portals[pid];
      const res = await api.post(`/portals/${pid}/config`, {
        url: p.url,
        username: p.username,
        password: p.password || undefined,
      });
      setPortals(prev => ({
        ...prev,
        [pid]: {
          ...prev[pid],
          connected: res.data.connected,
          passwordMasked: res.data.password_masked || '',
          password: '',
          saving: false,
        },
      }));
    } catch { setPortals(prev => ({ ...prev, [pid]: { ...prev[pid], saving: false } })); }
  };

  const handlePortalDisconnect = async (pid: PortalId) => {
    setPortals(prev => ({ ...prev, [pid]: { ...prev[pid], disconnecting: true } }));
    try {
      await api.post(`/portals/${pid}/disconnect`);
      setPortals(prev => ({
        ...prev,
        [pid]: {
          ...prev[pid],
          connected: false,
          username: '',
          password: '',
          passwordMasked: '',
          disconnecting: false,
        },
      }));
    } catch { setPortals(prev => ({ ...prev, [pid]: { ...prev[pid], disconnecting: false } })); }
  };

  // ── Team Management state ────────────────────────────────────────────────
  interface TeamMember {
    id: number;
    user_id: number;
    email: string;
    full_name: string;
    role: string;
    invited_at: string;
    accepted_at: string | null;
  }
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [teamLoading, setTeamLoading] = useState(false);
  const [teamError, setTeamError] = useState<string | null>(null);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [invitePassword, setInvitePassword] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteRole, setInviteRole] = useState('biller');
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [currentUserRole, setCurrentUserRole] = useState<string>('');
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);

  // ── Account Settings state ───────────────────────────────────────────────
  const [acctName, setAcctName] = useState('');
  const [acctCurrentPw, setAcctCurrentPw] = useState('');
  const [acctNewPw, setAcctNewPw] = useState('');
  const [acctConfirmPw, setAcctConfirmPw] = useState('');
  const [acctShowCurrentPw, setAcctShowCurrentPw] = useState(false);
  const [acctShowNewPw, setAcctShowNewPw] = useState(false);
  const [acctSavingProfile, setAcctSavingProfile] = useState(false);
  const [acctSavingPw, setAcctSavingPw] = useState(false);
  const [acctProfileMsg, setAcctProfileMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [acctPwMsg, setAcctPwMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Load team when tab selected
  useEffect(() => {
    if (active === 'team') {
      setTeamLoading(true);
      setTeamError(null);
      Promise.all([
        api.get('/organizations/me/users'),
        api.get('/auth/me'),
      ]).then(([membersRes, meRes]) => {
        setTeamMembers(membersRes.data);
        const myId = meRes.data.user?.id;
        setCurrentUserId(myId ?? null);
        const myMembership = membersRes.data.find((m: TeamMember) => m.user_id === myId);
        setCurrentUserRole(myMembership?.role ?? '');
      }).catch(() => {
        setTeamError('Failed to load team members');
      }).finally(() => setTeamLoading(false));
    }
  }, [active]);

  // Load account info when tab selected
  useEffect(() => {
    if (active === 'account') {
      api.get('/auth/me').then(res => {
        setAcctName(res.data.user?.full_name ?? '');
        setCurrentUserId(res.data.user?.id ?? null);
      }).catch(() => {});
    }
  }, [active]);

  const handleInviteUser = async () => {
    if (!inviteEmail.trim()) return;
    setInviting(true);
    setInviteError(null);
    try {
      await api.post('/organizations/me/users', { email: inviteEmail.trim(), password: invitePassword || undefined, full_name: inviteName || undefined, role: inviteRole });
      setShowInviteModal(false);
      setInviteEmail('');
      setInviteRole('biller');
      // Reload members
      const res = await api.get('/organizations/me/users');
      setTeamMembers(res.data);
    } catch (err: any) {
      setInviteError(err?.response?.data?.detail || 'Failed to invite user');
    } finally {
      setInviting(false);
    }
  };

  const handleUpdateMemberRole = async (userId: number, role: string) => {
    try {
      await api.patch(`/organizations/me/users/${userId}`, { role });
      setTeamMembers(prev => prev.map(m => m.user_id === userId ? { ...m, role } : m));
    } catch { /* best-effort */ }
  };

  const handleRemoveMember = async (userId: number) => {
    if (!confirm('Remove this user from the organization?')) return;
    try {
      await api.delete(`/organizations/me/users/${userId}`);
      setTeamMembers(prev => prev.filter(m => m.user_id !== userId));
    } catch { /* best-effort */ }
  };

  const handleSaveProfile = async () => {
    if (!acctName.trim()) return;
    setAcctSavingProfile(true);
    setAcctProfileMsg(null);
    try {
      await api.patch('/auth/me/profile', { full_name: acctName.trim() });
      setAcctProfileMsg({ ok: true, text: 'Name updated' });
    } catch (err: any) {
      setAcctProfileMsg({ ok: false, text: err?.response?.data?.detail || 'Failed to update name' });
    } finally {
      setAcctSavingProfile(false);
      setTimeout(() => setAcctProfileMsg(null), 3000);
    }
  };

  const handleChangePassword = async () => {
    if (!acctCurrentPw || !acctNewPw || !acctConfirmPw) {
      setAcctPwMsg({ ok: false, text: 'All fields required' });
      return;
    }
    if (acctNewPw !== acctConfirmPw) {
      setAcctPwMsg({ ok: false, text: 'New passwords do not match' });
      return;
    }
    if (acctNewPw.length < 8) {
      setAcctPwMsg({ ok: false, text: 'Password must be at least 8 characters' });
      return;
    }
    setAcctSavingPw(true);
    setAcctPwMsg(null);
    try {
      await api.patch('/auth/me/password', { current_password: acctCurrentPw, new_password: acctNewPw });
      setAcctCurrentPw('');
      setAcctNewPw('');
      setAcctConfirmPw('');
      setAcctPwMsg({ ok: true, text: 'Password changed successfully' });
    } catch (err: any) {
      setAcctPwMsg({ ok: false, text: err?.response?.data?.detail || 'Failed to change password' });
    } finally {
      setAcctSavingPw(false);
      setTimeout(() => setAcctPwMsg(null), 4000);
    }
  };

  const SECTIONS = [
    // Account moved to TopBar dropdown (Dagger-style)
    { key: 'team',         labelKey: 'Team & Roles',          icon: Users },
    { key: 'clinic',       labelKey: 'settings.clinic_info',  icon: Building2 },
    { key: 'providers',    labelKey: 'nav.providers',         icon: Stethoscope },
    { key: 'payers',       labelKey: 'nav.payers',            icon: Building2 },
    { key: 'fee-schedule', labelKey: 'nav.fee_schedule',      icon: DollarSign },
    { key: 'connections',  labelKey: 'Connections',           icon: Wifi },
    { key: 'pairing',      labelKey: 'Clinic Pairing',        icon: Link2 },
    { key: 'portals',      labelKey: 'Insurance Portals',     icon: Shield },
    { key: 'availity',     labelKey: 'settings.availity',     icon: Users },
    { key: 'inmediata',    labelKey: 'inmediata.title',       icon: Zap },
    // AI settings removed — managed centrally, not per-user
    { key: 'audit',        labelKey: 'Revenue Audit',         icon: AlertTriangle },
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
                  <input value={clinicName} onChange={e => setClinicName(e.target.value)} className={inputClass} placeholder="" />
                </div>
                <div>
                  <label className={labelClass}>Provider / Doctor Name</label>
                  <input value={providerName} onChange={e => setProviderName(e.target.value)} className={inputClass} placeholder="" />
                </div>
                <div>
                  <label className={labelClass}>NPI (Billing)</label>
                  <input value={clinicNpi} onChange={e => setClinicNpi(e.target.value)} className={inputClass} placeholder="" />
                </div>
                <div>
                  <label className={labelClass}>Tax ID / EIN</label>
                  <input value={clinicTax} onChange={e => setClinicTax(e.target.value)} className={inputClass} placeholder="" />
                </div>
                <div>
                  <label className={labelClass}>{t('common.phone')}</label>
                  <input value={clinicPhone} onChange={e => setClinicPhone(formatPhone(e.target.value))} className={inputClass} placeholder="" maxLength={14} />
                </div>
                <div className="sm:col-span-2">
                  <label className={labelClass}>{t('settings.address')}</label>
                  <input value={clinicAddr} onChange={e => setClinicAddr(e.target.value)} className={inputClass} placeholder="" />
                </div>
              </div>
            </div>
          )}

          {/* Insurance Portals */}
          {active === 'portals' && (() => {
            const PORTAL_DEFS: { id: PortalId; name: string; desc: string }[] = [
              { id: 'ivision',  name: 'iVision International', desc: 'ivisionintl.net — Vision plan eligibility portal' },
              { id: 'envolve',  name: 'Envolve Vision',        desc: 'centenevision.com — Envolve/Centene vision benefits' },
              { id: 'triples',  name: 'Triple-S',              desc: 'Triple-S Salud / Triple-S Vision portal' },
              { id: 'innovamd', name: 'InnovaMD / MMM',        desc: 'provider.innovamd.com — MMM Healthcare portal' },
            ];
            return (
              <div className="space-y-5">
                <h2 className="font-semibold text-slate-800">Insurance Portals</h2>
                <p className="text-sm text-slate-500">Store credentials for insurance portals. Passwords are encrypted at rest.</p>
                {PORTAL_DEFS.map(({ id, name, desc }) => {
                  const p = portals[id];
                  return (
                    <div key={id} className="border border-slate-200 rounded-xl p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className={`w-2.5 h-2.5 rounded-full ${p.connected ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                          <h3 className="font-semibold text-slate-700">{name}</h3>
                          {p.connected && (
                            <span className="text-xs text-emerald-600 font-medium">Connected</span>
                          )}
                        </div>
                        {p.connected && (
                          <button
                            onClick={() => handlePortalDisconnect(id)}
                            disabled={p.disconnecting}
                            className="flex items-center gap-1 text-xs font-medium text-red-600 hover:text-red-800 px-2 py-1 border border-red-200 rounded"
                          >
                            <Unplug className="w-3 h-3" />
                            {p.disconnecting ? '...' : 'Disconnect'}
                          </button>
                        )}
                      </div>
                      <p className="text-xs text-slate-400">{desc}</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="sm:col-span-2">
                          <label className={labelClass}>Portal URL</label>
                          <input
                            value={p.url}
                            onChange={e => setPortals(prev => ({ ...prev, [id]: { ...prev[id], url: e.target.value } }))}
                            className={inputClass}
                            placeholder="https://..."
                          />
                        </div>
                        <div>
                          <label className={labelClass}>Username</label>
                          <input
                            value={p.username}
                            onChange={e => setPortals(prev => ({ ...prev, [id]: { ...prev[id], username: e.target.value } }))}
                            className={inputClass}
                            placeholder="username"
                          />
                        </div>
                        <div>
                          <label className={labelClass}>Password</label>
                          <div className="relative">
                            <input
                              type={p.showPassword ? 'text' : 'password'}
                              value={p.password}
                              onChange={e => setPortals(prev => ({ ...prev, [id]: { ...prev[id], password: e.target.value } }))}
                              className={inputClass}
                              placeholder={p.connected ? 'Enter new password to change' : 'password'}
                            />
                            <button
                              type="button"
                              onClick={() => setPortals(prev => ({ ...prev, [id]: { ...prev[id], showPassword: !prev[id].showPassword } }))}
                              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                            >
                              {p.showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                            </button>
                          </div>
                          {p.connected && !p.password && (
                            <p className="text-xs text-slate-400 mt-1">Password saved: {p.passwordMasked}</p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handlePortalSave(id)}
                          disabled={p.saving || !p.username}
                          className="flex items-center gap-1.5 px-4 py-2 bg-sky-500 hover:bg-sky-600 text-white text-sm font-medium rounded-lg disabled:opacity-50"
                        >
                          <Save className="w-4 h-4" />
                          {p.saving ? 'Saving...' : p.connected ? 'Update' : 'Save'}
                        </button>
                        <button
                          disabled
                          title="Coming soon"
                          className="flex items-center gap-1.5 px-4 py-2 bg-slate-100 text-slate-400 text-sm font-medium rounded-lg cursor-not-allowed"
                        >
                          <Wifi className="w-4 h-4" />
                          Test Connection
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}

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

          {/* Inmediata Web Services */}
          {active === 'inmediata' && (
            <div className="space-y-4">
              <h2 className="font-semibold text-slate-800 mb-2">Inmediata Web Services</h2>
              <p className="text-sm text-slate-500 mb-4">
                Configure credentials for Inmediata SecureTrack — real-time X12 270/271 eligibility
                and 837P/835 EDI submission.
              </p>

              {inmWsConfigured && (
                <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 text-sm text-emerald-700">
                  <CheckCircle className="w-4 h-4 shrink-0" />
                  Web Services connected
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Environment */}
                <div className="sm:col-span-2">
                  <label className={labelClass}>Environment</label>
                  <div className="flex gap-2">
                    {(['uat', 'prod'] as const).map(env => (
                      <button
                        key={env}
                        type="button"
                        onClick={() => setInmWsEnv(env)}
                        className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${
                          inmWsEnv === env
                            ? 'bg-sky-500 text-white border-sky-600'
                            : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        {env === 'uat' ? 'UAT (Testing)' : 'Production'}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Endpoint URL (read-only) */}
                <div className="sm:col-span-2">
                  <label className={labelClass}>Endpoint URL</label>
                  <input
                    readOnly
                    value={
                      inmWsEnv === 'prod'
                        ? 'https://www.inmediata.com/webservices/EdiTransfer/EdiFileTransfer.asmx'
                        : 'https://securetrack-uat.inmediata.com/webservices/EdiTransfer/EdiFileTransfer.asmx'
                    }
                    className={`${inputClass} bg-slate-50 text-slate-400 cursor-default`}
                  />
                </div>

                {/* Username */}
                <div>
                  <label className={labelClass}>Username</label>
                  <input
                    value={inmWsUsername}
                    onChange={e => setInmWsUsername(e.target.value)}
                    className={inputClass}
                    placeholder="Inmediata username"
                    autoComplete="off"
                  />
                </div>

                {/* Password */}
                <div>
                  <label className={labelClass}>Password</label>
                  <div className="relative">
                    <input
                      type={inmWsShowPw ? 'text' : 'password'}
                      value={inmWsPassword}
                      onChange={e => setInmWsPassword(e.target.value)}
                      className={inputClass}
                      placeholder={inmWsConfigured ? '••••••••' : ''}
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      onClick={() => setInmWsShowPw(v => !v)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    >
                      {inmWsShowPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Submitter ID */}
                <div>
                  <label className={labelClass}>Submitter ID</label>
                  <input
                    value={inmSubmitterId}
                    onChange={e => setInmSubmitterId(e.target.value)}
                    className={inputClass}
                    placeholder="YOURID"
                  />
                </div>
              </div>

              <div className="flex items-center gap-3 mt-2">
                <button
                  onClick={handleTestConnection}
                  disabled={inmTesting || !inmWsUsername}
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

                    {/* Connections — VistaNet + AngelWink */}
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
                      <p className="text-sm text-slate-500">Connect to VistaNet Cloud to import patient data.</p>
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
                        <input
                          value={vnLocation}
                          onChange={e => setVnLocation(e.target.value)}
                          className={inputClass}
                          placeholder="e.g. MANATI"
                        />
                      </div>
                    </div>
                    <div>
                      <label className={labelClass}>VistaNet URL</label>
                      <input
                        value={directUrl}
                        onChange={e => setDirectUrl(e.target.value)}
                        className={inputClass}
                        placeholder="https://yourpractice.vistanet.cloud"
                      />
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

              {/* AngelWink */}
              <div className="border border-slate-200 rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className={`w-2.5 h-2.5 rounded-full ${winkClinicId ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                    <h3 className="font-semibold text-slate-700">AngelWink</h3>
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
                    <p className="text-sm text-slate-500">Connect to an AngelWink clinic using a join code.</p>
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
                Generate a temporary join code to pair an external system (like AngelWink) with this clinic.
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

          {/* Revenue Audit */}
          {active === 'audit' && (
            <div className="space-y-5">
              <div>
                <h2 className="font-semibold text-slate-800 mb-1">Revenue Audit</h2>
                <p className="text-sm text-slate-500">
                  Finds invoices where insurance was supposed to pay but no CPT codes were entered — meaning the claim was never submitted.
                </p>
              </div>

              {/* Mode toggle */}
              <div className="flex gap-2">
                <button
                  onClick={() => { setAuditMode('synced'); _setAuditState({ result: null, error: null, loading: false, progress: null }); }}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
                    auditMode === 'synced'
                      ? 'border-sky-500 bg-sky-50 text-sky-700'
                      : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <img src="/forClaimsImport.png" alt="AngelWink" className="h-5 w-auto" />
                </button>
                <button
                  onClick={() => { setAuditMode('direct'); _setAuditState({ result: null, error: null, loading: false, progress: null }); }}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
                    auditMode === 'direct'
                      ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                      : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  VistaNet
                </button>
              </div>

              {auditMode === 'direct' && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 space-y-3">
                  <p className="text-xs text-emerald-700 font-medium">
                    Enter VistaNet credentials to scan live data directly. No sync setup required.
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">VistaNet URL</label>
                      <input
                        type="text"
                        value={directUrl}
                        onChange={e => setDirectUrl(e.target.value)}
                        placeholder="https://visualzone.vistanet.cloud"
                        className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-400"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Location</label>
                      <input
                        value={directLocation}
                        onChange={e => setDirectLocation(e.target.value)}
                        className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-400 bg-white"
                        placeholder="e.g. MANATI"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Username</label>
                      <input
                        type="text"
                        value={directUser}
                        onChange={e => setDirectUser(e.target.value)}
                        placeholder="username"
                        className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-400"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Password</label>
                      <div className="relative">
                        <input
                          type={directShowPassword ? 'text' : 'password'}
                          value={directPassword}
                          onChange={e => setDirectPassword(e.target.value)}
                          placeholder="••••••••"
                          className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-400 pr-10"
                        />
                        <button
                          type="button"
                          onClick={() => setDirectShowPassword(!directShowPassword)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                        >
                          {directShowPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Date range */}
              <div className="flex gap-3">
                <div className="flex-1">
                  <DatePicker label="From" value={auditDateFrom} onChange={setAuditDateFrom} />
                </div>
                <div className="flex-1">
                  <DatePicker label="To" value={auditDateTo} onChange={setAuditDateTo} />
                </div>
              </div>

              <button
                onClick={runAudit}
                disabled={auditLoading || !auditDateFrom || !auditDateTo || (auditMode === 'direct' && (!directUser || !directPassword))}
                className={`flex items-center gap-2 text-white text-sm font-medium px-5 py-2.5 rounded-lg transition-colors ${
                  auditMode === 'direct'
                    ? 'bg-emerald-500 hover:bg-emerald-600 disabled:bg-emerald-300'
                    : 'bg-sky-500 hover:bg-sky-600 disabled:bg-sky-300'
                }`}
              >
                <Search className="w-4 h-4" />
                {auditLoading
                  ? (auditMode === 'direct' ? 'Scanning...' : 'Running...')
                  : (auditMode === 'direct' ? 'Scan VistaNet' : 'Run Audit')
                }
              </button>

              {/* Live progress panel — direct VistaNet mode only */}
              {auditLoading && auditMode === 'direct' && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 space-y-3">
                  {/* Phase label */}
                  <div className="flex items-center gap-2 text-emerald-700 text-sm font-medium">
                    <span className="animate-spin inline-block w-4 h-4 border-2 border-emerald-500 border-t-transparent rounded-full" />
                    {auditProgress?.phase === 'login'
                      ? (auditProgress.message || 'Connecting to VistaNet...')
                      : auditProgress?.day_number != null
                        ? `Scanning day ${auditProgress.day_number} of ${auditProgress.total_days}${auditProgress.day ? ` — ${new Date(auditProgress.day + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}` : ''}`
                        : 'Connecting...'}
                  </div>

                  {/* Progress bar */}
                  {auditProgress?.day_number != null && auditProgress.total_days != null && (
                    <div className="w-full bg-emerald-200 rounded-full h-2 overflow-hidden">
                      <div
                        className="bg-emerald-500 h-2 rounded-full transition-all duration-500"
                        style={{ width: `${Math.round((auditProgress.day_number / auditProgress.total_days) * 100)}%` }}
                      />
                    </div>
                  )}

                  {/* Running stats */}
                  {auditProgress?.patients_scanned != null && (
                    <div className="flex flex-wrap gap-4 text-xs text-emerald-700">
                      <span>👤 {auditProgress.patients_scanned} patients scanned</span>
                      {(auditProgress.flagged_so_far ?? 0) > 0 && (
                        <span>🚩 {auditProgress.flagged_so_far} flagged</span>
                      )}
                      {(auditProgress.lost_so_far ?? 0) > 0 && (
                        <span className="font-semibold text-red-600">
                          💰 ${(auditProgress.lost_so_far ?? 0).toFixed(2)} lost revenue found
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )}

              {auditError && (
                <div className="flex items-center gap-2 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-4 py-3">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  {auditError}
                </div>
              )}

              {auditResult && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-600">
                      {auditResult.flagged_count === 0
                        ? 'No missing claims found'
                        : `${auditResult.flagged_count} invoice${auditResult.flagged_count !== 1 ? 's' : ''} flagged`}
                    </span>
                    {auditResult.total_lost > 0 && (
                      <span className="text-base font-bold text-red-600">
                        Total lost: ${auditResult.total_lost.toFixed(2)}
                      </span>
                    )}
                  </div>

                  {auditResult.flagged.length > 0 && (
                    <div className="overflow-x-auto rounded-xl border border-slate-200">
                      <table className="w-full text-sm">
                        <thead className="bg-slate-50 border-b border-slate-200">
                          <tr>
                            <th className="text-left px-3 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">Date</th>
                            <th className="text-left px-3 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">Patient</th>
                            <th className="text-left px-3 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">Invoice #</th>
                            <th className="text-left px-3 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">Payer</th>
                            <th className="text-left px-3 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">Attended By</th>
                            <th className="text-right px-3 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">Plan $</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {auditResult.flagged.map((entry, i) => (
                            <tr key={i} className="hover:bg-slate-50 transition-colors">
                              <td className="px-3 py-2.5 text-slate-700 whitespace-nowrap">{entry.date ? new Date(entry.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}</td>
                              <td className="px-3 py-2.5 font-medium text-slate-900">{entry.patient_name}</td>
                              <td className="px-3 py-2.5 text-slate-600">{entry.invoice_number || '—'}</td>
                              <td className="px-3 py-2.5 text-slate-600">{entry.payer || '—'}</td>
                              <td className="px-3 py-2.5 text-slate-600">{entry.attended_by || '—'}</td>
                              <td className="px-3 py-2.5 text-right font-semibold text-red-600">${entry.plan_amount.toFixed(2)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Account Settings */}
          {active === 'account' && (
            <div className="space-y-6">
              <h2 className="font-semibold text-slate-800">Account Settings</h2>

              {/* Display Name */}
              <div className="border border-slate-200 rounded-xl p-4 space-y-3">
                <h3 className="font-medium text-slate-700 text-sm">Display Name</h3>
                <div>
                  <label className={labelClass}>Full Name</label>
                  <input
                    value={acctName}
                    onChange={e => setAcctName(e.target.value)}
                    className={inputClass}
                    placeholder="Your name"
                  />
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleSaveProfile}
                    disabled={acctSavingProfile || !acctName.trim()}
                    className="flex items-center gap-2 bg-sky-500 hover:bg-sky-600 text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50"
                  >
                    <Save className="w-4 h-4" />
                    {acctSavingProfile ? 'Saving...' : 'Save Name'}
                  </button>
                  {acctProfileMsg && (
                    <span className={`text-sm ${acctProfileMsg.ok ? 'text-emerald-600' : 'text-red-600'}`}>
                      {acctProfileMsg.ok ? '✓' : '✗'} {acctProfileMsg.text}
                    </span>
                  )}
                </div>
              </div>

              {/* Change Password */}
              <div className="border border-slate-200 rounded-xl p-4 space-y-3">
                <h3 className="font-medium text-slate-700 text-sm">Change Password</h3>
                <div>
                  <label className={labelClass}>Current Password</label>
                  <div className="relative">
                    <input
                      type={acctShowCurrentPw ? 'text' : 'password'}
                      value={acctCurrentPw}
                      onChange={e => setAcctCurrentPw(e.target.value)}
                      className={inputClass}
                      placeholder="Current password"
                      autoComplete="current-password"
                    />
                    <button
                      type="button"
                      onClick={() => setAcctShowCurrentPw(v => !v)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    >
                      {acctShowCurrentPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                <div>
                  <label className={labelClass}>New Password</label>
                  <div className="relative">
                    <input
                      type={acctShowNewPw ? 'text' : 'password'}
                      value={acctNewPw}
                      onChange={e => setAcctNewPw(e.target.value)}
                      className={inputClass}
                      placeholder="New password (min 8 chars)"
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      onClick={() => setAcctShowNewPw(v => !v)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    >
                      {acctShowNewPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                <div>
                  <label className={labelClass}>Confirm New Password</label>
                  <input
                    type="password"
                    value={acctConfirmPw}
                    onChange={e => setAcctConfirmPw(e.target.value)}
                    className={inputClass}
                    placeholder="Confirm new password"
                    autoComplete="new-password"
                  />
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleChangePassword}
                    disabled={acctSavingPw}
                    className="flex items-center gap-2 bg-sky-500 hover:bg-sky-600 text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50"
                  >
                    <Save className="w-4 h-4" />
                    {acctSavingPw ? 'Updating...' : 'Change Password'}
                  </button>
                  {acctPwMsg && (
                    <span className={`text-sm ${acctPwMsg.ok ? 'text-emerald-600' : 'text-red-600'}`}>
                      {acctPwMsg.ok ? '✓' : '✗'} {acctPwMsg.text}
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Team & Roles */}
          {active === 'team' && (
            <div className="space-y-4">
              {/* Dagger-style sub-tabs */}
              <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1 w-fit">
                {([['users', 'Users', teamMembers.length] as const, ['roles', 'Roles & Permissions', null] as const]).map(([key, label, count]) => (
                  <button
                    key={key}
                    onClick={() => setTeamTab(key)}
                    className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                      teamTab === key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    {label}{count != null ? ` (${count})` : ''}
                  </button>
                ))}
              </div>

              {teamTab === 'roles' && (
                <Suspense fallback={<div className="text-slate-400 text-sm p-4">Loading…</div>}>
                  <RolesPage />
                </Suspense>
              )}

              {teamTab === 'users' && (<>
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-slate-800">Users</h2>
                {currentUserRole === 'admin' && (
                  <button
                    onClick={() => { setShowInviteModal(true); setInviteError(null); }}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-sky-500 hover:bg-sky-600 text-white text-sm font-medium rounded-lg"
                  >
                    <UserPlus className="w-4 h-4" />
                    Invite User
                  </button>
                )}
              </div>

              {teamLoading && <p className="text-sm text-slate-400">Loading...</p>}
              {teamError && <p className="text-sm text-red-500">{teamError}</p>}

              {!teamLoading && teamMembers.length > 0 && (
                <div className="border border-slate-200 rounded-xl overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr>
                        <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Member</th>
                        <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Role</th>
                        <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Status</th>
                        {currentUserRole === 'admin' && (
                          <th className="px-4 py-2.5" />
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {teamMembers.map(member => (
                        <tr key={member.id} className="hover:bg-slate-50 transition-colors">
                          <td className="px-4 py-3">
                            <div className="font-medium text-slate-800">{member.full_name || '—'}</div>
                            <div className="text-xs text-slate-400">{member.email}</div>
                          </td>
                          <td className="px-4 py-3">
                            {currentUserRole === 'admin' && member.user_id !== currentUserId ? (
                              <div className="relative inline-block">
                                <select
                                  value={member.role}
                                  onChange={e => handleUpdateMemberRole(member.user_id, e.target.value)}
                                  className="appearance-none pl-2 pr-6 py-1 text-xs border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-sky-400 cursor-pointer"
                                >
                                  <option value="admin">Admin</option>
                                  <option value="biller">Biller</option>
                                  <option value="viewer">Viewer</option>
                                </select>
                                <ChevronDown className="w-3 h-3 absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                              </div>
                            ) : (
                              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                                member.role === 'admin' ? 'bg-purple-100 text-purple-700' :
                                member.role === 'biller' ? 'bg-sky-100 text-sky-700' :
                                'bg-slate-100 text-slate-600'
                              }`}>
                                {member.role.charAt(0).toUpperCase() + member.role.slice(1)}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex items-center gap-1 text-xs ${
                              member.accepted_at ? 'text-emerald-600' : 'text-amber-500'
                            }`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${
                                member.accepted_at ? 'bg-emerald-500' : 'bg-amber-400'
                              }`} />
                              {member.accepted_at ? 'Active' : 'Pending'}
                            </span>
                          </td>
                          {currentUserRole === 'admin' && (
                            <td className="px-4 py-3 text-right">
                              {member.user_id !== currentUserId && (
                                <button
                                  onClick={() => handleRemoveMember(member.user_id)}
                                  className="text-red-400 hover:text-red-600 transition-colors p-1 rounded"
                                  title="Remove from organization"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              )}
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Invite Modal */}
              {showInviteModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
                  <div className="bg-white rounded-xl border border-slate-200 shadow-xl p-6 w-full max-w-md mx-4">
                    <h3 className="font-semibold text-slate-800 mb-4">Add User</h3>
                    <p className="text-sm text-slate-500 mb-4">
                      Create a new account and add them to your organization, or enter an existing user's email.
                    </p>
                    <div className="space-y-3">
                      <div>
                        <label className={labelClass}>Username / Email</label>
                        <input
                          value={inviteEmail}
                          onChange={e => setInviteEmail(e.target.value)}
                          className={inputClass}
                          placeholder="username or email"
                        />
                      </div>
                      <div>
                        <label className={labelClass}>Full Name</label>
                        <input
                          value={inviteName}
                          onChange={e => setInviteName(e.target.value)}
                          className={inputClass}
                          placeholder="Full name (optional for existing users)"
                        />
                      </div>
                      <div>
                        <label className={labelClass}>Password <span className="text-slate-400 font-normal">(for new accounts)</span></label>
                        <input
                          value={invitePassword}
                          onChange={e => setInvitePassword(e.target.value)}
                          className={inputClass}
                          placeholder="Password (leave blank if user exists)"
                          type="password"
                        />
                      </div>
                      <div>
                        <label className={labelClass}>Role</label>
                        <select
                          value={inviteRole}
                          onChange={e => setInviteRole(e.target.value)}
                          className={inputClass}
                        >
                          <option value="admin">Admin — Full access, can manage users</option>
                          <option value="biller">Biller — Can submit claims and manage billing</option>
                          <option value="viewer">Viewer — Read-only access</option>
                        </select>
                      </div>
                      {inviteError && (
                        <p className="text-sm text-red-500">{inviteError}</p>
                      )}
                    </div>
                    <div className="flex items-center justify-end gap-3 mt-5">
                      <button
                        onClick={() => { setShowInviteModal(false); setInviteError(null); }}
                        className="text-sm text-slate-500 hover:text-slate-700 px-4 py-2"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleInviteUser}
                        disabled={inviting || !inviteEmail.trim()}
                        className="flex items-center gap-2 bg-sky-500 hover:bg-sky-600 text-white text-sm font-medium px-5 py-2 rounded-lg disabled:opacity-50"
                      >
                        <UserPlus className="w-4 h-4" />
                        {inviting ? 'Adding...' : 'Add User'}
                      </button>
                    </div>
                  </div>
                </div>
              )}
              </>)}
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
          {active !== 'lang' && active !== 'providers' && active !== 'payers' && active !== 'fee-schedule' && active !== 'pairing' && active !== 'connections' && active !== 'portals' && active !== 'audit' && active !== 'team' && active !== 'account' && (
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
