import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, Trash2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning' | 'info';
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  open, title, message, confirmLabel, cancelLabel, variant = 'danger', onConfirm, onCancel,
}: ConfirmDialogProps) {
  const { t } = useTranslation();

  const colors = {
    danger: { bg: 'bg-rose-50', icon: 'text-rose-500', btn: 'bg-rose-500 hover:bg-rose-600' },
    warning: { bg: 'bg-amber-50', icon: 'text-amber-500', btn: 'bg-amber-500 hover:bg-amber-600' },
    info: { bg: 'bg-sky-50', icon: 'text-sky-500', btn: 'bg-sky-500 hover:bg-sky-600' },
  }[variant];

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={onCancel}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 pt-6 pb-4">
              <div className={`w-12 h-12 ${colors.bg} rounded-full flex items-center justify-center mx-auto mb-4`}>
                {variant === 'danger' ? (
                  <Trash2 className={`w-5 h-5 ${colors.icon}`} />
                ) : (
                  <AlertTriangle className={`w-5 h-5 ${colors.icon}`} />
                )}
              </div>
              <h3 className="text-base font-semibold text-slate-900 text-center mb-1">{title}</h3>
              <p className="text-sm text-slate-500 text-center">{message}</p>
            </div>
            <div className="px-6 pb-6 flex gap-3">
              <button
                onClick={onCancel}
                className="flex-1 px-4 py-2.5 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
              >
                {cancelLabel || t('common.cancel', 'Cancel')}
              </button>
              <button
                onClick={onConfirm}
                className={`flex-1 px-4 py-2.5 text-sm font-medium text-white ${colors.btn} rounded-xl transition-colors`}
              >
                {confirmLabel || t('common.confirm', 'Confirm')}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
