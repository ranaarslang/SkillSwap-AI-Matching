import { useCallback, useEffect, useState } from 'react'
import type { AdminStats, AdminUser, MatchProfile, Review, SessionItem } from '../api'
import { api, ApiError, displayName } from '../api'
import { Avatar, Chip, StatusBadge } from './ui'
import AdminUserDetail from './AdminUserDetail'

interface Props {
  currentUserId: number
  onMessage: (profile: MatchProfile) => void
}

type AdminTab = 'users' | 'sessions' | 'reviews'

const SESSION_STATUSES = ['', 'PENDING', 'ACCEPTED', 'COMPLETED', 'CANCELLED']

export default function AdminPanel({ currentUserId, onMessage }: Props) {
  const [tab, setTab] = useState<AdminTab>('users')
  const [detailUserId, setDetailUserId] = useState<number | null>(null)
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [users, setUsers] = useState<AdminUser[]>([])
  const [sessions, setSessions] = useState<SessionItem[]>([])
  const [reviews, setReviews] = useState<Review[]>([])
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busyUserId, setBusyUserId] = useState<number | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null)
  const [confirmCancelId, setConfirmCancelId] = useState<number | null>(null)
  const [busySessionId, setBusySessionId] = useState<number | null>(null)

  const loadAll = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [s, u, sess, r] = await Promise.all([
        api.getAdminStats(),
        api.getAdminUsers(),
        api.getAdminSessions(),
        api.getAdminReviews(),
      ])
      setStats(s)
      setUsers(u)
      setSessions(sess)
      setReviews(r)
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : 'Could not load admin data.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadAll()
  }, [loadAll])

  async function searchUsers(q: string) {
    setSearch(q)
    try {
      setUsers(await api.getAdminUsers(q || undefined))
    } catch {
      /* keep old list; error shown on full load */
    }
  }

  async function filterSessions(status: string) {
    setStatusFilter(status)
    try {
      setSessions(await api.getAdminSessions(status || undefined))
    } catch {
      /* keep old list */
    }
  }

  async function toggleActive(u: AdminUser) {
    if (u.user.id === currentUserId) return
    setBusyUserId(u.user.id)
    setNotice('')
    setError('')
    try {
      const updated = await api.adminToggleUserActive(u.user.id)
      setUsers((prev) => prev.map((x) => (x.user.id === updated.user.id ? updated : x)))
      setNotice(
        `${displayName(updated.user)} is now ${updated.is_active ? 'active' : 'deactivated'}.`,
      )
      const s = await api.getAdminStats()
      setStats(s)
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : 'Could not change the account status.')
    } finally {
      setBusyUserId(null)
    }
  }

  async function deleteReview(r: Review) {
    setConfirmDeleteId(null)
    setNotice('')
    setError('')
    try {
      const res = await api.adminDeleteReview(r.id)
      setReviews((prev) => prev.filter((x) => x.id !== r.id))
      setNotice(
        `Review deleted. ${displayName(r.reviewee ?? { id: 0, username: '', full_name: '', email: '' })}'s trust score is now ${res.trust_score}.`,
      )
      const [s, u] = await Promise.all([api.getAdminStats(), api.getAdminUsers(search || undefined)])
      setStats(s)
      setUsers(u)
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : 'Could not delete the review.')
    }
  }

  async function cancelSession(s: SessionItem) {
    setConfirmCancelId(null)
    setBusySessionId(s.id)
    setNotice('')
    setError('')
    try {
      const updated = await api.adminCancelSession(s.id)
      setSessions((prev) => prev.map((x) => (x.id === updated.id ? updated : x)))
      setNotice(`Session "${updated.title || 'Skill swap session'}" cancelled.`)
      const statsRes = await api.getAdminStats()
      setStats(statsRes)
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : 'Could not cancel the session.')
    } finally {
      setBusySessionId(null)
    }
  }

  const statCards = stats
    ? [
        { value: stats.total_users, label: 'Total users', sub: `${stats.total_students} students` },
        { value: stats.total_sessions, label: 'Total sessions', sub: `${stats.sessions_pending} pending · ${stats.sessions_completed} completed` },
        { value: stats.total_messages, label: 'Total messages', sub: 'Across all chats' },
        { value: stats.total_reviews, label: 'Total reviews', sub: 'Session feedback' },
        { value: stats.average_trust_score, label: 'Avg trust score', sub: 'Out of 100' },
      ]
    : []

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Admin Panel</h1>
        <p className="mt-1 text-sm text-slate-500">
          Platform overview, user management, sessions and review moderation. Staff only.
        </p>
      </div>

      {error && (
        <div role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-inset ring-red-200">
          {error}
        </div>
      )}
      {notice && (
        <div role="status" className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-700 ring-1 ring-inset ring-emerald-200">
          {notice}
        </div>
      )}

      {/* User detail view replaces the dashboard sections */}
      {detailUserId !== null ? (
        <AdminUserDetail
          userId={detailUserId}
          currentUserId={currentUserId}
          onBack={() => {
            setDetailUserId(null)
            loadAll()
          }}
          onMessage={onMessage}
        />
      ) : (
        <>

      {/* Stats */}
      {loading ? (
        <p className="text-sm text-slate-500">Loading admin data…</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          {statCards.map((s) => (
            <div key={s.label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="text-2xl font-bold tracking-tight text-indigo-600">{s.value}</div>
              <div className="mt-0.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{s.label}</div>
              <div className="mt-1 text-xs text-slate-500">{s.sub}</div>
            </div>
          ))}
        </div>
      )}

      {/* Section tabs */}
      <div className="flex gap-1 rounded-lg bg-slate-100 p-1" role="tablist" aria-label="Admin sections">
        {(
          [
            { id: 'users', label: `Users (${users.length})` },
            { id: 'sessions', label: `Sessions (${sessions.length})` },
            { id: 'reviews', label: `Reviews (${reviews.length})` },
          ] as { id: AdminTab; label: string }[]
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 rounded-md px-3 py-2 text-sm font-semibold transition-colors ${
              tab === t.id ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'users' && (
        <section>
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <input
              type="search"
              value={search}
              onChange={(e) => searchUsers(e.target.value)}
              placeholder="Search by name, username or email…"
              aria-label="Search users"
              className="min-w-[220px] flex-1 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <button
              onClick={loadAll}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Refresh
            </button>
          </div>
          {users.length === 0 ? (
            <p className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500 shadow-sm">
              {search ? `No users match "${search}".` : 'No users yet.'}
            </p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
                    <th className="px-4 py-3 font-semibold">User</th>
                    <th className="px-4 py-3 font-semibold">Location</th>
                    <th className="px-4 py-3 font-semibold">Teaches</th>
                    <th className="px-4 py-3 font-semibold">Wants to learn</th>
                    <th className="px-4 py-3 font-semibold">Trust</th>
                    <th className="px-4 py-3 font-semibold">Status</th>
                    <th className="px-4 py-3 font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => {
                    const isSelf = u.user.id === currentUserId
                    return (
                      <tr key={u.user.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <Avatar user={u.user} color={u.avatar_color} size="sm" />
                            <div className="min-w-0">
                              <p className="font-semibold text-slate-900">
                                {displayName(u.user)}
                                {u.is_staff && <span className="ml-2 rounded-full bg-slate-900 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">Admin</span>}
                              </p>
                              <p className="truncate text-xs text-slate-500">@{u.user.username} · {u.user.email}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-slate-600">{u.location || '—'}</td>
                        <td className="max-w-[180px] px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            {u.teach_skills.length ? u.teach_skills.map((s) => <Chip key={s}>{s}</Chip>) : <span className="text-slate-400">—</span>}
                          </div>
                        </td>
                        <td className="max-w-[180px] px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            {u.learn_skills.length ? u.learn_skills.map((s) => <Chip key={s} tone="emerald">{s}</Chip>) : <span className="text-slate-400">—</span>}
                          </div>
                        </td>
                        <td className="px-4 py-3 font-semibold text-slate-800">★ {u.trust_score}</td>
                        <td className="px-4 py-3">
                          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${u.is_active ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}`}>
                            {u.is_active ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex gap-2">
                            <button
                              onClick={() => setDetailUserId(u.user.id)}
                              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                            >
                              View
                            </button>
                            <button
                              onClick={() => toggleActive(u)}
                              disabled={isSelf || busyUserId === u.user.id}
                              title={isSelf ? 'You cannot deactivate your own account.' : undefined}
                              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                            >
                              {busyUserId === u.user.id ? 'Saving…' : u.is_active ? 'Deactivate' : 'Activate'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {tab === 'sessions' && (
        <section>
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <label htmlFor="admin-session-filter" className="text-sm font-semibold text-slate-600">Status</label>
            <select
              id="admin-session-filter"
              value={statusFilter}
              onChange={(e) => filterSessions(e.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {SESSION_STATUSES.map((s) => (
                <option key={s || 'all'} value={s}>{s === '' ? 'All statuses' : s.charAt(0) + s.slice(1).toLowerCase()}</option>
              ))}
            </select>
          </div>
          {sessions.length === 0 ? (
            <p className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500 shadow-sm">No sessions match this filter.</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
                    <th className="px-4 py-3 font-semibold">Session</th>
                    <th className="px-4 py-3 font-semibold">Partners</th>
                    <th className="px-4 py-3 font-semibold">Date</th>
                    <th className="px-4 py-3 font-semibold">Duration</th>
                    <th className="px-4 py-3 font-semibold">Status</th>
                    <th className="px-4 py-3 font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((s) => (
                    <tr key={s.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                      <td className="px-4 py-3 font-semibold text-slate-900">{s.title || 'Skill swap session'}</td>
                      <td className="px-4 py-3 text-slate-600">
                        {displayName(s.partner_one)} ↔ {displayName(s.partner_two)}
                      </td>
                      <td className="px-4 py-3 text-slate-600">{new Date(s.calendar_date).toLocaleDateString()}</td>
                      <td className="px-4 py-3 text-slate-600">{s.duration_block}</td>
                      <td className="px-4 py-3"><StatusBadge status={s.session_status} /></td>
                      <td className="px-4 py-3">
                        {(s.session_status === 'PENDING' || s.session_status === 'ACCEPTED') &&
                          (confirmCancelId === s.id ? (
                            <span className="flex gap-1.5">
                              <button onClick={() => cancelSession(s)} disabled={busySessionId === s.id} className="rounded-lg bg-red-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-60">
                                Confirm
                              </button>
                              <button onClick={() => setConfirmCancelId(null)} className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                                Keep
                              </button>
                            </span>
                          ) : (
                            <button onClick={() => setConfirmCancelId(s.id)} className="rounded-lg border border-red-300 px-2.5 py-1 text-xs font-semibold text-red-700 hover:bg-red-50">
                              Cancel
                            </button>
                          ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {tab === 'reviews' && (
        <section>
          {reviews.length === 0 ? (
            <p className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500 shadow-sm">No reviews yet.</p>
          ) : (
            <ul className="space-y-3">
              {reviews.map((r) => (
                <li key={r.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900">
                        {r.reviewer ? displayName(r.reviewer) : 'Unknown'} → {r.reviewee ? displayName(r.reviewee) : 'Unknown'}
                      </p>
                      <p className="mt-0.5 text-sm font-semibold text-amber-500">
                        {'★'.repeat(r.rating_stars)}{'☆'.repeat(5 - r.rating_stars)}
                        <span className="ml-2 font-normal text-slate-500">
                          {r.created_at ? new Date(r.created_at).toLocaleDateString() : ''} · Session #{r.session ?? r.session_id}
                        </span>
                      </p>
                      {r.feedback_text && <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{r.feedback_text}</p>}
                    </div>
                    {confirmDeleteId === r.id ? (
                      <span className="flex gap-2">
                        <button
                          onClick={() => deleteReview(r)}
                          className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700"
                        >
                          Confirm delete
                        </button>
                        <button
                          onClick={() => setConfirmDeleteId(null)}
                          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          Cancel
                        </button>
                      </span>
                    ) : (
                      <button
                        onClick={() => setConfirmDeleteId(r.id)}
                        className="rounded-lg border border-red-300 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
        </>
      )}
    </div>
  )
}
