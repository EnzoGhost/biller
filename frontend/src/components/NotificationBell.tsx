import { useState, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Bell, Check, X, Clock } from 'lucide-react';
import api from '../lib/api';

interface ApprovalNotification {
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
}

export default function NotificationBell() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [readIds, setReadIds] = useState<Set<number>>(() => {
    try {
      const stored = localStorage.getItem('notification_read_ids');
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch {
      return new Set();
    }
  });
  const dropdownRef = useRef<HTMLDivElement>(null);

  const { data: notifications } = useQuery<ApprovalNotification[]>({
    queryKey: ['approval-notifications'],
    queryFn: () => api.get('/approvals/recent').then(r => Array.isArray(r.data) ? r.data : []),
    refetchInterval: 30000, // Poll every 30s
  });

  const unreadCount = (notifications ?? []).filter(n => !readIds.has(n.id)).length;

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const markAsRead = (id: number) => {
    setReadIds(prev => {
      const next = new Set(prev);
      next.add(id);
      localStorage.setItem('notification_read_ids', JSON.stringify([...next]));
      return next;
    });
  };

  const markAllRead = () => {
    if (!notifications) return;
    const allIds = notifications.map(n => n.id);
    setReadIds(prev => {
      const next = new Set([...prev, ...allIds]);
      localStorage.setItem('notification_read_ids', JSON.stringify([...next]));
      return next;
    });
  };

  const handleClick = (n: ApprovalNotification) => {
    markAsRead(n.id);
    setOpen(false);
    navigate(`/claims/${n.claim_id}`);
  };

  const statusIcon = (status: string) => {
    if (status === 'approved') return <Check className="w-3.5 h-3.5 text-emerald-500" />;
    if (status === 'rejected') return <X className="w-3.5 h-3.5 text-rose-500" />;
    return <Clock className="w-3.5 h-3.5 text-amber-500" />;
  };

  const statusColor = (status: string) => {
    if (status === 'approved') return 'bg-emerald-50 border-emerald-200';
    if (status === 'rejected') return 'bg-rose-50 border-rose-200';
    return 'bg-amber-50 border-amber-200';
  };

  const formatTime = (dateStr: string) => {
    const d = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return t('notifications.just_now', { defaultValue: 'just now' });
    if (mins < 60) return `${mins}m`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h`;
    const days = Math.floor(hours / 24);
    return `${days}d`;
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setOpen(o => !o)}
        className="relative p-2 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
        title={t('notifications.title', { defaultValue: 'Notifications' })}
      >
        <Bell className="w-5 h-5" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] flex items-center justify-center bg-rose-500 text-white text-[10px] font-bold rounded-full px-1 animate-pulse">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 bg-white rounded-xl border border-slate-200 shadow-2xl z-50 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
            <h3 className="text-sm font-semibold text-slate-800">
              {t('notifications.title', { defaultValue: 'Notifications' })}
            </h3>
            {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                className="text-xs text-sky-600 hover:text-sky-800 font-medium"
              >
                {t('notifications.mark_all_read', { defaultValue: 'Mark all read' })}
              </button>
            )}
          </div>

          {/* List */}
          <div className="max-h-80 overflow-y-auto">
            {(!notifications || notifications.length === 0) ? (
              <div className="px-4 py-8 text-center">
                <Bell className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                <p className="text-sm text-slate-400">
                  {t('notifications.empty', { defaultValue: 'No notifications' })}
                </p>
              </div>
            ) : (
              notifications.map(n => {
                const isUnread = !readIds.has(n.id);
                return (
                  <button
                    key={n.id}
                    onClick={() => handleClick(n)}
                    className={`w-full text-left px-4 py-3 border-b border-slate-50 last:border-0 hover:bg-slate-50 transition-colors ${
                      isUnread ? 'bg-sky-50/50' : ''
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`mt-0.5 p-1 rounded-full border ${statusColor(n.status)}`}>
                        {statusIcon(n.status)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-slate-700 capitalize">
                            {n.request_type.replace(/_/g, ' ')}
                          </span>
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase ${
                            n.status === 'approved' ? 'bg-emerald-100 text-emerald-700' :
                            n.status === 'rejected' ? 'bg-rose-100 text-rose-700' :
                            'bg-amber-100 text-amber-700'
                          }`}>
                            {n.status}
                          </span>
                          {isUnread && (
                            <span className="w-2 h-2 bg-sky-500 rounded-full shrink-0" />
                          )}
                        </div>
                        <p className="text-xs text-slate-500 mt-0.5 truncate">
                          {n.details || (n.current_code
                            ? `${n.current_code} → ${(n.suggested_codes || []).join(', ')}`
                            : `Claim #${n.claim_id}`)}
                        </p>
                        <div className="flex items-center gap-2 mt-1">
                          {n.reviewed_by && (
                            <span className="text-[10px] text-slate-400">
                              {t('notifications.by', { defaultValue: 'by' })} {n.reviewed_by}
                            </span>
                          )}
                          <span className="text-[10px] text-slate-400">
                            {formatTime(n.reviewed_at || n.created_at)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
