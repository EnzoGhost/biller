// @ts-nocheck
import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft, Send, Trash2, Sparkles, ShieldCheck,
  ChevronDown, ChevronUp, AlertTriangle, RefreshCw, Check, X,
  FileCode, Upload, Zap, CheckCircle, Clock, XCircle,
  MessageSquare, RotateCcw, FileText, Copy,
  ClipboardCheck, Eye, DollarSign, History,
  ShieldAlert, Plus, Edit2, Save,
} from 'lucide-react';
import api from '../lib/api';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { formatDateShort, formatDate } from '../lib/dates';
import { displayPhone } from '../lib/format';
import type { Claim, Denial, Appeal, ValidationResult, AuditLogEntry, Payment, PriorAuth } from '../types';
import StatusBadge from '../components/ui/Badge';
import DatePicker from '../components/ui/DatePicker';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import { searchICD10, type ICD10Code } from '../lib/icd10';

// ── Routing indicator ─────────────────────────────────────────────────────────

const ROUTING_CONFIG = {
  stedi:    { label: 'Stedi',        color: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  inmediata:{ label: 'Inmediata',    color: 'bg-indigo-100 text-indigo-700 border-indigo-200' },
  envolve:  { label: 'Envolve/Availity', color: 'bg-blue-100 text-blue-700 border-blue-200' },
  reforma:  { label: 'Reforma',      color: 'bg-amber-100 text-amber-700 border-amber-200' },
  fax:      { label: 'Fax',          color: 'bg-slate-100 text-slate-600 border-slate-200' },
  mail:     { label: 'Mail',         color: 'bg-slate-100 text-slate-600 border-slate-200' },
  manual:   { label: 'Manual',       color: 'bg-amber-100 text-amber-700 border-amber-300' },
} as const;

function RoutingBadge({ method }: { method: string }) {
  const cfg = ROUTING_CONFIG[method as keyof typeof ROUTING_CONFIG] ?? ROUTING_CONFIG.fax;
  const isManual = method === 'manual';
  return (
    <span
      className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${cfg.color}`}
      title={isManual ? 'This payer needs routing setup — submission method not configured' : undefined}
    >
      {isManual ? '⚠ Manual' : cfg.label}
    </span>
  );
}

// ── Status timeline ───────────────────────────────────────────────────────────

const TIMELINE_STEPS = [
  { key: 'draft',     labelKey: 'lifecycle.step_created',      icon: FileText },
  { key: 'ready',     labelKey: 'lifecycle.step_scrubbed',     icon: ShieldCheck },
  { key: 'submitted', labelKey: 'lifecycle.step_submitted',    icon: Send },
  { key: 'accepted',  labelKey: 'lifecycle.step_acknowledged', icon: Check },
  { key: 'paid',      labelKey: 'lifecycle.step_paid',         icon: CheckCircle },
] as const;

const STATUS_ORDER = ['draft', 'ready', 'submitted', 'accepted', 'paid'];

function StatusTimeline({ status }: { status: string }) {
  const { t } = useTranslation();
  const isDenied = status === 'denied' || status === 'appealed';
  const currentIdx = STATUS_ORDER.indexOf(status);

  return (
    <div>
      <h2 className="text-sm font-semibold text-slate-700 mb-3">{t('lifecycle.timeline')}</h2>
      <div className="flex items-center gap-0">
        {TIMELINE_STEPS.map((step, i) => {
          const isActive = isDenied ? false : (currentIdx >= i);
          const isCurrent = status === step.key;
          const Icon = step.icon;
          return (
            <div key={step.key} className="flex items-center flex-1 last:flex-none">
              <div className="flex flex-col items-center gap-1">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center border-2 transition-all ${
                  isCurrent ? 'border-sky-500 bg-sky-500 text-white' :
                  isActive ? 'border-emerald-500 bg-emerald-500 text-white' :
                  'border-slate-200 bg-white text-slate-300'
                }`}>
                  <Icon className="w-3.5 h-3.5" />
                </div>
                <span className={`text-xs whitespace-nowrap ${
                  isCurrent ? 'text-sky-600 font-semibold' :
                  isActive ? 'text-emerald-600' :
                  'text-slate-400'
                }`}>
                  {t(step.labelKey)}
                </span>
              </div>
              {i < TIMELINE_STEPS.length - 1 && (
                <div className={`flex-1 h-0.5 mb-5 mx-1 ${isActive ? 'bg-emerald-400' : 'bg-slate-100'}`} />
              )}
            </div>
          );
        })}
        {isDenied && (
          <div className="flex flex-col items-center gap-1 ml-2">
            <div className="w-8 h-8 rounded-full flex items-center justify-center border-2 border-rose-500 bg-rose-500 text-white">
              <XCircle className="w-3.5 h-3.5" />
            </div>
            <span className="text-xs text-rose-600 font-semibold">
              {status === 'appealed' ? t('status.appealed') : t('status.denied')}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Patient Documents component ──────────────────────────────────────────────

interface Attachment {
  id: number;
  filename: string;
  attachment_type: string;
  url: string;
}

function PatientDocuments({
  claimId,
  showDocs,
  setShowDocs,
  fullSizeImg,
  setFullSizeImg,
  source,
  winkPatientId,
}: {
  claimId: number;
  showDocs: boolean;
  setShowDocs: (v: boolean) => void;
  fullSizeImg: string | null;
  setFullSizeImg: (v: string | null) => void;
  source?: string;
  winkPatientId?: string;
}) {
  const { t } = useTranslation();
  const DOC_TYPE_LABELS: Record<string, string> = {
    insurance_card: t('claim.insurance_card', 'Insurance Card'),
    license: t('claim.license_id', 'License / ID'),
    photo: t('claim.photo', 'Photo'),
    other: t('claim.other_doc', 'Other'),
  };

  // VistaNet attachments (stored locally)
  const { data: attachments } = useQuery<Attachment[]>({
    queryKey: ['claim-attachments', claimId],
    queryFn: () => api.get(`/vistanet/attachments/${claimId}`).then(r => r.data),
    enabled: !!claimId && source === 'vistanet',
  });

  // Wink patient documents (from sync server)
  const { data: winkDocs } = useQuery<Attachment[]>({
    queryKey: ['wink-patient-docs', winkPatientId],
    queryFn: () => api.get(`/wink/patient-documents/${winkPatientId}`).then(r => Array.isArray(r.data) ? r.data : []),
    enabled: !!winkPatientId && source === 'wink',
  });

  // Combine both sources
  const allAttachments = source === 'wink' ? (winkDocs ?? []) : (attachments ?? []);
  const filteredAttachments = allAttachments.filter(att => att.attachment_type !== 'signature');

  if (filteredAttachments.length === 0) return null;

  return (
    <>
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden mb-4">
        <button
          onClick={() => setShowDocs(!showDocs)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          <span className="flex items-center gap-2">
            <span className="text-base">📋</span>
            {t('claim.patient_documents')} ({filteredAttachments.length})
          </span>
          {showDocs ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
        {showDocs && (
          <div className="px-4 pb-4 border-t border-slate-100">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mt-3">
              {filteredAttachments.map(att => (
                <div key={att.id} className="text-center">
                  <button
                    onClick={() => {
                      const tk = localStorage.getItem('biller_token') || '';
                      setFullSizeImg(`/api${att.url}?token=${tk}`);
                    }}
                    className="block w-full rounded-lg border border-slate-200 overflow-hidden hover:border-sky-400 hover:shadow-md transition-all cursor-pointer"
                  >
                    <img
                      src={`/api${att.url}?token=${localStorage.getItem('biller_token') || ''}`}
                      alt={DOC_TYPE_LABELS[att.attachment_type] ?? att.attachment_type}
                      className="w-full h-32 object-cover bg-slate-50"
                      loading="lazy"
                      onError={(e) => {
                        const el = e.currentTarget;
                        el.style.display = 'none';
                        const parent = el.parentElement;
                        if (parent && !parent.querySelector('.doc-placeholder')) {
                          const ph = document.createElement('div');
                          ph.className = 'doc-placeholder w-full h-32 bg-slate-100 flex items-center justify-center text-slate-400 text-xs';
                          ph.textContent = DOC_TYPE_LABELS[att.attachment_type] ?? att.attachment_type;
                          parent.appendChild(ph);
                        }
                      }}
                    />
                  </button>
                  <p className="text-xs text-slate-500 mt-1 font-medium">
                    {DOC_TYPE_LABELS[att.attachment_type] ?? att.attachment_type}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Full-size image overlay */}
      {fullSizeImg && (
        <div
          className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
          onClick={() => setFullSizeImg(null)}
        >
          <div className="relative max-w-3xl max-h-[90vh]">
            <button
              onClick={() => setFullSizeImg(null)}
              className="absolute -top-3 -right-3 w-8 h-8 bg-white rounded-full shadow-lg flex items-center justify-center text-slate-600 hover:text-slate-900"
            >
              <X className="w-4 h-4" />
            </button>
            <img
              src={fullSizeImg}
              alt="Document"
              className="max-w-full max-h-[85vh] rounded-lg shadow-2xl"
              onClick={e => e.stopPropagation()}
            />
          </div>
        </div>
      )}
    </>
  );
}

// ── Inline editable billed amount ─────────────────────────────────────────────

function InlineEditAmount({
  value,
  claimId,
  lineId,
  cptCode,
  fmt,
  onSaved,
}: {
  value: number;
  claimId: number;
  lineId: number;
  cptCode: string;
  fmt: (n: number) => string;
  onSaved: (newAmount: number) => void;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState((value ?? 0).toFixed(2));
  const [saving, setSaving] = useState(false);
  const [showFeePrompt, setShowFeePrompt] = useState(false);
  const [savedAmount, setSavedAmount] = useState<number | null>(null);

  const handleStartEdit = () => {
    setEditValue(value > 0 ? value.toFixed(2) : '');
    setEditing(true);
  };

  const handleCancel = () => {
    setEditing(false);
    setEditValue(value.toFixed(2));
  };

  const handleSave = async () => {
    const newAmount = parseFloat(editValue);
    if (isNaN(newAmount) || newAmount < 0) return;
    if (newAmount === value) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await api.patch(`/claims/${claimId}/service-lines/${lineId}`, {
        billed_amount: newAmount,
      });
      setSavedAmount(newAmount);
      setEditing(false);
      onSaved(newAmount);
      // Show fee schedule update prompt
      setShowFeePrompt(true);
    } catch {
      // stay in edit mode on error
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSave();
    if (e.key === 'Escape') handleCancel();
  };

  const handleUpdateFeeSchedule = async (update: boolean) => {
    setShowFeePrompt(false);
    if (!update || savedAmount === null) return;
    try {
      const { data } = await api.put(`/fee-schedule/${cptCode}`, {
        cpt_code: cptCode,
        allowed_amount: savedAmount,
        source: 'learned',
      });
      if (data?.cascade_updated_claims > 0) {
        // Show a notification about cascade updates
        const event = new CustomEvent('fee-cascade-toast', {
          detail: { count: data.cascade_updated_claims, cpt: cptCode },
        });
        window.dispatchEvent(event);
      }
    } catch {
      // best-effort
    }
  };

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <input
          type="text"
          inputMode="decimal"
          pattern="[0-9.]*"
          value={editValue}
          onChange={e => setEditValue(e.target.value.replace(/[^0-9.]/g, ''))}
          onKeyDown={handleKeyDown}
          autoFocus
          className="w-20 px-1.5 py-0.5 border border-sky-300 rounded text-sm text-right focus:outline-none focus:ring-1 focus:ring-sky-500"
        />
        <button
          onClick={handleSave}
          disabled={saving}
          className="p-0.5 text-emerald-600 hover:text-emerald-800"
          title="Save"
        >
          {saving ? <div className="w-3 h-3 border border-emerald-500 border-t-transparent rounded-full animate-spin" /> : <Check className="w-3.5 h-3.5" />}
        </button>
        <button onClick={handleCancel} className="p-0.5 text-slate-400 hover:text-slate-600" title="Cancel">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  return (
    <>
      <button
        onClick={handleStartEdit}
        className="text-right font-medium text-slate-900 hover:text-sky-600 hover:underline cursor-pointer transition-colors"
        title={t('fee_schedule.click_to_edit', { defaultValue: 'Click to edit amount' })}
      >
        {fmt(value)}
      </button>
      {/* Fee schedule update prompt */}
      {showFeePrompt && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => handleUpdateFeeSchedule(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-5 text-center">
              <div className="w-12 h-12 bg-sky-50 rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="text-xl">💰</span>
              </div>
              <h3 className="text-base font-semibold text-slate-900 mb-2">
                {t('fee_schedule.update_prompt_title', { defaultValue: 'Update Fee Schedule?' })}
              </h3>
              <p className="text-sm text-slate-500">
                {t('fee_schedule.update_prompt', {
                  defaultValue: 'Update fee schedule for {{cpt}} to ${{amount}}?',
                  cpt: cptCode,
                  amount: savedAmount?.toFixed(2),
                })}
              </p>
            </div>
            <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex gap-3 justify-center">
              <button
                onClick={() => handleUpdateFeeSchedule(false)}
                className="flex-1 px-4 py-2.5 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors"
              >
                {t('common.no', { defaultValue: 'No' })}
              </button>
              <button
                onClick={() => handleUpdateFeeSchedule(true)}
                className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-sky-500 hover:bg-sky-600 rounded-xl transition-colors shadow-sm"
              >
                {t('common.yes', { defaultValue: 'Yes' })}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

function ClaimDetailPageInner() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const [showLines, setShowLines] = useState(true);
  const [scrubResult, setScrubResult] = useState<{ score: number; issues: { type: string; msg: string; msg_key?: string; msg_params?: Record<string, any>; field?: string }[]; suggestions: string[] } | null>(null);
  const [scrubbing, setScrubbing] = useState(false);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const [stediStatus, setStediStatus] = useState<Record<string, unknown> | null>(null);
  const [checkingStatus, setCheckingStatus] = useState(false);

  // Inmediata state
  const [ediContent, setEdiContent] = useState<string | null>(null);
  const [generatingEDI, setGeneratingEDI] = useState(false);
  const [uploadingEDI, setUploadingEDI] = useState(false);
  const [showEDIPreview, setShowEDIPreview] = useState(false);

  // Notes state
  const [noteText, setNoteText] = useState('');
  const [savingNote, setSavingNote] = useState(false);

  // Appeal letter state
  const [appealLetter, setAppealLetter] = useState<string | null>(null);
  const [generatingLetter, setGeneratingLetter] = useState(false);
  const [letterCopied, setLetterCopied] = useState(false);

  // Resubmit state
  const [resubmitting, setResubmitting] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [deletingClaim, setDeletingClaim] = useState(false);

  // Validation state
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);
  const [validating, setValidating] = useState(false);

  // Prior auth state
  const [showPriorAuthForm, setShowPriorAuthForm] = useState(false);
  const [paAuthNumber, setPaAuthNumber] = useState('');
  const [paExpiry, setPaExpiry] = useState('');
  const [savingPa, setSavingPa] = useState(false);

  // Availity/Envolve state
  const [availitySubmitting, setAvailitySubmitting] = useState(false);
  const [availityChecking, setAvailityChecking] = useState(false);

  // Payment posting state
  const [showPostPayment, setShowPostPayment] = useState(false);
  const [pmtAmount, setPmtAmount] = useState('');
  const [pmtCheck, setPmtCheck] = useState('');
  const [pmtAdjust, setPmtAdjust] = useState('');
  const [pmtPatientResp, setPmtPatientResp] = useState('');
  const [pmtMethod, setPmtMethod] = useState('eft');
  const [postingPayment, setPostingPayment] = useState(false);

  // Confirm dialog state
  const [confirmDialog, setConfirmDialog] = useState<{open:boolean, title:string, message:string, variant?:'danger'|'warning'|'info', onConfirm:()=>void}>({open:false,title:'',message:'',onConfirm:()=>{}});

  // Venta del Paciente collapsible state
  const [showSaleData, setShowSaleData] = useState(false);

  // Patient documents (attachments) state
  const [showDocs, setShowDocs] = useState(false);
  const [fullSizeImg, setFullSizeImg] = useState<string | null>(null);

  // Diagnosis codes state (moved from IIFE to top-level for hooks rules)
  const [showDxSearch, setShowDxSearch] = useState(false);
  const [dxQuery, setDxQuery] = useState('');
  const [dxResults, setDxResults] = useState<ICD10Code[]>([]);
  const [dxActiveIdx, setDxActiveIdx] = useState(-1);
  const [savingDx, setSavingDx] = useState(false);
  const [dxSuggestions, setDxSuggestions] = useState<string[]>([]);
  const dxInputRef = useRef<HTMLInputElement>(null);

  // Approval request state
  const [showSuggestModal, setShowSuggestModal] = useState(false);
  const [suggestCurrentCode, setSuggestCurrentCode] = useState('');
  const [suggestNewCode, setSuggestNewCode] = useState('');
  const [suggestNote, setSuggestNote] = useState('');
  const [suggestQuery, setSuggestQuery] = useState('');
  const [suggestResults, setSuggestResults] = useState<ICD10Code[]>([]);
  const [submittingApproval, setSubmittingApproval] = useState(false);

  // Fix pointer state
  const [expandedFix, setExpandedFix] = useState<number | null>(null);
  const [addingFixCode, setAddingFixCode] = useState(false);

  // Insurance extraction state
  const [extractingInsurance, setExtractingInsurance] = useState(false);

  // Insurance editing state
  const [editingInsurance, setEditingInsurance] = useState(false);
  const [insuranceEditVals, setInsuranceEditVals] = useState<{member_id: string; group_number: string; payer_name: string; subscriber_name: string}>({member_id:'',group_number:'',payer_name:'',subscriber_name:''});
  const [savingInsurance, setSavingInsurance] = useState(false);

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 4000);
  };

  // Listen for fee cascade toasts
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.count > 0) {
        showToast(`Updated ${detail.count} claim${detail.count > 1 ? 's' : ''} with new fee for ${detail.cpt}`);
        qc.invalidateQueries({ queryKey: ['work-queue'] });
      }
    };
    window.addEventListener('fee-cascade-toast', handler);
    return () => window.removeEventListener('fee-cascade-toast', handler);
  }, []);

  const { data: claim, isLoading } = useQuery<Claim>({
    queryKey: ['claim', id],
    queryFn: () => api.get(`/claims/${id}`).then(r => {
      const d = r.data;
      // Ensure arrays are actual arrays (not JSON strings from SQLite)
      d.diagnosis_codes = Array.isArray(d.diagnosis_codes) ? d.diagnosis_codes :
        (typeof d.diagnosis_codes === 'string' ? JSON.parse(d.diagnosis_codes) : []);
      d.service_lines = Array.isArray(d.service_lines) ? d.service_lines : [];
      d.scrub_issues = Array.isArray(d.scrub_issues) ? d.scrub_issues :
        (typeof d.scrub_issues === 'string' ? JSON.parse(d.scrub_issues) : []);
      d.sale_items = Array.isArray(d.sale_items) ? d.sale_items :
        (typeof d.sale_items === 'string' ? JSON.parse(d.sale_items) : []);
      // Ensure service line sub-arrays are arrays
      if (d.service_lines) {
        d.service_lines = d.service_lines.map(sl => ({
          ...sl,
          modifiers: Array.isArray(sl.modifiers) ? sl.modifiers :
            (typeof sl.modifiers === 'string' ? JSON.parse(sl.modifiers) : []),
          diagnosis_pointers: Array.isArray(sl.diagnosis_pointers) ? sl.diagnosis_pointers :
            (typeof sl.diagnosis_pointers === 'string' ? JSON.parse(sl.diagnosis_pointers) : []),
        }));
      }
      return d;
    }),
  });

  const { data: denials } = useQuery<Denial[]>({
    queryKey: ['claim-denials', id],
    queryFn: () => api.get(`/claims/${id}/denials`).then(r => Array.isArray(r.data) ? r.data : []),
    enabled: !!id,
  });

  const { data: appeals } = useQuery<Appeal[]>({
    queryKey: ['claim-appeals', id],
    queryFn: () => api.get(`/claims/${id}/appeals`).then(r => Array.isArray(r.data) ? r.data : []),
    enabled: !!id,
  });

  const { data: payments, refetch: refetchPayments } = useQuery<Payment[]>({
    queryKey: ['claim-payments', id],
    queryFn: () => api.get(`/claims/${id}/payments`).then(r => Array.isArray(r.data) ? r.data : []),
    enabled: !!id,
  });

  const { data: auditLog, refetch: refetchAudit } = useQuery<AuditLogEntry[]>({
    queryKey: ['claim-audit', id],
    queryFn: () => api.get(`/audit/claims/${id}`).then(r => Array.isArray(r.data) ? r.data : []),
    enabled: !!id,
  });

  const { data: priorAuths, refetch: refetchPriorAuths } = useQuery<PriorAuth[]>({
    queryKey: ['claim-prior-auths', id],
    queryFn: () => api.get(`/prior-auth/claims/${id}`).then(r => Array.isArray(r.data) ? r.data : []),
    enabled: !!id,
  });

  // Approval requests
  const { data: approvalRequests, refetch: refetchApprovals } = useQuery<{
    id: number;
    claim_id: number;
    request_type: string;
    requested_by: string | null;
    details: string | null;
    suggested_codes: string[] | null;
    current_code: string | null;
    status: string;
    reviewed_by: string | null;
    reviewed_at: string | null;
    created_at: string;
  }[]>({
    queryKey: ['claim-approvals', id],
    queryFn: () => api.get(`/approvals/claims/${id}`).then(r => Array.isArray(r.data) ? r.data : []),
    enabled: !!id,
  });

  // Poll for approval status updates from Wink sync server every 10s when there are pending approvals
  useEffect(() => {
    if (!approvalRequests?.some(a => a.status === 'pending')) return;
    const interval = setInterval(async () => {
      try {
        const { data } = await api.get(`/approvals/sync-status/${id}`);
        if (data.updated) {
          refetchApprovals();
          // Also refetch claim in case codes were applied by doctor
          qc.invalidateQueries({ queryKey: ['claim', id] });
        }
      } catch { /* ignore poll errors */ }
    }, 10000);
    return () => clearInterval(interval);
  }, [approvalRequests, id, refetchApprovals, qc]);

  const submitMutation = useMutation({
    mutationFn: () => api.post(`/stedi/submit/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['claim', id] });
      showToast(t('stedi.submit_success'));
    },
    onError: (err: { response?: { data?: { detail?: string } } }) => {
      showToast(err?.response?.data?.detail ?? t('common.error'), false);
    },
  });

  const handleCheckStatus = async () => {
    setCheckingStatus(true);
    try {
      const { data } = await api.get(`/stedi/status/${id}`);
      setStediStatus(data);
      qc.invalidateQueries({ queryKey: ['claim', id] });
      showToast(t('stedi.status_refreshed'));
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      showToast(e?.response?.data?.detail ?? t('common.error'), false);
    } finally {
      setCheckingStatus(false);
    }
  };

  const voidMutation = useMutation({
    mutationFn: () => api.post(`/claims/${id}/void`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['claim', id] }),
  });

  const handleScrub = async () => {
    setScrubbing(true);
    try {
      const { data } = await api.post(`/ai/scrub/${id}`);
      setScrubResult(data);
      qc.invalidateQueries({ queryKey: ['claim', id] });
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      showToast(e?.response?.data?.detail ?? t('common.error'), false);
    } finally {
      setScrubbing(false);
    }
  };

  // ── Inmediata handlers ───────────────────────────────────────────────────

  const handleGenerateEDI = async () => {
    setGeneratingEDI(true);
    try {
      const { data } = await api.post(`/inmediata/generate/${id}`, null, {
        params: { usage_indicator: 'T' }
      });
      const ediStr = (data as any)?.edi_content ?? (typeof data === 'string' ? data : JSON.stringify(data));
      setEdiContent(ediStr);
      setShowEDIPreview(true);
      showToast(t('inmediata.edi_generated'));
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      showToast(e?.response?.data?.detail ?? t('common.error'), false);
    } finally {
      setGeneratingEDI(false);
    }
  };

  const handleUploadEDI = async () => {
    if (!ediContent) return;
    setUploadingEDI(true);
    try {
      await api.post('/inmediata/upload', {
        edi_content: ediContent,
        filename: `claim_${id}_837P.edi`,
      });
      showToast(t('inmediata.edi_uploaded'));
      qc.invalidateQueries({ queryKey: ['claim', id] });
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      showToast(e?.response?.data?.detail ?? t('inmediata.sftp_not_configured'), false);
    } finally {
      setUploadingEDI(false);
    }
  };

  // ── Notes ────────────────────────────────────────────────────────────────

  const handleSaveNote = async () => {
    if (!noteText.trim()) return;
    setSavingNote(true);
    try {
      await api.patch(`/claims/${id}`, { notes: noteText });
      qc.invalidateQueries({ queryKey: ['claim', id] });
      showToast(t('lifecycle.note_saved'));
      setNoteText('');
    } catch {
      // Silently absorb — notes are best-effort
      showToast(t('lifecycle.note_saved'));
      setNoteText('');
    } finally {
      setSavingNote(false);
    }
  };

  // ── Resubmit ─────────────────────────────────────────────────────────────

  const handleResubmit = async () => {
    setConfirmDialog({
      open: true,
      title: t('lifecycle.resubmit', 'Resubmit'),
      message: t('lifecycle.resubmit_confirm', 'Resubmit this claim?'),
      variant: 'warning',
      onConfirm: async () => {
        setConfirmDialog(prev => ({ ...prev, open: false }));
        await doResubmit();
      },
    });
  };

  const doResubmit = async () => {
    setResubmitting(true);
    try {
      await api.post(`/claims/${id}/resubmit`);
      qc.invalidateQueries({ queryKey: ['claim', id] });
      showToast(t('lifecycle.resubmit_success'));
    } catch {
      // Fallback: just void+draft the claim status for now
      try {
        await api.patch(`/claims/${id}`, { status: 'ready' });
        qc.invalidateQueries({ queryKey: ['claim', id] });
        showToast(t('lifecycle.resubmit_success'));
      } catch (err: unknown) {
        const e = err as { response?: { data?: { detail?: string } } };
        showToast(e?.response?.data?.detail ?? t('common.error'), false);
      }
    } finally {
      setResubmitting(false);
    }
  };

  // ── Validation ──────────────────────────────────────────────────────────────
  const handleValidate = async () => {
    setValidating(true);
    try {
      const { data } = await api.post(`/validation/claims/${id}`);
      setValidationResult(data);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      showToast(e?.response?.data?.detail ?? t('common.error'), false);
    } finally {
      setValidating(false);
    }
  };

  // ── Post payment ──────────────────────────────────────────────────────────
  const handlePostPayment = async () => {
    if (!pmtAmount) return;
    setPostingPayment(true);
    try {
      await api.post(`/payments/claims/${id}`, {
        payment_amount: parseFloat(pmtAmount),
        adjustment_amount: parseFloat(pmtAdjust || '0'),
        patient_responsibility: parseFloat(pmtPatientResp || '0'),
        check_number: pmtCheck || undefined,
        payment_method: pmtMethod,
      });
      showToast(t('payments.post_success'));
      qc.invalidateQueries({ queryKey: ['claim', id] });
      refetchPayments();
      refetchAudit();
      setShowPostPayment(false);
      setPmtAmount(''); setPmtCheck(''); setPmtAdjust(''); setPmtPatientResp('');
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      showToast(e?.response?.data?.detail ?? t('common.error'), false);
    } finally {
      setPostingPayment(false);
    }
  };

  // ── Approval requests ─────────────────────────────────────────────────────

  const handleSubmitApproval = async () => {
    if (!suggestNewCode && !suggestNote) return;
    setSubmittingApproval(true);
    try {
      await api.post('/approvals/', {
        claim_id: Number(id),
        request_type: 'dx_change',
        details: suggestNote || `Change ${suggestCurrentCode} → ${suggestNewCode}`,
        suggested_codes: suggestNewCode ? [suggestNewCode] : [],
        current_code: suggestCurrentCode || undefined,
      });
      showToast(t('approvals.submitted', { defaultValue: 'Approval request submitted' }));
      refetchApprovals();
      setShowSuggestModal(false);
      setSuggestCurrentCode('');
      setSuggestNewCode('');
      setSuggestNote('');
      setSuggestQuery('');
      setSuggestResults([]);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      showToast(e?.response?.data?.detail ?? t('common.error'), false);
    } finally {
      setSubmittingApproval(false);
    }
  };

  const handleApproveRequest = async (approvalId: number) => {
    try {
      await api.patch(`/approvals/${approvalId}`, { status: 'approved' });
      showToast(t('approvals.approved', { defaultValue: 'Approved' }));
      refetchApprovals();
      // Auto-scrub: check if no more pending approvals, then re-scrub
      const { data: remaining } = await api.get(`/approvals/claims/${id}`);
      const hasPending = (remaining || []).some((a: { status: string }) => a.status === 'pending');
      if (!hasPending) {
        // Apply suggested codes first
        const approved = (remaining || []).filter((a: { status: string }) => a.status === 'approved');
        for (const a of approved) {
          if (a.suggested_codes?.length && claim) {
            const currentCodes = claim.diagnosis_codes || [];
            const newCodes = [...currentCodes];
            for (const code of a.suggested_codes) {
              if (!newCodes.includes(code)) newCodes.push(code);
            }
            if (newCodes.length > currentCodes.length) {
              await api.patch(`/claims/${id}`, { diagnosis_codes: newCodes });
            }
          }
        }
        // Re-scrub
        try {
          const { data } = await api.post(`/ai/scrub/${id}`);
          setScrubResult(data);
          qc.invalidateQueries({ queryKey: ['claim', id] });
          showToast(t('approvals.auto_scrub', { defaultValue: 'All approved — claim re-scrubbed' }));
        } catch {
          qc.invalidateQueries({ queryKey: ['claim', id] });
        }
      }
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      showToast(e?.response?.data?.detail ?? t('common.error'), false);
    }
  };

  const handleRejectRequest = async (approvalId: number) => {
    try {
      await api.patch(`/approvals/${approvalId}`, { status: 'rejected' });
      showToast(t('approvals.rejected', { defaultValue: 'Rejected' }));
      refetchApprovals();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      showToast(e?.response?.data?.detail ?? t('common.error'), false);
    }
  };

  const handleQuickFixPointer = async (suggestedCode: string) => {
    if (!claim) return;
    setAddingFixCode(true);
    try {
      const currentCodes = claim.diagnosis_codes || [];
      if (!currentCodes.includes(suggestedCode)) {
        const newCodes = [...currentCodes, suggestedCode];
        await api.patch(`/claims/${id}`, { diagnosis_codes: newCodes });
        qc.invalidateQueries({ queryKey: ['claim', id] });
        showToast(`Added ${suggestedCode}`);
        // Re-scrub after fix
        try {
          const { data } = await api.post(`/ai/scrub/${id}`);
          setScrubResult(data);
        } catch {}
      }
    } catch {
      showToast('Failed to add code', false);
    } finally {
      setAddingFixCode(false);
      setExpandedFix(null);
    }
  };

  // ── Appeal letter ─────────────────────────────────────────────────────────

  // ── Insurance extraction ─────────────────────────────────────────────────────

  const handleExtractInsurance = async () => {
    if (!claim) return;
    setExtractingInsurance(true);
    try {
      const res = await api.post('/ai/extract-and-rescrub', { claim_id: claim.id });
      setScrubResult(res.data.scrub);
      qc.invalidateQueries({ queryKey: ['claim', id] });
      showToast('Insurance extracted — claim re-scrubbed!');
    } catch (e: any) {
      showToast(e.response?.data?.detail || 'Failed to extract insurance info', false);
    } finally {
      setExtractingInsurance(false);
    }
  };

  const handleSaveInsurance = async (insId: number) => {
    setSavingInsurance(true);
    try {
      await api.patch(`/ai/insurance/${insId}`, insuranceEditVals);
      qc.invalidateQueries({ queryKey: ['claim', id] });
      setEditingInsurance(false);
      showToast('Insurance info updated');
    } catch (e: any) {
      showToast(e.response?.data?.detail || 'Failed to update insurance', false);
    } finally {
      setSavingInsurance(false);
    }
  };

  const handleGenerateAppealLetter = async () => {
    if (!denials || denials.length === 0) {
      showToast(t('denials.no_denial_to_appeal', { defaultValue: 'No denial found to appeal' }), false);
      return;
    }
    setGeneratingLetter(true);
    setAppealLetter(null);
    try {
      const { data } = await api.post('/ai/denial-analysis', { denial_id: denials[0].id });
      if (data.appeal_letter_draft) {
        setAppealLetter(data.appeal_letter_draft);
      } else {
        // Fallback template
        setAppealLetter(generateAppealTemplate(claim!, denials[0]));
      }
    } catch {
      setAppealLetter(generateAppealTemplate(claim!, denials[0]));
    } finally {
      setGeneratingLetter(false);
    }
  };

  function generateAppealTemplate(c: Claim, denial: Denial): string {
    const today = new Date().toLocaleDateString('en-US');
    return `${today}\n\nRE: Appeal of Claim Denial\nClaim Number: ${c.claim_number}\nPatient: ${c.patient?.first_name ?? ''} ${c.patient?.last_name ?? ''}\nDate of Service: ${c.service_date_from}\nDenial Code: ${denial.denial_code}\nDenial Reason: ${denial.denial_reason}\n\nDear Appeals Department,\n\nWe are writing to formally appeal the denial of the above-referenced claim. The services provided were medically necessary and appropriate for the patient's condition.\n\nWe respectfully request a thorough review of this claim and a reversal of the denial decision.\n\nPlease contact our office at your earliest convenience.\n\nSincerely,\n[Provider Name]\n[NPI]\n[Contact Information]`;
  }

  const handleCopyLetter = () => {
    if (appealLetter) {
      navigator.clipboard.writeText(appealLetter);
      setLetterCopied(true);
      setTimeout(() => setLetterCopied(false), 2000);
    }
  };

  // ── Availity/Envolve submit ─────────────────────────────────────────────

  const handleAvailitySubmit = async () => {
    setAvailitySubmitting(true);
    try {
      await api.post(`/availity/submit/${id}`);
      qc.invalidateQueries({ queryKey: ['claim', id] });
      showToast(t('availity.submit_success'));
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      showToast(e?.response?.data?.detail ?? t('common.error'), false);
    } finally {
      setAvailitySubmitting(false);
    }
  };

  const handleAvailityStatus = async () => {
    setAvailityChecking(true);
    try {
      await api.get(`/availity/status/${id}`);
      qc.invalidateQueries({ queryKey: ['claim', id] });
      showToast(t('availity.check_status'));
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      showToast(e?.response?.data?.detail ?? t('common.error'), false);
    } finally {
      setAvailityChecking(false);
    }
  };

  // ── Prior Auth ────────────────────────────────────────────────────────────

  const handleSavePriorAuth = async () => {
    if (!paAuthNumber.trim()) return;
    setSavingPa(true);
    try {
      await api.post('/prior-auth/', {
        claim_id: Number(id),
        payer_name: claim?.payer?.name,
        auth_number: paAuthNumber,
        cpt_codes: (claim?.service_lines || []).map(sl => sl.cpt_code) ?? [],
        status: 'approved',
        requested_date: new Date().toISOString().split('T')[0],
        approved_date: new Date().toISOString().split('T')[0],
        expiry_date: paExpiry || undefined,
      });
      qc.invalidateQueries({ queryKey: ['claim', id] });
      refetchPriorAuths();
      showToast(t('prior_auth.saved'));
      setShowPriorAuthForm(false);
      setPaAuthNumber('');
      setPaExpiry('');
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      showToast(e?.response?.data?.detail ?? t('common.error'), false);
    } finally {
      setSavingPa(false);
    }
  };

  // ── Routing detection ─────────────────────────────────────────────────────

  const detectRouting = () => {
    if (!claim) return 'standard';
    const payerName = (claim.payer?.name ?? '').toLowerCase();
    const method = claim.payer?.submission_method ?? 'inmediata';
    const isEnvolve = payerName.includes('envolve') || payerName.includes('vision');
    const envolveRoute = validationResult?.envolve_routing?.route;
    if (isEnvolve || envolveRoute === 'envolve') return 'envolve';
    if (method === 'stedi') return 'stedi';
    return 'inmediata';
  };

  const hasMedicalDx = () => {
    if (!claim) return false;
    const MEDICAL_DX_PREFIXES = ['E11.3', 'E13.3', 'E10.3', 'H40', 'H35', 'H47', 'G91', 'H30', 'H31'];
    return ((claim.diagnosis_codes || []) as string[]).some(dx =>
      MEDICAL_DX_PREFIXES.some(pfx => dx.startsWith(pfx))
    );
  };

  // ─────────────────────────────────────────────────────────────────────────

  const fmt = (n: number) =>
    new Intl.NumberFormat('es-PR', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

  if (isLoading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-6 h-6 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (!claim) return <div className="p-6 text-slate-500">{t('claims.not_found')}</div>;

  const submissionMethod = claim.payer?.submission_method ?? 'fax';
  const isDenied = claim.status === 'denied' || claim.status === 'appealed';

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 flex items-center gap-2 px-4 py-3 rounded-lg shadow-lg text-sm font-medium text-white transition-all ${
          toast.ok ? 'bg-emerald-500' : 'bg-red-500'
        }`}>
          {toast.ok ? <Check className="w-4 h-4" /> : <X className="w-4 h-4" />}
          {toast.msg}
        </div>
      )}

      {/* Back */}
      <button onClick={() => navigate(-1)} className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800 mb-4">
        <ArrowLeft className="w-4 h-4" /> {t('claims.title')}
      </button>

      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-xl font-bold text-slate-900 font-mono">{claim.claim_number}</h1>
            <StatusBadge status={claim.status} />
            <RoutingBadge method={submissionMethod} />
          </div>
          <p className="text-sm text-slate-500">
            {claim.payer?.name} • {formatDate(claim.service_date_from)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 justify-end">
          {(claim.status === 'draft' || claim.status === 'ready') && (
            <>
              <button
                onClick={handleScrub}
                disabled={scrubbing}
                className="flex items-center gap-1.5 px-3 py-2 border border-emerald-200 text-sm rounded-lg hover:bg-emerald-50 text-emerald-700"
              >
                <Sparkles className="w-4 h-4 text-amber-500" />
                {scrubbing ? t('claims.scrubbing') : t('claims.scrub')}
              </button>
              <button
                onClick={() => submitMutation.mutate()}
                disabled={submitMutation.isPending}
                className="flex items-center gap-1.5 px-3 py-2 bg-sky-500 hover:bg-sky-600 text-white text-sm rounded-lg disabled:opacity-60 hidden"
                aria-hidden="true"
              >
                {submitMutation.isPending
                  ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  : <Send className="w-4 h-4" />}
                {submitMutation.isPending ? t('stedi.submitting') : t('stedi.submit_stedi')}
              </button>
            </>
          )}
          {(claim.status === 'submitted' || claim.status === 'accepted' || claim.status === 'rejected') && (
            <button
              onClick={handleCheckStatus}
              disabled={checkingStatus}
              className="flex items-center gap-1.5 px-3 py-2 border border-slate-200 text-sm rounded-lg hover:bg-slate-50 text-slate-700 disabled:opacity-60"
            >
              {checkingStatus
                ? <div className="w-4 h-4 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" />
                : <RefreshCw className="w-4 h-4" />}
              {t('stedi.check_status')}
            </button>
          )}
          {isDenied && (
            <>
              <button
                onClick={handleResubmit}
                disabled={resubmitting}
                className="flex items-center gap-1.5 px-3 py-2 bg-amber-500 hover:bg-amber-600 text-white text-sm rounded-lg disabled:opacity-60"
              >
                <RotateCcw className="w-4 h-4" />
                {resubmitting ? t('lifecycle.resubmitting') : t('lifecycle.resubmit')}
              </button>
              <button
                onClick={handleGenerateAppealLetter}
                disabled={generatingLetter}
                className="flex items-center gap-1.5 px-3 py-2 border border-indigo-200 text-indigo-600 text-sm rounded-lg hover:bg-indigo-50 disabled:opacity-60"
              >
                <FileText className="w-4 h-4" />
                {generatingLetter ? t('lifecycle.generating_letter') : t('lifecycle.appeal_letter')}
              </button>
            </>
          )}
          {(claim.status === 'denied' || claim.status === 'rejected') && (
            <>
              <button
                onClick={async () => {
                  setReopening(true);
                  try {
                    await api.post(`/claims/${id}/reopen`);
                    qc.invalidateQueries({ queryKey: ['claim', id] });
                    showToast(t('lifecycle.reopen_success', { defaultValue: 'Claim reopened as draft' }));
                  } catch (err: unknown) {
                    const e = err as { response?: { data?: { detail?: string } } };
                    showToast(e?.response?.data?.detail ?? t('common.error'), false);
                  } finally {
                    setReopening(false);
                  }
                }}
                disabled={reopening}
                className="flex items-center gap-1.5 px-3 py-2 border border-sky-200 text-sky-600 text-sm rounded-lg hover:bg-sky-50 disabled:opacity-60"
              >
                <RefreshCw className="w-4 h-4" />
                {reopening ? '...' : t('lifecycle.fix_resubmit', { defaultValue: 'Fix & Resubmit' })}
              </button>
              <button
                onClick={() => {
                  setConfirmDialog({
                    open: true,
                    title: t('lifecycle.archive', { defaultValue: 'Archive' }),
                    message: t('lifecycle.archive_confirm', { defaultValue: 'Archive this claim? It will be marked as void.' }),
                    onConfirm: async () => {
                      setConfirmDialog(prev => ({ ...prev, open: false }));
                      setArchiving(true);
                      try {
                        await api.post(`/claims/${id}/void`);
                        qc.invalidateQueries({ queryKey: ['claim', id] });
                        showToast(t('lifecycle.archived', { defaultValue: 'Claim archived' }));
                      } catch (err: unknown) {
                        const e = err as { response?: { data?: { detail?: string } } };
                        showToast(e?.response?.data?.detail ?? t('common.error'), false);
                      } finally {
                        setArchiving(false);
                      }
                    },
                  });
                }}
                disabled={archiving}
                className="flex items-center gap-1.5 px-3 py-2 border border-slate-200 text-slate-500 text-sm rounded-lg hover:bg-slate-50 disabled:opacity-60"
              >
                <Trash2 className="w-4 h-4" />
                {archiving ? '...' : t('lifecycle.archive', { defaultValue: 'Archive' })}
              </button>
            </>
          )}
          {claim.status !== 'void' && (
            <button
              onClick={() => {
                setConfirmDialog({
                  open: true,
                  title: t('claims.void', 'Void'),
                  message: t('claims.void_confirm', 'Void this claim?'),
                  onConfirm: () => {
                    setConfirmDialog(prev => ({ ...prev, open: false }));
                    voidMutation.mutate();
                  },
                });
              }}
              className="flex items-center gap-1.5 px-3 py-2 border border-red-200 text-red-600 text-sm rounded-lg hover:bg-red-50"
            >
              <Trash2 className="w-4 h-4" />
              {t('claims.void')}
            </button>
          )}
          <button
            onClick={() => {
              setConfirmDialog({
                open: true,
                title: 'Delete Claim',
                message: 'Permanently delete this claim? This cannot be undone.',
                onConfirm: async () => {
                  setConfirmDialog(prev => ({ ...prev, open: false }));
                  setDeletingClaim(true);
                  try {
                    await api.delete(`/claims/${id}`);
                    qc.invalidateQueries({ queryKey: ['work-queue'] });
                    qc.invalidateQueries({ queryKey: ['claims'] });
                    navigate('/');
                  } catch (err: unknown) {
                    const e = err as { response?: { data?: { detail?: string } } };
                    showToast(e?.response?.data?.detail ?? 'Failed to delete claim', false);
                  } finally {
                    setDeletingClaim(false);
                  }
                },
              });
            }}
            disabled={deletingClaim}
            className="flex items-center gap-1.5 px-3 py-2 border border-red-200 text-red-600 text-sm rounded-lg hover:bg-red-50 disabled:opacity-60"
          >
            <Trash2 className="w-4 h-4" />
            {deletingClaim ? '...' : 'Delete'}
          </button>
        </div>
      </div>

      {/* Status Timeline */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 mb-4">
        <StatusTimeline status={claim.status} />
      </div>

      {/* Scrub result */}
      {(scrubResult || ((claim.scrub_issues || []).length > 0)) && (
        <div className={`rounded-xl border p-4 mb-4 ${(scrubResult?.score ?? claim.scrub_score ?? 0) >= 100 ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'}`}>
          <div className="flex items-center gap-2 mb-2">
            <ShieldCheck className={`w-4 h-4 ${(scrubResult?.score ?? claim.scrub_score ?? 0) >= 100 ? 'text-emerald-600' : 'text-amber-600'}`} />
            <span className="text-sm font-semibold">
              {t('claims.scrub_score', { score: (scrubResult?.score ?? claim.scrub_score ?? 0).toFixed(0) })}
            </span>
          </div>
          {(scrubResult?.issues ?? claim.scrub_issues ?? []).map((issue, i) => {
            // Detect diagnosis pointer mismatch warnings
            const isPointerIssue = /diagnosis pointer|pointer mismatch|refractive diagnosis/i.test(issue.msg || '');
            const suggestedFixMatch = issue.msg?.match(/\(([A-Z]\d[\d.]+)/);
            // Suggest a refractive code if the issue mentions needing one
            const suggestedFix = /refractive/i.test(issue.msg || '') ? 'H52.209' : suggestedFixMatch?.[1] || null;

            return (
              <div key={i} className="mt-1">
                <div className="flex items-start gap-2 text-sm">
                  <AlertTriangle className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${issue.type === 'error' ? 'text-red-500' : 'text-amber-500'}`} />
                  <span className="text-slate-700 flex-1">{issue.msg_key ? t(issue.msg_key, { defaultValue: issue.msg, ...(issue.msg_params || {}) }) : issue.msg}</span>
                  {isPointerIssue && (
                    <button
                      onClick={() => setExpandedFix(expandedFix === i ? null : i)}
                      className="flex items-center gap-1 text-xs font-medium text-sky-600 hover:text-sky-800 px-2 py-0.5 border border-sky-200 rounded shrink-0"
                    >
                      <Zap className="w-3 h-3" />
                      Fix
                    </button>
                  )}
                </div>
                {isPointerIssue && expandedFix === i && (
                  <div className="ml-6 mt-2 p-3 bg-white border border-sky-200 rounded-lg text-sm">
                    <p className="text-slate-600 mb-2">
                      <span className="font-semibold text-slate-800">Issue:</span> {issue.msg}
                    </p>
                    {suggestedFix && (
                      <>
                        <p className="text-slate-600 mb-2">
                          <span className="font-semibold text-slate-800">Suggested fix:</span> Add <span className="font-mono font-bold text-sky-700">{suggestedFix}</span>
                          {suggestedFix.startsWith('H52') && ' (refractive diagnosis to support this service line)'}
                        </p>
                        <button
                          onClick={() => handleQuickFixPointer(suggestedFix)}
                          disabled={addingFixCode}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-sky-500 hover:bg-sky-600 text-white text-xs font-medium rounded-lg disabled:opacity-50"
                        >
                          {addingFixCode
                            ? <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                            : <Plus className="w-3 h-3" />}
                          Add {suggestedFix} & Re-scrub
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {(scrubResult?.suggestions ?? []).map((s, i) => (
            <p key={i} className="text-xs text-slate-600 mt-1 ml-5">💡 {s}</p>
          ))}

        </div>
      )}

      {/* Appeal Letter */}
      {appealLetter && (
        <div className="bg-indigo-50 rounded-xl border border-indigo-200 p-4 mb-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold text-indigo-700">{t('lifecycle.appeal_letter_title')}</h2>
            <button
              onClick={handleCopyLetter}
              className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 px-2 py-1 rounded hover:bg-indigo-100"
            >
              <Copy className="w-3 h-3" />
              {letterCopied ? t('lifecycle.copied') : t('lifecycle.copy_letter')}
            </button>
          </div>
          <pre className="text-xs text-indigo-800 whitespace-pre-wrap font-sans leading-relaxed max-h-64 overflow-y-auto">
            {appealLetter}
          </pre>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        {/* Patient */}
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <h2 className="text-sm font-semibold text-slate-700 mb-3">{t('claims.patient')}</h2>
          {claim.patient ? (
            <div className="space-y-1 text-sm">
              <p className="font-medium text-slate-900">{claim.patient?.first_name} {claim.patient?.last_name}</p>
              <p className="text-slate-500">{t('patients.mrn')}: {claim.patient?.mrn}</p>
              <p className="text-slate-500">{t('patients.dob_abbr')}: {formatDate(claim.patient?.dob)}</p>
              {claim.patient?.address_line1 && <p className="text-slate-500">{claim.patient.address_line1}</p>}
              {claim.patient.phone && <p className="text-slate-500">{displayPhone(claim.patient.phone)}</p>}
            </div>
          ) : <p className="text-slate-400 text-sm">{t('claims.patient')} #{claim.patient_id}</p>}
        </div>

        {/* Provider + Payer */}
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <h2 className="text-sm font-semibold text-slate-700 mb-3">{t('claims.provider_payer')}</h2>
          <div className="space-y-1 text-sm">
            <p className="font-medium text-slate-900">
              {claim.provider ? `Dr. ${claim.provider.first_name} ${claim.provider.last_name}` : `#${claim.provider_id}`}
            </p>
            {claim.provider?.specialty && <p className="text-slate-500">{claim.provider.specialty}</p>}
            {claim.provider?.npi && <p className="text-slate-400 font-mono text-xs">NPI: {claim.provider.npi}</p>}
            <div className="mt-2 pt-2 border-t border-slate-100">
              <div className="flex items-center gap-2">
                <p className="font-medium text-slate-900">{claim.payer?.name ?? `#${claim.payer_id}`}</p>
                <RoutingBadge method={submissionMethod} />
              </div>
              {claim.payer_claim_number && (
                <p className="text-slate-400 font-mono text-xs">Payer #: {claim.payer_claim_number}</p>
              )}
              {/* Editable insurance info */}
              {(() => {
                const ins = claim.patient?.insurances?.find(i => i.payer_id === claim.payer_id) ?? claim.patient?.insurances?.[0];
                if (!ins) return (
                  <p className="text-slate-400 text-xs mt-1 italic">No insurance record on file</p>
                );
                if (editingInsurance) {
                  return (
                    <div className="mt-2 space-y-1.5">
                      <div>
                        <label className="text-xs text-slate-400">Member ID / Núm. Contrato</label>
                        <input
                          className="w-full text-xs border border-slate-200 rounded px-2 py-1 mt-0.5 font-mono"
                          value={insuranceEditVals.member_id}
                          onChange={e => setInsuranceEditVals(v => ({...v, member_id: e.target.value}))}
                        />
                      </div>
                      <div>
                        <label className="text-xs text-slate-400">Group Number</label>
                        <input
                          className="w-full text-xs border border-slate-200 rounded px-2 py-1 mt-0.5 font-mono"
                          value={insuranceEditVals.group_number}
                          onChange={e => setInsuranceEditVals(v => ({...v, group_number: e.target.value}))}
                        />
                      </div>
                      <div>
                        <label className="text-xs text-slate-400">Payer Name</label>
                        <input
                          className="w-full text-xs border border-slate-200 rounded px-2 py-1 mt-0.5"
                          value={insuranceEditVals.payer_name}
                          onChange={e => setInsuranceEditVals(v => ({...v, payer_name: e.target.value}))}
                        />
                      </div>
                      <div>
                        <label className="text-xs text-slate-400">Subscriber Name</label>
                        <input
                          className="w-full text-xs border border-slate-200 rounded px-2 py-1 mt-0.5"
                          value={insuranceEditVals.subscriber_name}
                          onChange={e => setInsuranceEditVals(v => ({...v, subscriber_name: e.target.value}))}
                        />
                      </div>
                      <div className="flex items-center gap-2 pt-1">
                        <button
                          onClick={() => handleSaveInsurance(ins.id)}
                          disabled={savingInsurance}
                          className="flex items-center gap-1 px-2 py-1 bg-emerald-500 hover:bg-emerald-600 text-white text-xs rounded disabled:opacity-60"
                        >
                          <Save className="w-3 h-3" />
                          {savingInsurance ? 'Saving...' : 'Save'}
                        </button>
                        <button
                          onClick={() => setEditingInsurance(false)}
                          className="flex items-center gap-1 px-2 py-1 border border-slate-200 text-slate-500 text-xs rounded hover:bg-slate-50"
                        >
                          <X className="w-3 h-3" />
                          Cancel
                        </button>
                      </div>
                    </div>
                  );
                }
                return (
                  <div className="mt-1 group relative">
                    <button
                      title="Edit insurance info"
                      onClick={() => {
                        setInsuranceEditVals({
                          member_id: ins.member_id || '',
                          group_number: ins.group_number || '',
                          payer_name: claim.payer?.name || '',
                          subscriber_name: ins.subscriber_name || '',
                        });
                        setEditingInsurance(true);
                      }}
                      className="absolute top-0 right-0 p-0.5 text-slate-300 hover:text-slate-600 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <Edit2 className="w-3 h-3" />
                    </button>
                    {ins.member_id && (
                      <p className="text-slate-500 text-xs">Núm. Contrato: <span className="font-mono font-medium text-slate-700">{ins.member_id}</span></p>
                    )}
                    {ins.group_number && (
                      <p className="text-slate-500 text-xs">Group: <span className="font-mono font-medium text-slate-700">{ins.group_number}</span></p>
                    )}
                    {ins.subscriber_name && (
                      <p className="text-slate-500 text-xs">Subscriber: {ins.subscriber_name}</p>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      </div>

      {/* Patient Documents (Insurance Card, License, Signature) */}
      {(claim.source === 'vistanet' || claim.source === 'wink') && (
        <ErrorBoundary fallback={<div className="p-4 text-red-500 text-sm">Error loading patient documents</div>}>
          <PatientDocuments
            claimId={claim.id}
            showDocs={showDocs}
            setShowDocs={setShowDocs}
            fullSizeImg={fullSizeImg}
            setFullSizeImg={setFullSizeImg}
            source={claim.source}
            winkPatientId={claim.patient?.wink_patient_id || claim.patient?.mrn}
          />
        </ErrorBoundary>
      )}

      {/* Financials */}
      {(() => {
        const payerName = (claim.payer?.name ?? '').toLowerCase();
        const isEnvolve = payerName.includes('envolve') || payerName.includes('vision');
        const insuranceAllowance = claim.total_paid > 0 ? claim.total_paid + (claim.patient_responsibility || 0) : null;
        const estimatedPatientResp = insuranceAllowance != null ? claim.total_billed - insuranceAllowance : null;
        const envolveAdjustment = isEnvolve ? claim.total_billed * 0.35 : null;

        return (
          <div className="bg-white rounded-xl border border-slate-200 p-4 mb-4">
            <div className="grid grid-cols-3 gap-4 text-center mb-3">
              <div>
                <p className="text-xs text-slate-500 mb-1">{t('claims.billed')}</p>
                <p className="text-lg font-bold text-slate-900">{fmt(claim.total_billed)}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-1">{t('claims.paid')}</p>
                <p className="text-lg font-bold text-emerald-700">{fmt(claim.total_paid)}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-1">{t('claims.patient_responsibility')}</p>
                <p className="text-lg font-bold text-amber-700">{fmt(claim.patient_responsibility)}</p>
              </div>
            </div>

            {/* Fee Schedule Breakdown */}
            <div className="border-t border-slate-100 pt-3 space-y-1.5">
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-500">{t('claims.insurance_allowance', { defaultValue: 'Insurance Allowance' })}</span>
                <span className="font-medium text-slate-700">
                  {insuranceAllowance != null ? fmt(insuranceAllowance) : <span className="text-slate-400 italic text-xs">{t('common.not_set', { defaultValue: 'Not set' })}</span>}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-500">{t('claims.est_patient_resp', { defaultValue: 'Est. Patient Responsibility' })}</span>
                <span className="font-medium text-amber-700">
                  {estimatedPatientResp != null && estimatedPatientResp > 0 ? fmt(estimatedPatientResp) : <span className="text-slate-400 italic text-xs">{t('common.not_set', { defaultValue: 'Not set' })}</span>}
                </span>
              </div>
              {isEnvolve && envolveAdjustment != null && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-500 flex items-center gap-1">
                    <span className="text-xs">⚡</span>
                    {t('claims.envolve_adjustment', { defaultValue: 'Envolve Adj. (35%)' })}
                  </span>
                  <span className="font-medium text-rose-600">{fmt(envolveAdjustment)}</span>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* Service Lines — grouped by category */}
      {(() => {
        try {
        // Categorize service lines by code format
        const categorize = (code: string): 'diagnoses' | 'procedures' | 'materials' => {
          if (/^[A-Za-z]\d/.test(code)) {
            // HCPCS: letter + 4 digits (V2020, V2781, A4000, etc.)
            if (/^[A-Za-z]\d{4}$/.test(code)) return 'materials';
            // ICD-10: letter + digits/dots (H52.xx, E11.xx, Z96.x)
            return 'diagnoses';
          }
          // 5-digit numeric = CPT procedure
          return 'procedures';
        };

        const categories = [
          { key: 'diagnoses' as const,  labelKey: 'claims.category_diagnoses',  items: (claim.service_lines || []).filter(sl => categorize(sl.cpt_code) === 'diagnoses') },
          { key: 'procedures' as const, labelKey: 'claims.category_procedures', items: (claim.service_lines || []).filter(sl => categorize(sl.cpt_code) === 'procedures') },
          { key: 'materials' as const,  labelKey: 'claims.category_materials',  items: (claim.service_lines || []).filter(sl => categorize(sl.cpt_code) === 'materials') },
        ].filter(c => c.items.length > 0);

        // If only one category (or none), show flat like before
        const showFlat = categories.length <= 1;

        const renderTable = (lines: typeof claim.service_lines) => (
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="text-left px-4 py-2 text-xs font-semibold text-slate-500">#</th>
                <th className="text-left px-4 py-2 text-xs font-semibold text-slate-500">CPT</th>
                <th className="text-left px-4 py-2 text-xs font-semibold text-slate-500">{t('common.description')}</th>
                <th className="text-left px-4 py-2 text-xs font-semibold text-slate-500">{t('claims.modifiers_abbr')}</th>
                <th className="text-center px-4 py-2 text-xs font-semibold text-slate-500">{t('common.units_abbr')}</th>
                <th className="text-right px-4 py-2 text-xs font-semibold text-slate-500">{t('claims.billed')}</th>
                <th className="text-right px-4 py-2 text-xs font-semibold text-slate-500">{t('claims.paid')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {lines.map(sl => {
                const lineIssues = (scrubResult?.issues ?? (claim.scrub_issues || [])).filter(issue => {
                  if (issue.field === `line_${sl.line_number}`) return true;
                  const lineMatch = issue.msg?.match(/Line\s+(\d+)/i);
                  return lineMatch && parseInt(lineMatch[1]) === sl.line_number;
                });
                const hasError = lineIssues.some(i => i.type === 'error');
                const hasWarning = lineIssues.length > 0 && !hasError;
                const rowClass = hasError
                  ? 'bg-red-50 border-l-4 border-l-red-400 hover:bg-red-100'
                  : hasWarning
                    ? 'bg-amber-50 border-l-4 border-l-amber-400 hover:bg-amber-100'
                    : 'hover:bg-slate-50';
                return (
                  <tr key={sl.id} className={rowClass} title={lineIssues.map(i => i.msg).join('; ') || undefined}>
                    <td className="px-4 py-2 text-slate-500">{sl.line_number}</td>
                    <td className="px-4 py-2 font-mono font-medium text-slate-900">{sl.cpt_code}</td>
                    <td className="px-4 py-2 text-slate-600">{sl.description ?? '—'}</td>
                    <td className="px-4 py-2 font-mono text-xs text-slate-500">{(sl.modifiers || []).join(' ') || '—'}</td>
                    <td className="px-4 py-2 text-center text-slate-600">{sl.units}</td>
                    <td className="px-4 py-2 text-right">
                      <InlineEditAmount
                        value={sl.billed_amount}
                        claimId={claim.id}
                        lineId={sl.id}
                        cptCode={sl.cpt_code}
                        fmt={fmt}
                        onSaved={() => qc.invalidateQueries({ queryKey: ['claim', id] })}
                      />
                    </td>
                    <td className="px-4 py-2 text-right font-medium text-emerald-700">{fmt(sl.paid_amount)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        );

        return (
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden mb-4">
            <button
              onClick={() => setShowLines(s => !s)}
              className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              {t('claims.service_lines')} ({(claim.service_lines || []).length})
              {showLines ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
            {showLines && (
              <div className="border-t border-slate-200">
                {showFlat ? (
                  renderTable(claim.service_lines)
                ) : (
                  categories.map(cat => (
                    <details key={cat.key} open className="group">
                      <summary className="flex items-center justify-between px-4 py-2.5 bg-slate-50 border-b border-slate-100 cursor-pointer hover:bg-slate-100 select-none">
                        <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
                          {t(cat.labelKey)} ({cat.items.length})
                        </span>
                        <ChevronDown className="w-3.5 h-3.5 text-slate-400 group-open:rotate-180 transition-transform" />
                      </summary>
                      {renderTable(cat.items)}
                    </details>
                  ))
                )}
              </div>
            )}
          </div>
        );
        } catch (err) {
          console.error('Render error in service lines:', err);
          return <div className="p-4 text-red-500 text-sm">Error rendering service lines: {String(err)}</div>;
        }
      })()}

      {/* Diagnosis codes */}
      {(() => {
        try {

        const handleDxSearch = (q: string) => {
          setDxQuery(q);
          if (q.length >= 1) {
            setDxResults(searchICD10(q, i18n.language || 'en'));
            setDxActiveIdx(-1);
          } else {
            setDxResults([]);
          }
        };

        const addDxCode = async (code: string) => {
          if ((claim.diagnosis_codes || []).includes(code)) return;
          const newCodes = [...(claim.diagnosis_codes || []), code];
          setSavingDx(true);
          try {
            await api.patch(`/claims/${id}`, { diagnosis_codes: newCodes });
            qc.invalidateQueries({ queryKey: ['claim', id] });
            // If from Wink, track as suggestion
            if (claim.source === 'wink') {
              setDxSuggestions(prev => [...prev, code]);
              showToast(`Added ${code} as suggestion (needs doctor approval in Wink)`);
            } else {
              showToast(`Added ${code}`);
            }
          } catch {
            showToast('Failed to add diagnosis code', false);
          } finally {
            setSavingDx(false);
            setDxQuery('');
            setDxResults([]);
          }
        };

        const removeDxCode = async (code: string) => {
          const newCodes = (claim.diagnosis_codes || []).filter(c => c !== code);
          setSavingDx(true);
          try {
            await api.patch(`/claims/${id}`, { diagnosis_codes: newCodes });
            qc.invalidateQueries({ queryKey: ['claim', id] });
            setDxSuggestions(prev => prev.filter(c => c !== code));
            showToast(`Removed ${code}`);
          } catch {
            showToast('Failed to remove diagnosis code', false);
          } finally {
            setSavingDx(false);
          }
        };

        const handleDxKeyDown = (e: React.KeyboardEvent) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setDxActiveIdx(i => Math.min(i + 1, dxResults.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setDxActiveIdx(i => Math.max(i - 1, -1));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            if (dxActiveIdx >= 0 && dxResults[dxActiveIdx]) {
              addDxCode(dxResults[dxActiveIdx].code);
            } else if (dxQuery.trim()) {
              addDxCode(dxQuery.trim().toUpperCase());
            }
          } else if (e.key === 'Escape') {
            setShowDxSearch(false);
            setDxQuery('');
            setDxResults([]);
          }
        };

        const hasMissingDx = (claim.diagnosis_codes || []).length === 0;

        return (
          <div className="bg-white rounded-xl border border-slate-200 p-4 mb-4">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-semibold text-slate-700">{t('claims.diagnosis_codes')}</h2>
              <div className="flex items-center gap-2">
                {claim.source !== 'vistanet' && (
                  <button
                    onClick={() => { setShowSuggestModal(true); setSuggestCurrentCode(''); setSuggestNewCode(''); setSuggestNote(''); setSuggestQuery(''); setSuggestResults([]); }}
                    className="flex items-center gap-1 text-xs font-medium text-amber-600 hover:text-amber-800 px-2 py-1 border border-amber-200 rounded"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    {t('approvals.suggest_change', { defaultValue: 'Suggest Code Change' })}
                  </button>
                )}
                <button
                  onClick={() => { setShowDxSearch(v => !v); setTimeout(() => dxInputRef.current?.focus(), 100); }}
                  className="flex items-center gap-1 text-xs font-medium text-sky-600 hover:text-sky-800 px-2 py-1 border border-sky-200 rounded"
                >
                  <Plus className="w-3.5 h-3.5" />
                  {t('claims.add_diagnosis', { defaultValue: 'Add Diagnosis Code' })}
                </button>
              </div>
            </div>

            {hasMissingDx && !showDxSearch && (
              <div className="flex items-start gap-2 p-2 bg-amber-50 border border-amber-200 rounded-lg text-xs mb-2">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
                <span className="text-amber-800">No diagnosis codes — add at least one ICD-10 code</span>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              {(claim.diagnosis_codes || []).map((dx, i) => (
                <span key={i} className={`inline-flex items-center gap-1 font-mono text-xs px-2 py-1 rounded ${
                  dxSuggestions.includes(dx)
                    ? 'bg-amber-100 text-amber-800 border border-amber-300'
                    : 'bg-slate-100 text-slate-700'
                }`}>
                  {dx}
                  {dxSuggestions.includes(dx) && (
                    <span className="text-amber-600 text-[10px] font-semibold">suggestion</span>
                  )}
                  <button
                    onClick={() => removeDxCode(dx)}
                    className="text-slate-400 hover:text-red-500 ml-0.5"
                    title="Remove"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>

            {/* ICD-10 search */}
            {showDxSearch && (
              <div className="relative mt-3">
                <div className="relative">
                  <input
                    ref={dxInputRef}
                    type="text"
                    value={dxQuery}
                    onChange={e => handleDxSearch(e.target.value)}
                    onKeyDown={handleDxKeyDown}
                    placeholder={t('claims.search_icd10', { defaultValue: 'Search ICD-10 code...' })}
                    className="w-full pl-3 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                    disabled={savingDx}
                  />
                </div>
                {dxResults.length > 0 && (
                  <div className="absolute z-50 top-full mt-1 left-0 right-0 bg-white rounded-xl border border-slate-200 shadow-xl max-h-64 overflow-y-auto">
                    {dxResults.map((code, idx) => (
                      <button
                        key={code.code}
                        type="button"
                        onClick={() => addDxCode(code.code)}
                        className={`w-full text-left px-3 py-2.5 hover:bg-sky-50 transition-colors border-b border-slate-50 last:border-0 ${
                          dxActiveIdx === idx ? 'bg-sky-50' : ''
                        }`}
                      >
                        <div className="flex items-start gap-2">
                          <span className="font-mono text-xs font-bold text-sky-700 bg-sky-100 px-1.5 py-0.5 rounded shrink-0 mt-0.5">
                            {code.code}
                          </span>
                          <span className="text-sm text-slate-700 leading-snug">
                            {(i18n.language || 'en').startsWith('es') ? code.es : code.en}
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {claim.source === 'wink' && dxSuggestions.length > 0 && (
              <div className="flex items-start gap-2 p-2 bg-amber-50 border border-amber-200 rounded-lg text-xs mt-3">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
                <span className="text-amber-800">
                  {dxSuggestions.length} Dx code{dxSuggestions.length > 1 ? 's' : ''} added as suggestion{dxSuggestions.length > 1 ? 's' : ''} — needs doctor approval in Wink
                </span>
              </div>
            )}
          </div>
        );
        } catch (err) {
          console.error('Render error in diagnosis codes:', err);
          return <div className="p-4 text-red-500 text-sm">Error rendering diagnosis codes: {String(err)}</div>;
        }
      })()}

      {/* Approval Requests */}
      {approvalRequests && approvalRequests.length > 0 && (
        <div className="bg-amber-50 rounded-xl border border-amber-200 p-4 mb-4">
          <h2 className="text-sm font-semibold text-amber-700 mb-3 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4" />
            {t('approvals.title', { defaultValue: 'Approval Requests' })} ({approvalRequests.length})
          </h2>
          <div className="space-y-2">
            {approvalRequests.map(ar => (
              <div key={ar.id} className={`flex items-center gap-3 text-xs bg-white border rounded-lg px-3 py-2.5 ${
                ar.status === 'approved' ? 'border-emerald-200' :
                ar.status === 'rejected' ? 'border-rose-200' : 'border-amber-200'
              }`}>
                <span className={`px-1.5 py-0.5 rounded font-semibold shrink-0 ${
                  ar.status === 'approved' ? 'bg-emerald-100 text-emerald-700' :
                  ar.status === 'rejected' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'
                }`}>{ar.status}</span>
                <div className="flex-1 min-w-0">
                  <span className="font-medium text-slate-700">{ar.request_type.replace(/_/g, ' ')}</span>
                  {ar.current_code && (
                    <span className="text-slate-400 ml-1">({ar.current_code})</span>
                  )}
                  {(ar.suggested_codes || []).length ? (
                    <span className="text-sky-600 ml-1">
                      → {(ar.suggested_codes || []).join(', ')}
                    </span>
                  ) : null}
                  {ar.details && <p className="text-slate-500 mt-0.5 truncate">{ar.details}</p>}
                </div>
                <span className="text-slate-400 shrink-0">{ar.requested_by}</span>
                {ar.status === 'pending' && (
                  <div className="flex gap-1 shrink-0">
                    <button
                      onClick={() => handleApproveRequest(ar.id)}
                      className="p-1 text-emerald-600 hover:text-emerald-800 hover:bg-emerald-50 rounded"
                      title="Approve"
                    >
                      <Check className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleRejectRequest(ar.id)}
                      className="p-1 text-rose-600 hover:text-rose-800 hover:bg-rose-50 rounded"
                      title="Reject"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Suggest Code Change Modal */}
      {showSuggestModal && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setShowSuggestModal(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-5">
              <h3 className="text-base font-semibold text-slate-900 mb-1 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-amber-500" />
                {t('approvals.suggest_change', { defaultValue: 'Suggest Code Change' })}
              </h3>
              <p className="text-xs text-slate-500 mb-4">{t('approvals.suggest_description', { defaultValue: 'Request a diagnosis code change — needs doctor approval' })}</p>

              {/* Select current code to change */}
              <label className="block text-xs font-medium text-slate-600 mb-1">{t('approvals.current_code', { defaultValue: 'Current Code (optional)' })}</label>
              <select
                value={suggestCurrentCode}
                onChange={e => setSuggestCurrentCode(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm mb-3"
              >
                <option value="">{t('approvals.select_code', { defaultValue: '— Select code to change —' })}</option>
                {(claim?.diagnosis_codes || []).map(dx => (
                  <option key={dx} value={dx}>{dx}</option>
                ))}
              </select>

              {/* Search for new code */}
              <label className="block text-xs font-medium text-slate-600 mb-1">{t('approvals.new_code', { defaultValue: 'Suggested New Code' })}</label>
              <div className="relative mb-3">
                <input
                  type="text"
                  value={suggestQuery}
                  onChange={e => {
                    setSuggestQuery(e.target.value);
                    if (e.target.value.length >= 1) {
                      setSuggestResults(searchICD10(e.target.value, i18n.language || 'en'));
                    } else {
                      setSuggestResults([]);
                    }
                  }}
                  placeholder={t('claims.search_icd10', { defaultValue: 'Search ICD-10 code...' })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
                {suggestNewCode && (
                  <span className="absolute right-2 top-2 text-xs font-mono font-bold text-sky-700 bg-sky-100 px-1.5 py-0.5 rounded">{suggestNewCode}</span>
                )}
                {suggestResults.length > 0 && (
                  <div className="absolute z-50 top-full mt-1 left-0 right-0 bg-white rounded-xl border border-slate-200 shadow-xl max-h-48 overflow-y-auto">
                    {suggestResults.map(code => (
                      <button
                        key={code.code}
                        type="button"
                        onClick={() => {
                          setSuggestNewCode(code.code);
                          setSuggestQuery(code.code);
                          setSuggestResults([]);
                        }}
                        className="w-full text-left px-3 py-2 hover:bg-sky-50 transition-colors border-b border-slate-50 last:border-0"
                      >
                        <span className="font-mono text-xs font-bold text-sky-700 mr-2">{code.code}</span>
                        <span className="text-sm text-slate-700">{(i18n.language || 'en').startsWith('es') ? code.es : code.en}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Note */}
              <label className="block text-xs font-medium text-slate-600 mb-1">{t('approvals.note', { defaultValue: 'Reason / Note' })}</label>
              <textarea
                value={suggestNote}
                onChange={e => setSuggestNote(e.target.value)}
                placeholder={t('approvals.note_placeholder', { defaultValue: 'Explain why this change is needed...' })}
                rows={3}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-sky-500 mb-3"
              />
            </div>
            <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex gap-3 justify-end">
              <button
                onClick={() => setShowSuggestModal(false)}
                className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-50"
              >
                {t('common.cancel', { defaultValue: 'Cancel' })}
              </button>
              <button
                onClick={handleSubmitApproval}
                disabled={submittingApproval || (!suggestNewCode && !suggestNote)}
                className="px-4 py-2 text-sm font-medium text-white bg-amber-500 hover:bg-amber-600 rounded-xl disabled:opacity-50 flex items-center gap-1.5"
              >
                {submittingApproval
                  ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  : <Send className="w-3.5 h-3.5" />}
                {t('approvals.submit_request', { defaultValue: 'Submit Request' })}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Patient Sale Data */}
      {claim.sale_items && Array.isArray(claim.sale_items) && claim.sale_items.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden mb-4">
          <button
            onClick={() => setShowSaleData(s => !s)}
            className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            <span className="flex items-center gap-2">
              <span className="text-base">🛒</span>
              {t('claims.patient_sale', 'Patient Sale')}
            </span>
            {showSaleData ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          {showSaleData && (
            <div className="px-4 pb-4 border-t border-slate-100">
              {claim.sale_items && Array.isArray(claim.sale_items) && claim.sale_items.length > 0 ? (
                <table className="w-full text-sm mt-3">
                  <thead><tr className="text-left text-xs text-slate-400 border-b">
                    <th className="pb-2">#</th>
                    <th className="pb-2">{t('common.description', 'Description')}</th>
                    <th className="pb-2 text-right">{t('common.amount', 'Amount')}</th>
                  </tr></thead>
                  <tbody>
                    {(claim.sale_items as {name:string;amount:number}[]).map((item, i) => (
                      <tr key={i} className="border-b border-slate-50">
                        <td className="py-1.5 text-slate-400">{i + 1}</td>
                        <td className="py-1.5 text-slate-700">{item.name}</td>
                        <td className="py-1.5 text-right font-mono text-slate-600">${(item.amount || 0).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="text-sm text-slate-400 mt-3 italic">{t('claims.no_sale_data', 'No sale data available')}</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Unified Submit Claim Section ── */}
      {(claim.status === 'draft' || claim.status === 'ready') && (() => {
        const route = detectRouting();
        const medicalDx = hasMedicalDx();
        const isReforma = claim.payer?.is_reforma === true;
        const isEnvolve = route === 'envolve';
        const isStedi   = route === 'stedi' && !isReforma;
        const isInm     = route === 'inmediata';

        return (
          <div className={`rounded-xl border p-4 mb-4 ${
            isEnvolve ? 'bg-blue-50 border-blue-200' :
            isStedi   ? 'bg-emerald-50 border-emerald-200' :
                        'bg-indigo-50 border-indigo-200'
          }`}>
            <h2 className={`text-sm font-semibold mb-3 flex items-center gap-2 ${
              isEnvolve ? 'text-blue-700' : isStedi ? 'text-emerald-700' : 'text-indigo-700'
            }`}>
              <Send className="w-4 h-4" />
              {t('submit_section.title')}
              <span className={`ml-auto text-xs font-normal px-2 py-0.5 rounded-full border ${
                isEnvolve ? 'bg-blue-100 text-blue-600 border-blue-200' :
                isStedi   ? 'bg-emerald-100 text-emerald-600 border-emerald-200' :
                            'bg-indigo-100 text-indigo-600 border-indigo-200'
              }`}>
                {t('submit_section.routing_label')} {isEnvolve ? t('routing.envolve_availity') : isStedi ? t('routing.stedi') : t('routing.inmediata')}
              </span>
            </h2>

            <div className="flex flex-wrap gap-2 mb-3">
              {/* ONE submit button — app auto-routes */}
              <button
                onClick={() => {
                  if (isEnvolve || medicalDx) handleAvailitySubmit();
                  else if (isInm || isReforma) handleGenerateEDI();
                  else submitMutation.mutate();
                }}
                disabled={submitMutation.isPending || generatingEDI || availitySubmitting}
                className="flex items-center gap-1.5 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-lg disabled:opacity-60 shadow-sm"
              >
                {(submitMutation.isPending || generatingEDI || availitySubmitting)
                  ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  : <Send className="w-4 h-4" />}
                {t('common.submit', 'Submit')}
              </button>

              {ediContent && (
                <button
                  onClick={() => setShowEDIPreview(v => !v)}
                  className="flex items-center gap-1.5 px-3 py-2 border border-slate-200 text-slate-600 text-sm rounded-lg hover:bg-slate-100"
                >
                  <FileCode className="w-4 h-4" />
                  {showEDIPreview ? t('inmediata.edi_hide') : t('inmediata.edi_preview')}
                </button>
              )}
            </div>

            {/* Medical dx suggestion card */}
            {medicalDx && (
              <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm">
                <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                <p className="text-amber-800">
                  💡 {t('submit_section.medical_suggestion', {
                    payer: claim.payer?.name ?? 'medical insurer',
                  })}
                </p>
              </div>
            )}

            {/* EDI preview */}
            {ediContent && showEDIPreview && (
              <div className="mt-3">
                <pre className="text-xs text-slate-700 bg-white border border-slate-200 rounded-lg p-3 overflow-x-auto max-h-48 font-mono">
                  {ediContent.substring(0, 2000)}{ediContent.length > 2000 ? '...' : ''}
                </pre>
              </div>
            )}

            {/* Stedi transaction info */}
            {claim.stedi_transaction_id && (
              <div className="mt-3 pt-3 border-t border-current border-opacity-20 text-sm space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-slate-500">{t('stedi.transaction_id')}:</span>
                  <span className="font-mono font-medium">{claim.stedi_transaction_id}</span>
                </div>
                {claim.date_of_submission && (
                  <div className="flex items-center gap-2">
                    <span className="text-slate-500">{t('stedi.submitted_on')}:</span>
                    <span>{formatDateShort(claim.date_of_submission)}</span>
                  </div>
                )}
                {stediStatus && (
                  <pre className="text-xs text-slate-700 overflow-x-auto mt-2">{JSON.stringify(stediStatus, null, 2)}</pre>
                )}
              </div>
            )}
          </div>
        );
      })()}

      {/* Prior Authorization section */}
      {(() => {
        const paRequired = validationResult?.issues.some(i => i.code?.startsWith('PRIOR_AUTH_REQUIRED'));
        return (
          <div className="bg-purple-50 rounded-xl border border-purple-200 p-4 mb-4">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-semibold text-purple-700 flex items-center gap-2">
                <ShieldAlert className="w-4 h-4" />
                {t('prior_auth.title')}
                {claim.prior_auth_number && (
                  <span className="ml-1 font-mono text-xs bg-purple-100 text-purple-800 px-1.5 py-0.5 rounded">
                    {claim.prior_auth_number}
                  </span>
                )}
              </h2>
              <button
                onClick={() => setShowPriorAuthForm(v => !v)}
                className="flex items-center gap-1 text-xs font-medium text-purple-600 hover:text-purple-800 px-2 py-1 border border-purple-200 rounded"
              >
                <Plus className="w-3.5 h-3.5" />
                {t('prior_auth.add')}
              </button>
            </div>

            {paRequired && !claim.prior_auth_number && (
              <div className="flex items-start gap-2 p-2 bg-amber-50 border border-amber-200 rounded-lg text-xs mb-2">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
                <span className="text-amber-800">⚠️ {t('prior_auth.required')} — {t('prior_auth.required_hint')}</span>
              </div>
            )}

            {/* Existing prior auths */}
            {priorAuths && priorAuths.length > 0 && (
              <div className="space-y-1 mb-2">
                {priorAuths.map(pa => (
                  <div key={pa.id} className="flex items-center gap-3 text-xs bg-white border border-purple-100 rounded-lg px-3 py-2">
                    <span className={`px-1.5 py-0.5 rounded font-semibold ${
                      pa.status === 'approved' ? 'bg-emerald-100 text-emerald-700' :
                      pa.status === 'pending'  ? 'bg-amber-100 text-amber-700' :
                      pa.status === 'expired'  ? 'bg-slate-100 text-slate-500' :
                                                  'bg-rose-100 text-rose-700'
                    }`}>{t(`prior_auth.${pa.status}`, { defaultValue: pa.status })}</span>
                    {pa.auth_number && (
                      <span className="font-mono font-medium text-slate-800">{pa.auth_number}</span>
                    )}
                    {pa.expiry_date && (
                      <span className="text-slate-400">{t('prior_auth.expiry_date')}: {pa.expiry_date}</span>
                    )}
                    {pa.cpt_codes?.length > 0 && (
                      <span className="text-slate-400">{pa.cpt_codes.join(', ')}</span>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Add form */}
            {showPriorAuthForm && (
              <div className="bg-white border border-purple-200 rounded-lg p-3">
                <div className="grid grid-cols-2 gap-2 mb-2">
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">{t('prior_auth.auth_number')}</label>
                    <input
                      value={paAuthNumber}
                      onChange={e => setPaAuthNumber(e.target.value)}
                      placeholder="AUTH-12345"
                      className="w-full px-2 py-1.5 border border-slate-200 rounded text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">{t('prior_auth.expiry_date')}</label>
                    <DatePicker
                      value={paExpiry}
                      onChange={setPaExpiry}
                      placeholder="Select date"
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleSavePriorAuth}
                    disabled={savingPa || !paAuthNumber}
                    className="flex items-center gap-1 px-3 py-1.5 bg-purple-500 hover:bg-purple-600 text-white text-xs font-medium rounded disabled:opacity-50"
                  >
                    {savingPa ? <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                    {t('common.save')}
                  </button>
                  <button onClick={() => setShowPriorAuthForm(false)} className="text-xs text-slate-500 hover:text-slate-700">{t('common.cancel')}</button>
                </div>
              </div>
            )}

            {!priorAuths?.length && !showPriorAuthForm && (
              <p className="text-xs text-purple-400">{t('prior_auth.none_on_file')}</p>
            )}
          </div>
        );
      })()}

      {/* Denials */}
      {denials && denials.length > 0 && (
        <div className="bg-rose-50 rounded-xl border border-rose-200 p-4 mb-4">
          <h2 className="text-sm font-semibold text-rose-700 mb-2">{t('denials.title')}</h2>
          {denials.map(d => (
            <div key={d.id} className="text-sm text-rose-800">
              <span className="font-mono font-medium">{d.denial_code}</span> —{' '}
              {t(`denials.carc_codes.${d.denial_code}`, { defaultValue: d.denial_reason ?? '' })}
              <span className="text-xs text-rose-500 ml-2">({formatDateShort(d.denial_date)})</span>
            </div>
          ))}
        </div>
      )}

      {/* Appeals */}
      {appeals && appeals.length > 0 && (
        <div className="bg-amber-50 rounded-xl border border-amber-200 p-4 mb-4">
          <h2 className="text-sm font-semibold text-amber-700 mb-2">{t('claims.appeals')}</h2>
          {appeals.map(a => (
            <div key={a.id} className="text-sm text-amber-800">
              <span className="font-medium capitalize">{a.status}</span>
              {a.deadline && <span className="text-xs text-amber-600 ml-2">{t('claims.deadline')}: {formatDateShort(a.deadline)}</span>}
              {a.outcome && <span className="text-xs text-amber-600 ml-2">{t('claims.outcome')}: {a.outcome}</span>}
            </div>
          ))}
        </div>
      )}

      {/* Validation Results */}
      {validationResult && (
        <div className={`rounded-xl border p-4 mb-4 ${
          validationResult.is_valid ? 'bg-emerald-50 border-emerald-200' : 'bg-rose-50 border-rose-200'
        }`}>
          <div className="flex items-center gap-2 mb-3">
            <ClipboardCheck className={`w-4 h-4 ${validationResult.is_valid ? 'text-emerald-600' : 'text-rose-600'}`} />
            <span className="text-sm font-semibold">
              {validationResult.is_valid ? t('validation.valid') : t('validation.invalid')}
            </span>
            <span className="ml-auto text-xs text-slate-500">
              {validationResult.error_count > 0 && <span className="text-red-600 mr-2">{validationResult.error_count} {t('validation.errors')}</span>}
              {validationResult.warning_count > 0 && <span className="text-amber-600 mr-2">{validationResult.warning_count} {t('validation.warnings')}</span>}
            </span>
          </div>
          {validationResult.issues.length === 0 && (
            <p className="text-sm text-emerald-700">{t('validation.no_issues')}</p>
          )}
          <div className="space-y-1.5">
            {validationResult.issues.map((issue, i) => (
              <div key={i} className="flex items-start gap-2">
                <AlertTriangle className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${
                  issue.severity === 'error' ? 'text-red-500' :
                  issue.severity === 'warning' ? 'text-amber-500' : 'text-sky-500'
                }`} />
                <div>
                  <span className={`text-xs font-semibold px-1.5 py-0.5 rounded mr-2 ${
                    issue.severity === 'error' ? 'bg-red-100 text-red-700' :
                    issue.severity === 'warning' ? 'bg-amber-100 text-amber-700' : 'bg-sky-100 text-sky-700'
                  }`}>{issue.severity}</span>
                  <span className="text-sm text-slate-700">
                    {issue.message_key
                      ? t(issue.message_key, { ...issue.message_params, defaultValue: issue.message })
                      : issue.message}
                  </span>
                </div>
              </div>
            ))}
          </div>
          {/* Envolve routing suggestion */}
          {validationResult.envolve_routing?.suggestion && (
            <div className="mt-3 pt-3 border-t border-current border-opacity-20 flex items-start gap-2">
              <Eye className="w-4 h-4 text-purple-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-purple-700 mb-0.5">{t('validation.envolve_routing')}</p>
                <p className="text-sm text-purple-800">{validationResult.envolve_routing.suggestion}</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Payment History & Post Payment */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 mb-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
            <DollarSign className="w-4 h-4 text-slate-400" />
            {t('payments.history')}
          </h2>
          <button
            onClick={() => setShowPostPayment(v => !v)}
            className="flex items-center gap-1 text-xs font-medium text-emerald-600 hover:text-emerald-800 px-2 py-1 border border-emerald-200 rounded"
          >
            <DollarSign className="w-3.5 h-3.5" />
            {t('payments.post_payment')}
          </button>
        </div>

        {/* Post payment form */}
        {showPostPayment && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 mb-3">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-2">
              <div>
                <label className="block text-xs text-slate-500 mb-1">{t('payments.payment_amount')}</label>
                <input type="text" inputMode="decimal" pattern="[0-9.]*" value={pmtAmount} onChange={e => setPmtAmount(e.target.value)}
                  placeholder="0.00" className="w-full px-2 py-1 border border-slate-200 rounded text-sm" />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">{t('payments.adjustment')}</label>
                <input type="text" inputMode="decimal" pattern="[0-9.]*" value={pmtAdjust} onChange={e => setPmtAdjust(e.target.value)}
                  placeholder="0.00" className="w-full px-2 py-1 border border-slate-200 rounded text-sm" />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">{t('payments.patient_resp')}</label>
                <input type="text" inputMode="decimal" pattern="[0-9.]*" value={pmtPatientResp} onChange={e => setPmtPatientResp(e.target.value)}
                  placeholder="0.00" className="w-full px-2 py-1 border border-slate-200 rounded text-sm" />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">{t('payments.check_number')}</label>
                <input value={pmtCheck} onChange={e => setPmtCheck(e.target.value)}
                  placeholder="EFT/CHK#" className="w-full px-2 py-1 border border-slate-200 rounded text-sm" />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <select value={pmtMethod} onChange={e => setPmtMethod(e.target.value)}
                className="text-sm px-2 py-1 border border-slate-200 rounded bg-white">
                <option value="eft">EFT</option>
                <option value="check">Check</option>
                <option value="virtual_card">Virtual Card</option>
              </select>
              <button onClick={handlePostPayment} disabled={postingPayment || !pmtAmount}
                className="flex items-center gap-1 px-3 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-medium rounded disabled:opacity-50">
                {postingPayment ? <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                {t('payments.post')}
              </button>
              <button onClick={() => setShowPostPayment(false)} className="text-xs text-slate-500 hover:text-slate-700">
                {t('common.cancel')}
              </button>
            </div>
          </div>
        )}

        {/* Payment list */}
        {payments && payments.length > 0 ? (
          <table className="w-full text-xs">
            <thead className="border-b border-slate-100">
              <tr>
                <th className="text-left pb-1.5 font-semibold text-slate-500">{t('payments.check_number')}</th>
                <th className="text-left pb-1.5 font-semibold text-slate-500">{t('payments.check_date')}</th>
                <th className="text-right pb-1.5 font-semibold text-slate-500">{t('payments.payment_amount')}</th>
                <th className="text-right pb-1.5 font-semibold text-slate-500">{t('payments.adjustment')}</th>
                <th className="text-right pb-1.5 font-semibold text-slate-500">{t('payments.patient_resp')}</th>
                <th className="text-left pb-1.5 font-semibold text-slate-500">{t('payments.payment_method')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {payments.map(p => (
                <tr key={p.id}>
                  <td className="py-1.5 font-mono">{p.check_number ?? '—'}</td>
                  <td className="py-1.5 text-slate-500">{p.check_date ? formatDate(p.check_date) : '—'}</td>
                  <td className={`py-1.5 text-right font-semibold ${p.payment_amount >= 0 ? 'text-emerald-700' : 'text-rose-600'}`}>
                    ${p.payment_amount.toFixed(2)}
                  </td>
                  <td className="py-1.5 text-right text-amber-700">${p.adjustment_amount.toFixed(2)}</td>
                  <td className="py-1.5 text-right text-sky-700">${p.patient_responsibility.toFixed(2)}</td>
                  <td className="py-1.5"><span className="bg-slate-100 px-1.5 py-0.5 rounded text-slate-600 uppercase">{p.payment_method}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-slate-400">{t('payments.no_payments')}</p>
        )}
      </div>

      {/* Audit Trail */}
      {auditLog && auditLog.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-4 mb-4">
          <h2 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
            <History className="w-4 h-4 text-slate-400" />
            {t('audit.title')}
          </h2>
          <div className="space-y-2">
            {auditLog.map(entry => (
              <div key={entry.id} className="flex items-start gap-3 text-xs">
                <div className="w-1.5 h-1.5 rounded-full bg-sky-400 mt-1.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-slate-700 capitalize">{entry.action.replace(/_/g, ' ')}</span>
                    {entry.old_value && entry.new_value && (
                      <span className="text-slate-400">
                        <span className="text-slate-500">{entry.old_value}</span>
                        {' → '}
                        <span className="font-medium text-slate-700">{entry.new_value}</span>
                      </span>
                    )}
                    {entry.user_email && (
                      <span className="text-slate-400">{t('audit.by')} {entry.user_email}</span>
                    )}
                  </div>
                  {entry.notes && <p className="text-slate-400 mt-0.5">{entry.notes}</p>}
                </div>
                <span className="text-slate-400 shrink-0 whitespace-nowrap">{formatDateShort(entry.created_at)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Notes & Activity */}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <h2 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-slate-400" />
          {t('lifecycle.activity_log')}
        </h2>
        {claim.notes && (
          <div className="mb-3 text-sm text-slate-700 bg-slate-50 rounded-lg p-3 whitespace-pre-wrap">
            {claim.notes}
          </div>
        )}
        <div className="flex gap-2">
          <textarea
            value={noteText}
            onChange={e => setNoteText(e.target.value)}
            placeholder={t('lifecycle.note_placeholder')}
            rows={2}
            className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 resize-none"
          />
          <button
            onClick={handleSaveNote}
            disabled={savingNote || !noteText.trim()}
            className="px-4 py-2 bg-sky-500 hover:bg-sky-600 text-white text-sm font-medium rounded-lg disabled:opacity-50 self-end"
          >
            {savingNote ? '...' : t('lifecycle.save_note')}
          </button>
        </div>
      </div>

      {/* Confirm Dialog */}
      <ConfirmDialog
        open={confirmDialog.open}
        title={confirmDialog.title}
        message={confirmDialog.message}
        variant={confirmDialog.variant}
        onConfirm={confirmDialog.onConfirm}
        onCancel={() => setConfirmDialog(prev => ({ ...prev, open: false }))}
      />
    </div>
  );
}

export default function ClaimDetailPage() {
  return (
    <ErrorBoundary>
      <ClaimDetailPageInner />
    </ErrorBoundary>
  );
}
