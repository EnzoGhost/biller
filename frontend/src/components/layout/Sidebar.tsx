import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard, FileText,
  Settings, ShieldCheck,
  ChevronLeft, ChevronRight, LogOut,
} from 'lucide-react';
import { useAuthStore } from '../../hooks/useAuth';
import ProviderSwitcher from './ProviderSwitcher';
import clsx from 'clsx';

const NAV_ITEMS = [
  { to: '/',            icon: LayoutDashboard, labelKey: 'nav.dashboard',        exact: true },
  { to: '/claims',      icon: FileText,        labelKey: 'nav.claims' },
  { to: '/eligibility', icon: ShieldCheck,     labelKey: 'nav.eligibility' },
  { to: '/settings',    icon: Settings,        labelKey: 'nav.settings' },
];

export default function Sidebar() {
  const { t } = useTranslation();
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);

  const initials = (user?.full_name ?? 'U')
    .split(' ')
    .map((n: string) => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <motion.aside
      animate={{ width: collapsed ? 64 : 220 }}
      transition={{ duration: 0.2, ease: 'easeInOut' }}
      className="relative flex flex-col bg-slate-900 border-r border-slate-700 h-screen shrink-0 overflow-hidden"
    >
      {/* Logo */}
      <div className="flex items-center justify-center px-2 py-5 border-b border-slate-700">
        {collapsed ? (
          <img src="/angel-icon.png" alt="AngelClaims" className="h-8 w-auto object-contain" />
        ) : (
          <img src="/angel-logo.png" alt="AngelClaims" className="h-8 w-auto object-contain" />
        )}
      </div>

      {/* Provider Switcher */}
      <ProviderSwitcher collapsed={collapsed} />

      {/* Nav */}
      <nav className="flex-1 px-2 py-4 space-y-0.5 overflow-y-auto">
        {NAV_ITEMS.map(({ to, icon: Icon, labelKey, exact }) => (
          <NavLink
            key={to}
            to={to}
            end={exact}
            className={({ isActive }) =>
              clsx(
                'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                isActive
                  ? 'bg-sky-500/20 text-sky-400'
                  : 'text-slate-400 hover:bg-slate-800 hover:text-white'
              )
            }
          >
            <Icon className="w-4 h-4 shrink-0" />
            <AnimatePresence>
              {!collapsed && (
                <motion.span
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.1 }}
                  className="whitespace-nowrap overflow-hidden"
                >
                  {t(labelKey)}
                </motion.span>
              )}
            </AnimatePresence>
          </NavLink>
        ))}
      </nav>

      {/* Notifications + User */}
      <div className="p-3 border-t border-slate-700">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-sky-500/20 text-sky-400 flex items-center justify-center text-xs font-bold shrink-0">
            {initials}
          </div>
          <AnimatePresence>
            {!collapsed && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex-1 min-w-0"
              >
                <p className="text-xs font-medium text-slate-200 truncate">{user?.full_name}</p>
                <p className="text-xs text-slate-500 truncate">{user?.role}</p>
              </motion.div>
            )}
          </AnimatePresence>
          <button
            onClick={handleLogout}
            className="p-1 text-slate-500 hover:text-slate-300 rounded shrink-0"
            title={t('common.logout')}
          >
            <LogOut className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Collapse toggle */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="absolute top-5 -right-3 w-6 h-6 rounded-full bg-slate-800 border border-slate-600 shadow-sm flex items-center justify-center text-slate-400 hover:text-slate-200 z-10"
      >
        {collapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronLeft className="w-3 h-3" />}
      </button>
    </motion.aside>
  );
}
