import { useState, useEffect, useRef } from 'react';
import { ChevronDown, Building2, Check } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import api from '../../lib/api';

interface ProviderOption {
  id: number;
  name?: string;
  first_name?: string;
  last_name?: string;
  npi: string;
}

function providerName(p: ProviderOption): string {
  if (p.name) return p.name;
  return [p.first_name, p.last_name].filter(Boolean).join(' ') || `Provider #${p.id}`;
}

export default function ProviderSwitcher({ collapsed }: { collapsed: boolean }) {
  const [providers, setProviders] = useState<ProviderOption[]>([]);
  const [current, setCurrent] = useState<ProviderOption | null>(null);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.get('/providers').then((res: { data: { items?: ProviderOption[] } | ProviderOption[] }) => {
      const data = res.data as { items?: ProviderOption[] } | ProviderOption[];
      const list = Array.isArray(data) ? data : (data.items || []);
      setProviders(list);
      // Load saved provider or default to first
      const savedId = localStorage.getItem('angelclaims_active_provider');
      const saved = list.find(p => String(p.id) === savedId);
      setCurrent(saved || list[0] || null);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleSelect = (p: ProviderOption) => {
    setCurrent(p);
    localStorage.setItem('angelclaims_active_provider', String(p.id));
    setOpen(false);
    // Reload the page to re-fetch data for the new provider
    window.location.reload();
  };

  if (providers.length === 0 || collapsed) return null;

  return (
    <div ref={ref} className="relative px-2 py-2 border-b border-slate-700">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg bg-slate-800/50 hover:bg-slate-800 transition-colors text-left"
      >
        <Building2 size={14} className="text-sky-400 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-white truncate">
            {current ? providerName(current) : 'Select Provider'}
          </p>
          {current?.npi && (
            <p className="text-[10px] text-slate-500 truncate">NPI: {current.npi}</p>
          )}
        </div>
        <ChevronDown size={12} className={`text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="absolute left-2 right-2 top-full mt-1 bg-slate-800 border border-slate-700 rounded-lg shadow-xl z-50 overflow-hidden"
          >
            {providers.map(p => (
              <button
                key={p.id}
                onClick={() => handleSelect(p)}
                className={`w-full flex items-center gap-2 px-3 py-2.5 text-left text-xs transition-colors ${
                  current?.id === p.id
                    ? 'bg-sky-500/10 text-sky-300'
                    : 'text-slate-300 hover:bg-slate-700/50'
                }`}
              >
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{providerName(p)}</p>
                  <p className="text-[10px] text-slate-500">NPI: {p.npi}</p>
                </div>
                {current?.id === p.id && <Check size={12} className="text-sky-400 shrink-0" />}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
