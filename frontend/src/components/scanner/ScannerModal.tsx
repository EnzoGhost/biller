/**
 * ScannerModal — QR-based phone camera scanner for AngelClaims.
 *
 * Shows a QR code. Phone scans it → opens camera page → uploads photo.
 * Desktop polls for image, then optionally processes with AI.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Smartphone,
  Loader2,
  Check,
  Copy,
  Camera,
  QrCode,
  Sparkles,
} from 'lucide-react';
import QRCode from 'qrcode';
import api from '../../lib/api';

// ─── Types ─────────────────────────────────────────────────────────────────

export type ScanPurpose = 'fee_schedule' | 'inventory' | 'eligibility' | 'document';

interface ScanSession {
  session_id: string;
  token: string;
  url: string;
  expires_in: number;
  purpose: string;
}

interface ScannerModalProps {
  open: boolean;
  onClose: () => void;
  purpose: ScanPurpose;
  onImagesReceived?: (images: string[], purpose: ScanPurpose) => void;
  onProcessingComplete?: (result: any, purpose: ScanPurpose) => void;
}

// ─── Label helpers ─────────────────────────────────────────────────────────

const PURPOSE_LABELS: Record<ScanPurpose, string> = {
  fee_schedule: 'Fee Schedule',
  inventory: 'Inventory',
  eligibility: 'Insurance Card',
  document: 'Document',
};

const PURPOSE_COLORS: Record<ScanPurpose, string> = {
  fee_schedule: 'bg-sky-50 text-sky-700 border-sky-200',
  inventory: 'bg-violet-50 text-violet-700 border-violet-200',
  eligibility: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  document: 'bg-slate-50 text-slate-700 border-slate-200',
};

const SESSION_TTL = 300;

// ─── Component ──────────────────────────────────────────────────────────────

export default function ScannerModal({
  open,
  onClose,
  purpose,
  onImagesReceived,
  onProcessingComplete,
}: ScannerModalProps) {
  const [state, setState] = useState<'loading' | 'waiting' | 'received' | 'processing' | 'done' | 'error'>('loading');
  const [session, setSession] = useState<ScanSession | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [images, setImages] = useState<string[]>([]);
  const [processResult, setProcessResult] = useState<any>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [copied, setCopied] = useState(false);
  const [timeLeft, setTimeLeft] = useState(SESSION_TTL);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const cleanup = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    pollRef.current = null;
    timerRef.current = null;
  }, []);

  const createSession = useCallback(async () => {
    setState('loading');
    setImages([]);
    setProcessResult(null);
    setQrDataUrl(null);

    try {
      const { data } = await api.post<ScanSession>('/scanner/session', { purpose });
      setSession(data);
      setTimeLeft(data.expires_in);

      // Generate QR
      const qr = await QRCode.toDataURL(data.url, {
        width: 280,
        margin: 2,
        color: { dark: '#0f172a', light: '#ffffff' },
      });
      setQrDataUrl(qr);
      setState('waiting');

      // Poll for images
      pollRef.current = setInterval(async () => {
        try {
          const { data: poll } = await api.get(`/scanner/poll/${data.session_id}`);
          if (poll.status === 'expired') {
            cleanup();
            setState('error');
            setErrorMsg('Session expired. Create a new scan.');
            return;
          }
          if (poll.status === 'captured' && poll.images?.length > 0) {
            setImages(poll.images);
            setState('received');
          }
        } catch {
          // Keep trying
        }
      }, 2000);

      // Countdown
      timerRef.current = setInterval(() => {
        setTimeLeft(prev => {
          if (prev <= 1) {
            cleanup();
            setState('error');
            setErrorMsg('Session expired. Create a new scan.');
            return 0;
          }
          return prev - 1;
        });
      }, 1000);

    } catch (err: any) {
      setState('error');
      setErrorMsg(err.message || 'Failed to create scan session');
    }
  }, [purpose, cleanup]);

  useEffect(() => {
    if (open) createSession();
    return cleanup;
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleClose = useCallback(() => {
    cleanup();
    if (images.length > 0) onImagesReceived?.(images, purpose);
    if (session) {
      api.delete(`/scanner/session/${session.session_id}`).catch(() => {});
    }
    onClose();
  }, [cleanup, images, purpose, session, onImagesReceived, onClose]);

  const processWithAI = useCallback(async () => {
    if (images.length === 0) return;
    setState('processing');

    const endpointMap: Record<ScanPurpose, string> = {
      fee_schedule: '/scanner/process/fee-schedule',
      inventory: '/scanner/process/inventory',
      eligibility: '/scanner/process/eligibility',
      document: '/scanner/process/fee-schedule', // fallback
    };

    try {
      const { data } = await api.post(endpointMap[purpose], { images });
      setProcessResult(data);
      setState('done');
      onProcessingComplete?.(data, purpose);
    } catch (err: any) {
      setState('error');
      setErrorMsg(err.response?.data?.detail || err.message || 'AI processing failed');
    }
  }, [images, purpose, onProcessingComplete]);

  const copyUrl = useCallback(async () => {
    if (session?.url) {
      await navigator.clipboard.writeText(session.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [session]);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  if (!open) return null;

  const badgeCls = `inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${PURPOSE_COLORS[purpose]}`;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 bg-black/40 backdrop-blur-sm"
          onClick={handleClose}
        />

        {/* Modal */}
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 8 }}
          transition={{ type: 'spring', damping: 24, stiffness: 320 }}
          className="relative bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-sm mx-4 flex flex-col overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
            <div className="flex items-center gap-2.5">
              <Smartphone size={17} className="text-sky-500" />
              <span className="text-sm font-semibold text-slate-800">Scan with Phone</span>
              <span className={badgeCls}>{PURPOSE_LABELS[purpose]}</span>
            </div>
            <button
              onClick={handleClose}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
            >
              <X size={16} />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 p-5">
            {/* LOADING */}
            {state === 'loading' && (
              <div className="flex flex-col items-center py-10">
                <Loader2 size={28} className="animate-spin text-sky-500 mb-3" />
                <p className="text-sm text-slate-400">Creating scan session...</p>
              </div>
            )}

            {/* WAITING */}
            {(state === 'waiting' || state === 'received') && qrDataUrl && session && (
              <div className="flex flex-col items-center">
                {state === 'waiting' && (
                  <p className="text-sm text-slate-500 mb-4 text-center">
                    Scan this QR code with your phone to open the camera
                  </p>
                )}
                {state === 'received' && images.length > 0 && (
                  <div className="w-full mb-4">
                    <p className="text-sm font-medium text-slate-700 mb-2 text-center">
                      {images.length} photo{images.length !== 1 ? 's' : ''} received
                    </p>
                    <div className="grid grid-cols-3 gap-1.5">
                      {images.map((img, i) => (
                        <img
                          key={i}
                          src={img}
                          alt={`Scan ${i + 1}`}
                          className="w-full aspect-square object-cover rounded-lg border border-slate-200"
                        />
                      ))}
                    </div>
                    <div className="flex items-center gap-1.5 mt-2 text-xs text-slate-400">
                      <Loader2 size={12} className="animate-spin" />
                      Still waiting for more...
                    </div>
                  </div>
                )}

                {/* QR */}
                <div className="bg-white p-3 rounded-xl shadow border border-slate-100 mb-3">
                  <img src={qrDataUrl} alt="QR Code" className="w-56 h-56" />
                </div>

                {/* Timer */}
                <div className={`text-xs font-medium mb-3 ${timeLeft < 60 ? 'text-red-500' : 'text-slate-400'}`}>
                  Expires in {formatTime(timeLeft)}
                </div>

                {/* URL row */}
                <div className="w-full flex items-center gap-1.5 p-2 rounded-lg bg-slate-50 border border-slate-100">
                  <code className="flex-1 text-xs text-slate-500 truncate">{session.url}</code>
                  <button
                    onClick={copyUrl}
                    className="flex-shrink-0 p-1.5 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-200 transition-colors"
                    title="Copy URL"
                  >
                    {copied ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
                  </button>
                </div>

                {state === 'waiting' && (
                  <div className="flex items-center gap-1.5 mt-3 text-xs text-slate-400">
                    <Loader2 size={12} className="animate-spin" />
                    Waiting for photo...
                  </div>
                )}
              </div>
            )}

            {/* PROCESSING */}
            {state === 'processing' && (
              <div className="flex flex-col items-center py-10">
                <Loader2 size={28} className="animate-spin text-sky-500 mb-3" />
                <p className="text-sm text-slate-600 font-medium">Processing with AI...</p>
                <p className="text-xs text-slate-400 mt-1">This may take a few seconds</p>
              </div>
            )}

            {/* DONE */}
            {state === 'done' && processResult && (
              <div className="flex flex-col items-center py-6">
                <div className="w-12 h-12 rounded-full bg-emerald-50 flex items-center justify-center mb-3">
                  <Check size={22} className="text-emerald-500" />
                </div>
                <p className="text-sm font-semibold text-slate-800 mb-1">Processing complete</p>
                <p className="text-xs text-slate-400">Results are ready to import</p>
              </div>
            )}

            {/* ERROR */}
            {state === 'error' && (
              <div className="flex flex-col items-center py-8">
                <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center mb-3">
                  <X size={22} className="text-red-400" />
                </div>
                <p className="text-sm text-red-500 mb-4 text-center">{errorMsg}</p>
                <button
                  onClick={createSession}
                  className="px-4 py-2 rounded-lg bg-sky-500 text-white text-sm font-medium hover:bg-sky-600 transition-colors"
                >
                  Try Again
                </button>
              </div>
            )}
          </div>

          {/* Footer */}
          {state === 'received' && images.length > 0 && (
            <div className="border-t border-slate-100 px-5 py-3 flex items-center gap-2 justify-end">
              <button
                onClick={handleClose}
                className="px-3 py-2 text-sm text-slate-500 hover:text-slate-700 rounded-lg hover:bg-slate-100 transition-colors"
              >
                Close
              </button>
              {purpose !== 'document' && (
                <button
                  onClick={processWithAI}
                  className="flex items-center gap-1.5 px-4 py-2 bg-sky-500 hover:bg-sky-600 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  <Sparkles size={14} />
                  Process with AI
                </button>
              )}
            </div>
          )}

          {state === 'done' && (
            <div className="border-t border-slate-100 px-5 py-3 flex justify-end">
              <button
                onClick={handleClose}
                className="px-4 py-2 bg-sky-500 hover:bg-sky-600 text-white text-sm font-medium rounded-lg transition-colors"
              >
                Done
              </button>
            </div>
          )}
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
