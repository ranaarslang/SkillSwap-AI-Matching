import { useCallback, useEffect, useState } from 'react'
import { api, ApiError, type AdminAnalytics } from '../api'

/** Round 4 — Analytics (admin side). Lightweight div-based charts over
 * the aggregates the backend computes — no chart dependency, so the
 * bundle stays clean. Bars use the theme accent; session statuses keep
 * their semantic colors in every theme. */
const STATUS_COLORS: Record<string, string> = {
  pending: '#f59e0b',
  accepted: '#38bdf8',
  completed: '#34d399',
  cancelled: '#f87171',
}

function BarChart({ data, color, formatLabel }: {
  data: { label: string; value: number }[]
  color: string
  formatLabel?: (label: string) => string
}) {
  const max = Math.max(1, ...data.map((d) => d.value))
  return (
    <div className="flex items-end gap-1.5" style={{ height: 150 }}>
      {data.map((d) => (
        <div key={d.label} className="flex min-w-0 flex-1 flex-col items-center gap-1" title={`${d.label}: ${d.value}`}>
          <span className="text-xs font-bold" style={{ color }}>{d.value}</span>
          <div
            className="w-full max-w-[28px] rounded-t"
            style={{ height: `${Math.max(4, (d.value / max) * 104)}px`, background: color }}
          />
          <span className="truncate text-[10px] text-[var(--adm-text-faint)]">
            {formatLabel ? formatLabel(d.label) : d.label}
          </span>
        </div>
      ))}
    </div>
  )
}

function GroupedBarChart({ data }: {
  data: { week: string; pending: number; accepted: number; completed: number; cancelled: number }[]
}) {
  const max = Math.max(1, ...data.flatMap((d) => [d.pending, d.accepted, d.completed, d.cancelled]))
  return (
    <div>
      <div className="flex items-end gap-2" style={{ height: 150 }}>
        {data.map((d) => (
          <div key={d.week} className="flex min-w-0 flex-1 flex-col items-center gap-1" title={`${d.week}: ${d.completed} completed · ${d.pending} pending · ${d.accepted} accepted · ${d.cancelled} cancelled`}>
            <div className="flex w-full max-w-[44px] items-end justify-center gap-[3px]" style={{ height: 118 }}>
              {(['pending', 'accepted', 'completed', 'cancelled'] as const).map((k) => (
                <div
                  key={k}
                  className="w-[9px] rounded-t"
                  style={{ height: `${Math.max(3, (d[k] / max) * 118)}px`, background: STATUS_COLORS[k] }}
                />
              ))}
            </div>
            <span className="text-[10px] text-[var(--adm-text-faint)]">{d.week.slice(5)}</span>
          </div>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-4 text-xs text-[var(--adm-text-dim)]">
        {(['pending', 'accepted', 'completed', 'cancelled'] as const).map((k) => (
          <span key={k} className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: STATUS_COLORS[k] }} />
            {k.charAt(0).toUpperCase() + k.slice(1)}
          </span>
        ))}
      </div>
    </div>
  )
}

export default function AdminAnalytics() {
  const [data, setData] = useState<AdminAnalytics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setData(await api.getAdminAnalytics())
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : 'Could not load analytics.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  if (loading) return <p className="text-sm text-[var(--adm-text-dim)]">Loading analytics…</p>
  if (error) {
    return (
      <div role="alert" className="rounded-lg bg-red-500/10 px-3 py-2.5 text-sm text-red-400 ring-1 ring-inset ring-red-500/30">
        {error}
      </div>
    )
  }
  if (!data) return null

  const kpis = [
    { value: data.total_matches, label: 'Matches made', sub: 'Sessions created' },
    { value: `${data.completion_rate}%`, label: 'Completion rate', sub: `${data.sessions_completed} of ${data.total_sessions} sessions` },
    { value: data.total_sessions, label: 'Total sessions', sub: `${data.sessions_cancelled} cancelled` },
    { value: data.total_messages, label: 'Total messages', sub: 'Across all chats' },
    { value: data.total_reviews, label: 'Total reviews', sub: 'Session feedback' },
  ]

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="flex-1 text-sm text-[var(--adm-text-dim)]">
          Growth and session trends, computed live from the platform data.
        </p>
        <button onClick={load} className="btn-admin-secondary">
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {kpis.map((k) => (
          <div key={k.label} className="stat-card p-4">
            <div className="pt-1 text-3xl font-extrabold tracking-tight text-[var(--adm-text)]">{k.value}</div>
            <div className="mt-0.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--adm-text-faint)]">{k.label}</div>
            <div className="mt-1 text-xs text-[var(--adm-text-dim)]">{k.sub}</div>
          </div>
        ))}
      </div>

      <div className="card p-4">
        <h3 className="text-sm font-bold text-[var(--adm-text)]">New users per week</h3>
        <p className="text-xs text-[var(--adm-text-faint)]">Signups in each of the last 12 weeks (Monday start).</p>
        <div className="mt-3">
          <BarChart
            data={data.users_per_week.map((w) => ({ label: w.week, value: w.count }))}
            color="var(--adm-accent)"
            formatLabel={(l) => l.slice(5)}
          />
        </div>
      </div>

      <div className="card p-4">
        <h3 className="text-sm font-bold text-[var(--adm-text)]">New users per month</h3>
        <p className="text-xs text-[var(--adm-text-faint)]">Signups in each of the last 6 months.</p>
        <div className="mt-3">
          <BarChart
            data={data.users_per_month.map((m) => ({ label: m.month, value: m.count }))}
            color="var(--adm-accent)"
            formatLabel={(l) => l.slice(5)}
          />
        </div>
      </div>

      <div className="card p-4">
        <h3 className="text-sm font-bold text-[var(--adm-text)]">Sessions by status over time</h3>
        <p className="text-xs text-[var(--adm-text-faint)]">Sessions created in each of the last 12 weeks, split by status.</p>
        <div className="mt-3">
          <GroupedBarChart data={data.sessions_by_week} />
        </div>
      </div>
    </section>
  )
}
