import { useCallback, useEffect, useState } from 'react'
import type { AdminUserDetail, MatchProfile, SessionItem } from '../api'
import { api, ApiError, displayName } from '../api'
import { Avatar, Chip, StatusBadge, TrustBadge, VerifiedBadge } from './ui'

interface Props {
  userId: number
  currentUserId: number
  onBack: () => void
  onMessage: (profile: MatchProfile) => void
}

/**
 * Admin user-detail view: the full record for one user on one screen, so
 * any issue can be investigated and fixed here — profile + skills,
 * sessions (with cancel), reviews received/given, recent messages (with
 * delete), password reset, trust override, activate/deactivate.
 */
export default function AdminUserDetail({ userId, currentUserId, onBack, onMessage }: Props) {
  const [detail, setDetail] = useState<AdminUserDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [tempPassword, setTempPassword] = useState('')
  const [trustInput, setTrustInput] = useState('')
  const [busy, setBusy] = useState('')
  const [confirmAction, setConfirmAction] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const d = await api.getAdminUserDetail(userId)
      setDetail(d)
      setTrustInput(String(d.trust_score))
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : 'Could not load this user.')
    } finally {
      setLoading(false)
    }
  }, [userId])

  useEffect(() => {
    load()
  }, [load])

  async function run(action: string, fn: () => Promise<void>) {
    setBusy(action)
    setError('')
    setNotice('')
    try {
      await fn()
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : 'That action failed.')
    } finally {
      setBusy('')
      setConfirmAction(null)
    }
  }

  async function resetPassword() {
    const pw = newPassword.trim()
    if (pw && pw.length < 6) {
      setError('Password must be at least 6 characters.')
      return
    }
    await run('reset-password', async () => {
      const res = await api.adminResetPassword(userId, pw || undefined)
      setTempPassword(res.temporary_password)
      setNewPassword('')
      setNotice(
        `Password reset for ${detail ? displayName(detail.user) : 'this user'}. ` +
          'Share the temporary password once and ask them to change it after login.',
      )
    })
  }

  async function setTrust() {
    const value = parseInt(trustInput, 10)
    if (Number.isNaN(value)) {
      setError('Enter a trust score from 0 to 100.')
      return
    }
    await run('set-trust', async () => {
      const updated = await api.adminSetTrust(userId, value)
      setNotice(`Trust score set to ${updated.trust_score} (clamped 0–100).`)
    })
  }

  async function toggleActive() {
    if (!detail) return
    await run('toggle-active', async () => {
      const updated = await api.adminToggleUserActive(userId)
      setNotice(`${displayName(updated.user)} is now ${updated.is_active ? 'active' : 'deactivated'}.`)
    })
  }

  async function cancelSession(s: SessionItem) {
    await run(`cancel-session-${s.id}`, async () => {
      await api.adminCancelSession(s.id)
      setNotice(`Session "${s.title || 'Skill swap session'}" cancelled.`)
    })
  }

  async function deleteMessage(messageId: number) {
    await run(`delete-message-${messageId}`, async () => {
      await api.adminDeleteMessage(messageId)
      setNotice('Message deleted.')
    })
  }

  function toMatchProfile(d: AdminUserDetail): MatchProfile {
    return {
      ...d,
      match_score: 0,
      location_bonus: 0,
      same_location: false,
      can_teach_you: [],
      you_can_teach_them: [],
    }
  }

  if (loading) return <p className="text-sm text-slate-500">Loading user record…</p>
  if (!detail) {
    return (
      <div>
        {error && <div role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-inset ring-red-200">{error}</div>}
        <button onClick={onBack} className="mt-4 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
          ← Back to users
        </button>
      </div>
    )
  }

  const isSelf = detail.user.id === currentUserId

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={onBack} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
          ← Back to users
        </button>
        <h2 className="text-xl font-bold tracking-tight text-slate-900">User record</h2>
      </div>

      {error && (
        <div role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-inset ring-red-200">{error}</div>
      )}
      {notice && (
        <div role="status" className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-700 ring-1 ring-inset ring-emerald-200">{notice}</div>
      )}
      {tempPassword && (
        <div role="status" className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3">
          <p className="text-sm font-semibold text-amber-800">Temporary password — shown once, copy it now:</p>
          <p className="mt-1 font-mono text-lg font-bold tracking-wide text-slate-900">{tempPassword}</p>
          <p className="mt-1 text-xs text-amber-700">This value is not stored anywhere in the panel. Tell the user to change it after they log in.</p>
        </div>
      )}

      {/* Profile summary */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-start gap-4">
          <Avatar user={detail.user} color={detail.avatar_color} size="lg" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-lg font-bold text-slate-900">{displayName(detail.user)}</h3>
              {detail.verified_badge && <VerifiedBadge />}
              {detail.is_staff && <span className="rounded-full bg-slate-900 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">Admin</span>}
            </div>
            <p className="text-sm text-slate-500">@{detail.user.username} · {detail.user.email}</p>
            <p className="mt-1 text-sm text-slate-500">
              Joined {new Date(detail.date_joined).toLocaleDateString()}
              {detail.location ? ` · 📍 ${detail.location}` : ''}
              {detail.availability ? ` · Available: ${detail.availability}` : ''}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <TrustBadge score={detail.trust_score} />
              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${detail.is_active ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}`}>
                {detail.is_active ? 'Active' : 'Inactive'}
              </span>
            </div>
          </div>
          <button
            onClick={() => onMessage(toMatchProfile(detail))}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700"
          >
            Message
          </button>
        </div>
        {detail.bio && <p className="mt-4 text-sm leading-relaxed text-slate-600">{detail.bio}</p>}
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Can teach</p>
            <div className="flex flex-wrap gap-1.5">
              {detail.teach_skills.length ? detail.teach_skills.map((s) => <Chip key={s}>{s}</Chip>) : <span className="text-sm text-slate-400">—</span>}
            </div>
          </div>
          <div>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Wants to learn</p>
            <div className="flex flex-wrap gap-1.5">
              {detail.learn_skills.length ? detail.learn_skills.map((s) => <Chip key={s} tone="emerald">{s}</Chip>) : <span className="text-sm text-slate-400">—</span>}
            </div>
          </div>
        </div>
        {detail.portfolio_link && (
          <a href={detail.portfolio_link} target="_blank" rel="noreferrer" className="mt-3 inline-block text-sm font-semibold text-indigo-600 hover:underline">
            View portfolio ↗
          </a>
        )}
      </section>

      {/* Issue-resolution actions */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500">Fix an issue</h3>
        <div className="mt-4 grid gap-5 md:grid-cols-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="reset-pw">Reset password</label>
            <div className="flex gap-2">
              <input
                id="reset-pw"
                type="text"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Leave blank to auto-generate"
                autoComplete="off"
                className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <button
                onClick={resetPassword}
                disabled={busy === 'reset-password'}
                className="shrink-0 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
              >
                {busy === 'reset-password' ? 'Resetting…' : 'Reset'}
              </button>
            </div>
            <p className="mt-1 text-xs text-slate-500">Blank = a secure temporary password is generated and shown once.</p>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="trust-input">Trust score (0–100)</label>
            <div className="flex gap-2">
              <input
                id="trust-input"
                type="number"
                min={0}
                max={100}
                value={trustInput}
                onChange={(e) => setTrustInput(e.target.value)}
                className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <button
                onClick={setTrust}
                disabled={busy === 'set-trust'}
                className="shrink-0 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
              >
                {busy === 'set-trust' ? 'Saving…' : 'Set'}
              </button>
            </div>
            <p className="mt-1 text-xs text-slate-500">Manual override — a later review recalculates it from ratings.</p>
          </div>
          <div>
            <span className="mb-1 block text-sm font-medium text-slate-700">Account status</span>
            {confirmAction === 'toggle-active' ? (
              <span className="flex gap-2">
                <button onClick={toggleActive} disabled={busy === 'toggle-active'} className="rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60">
                  Confirm {detail.is_active ? 'deactivate' : 'activate'}
                </button>
                <button onClick={() => setConfirmAction(null)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                  Cancel
                </button>
              </span>
            ) : (
              <button
                onClick={() => setConfirmAction('toggle-active')}
                disabled={isSelf}
                title={isSelf ? 'You cannot deactivate your own account.' : undefined}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
              >
                {detail.is_active ? 'Deactivate account' : 'Activate account'}
              </button>
            )}
            {isSelf && <p className="mt-1 text-xs text-slate-500">You cannot deactivate your own account.</p>}
          </div>
        </div>
      </section>

      {/* Sessions */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500">Sessions ({detail.sessions.length})</h3>
        {detail.sessions.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">No sessions yet.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {detail.sessions.map((s) => {
              const other = s.partner_one.id === detail.user.id ? s.partner_two : s.partner_one
              const cancellable = s.session_status === 'PENDING' || s.session_status === 'ACCEPTED'
              return (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2.5">
                  <span className="min-w-0 text-sm">
                    <span className="font-semibold text-slate-900">{s.title || 'Skill swap session'}</span>
                    <span className="text-slate-500"> with {displayName(other)} · {new Date(s.calendar_date).toLocaleDateString()} · {s.duration_block}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <StatusBadge status={s.session_status} />
                    {cancellable &&
                      (confirmAction === `cancel-${s.id}` ? (
                        <span className="flex gap-1.5">
                          <button onClick={() => cancelSession(s)} disabled={busy === `cancel-session-${s.id}`} className="rounded-lg bg-red-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-60">
                            Confirm
                          </button>
                          <button onClick={() => setConfirmAction(null)} className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                            Keep
                          </button>
                        </span>
                      ) : (
                        <button onClick={() => setConfirmAction(`cancel-${s.id}`)} className="rounded-lg border border-red-300 px-2.5 py-1 text-xs font-semibold text-red-700 hover:bg-red-50">
                          Cancel
                        </button>
                      ))}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {/* Reviews */}
      <section className="grid gap-6 md:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500">Reviews received ({detail.reviews_received.length})</h3>
          {detail.reviews_received.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">None yet.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {detail.reviews_received.map((r) => (
                <li key={r.id} className="rounded-lg bg-slate-50 px-3 py-2">
                  <p className="text-sm font-semibold text-amber-500">{'★'.repeat(r.rating_stars)}{'☆'.repeat(5 - r.rating_stars)}</p>
                  <p className="text-sm text-slate-600">{r.feedback_text || 'No comment.'}</p>
                  <p className="text-xs text-slate-400">from {r.reviewer ? displayName(r.reviewer) : 'Unknown'}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500">Reviews given ({detail.reviews_given.length})</h3>
          {detail.reviews_given.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">None yet.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {detail.reviews_given.map((r) => (
                <li key={r.id} className="rounded-lg bg-slate-50 px-3 py-2">
                  <p className="text-sm font-semibold text-amber-500">{'★'.repeat(r.rating_stars)}{'☆'.repeat(5 - r.rating_stars)}</p>
                  <p className="text-sm text-slate-600">{r.feedback_text || 'No comment.'}</p>
                  <p className="text-xs text-slate-400">to {r.reviewee ? displayName(r.reviewee) : 'Unknown'}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* Recent messages */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500">Recent messages ({detail.recent_messages.length})</h3>
        {detail.recent_messages.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">No messages yet.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {detail.recent_messages.map((m) => (
              <li key={m.id} className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2.5">
                <span className="min-w-0 text-sm">
                  <span className="font-semibold text-slate-900">{displayName(m.sender)} → {displayName(m.recipient)}</span>
                  <span className="block text-slate-600">{m.body}</span>
                  <span className="text-xs text-slate-400">{new Date(m.created_at).toLocaleString()}</span>
                </span>
                {confirmAction === `delete-msg-${m.id}` ? (
                  <span className="flex gap-1.5">
                    <button onClick={() => deleteMessage(m.id)} disabled={busy === `delete-message-${m.id}`} className="rounded-lg bg-red-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-60">
                      Confirm
                    </button>
                    <button onClick={() => setConfirmAction(null)} className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                      Keep
                    </button>
                  </span>
                ) : (
                  <button onClick={() => setConfirmAction(`delete-msg-${m.id}`)} className="shrink-0 rounded-lg border border-red-300 px-2.5 py-1 text-xs font-semibold text-red-700 hover:bg-red-50">
                    Delete
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
