import { useEffect, useState } from 'react'
import { Building2, Users, Stethoscope, FileText, TrendingUp, UserPlus } from 'lucide-react'
import StatCard from '../components/StatCard'
import { fetchDashboard, type DashboardStats } from '../lib/api'
import { formatNumber } from '../lib/utils'

export default function Dashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchDashboard()
      .then(setStats)
      .catch(() => setError('Failed to load dashboard stats'))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-slate-400 text-sm">Loading dashboard…</div>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      <div>
        <h1 className="text-2xl font-semibold text-white">Dashboard</h1>
        <p className="text-slate-400 text-sm mt-1">AngelClaims platform overview</p>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard
          title="Organizations"
          value={formatNumber(stats?.total_organizations ?? 0)}
          icon={Building2}
          color="sky"
          sub={`${stats?.active_organizations ?? 0} active`}
        />
        <StatCard
          title="Total Users"
          value={formatNumber(stats?.total_users ?? 0)}
          icon={Users}
          color="violet"
        />
        <StatCard
          title="Providers"
          value={formatNumber(stats?.total_providers ?? 0)}
          icon={Stethoscope}
          color="emerald"
        />
        <StatCard
          title="Total Claims"
          value={formatNumber(stats?.total_claims ?? 0)}
          icon={FileText}
          color="orange"
        />
        <StatCard
          title="Claims (7d)"
          value={formatNumber(stats?.recent_claims_7d ?? 0)}
          icon={TrendingUp}
          color="sky"
          sub="last 7 days"
        />
        <StatCard
          title="New Users (7d)"
          value={formatNumber(stats?.recent_users_7d ?? 0)}
          icon={UserPlus}
          color="emerald"
          sub="last 7 days"
        />
      </div>
    </div>
  )
}
