import { useState, useEffect } from 'react'
import logoSrc from '../assets/angel-logo.png'

export function Navbar() {
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20)
    window.addEventListener('scroll', onScroll)
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <nav
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        scrolled
          ? 'bg-slate-950/90 backdrop-blur-xl border-b border-white/10 shadow-lg'
          : 'bg-transparent'
      }`}
    >
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
        {/* Logo */}
        <a href="#" className="flex items-center gap-2.5">
          <img src={logoSrc} alt="AngelClaims" className="h-9 w-auto" />
        </a>

        {/* Nav links */}
        <div className="hidden md:flex items-center gap-8">
          {['Features', 'Pricing'].map((item) => (
            <a
              key={item}
              href={`#${item.toLowerCase()}`}
              className="text-slate-400 hover:text-white text-sm font-medium transition-colors"
            >
              {item}
            </a>
          ))}
        </div>

        {/* CTA */}
        <a
          href="https://app.angelclaims.app"
          className="inline-flex items-center gap-1.5 bg-sky-500 hover:bg-sky-400 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors shadow-lg shadow-sky-500/20"
        >
          Login
        </a>
      </div>
    </nav>
  )
}
