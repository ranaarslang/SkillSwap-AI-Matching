import { useEffect, useMemo, useState } from 'react'
import type { MatchProfile, Profile, Review, SessionItem } from '../api'
import { api, displayName, formatLocation } from '../api'
import { Avatar, Chip, IconClose, IconPin, RatingStars, ScoreBadge, TrustBadge, VerifiedBadge } from './ui'

/** Match fields are optional: directory-search results are plain profiles. */
type ViewableProfile = Profile &
  Partial<Pick<MatchProfile, 'match_score' | 'location_bonus' | 'same_location' | 'can_teach_you' | 'you_can_teach_them'>>

interface Props {
  profile: ViewableProfile
  isMatch: boolean
  onClose: () => void
  onMessage: (profile: Profile) => void
  /** Start an in-app video call with this user (optional — omitted where
   * the call button doesn't apply, e.g. the admin detail view). */
  onCall?: (profile: Profile) => void
  /** Admin profile views hide the match score — it is meaningless there. */
  hideScore?: boolean
  /** Completed sessions with this user, for the Rate button. Only passed
   * on the student side — the admin view never rates. */
  sessions?: SessionItem[]
  currentUserId?: number
  /** Jump to the Feedback Hub with this session pre-selected. */
  onRateSession?: (session: SessionItem) => void
}

/**
 * Full profile view: everything a learner or teacher needs before reaching
 * out — bio, location, availability, trust score, teach/learn skills,
 * recent reviews, and a prominent Message button.
 */
export default function ProfileModal({ profile, isMatch, onClose, onMessage, onCall, hideScore = false, sessions, currentUserId, onRateSession }: Props) {
  const [reviews, setReviews] = useState<Review[] | null>(null)

  // The one completed, not-yet-reviewed session with this user — the
  // Rate button below only shows when a genuine rating is possible, so
  // it can never dead-end on "already rated". reviewedSessionIds is null
  // until the fetch completes: while it is null the button stays hidden,
  // so a reviewed partner never flashes as rateable on open.
  const [reviewedSessionIds, setReviewedSessionIds] = useState<number[] | null>(null)
  useEffect(() => {
    if (!onRateSession) return
    let cancelled = false
    api.getMyReviews()
      .then((mine) => {
        if (cancelled) return
        setReviewedSessionIds(
          mine.map((r) => r.session).filter((s): s is number => typeof s === 'number'),
        )
      })
      .catch(() => {
        if (!cancelled) setReviewedSessionIds([])
      })
    return () => {
      cancelled = true
    }
  }, [onRateSession])
  const rateableSession = useMemo(() => {
    if (!onRateSession || !sessions || currentUserId === undefined || reviewedSessionIds === null) return null
    return (
      sessions.find((s) => {
        if (s.session_status !== 'COMPLETED') return false
        if (reviewedSessionIds.includes(s.id)) return false
        const other = s.partner_one.id === currentUserId ? s.partner_two : s.partner_one
        return other.id === profile.user.id
      }) ?? null
    )
  }, [onRateSession, sessions, currentUserId, reviewedSessionIds, profile.user.id])

  useEffect(() => {
    let cancelled = false
    api
      .getReviews(profile.user.id)
      .then((r) => {
        if (!cancelled) setReviews(r)
      })
      .catch(() => {
        if (!cancelled) setReviews([])
      })
    return () => {
      cancelled = true
    }
  }, [profile.user.id])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const why: string[] = []
  if (profile.can_teach_you?.length) why.push(`They can teach you: ${profile.can_teach_you.join(', ')}`)
  if (profile.you_can_teach_them?.length) why.push(`You can teach them: ${profile.you_can_teach_them.join(', ')}`)

  return (
    <div
      className="animate-fade fixed inset-0 z-50 flex items-end justify-center bg-slate-950/60 p-0 backdrop-blur-sm sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={`Profile of ${displayName(profile.user)}`}
      onClick={onClose}
    >
      <div
        className="animate-rise max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-[1.25rem] bg-white shadow-pop sm:rounded-panel"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="relative overflow-hidden bg-gradient-to-br from-indigo-950 via-indigo-900 to-violet-950 px-6 pb-6 pt-5 text-white">
          <div className="pointer-events-none absolute -right-10 -top-16 h-48 w-48 rounded-full bg-indigo-500/30 blur-3xl" aria-hidden />
          <button
            onClick={onClose}
            aria-label="Close profile"
            className="absolute right-4 top-4 z-10 rounded-lg p-1.5 text-indigo-200 hover:bg-white/10 hover:text-white"
          >
            <IconClose className="h-5 w-5" />
          </button>
          {/* Round 3c: a visible Back button returns to the dashboard. */}
          <div className="relative mb-3">
            <button
              onClick={onClose}
              aria-label="Back to dashboard"
              className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-semibold text-indigo-200 hover:bg-white/10 hover:text-white"
            >
              ← Back
            </button>
          </div>
          <div className="relative flex items-start gap-4">
            <Avatar user={profile.user} color={profile.avatar_color} size="lg" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xl font-bold tracking-tight">{displayName(profile.user)}</h2>
                {profile.verified_badge && <VerifiedBadge />}
              </div>
              <p className="text-sm text-indigo-200">ID {profile.user.id} · @{profile.user.username}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {!hideScore &&
                  (isMatch && profile.match_score != null ? (
                    <ScoreBadge score={profile.match_score} />
                  ) : (
                    <span className="rounded-full bg-white/15 px-2.5 py-1 text-xs font-semibold text-white">below 50% match</span>
                  ))}
                <TrustBadge score={profile.trust_score} />
                <RatingStars average={profile.average_rating} count={profile.review_count} />
              </div>
            </div>
          </div>
          <div className="relative mt-4 flex flex-wrap gap-x-5 gap-y-1 text-sm text-indigo-100">
            {formatLocation(profile) && (
              <span className="inline-flex items-center gap-1.5">
                <IconPin className="h-4 w-4" /> {formatLocation(profile)}
              </span>
            )}
            {profile.availability && <span>Available: {profile.availability}</span>}
            {profile.same_location && (profile.location_bonus ?? 0) > 0 && (
              <span>+{profile.location_bonus} same-city bonus</span>
            )}
          </div>
        </div>

        <div className="space-y-5 px-6 py-5">
          {why.length > 0 && (
            <p className="rounded-xl bg-emerald-50/80 px-3.5 py-2.5 text-sm font-medium leading-relaxed text-emerald-800 ring-1 ring-inset ring-emerald-100">
              {why.join(' · ')}
            </p>
          )}

          {profile.bio && (
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">About</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-700">{profile.bio}</p>
            </section>
          )}

          {profile.teach_skills?.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Can teach you</h3>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {profile.teach_skills.map((s) => (
                  <Chip key={s}>{s}</Chip>
                ))}
              </div>
            </section>
          )}

          {profile.learn_skills?.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Wants to learn</h3>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {profile.learn_skills.map((s) => (
                  <Chip key={s} tone="emerald">{s}</Chip>
                ))}
              </div>
            </section>
          )}

          {profile.portfolio_link && (
            <a href={profile.portfolio_link} target="_blank" rel="noreferrer" className="inline-block text-sm font-semibold text-indigo-600 hover:underline">
              View portfolio ↗
            </a>
          )}

          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Reviews {reviews ? `(${reviews.length})` : ''}
              {profile.average_rating !== null && profile.review_count > 0 && (
                <span className="ml-2 normal-case tracking-normal text-amber-600">
                  ★ {profile.average_rating.toFixed(1)} average
                </span>
              )}
            </h3>
            {reviews === null ? (
              <p className="mt-1.5 text-sm text-slate-500">Loading reviews…</p>
            ) : reviews.length === 0 ? (
              <p className="mt-1.5 text-sm text-slate-500">No reviews yet.</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {reviews.slice(0, 3).map((r) => (
                  <li key={r.id} className="card px-3.5 py-2.5">
                    <p className="text-sm font-semibold text-amber-500">{'★'.repeat(r.rating_stars)}{'☆'.repeat(5 - r.rating_stars)}</p>
                    {r.feedback_text && <p className="mt-0.5 text-sm text-slate-600">{r.feedback_text}</p>}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <div className="flex flex-wrap gap-3 pt-1">
            <button
              onClick={() => onMessage(profile)}
              className="btn-primary flex-1"
            >
              Message {displayName(profile.user).split(' ')[0]}
            </button>
            {rateableSession && onRateSession && (
              <button
                onClick={() => onRateSession(rateableSession)}
                className="rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold px-4 py-2.5"
              >
                ★ Rate {displayName(profile.user).split(' ')[0]}
              </button>
            )}
            {onCall && (
              <button
                onClick={() => onCall(profile)}
                className="rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold px-4 py-2.5"
                title="Start an in-app video call"
              >
                📹 Video call
              </button>
            )}
            <button
              onClick={onClose}
              className="btn-secondary"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
