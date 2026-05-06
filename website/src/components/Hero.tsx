import { motion } from 'framer-motion'
import { ArrowRight, CheckCircle } from 'lucide-react'

const highlights = [
  'No credit card required',
  '30-day free trial',
  'Cancel anytime',
]

export function Hero() {
  return (
    <section className="relative min-h-screen flex flex-col items-center justify-center bg-slate-950 overflow-hidden">
      {/* Background gradient blobs */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[900px] h-[600px] bg-sky-600/10 rounded-full blur-3xl" />
        <div className="absolute top-1/3 left-1/4 w-[500px] h-[400px] bg-indigo-500/8 rounded-full blur-3xl" />
        <div className="absolute bottom-0 right-1/4 w-[400px] h-[300px] bg-sky-500/6 rounded-full blur-3xl" />
        {/* Grid overlay */}
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: `linear-gradient(rgba(148,163,184,1) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,1) 1px, transparent 1px)`,
            backgroundSize: '64px 64px',
          }}
        />
      </div>

      <div className="relative z-10 max-w-7xl mx-auto px-6 pt-24 pb-16 flex flex-col items-center text-center">
        {/* Badge */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="inline-flex items-center gap-2 bg-sky-500/10 border border-sky-500/20 rounded-full px-4 py-1.5 mb-8"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse" />
          <span className="text-sky-400 text-sm font-medium">Inmediata · Envolve · Availity integrated</span>
        </motion.div>

        {/* Headline */}
        <motion.h1
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.1 }}
          className="text-5xl md:text-7xl font-bold text-white leading-[1.08] tracking-tight max-w-4xl"
        >
          Medical Billing{' '}
          <span className="bg-gradient-to-r from-sky-400 to-indigo-400 bg-clip-text text-transparent">
            Made Simple
          </span>
        </motion.h1>

        {/* Subtitle */}
        <motion.p
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="mt-6 text-lg md:text-xl text-slate-400 max-w-2xl leading-relaxed"
        >
          AngelClaims streamlines claims submission, insurance verification, and ERA reconciliation — so you get paid faster with less effort.
        </motion.p>

        {/* CTAs */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.3 }}
          className="mt-10 flex flex-col sm:flex-row items-center gap-4"
        >
          <a
            href="https://app.angelclaims.app"
            className="inline-flex items-center gap-2.5 bg-sky-500 hover:bg-sky-400 text-white font-semibold px-7 py-3.5 rounded-xl transition-all shadow-xl shadow-sky-500/25 hover:shadow-sky-400/30 hover:-translate-y-0.5"
          >
            Start Free Trial
            <ArrowRight className="w-4 h-4" />
          </a>
          <a
            href="#features"
            className="inline-flex items-center gap-2.5 border border-white/20 hover:border-white/40 text-white font-semibold px-7 py-3.5 rounded-xl transition-all hover:bg-white/5 hover:-translate-y-0.5"
          >
            See Features
          </a>
        </motion.div>

        {/* Trust signals */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.5 }}
          className="mt-8 flex flex-wrap justify-center gap-6"
        >
          {highlights.map((item) => (
            <div key={item} className="flex items-center gap-1.5 text-slate-500 text-sm">
              <CheckCircle className="w-4 h-4 text-emerald-500" />
              {item}
            </div>
          ))}
        </motion.div>

        {/* App mockup */}
        <motion.div
          initial={{ opacity: 0, y: 48 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.5 }}
          className="mt-20 w-full max-w-5xl"
        >
          <div className="relative">
            <div className="bg-slate-800 rounded-2xl border border-white/10 shadow-2xl shadow-black/60 overflow-hidden">
              {/* Titlebar */}
              <div className="bg-slate-900 px-4 py-3 flex items-center gap-2 border-b border-white/10">
                <div className="flex gap-1.5">
                  <div className="w-3 h-3 rounded-full bg-red-500/80" />
                  <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
                  <div className="w-3 h-3 rounded-full bg-green-500/80" />
                </div>
                <div className="flex-1 flex justify-center">
                  <div className="bg-slate-800 rounded-md px-8 py-1 text-slate-500 text-xs">
                    app.angelclaims.app — Dashboard
                  </div>
                </div>
              </div>

              {/* App content */}
              <div className="flex h-[400px] bg-slate-950">
                {/* Sidebar */}
                <div className="w-48 bg-slate-900/70 border-r border-white/5 flex flex-col p-3 gap-1">
                  <div className="h-7 bg-sky-500/20 rounded-lg mb-3 flex items-center px-3 gap-2">
                    <div className="w-3 h-3 rounded bg-sky-400/60" />
                    <div className="w-16 h-2 rounded bg-sky-400/40" />
                  </div>
                  {['Dashboard', 'Claims', 'Patients', 'Payers', 'Reports'].map((item, i) => (
                    <div
                      key={item}
                      className={`h-7 rounded-lg flex items-center px-3 gap-2 ${i === 0 ? 'bg-white/10' : ''}`}
                    >
                      <div className="w-3 h-3 rounded bg-slate-600" />
                      <div className="w-14 h-2 rounded bg-slate-700" />
                    </div>
                  ))}
                </div>

                {/* Main content */}
                <div className="flex-1 p-5 flex flex-col gap-4 overflow-hidden">
                  {/* Stats row */}
                  <div className="grid grid-cols-4 gap-3">
                    {[
                      { label: 'Total Claims', val: '248', color: 'sky' },
                      { label: 'Billed MTD', val: '$42,100', color: 'indigo' },
                      { label: 'Collected MTD', val: '$31,450', color: 'emerald' },
                      { label: 'Pending', val: '12', color: 'amber' },
                    ].map(({ label, val, color }) => (
                      <div key={label} className="bg-slate-800/60 rounded-xl border border-white/5 p-3">
                        <div className={`text-lg font-bold text-${color}-400 mb-0.5`}>{val}</div>
                        <div className="text-xs text-slate-500">{label}</div>
                      </div>
                    ))}
                  </div>

                  {/* Claims table */}
                  <div className="bg-slate-800/40 rounded-xl border border-white/5 flex-1 p-4">
                    <div className="w-24 h-2.5 rounded bg-slate-700 mb-3" />
                    {[...Array(5)].map((_, i) => (
                      <div key={i} className="flex items-center gap-3 py-2 border-b border-white/5">
                        <div className="w-16 h-2 rounded bg-slate-700" />
                        <div className="flex-1 h-2 rounded bg-slate-600" style={{ width: `${50 + i * 12}px` }} />
                        <div className="w-12 h-2 rounded bg-slate-700" />
                        <div className={`w-16 h-5 rounded-full flex items-center justify-center ${
                          i === 0 ? 'bg-emerald-500/20 border border-emerald-500/30' :
                          i === 2 ? 'bg-sky-500/20 border border-sky-500/30' :
                          'bg-slate-700/60'
                        }`}>
                          <div className={`w-8 h-1.5 rounded ${
                            i === 0 ? 'bg-emerald-400/60' : i === 2 ? 'bg-sky-400/60' : 'bg-slate-600'
                          }`} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
            <div className="absolute -bottom-8 left-1/2 -translate-x-1/2 w-3/4 h-16 bg-sky-500/15 blur-2xl rounded-full" />
          </div>
        </motion.div>
      </div>

      {/* Bottom fade */}
      <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-b from-transparent to-slate-900 pointer-events-none" />
    </section>
  )
}
