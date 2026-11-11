import { useCallback, useEffect, useState } from 'react'
import { api, ApiError, displayName, type UserReport } from '../api'
import { Avatar } from './ui'

/** Round 4 — Reports / complaints queue (admin side). Students report
 * another user from their profile; the admin resolves each report here:
 * dismiss it, warn (note only), or deactivate the reported user. */
const ACTIONS = [
  { id: 'dismiss', label: 'Dismiss', hint: 'No action against the reported user.' },
  { id: 'warn', label: 'Warn', hint: 'Record a warning note. The user stays active.' },
  { id: 'deactivate', label: 'Deactivate user', hint: 'The reported user can no longer log in.' },
] as const

export default function AdminReports() {
  const [reports, setReports] = useState<UserReport[]>([])
  const [statusFilter, setStatusFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [actionById, setActionById] = useState<Record<number, string>>({})
  const [noteById, setNoteById] = useState<Record<number, string>>({})
  const [confirmId, setConfirmId] = useState<number | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setReports(await api.getAdminReports(statusFilter || undefined))
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : 'Could not load reports.')
    } finally {
      setLoading(false)
    }
  }, [statusFilter])

  useEffect(() => {
    load()
  }, [load])

  async function resolve(r: UserReport) {
    const action = actionById[r.id] || 'dismiss'
    if (action === 'deactivate' && confirmId !== r.id) {
      setConfirmId(r.id)
      return
    }
    setConfirmId(null)
    setBusyId(r.id)
    setNotice('')
    setError('')
    try {
      const updated = await api.adminResolveReport(r.id, action, noteById[r.id] || '')
      setReports((prev) => prev.map((x) => (x.id === updated.id ? updated : x)))
      setNotice(
        `Report #${r.id} resolved — ${updated.action_taken.replace('_', ' ')}` +
          (updated.resolution_note ? ` ("${updated.resolution_note}")` : '') +
          '.',
      )
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : 'Could not resolve the report.')
    } finally {
      setBusyId(null)
    }
  }

  const openCount = reports.filter((r) => r.status === 'open').length

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <p className="flex-1 text-sm text-[var(--adm-text-dim)]">
          Students report another user from their profile. {openCount > 0 ? `${openCount} open right now.` : 'Nothing open right now.'}
        </p>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="input-dark w-auto"
          aria-label="Filter reports by status"
        >
          <option value="">All reports</option>
          <option value="open">Open only</option>
          <option value="resolved">Resolved only</option>
        </select>
        <button onClick={load} className="btn-admin-secondary">
          Refresh
        </button>
      </div>
      {error && (
        <div role="alert" className="mb-3 rounded-lg bg-red-500/10 px-3 py-2.5 text-sm text-red-400 ring-1 ring-inset ring-red-500/30">
          {error}
        </div>
      )}
      {notice && (
        <div role="status" className="mb-3 rounded-lg bg-[var(--adm-accent-soft)] px-3 py-2.5 text-sm text-[var(--adm-accent-text)] ring-1 ring-inset ring-[var(--adm-accent-ring)]">
          {notice}
        </div>
      )}
      {loading ? (
        <p className="text-sm text-[var(--adm-text-dim)]">Loading reports…</p>
      ) : reports.length === 0 ? (
        <p className="card p-6 text-sm text-[var(--adm-text-dim)]">No reports match this filter.</p>
      ) : (
        <ul className="space-y-3">
          {reports.map((r) => {
            const action = actionById[r.id] || 'dismiss'
            const actionHint = ACTIONS.find((a) => a.id === action)?.hint
            return (
              <li key={r.id} className="card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-[var(--adm-text)]">
                      {displayName(r.reporter)} reported {displayName(r.reported_user)}
                      <span className={`ml-2 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ring-1 ring-inset ${
                        r.status === 'open'
                          ? 'bg-amber-500/15 text-amber-300 ring-amber-500/30'
                          : 'bg-[var(--adm-accent-soft)] text-[var(--adm-accent-text)] ring-[var(--adm-accent-ring)]'
                      }`}>
                        {r.status === 'open' ? 'Open' : `Resolved · ${r.action_taken.replace('_', ' ')}`}
                      </span>
                    </p>
                    <p className="mt-0.5 text-sm text-[var(--adm-text-dim)]">
                      <span className="font-semibold text-[var(--adm-text)]">{r.reason_label}</span>
                      {r.details ? ` — ${r.details}` : ''}
                    </p>
                    <p className="mt-1 text-xs text-[var(--adm-text-faint)]">
                      Report #{r.id} · {new Date(r.created_at).toLocaleString()}
                      {r.resolved_by ? ` · Resolved by ${displayName(r.resolved_by)}${r.resolved_at ? ` on ${new Date(r.resolved_at).toLocaleDateString()}` : ''}` : ''}
                      {r.resolution_note ? ` · Note: "${r.resolution_note}"` : ''}
                    </p>
                    <p className="mt-1 text-xs text-[var(--adm-text-faint)]">
                      Reporter: @{r.reporter.username} · Reported: @{r.reported_user.username}
                    </p>
                  </div>
                  <Avatar user={r.reported_user} size="sm" />
                </div>
                {r.status === 'open' && (
                  <div className="mt-3 border-t border-[var(--adm-border)] pt-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <label htmlFor={`report-action-${r.id}`} className="text-sm font-semibold text-[var(--adm-text-dim)]">
                        Action
                      </label>
                      <select
                        id={`report-action-${r.id}`}
                        value={action}
                        onChange={(e) => setActionById((prev) => ({ ...prev, [r.id]: e.target.value }))}
                        className="input-dark w-auto"
                      >
                        {ACTIONS.map((a) => (
                          <option key={a.id} value={a.id}>{a.label}</option>
                        ))}
                      </select>
                      <input
                        type="text"
                        value={noteById[r.id] || ''}
                        onChange={(e) => setNoteById((prev) => ({ ...prev, [r.id]: e.target.value }))}
                        placeholder="Resolution note (optional)…"
                        aria-label="Resolution note"
                        className="input-dark min-w-[200px] flex-1"
                        maxLength={300}
                      />
                      {confirmId === r.id ? (
                        <span className="flex gap-2">
                          <button
                            onClick={() => resolve(r)}
                            disabled={busyId === r.id}
                            className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-60"
                          >
                            {busyId === r.id ? 'Saving…' : 'Confirm deactivation'}
                          </button>
                          <button onClick={() => setConfirmId(null)} className="btn-admin-secondary px-3 py-1.5 text-xs">
                            Cancel
                          </button>
                        </span>
                      ) : (
                        <button
                          onClick={() => resolve(r)}
                          disabled={busyId === r.id}
                          className="btn-admin px-3 py-1.5 text-xs"
                        >
                          {busyId === r.id ? 'Saving…' : 'Resolve'}
                        </button>
                      )}
                    </div>
                    {actionHint && <p className="mt-1.5 text-xs text-[var(--adm-text-faint)]">{actionHint}</p>}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
