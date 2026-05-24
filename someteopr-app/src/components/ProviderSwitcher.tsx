/**
 * ProviderSwitcher — like a Slack workspace/channel switcher.
 * Shows current provider name with a dropdown to switch.
 */
import { useState } from 'react';
import { ChevronDown, Stethoscope, Plus, Building2 } from 'lucide-react';
import { useAuthStore, type ProviderInfo, type OrgInfo } from '../hooks/useAuth';
import clsx from 'clsx';

interface Props {
  collapsed?: boolean;
}

export default function ProviderSwitcher({ collapsed = false }: Props) {
  const {
    user,
    currentProvider,
    currentOrg,
    providers,
    organizations,
    selectProvider,
    selectOrg,
  } = useAuthStore();

  const [open, setOpen] = useState(false);
  const [showOrgPicker, setShowOrgPicker] = useState(false);

  if (!user) return null;

  const providerLabel = currentProvider
    ? `${currentProvider.first_name} ${currentProvider.last_name}`
    : 'Select Provider';

  const orgLabel = currentOrg?.name ?? 'No Organization';

  return (
    <div className="relative">
      {/* Trigger button */}
      <button
        onClick={() => setOpen(!open)}
        className={clsx(
          'w-full flex items-center gap-2 px-2 py-2 rounded-lg border border-slate-200',
          'bg-slate-50 hover:bg-slate-100 transition-colors text-left',
          collapsed && 'justify-center px-1'
        )}
        title={collapsed ? providerLabel : undefined}
      >
        <div className="w-7 h-7 rounded-md bg-sky-100 text-sky-700 flex items-center justify-center shrink-0">
          <Stethoscope className="w-3.5 h-3.5" />
        </div>
        {!collapsed && (
          <>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-slate-800 truncate">{providerLabel}</p>
              <p className="text-xs text-slate-400 truncate">{orgLabel}</p>
            </div>
            <ChevronDown className={clsx('w-3.5 h-3.5 text-slate-400 shrink-0 transition-transform', open && 'rotate-180')} />
          </>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />

          <div className="absolute left-0 bottom-full mb-1 w-64 bg-white border border-slate-200 rounded-xl shadow-lg z-20 overflow-hidden">
            
            {/* Org section */}
            {organizations.length > 1 && (
              <div className="border-b border-slate-100">
                <div className="px-3 py-1.5">
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Organization</p>
                </div>
                {organizations.map((org) => (
                  <button
                    key={org.id}
                    onClick={async () => {
                      await selectOrg(org);
                      setOpen(false);
                    }}
                    className={clsx(
                      'w-full flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-slate-50 transition-colors',
                      org.id === currentOrg?.id && 'bg-sky-50 text-sky-700'
                    )}
                  >
                    <Building2 className="w-4 h-4 shrink-0 text-slate-400" />
                    <span className="truncate">{org.name}</span>
                    {org.id === currentOrg?.id && (
                      <span className="ml-auto w-2 h-2 rounded-full bg-sky-500" />
                    )}
                  </button>
                ))}
              </div>
            )}

            {/* Providers section */}
            <div>
              <div className="px-3 py-1.5">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Provider</p>
              </div>
              {providers.length === 0 && (
                <p className="px-3 py-2 text-xs text-slate-400 italic">No providers in this organization</p>
              )}
              {providers.map((prov) => (
                <button
                  key={prov.id}
                  onClick={() => {
                    selectProvider(prov);
                    setOpen(false);
                  }}
                  className={clsx(
                    'w-full flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-slate-50 transition-colors',
                    prov.id === currentProvider?.id && 'bg-sky-50 text-sky-700'
                  )}
                >
                  <div className={clsx(
                    'w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0',
                    prov.id === currentProvider?.id ? 'bg-sky-500 text-white' : 'bg-slate-100 text-slate-600'
                  )}>
                    {prov.first_name[0]}{prov.last_name[0]}
                  </div>
                  <div className="flex-1 min-w-0 text-left">
                    <p className="font-medium truncate">{prov.first_name} {prov.last_name}</p>
                    {prov.specialty && <p className="text-xs text-slate-400 truncate">{prov.specialty}</p>}
                  </div>
                  {prov.id === currentProvider?.id && (
                    <span className="w-2 h-2 rounded-full bg-sky-500 shrink-0" />
                  )}
                </button>
              ))}

              {/* Add provider shortcut */}
              <button
                onClick={() => {
                  setOpen(false);
                  window.location.href = '/providers';
                }}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-slate-500 hover:bg-slate-50 transition-colors border-t border-slate-100"
              >
                <Plus className="w-4 h-4 shrink-0" />
                <span>Manage Providers</span>
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
