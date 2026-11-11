import { useCallback, useEffect, useState } from 'react'
import type { AdminUserDetail, MatchProfile, SessionItem, User } from '../api'
import { api, ApiError, displayName, formatFileSize, formatLocation } from '../api'
import { Avatar, Chip, StatusBadge, TrustBadge, VerifiedBadge } from './ui'

interface Props {
  userId: number
  currentUserId: number
  onBack: () => void
  onMessage: (profile: MatchProfile) => void
  /** Place an in-app video call to this user (App owns the CallManager). */
  onCall: (user: User) => void
}

/**
 * Admin user-detail view: the full record for one user on one screen, so
 * any issue can be investigated and fixed here — profile + skills,
 * sessions (with cancel), reviews received/given, recent messages (with
 * delete), password reset, trust override, activate/deactivate.
 */
export default function AdminUserDetail({ userId, currentUserId, onBack, onMessage, onCall }: Props) {
  const [detail, setDetail] = useState<AdminUserDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [tempPassword, setTempPassword] = useState('')
  const [trustInput, setTrustInput] = useState('')
  const [busy, setBusy] = useState('')
  const [confirmAction, setConfirmAction] = useState<string | null>(null)
  const [messageText, setMessageText] = useState('')
  const [sendingMessage, setSendingMessage] = useState(false)

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

  // Round 3c audit fix (SRS REQ-01.4): the admin can toggle the profile
  // validation badge, so account credibility can be marked clearly.
  async function toggleVerified() {
    if (!detail) return
    await run('toggle-verified', async () => {
      const updated = await api.adminToggleVerified(userId)
      setNotice(
        `${displayName(updated.user)}'s profile is now ${updated.verified_badge ? 'verified ✓' : 'not verified'}.`,
      )
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

  // Round 5: message this user directly from the record — the student
  // gets a prominent banner with the text and an "Open chat" button.
  // Staff messages skip the moderation hold (backend), so it is
  // delivered immediately.
  async function sendAdminMessage() {
    const body = messageText.trim()
    if (!body || !detail || sendingMessage) return
    setSendingMessage(true)
    setError('')
    setNotice('')
    try {
      const sent = await api.sendMessage({ recipient_id: userId, body })
      setMessageText('')
      setNotice(
        sent.moderation_status === 'pending'
          ? `Message sent to ${displayName(detail.user)} — it is waiting for approval.`
          : `Message sent to ${displayName(detail.user)}. They will see a banner with it.`,
      )
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : 'Could not send the message.')
    } finally {
      setSendingMessage(false)
    }
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

  if (loading) return <p className="text-sm text-[var(--adm-text-dim)]">Loading user record…</p>
  if (!detail) {
    return (
      <div>
        {error && <div role="alert" className="rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400 ring-1 ring-inset ring-red-500/30">{error}</div>}
        <button onClick={onBack} className="mt-4 btn-admin-secondary">
          ← Back to users
        </button>
      </div>
    )
  }

  const isSelf = detail.user.id === currentUserId

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={onBack} className="btn-admin-secondary">
          ← Back to users
        </button>
        <h2 className="text-xl font-bold tracking-tight text-[var(--adm-text)]">User record</h2>
      </div>

      {error && (
        <div role="alert" className="rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400 ring-1 ring-inset ring-red-500/30">{error}</div>
      )}
      {notice && (
        <div role="status" className="rounded-lg bg-[var(--adm-accent-soft)] px-4 py-3 text-sm text-[var(--adm-accent-text)] ring-1 ring-inset ring-[var(--adm-accent-ring)]">{notice}</div>
      )}
      {tempPassword && (
        <div role="status" className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3">
          <p className="text-sm font-semibold text-amber-300">Temporary password — shown once, copy it now:</p>
          <p className="mt-1 font-mono text-lg font-bold tracking-wide text-[var(--adm-text)]">{tempPassword}</p>
          <p className="mt-1 text-xs text-amber-300">This value is not stored anywhere in the panel. Tell the user to change it after they log in.</p>
        </div>
      )}

      {/* Profile summary */}
      <section className="card p-5 sm:p-6">
        <div className="flex flex-wrap items-start gap-4">
          <Avatar user={detail.user} color={detail.avatar_color} size="lg" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-lg font-bold text-[var(--adm-text)]">{displayName(detail.user)}</h3>
              {detail.verified_badge && <VerifiedBadge />}
              {detail.is_staff && <span className="rounded-full bg-[var(--adm-bg)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">Admin</span>}
            </div>
            <p className="text-sm text-[var(--adm-text-dim)]">ID {detail.user.id} · @{detail.user.username} · {detail.user.email}</p>
            <p className="mt-1 text-sm text-[var(--adm-text-dim)]">
              Joined {new Date(detail.date_joined).toLocaleDateString()}
              {formatLocation(detail) ? ` · 📍 ${formatLocation(detail)}` : ''}
              {detail.availability ? ` · Available: ${detail.availability}` : ''}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <TrustBadge score={detail.trust_score} />
              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${detail.is_active ? 'bg-[var(--adm-accent-soft)] text-[var(--adm-accent-text)] ring-1 ring-inset ring-[var(--adm-accent-ring)]' : 'bg-red-500/15 text-red-300 ring-1 ring-inset ring-red-500/30'}`}>
                {detail.is_active ? 'Active' : 'Inactive'}
              </span>
            </div>
          </div>
          <span className="flex gap-2">
            <button
              onClick={() => onMessage(toMatchProfile(detail))}
              className="btn-admin"
            >
              Message
            </button>
            <button
              onClick={() => onCall(detail.user)}
              disabled={isSelf}
              title={isSelf ? 'You cannot call yourself.' : `Video call ${displayName(detail.user)}`}
              aria-label={`Video call ${displayName(detail.user)}`}
              className="btn-admin disabled:opacity-40"
            >
              📹 Video call
            </button>
          </span>
        </div>
        {detail.bio && <p className="mt-4 text-sm leading-relaxed text-[var(--adm-text-dim)]">{detail.bio}</p>}
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--adm-text-faint)]">Can teach</p>
            <div className="flex flex-wrap gap-1.5">
              {detail.teach_skills.length ? detail.teach_skills.map((s) => <Chip key={s}>{s}</Chip>) : <span className="text-sm text-[var(--adm-text-faint)]">—</span>}
            </div>
          </div>
          <div>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--adm-text-faint)]">Wants to learn</p>
            <div className="flex flex-wrap gap-1.5">
              {detail.learn_skills.length ? detail.learn_skills.map((s) => <Chip key={s} tone="emerald">{s}</Chip>) : <span className="text-sm text-[var(--adm-text-faint)]">—</span>}
            </div>
          </div>
        </div>
        {detail.portfolio_link && (
          <a href={detail.portfolio_link} target="_blank" rel="noreferrer" className="mt-3 inline-block text-sm font-semibold text-[var(--adm-accent)] hover:underline">
            View portfolio ↗
          </a>
        )}
      </section>

      {/* Message this user — the student gets a full-width banner with
          the text and an "Open chat" button, wherever they are in the
          app. Staff messages skip the moderation hold. */}
      <section className="card p-5 sm:p-6">
        <h3 className="text-sm font-bold uppercase tracking-wider text-[var(--adm-text-dim)]">Message this user</h3>
        <div className="mt-3 flex gap-2">
          <textarea
            value={messageText}
            onChange={(e) => setMessageText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void sendAdminMessage()
            }}
            placeholder={`Write a message to ${displayName(detail.user)}…`}
            aria-label={`Message ${displayName(detail.user)}`}
            rows={2}
            className="input min-w-0 flex-1 resize-y"
          />
          <button
            onClick={() => void sendAdminMessage()}
            disabled={!messageText.trim() || sendingMessage}
            className="btn-admin shrink-0 self-start disabled:opacity-40"
          >
            {sendingMessage ? 'Sending…' : 'Send'}
          </button>
        </div>
        <p className="mt-1 text-xs text-[var(--adm-text-dim)]">
          Delivered immediately — the student sees a banner with your message and an "Open chat" button. Cmd/Ctrl+Enter sends.
        </p>
      </section>

      {/* Issue-resolution actions */}
      <section className="card p-5 sm:p-6">
        <h3 className="text-sm font-bold uppercase tracking-wider text-[var(--adm-text-dim)]">Fix an issue</h3>
        <div className="mt-4 grid gap-5 md:grid-cols-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-[var(--adm-text)]" htmlFor="reset-pw">Reset password</label>
            <div className="flex gap-2">
              <input
                id="reset-pw"
                type="text"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Leave blank to auto-generate"
                autoComplete="off"
                className="min-w-0 input flex-1 min-w-0"
              />
              <button
                onClick={resetPassword}
                disabled={busy === 'reset-password'}
                className="btn-admin shrink-0"
              >
                {busy === 'reset-password' ? 'Resetting…' : 'Reset'}
              </button>
            </div>
            <p className="mt-1 text-xs text-[var(--adm-text-dim)]">Blank = a secure temporary password is generated and shown once.</p>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-[var(--adm-text)]" htmlFor="trust-input">Trust score (0–100)</label>
            <div className="flex gap-2">
              <input
                id="trust-input"
                type="number"
                min={0}
                max={100}
                value={trustInput}
                onChange={(e) => setTrustInput(e.target.value)}
                className="min-w-0 input flex-1 min-w-0"
              />
              <button
                onClick={setTrust}
                disabled={busy === 'set-trust'}
                className="btn-admin shrink-0"
              >
                {busy === 'set-trust' ? 'Saving…' : 'Set'}
              </button>
            </div>
            <p className="mt-1 text-xs text-[var(--adm-text-dim)]">Manual override — a later review recalculates it from ratings.</p>
          </div>
          <div>
            <span className="mb-1 block text-sm font-medium text-[var(--adm-text)]">Account status</span>
            {confirmAction === 'toggle-active' ? (
              <span className="flex gap-2">
                <button onClick={toggleActive} disabled={busy === 'toggle-active'} className="rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60">
                  Confirm {detail.is_active ? 'deactivate' : 'activate'}
                </button>
                <button onClick={() => setConfirmAction(null)} className="btn-admin-secondary">
                  Cancel
                </button>
              </span>
            ) : (
              <button
                onClick={() => setConfirmAction('toggle-active')}
                disabled={isSelf}
                title={isSelf ? 'You cannot deactivate your own account.' : undefined}
                className="btn-admin-secondary disabled:opacity-40"
              >
                {detail.is_active ? 'Deactivate account' : 'Activate account'}
              </button>
            )}
            {isSelf && <p className="mt-1 text-xs text-[var(--adm-text-dim)]">You cannot deactivate your own account.</p>}
          </div>
          <div>
            <span className="mb-1 block text-sm font-medium text-[var(--adm-text)]">Verification badge</span>
            <button
              onClick={toggleVerified}
              disabled={busy === 'toggle-verified'}
              className="btn-admin-secondary"
            >
              {busy === 'toggle-verified'
                ? 'Saving…'
                : detail.verified_badge
                  ? 'Remove verification ✓'
                  : 'Mark as verified'}
            </button>
            <p className="mt-1 text-xs text-[var(--adm-text-dim)]">
              {detail.verified_badge ? 'This profile shows the verified badge.' : 'This profile has no verified badge.'}
            </p>
          </div>
        </div>
      </section>

      {/* Sessions */}
      <section className="card p-5 sm:p-6">
        <h3 className="text-sm font-bold uppercase tracking-wider text-[var(--adm-text-dim)]">Sessions ({detail.sessions.length})</h3>
        {detail.sessions.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--adm-text-dim)]">No sessions yet.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {detail.sessions.map((s) => {
              const other = s.partner_one.id === detail.user.id ? s.partner_two : s.partner_one
              const cancellable = s.session_status === 'PENDING' || s.session_status === 'ACCEPTED'
              return (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--adm-border)] px-3 py-2.5">
                  <span className="min-w-0 text-sm">
                    <span className="font-semibold text-[var(--adm-text)]">{s.title || 'Skill swap session'}</span>
                    <span className="text-[var(--adm-text-dim)]"> with {displayName(other)} · {new Date(s.calendar_date).toLocaleDateString()} · {s.duration_block}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <StatusBadge status={s.session_status} />
                    {cancellable &&
                      (confirmAction === `cancel-${s.id}` ? (
                        <span className="flex gap-1.5">
                          <button onClick={() => cancelSession(s)} disabled={busy === `cancel-session-${s.id}`} className="rounded-lg bg-red-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-60">
                            Confirm
                          </button>
                          <button onClick={() => setConfirmAction(null)} className="btn-admin-secondary px-2.5 py-1 text-xs">
                            Keep
                          </button>
                        </span>
                      ) : (
                        <button onClick={() => setConfirmAction(`cancel-${s.id}`)} className="rounded-lg border border-red-500/40 px-2.5 py-1 text-xs font-semibold text-red-400 hover:bg-red-500/100/10">
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
        <div className="card p-5">
          <h3 className="text-sm font-bold uppercase tracking-wider text-[var(--adm-text-dim)]">Reviews received ({detail.reviews_received.length})</h3>
          {detail.reviews_received.length === 0 ? (
            <p className="mt-2 text-sm text-[var(--adm-text-dim)]">None yet.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {detail.reviews_received.map((r) => (
                <li key={r.id} className="rounded-lg bg-[var(--adm-surface-2)] px-3 py-2">
                  <p className="text-sm font-semibold text-amber-500">{'★'.repeat(r.rating_stars)}{'☆'.repeat(5 - r.rating_stars)}</p>
                  <p className="text-sm text-[var(--adm-text-dim)]">{r.feedback_text || 'No comment.'}</p>
                  <p className="text-xs text-[var(--adm-text-faint)]">from {r.reviewer ? displayName(r.reviewer) : 'Unknown'}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="card p-5">
          <h3 className="text-sm font-bold uppercase tracking-wider text-[var(--adm-text-dim)]">Reviews given ({detail.reviews_given.length})</h3>
          {detail.reviews_given.length === 0 ? (
            <p className="mt-2 text-sm text-[var(--adm-text-dim)]">None yet.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {detail.reviews_given.map((r) => (
                <li key={r.id} className="rounded-lg bg-[var(--adm-surface-2)] px-3 py-2">
                  <p className="text-sm font-semibold text-amber-500">{'★'.repeat(r.rating_stars)}{'☆'.repeat(5 - r.rating_stars)}</p>
                  <p className="text-sm text-[var(--adm-text-dim)]">{r.feedback_text || 'No comment.'}</p>
                  <p className="text-xs text-[var(--adm-text-faint)]">to {r.reviewee ? displayName(r.reviewee) : 'Unknown'}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* Recent messages */}
      <section className="card p-5 sm:p-6">
        <h3 className="text-sm font-bold uppercase tracking-wider text-[var(--adm-text-dim)]">Recent messages ({detail.recent_messages.length})</h3>
        {detail.recent_messages.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--adm-text-dim)]">No messages yet.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {detail.recent_messages.map((m) => (
              <li key={m.id} className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-[var(--adm-border)] px-3 py-2.5">
                <span className="min-w-0 text-sm">
                  <span className="font-semibold text-[var(--adm-text)]">{displayName(m.sender)} → {displayName(m.recipient)}</span>
                  <span className="block text-[var(--adm-text-dim)]">{m.body}</span>
                  {m.code_language && (
                    <span className="block text-xs text-violet-300">Code · {m.code_language}</span>
                  )}
                  {m.attachment && (
                    <span className="block text-xs text-sky-300">📎 {m.attachment.name} · {formatFileSize(m.attachment.size)}</span>
                  )}
                  <span className="text-xs text-[var(--adm-text-faint)]">{new Date(m.created_at).toLocaleString()}</span>
                </span>
                {confirmAction === `delete-msg-${m.id}` ? (
                  <span className="flex gap-1.5">
                    <button onClick={() => deleteMessage(m.id)} disabled={busy === `delete-message-${m.id}`} className="rounded-lg bg-red-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-60">
                      Confirm
                    </button>
                    <button onClick={() => setConfirmAction(null)} className="btn-admin-secondary px-2.5 py-1 text-xs">
                      Keep
                    </button>
                  </span>
                ) : (
                  <button onClick={() => setConfirmAction(`delete-msg-${m.id}`)} className="shrink-0 rounded-lg border border-red-500/40 px-2.5 py-1 text-xs font-semibold text-red-400 hover:bg-red-500/100/10">
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
