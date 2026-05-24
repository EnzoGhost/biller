import { useState, useRef, useEffect } from 'react'
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard,
  Building2,
  Users,
  CreditCard,
  Stethoscope,
  LogOut,
  ChevronDown,
} from 'lucide-react'
import { logout, getAdminEmail } from '../lib/api'

const navItems = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/organizations', label: 'Organizations', icon: Building2 },
  { to: '/users', label: 'Users', icon: Users },
  { to: '/subscriptions', label: 'Subscriptions', icon: CreditCard },
  { to: '/providers', label: 'Providers', icon: Stethoscope },
]

export default function Layout() {
  const navigate = useNavigate()
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const email = getAdminEmail()
  const initials = email[0]?.toUpperCase() || 'A'

  async function handleLogout() {
    await logout()
    navigate('/login')
  }

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  return (
    <div className="flex h-screen overflow-hidden flex-col">
      {/* Top header */}
      <header className="h-14 flex-shrink-0 bg-slate-900 border-b border-slate-800 flex items-center justify-between px-6 z-10">
        {/* Logo */}
        <img src="/angel-logo.png" alt="AngelClaims" className="h-8 w-auto" />

        {/* Account dropdown */}
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setDropdownOpen((v) => !v)}
            className="flex items-center gap-2 text-slate-300 hover:text-white transition-colors px-3 py-1.5 rounded-lg hover:bg-slate-800"
          >
            <div className="w-7 h-7 rounded-full bg-sky-500/20 flex items-center justify-center">
              <span className="text-sky-300 text-xs font-semibold">{initials}</span>
            </div>
            <span className="text-sm font-medium max-w-[160px] truncate">{email}</span>
            <ChevronDown
              size={14}
              className={`text-slate-500 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`}
            />
          </button>

          {dropdownOpen && (
            <div className="absolute right-0 top-full mt-1 w-44 bg-slate-900 border border-slate-800 rounded-xl shadow-xl overflow-hidden z-50">
              <button
                onClick={handleLogout}
                className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors"
              >
                <LogOut size={14} />
                Sign Out
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className="w-56 flex-shrink-0 bg-slate-900 border-r border-slate-800 flex flex-col">
          <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
            {navItems.map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                    isActive
                      ? 'bg-sky-500/15 text-sky-400 font-medium'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                  }`
                }
              >
                <Icon size={16} />
                {label}
              </NavLink>
            ))}
          </nav>


        </aside>

        {/* Main content */}
        <main className="flex-1 overflow-y-auto bg-slate-950">
          <div className="max-w-7xl mx-auto p-8">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
