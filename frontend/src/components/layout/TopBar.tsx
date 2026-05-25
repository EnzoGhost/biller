import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import NotificationBell from '../NotificationBell';
import { useAuthStore } from '../../hooks/useAuth';

function getInitials(name: string): string {
  return name
    .split(' ')
    .map(n => n[0])
    .filter(Boolean)
    .join('')
    .toUpperCase()
    .slice(0, 2) || '?';
}

export default function TopBar() {
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const initials = getInitials(user?.full_name ?? user?.email ?? '?');

  const handleLogout = () => {
    setOpen(false);
    logout();
    navigate('/login');
  };

  return (
    <header className="sticky top-0 z-30 flex items-center justify-end h-14 px-6 bg-slate-800 border-b border-slate-700 gap-3">
      <NotificationBell />

      {/* Account avatar dropdown — Dagger style */}
      <div className="relative" ref={ref}>
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          className="relative w-8 h-8 rounded-full bg-sky-600 hover:bg-sky-500 flex items-center justify-center text-xs font-bold text-white transition-colors"
          title={user?.full_name ?? user?.email}
        >
          {initials}
        </button>

        {open && (
          <div className="absolute right-0 top-full mt-2 w-60 bg-slate-800 border border-slate-700 rounded-xl shadow-xl z-50 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-700">
              <p className="text-sm font-medium text-white truncate">{user?.full_name}</p>
              <p className="text-xs text-slate-400 truncate">{user?.email}</p>
            </div>
            <button
              type="button"
              onClick={() => { setOpen(false); navigate('/account'); }}
              className="w-full text-left px-4 py-2.5 text-sm text-slate-300 hover:bg-slate-700 hover:text-white transition-colors"
            >
              My Account
            </button>
            <button
              type="button"
              onClick={handleLogout}
              className="w-full text-left px-4 py-2.5 text-sm text-red-400 hover:bg-slate-700 hover:text-red-300 transition-colors"
            >
              Sign Out
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
