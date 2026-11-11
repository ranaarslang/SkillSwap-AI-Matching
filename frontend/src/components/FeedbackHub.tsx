import { useEffect, useMemo, useState } from 'react'
import type { Profile, SessionItem, User } from '../api'
import { api, ApiError, displayName } from '../api'
import { Avatar } from './ui'

interface Props {
  sessions: SessionItem[]
  currentUserId: number
  peerProfiles: Map<number, import('../api').MatchProfile>
  loading: boolean
  error: string
  /** Session to pre-select (from a "Rate" button on a completed session). */
  preselectSessionId?: number | null
  onPreselectConsumed?: () => void
}

function otherPerson(s: SessionItem, me: number): User {
  return s.partner_one.id === me ? s.partner_two : s.partner_one
}

export default function FeedbackHub({ sessions, currentUserId, peerProfiles, loading, error, preselectSessionId, onPreselectConsumed }: Props) {
  // Partners limited to completed-session partners only
  const completedPartners = useMemo(() => {
    const map = new Map<number, { partner: User; session: SessionItem }>()
    sessions
      .filter((s) => s.session_status === 'COMPLETED')
      .forEach((s) => {
        const partner = otherPerson(s, currentUserId)
        if (!map.has(partner.id)) map.set(partner.id, { partner, session: s })
      })
    return [...map.values()]
  }, [sessions, currentUserId])

  const [selectedId, setSelectedId] = useState('')
  const [rating, setRating] = useState(0)
  const [comment, setComment] = useState('')
  const [submitError, setSubmitError] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ name: string; trust: number } | null>(null)
  // Sessions already reviewed in this visit — one review per session per
  // author (server-enforced); hide them so a duplicate can't be attempted.
  const [reviewedSessionIds, setReviewedSessionIds] = useState<number[]>([])
  const rateablePartners = completedPartners.filter((p) => !reviewedSessionIds.includes(p.session.id))

  // A "Rate" button on a completed session lands here with that session
  // pre-selected, so the user goes straight to the stars.
  useEffect(() => {
    if (!preselectSessionId) return
    const entry = completedPartners.find((p) => p.session.id === preselectSessionId)
    if (entry) {
      setSelectedId(String(entry.partner.id))
      setResult(null)
      setSubmitError('')
    }
    onPreselectConsumed?.()
  }, [preselectSessionId, completedPartners, onPreselectConsumed])

  const selected = rateablePartners.find((p) => String(p.partner.id) === selectedId)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!selected || rating === 0) return
    setSubmitError('')
    setResult(null)
    setBusy(true)
    try {
      await api.createReview({ session_id: selected.session.id, rating_stars: rating, feedback_text: comment })
      // Fetch the partner's updated trust score
      const updated: Profile = await api.getProfile(selected.partner.id)
      setResult({ name: displayName(selected.partner), trust: updated.trust_score })
      setReviewedSessionIds((prev) => [...prev, selected.session.id])
      setSelectedId('')
      setComment('')
      setRating(0)
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.detail : 'Could not submit the review.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <p className="eyebrow">Session Feedback</p>
        <h1 className="page-title mt-1">Session Feedback Hub</h1>
        <p className="text-sm text-slate-500">Rate a completed session — your feedback updates your partner&apos;s trust score.</p>
      </div>

      {error && (
        <div role="alert" className="rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3">
          Couldn&apos;t load sessions: {error}
        </div>
      )}

      {loading ? (
        <p className="text-slate-500 text-sm">Loading your sessions…</p>
      ) : rateablePartners.length === 0 ? (
        <div className="card p-10 text-center">
          <p className="font-semibold text-slate-800">
            {completedPartners.length > 0 ? 'All caught up' : 'No completed sessions yet'}
          </p>
          <p className="text-sm text-slate-500 mt-1">
            {completedPartners.length > 0
              ? 'You have already rated every completed session — one review per session.'
              : 'Once a session is marked complete, your partner will appear here for review.'}
          </p>
        </div>
      ) : (
        <form onSubmit={submit} className="card p-6 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1" htmlFor="fb-partner">Partner (completed sessions only)</label>
            <select
              id="fb-partner"
              value={selectedId}
              onChange={(e) => {
                setSelectedId(e.target.value)
                setResult(null)
                setSubmitError('')
              }}
              required
              className="input"
            >
              <option value="" disabled>Select a partner…</option>
              {rateablePartners.map(({ partner }) => (
                <option key={partner.id} value={partner.id}>
                  {displayName(partner)} (@{partner.username})
                </option>
              ))}
            </select>
          </div>

          {selected && (
            <div className="flex items-center gap-3 rounded-lg bg-slate-50 border border-slate-200 px-3 py-2">
              <Avatar user={selected.partner} color={peerProfiles.get(selected.partner.id)?.avatar_color} size="sm" />
              <div className="text-sm">
                <p className="font-semibold text-slate-800">{displayName(selected.partner)}</p>
                <p className="text-slate-500">{selected.session.title || 'Skill swap session'} · {new Date(selected.session.calendar_date).toLocaleDateString()}</p>
              </div>
            </div>
          )}

          <div>
            <span className="block text-xs font-semibold text-slate-600 mb-1">Your rating</span>
            <div className="flex gap-1" role="radiogroup" aria-label="Rating">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={rating === n}
                  aria-label={`${n} star${n > 1 ? 's' : ''}`}
                  onClick={() => setRating(n)}
                  className={`text-3xl ${n <= rating ? 'text-amber-400' : 'text-slate-300'} hover:text-amber-300`}
                >
                  ★
                </button>
              ))}
            </div>
            {rating === 0 && <p className="text-xs text-slate-500 mt-1">Pick a star rating to enable submit.</p>}
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1" htmlFor="fb-comment">Comments</label>
            <textarea
              id="fb-comment"
              rows={4}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="What went well? What could be better?"
              className="input"
            />
          </div>

          {submitError && <div role="alert" className="rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2">{submitError}</div>}
          {result && (
            <div role="status" className="rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm px-3 py-2">
              Thank you! {result.name}&apos;s trust score is now <span className="font-bold">{result.trust}</span>.
            </div>
          )}

          <button
            type="submit"
            disabled={busy || rating === 0 || !selectedId}
            className="btn-primary"
          >
            {busy ? 'Submitting…' : 'Submit review'}
          </button>
        </form>
      )}
    </div>
  )
}
