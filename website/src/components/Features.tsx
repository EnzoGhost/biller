import { FileText, ShieldCheck, Zap, BarChart3, RefreshCw, Users } from 'lucide-react'
import { motion } from 'framer-motion'
import { useInView } from '../hooks/useInView'

const features = [
  {
    icon: FileText,
    title: 'Claims Submission',
    desc: 'Submit 837P claims to any payer via Envolve, Inmediata, or Availity. One workflow, any clearinghouse.',
    color: 'sky',
  },
  {
    icon: ShieldCheck,
    title: 'Insurance Verification',
    desc: 'Real-time eligibility checks before you bill. Know deductibles, copays, and coverage status instantly.',
    color: 'emerald',
  },
  {
    icon: RefreshCw,
    title: 'Inmediata Integration',
    desc: 'Native SFTP-based EDI submission and ERA download for Inmediata payers in Puerto Rico.',
    color: 'indigo',
  },
  {
    icon: Zap,
    title: 'Real-Time Claim Status',
    desc: 'Track every claim from submission to payment. Automatic status updates and denial alerts.',
    color: 'amber',
  },
  {
    icon: BarChart3,
    title: 'Analytics Dashboard',
    desc: 'Collection rates, denial trends, aging reports, and revenue by payer — all at a glance.',
    color: 'violet',
  },
  {
    icon: Users,
    title: 'Multi-Payer Support',
    desc: 'Medicare, Medicaid, commercial, vision, and dental payers. One platform handles them all.',
    color: 'sky',
  },
]

const colorMap: Record<string, string> = {
  sky: 'bg-sky-500/10 text-sky-400 border-sky-500/20',
  indigo: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20',
  violet: 'bg-violet-500/10 text-violet-400 border-violet-500/20',
  amber: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  emerald: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
}

export function Features() {
  const { ref, inView } = useInView()

  return (
    <section id="features" className="relative bg-slate-900 py-28">
      <div className="absolute top-0 left-0 right-0 h-32 bg-gradient-to-b from-slate-950 to-transparent pointer-events-none" />

      <div className="max-w-7xl mx-auto px-6">
        <div className="text-center mb-16">
          <p className="text-sky-400 text-sm font-semibold uppercase tracking-widest mb-3">Everything you need</p>
          <h2 className="text-4xl md:text-5xl font-bold text-white tracking-tight">
            Built for how billing actually works
          </h2>
          <p className="mt-4 text-slate-400 text-lg max-w-2xl mx-auto">
            From claim creation to ERA reconciliation — AngelClaims handles the full revenue cycle.
          </p>
        </div>

        <div ref={ref} className="grid md:grid-cols-3 gap-6">
          {features.map((f, i) => {
            const Icon = f.icon
            return (
              <motion.div
                key={f.title}
                initial={{ opacity: 0, y: 24 }}
                animate={inView ? { opacity: 1, y: 0 } : {}}
                transition={{ duration: 0.5, delay: i * 0.08 }}
                className="bg-slate-800/50 border border-white/8 rounded-2xl p-7 flex flex-col gap-4 hover:border-white/15 transition-colors"
              >
                <div className={`w-10 h-10 rounded-xl border flex items-center justify-center ${colorMap[f.color] || colorMap.sky}`}>
                  <Icon className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-white font-semibold text-lg mb-2">{f.title}</h3>
                  <p className="text-slate-400 text-sm leading-relaxed">{f.desc}</p>
                </div>
              </motion.div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
