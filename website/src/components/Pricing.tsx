import { motion } from 'framer-motion'
import { Check, ArrowRight } from 'lucide-react'
import { useInView } from '../hooks/useInView'

const plans = [
  {
    name: 'Single Practice',
    price: '$149',
    period: '/mo',
    desc: 'Perfect for a single-provider practice.',
    features: [
      '1 practice location',
      'Up to 3 users',
      'Claims submission (all clearinghouses)',
      'Eligibility verification',
      'ERA auto-reconciliation',
      'Denial management',
      'HIPAA compliant',
      'Email support',
    ],
    cta: 'Start free trial',
    highlight: false,
    badge: null,
  },
  {
    name: 'Multi-Practice',
    price: '$249',
    period: '/mo',
    desc: 'For groups with multiple locations.',
    features: [
      'Up to 5 locations',
      'Unlimited users',
      'Everything in Single Practice',
      'Advanced analytics',
      'AI denial analysis',
      'Priority support',
      'Custom payer configs',
      'Dedicated onboarding',
    ],
    cta: 'Start free trial',
    highlight: true,
    badge: 'Most Popular',
  },
  {
    name: 'Enterprise',
    price: 'Custom',
    period: '',
    desc: 'For large billing companies and hospital systems.',
    features: [
      'Unlimited locations',
      'Unlimited users',
      'Custom clearinghouse integrations',
      'Dedicated support & SLA',
      'SSO / SAML',
      'White-label options',
      'Custom reporting',
      'HIPAA BAA included',
    ],
    cta: 'Contact sales',
    highlight: false,
    badge: null,
  },
]

const included = ['HIPAA compliant', 'No setup fees', '30-day free trial', 'Cancel anytime']

export function Pricing() {
  const { ref, inView } = useInView()

  return (
    <section id="pricing" className="bg-slate-50 py-28">
      <div className="max-w-7xl mx-auto px-6">
        <div className="text-center mb-16">
          <p className="text-sky-600 text-sm font-semibold uppercase tracking-widest mb-3">Pricing</p>
          <h2 className="text-4xl md:text-5xl font-bold text-slate-900 tracking-tight">
            Simple, transparent pricing
          </h2>
          <p className="mt-4 text-slate-500 text-lg">
            Start with a 30-day free trial. No credit card required.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-4">
            {included.map((item) => (
              <div key={item} className="flex items-center gap-1.5 text-slate-600 text-sm">
                <Check className="w-4 h-4 text-emerald-500" />
                {item}
              </div>
            ))}
          </div>
        </div>

        <div ref={ref} className="grid md:grid-cols-3 gap-6 items-start">
          {plans.map((plan, i) => (
            <motion.div
              key={plan.name}
              initial={{ opacity: 0, y: 24 }}
              animate={inView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.5, delay: i * 0.1 }}
              className={`relative rounded-2xl border p-8 flex flex-col ${
                plan.highlight
                  ? 'bg-slate-900 border-sky-500/50 shadow-2xl shadow-sky-500/10'
                  : 'bg-white border-slate-200'
              }`}
            >
              {plan.badge && (
                <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
                  <div className="bg-sky-500 text-white text-xs font-bold px-3 py-1 rounded-full shadow-lg">
                    {plan.badge}
                  </div>
                </div>
              )}

              <div className="mb-6">
                <h3 className={`text-lg font-bold mb-1 ${plan.highlight ? 'text-white' : 'text-slate-900'}`}>
                  {plan.name}
                </h3>
                <p className={`text-sm mb-4 ${plan.highlight ? 'text-slate-400' : 'text-slate-500'}`}>
                  {plan.desc}
                </p>
                <div className="flex items-end gap-1">
                  <span className={`text-4xl font-bold tracking-tight ${plan.highlight ? 'text-white' : 'text-slate-900'}`}>
                    {plan.price}
                  </span>
                  {plan.period && (
                    <span className={`text-sm mb-1 ${plan.highlight ? 'text-slate-400' : 'text-slate-500'}`}>
                      {plan.period}
                    </span>
                  )}
                </div>
              </div>

              <ul className="space-y-3 flex-1 mb-8">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-center gap-2.5">
                    <Check className={`w-4 h-4 shrink-0 ${plan.highlight ? 'text-sky-400' : 'text-emerald-500'}`} />
                    <span className={`text-sm ${plan.highlight ? 'text-slate-300' : 'text-slate-600'}`}>{f}</span>
                  </li>
                ))}
              </ul>

              <a
                href="https://app.angelclaims.app"
                className={`inline-flex items-center justify-center gap-2 font-semibold px-6 py-3 rounded-xl transition-all ${
                  plan.highlight
                    ? 'bg-sky-500 hover:bg-sky-400 text-white shadow-lg shadow-sky-500/25'
                    : plan.name === 'Enterprise'
                    ? 'bg-slate-900 hover:bg-slate-800 text-white'
                    : 'bg-slate-100 hover:bg-slate-200 text-slate-900'
                }`}
              >
                {plan.cta}
                <ArrowRight className="w-4 h-4" />
              </a>
            </motion.div>
          ))}
        </div>

        <p className="text-center mt-8 text-slate-500 text-sm">
          All prices in USD. Annual billing available (save 20%).
        </p>
      </div>
    </section>
  )
}
