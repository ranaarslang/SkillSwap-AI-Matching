import { useCallback, useEffect, useRef, useState } from 'react'
import type { AdminStats, AdminUser, ChatMessage, MatchProfile, Review, SessionItem, User } from '../api'
import { api, ApiError, displayName, formatLocation } from '../api'
import { Avatar, Chip, StatusBadge } from './ui'
import AdminUserDetail from './AdminUserDetail'
import AdminReports from './AdminReports'
import AdminSkills from './AdminSkills'
import AdminAnalytics from './AdminAnalytics'
import AdminAnnouncements from './AdminAnnouncements'
import AdminAuditLog from './AdminAuditLog'
import AdminExport from './AdminExport'

/** Round 4 — the admin console has three switchable dark themes (the
 * user picks one; the choice persists in localStorage). All three stay
 * dark and clearly distinct from the light student app; only the
 * accent combination changes. */
export type AdminTheme = 'gold' | 'emerald' | 'copper'
export const ADMIN_THEMES: { id: AdminTheme; label: string; dot: string; hint: string }[] = [
  { id: 'gold', label: 'Midnight Gold', dot: '#F2B33D', hint: 'Deep midnight navy + warm gold (default)' },
  { id: 'emerald', label: 'Emerald Noir', dot: '#34D399', hint: 'Deep green-charcoal + emerald' },
  { id: 'copper', label: 'Graphite Copper', dot: '#E8935A', hint: 'Warm graphite + copper' },
]

interface Props {
  currentUserId: number
  adminTheme: AdminTheme
  onAdminThemeChange: (t: AdminTheme) => void
  onMessage: (profile: MatchProfile) => void
  /** Place an in-app video call to a user (App owns the CallManager). */
  onCall: (user: User) => void
}

type AdminTab = 'users' | 'sessions' | 'reviews' | 'approvals' | 'reports' | 'skills' | 'analytics' | 'announcements' | 'audit' | 'export'

const SESSION_STATUSES = ['', 'PENDING', 'ACCEPTED', 'COMPLETED', 'CANCELLED']

export default function AdminPanel({ currentUserId, adminTheme, onAdminThemeChange, onMessage, onCall }: Props) {
  const [tab, setTab] = useState<AdminTab>('users')
  const [detailUserId, setDetailUserId] = useState<number | null>(null)
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [users, setUsers] = useState<AdminUser[]>([])
  const [sessions, setSessions] = useState<SessionItem[]>([])
  const [reviews, setReviews] = useState<Review[]>([])
  const [approvals, setApprovals] = useState<ChatMessage[]>([])
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busyUserId, setBusyUserId] = useState<number | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null)
  const [confirmCancelId, setConfirmCancelId] = useState<number | null>(null)
  const [busySessionId, setBusySessionId] = useState<number | null>(null)
  const searchRef = useRef('')

  const loadUsers = useCallback(async (q?: string) => {
    try {
      setUsers(await api.getAdminUsers(q || undefined))
    } catch {
      /* keep old list; error shown on full load */
    }
  }, [])

  const loadApprovals = useCallback(async () => {
    try {
      setApprovals(await api.getMessageApprovals())
    } catch {
      /* keep old list; error shown on full load */
    }
  }, [])

  const loadAll = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [s, u, sess, r, a] = await Promise.all([
        api.getAdminStats(),
        api.getAdminUsers(),
        api.getAdminSessions(),
        api.getAdminReviews(),
        api.getMessageApprovals(),
      ])
      setStats(s)
      setUsers(u)
      setSessions(sess)
      setReviews(r)
      setApprovals(a)
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : 'Could not load admin data.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadAll()
  }, [loadAll])

  // A new user can sign up while the panel is open — the list loaded at
  // mount goes stale. Re-fetch the users list (and the stats, so the
  // "Total users" card can't disagree with the Users tab count) every
  // time the Users view is opened, so new signups always show.
  // The same staleness applies to the approvals queue: a held message
  // can arrive while the panel is open.
  useEffect(() => {
    if (tab === 'users') {
      loadUsers(searchRef.current)
      api.getAdminStats().then(setStats).catch(() => undefined)
    }
    if (tab === 'approvals') {
      loadApprovals()
    }
  }, [tab, loadUsers, loadApprovals])

  // While the Approvals tab is open, a new held message can arrive at
  // any time — poll the queue so the admin sees it without leaving the
  // tab (the Refresh button below does the same on demand).
  useEffect(() => {
    if (tab !== 'approvals') return
    const t = window.setInterval(loadApprovals, 20000)
    return () => window.clearInterval(t)
  }, [tab, loadApprovals])

  async function searchUsers(q: string) {
    setSearch(q)
    searchRef.current = q
    await loadUsers(q)
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

  // Round 3c: Message Approvals — a held chat message (phone number or
  // link) is delivered only when the admin approves it, or never when
  // rejected. The message leaves the queue either way.
  const [busyApprovalId, setBusyApprovalId] = useState<number | null>(null)

  async function decideApproval(m: ChatMessage, approve: boolean) {
    setBusyApprovalId(m.id)
    setNotice('')
    setError('')
    try {
      if (approve) {
        await api.approveMessage(m.id)
        setNotice(`Message from ${displayName(m.sender)} to ${displayName(m.recipient)} approved and delivered.`)
      } else {
        await api.rejectMessage(m.id)
        setNotice(`Message from ${displayName(m.sender)} to ${displayName(m.recipient)} rejected — it will never be delivered.`)
      }
      setApprovals((prev) => prev.filter((x) => x.id !== m.id))
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : 'Could not decide the message.')
    } finally {
      setBusyApprovalId(null)
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
        <p className="eyebrow">Staff Only</p>
        <h1 className="page-title mt-1">Admin Panel</h1>
        <p className="mt-1 text-sm text-[var(--adm-text-dim)]">
          Platform overview, user management, sessions and review moderation. Staff only.
        </p>
        {/* Round 4 — theme picker. Three dark professional combinations;
            the user taps one and it sticks (localStorage). */}
        <div className="mt-3 flex flex-wrap items-center gap-2" role="group" aria-label="Admin console theme">
          <span className="text-xs font-semibold uppercase tracking-wider text-[var(--adm-text-faint)]">Theme</span>
          {ADMIN_THEMES.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => onAdminThemeChange(t.id)}
              aria-pressed={adminTheme === t.id}
              title={t.hint}
              className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ring-inset transition-colors ${
                adminTheme === t.id
                  ? 'bg-[var(--adm-accent-soft)] text-[var(--adm-accent-text)] ring-[var(--adm-accent-ring)]'
                  : 'text-[var(--adm-text-dim)] ring-[var(--adm-border-strong)] hover:text-[var(--adm-text)]'
              }`}
            >
              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: t.dot }} />
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div role="alert" className="rounded-lg bg-red-500/10 px-3 py-2.5 text-sm text-red-400 ring-1 ring-inset ring-red-500/30">
          {error}
        </div>
      )}
      {notice && (
        <div role="status" className="rounded-lg bg-[var(--adm-accent-soft)] px-3 py-2.5 text-sm text-[var(--adm-accent-text)] ring-1 ring-inset ring-[var(--adm-accent-ring)]">
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
          onCall={onCall}
        />
      ) : (
        <>

      {/* Stats */}
      {loading ? (
        <p className="text-sm text-[var(--adm-text-dim)]">Loading admin data…</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          {statCards.map((s) => (
            <div key={s.label} className="stat-card p-4">
              <div className="pt-1 text-3xl font-extrabold tracking-tight text-[var(--adm-text)]">{s.value}</div>
              <div className="mt-0.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--adm-text-faint)]">{s.label}</div>
              <div className="mt-1 text-xs text-[var(--adm-text-dim)]">{s.sub}</div>
            </div>
          ))}
        </div>
      )}

      {/* Section tabs — 10 sections now (round 4); wraps to two rows on
          narrow screens. */}
      <div className="flex flex-wrap gap-1 rounded-lg bg-[var(--adm-surface-2)] p-1" role="tablist" aria-label="Admin sections">
        {(
          [
            { id: 'users', label: `Users (${users.length})` },
            { id: 'sessions', label: `Sessions (${sessions.length})` },
            { id: 'reviews', label: `Reviews (${reviews.length})` },
            { id: 'approvals', label: `Approvals (${approvals.length})` },
            { id: 'reports', label: 'Reports' },
            { id: 'skills', label: 'Skills' },
            { id: 'analytics', label: 'Analytics' },
            { id: 'announcements', label: 'Announcements' },
            { id: 'audit', label: 'Audit log' },
            { id: 'export', label: 'Export' },
          ] as { id: AdminTab; label: string }[]
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 rounded-md px-3 py-2 text-sm font-semibold transition-colors ${
              tab === t.id ? 'bg-[var(--adm-accent-soft)] text-[var(--adm-accent-text)] shadow-sm ring-1 ring-inset ring-[var(--adm-accent-ring)]' : 'text-[var(--adm-text-dim)] hover:text-[var(--adm-text)]'
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
              className="input-dark min-w-[220px] flex-1"
            />
            <button
              onClick={loadAll}
              className="btn-admin-secondary"
            >
              Refresh
            </button>
          </div>
          {users.length === 0 ? (
            <p className="card p-6 text-sm text-[var(--adm-text-dim)]">
              {search ? `No users match "${search}".` : 'No users yet.'}
            </p>
          ) : (
            <div className="overflow-x-auto card">
              <table className="w-full min-w-[880px] text-left text-sm">
                <thead>
                  <tr className="border-b border-[var(--adm-border)] bg-[var(--adm-surface-2)] text-xs uppercase tracking-wider text-[var(--adm-text-dim)]">
                    <th className="px-3 py-2.5 font-semibold">ID</th>
                    <th className="px-3 py-2.5 font-semibold">User</th>
                    <th className="px-3 py-2.5 font-semibold">Joined</th>
                    <th className="px-3 py-2.5 font-semibold">Location</th>
                    <th className="px-3 py-2.5 font-semibold">Teaches</th>
                    <th className="px-3 py-2.5 font-semibold">Wants to learn</th>
                    <th className="px-3 py-2.5 font-semibold">Trust</th>
                    <th className="px-3 py-2.5 font-semibold">Status</th>
                    <th className="px-3 py-2.5 font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => {
                    const isSelf = u.user.id === currentUserId
                    const isNew = Date.now() - new Date(u.date_joined).getTime() < 7 * 24 * 60 * 60 * 1000
                    return (
                      <tr key={u.user.id} className="border-b border-[var(--adm-border)] last:border-0 hover:bg-[var(--adm-surface-2)]">
                        <td className="px-3 py-2.5 font-mono text-xs font-semibold text-[var(--adm-text)]">{u.user.id}</td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-3">
                            <Avatar user={u.user} color={u.avatar_color} size="sm" />
                            <div className="min-w-0">
                              <p className="font-semibold text-[var(--adm-text)]">
                                {displayName(u.user)}
                                {u.is_staff && <span className="ml-2 rounded-full bg-[var(--adm-bg)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">Admin</span>}
                              </p>
                              <p className="truncate text-xs text-[var(--adm-text-dim)]">@{u.user.username} · {u.user.email}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-2.5">
                          <span className="text-[var(--adm-text-dim)]">{new Date(u.date_joined).toLocaleDateString()}</span>
                          {isNew && (
                            <span className="ml-2 rounded-full bg-[var(--adm-accent-soft)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--adm-accent-text)] ring-1 ring-inset ring-[var(--adm-accent-ring)]">New</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-[var(--adm-text-dim)]">{formatLocation(u) || '—'}</td>
                        <td className="max-w-[180px] px-3 py-2.5">
                          <div className="flex flex-wrap gap-1">
                            {u.teach_skills.length ? u.teach_skills.map((s) => <Chip key={s}>{s}</Chip>) : <span className="text-[var(--adm-text-faint)]">—</span>}
                          </div>
                        </td>
                        <td className="max-w-[180px] px-3 py-2.5">
                          <div className="flex flex-wrap gap-1">
                            {u.learn_skills.length ? u.learn_skills.map((s) => <Chip key={s} tone="emerald">{s}</Chip>) : <span className="text-[var(--adm-text-faint)]">—</span>}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 font-semibold text-[var(--adm-text)]">★ {u.trust_score}</td>
                        <td className="px-3 py-2.5">
                          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${u.is_active ? 'bg-[var(--adm-accent-soft)] text-[var(--adm-accent-text)] ring-1 ring-inset ring-[var(--adm-accent-ring)]' : 'bg-red-500/15 text-red-300 ring-1 ring-inset ring-red-500/30'}`}>
                            {u.is_active ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex gap-2">
                            <button
                              onClick={() => setDetailUserId(u.user.id)}
                              className="btn-admin-secondary px-3 py-1.5 text-xs"
                            >
                              View
                            </button>
                            <button
                              onClick={() => onCall(u.user)}
                              disabled={isSelf}
                              title={isSelf ? 'You cannot call yourself.' : `Video call ${displayName(u.user)}`}
                              aria-label={`Video call ${displayName(u.user)}`}
                              className="btn-admin-secondary px-3 py-1.5 text-xs disabled:opacity-40"
                            >
                              📹 Call
                            </button>
                            <button
                              onClick={() => toggleActive(u)}
                              disabled={isSelf || busyUserId === u.user.id}
                              title={isSelf ? 'You cannot deactivate your own account.' : undefined}
                              className="btn-admin-secondary px-3 py-1.5 text-xs disabled:opacity-40"
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
            <label htmlFor="admin-session-filter" className="text-sm font-semibold text-[var(--adm-text-dim)]">Status</label>
            <select
              id="admin-session-filter"
              value={statusFilter}
              onChange={(e) => filterSessions(e.target.value)}
              className="input-dark w-auto"
            >
              {SESSION_STATUSES.map((s) => (
                <option key={s || 'all'} value={s}>{s === '' ? 'All statuses' : s.charAt(0) + s.slice(1).toLowerCase()}</option>
              ))}
            </select>
          </div>
          {sessions.length === 0 ? (
            <p className="card p-6 text-sm text-[var(--adm-text-dim)]">No sessions match this filter.</p>
          ) : (
            <div className="overflow-x-auto card">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead>
                  <tr className="border-b border-[var(--adm-border)] bg-[var(--adm-surface-2)] text-xs uppercase tracking-wider text-[var(--adm-text-dim)]">
                    <th className="px-3 py-2.5 font-semibold">Session</th>
                    <th className="px-3 py-2.5 font-semibold">Partners</th>
                    <th className="px-3 py-2.5 font-semibold">Date</th>
                    <th className="px-3 py-2.5 font-semibold">Duration</th>
                    <th className="px-3 py-2.5 font-semibold">Status</th>
                    <th className="px-3 py-2.5 font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((s) => (
                    <tr key={s.id} className="border-b border-[var(--adm-border)] last:border-0 hover:bg-[var(--adm-surface-2)]">
                      <td className="px-3 py-2.5 font-semibold text-[var(--adm-text)]">{s.title || 'Skill swap session'}</td>
                      <td className="px-3 py-2.5 text-[var(--adm-text-dim)]">
                        {displayName(s.partner_one)} ↔ {displayName(s.partner_two)}
                      </td>
                      <td className="px-3 py-2.5 text-[var(--adm-text-dim)]">{new Date(s.calendar_date).toLocaleDateString()}</td>
                      <td className="px-3 py-2.5 text-[var(--adm-text-dim)]">{s.duration_block}</td>
                      <td className="px-3 py-2.5"><StatusBadge status={s.session_status} /></td>
                      <td className="px-3 py-2.5">
                        {(s.session_status === 'PENDING' || s.session_status === 'ACCEPTED') &&
                          (confirmCancelId === s.id ? (
                            <span className="flex gap-1.5">
                              <button onClick={() => cancelSession(s)} disabled={busySessionId === s.id} className="rounded-lg bg-red-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-60">
                                Confirm
                              </button>
                              <button onClick={() => setConfirmCancelId(null)} className="btn-admin-secondary px-2.5 py-1 text-xs">
                                Keep
                              </button>
                            </span>
                          ) : (
                            <button onClick={() => setConfirmCancelId(s.id)} className="rounded-lg border border-red-500/40 px-2.5 py-1 text-xs font-semibold text-red-400 hover:bg-red-500/100/10">
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
            <p className="card p-6 text-sm text-[var(--adm-text-dim)]">No reviews yet.</p>
          ) : (
            <ul className="space-y-3">
              {reviews.map((r) => (
                <li key={r.id} className="card p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[var(--adm-text)]">
                        {r.reviewer ? displayName(r.reviewer) : 'Unknown'} → {r.reviewee ? displayName(r.reviewee) : 'Unknown'}
                      </p>
                      <p className="mt-0.5 text-sm font-semibold text-amber-500">
                        {'★'.repeat(r.rating_stars)}{'☆'.repeat(5 - r.rating_stars)}
                        <span className="ml-2 font-normal text-[var(--adm-text-dim)]">
                          {r.created_at ? new Date(r.created_at).toLocaleDateString() : ''} · Session #{r.session ?? r.session_id}
                        </span>
                      </p>
                      {r.feedback_text && <p className="mt-1.5 text-sm leading-relaxed text-[var(--adm-text-dim)]">{r.feedback_text}</p>}
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
                          className="btn-admin-secondary px-3 py-1.5 text-xs"
                        >
                          Cancel
                        </button>
                      </span>
                    ) : (
                      <button
                        onClick={() => setConfirmDeleteId(r.id)}
                        className="rounded-lg border border-red-500/40 px-3 py-1.5 text-xs font-semibold text-red-400 hover:bg-red-500/100/10"
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
      {tab === 'approvals' && (
        <section>
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <p className="flex-1 text-sm text-[var(--adm-text-dim)]">
              Messages held by the chat privacy filter (a phone number or a link). The sender sees
              them as "waiting for admin approval" and the recipient does not see them at all until
              you approve. Approving delivers the message; rejecting means it is never delivered.
            </p>
            <button onClick={loadApprovals} className="btn-admin-secondary">
              Refresh
            </button>
          </div>
          {approvals.length === 0 ? (
            <p className="card p-6 text-sm text-[var(--adm-text-dim)]">No messages waiting for approval.</p>
          ) : (
            <ul className="space-y-3">
              {approvals.map((m) => (
                <li key={m.id} className="card p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[var(--adm-text)]">
                        {displayName(m.sender)} → {displayName(m.recipient)}
                        <span className="ml-2 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-300 ring-1 ring-inset ring-amber-500/30">
                          {m.flag_reason ? `Flagged: ${m.flag_reason}` : 'Flagged'}
                        </span>
                      </p>
                      <p className="mt-1 text-sm leading-relaxed text-[var(--adm-text)] break-words">{m.body}</p>
                      {m.attachment && (
                        <p className="mt-1 text-xs text-[var(--adm-text-dim)]">📎 {m.attachment.name} · {m.attachment.size} bytes</p>
                      )}
                      <p className="mt-1 text-xs text-[var(--adm-text-faint)]">
                        {new Date(m.created_at).toLocaleString()} · Message #{m.id}
                      </p>
                    </div>
                    <span className="flex gap-2">
                      <button
                        onClick={() => decideApproval(m, true)}
                        disabled={busyApprovalId === m.id}
                        className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                      >
                        {busyApprovalId === m.id ? 'Saving…' : 'Approve'}
                      </button>
                      <button
                        onClick={() => decideApproval(m, false)}
                        disabled={busyApprovalId === m.id}
                        className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-60"
                      >
                        Reject
                      </button>
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      {/* Round 4 sections — each loads its own data. */}
      {tab === 'reports' && <AdminReports />}
      {tab === 'skills' && <AdminSkills />}
      {tab === 'analytics' && <AdminAnalytics />}
      {tab === 'announcements' && <AdminAnnouncements />}
      {tab === 'audit' && <AdminAuditLog />}
      {tab === 'export' && <AdminExport />}
        </>
      )}
    </div>
  )
}
