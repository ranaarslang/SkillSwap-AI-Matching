import { useEffect, useState } from 'react'
import type { MatchProfile, Review } from '../api'
import { api, displayName } from '../api'
import { Avatar, Chip, IconClose, IconPin, ScoreBadge, TrustBadge, VerifiedBadge } from './ui'

interface Props {
  profile: MatchProfile
  isMatch: boolean
  onClose: () => void
  onMessage: (profile: MatchProfile) => void
  /** Admin profile views hide the match score — it is meaningless there. */
  hideScore?: boolean
}

/**
 * Full profile view: everything a learner or teacher needs before reaching
 * out — bio, location, availability, trust score, teach/learn skills,
 * recent reviews, and a prominent Message button.
 */
export default function ProfileModal({ profile, isMatch, onClose, onMessage, hideScore = false }: Props) {
  const [reviews, setReviews] = useState<Review[] | null>(null)

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
          <div className="relative flex items-start gap-4">
            <Avatar user={profile.user} color={profile.avatar_color} size="lg" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xl font-bold tracking-tight">{displayName(profile.user)}</h2>
                {profile.verified_badge && <VerifiedBadge />}
              </div>
              <p className="text-sm text-indigo-200">@{profile.user.username}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {!hideScore &&
                  (isMatch ? <ScoreBadge score={profile.match_score} /> : <span className="rounded-full bg-white/15 px-2.5 py-1 text-xs font-semibold text-white">below 50% match</span>)}
                <TrustBadge score={profile.trust_score} />
              </div>
            </div>
          </div>
          <div className="relative mt-4 flex flex-wrap gap-x-5 gap-y-1 text-sm text-indigo-100">
            {profile.location && (
              <span className="inline-flex items-center gap-1.5">
                <IconPin className="h-4 w-4" /> {profile.location}
              </span>
            )}
            {profile.availability && <span>Available: {profile.availability}</span>}
            {profile.same_location && profile.location_bonus > 0 && (
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

          <div className="flex gap-3 pt-1">
            <button
              onClick={() => onMessage(profile)}
              className="btn-primary flex-1"
            >
              Message {displayName(profile.user).split(' ')[0]}
            </button>
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
