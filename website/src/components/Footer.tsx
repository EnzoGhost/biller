import { X, GitBranch, Globe, Mail } from 'lucide-react'
import logoSrc from '../assets/angel-logo.png'

const links = {
  Product: ['Features', 'Pricing', 'Login'],
  Company: ['About', 'Support', 'Blog'],
  Legal: ['Privacy Policy', 'Terms of Service', 'HIPAA Policy'],
}

export function Footer() {
  return (
    <footer className="bg-slate-950 border-t border-white/8">
      <div className="max-w-7xl mx-auto px-6 py-16">
        <div className="grid md:grid-cols-5 gap-12 mb-12">
          {/* Brand */}
          <div className="md:col-span-2">
            <div className="flex items-center gap-2.5 mb-4">
              <img src={logoSrc} alt="AngelClaims" className="h-9 w-auto" />
            </div>
            <p className="text-slate-500 text-sm leading-relaxed max-w-xs">
              Modern medical billing for practices that want to get paid faster. Claims, eligibility, ERA reconciliation — all in one place.
            </p>
            <p className="mt-4 text-slate-600 text-sm">
              Built with ❤️ in Orlando, FL
            </p>
            <div className="flex items-center gap-3 mt-6">
              {[X, GitBranch, Globe, Mail].map((Icon, i) => (
                <a
                  key={i}
                  href="#"
                  className="w-9 h-9 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-slate-500 hover:text-white hover:border-white/20 transition-colors"
                >
                  <Icon className="w-4 h-4" />
                </a>
              ))}
            </div>
          </div>

          {/* Link groups */}
          {Object.entries(links).map(([group, items]) => (
            <div key={group}>
              <h4 className="text-white text-sm font-semibold mb-4">{group}</h4>
              <ul className="space-y-3">
                {items.map((item) => (
                  <li key={item}>
                    <a href="#" className="text-slate-500 hover:text-slate-300 text-sm transition-colors">
                      {item}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Bottom bar */}
        <div className="border-t border-white/8 pt-8 flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-slate-600 text-sm">
            © 2026 AngelClaims. All rights reserved. · <span className="text-slate-500">angelclaims.app</span>
          </p>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-slate-600 text-sm">All systems operational</span>
          </div>
        </div>
      </div>
    </footer>
  )
}
