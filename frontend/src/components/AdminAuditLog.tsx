import { useCallback, useEffect, useState } from 'react'
import { api, ApiError, displayName, type AuditEntry } from '../api'

/** Round 4 — Audit log (admin side). Every successful admin action is
 * recorded by the backend audit middleware (activate/deactivate,
 * password reset, trust override, verified toggle, session cancel,
 * review/message delete, message approve/reject, report resolution,
 * announcement create/delete, skill add/rename/remove). Filter by
 * action name or by admin / target / detail text. */
const ACTION_LABELS: Record<string, string> = {
  'user.toggle_active': 'Activate / deactivate user',
  'user.toggle_verified': 'Toggle verified badge',
  'user.reset_password': 'Reset user password',
  'user.set_trust': 'Override trust score',
  'session.cancel': 'Cancel session',
  'review.delete': 'Delete review',
  'message.delete': 'Delete message',
  'message.approve': 'Approve held message',
  'message.reject': 'Reject held message',
  'report.resolve': 'Resolve report',
  'skill.add': 'Add skill',
  'skill.rename': 'Rename skill',
  'skill.remove': 'Remove skill',
  'announcement.create': 'Create announcement',
  'announcement.delete': 'Delete announcement',
}

export default function AdminAuditLog() {
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [actionFilter, setActionFilter] = useState('')
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async (action?: string, q?: string) => {
    setLoading(true)
    setError('')
    try {
      setEntries(await api.getAdminAuditLog(action || undefined, q || undefined))
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : 'Could not load the audit log.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  function applyFilters() {
    load(actionFilter.trim() || undefined, query.trim() || undefined)
  }

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <p className="flex-1 text-sm text-[var(--adm-text-dim)]">
          Every admin action, newest first — who did what, to whom, and when.
        </p>
        <input
          type="text"
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') applyFilters()
          }}
          placeholder="Filter by action, e.g. user.toggle_active"
          aria-label="Filter by action"
          className="input-dark min-w-[220px] flex-1"
        />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') applyFilters()
          }}
          placeholder="Search admin, target or detail…"
          aria-label="Search the audit log"
          className="input-dark min-w-[200px] flex-1"
        />
        <button onClick={applyFilters} className="btn-admin-secondary">
          Filter
        </button>
        <button
          onClick={() => {
            setActionFilter('')
            setQuery('')
            load()
          }}
          className="btn-admin-secondary"
        >
          Refresh
        </button>
      </div>
      {error && (
        <div role="alert" className="mb-3 rounded-lg bg-red-500/10 px-3 py-2.5 text-sm text-red-400 ring-1 ring-inset ring-red-500/30">
          {error}
        </div>
      )}
      {loading ? (
        <p className="text-sm text-[var(--adm-text-dim)]">Loading audit log…</p>
      ) : entries.length === 0 ? (
        <p className="card p-6 text-sm text-[var(--adm-text-dim)]">
          No audit entries match this filter. Actions taken from this point on are recorded here.
        </p>
      ) : (
        <div className="overflow-x-auto card">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--adm-border)] bg-[var(--adm-surface-2)] text-xs uppercase tracking-wider text-[var(--adm-text-dim)]">
                <th className="px-3 py-2.5 font-semibold">Time</th>
                <th className="px-3 py-2.5 font-semibold">Admin</th>
                <th className="px-3 py-2.5 font-semibold">Action</th>
                <th className="px-3 py-2.5 font-semibold">Target</th>
                <th className="px-3 py-2.5 font-semibold">Detail</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className="border-b border-[var(--adm-border)] last:border-0 hover:bg-[var(--adm-surface-2)]">
                  <td className="whitespace-nowrap px-3 py-2.5 text-[var(--adm-text-dim)]">
                    {new Date(e.created_at).toLocaleString()}
                  </td>
                  <td className="px-3 py-2.5 font-semibold text-[var(--adm-text)]">
                    {e.admin ? displayName(e.admin) : '—'}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="rounded bg-[var(--adm-accent-soft)] px-2 py-0.5 font-mono text-xs font-semibold text-[var(--adm-accent-text)] ring-1 ring-inset ring-[var(--adm-accent-ring)]">
                      {e.action}
                    </span>
                    <span className="mt-0.5 block text-xs text-[var(--adm-text-faint)]">
                      {ACTION_LABELS[e.action] || e.action}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-[var(--adm-text-dim)]">{e.target_label || '—'}</td>
                  <td className="px-3 py-2.5 text-[var(--adm-text-dim)]">{e.detail || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
